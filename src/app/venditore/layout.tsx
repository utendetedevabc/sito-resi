'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  HomeIcon,
  ClipboardDocumentListIcon,
  ArchiveBoxIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeSolid,
  ClipboardDocumentListIcon as ClipboardSolid,
  ArchiveBoxIcon as ArchiveSolid,
  UserCircleIcon as UserSolid,
} from '@heroicons/react/24/solid';
import BottomTabBar from '@/components/ui/BottomTabBar';
import OfflineBanner from '@/components/ui/OfflineBanner';
import { ToastProvider } from '@/components/ui/Toast';

const tabs = [
  { path: '/venditore', label: 'Home', icon: HomeIcon, activeIcon: HomeSolid },
  { path: '/venditore/richieste', label: 'Richieste', icon: ClipboardDocumentListIcon, activeIcon: ClipboardSolid },
  { path: '/venditore/storico', label: 'Storico', icon: ArchiveBoxIcon, activeIcon: ArchiveSolid },
  { path: '/venditore/profilo', label: 'Profilo', icon: UserCircleIcon, activeIcon: UserSolid },
];

export default function VenditoreLayout({ children }: { children: React.ReactNode }) {
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
