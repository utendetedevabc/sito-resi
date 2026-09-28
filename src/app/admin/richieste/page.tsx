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
  // 2026-09-22 P3: colonna Corriere (l'API admin restituisce già r.*).
  corriere?: string | null;
  corriere_nome?: string | null;
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
  // 2026-09-28 P3: ricerca per gruppo PV (clit — codice o nome). `clitInput` è
  // il campo del form, `clitApplied` il valore inviato all'API: la fetch parte
  // SOLO al submit esplicito (no fetch per keystroke).
  const [clitInput, setClitInput] = useState('');
  const [clitApplied, setClitApplied] = useState('');
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
        if (clitApplied.trim()) params.set('clit', clitApplied.trim());

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
  }, [page, statoFilter, clitApplied]);

  const columns = [
    { key: 'numero_ordine_esterno', header: 'Ordine' },
    { key: 'richiedente_nome', header: 'Richiedente' },
    { key: 'venditore_nome', header: 'Venditore', render: (row: Richiesta) => row.venditore_nome || '-' },
    { key: 'motivo_reso', header: 'Motivo' },
    // 2026-09-22 P3: corriere subito individuabile anche in admin (testo, non solo colore).
    { key: 'corriere', header: 'Corriere', render: (row: Richiesta) => row.corriere === 'ALTRI' ? (row.corriere_nome || 'ALTRI') : (row.corriere || '-') },
    { key: 'stato', header: 'Stato', render: (row: Richiesta) => <StatusBadge stato={row.stato} /> },
    { key: 'created_at', header: 'Data', render: (row: Richiesta) => new Date(row.created_at).toLocaleDateString('it-IT') },
  ];

  return (
    <div>
      <h1>Tutte le richieste</h1>

      {/* 2026-09-28 P3: prima ricerca testuale della pagina — form con submit
          esplicito (Cerca), label htmlFor, tema CHIARO della pagina. Il reset
          riporta il filtro a "". */}
      <form
        className="mb-4 flex flex-wrap gap-3 items-end"
        onSubmit={(e) => { e.preventDefault(); setPage(1); setClitApplied(clitInput); }}
        onReset={() => { setClitInput(''); setClitApplied(''); setPage(1); }}
      >
        <div>
          <label htmlFor="stato-filter" className="block text-sm font-medium text-gray-700 mb-1">Filtra per stato:</label>
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
        <div>
          <label htmlFor="clit-filter" className="block text-sm font-medium text-gray-700 mb-1">Gruppo (clit):</label>
          <input
            id="clit-filter"
            type="text"
            autoComplete="off"
            value={clitInput}
            onChange={(e) => setClitInput(e.target.value)}
            placeholder="es. 1042 o SEVEN"
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg active:bg-blue-700">
          Cerca
        </button>
        <button type="reset" className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg active:bg-gray-100">
          Reset
        </button>
      </form>

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
