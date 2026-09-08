'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

function roleHome(r?: string) {
  if (r === 'venditore') return '/venditore';
  if (r === 'customer_service') return '/customer-service';
  if (r === 'admin') return '/admin';
  return '/dashboard';
}

// Root role-aware: prima redirigeva incondizionatamente a /login, così un
// utente già autenticato che apre / (bookmark/PWA) rivedeva il login. Ora:
// se authReady && user -> home del ruolo, altrimenti /login.
export default function HomePage() {
  const router = useRouter();
  const { user, authReady } = useAuth();

  useEffect(() => {
    if (!authReady) return;
    router.push(user ? roleHome(user.ruolo) : '/login');
  }, [authReady, user, router]);

  return (
    <div
      className="min-h-dvh bg-gray-950 flex items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <p className="text-gray-400">Caricamento…</p>
    </div>
  );
}