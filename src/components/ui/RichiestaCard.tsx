import Link from 'next/link';
import StatusBadge from './StatusBadge';

interface Props {
  richiesta: {
    uuid: string;
    numero_ordine_esterno: string;
    stato: string;
    motivo_reso?: string;
    created_at: string;
  };
  href?: string;
}

export default function RichiestaCard({ richiesta, href }: Props) {
  const content = (
    <article className="bg-gray-800 rounded-2xl p-4 border border-gray-700 active:bg-gray-750 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-gray-100 text-sm truncate pr-3">{richiesta.numero_ordine_esterno}</span>
        <StatusBadge stato={richiesta.stato} />
      </div>
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-400">
          {richiesta.motivo_reso && (
            <span className="capitalize mr-2">{richiesta.motivo_reso.replace('_', ' ')}</span>
          )}
          <span>{new Date(richiesta.created_at).toLocaleDateString('it-IT')}</span>
        </div>
      </div>
    </article>
  );

  if (href) {
    return (
      <Link href={href} className="block" aria-label={`Richiesta ${richiesta.numero_ordine_esterno}, stato ${richiesta.stato}`}>
        {content}
      </Link>
    );
  }

  return content;
}
