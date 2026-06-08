'use client';

import { WifiIcon } from '@heroicons/react/24/outline';

export default function OfflinePage() {
  return (
    <div className="min-h-dvh bg-gray-950 flex flex-col items-center justify-center px-6 text-center pt-safe pb-safe">
      <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center mb-8">
        <WifiIcon className="w-12 h-12 text-gray-500" />
      </div>
      <h1 className="text-2xl font-bold mb-3">Sei offline</h1>
      <p className="text-gray-400 max-w-xs mb-8 text-sm leading-relaxed">
        Non preoccuparti! Puoi continuare a consultare le richieste già caricate.
        Le modifiche saranno sincronizzate quando tornerai online.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="btn-mobile max-w-xs"
      >
        Riprova
      </button>
    </div>
  );
}
