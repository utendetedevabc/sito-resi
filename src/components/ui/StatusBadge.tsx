interface Props {
  stato: string;
}

const MAP: Record<string, string> = {
  in_attesa: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  approvato: 'bg-green-500/20 text-green-400 border-green-500/30',
  rifiutato: 'bg-red-500/20 text-red-400 border-red-500/30',
  spedito: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  completato: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  annullato: 'bg-gray-600/20 text-gray-400 border-gray-600/30',
  ricevuto: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  in_lavorazione: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

const LABELS: Record<string, string> = {
  in_attesa: 'In attesa',
  approvato: 'Approvato',
  rifiutato: 'Rifiutato',
  spedito: 'Spedito',
  completato: 'Completato',
  annullato: 'Annullato',
  ricevuto: 'Ricevuto',
  in_lavorazione: 'In lavorazione',
};

export default function StatusBadge({ stato }: Props) {
  const className = MAP[stato] || 'bg-gray-500/20 text-gray-300 border-gray-500/30';
  const label = LABELS[stato] || stato;

  return (
    <span
      role="status"
      aria-label={`Stato: ${label}`}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${className}`}
    >
      {label}
    </span>
  );
}
