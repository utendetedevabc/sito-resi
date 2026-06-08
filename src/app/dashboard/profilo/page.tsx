'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileHeader from '@/components/layout/MobileHeader';
import BiometricPrompt from '@/components/ui/BiometricPrompt';
import { useAuth } from '@/hooks/useAuth';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { ArrowLeftOnRectangleIcon, BellIcon, FingerPrintIcon } from '@heroicons/react/24/outline';

export default function ProfiloPage() {
  const router = useRouter();
  const { user, logout, registerBiometric, biometricEnabled } = useAuth();
  const { supported, permission, requestPermission } = usePushNotifications();
  const [showBiometric, setShowBiometric] = useState(false);
  const [userData, setUserData] = useState<{ nome: string; email: string; ruolo: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          setUserData(data.user);
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

  async function handleEnableBiometric() {
    const ok = await registerBiometric();
    if (ok) {
      setShowBiometric(false);
    }
  }

  return (
    <div className="min-h-dvh bg-gray-950 pb-8">
      <MobileHeader title="Profilo" showBack={false} />

      <div className="pt-4 space-y-4">
        {/* Info utente */}
        <div className="card-mobile flex items-center gap-4">
          <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center text-white text-xl font-bold">
            {userData?.nome?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div>
            <p className="text-base font-semibold text-white">{userData?.nome || 'Utente'}</p>
            <p className="text-sm text-gray-400">{userData?.email}</p>
            <p className="text-xs text-gray-500 capitalize mt-0.5">{userData?.ruolo?.replace('_', ' ')}</p>
          </div>
        </div>

        {/* Impostazioni */}
        <div className="space-y-2">
          {typeof window !== 'undefined' && 'PublicKeyCredential' in window && (
            <button
              onClick={() => setShowBiometric(true)}
              className="w-full flex items-center gap-3 min-h-[48px] px-4 bg-gray-800 rounded-2xl active:bg-gray-700 transition-colors text-left"
            >
              <FingerPrintIcon className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-200 flex-1">
                {biometricEnabled ? 'Biometrico attivo' : 'Attiva accesso biometrico'}
              </span>
            </button>
          )}

          {supported && (
            <button
              onClick={async () => {
                const p = await requestPermission();
                if (p === 'granted') {
                  // subscribe handled elsewhere
                }
              }}
              className="w-full flex items-center gap-3 min-h-[48px] px-4 bg-gray-800 rounded-2xl active:bg-gray-700 transition-colors text-left"
            >
              <BellIcon className="w-5 h-5 text-gray-400" />
              <span className="text-sm text-gray-200 flex-1">
                {permission === 'granted' ? 'Notifiche attive' : 'Attiva notifiche push'}
              </span>
            </button>
          )}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 min-h-[48px] px-4 bg-gray-800 rounded-2xl active:bg-gray-700 transition-colors text-left text-red-400"
        >
          <ArrowLeftOnRectangleIcon className="w-5 h-5" />
          <span className="text-sm font-medium">Esci</span>
        </button>
      </div>

      {showBiometric && !biometricEnabled && (
        <BiometricPrompt onEnable={handleEnableBiometric} onSkip={() => setShowBiometric(false)} />
      )}
    </div>
  );
}
