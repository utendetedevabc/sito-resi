'use client';

interface PaginationProps {
  // Pagina corrente (1-based)
  page: number;
  // Numero totale di risultati (non di pagine)
  total: number;
  // Risultati per pagina (usato per calcolare l'ultima pagina)
  perPage: number;
  // Etichetta contestuale per il nav aria-label (es. "resi da gestire")
  label: string;
  onPageChange: (page: number) => void;
}

// Paginazione accessibile (2026-09-16, richiesta operatori: i resi oltre la
// prima pagina non erano visibili — il server paginava gia' ma la UI no).
// Requisiti tables-specialist: <nav aria-label> con etichetta contestuale,
// bottoni con aria-label, attributo disabled nativo (non solo classe),
// pagina corrente annunciata nel testo + aria-current="page", target >=44px.
export default function Pagination({ page, total, perPage, label, onPageChange }: PaginationProps) {
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  // Nessuna paginazione da mostrare se c'e' una sola pagina.
  if (lastPage <= 1) return null;

  return (
    <nav aria-label={`Paginazione ${label}`} className="pt-2 flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        aria-label="Pagina precedente"
        className="h-11 px-4 bg-gray-800 text-gray-200 rounded-xl disabled:opacity-40 active:bg-gray-700 transition-colors"
      >
        Precedente
      </button>
      <p className="text-sm text-gray-400 text-center min-w-[120px]">
        Pagina <span aria-current="page">{page}</span> di {lastPage}
        <span className="block text-xs text-gray-500">{total} risultati</span>
      </p>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(lastPage, page + 1))}
        disabled={page >= lastPage}
        aria-label="Pagina successiva"
        className="h-11 px-4 bg-gray-800 text-gray-200 rounded-xl disabled:opacity-40 active:bg-gray-700 transition-colors"
      >
        Successiva
      </button>
    </nav>
  );
}