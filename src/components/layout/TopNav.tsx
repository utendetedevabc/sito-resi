'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bars3Icon, XMarkIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';

interface Tab {
  path: string;
  label: string;
}

interface TopNavProps {
  tabs: Tab[];
}

interface User {
  nome: string;
  ruolo: string;
}

const RUOLO_LABEL: Record<string, string> = {
  store_account: 'Promoter',
  venditore: 'Responsabile',
  admin: 'Admin',
  customer_service: 'Interno',
};

export default function TopNav({ tabs }: TopNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstLinkRef = useRef<HTMLAnchorElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = localStorage.getItem('access_token');
        if (!token) return;
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setUser(data.user);
        }
      } catch {
        // silent
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Chiudi il menu mobile al cambio rotta
  useEffect(() => { setOpen(false); }, [pathname]);

  // Escape chiude e ripristina il focus sul bottone; click esterno chiude
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointer(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  // Apri il menu -> sposta il focus sul primo link (accessibilità tastiera)
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => firstLinkRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // silent
    }
    localStorage.removeItem('access_token');
    router.push('/login');
  }

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  return (
    <nav
      aria-label="Navigazione principale"
      className="sticky top-0 z-40 w-full bg-gray-950/95 backdrop-blur-lg border-b border-gray-800"
    >
      <div className="mx-auto max-w-4xl px-4">
        <div className="flex h-14 items-center justify-between gap-3">
          {/* Brand */}
          <Link
            href={tabs[0]?.path || '/'}
            className="flex items-center gap-2.5 rounded-lg min-h-[44px] px-1 py-1"
            aria-label="Home — Resi ABC"
          >
            <span
              aria-hidden="true"
              className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-md"
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </span>
            <span className="text-base font-bold tracking-tight text-white">Resi ABC</span>
          </Link>

          {/* Nav desktop (sm+) */}
          <div className="hidden sm:flex items-center gap-1">
            {tabs.map((tab) => (
              <Link
                key={tab.path}
                href={tab.path}
                aria-current={isActive(tab.path) ? 'page' : undefined}
                className={`min-h-[44px] flex items-center px-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive(tab.path)
                    ? 'text-white bg-gray-800'
                    : 'text-gray-300 hover:text-white hover:bg-gray-800/60'
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>

          {/* Utente + logout (desktop) */}
          {user && (
            <div className="hidden sm:flex items-center gap-3 ml-2">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-100 to-violet-100 flex items-center justify-center text-sm font-semibold text-blue-700"
                >
                  {user.nome.charAt(0).toUpperCase()}
                </span>
                <span className="text-sm text-gray-200 font-medium max-w-[12ch] truncate">{user.nome}</span>
                <span className="text-xs text-gray-400">{RUOLO_LABEL[user.ruolo] || user.ruolo}</span>
              </div>
              <button
                onClick={logout}
                className="min-h-[44px] flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-red-400 transition-colors px-3 rounded-lg hover:bg-gray-800/60"
              >
                <ArrowRightOnRectangleIcon className="w-5 h-5" aria-hidden="true" />
                Esci
              </button>
            </div>
          )}

          {/* Hamburger (mobile) */}
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="topnav-mobile-panel"
            aria-label={open ? 'Chiudi menu di navigazione' : 'Apri menu di navigazione'}
            className="sm:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-200 hover:bg-gray-800"
          >
            {open ? <XMarkIcon className="w-6 h-6" aria-hidden="true" /> : <Bars3Icon className="w-6 h-6" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Pannello mobile */}
      {open && (
        <div
          ref={panelRef}
          id="topnav-mobile-panel"
          className="sm:hidden border-t border-gray-800 bg-gray-950"
        >
          <ul className="mx-auto max-w-4xl px-2 py-2 space-y-1">
            {tabs.map((tab, i) => (
              <li key={tab.path}>
                <Link
                  ref={i === 0 ? firstLinkRef : undefined}
                  href={tab.path}
                  aria-current={isActive(tab.path) ? 'page' : undefined}
                  className={`block min-h-[44px] px-3 py-2.5 rounded-lg text-base font-medium ${
                    isActive(tab.path) ? 'text-white bg-gray-800' : 'text-gray-200 hover:bg-gray-800/60'
                  }`}
                >
                  {tab.label}
                </Link>
              </li>
            ))}
            {user && (
              <li className="pt-2 mt-2 border-t border-gray-800">
                <div className="flex items-center gap-2 px-3 py-2" aria-hidden="true">
                  <span className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-100 to-violet-100 flex items-center justify-center text-sm font-semibold text-blue-700">
                    {user.nome.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-sm text-gray-200 font-medium truncate">{user.nome}</span>
                  <span className="text-xs text-gray-400">{RUOLO_LABEL[user.ruolo] || user.ruolo}</span>
                </div>
                <button
                  onClick={logout}
                  className="w-full min-h-[44px] flex items-center gap-2 px-3 py-2.5 rounded-lg text-base font-medium text-red-400 hover:bg-gray-800/60"
                >
                  <ArrowRightOnRectangleIcon className="w-5 h-5" aria-hidden="true" />
                  Esci
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </nav>
  );
}