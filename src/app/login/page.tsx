'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { FingerPrintIcon } from '@heroicons/react/24/outline';

function roleHome(r?: string) {
  if (r === 'venditore') return '/venditore';
  if (r === 'customer_service') return '/customer-service';
  if (r === 'admin') return '/admin';
  return '/dashboard';
}

export default function LoginPage() {
  const { login, loginBiometric, user, authReady } = useAuth();
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [csrfToken, setCsrfToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showBiometric, setShowBiometric] = useState(false);

  // Carica CSRF token e mostra eventuale biometria; autofocus sul campo email.
  useEffect(() => {
    fetch('/api/auth/csrf-token')
      .then((r) => r.json())
      .then((d) => setCsrfToken(d.csrf_token))
      .catch(() => setError('Errore caricamento sessione'));

    if (typeof window !== 'undefined' && localStorage.getItem('biometric_enabled') === '1') {
      if ('PublicKeyCredential' in window) {
        setShowBiometric(true);
      }
    }
    // Autofocus sul primo campo (WCAG 3.3.2: identifica il primo input).
    emailRef.current?.focus();
  }, []);

  // Guard "già autenticato": se l'auto-restore ha ripristinato l'utente,
  // manda al home del ruolo invece di mostrare di nuovo il login.
  useEffect(() => {
    if (authReady && user) {
      router.push(roleHome(user.ruolo));
    }
  }, [authReady, user, router]);

  // Su errore, sposta il focus al primo campo invalido (WCAG 3.3.1/4.1.3).
  useEffect(() => {
    if (error) {
      emailRef.current?.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [error]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Fetch SEMPRE un CSRF token fresco prima di ogni tentativo di login.
    // Il token e' single-use (csrfStore.delete dopo l'uso) e in-memory
    // (wiped al restart del dev server). Usare un token cached/consumato
    // (es. dopo un login fallito, o dopo un restart) -> 403 "Token CSRF non valido".
    // cache:'no-store' bypassa eventuali Service Worker stale che servirebbero
    // token vecchi dal telefono.
    let token: string;
    try {
      const r = await fetch('/api/auth/csrf-token', { cache: 'no-store' });
      const d = await r.json();
      token = d.csrf_token;
      setCsrfToken(token);
    } catch {
      setError('Errore caricamento sessione');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, csrf_token: token }),
      });

      let data: any;
      try {
        data = await res.json();
      } catch {
        setError('Risposta non valida dal server');
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(data.error || 'Credenziali non valide');
        setLoading(false);
        return;
      }

      if (!data.access_token) {
        setError('Token mancante nella risposta');
        setLoading(false);
        return;
      }

      localStorage.setItem('access_token', data.access_token);
      login(data.access_token).catch(() => {});

      setEmail('');
      setPassword('');

      // router.push (NO window.location.href full-reload): preserva AuthProvider
      // e lo stato, evita re-read localStorage al reload che causava il loop.
      router.push(roleHome(data.user?.ruolo));
    } catch {
      setError('Errore di connessione al server');
      setLoading(false);
    }
  }

  async function handleBiometric() {
    setLoading(true);
    setError('');
    try {
      const ok = await loginBiometric();
      if (!ok) throw new Error('Autenticazione biometrica fallita');
      router.push('/dashboard');
    } catch {
      setError('Autenticazione biometrica fallita');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-600/25">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Resi</h1>
          <p className="text-gray-400 text-sm mt-1">Accedi per gestire le richieste</p>
        </div>

        {error && (
          <div
            id="login-error"
            role="alert"
            aria-live="assertive"
            className="mb-4 p-3 bg-red-900/30 text-red-300 rounded-xl border border-red-800 text-sm"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
            <input
              ref={emailRef}
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-mobile"
              placeholder="nome@azienda.it"
              aria-invalid={!!error}
              aria-describedby="login-error"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-mobile"
              placeholder="••••••••"
              aria-invalid={!!error}
              aria-describedby="login-error"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-mobile"
          >
            {loading ? 'Accesso in corso...' : 'Accedi'}
          </button>
        </form>

        {showBiometric && (
          <button
            onClick={handleBiometric}
            disabled={loading}
            className="mt-4 w-full h-12 bg-gray-800 text-gray-200 font-medium rounded-xl border border-gray-700 active:bg-gray-700 transition-colors flex items-center justify-center gap-2"
          >
            <FingerPrintIcon className="w-5 h-5" aria-hidden="true" />
            Accedi con biometrico
          </button>
        )}
      </div>
    </div>
  );
}