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
  prodotti: string;
  stato: string;
  note_venditore: string | null;
  data_approvazione: string | null;
  created_at: string;
  richiedente_nome: string;
  richiedente_azienda: string;
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

  const prodotti = JSON.parse(richiesta.prodotti || '[]');

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

        {/* Prodotti */}
        <div>
          <h2 className="text-base font-semibold text-gray-200 mb-3">Prodotti</h2>
          <div className="space-y-3">
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
          </div>
        </div>

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
