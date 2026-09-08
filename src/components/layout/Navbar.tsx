'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  nome: string;
  ruolo: string;
}

export default function Navbar() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem('access_token');
        if (!token) return;
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch {
        // silent
      }
    }
    load();
  }, []);

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // silent
    }
    localStorage.removeItem('access_token');
    router.push('/login');
  }

  const ruoloLabel = user?.ruolo
    ? { store_account: 'Store', venditore: 'Venditore', admin: 'Admin' }[user.ruolo]
    : '';

  return (
    <nav
      aria-label="Navigazione principale"
      className="sticky top-0 z-40 w-full glass border-b border-white/50 shadow-sm"
    >
      <div className="px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-md">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight text-gradient">Sito Resi</span>
        </div>

        <div className="flex items-center gap-4">
          {user && (
            <>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-100 to-violet-100 flex items-center justify-center text-sm font-semibold text-blue-700">
                  {user.nome.charAt(0).toUpperCase()}
                </div>
                <div className="hidden sm:flex flex-col items-start leading-tight">
                  <span className="text-sm font-semibold text-slate-800">{user.nome}</span>
                  <span className="text-xs text-slate-500 font-medium">{ruoloLabel}</span>
                </div>
              </div>

              <button
                onClick={logout}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-red-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-50"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Esci
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
