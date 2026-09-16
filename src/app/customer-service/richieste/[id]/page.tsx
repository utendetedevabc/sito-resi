'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import MobileHeader from '@/components/layout/MobileHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmSheet from '@/components/ui/ConfirmSheet';
import { RichiestaSkeleton } from '@/components/ui/SkeletonLoader';
import ErrorState from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';

interface RichiestaDetail {
  uuid: string;
  numero_ordine_esterno: string;
  motivo_reso: string;
  note: string | null;
  prodotti: string | object[];
  linee?: string | object[];
  stato: string;
  note_venditore: string | null;
  // 2026-09-16 P1: motivazione manuale (solo quando motivo_reso = 'altro')
  motivo_altro?: string | null;
  data_approvazione: string | null;
  created_at: string;
  richiedente_nome: string;
  richiedente_azienda: string;
  venditore_nome: string | null;
  // Modello nuovo: corriere + PV manuale + num_reso sequenziale
  corriere?: string | null;
  corriere_nome?: string | null;
  pv_nome?: string | null;
  pv_indirizzo?: string | null;
  pv_citta?: string | null;
  pv_cap?: string | null;
  pv_provincia?: string | null;
  pv_regione?: string | null;
  num_reso?: number | null;
  // Campi per export corriere (visibili all'interno per decidere)
  cldm?: string | null;
  ddt_numero?: string | null;
  ddt_data?: string | null;
  num_colli?: number | null;
  bda_autorizzazione?: string | null;
  uploads?: { id: number; mime_type: string; size_bytes: number }[];
}

export default function CustomerServiceRichiestaDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { addToast } = useToast();
  const uuid = params.id as string;

  const [richiesta, setRichiesta] = useState<RichiestaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [azione, setAzione] = useState<'approvato' | 'rifiutato' | null>(null);
  const [noteInterno, setNoteInterno] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Stati per cui il file corriere RITGIO*.xls è già scaricabile (webhook già sparato).
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState('');
  const STATI_EXPORTABILI = ['approvato', 'spedito', 'completato'];

  // Carica il dettaglio del reso (usato al mount e dopo l'approvazione, per
  // rimanere sulla pagina e mostrare subito il bottone di download del file).
  async function caricaRichiesta() {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/customer-service/richieste/${uuid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Richiesta non trovata o già processata');
      const data = await res.json();
      setRichiesta(data);
      return data;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    caricaRichiesta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  // Scarica il manifest ritiri corriere RITGIO_<DDMMYY>.xls generato on-demand
  // dal server. L'interno ottiene il file direttamente dalla sua pagina.
  async function handleDownload() {
    setDownloading(true);
    setDownloadMsg('Generazione file corriere in corso…');
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/customer-service/richieste/${uuid}/xls`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Errore generazione file');
      }
      const disp = res.headers.get('Content-Disposition') || '';
      const m = disp.match(/filename="?([^"]+)"?/i);
      const filename = m ? m[1] : `RITGIO_${richiesta?.uuid?.slice(0, 8) || 'resi'}.xls`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDownloadMsg(`File ${filename} scaricato.`);
    } catch (err: any) {
      setDownloadMsg(err.message || 'Errore download');
    } finally {
      setDownloading(false);
    }
  }

  async function handleSubmit() {
    if (!azione) return;
    setSubmitting(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/customer-service/richieste/${uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stato: azione, note: noteInterno || undefined }),
      });
      if (!res.ok) throw new Error('Errore aggiornamento');
      addToast(
        'success',
        azione === 'approvato'
          ? 'Reso approvato — inviato ad ABC HUB (genera file corriere)'
          : 'Reso rifiutato'
      );
      setAzione(null);
      if (azione === 'approvato') {
        // Rimane sulla pagina: ricarica il dettaglio (ora stato=approvato) e
        // scarica subito il file corriere RITGIO*.xls per l'interno.
        await caricaRichiesta();
        handleDownload();
      } else {
        router.push('/customer-service/richieste');
      }
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  if (loading) return <div className="pt-4"><RichiestaSkeleton /></div>;
  if (error || !richiesta) return <ErrorState message={error || 'Non trovata'} onRetry={() => window.location.reload()} />;

  // Server restituisce prodotti/linee gia' parsati come array (parse difensivo).
  const rawProdotti = richiesta.prodotti as unknown;
  const prodotti = typeof rawProdotti === 'string'
    ? JSON.parse(rawProdotti || '[]')
    : Array.isArray(rawProdotti) ? rawProdotti : [];
  const rawLinee = richiesta.linee as unknown;
  const linee = typeof rawLinee === 'string'
    ? JSON.parse(rawLinee || '[]')
    : Array.isArray(rawLinee) ? rawLinee : [];
  const haLinee = Array.isArray(linee) && linee.length > 0;

  return (
    <div className="min-h-dvh bg-gray-950 pb-8">
      <MobileHeader title={`Reso #${richiesta.uuid.slice(0, 8)}`} />

      <div className="pt-4 space-y-4">
        <div className="card-mobile space-y-4">
          <div className="flex items-center justify-between">
            <StatusBadge stato={richiesta.stato} />
            <span className="text-xs text-gray-400">
              {new Date(richiesta.created_at).toLocaleDateString('it-IT')}
            </span>
          </div>

          {richiesta.num_reso != null && (
            <div className="inline-flex items-center self-start px-3 py-1 rounded-full bg-blue-900/40 border border-blue-700 text-blue-200 text-sm font-semibold">
              Reso N. {richiesta.num_reso}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Richiedente (promoter)</p>
              <p className="text-sm font-medium text-gray-100">
                {richiesta.richiedente_nome} — {richiesta.richiedente_azienda}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Approvato al 1° livello da (responsabile)</p>
              <p className="text-sm font-medium text-gray-100">
                {richiesta.venditore_nome || '—'}
                {richiesta.data_approvazione && (
                  <span className="block text-xs text-gray-500 mt-0.5">
                    {new Date(richiesta.data_approvazione).toLocaleString('it-IT')}
                  </span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Numero Ordine</p>
              <p className="text-sm font-medium text-gray-100">{richiesta.numero_ordine_esterno}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Motivo</p>
              <p className="text-sm font-medium text-gray-100 capitalize">{richiesta.motivo_reso.replace('_', ' ')}</p>
              {richiesta.motivo_altro && (
                <p className="text-sm text-gray-300 mt-1">
                  <span className="text-gray-400">Altro: </span>{richiesta.motivo_altro}
                </p>
              )}
            </div>
          </div>

          {richiesta.note && (
            <div className="pt-3 border-t border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Note richiedente</p>
              <p className="text-sm text-gray-200 leading-relaxed">{richiesta.note}</p>
            </div>
          )}

          {richiesta.note_venditore && (
            <div className="pt-3 border-t border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Note responsabile (1° approvazione)</p>
              <p className="text-sm text-gray-200 leading-relaxed">{richiesta.note_venditore}</p>
            </div>
          )}
        </div>

        {/* Linee (modello nuovo) — COSA si rimborsa. Fallback a Prodotti per resi vecchi. */}
        <div>
          <h2 className="text-base font-semibold text-gray-200 mb-3">
            {haLinee ? 'Linee da rimborsare' : 'Prodotti da rimborsare'}
          </h2>
          <div className="space-y-3">
            {haLinee ? (
              linee.map((l: any, i: number) => (
                <div key={i} className="card-mobile">
                  <div className="flex justify-between items-start">
                    <p className="text-sm font-medium text-gray-100">{l.nome}</p>
                    <span className="text-xs text-gray-400">N. pezzi: {l.numero_pezzi}</span>
                  </div>
                </div>
              ))
            ) : (
              <>
                {prodotti.length === 0 && (
                  <p className="text-sm text-gray-500">Nessun prodotto specificato.</p>
                )}
                {prodotti.map((p: any, i: number) => (
                  <div key={i} className="card-mobile">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-medium text-gray-100">{p.codice}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{p.descrizione}</p>
                      </div>
                      <span className="text-xs text-gray-400">Q.tà: {p.quantita}</span>
                    </div>
                    <p className="text-xs text-gray-500 capitalize mt-2">Condizioni: {p.condizioni}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* Dati per ritiro corriere: PV manuale (nuovo) o CLDM (vecchio), corriere, num_reso, DDT, colli */}
        {(richiesta.pv_nome || richiesta.cldm || richiesta.corriere || richiesta.ddt_numero || richiesta.num_colli != null) && (
          <div className="card-mobile">
            <h2 className="text-base font-semibold text-gray-200 mb-3">Dati ritiro corriere</h2>
            <dl className="space-y-2 text-sm">
              {richiesta.pv_nome && (
                <>
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">Punto vendita</dt>
                    <dd className="text-gray-100 font-medium text-right">{richiesta.pv_nome}</dd>
                  </div>
                  {richiesta.pv_indirizzo && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500">Indirizzo</dt>
                      <dd className="text-gray-100 font-medium text-right">{richiesta.pv_indirizzo}</dd>
                    </div>
                  )}
                  {(richiesta.pv_citta || richiesta.pv_cap) && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500">Città / CAP</dt>
                      <dd className="text-gray-100 font-medium text-right">
                        {[richiesta.pv_citta, richiesta.pv_cap].filter(Boolean).join(' — ')}
                      </dd>
                    </div>
                  )}
                  {(richiesta.pv_provincia || richiesta.pv_regione) && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-gray-500">Provincia / Regione</dt>
                      <dd className="text-gray-100 font-medium text-right">
                        {[richiesta.pv_provincia, richiesta.pv_regione].filter(Boolean).join(' — ')}
                      </dd>
                    </div>
                  )}
                </>
              )}
              {richiesta.cldm && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">CLDM</dt>
                  <dd className="text-gray-100 font-medium text-right">{richiesta.cldm}</dd>
                </div>
              )}
              {richiesta.corriere && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Corriere</dt>
                  <dd className="text-gray-100 font-medium text-right">
                    {richiesta.corriere === 'ALTRI' && richiesta.corriere_nome
                      ? richiesta.corriere_nome
                      : richiesta.corriere}
                  </dd>
                </div>
              )}
              {richiesta.num_reso != null && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Numero reso</dt>
                  <dd className="text-gray-100 font-medium text-right">N. {richiesta.num_reso}</dd>
                </div>
              )}
              {richiesta.ddt_numero && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Num. DDT</dt>
                  <dd className="text-gray-100 font-medium text-right">{richiesta.ddt_numero}</dd>
                </div>
              )}
              {richiesta.ddt_data && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Data DDT</dt>
                  <dd className="text-gray-100 font-medium text-right">{richiesta.ddt_data}</dd>
                </div>
              )}
              {/* 2026-09-16 P6: riga sempre presente (i resi di test avevano
                  num_colli NULL e la riga spariva — ora fallback '—'). */}
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Num. colli</dt>
                <dd className="text-gray-100 font-medium text-right">{richiesta.num_colli ?? '—'}</dd>
              </div>
            </dl>
          </div>
        )}

        {richiesta.uploads && richiesta.uploads.length > 0 && (
          <div className="card-mobile">
            <h2 className="text-base font-semibold text-gray-200 mb-2">Foto allegate</h2>
            <p className="text-sm text-gray-400">
              {richiesta.uploads.length} {richiesta.uploads.length === 1 ? 'allegato' : 'allegati'} caricati dal richiedente.
            </p>
          </div>
        )}

        {/* File corriere — generato on-demand, scaricabile dall'interno.
            Disponibile solo dopo l'approvazione finale (stati exportabili). */}
        {STATI_EXPORTABILI.includes(richiesta.stato) && (
          <div className="card-mobile">
            <h2 className="text-base font-semibold text-gray-200 mb-1">File corriere</h2>
            <p className="text-xs text-gray-400 mb-3">
              Manifest ritiri <span className="font-mono">RITGIO_*.xls</span> con i dati di ritiro e
              l'anagrafica del punto vendita. Generato ora dal server.
            </p>
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              aria-busy={downloading}
              className="w-full h-12 flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold rounded-2xl active:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {downloading ? (
                <>
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                  Generazione…
                </>
              ) : (
                <>
                  <span aria-hidden="true">📄</span>
                  Scarica file corriere (RITGIO*.xls)
                </>
              )}
            </button>
            {downloadMsg && (
              <p role="status" aria-live="polite" className="text-xs text-gray-300 mt-2">
                {downloadMsg}
              </p>
            )}
          </div>
        )}

        {richiesta.stato === 'in_revisione' && (
          <div className="space-y-3">
            <div className="p-3 bg-blue-900/20 border border-blue-800 rounded-xl">
              <p className="text-xs text-blue-200 leading-relaxed">
                ⚠ L'approvazione finale invia il reso ad ABC HUB e genera il file corriere
                <span className="font-mono"> RITGIO_*.xls</span> con i dati di ritiro sopra.
                Dopo l'approvazione rimani su questa pagina e il file si scarica subito.
              </p>
            </div>
            <div>
              <label htmlFor="note-interno" className="block text-sm font-medium text-gray-300 mb-1.5">
                Note (opzionali)
              </label>
              <textarea
                id="note-interno"
                rows={3}
                maxLength={2000}
                value={noteInterno}
                onChange={(e) => setNoteInterno(e.target.value)}
                className="input-mobile resize-y"
                placeholder="Aggiungi note..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAzione('rifiutato')}
                className="h-12 bg-red-600 text-white font-semibold rounded-2xl active:bg-red-700 transition-colors"
              >
                Rifiuta
              </button>
              <button
                type="button"
                onClick={() => setAzione('approvato')}
                className="h-12 bg-green-600 text-white font-semibold rounded-2xl active:bg-green-700 transition-colors"
              >
                Approva
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmSheet
        open={!!azione}
        title={azione === 'approvato' ? 'Conferma approvazione finale' : 'Conferma rifiuto'}
        message={`Sei sicuro di voler ${azione === 'approvato' ? 'approvare definitivamente' : 'rifiutare'} questo reso?${azione === 'approvato' ? ' Verrà inviato ad ABC HUB e generato il file corriere.' : ''}`}
        confirmText={azione === 'approvato' ? 'Approva' : 'Rifiuta'}
        variant={azione === 'approvato' ? 'primary' : 'danger'}
        onConfirm={handleSubmit}
        onCancel={() => { setAzione(null); setSubmitting(false); }}
      />
    </div>
  );
}