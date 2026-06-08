'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import MobileHeader from '@/components/layout/MobileHeader';
import RichiestaCard from '@/components/ui/RichiestaCard';
import PullToRefresh from '@/components/ui/PullToRefresh';
import InfiniteScroll from '@/components/ui/InfiniteScroll';
import { ListaSkeleton } from '@/components/ui/SkeletonLoader';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';

interface Richiesta {
  uuid: string;
  numero_ordine_esterno: string;
  motivo_reso: string;
  stato: string;
  data_approvazione: string | null;
  created_at: string;
}

export default function StoricoPage() {
  const [data, setData] = useState<Richiesta[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [statoFilter, setStatoFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const fetchData = useCallback(
    async (pageNum: number, append = false) => {
      if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);
      setError('');

      try {
        const token = localStorage.getItem('access_token');
        const params = new URLSearchParams();
        params.set('page', String(pageNum));
        params.set('per_page', String(perPage));
        if (statoFilter) params.set('stato', statoFilter);

        const res = await fetch(`/api/venditore/richieste?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Errore caricamento');
        const json = await res.json();

        setData((prev) => (append ? [...prev, ...(json.data || [])] : json.data || []));
        setTotal(json.total || 0);
        setPage(pageNum);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [statoFilter, perPage]
  );

  useEffect(() => {
    fetchData(1, false);
  }, [statoFilter, fetchData]);

  const hasMore = data.length < total;

  return (
    <div className="min-h-dvh bg-gray-950">
      <MobileHeader title="Storico" />

      <div className="pt-4">
        <div className="mb-4">
          <label htmlFor="stato-filter" className="sr-only">Filtra per stato</label>
          <select
            id="stato-filter"
            value={statoFilter}
            onChange={(e) => {
              setStatoFilter(e.target.value);
              setPage(1);
            }}
            className="input-mobile"
          >
            <option value="">Tutti gli stati</option>
            <option value="approvato">Approvato</option>
            <option value="rifiutato">Rifiutato</option>
            <option value="spedito">Spedito</option>
            <option value="completato">Completato</option>
          </select>
        </div>

        {loading ? (
          <ListaSkeleton count={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => fetchData(1, false)} />
        ) : data.length === 0 ? (
          <EmptyState title="Nessuna richiesta" description="Non ci sono richieste nello storico." />
        ) : (
          <PullToRefresh onRefresh={() => fetchData(1, false)}>
            <InfiniteScroll
              onLoadMore={() => fetchData(page + 1, true)}
              hasMore={hasMore}
              loading={loadingMore}
            >
              <div className="space-y-3">
                {data.map((r) => (
                  <Link key={r.uuid} href={`/venditore/richieste/${r.uuid}`} className="block">
                    <RichiestaCard richiesta={r} />
                  </Link>
                ))}
              </div>
            </InfiniteScroll>
          </PullToRefresh>
        )}
      </div>
    </div>
  );
}
