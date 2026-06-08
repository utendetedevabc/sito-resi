'use client';

import { useEffect, useState } from 'react';

export default function ImpostazioniPage() {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        setWebhookUrl(data.user?.webhook_url || '');
      } catch {
        // silent
      }
    }
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/api/venditore/webhook/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ webhook_url: webhookUrl }),
      });
      if (res.ok) {
        setMessage('Webhook salvato con successo.');
      } else {
        setMessage('Errore durante il salvataggio.');
      }
    } catch {
      setMessage('Errore di connessione.');
    } finally {
      setLoading(false);
    }
  }

  async function handleTest() {
    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/api/venditore/webhook/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setMessage(data.message || (data.error ? 'Errore test webhook.' : 'Test inviato.'));
    } catch {
      setMessage('Errore di connessione.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>Impostazioni</h1>

      <div className="bg-white p-6 rounded-xl shadow border border-gray-100 max-w-xl">
        <h2 className="text-lg font-semibold mb-4">Webhook personale</h2>

        {message && (
          <div role="status" className={`mb-4 p-3 rounded-lg border ${message.includes('successo') || message.includes('inviato') ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
            {message}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="webhook-url" className="block text-sm font-medium text-gray-700 mb-1">URL Webhook</label>
            <input
              id="webhook-url"
              type="url"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://tuoserver.it/webhook"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
            >
              Salva
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={loading || !webhookUrl}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition disabled:opacity-50"
            >
              Test
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
