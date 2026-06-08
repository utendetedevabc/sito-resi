'use client';

import { useState, useCallback } from 'react';

export function useWebhook() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [lastAttempt, setLastAttempt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const testWebhook = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setLastAttempt(new Date());

    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/api/venditore/webhook/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore test');
      setStatus('success');
      return data;
    } catch (err: any) {
      setStatus('error');
      setError(err.message);
      return null;
    }
  }, []);

  return { status, lastAttempt, error, testWebhook };
}
