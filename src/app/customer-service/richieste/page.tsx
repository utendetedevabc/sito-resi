'use client';

import { useEffect, useState, useCallback } from 'react';
import MobileHeader from '@/components/layout/MobileHeader';
import { ListaSkeleton } from '@/components/ui/SkeletonLoader';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { CheckCircleIcon, XCircleIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';

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
}

export default function CSR RichiestePage() {
  const { addToast } = useToast();
  const [data, setData] = useState<Richiesta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [azione, setAzione] = useState<{ uuid: string; tipo: 'approvato' | 'rifiutato'; note: string }> | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/api/customer-service/richieste', {
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
    fetchData();
  }, [fetchData]);

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
      addToast('success', tipo === 'approvato' ? 'Richiesta approvata' : 'Richiesta rifiutata');
      setAzione(null);
      fetchData();
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
        {error && (
          <div role="alert" className="mb-4 p-3 bg-red-900/30 text-red-300 rounded-xl border border-red-800 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <ListaSkeleton count={5} />
        ) : data.length === 0 ? (
          <EmptyState
            title="Nessuna richiesta"
            description="Non ci sono richieste in attesa di gestione."
          />
        ) : (
          <div className="space-y-3">
            {data.map((r) => (
              <div key={r.uuid} className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
                <div
                  onClick={() => setExpanded(expanded === r.uuid ? null : r.uuid)}
                  className="flex items-center justify-between p-4 cursor-pointer active:bg-gray-750 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {expanded === r.uuid ? (
                      <ChevronUpIcon className="w-5 h-5 text-gray-400" aria-hidden />
                    ) : (
                      <ChevronDownIcon className="w-5 h-5 text-gray-400" aria-hidden />
                    )}
                    <div>
                      <p className="font-medium text-white text-sm">{r.numero_ordine_esterno}</p>
                      <p className="text-xs text-gray-400">{r.richiedente_nome} — {r.richiedente_azienda}</p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-1 rounded-full">
                    In revisione
                  </span>
                </div>

                {expanded === r.uuid && (
                  <div className="px-4 pb-4 border-t border-gray-700">
                    <div className="py-3 space-y-2 text-sm text-gray-300">
                      <p><span className="text-gray-500">Motivo:</span> {r.motivo_reso.replace('_', ' ')}</p>
                      <p><span className="text-gray-500">Venditore:</span> {r.venditore_nome || '—'}</p>
                      {r.note && <p><span className="text-gray-500">Note:</span> {r.note}</p>}
                      {r.note_venditore && <p><span className="text-gray-500">Note venditore:</span> {r.note_venditore}</p>}
                      <p><span className="text-gray-500">Data approvazione venditore:</span> {new Date(r.data_approvazione).toLocaleString('it-IT')}</p>
                    </div>

                    {azione?.uuid === r.uuid && (
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
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
