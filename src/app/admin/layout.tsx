'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TopNav from '@/components/layout/TopNav';
import OfflineBanner from '@/components/ui/OfflineBanner';
import { ToastProvider } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';

const tabs = [
  { path: '/admin', label: 'Home' },
  { path: '/admin/utenti', label: 'Utenti' },
  { path: '/admin/richieste', label: 'Richieste' },
  { path: '/admin/storico', label: 'Storico' },
];

function roleHome(r?: string) {
  if (r === 'venditore') return '/venditore';
  if (r === 'customer_service') return '/customer-service';
  if (r === 'admin') return '/admin';
  return '/dashboard';
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, authReady } = useAuth();

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      router.push('/login');
    } else if (user.ruolo !== 'admin') {
      // Sezione admin-only: gli altri ruoli vanno al proprio home.
      router.push(roleHome(user.ruolo));
    }
  }, [authReady, user, router]);

  if (!authReady || !user || user.ruolo !== 'admin') {
    return (
      <div className="min-h-dvh bg-gray-950 flex items-center justify-center" role="status" aria-live="polite">
        <p className="text-gray-400">Caricamento…</p>
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-gray-950">
        <TopNav tabs={tabs} />
        <div className="pt-safe">
          <OfflineBanner />
        </div>

        <main className="px-4 py-6 max-w-3xl mx-auto">
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}