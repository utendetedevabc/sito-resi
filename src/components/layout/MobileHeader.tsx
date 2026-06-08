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
    <header className="sticky top-0 z-40 bg-gray-950/95 backdrop-blur-lg" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto">
        {showBack && (
          <button
            onClick={() => (backHref ? router.push(backHref) : router.back())}
            className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-xl active:bg-gray-800 transition-colors"
            aria-label="Indietro"
          >
            <ArrowLeftIcon className="w-6 h-6 text-gray-200" aria-hidden="true" />
          </button>
        )}
        <h1 className="text-lg font-semibold text-white flex-1 truncate">{title}</h1>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
