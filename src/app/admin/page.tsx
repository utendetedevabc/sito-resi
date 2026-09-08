'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import MobileHeader from '@/components/layout/MobileHeader';
import { ListaSkeleton } from '@/components/ui/SkeletonLoader';

interface Stats {
  users: number;
  resi: number;
  by_stato: Record<string, number>;
  ultimi_30_giorni: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch('/api/admin/stats', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setStats(data);
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
      <MobileHeader title="Dashboard Admin" showBack={false} />

      <div className="pt-4 space-y-6">
        {loading ? (
          <ListaSkeleton count={3} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
                <p className="text-xs text-gray-400 mb-1">Utenti</p>
                <p className="text-2xl font-bold text-white">{stats?.users ?? 0}</p>
              </div>
              <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
                <p className="text-xs text-gray-400 mb-1">Richieste</p>
                <p className="text-2xl font-bold text-white">{stats?.resi ?? 0}</p>
              </div>
              <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700 col-span-2">
                <p className="text-xs text-gray-400 mb-1">Ultimi 30 giorni</p>
                <p className="text-2xl font-bold text-blue-400">{stats?.ultimi_30_giorni ?? 0}</p>
              </div>
            </div>

            <div>
              <h2 className="text-base font-semibold text-gray-200 mb-3">Distribuzione stati</h2>
              {stats?.by_stato && Object.keys(stats.by_stato).length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(stats.by_stato).map(([stato, count]) => (
                    <div key={stato} className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
                      <p className="text-xs text-gray-400 capitalize">{stato.replace('_', ' ')}</p>
                      <p className="text-xl font-bold text-white">{count}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Nessun dato disponibile.</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Link
                href="/admin/utenti"
                className="flex items-center justify-center h-12 bg-blue-600 text-white font-medium rounded-2xl active:bg-blue-700 transition-colors"
              >
                Gestisci utenti
              </Link>
              <Link
                href="/admin/richieste"
                className="flex items-center justify-center h-12 bg-gray-800 text-gray-200 font-medium rounded-2xl active:bg-gray-700 transition-colors border border-gray-700"
              >
                Visualizza richieste
              </Link>
            </div>
            <Link
              href="/admin/storico"
              className="flex items-center justify-center h-12 bg-gray-800 text-gray-200 font-medium rounded-2xl active:bg-gray-700 transition-colors border border-gray-700"
            >
              Storico azioni
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
