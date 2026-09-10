'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

interface MobileHeaderProps {
  title: string;
  showBack?: boolean;
  backHref?: string;
  actions?: React.ReactNode;
}

export default function MobileHeader({ title, showBack = true, backHref, actions }: MobileHeaderProps) {
  const router = useRouter();

  return (
    <header className="bg-gray-950">
      <div className="flex items-center gap-3 py-3">
        {showBack && (
          <button
            onClick={() => (backHref ? router.push(backHref) : router.back())}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-gray-200 hover:bg-gray-800 transition-colors"
            aria-label="Torna indietro"
          >
            <ArrowLeftIcon className="w-6 h-6" aria-hidden="true" />
          </button>
        )}
        <h1 className="text-lg font-semibold text-white flex-1 truncate">{title}</h1>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
