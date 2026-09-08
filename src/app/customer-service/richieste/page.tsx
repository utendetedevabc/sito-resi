'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import MobileHeader from '@/components/layout/MobileHeader';
import { ListaSkeleton } from '@/components/ui/SkeletonLoader';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { CheckCircleIcon, XCircleIcon, ChevronDownIcon, ChevronUpIcon, ArrowRightIcon, DocumentArrowDownIcon } from '@heroicons/react/24/outline';

interface Richiesta {
  id: number;
  uuid: string;
  numero_ordine_esterno: string;
  motivo_reso: string;
  stato: string;
  note: string | null;
  note_venditore: string | null;
  data_approvazione: string;
  created_at: string;
  richiedente_nome: string;
  richiedente_azienda: string;
  venditore_nome: string | null;
  cldm?: string | null;
  ddt_numero?: string | null;
  num_colli?: number | null;
  bda_autorizzazione?: string | null;
}

type Vista = 'da_approvare' | 'elaborati';

const STATO_BADGE: Record<string, { label: string; cls: string }> = {
  approvato:  { label: 'Approvato',  cls: 'text-green-400 bg-green-500/10 border-green-500/20' },
  spedito:   { label: 'Spedito',    cls: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  completato: { label: 'Completato', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
};

export default function CSRRichiestePage() {
  const { addToast } = useToast();
  const [data, setData] = useState<Richiesta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [azione, setAzione] = useState<{ uuid: string; tipo: 'approvato' | 'rifiutato'; note: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [vista, setVista] = useState<Vista>('da_approvare');
  const [downloadingUuid, setDownloadingUuid] = useState<string | null>(null);

  const fetchData = useCallback(async (v: Vista) => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/customer-service/richieste?view=${v}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Errore caricamento');
      const json = await res.json();
      setData(json.data || []);
    } catch {
      setError('Impossibile caricare le richieste.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setExpanded(null);
    setAzione(null);
    fetchData(vista);
  }, [fetchData, vista]);

  // Scarica il file corriere RITGIO*.xls del reso (download diretto dalla lista).
  async function downloadXls(uuid: string) {
    setDownloadingUuid(uuid);
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
      const filename = m ? m[1] : `RITGIO_${uuid.slice(0, 8)}.xls`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      addToast('success', `File ${filename} scaricato`);
    } catch (err: any) {
      addToast('error', err.message || 'Errore download file corriere');
    } finally {
      setDownloadingUuid(null);
    }
  }

  async function handleAzione(uuid: string, tipo: 'approvato' | 'rifiutato') {
    if (!azione || azione.uuid !== uuid) {
      setAzione({ uuid, tipo, note: '' });
      return;
    }

    setSaving(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/customer-service/richieste/${uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stato: tipo, note: azione.note || undefined }),
      });
      if (!res.ok) throw new Error('Errore');
      addToast('success', tipo === 'approvato' ? 'Richiesta approvata — file corriere disponibile in "Elaborati"' : 'Richiesta rifiutata');
      setAzione(null);
      if (tipo === 'approvato') {
        // Dopo l'approvazione il reso lascia la coda "Da approvare": passa alla
        // vista "Elaborati" dove l'interno trova il bottone di download XLS.
        setVista('elaborati');
      } else {
        fetchData('da_approvare');
      }
    } catch {
      addToast('error', 'Errore durante l\'operazione');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-dvh bg-gray-950">
      <MobileHeader title="Richieste da gestire" />

      <div className="pt-4">
        {/* Selettore vista: "Da approvare" (coda in_revisione) vs "Elaborati"
            (approvato/spedito/completato, dove scaricare il file corriere).
            role=tablist + aria-selected, tastiera attiva sui <button>. */}
        <div role="tablist" aria-label="Filtro richieste" className="mb-4 flex gap-2 p-1 bg-gray-800 rounded-2xl border border-gray-700">
          {([['da_approvare', 'Da approvare'], ['elaborati', 'Elaborati']] as [Vista, string][]).map(([v, label]) => {
            const selected = vista === v;
            return (
              <button
                key={v}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => setVista(v)}
                className={`flex-1 h-11 rounded-xl text-sm font-medium transition-colors ${selected ? 'bg-blue-600 text-white' : 'text-gray-300 active:bg-gray-700'}`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {error && (
          <div role="alert" className="mb-4 p-3 bg-red-900/30 text-red-300 rounded-xl border border-red-800 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <ListaSkeleton count={5} />
        ) : data.length === 0 ? (
          <EmptyState
            title={vista === 'da_approvare' ? 'Nessuna richiesta' : 'Nessun reso elaborato'}
            description={vista === 'da_approvare'
              ? 'Non ci sono richieste in attesa di gestione.'
              : 'Non ci sono ancora resi approvati. Quando approvi un reso lo ritrovi qui per scaricare il file corriere.'}
          />
        ) : (
          <div className="space-y-3">
            {data.map((r) => {
              const panelId = `det-${r.uuid}`;
              const isExpanded = expanded === r.uuid;
              const badge = STATO_BADGE[r.stato];
              return (
              <div key={r.uuid} className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
                {/* Header espandibile: <button> reale (focusabile da tastiera,
                    aria-expanded/aria-controls) NON <div onClick> (bug a11y).
                    WCAG 2.4.3 + 4.1.2. */}
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                  onClick={() => setExpanded(isExpanded ? null : r.uuid)}
                  className="w-full flex items-center justify-between p-4 text-left active:bg-gray-750 transition-colors"
                >
                  <span className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronUpIcon className="w-5 h-5 text-gray-400" aria-hidden="true" />
                    ) : (
                      <ChevronDownIcon className="w-5 h-5 text-gray-400" aria-hidden="true" />
                    )}
                    <span className="text-left">
                      <span className="block font-medium text-white text-sm">{r.numero_ordine_esterno}</span>
                      <span className="block text-xs text-gray-400">{r.richiedente_nome} — {r.richiedente_azienda}</span>
                    </span>
                  </span>
                  {vista === 'da_approvare' ? (
                    <span className="text-xs font-medium text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-1 rounded-full">
                      In revisione
                    </span>
                  ) : badge ? (
                    <span className={`text-xs font-medium px-2 py-1 rounded-full border ${badge.cls}`}>
                      {badge.label}
                    </span>
                  ) : null}
                </button>

                {isExpanded && (
                  <div id={panelId} className="px-4 pb-4 border-t border-gray-700">
                    <div className="py-3 space-y-2 text-sm text-gray-300">
                      <p><span className="text-gray-500">Motivo:</span> {r.motivo_reso.replace('_', ' ')}</p>
                      <p><span className="text-gray-500">Venditore:</span> {r.venditore_nome || '—'}</p>
                      {r.note && <p><span className="text-gray-500">Note:</span> {r.note}</p>}
                      {r.note_venditore && <p><span className="text-gray-500">Note venditore:</span> {r.note_venditore}</p>}
                      {r.data_approvazione && (
                        <p><span className="text-gray-500">Data approvazione:</span> {new Date(r.data_approvazione).toLocaleString('it-IT')}</p>
                      )}
                      {vista === 'elaborati' && (r.cldm || r.ddt_numero || r.num_colli || r.bda_autorizzazione) && (
                        <p className="text-xs text-gray-500">
                          CLDM {r.cldm || '—'} · DDT {r.ddt_numero || '—'} · Colli {r.num_colli ?? '—'} · BDA {r.bda_autorizzazione || '—'}
                        </p>
                      )}
                    </div>

                    {/* Link al dettaglio completo (prodotti da rimborsare + dati ritiro corriere).
                        L'interno DEVE poter vedere COSA rimborsa prima di approvare. */}
                    <Link
                      href={`/customer-service/richieste/${r.uuid}`}
                      className="mb-3 inline-flex items-center gap-1 text-xs text-blue-400 active:text-blue-300 min-h-[44px] py-2"
                    >
                      Vedi dettaglio completo (prodotti e dati corriere)
                      <ArrowRightIcon className="w-4 h-4" aria-hidden="true" />
                    </Link>

                    {vista === 'da_approvare' && azione?.uuid === r.uuid && (
                      <div className="mb-3">
                        <label htmlFor={`note-${r.uuid}`} className="block text-xs font-medium text-gray-400 mb-1.5">
                          Note {azione.tipo === 'approvato' ? 'approvazione' : 'rifiuto'}
                        </label>
                        <textarea
                          id={`note-${r.uuid}`}
                          value={azione.note}
                          onChange={(e) => setAzione({ ...azione, note: e.target.value })}
                          className="input-mobile min-h-[60px] resize-y"
                          placeholder="Note opzionali..."
                        />
                      </div>
                    )}

                    {vista === 'da_approvare' ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAzione(r.uuid, 'rifiutato')}
                          disabled={saving}
                          className="flex-1 h-12 bg-red-900/30 text-red-300 font-medium rounded-xl border border-red-800 active:bg-red-900/50 transition-colors flex items-center justify-center gap-2"
                        >
                          <XCircleIcon className="w-5 h-5" aria-hidden />
                          {azione?.uuid === r.uuid && azione.tipo === 'rifiutato' ? 'Conferma rifiuto' : 'Rifiuta'}
                        </button>
                        <button
                          onClick={() => handleAzione(r.uuid, 'approvato')}
                          disabled={saving}
                          className="flex-1 h-12 bg-green-600 text-white font-medium rounded-xl active:bg-green-700 transition-colors flex items-center justify-center gap-2"
                        >
                          <CheckCircleIcon className="w-5 h-5" aria-hidden />
                          {azione?.uuid === r.uuid && azione.tipo === 'approvato' ? 'Conferma approvazione' : 'Approva'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => downloadXls(r.uuid)}
                        disabled={downloadingUuid === r.uuid}
                        aria-busy={downloadingUuid === r.uuid}
                        aria-label={`Scarica file corriere RITGIO del reso ${r.numero_ordine_esterno}`}
                        className="w-full h-12 flex items-center justify-center gap-2 bg-blue-600 text-white font-medium rounded-xl active:bg-blue-700 transition-colors disabled:opacity-60"
                      >
                        {downloadingUuid === r.uuid ? (
                          <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                        ) : (
                          <DocumentArrowDownIcon className="w-5 h-5" aria-hidden="true" />
                        )}
                        Scarica file corriere (RITGIO*.xls)
                      </button>
                    )}
                    {vista === 'da_approvare' && (
                      <p className="mt-2 text-[11px] text-gray-500">
                        L'approvazione finale invia il reso ad ABC HUB e genera il file corriere <span className="font-mono">RITGIO_*.xls</span> (scaricabile poi dalla vista "Elaborati"). Il rifiuto chiude la pratica.
                      </p>
                    )}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
