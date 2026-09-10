'use client';

import { useEffect, useState, useCallback } from 'react';
import { ListaSkeleton } from '@/components/ui/SkeletonLoader';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';

interface AuditEntry {
  id: number;
  azione: string;
  dettaglio: string | null;
  ip_address: string | null;
  created_at: string;
  user_email: string | null;
}

// Mappa codice azione -> etichetta italiana + colore badge.
export const AZIONI: Record<string, { label: string; cls: string }> = {
  RESO_CREATO:            { label: 'Reso creato',              cls: 'text-blue-300 bg-blue-500/10 border-blue-500/20' },
  RESO_MODIFICATO:        { label: 'Reso modificato',          cls: 'text-slate-300 bg-slate-500/10 border-slate-500/20' },
  RESO_ANNULLATO:         { label: 'Reso annullato',          cls: 'text-gray-300 bg-gray-500/10 border-gray-500/20' },
  RESO_APPROVATO_1:       { label: 'Approvato (1° livello)',   cls: 'text-green-300 bg-green-500/10 border-green-500/20' },
  RESO_RIFIUTATO_1:       { label: 'Rifiutato (1° livello)',   cls: 'text-red-300 bg-red-500/10 border-red-500/20' },
  RESO_APPROVATO_FINALE:  { label: 'Approvato finale',         cls: 'text-green-300 bg-green-600/20 border-green-600/30' },
  RESO_RIFIUTATO_FINALE: { label: 'Rifiutato finale',          cls: 'text-red-300 bg-red-600/20 border-red-600/30' },
  RESO_EXPORT_XLS:        { label: 'File corriere scaricato',  cls: 'text-sky-300 bg-sky-500/10 border-sky-500/20' },
  LOGIN_SUCCESS:          { label: 'Login',                    cls: 'text-slate-300 bg-slate-500/10 border-slate-500/20' },
  LOGIN_FAILED:           { label: 'Login fallito',            cls: 'text-amber-300 bg-amber-500/10 border-amber-500/20' },
  LOGIN_LOCKED:           { label: 'Account bloccato',         cls: 'text-red-300 bg-red-500/10 border-red-500/20' },
};

function parseDettaglio(d: string | null): Record<string, any> | null {
  if (!d) return null;
  try { return JSON.parse(d); } catch { return null; }
}

interface Props {
  subtitle?: string;
}

// Cronologia delle proprie azioni (audit_log dell'utente corrente, dal
// endpoint /api/auth/audit). Condiviso tra le sezioni store_account, venditore
// e customer_service — ogni ruolo vede le PROPRIE azioni.
export default function StoricoAzioni({ subtitle }: Props) {
  const [data, setData] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const perPage = 25;

  const load = useCallback(async (p: number, append: boolean) => {
    if (append) setLoadingMore(true); else { setLoading(true); setError(''); }
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/auth/audit?page=${p}&per_page=${perPage}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Errore caricamento');
      const json = await res.json();
      setData((prev) => append ? [...prev, ...(json.data || [])] : (json.data || []));
      setTotal(json.total || 0);
      setPage(p);
    } catch (err: any) {
      setError(err.message || 'Errore');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { load(1, false); }, [load]);

  if (loading) return <div className="pt-4"><ListaSkeleton count={6} /></div>;
  if (error) return <ErrorState message={error} onRetry={() => load(1, false)} />;

  const hasMore = data.length < total;

  return (
    <div className="pt-4">
      {subtitle && <p className="text-xs text-gray-400 mb-4">{subtitle}</p>}

      {data.length === 0 ? (
        <EmptyState title="Nessuna azione" description="Non hai ancora effettuato azioni registrate." />
      ) : (
        <>
          <ol className="space-y-3">
            {data.map((e) => {
              const meta = AZIONI[e.azione] || { label: e.azione, cls: 'text-gray-300 bg-gray-500/10 border-gray-500/20' };
              const det = parseDettaglio(e.dettaglio);
              return (
                <li key={e.id} className="bg-gray-800 rounded-2xl border border-gray-700 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full border ${meta.cls}`}>
                      {meta.label}
                    </span>
                    <time className="text-xs text-gray-400 shrink-0 text-right">
                      {new Date(e.created_at).toLocaleString('it-IT')}
                    </time>
                  </div>
                  <div className="mt-2 space-y-0.5 text-sm">
                    {det?.uuid && (
                      <p className="text-gray-100">
                        <span className="text-gray-500">Reso:</span>{' '}
                        <span className="font-mono text-xs">{det.uuid.slice(0, 8)}</span>
                        {typeof det.stato === 'string' && (
                          <span className="text-gray-500"> → {det.stato.replace('_', ' ')}</span>
                        )}
                        {det.auto && <span className="text-gray-500"> (auto)</span>}
                      </p>
                    )}
                    {det?.numero_ordine && (
                      <p className="text-gray-300"><span className="text-gray-500">Ordine:</span> {det.numero_ordine}</p>
                    )}
                    {det?.cldm && (
                      <p className="text-gray-300"><span className="text-gray-500">CLDM:</span> {det.cldm}</p>
                    )}
                    {det?.note && (
                      <p className="text-gray-300"><span className="text-gray-500">Note:</span> {det.note}</p>
                    )}
                    {det?.email && !det.uuid && (
                      <p className="text-gray-400">{det.email}</p>
                    )}
                    {e.ip_address && (
                      <p className="text-xs text-gray-500 mt-1">IP: {e.ip_address}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {hasMore && (
            <button
              type="button"
              onClick={() => load(page + 1, true)}
              disabled={loadingMore}
              className="mt-4 w-full h-12 bg-gray-800 text-gray-200 font-medium rounded-2xl border border-gray-700 active:bg-gray-700 transition-colors disabled:opacity-50 min-h-[48px]"
            >
              {loadingMore ? 'Caricamento...' : `Carica altri (${total - data.length} rimanenti)`}
            </button>
          )}
        </>
      )}
    </div>
  );
}