'use client';

import { usePathname, useRouter } from 'next/navigation';
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

interface Tab {
  path: string;
  label: string;
  icon: React.ElementType;
  activeIcon: React.ElementType;
}

interface BottomTabBarProps {
  tabs?: Tab[];
}

const defaultTabs: Tab[] = [
  { path: '/dashboard', label: 'Home', icon: HomeIcon, activeIcon: HomeSolid },
  { path: '/dashboard/nuova', label: 'Nuovo', icon: PlusCircleIcon, activeIcon: PlusSolid },
  { path: '/dashboard/richieste', label: 'Richieste', icon: ClipboardDocumentListIcon, activeIcon: ClipboardSolid },
  { path: '/dashboard/profilo', label: 'Profilo', icon: UserCircleIcon, activeIcon: UserSolid },
];

export default function BottomTabBar({ tabs = defaultTabs }: BottomTabBarProps) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900/95 backdrop-blur-lg border-t border-gray-800"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}
      aria-label="Navigazione principale"
    >
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const isActive = pathname === tab.path || pathname.startsWith(tab.path + '/');
          const Icon = isActive ? tab.activeIcon : tab.icon;

          return (
            <button
              key={tab.path}
              onClick={() => router.push(tab.path)}
              className="flex flex-col items-center justify-center min-h-[48px] min-w-[48px] px-3 py-1 rounded-xl transition-colors active:bg-gray-800"
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className={`w-6 h-6 ${isActive ? 'text-blue-500' : 'text-gray-400'}`} aria-hidden="true" />
              <span className={`text-xs mt-1 ${isActive ? 'text-blue-500 font-medium' : 'text-gray-400'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
