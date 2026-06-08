'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import RichiestaCard from '@/components/ui/RichiestaCard';
import { ListaSkeleton, StatsSkeleton } from '@/components/ui/SkeletonLoader';
import EmptyState from '@/components/ui/EmptyState';
import MobileHeader from '@/components/layout/MobileHeader';
import { PlusCircleIcon } from '@heroicons/react/24/outline';

interface Richiesta {
  uuid: string;
  numero_ordine_esterno: string;
  stato: string;
  motivo_reso: string;
  created_at: string;
}

interface Stats {
  totali: number;
  in_attesa: number;
  approvate: number;
  rifiutate: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ totali: 0, in_attesa: 0, approvate: 0, rifiutate: 0 });
  const [recenti, setRecenti] = useState<Richiesta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch('/api/resi?per_page=5', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        const items: Richiesta[] = data.data || [];
        setRecenti(items);
        setStats({
          totali: data.total || 0,
          in_attesa: items.filter((r) => r.stato === 'in_attesa').length,
          approvate: items.filter((r) => r.stato === 'approvato').length,
          rifiutate: items.filter((r) => r.stato === 'rifiutato').length,
        });
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

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
              <p className="text-2xl font-bold text-white">{stats.totali}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">In attesa</p>
              <p className="text-2xl font-bold text-yellow-400">{stats.in_attesa}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Approvate</p>
              <p className="text-2xl font-bold text-green-400">{stats.approvate}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Rifiutate</p>
              <p className="text-2xl font-bold text-red-400">{stats.rifiutate}</p>
            </div>
          </div>
        )}

        {/* Azione rapida */}
        <Link
          href="/dashboard/nuova"
          className="flex items-center justify-center gap-2 w-full min-h-[48px] bg-blue-600 text-white font-semibold rounded-2xl active:bg-blue-700 transition-colors"
        >
          <PlusCircleIcon className="w-5 h-5" />
          Nuova Richiesta Reso
        </Link>

        {/* Ultime richieste */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-gray-200">Ultime richieste</h2>
            <Link href="/dashboard/richieste" className="text-sm text-blue-400 active:text-blue-300">
              Vedi tutte
            </Link>
          </div>

          {loading ? (
            <ListaSkeleton count={3} />
          ) : recenti.length === 0 ? (
            <EmptyState
              title="Nessuna richiesta"
              description="Crea la tua prima richiesta di reso."
              action={{ label: 'Nuova richiesta', onClick: () => (window.location.href = '/dashboard/nuova') }}
            />
          ) : (
            <div className="space-y-3">
              {recenti.map((r) => (
                <RichiestaCard key={r.uuid} richiesta={r} href={`/dashboard/richieste/${r.uuid}`} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
