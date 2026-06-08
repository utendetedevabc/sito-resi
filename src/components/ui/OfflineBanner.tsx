'use client';

import { useState, useEffect } from 'react';
import { WifiIcon } from '@heroicons/react/24/outline';

export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Non renderizzare nulla finché non è montato sul client (evita hydration mismatch)
  if (!mounted || isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[55] bg-yellow-600 px-4 py-2" style={{ paddingTop: 'env(safe-area-inset-top, 8px)' }}>
      <div className="flex items-center justify-center gap-2 max-w-lg mx-auto">
        <WifiIcon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium text-white">Sei offline — I dati saranno sincronizzati alla riconnessione</span>
      </div>
    </div>
  );
}
