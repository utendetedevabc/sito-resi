'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileHeader from '@/components/layout/MobileHeader';
import { useAuth } from '@/hooks/useAuth';
import { ArrowLeftOnRectangleIcon } from '@heroicons/react/24/outline';

export default function CustomerServiceProfiloPage() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [userData, setUserData] = useState<{ nome: string; email: string; ruolo: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem('access_token');
        if (!token) return;
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const d = await res.json();
          setUserData(d.user);
        }
      } catch {
        // silent
      }
    }
    load();
  }, []);

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  return (
    <div className="min-h-dvh bg-gray-950 pb-8">
      <MobileHeader title="Profilo" showBack={false} />

      <div className="pt-4 space-y-4">
        <div className="card-mobile flex items-center gap-4">
          <div
            className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center text-white text-xl font-bold"
            aria-hidden="true"
          >
            {userData?.nome?.charAt(0).toUpperCase() || user?.nome?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div>
            <p className="text-base font-semibold text-white">{userData?.nome || user?.nome || 'Utente'}</p>
            <p className="text-sm text-gray-400">{userData?.email || user?.email}</p>
            <p className="text-xs text-gray-500 capitalize mt-0.5">
              {(userData?.ruolo || user?.ruolo || '').replace('_', ' ')}
            </p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 min-h-[48px] px-4 bg-gray-800 rounded-2xl active:bg-gray-700 transition-colors text-left text-red-400"
        >
          <ArrowLeftOnRectangleIcon className="w-5 h-5" aria-hidden="true" />
          <span className="text-sm font-medium">Esci</span>
        </button>
      </div>
    </div>
  );
}