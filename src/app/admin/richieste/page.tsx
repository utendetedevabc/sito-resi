'use client';

import { useEffect, useState } from 'react';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton';

interface Richiesta {
  uuid: string;
  numero_ordine_esterno: string;
  motivo_reso: string;
  stato: string;
  richiedente_nome: string;
  venditore_nome?: string | null;
  created_at: string;
}

export default function AdminRichiestePage() {
  const [data, setData] = useState<Richiesta[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [statoFilter, setStatoFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const token = localStorage.getItem('access_token');
        const params = new URLSearchParams();
        params.set('page', String(page));
        params.set('per_page', String(perPage));
        if (statoFilter) params.set('stato', statoFilter);

        const res = await fetch(`/api/admin/resi?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        setData(json.data || []);
        setTotal(json.total || 0);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [page, statoFilter]);

  const columns = [
    { key: 'numero_ordine_esterno', header: 'Ordine' },
    { key: 'richiedente_nome', header: 'Richiedente' },
    { key: 'venditore_nome', header: 'Venditore', render: (row: Richiesta) => row.venditore_nome || '-' },
    { key: 'motivo_reso', header: 'Motivo' },
    { key: 'stato', header: 'Stato', render: (row: Richiesta) => <StatusBadge stato={row.stato} /> },
    { key: 'created_at', header: 'Data', render: (row: Richiesta) => new Date(row.created_at).toLocaleDateString('it-IT') },
  ];

  return (
    <div>
      <h1>Tutte le richieste</h1>

      <div className="mb-4 flex gap-3 items-center">
        <label htmlFor="stato-filter" className="text-sm font-medium text-gray-700">Filtra per stato:</label>
        <select
          id="stato-filter"
          value={statoFilter}
          onChange={e => { setStatoFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="">Tutti</option>
          <option value="in_attesa">In attesa</option>
          <option value="approvato">Approvato</option>
          <option value="rifiutato">Rifiutato</option>
          <option value="spedito">Spedito</option>
          <option value="completato">Completato</option>
          <option value="annullato">Annullato</option>
        </select>
      </div>

      {loading ? (
        <LoadingSkeleton count={5} />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={r => r.uuid}
          page={page}
          perPage={perPage}
          total={total}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
