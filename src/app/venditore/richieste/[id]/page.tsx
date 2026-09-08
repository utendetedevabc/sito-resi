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
  data_approvazione: string | null;
  created_at: string;
  richiedente_nome: string;
  richiedente_azienda: string;
  // Modello nuovo: corriere + PV manuale + num_reso
  corriere?: string | null;
  corriere_nome?: string | null;
  pv_nome?: string | null;
  pv_indirizzo?: string | null;
  pv_citta?: string | null;
  pv_cap?: string | null;
  pv_provincia?: string | null;
  pv_regione?: string | null;
  num_reso?: number | null;
  // Campi per export corriere (visibili al responsabile per decidere)
  cldm?: string | null;
  ddt_numero?: string | null;
  ddt_data?: string | null;
  num_colli?: number | null;
}

export default function VenditoreRichiestaDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { addToast } = useToast();
  const uuid = params.id as string;

  const [richiesta, setRichiesta] = useState<RichiestaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [azione, setAzione] = useState<'approvato' | 'rifiutato' | null>(null);
  const [noteVenditore, setNoteVenditore] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch(`/api/venditore/richieste/${uuid}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Richiesta non trovata');
        const data = await res.json();
        setRichiesta(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [uuid]);

  async function handleSubmit() {
    if (!azione) return;
    setSubmitting(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/venditore/richieste/${uuid}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ stato: azione, note: noteVenditore || undefined, csrf_token: 'placeholder' }),
      });
      if (!res.ok) throw new Error('Errore aggiornamento');
      addToast('success', azione === 'approvato' ? 'Richiesta approvata' : 'Richiesta rifiutata');
      router.push('/venditore');
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  if (loading) return <div className="pt-4"><RichiestaSkeleton /></div>;
  if (error || !richiesta) return <ErrorState message={error || 'Non trovata'} onRetry={() => window.location.reload()} />;

  // Il server (venditore.js GET /richieste/:uuid) restituisce prodotti/linee
  // GIA' parsati come array. Double-parse qui -> SyntaxError. Parse difensivo.
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
      <MobileHeader title={`Richiesta #${richiesta.uuid.slice(0, 8)}`} />

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
              <p className="text-xs text-gray-400 mb-0.5">Richiedente</p>
              <p className="text-sm font-medium text-gray-100">
                {richiesta.richiedente_nome} — {richiesta.richiedente_azienda}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Numero Ordine</p>
              <p className="text-sm font-medium text-gray-100">{richiesta.numero_ordine_esterno}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Motivo</p>
              <p className="text-sm font-medium text-gray-100 capitalize">{richiesta.motivo_reso.replace('_', ' ')}</p>
            </div>
          </div>

          {richiesta.note && (
            <div className="pt-3 border-t border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Note</p>
              <p className="text-sm text-gray-200 leading-relaxed">{richiesta.note}</p>
            </div>
          )}
        </div>

        {/* Linee (modello nuovo) con fallback a Prodotti per resi vecchi */}
        <div>
          <h2 className="text-base font-semibold text-gray-200 mb-3">
            {haLinee ? 'Linee' : 'Prodotti'}
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
              prodotti.map((p: any, i: number) => (
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
              ))
            )}
          </div>
        </div>

        {/* Dati per ritiro corriere — visibili al responsabile per valutare
            cosa rimborsare e come ritirare (PV, corriere, DDT, colli) */}
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
              {!richiesta.pv_nome && richiesta.cldm && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">CLDM punto vendita</dt>
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
              {richiesta.num_colli != null && (
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Num. colli</dt>
                  <dd className="text-gray-100 font-medium text-right">{richiesta.num_colli}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {richiesta.stato === 'in_attesa' && (
          <div className="space-y-3">
            <div>
              <label htmlFor="note-venditore" className="block text-sm font-medium text-gray-300 mb-1.5">
                Note venditore
              </label>
              <textarea
                id="note-venditore"
                rows={3}
                maxLength={2000}
                value={noteVenditore}
                onChange={(e) => setNoteVenditore(e.target.value)}
                className="input-mobile resize-y"
                placeholder="Aggiungi note..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setAzione('approvato')}
                className="h-12 bg-green-600 text-white font-semibold rounded-2xl active:bg-green-700 transition-colors"
              >
                Approva
              </button>
              <button
                onClick={() => setAzione('rifiutato')}
                className="h-12 bg-red-600 text-white font-semibold rounded-2xl active:bg-red-700 transition-colors"
              >
                Rifiuta
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmSheet
        open={!!azione}
        title={azione === 'approvato' ? 'Conferma approvazione' : 'Conferma rifiuto'}
        message={`Sei sicuro di voler ${azione === 'approvato' ? 'approvare' : 'rifiutare'} questa richiesta?`}
        confirmText={azione === 'approvato' ? 'Approva' : 'Rifiuta'}
        variant={azione === 'approvato' ? 'primary' : 'danger'}
        onConfirm={handleSubmit}
        onCancel={() => { setAzione(null); setSubmitting(false); }}
      />
    </div>
  );
}
