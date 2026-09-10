'use client';

import { useEffect } from 'react';

// Rimuove Service Worker stale installati quando next-pwa era attivo.
// La PWA è disabilitata in dev (next.config.js), ma i SW già installati sul
// telefono continuano a intercettare le richieste (evidence: "POST
// /api/auth/csrf-token 404" in log — la route è GET-only). Questo componente
// li unregistera al mount, ripulendo la superficie che alimentava il loop.
export default function ServiceWorkerCleanup() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .then((unregistered) => {
        if (unregistered.some(Boolean)) {
          console.info('[SW] service worker stale rimosso');
        }
      })
      .catch(() => {
        // silent
      });
  }, []);
  return null;
}