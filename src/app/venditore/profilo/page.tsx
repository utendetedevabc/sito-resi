'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileHeader from '@/components/layout/MobileHeader';
import BiometricPrompt from '@/components/ui/BiometricPrompt';
import { useAuth } from '@/hooks/useAuth';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import {
  ArrowLeftOnRectangleIcon,
  BellIcon,
  FingerPrintIcon,
  LinkIcon,
} from '@heroicons/react/24/outline';

export default function VenditoreProfiloPage() {
  const router = useRouter();
  const { user, logout, registerBiometric, biometricEnabled } = useAuth();
  const { supported, permission, requestPermission } = usePushNotifications();
  const [showBiometric, setShowBiometric] = useState(false);
  const [userData, setUserData] = useState<{ nome: string; email: string; ruolo: string; webhook_url?: string | null } | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookMessage, setWebhookMessage] = useState('');
  const [webhookLoading, setWebhookLoading] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          setUserData(data.user);
          setWebhookUrl(data.user?.webhook_url || '');
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
    if (ok) setShowBiometric(false);
  }

  async function handleSaveWebhook(e: React.FormEvent) {
    e.preventDefault();
    setWebhookLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/api/venditore/webhook/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ webhook_url: webhookUrl }),
      });
      if (res.ok) {
        setWebhookMessage('Webhook salvato.');
      } else {
        setWebhookMessage('Errore salvataggio.');
      }
    } catch {
      setWebhookMessage('Errore di connessione.');
    } finally {
      setWebhookLoading(false);
    }
  }

  async function handleTestWebhook() {
    setWebhookLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/api/venditore/webhook/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setWebhookMessage(data.message || (data.error ? 'Errore test.' : 'Test inviato.'));
    } catch {
      setWebhookMessage('Errore di connessione.');
    } finally {
      setWebhookLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-gray-950 pb-8">
      <MobileHeader title="Profilo" showBack={false} />

      <div className="pt-4 space-y-4">
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
                await requestPermission();
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

        <div className="card-mobile space-y-4">
          <div className="flex items-center gap-2">
            <LinkIcon className="w-5 h-5 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-200">Webhook personale</h2>
          </div>

          {webhookMessage && (
            <div
              role="status"
              className={`text-sm p-2 rounded-lg ${
                webhookMessage.includes('salvato') || webhookMessage.includes('inviato')
                  ? 'bg-green-900/30 text-green-300 border border-green-800'
                  : 'bg-red-900/30 text-red-300 border border-red-800'
              }`}
            >
              {webhookMessage}
            </div>
          )}

          <form onSubmit={handleSaveWebhook} className="space-y-3">
            <input
              id="webhook-url"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://tuoserver.it/webhook"
              className="input-mobile"
            />
            <div className="grid grid-cols-2 gap-3">
              <button type="submit" disabled={webhookLoading} className="btn-mobile">
                Salva
              </button>
              <button
                type="button"
                onClick={handleTestWebhook}
                disabled={webhookLoading || !webhookUrl}
                className="h-12 bg-gray-700 text-gray-200 font-medium rounded-2xl active:bg-gray-600 transition-colors disabled:opacity-50"
              >
                Test
              </button>
            </div>
          </form>
        </div>

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
