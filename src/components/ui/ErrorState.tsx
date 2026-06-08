import { ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export default function ErrorState({ message = 'Si è verificato un errore', onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-20 h-20 bg-red-900/20 rounded-full flex items-center justify-center mb-6">
        <ExclamationTriangleIcon className="w-10 h-10 text-red-500" aria-hidden="true" />
      </div>
      <h3 className="text-lg font-semibold text-gray-200 mb-2">Errore</h3>
      <p className="text-sm text-gray-500 max-w-xs mb-6 leading-relaxed">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 min-h-[48px] px-6 bg-gray-800 text-gray-200 font-medium rounded-2xl active:bg-gray-700 transition-colors"
        >
          <ArrowPathIcon className="w-5 h-5" aria-hidden="true" />
          <span>Riprova</span>
        </button>
      )}
    </div>
  );
}
