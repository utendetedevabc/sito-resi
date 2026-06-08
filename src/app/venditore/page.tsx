'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import RichiestaCard from '@/components/ui/RichiestaCard';
import SwipeableCard from '@/components/ui/SwipeableCard';
import MobileHeader from '@/components/layout/MobileHeader';
import { ListaSkeleton, StatsSkeleton } from '@/components/ui/SkeletonLoader';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';

interface Stats {
  total: number;
  by_stato: Record<string, number>;
  oggi: Record<string, number>;
}

interface Richiesta {
  uuid: string;
  numero_ordine_esterno: string;
  stato: string;
  motivo_reso: string;
  created_at: string;
}

export default function VenditoreDashboardPage() {
  const { addToast } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [inAttesa, setInAttesa] = useState<Richiesta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem('access_token');
        const [statsRes, richiesteRes] = await Promise.all([
          fetch('/api/venditore/stats', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/venditore/richieste?stato=in_attesa&per_page=10', {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        const statsData = await statsRes.json();
        const richiesteData = await richiesteRes.json();
        setStats(statsData);
        setInAttesa(richiesteData.data || []);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleApprove(uuid: string) {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/venditore/richieste/${uuid}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ stato: 'approvato', csrf_token: 'placeholder' }),
      });
      if (!res.ok) throw new Error('Errore');
      setInAttesa((prev) => prev.filter((r) => r.uuid !== uuid));
      addToast('success', 'Richiesta approvata');
    } catch {
      addToast('error', 'Errore approvazione');
    }
  }

  async function handleReject(uuid: string) {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/venditore/richieste/${uuid}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ stato: 'rifiutato', csrf_token: 'placeholder' }),
      });
      if (!res.ok) throw new Error('Errore');
      setInAttesa((prev) => prev.filter((r) => r.uuid !== uuid));
      addToast('success', 'Richiesta rifiutata');
    } catch {
      addToast('error', 'Errore rifiuto');
    }
  }

  return (
    <div className="min-h-dvh bg-gray-950">
      <MobileHeader title="Dashboard" showBack={false} />

      <div className="pt-4 space-y-6">
        {/* Stats */}
        {loading ? (
          <StatsSkeleton />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Richieste totali</p>
              <p className="text-2xl font-bold text-white">{stats?.total ?? 0}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">In attesa</p>
              <p className="text-2xl font-bold text-yellow-400">{stats?.by_stato?.in_attesa ?? 0}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Approvate oggi</p>
              <p className="text-2xl font-bold text-green-400">{stats?.oggi?.approvato ?? 0}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Rifiutate oggi</p>
              <p className="text-2xl font-bold text-red-400">{stats?.oggi?.rifiutato ?? 0}</p>
            </div>
          </div>
        )}

        {/* In attesa */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-200">Da gestire</h2>
            <Link href="/venditore/richieste" className="text-sm text-blue-400 active:text-blue-300">
              Vedi tutte
            </Link>
          </div>

          {loading ? (
            <ListaSkeleton count={3} />
          ) : inAttesa.length === 0 ? (
            <EmptyState
              title="Nessuna richiesta"
              description="Non ci sono richieste in attesa di gestione."
            />
          ) : (
            <div className="space-y-3">
              {inAttesa.map((r) => (
                <SwipeableCard
                  key={r.uuid}
                  onApprove={() => handleApprove(r.uuid)}
                  onReject={() => handleReject(r.uuid)}
                >
                  <Link href={`/venditore/richieste/${r.uuid}`} className="block">
                    <RichiestaCard richiesta={r} />
                  </Link>
                </SwipeableCard>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
