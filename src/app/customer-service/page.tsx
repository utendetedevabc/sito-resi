'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import MobileHeader from '@/components/layout/MobileHeader';
import { ClipboardDocumentListIcon } from '@heroicons/react/24/outline';

interface Stats {
  in_revisione: number;
  approvati: number;
  rifiutati: number;
}

export default function CustomerServicePage() {
  const [stats, setStats] = useState<Stats>({ in_revisione: 0, approvati: 0, rifiutati: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch('/api/customer-service/stats', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setStats({
          in_revisione: data.by_stato['in_revisione'] || 0,
          approvati: data.by_stato['approvato'] || 0,
          rifiutati: data.by_stato['rifiutato'] || 0,
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
      <MobileHeader title="Customer Service" showBack={false} />

      <div className="pt-4 space-y-6">
        {/* Stats */}
        {loading ? (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-800 rounded-2xl p-4 border border-gray-700 animate-pulse">
                <div className="h-8 bg-gray-700 rounded mb-2"></div>
                <div className="h-4 bg-gray-700 rounded"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">In revisione</p>
              <p className="text-2xl font-bold text-orange-400">{stats.in_revisione}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Approvati</p>
              <p className="text-2xl font-bold text-green-400">{stats.approvati}</p>
            </div>
            <div className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
              <p className="text-xs text-gray-400 mb-1">Rifiutati</p>
              <p className="text-2xl font-bold text-red-400">{stats.rifiutati}</p>
            </div>
          </div>
        )}

        {/* Azione rapida */}
        <Link
          href="/customer-service/richieste"
          className="flex items-center justify-center gap-2 w-full min-h-[48px] bg-blue-600 text-white font-semibold rounded-2xl active:bg-blue-700 transition-colors"
        >
          <ClipboardDocumentListIcon className="w-5 h-5" />
          Gestisci richieste
        </Link>
      </div>
    </div>
  );
}
