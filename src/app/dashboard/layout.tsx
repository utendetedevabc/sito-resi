'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TopNav from '@/components/layout/TopNav';
import OfflineBanner from '@/components/ui/OfflineBanner';
import { ToastProvider } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';

const EXPECTED_ROLE = 'store_account';
const tabs = [
  { path: '/dashboard', label: 'Home' },
  { path: '/dashboard/nuova', label: 'Nuovo reso' },
  { path: '/dashboard/richieste', label: 'Le mie richieste' },
  { path: '/dashboard/storico', label: 'Storico' },
  { path: '/dashboard/profilo', label: 'Profilo' },
];

function roleHome(r?: string) {
  if (r === 'venditore') return '/venditore';
  if (r === 'customer_service') return '/customer-service';
  if (r === 'admin') return '/admin';
  return '/dashboard';
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, authReady } = useAuth();

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      router.push('/login');
    } else if (user.ruolo !== EXPECTED_ROLE && user.ruolo !== 'admin') {
      router.push(roleHome(user.ruolo));
    }
  }, [authReady, user, router]);

  // Fallback accessibile durante la verifica auth o il redirect:
  // live region annuncia lo stato di caricamento (WCAG 4.1.3).
  if (!authReady || !user || (user.ruolo !== EXPECTED_ROLE && user.ruolo !== 'admin')) {
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