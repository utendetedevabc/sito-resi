'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  HomeIcon,
  PlusCircleIcon,
  ClipboardDocumentListIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeSolid,
  PlusCircleIcon as PlusSolid,
  ClipboardDocumentListIcon as ClipboardSolid,
  UserCircleIcon as UserSolid,
} from '@heroicons/react/24/solid';
import BottomTabBar from '@/components/ui/BottomTabBar';
import OfflineBanner from '@/components/ui/OfflineBanner';
import { ToastProvider } from '@/components/ui/Toast';

const tabs = [
  { path: '/dashboard', label: 'Home', icon: HomeIcon, activeIcon: HomeSolid },
  { path: '/dashboard/nuova', label: 'Nuovo', icon: PlusCircleIcon, activeIcon: PlusSolid },
  { path: '/dashboard/richieste', label: 'Richieste', icon: ClipboardDocumentListIcon, activeIcon: ClipboardSolid },
  { path: '/dashboard/profilo', label: 'Profilo', icon: UserCircleIcon, activeIcon: UserSolid },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
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

        <main className="pb-24 px-4 max-w-lg mx-auto">
          {children}
        </main>

        <BottomTabBar tabs={tabs} />
      </div>
    </ToastProvider>
  );
}
