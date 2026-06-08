'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import MobileHeader from '@/components/layout/MobileHeader';
import OfflineBanner from '@/components/ui/OfflineBanner';
import { ToastProvider } from '@/components/ui/Toast';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      window.location.href = '/login';
    }
  }, [router]);

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-gray-950">
        <div className="pt-safe">
          <OfflineBanner />
        </div>

        <MobileHeader title="Admin" showBack={false} />

        <main className="px-4 pb-8 max-w-lg mx-auto">
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
