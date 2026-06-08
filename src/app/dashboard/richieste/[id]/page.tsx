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
  bda_hash: string | null;
  motivo_reso: string;
  note: string | null;
  prodotti: string;
  stato: string;
  note_venditore: string | null;
  data_approvazione: string | null;
  created_at: string;
  venditore_nome?: string | null;
}

export default function RichiestaDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { addToast } = useToast();
  const uuid = params.id as string;

  const [richiesta, setRichiesta] = useState<RichiestaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAnnulla, setShowAnnulla] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch(`/api/resi/${uuid}`, {
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

  async function handleAnnulla() {
    setSubmitting(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/resi/${uuid}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Errore annullamento');
      addToast('success', 'Richiesta annullata');
      router.push('/dashboard/richieste');
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    } finally {
      setShowAnnulla(false);
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
              <p className="text-xs text-gray-400 mb-0.5">Numero Ordine</p>
              <p className="text-sm font-medium text-gray-100">{richiesta.numero_ordine_esterno}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Motivo</p>
              <p className="text-sm font-medium text-gray-100 capitalize">{richiesta.motivo_reso.replace('_', ' ')}</p>
            </div>
            {richiesta.venditore_nome && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Venditore</p>
                <p className="text-sm font-medium text-gray-100">{richiesta.venditore_nome}</p>
              </div>
            )}
            {richiesta.data_approvazione && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Data decisione</p>
                <p className="text-sm font-medium text-gray-100">
                  {new Date(richiesta.data_approvazione).toLocaleDateString('it-IT')}
                </p>
              </div>
            )}
          </div>

          {richiesta.note && (
            <div className="pt-3 border-t border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Note</p>
              <p className="text-sm text-gray-200 leading-relaxed">{richiesta.note}</p>
            </div>
          )}

          {richiesta.note_venditore && (
            <div className="pt-3 border-t border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Note Venditore</p>
              <p className="text-sm text-gray-200 leading-relaxed">{richiesta.note_venditore}</p>
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
          <button
            onClick={() => setShowAnnulla(true)}
            className="w-full h-12 bg-red-600 text-white font-semibold rounded-2xl active:bg-red-700 transition-colors"
          >
            Annulla richiesta
          </button>
        )}
      </div>

      <ConfirmSheet
        open={showAnnulla}
        title="Conferma annullamento"
        message="Sei sicuro di voler annullare questa richiesta? L'azione non può essere annullata."
        confirmText="Annulla richiesta"
        variant="danger"
        onConfirm={handleAnnulla}
        onCancel={() => setShowAnnulla(false)}
      />
    </div>
  );
}
