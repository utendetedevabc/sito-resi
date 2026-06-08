import LoadingSkeleton from './LoadingSkeleton';

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
}

export default function DataTable<T extends Record<string, any>>({
  columns,
  data,
  keyExtractor,
  page,
  perPage,
  total,
  onPageChange,
}: Props<T>) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  if (data.length === 0) {
    return (
      <div role="status" className="text-center py-12 text-gray-500 bg-white rounded-xl shadow border border-gray-100">
        Nessun dato disponibile.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map(row => (
              <tr key={keyExtractor(row)} className="hover:bg-gray-50">
                {columns.map(col => (
                  <td key={col.key} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-6 py-4 flex items-center justify-between border-t border-gray-200">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
          >
            Precedente
          </button>
          <span className="text-sm text-gray-600">
            Pagina {page} di {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
          >
            Successiva
          </button>
        </div>
      )}
    </div>
  );
}
