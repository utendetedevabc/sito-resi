'use client';

import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';

interface User {
  id: number;
  email: string;
  ruolo: string;
  nome: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  authReady: boolean; // true dopo il primo check/restore (per i layout gate)
  login: (token: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<string | null>;
  isAuthenticated: boolean;
  isRole: (role: string) => boolean;
  biometricEnabled: boolean;
  registerBiometric: () => Promise<boolean>;
  loginBiometric: () => Promise<boolean>;
}

const AuthContext = createContext<AuthState | null>(null);

// Endpoint la cui gestione 401 è delegata al codice stesso: l'interceptor NON
// deve intercettarli, altrimenti refresh() -> fetch wrappato -> 401 -> refresh()
// -> ricorsione infinita -> stack overflow -> pagina ricaricata -> loop login.
const AUTH_ENDPOINTS = /\/api\/auth\/(refresh|login|csrf-token|logout|webauthn)/;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  // Riferimento al fetch NATIVO (prima del wrap): refresh() lo usa per non
  // ricadere nell'interceptor. refreshPromiseRef = singleton anti re-entrancy.
  const originalFetchRef = useRef<typeof window.fetch | null>(null);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBiometricEnabled(localStorage.getItem('biometric_enabled') === '1');
    }
  }, []);

  const refresh = useCallback(async () => {
    // Singleton: se c'è già una refresh in flight, riusa la stessa promise
    // (evita N refresh parallele su N risposte 401 simultanee).
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const nativeFetch = originalFetchRef.current || window.fetch.bind(window);
    const p = (async () => {
      try {
        const res = await nativeFetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Refresh failed');
        const data = await res.json();
        setAccessToken(data.access_token);
        if (typeof window !== 'undefined' && data.access_token) {
          localStorage.setItem('access_token', data.access_token);
        }
        return data.access_token as string;
      } catch {
        // refresh fallito (cookie assente/scaduto — normale su mobile HTTP).
        // Pulisce lo stato ma NON redirige qui: lo fa l'interceptor una volta.
        setAccessToken(null);
        setUser(null);
        if (typeof window !== 'undefined') localStorage.removeItem('access_token');
        return null;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();
    refreshPromiseRef.current = p;
    return p;
  }, []);

  const login = useCallback(async (token: string) => {
    setAccessToken(token);
    try {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        return true;
      }
      // Token non valido: NON innescare refresh qui (evita ricorsione).
      // L'interceptor gestirà un'eventuale refresh singola.
      return false;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // silent
    }
    setAccessToken(null);
    setUser(null);
    localStorage.removeItem('access_token');
    localStorage.removeItem('biometric_enabled');
    setBiometricEnabled(false);
  }, []);

  // Auto-restore session: al mount, se c'è un token, verifica con /me.
  // Se valido -> setUser. Se stale -> rimuove il token (NO loop, NO refresh in catch).
  // authReady diventa true solo dopo questo primo check (per i layout gate).
  useEffect(() => {
    let cancelled = false;
    const stored = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    if (stored) {
      login(stored).then((ok) => {
        if (cancelled) return;
        if (!ok) localStorage.removeItem('access_token');
        setAuthReady(true);
      });
    } else {
      setAuthReady(true);
    }
    return () => {
      cancelled = true;
    };
  }, [login]);

  // Auto-refresh on 401 (interceptor) — ANTI-RICORSIONE:
  // 1. cattura originalFetch PRIMA di riassegnare window.fetch
  // 2. skip endpoint auth (si gestiscono da soli)
  // 3. guard re-entrancy via refreshPromiseRef (singleton in refresh)
  // 4. su refresh fallita: clear token + redirect /login UNA volta (se non su /login)
  useEffect(() => {
    const originalFetch = window.fetch;
    originalFetchRef.current = originalFetch;
    let redirected = false;

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await originalFetch(...args);
      if (res.status !== 401) return res;

      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || '';
      // Non intercettare gli endpoint auth (si gestiscono da soli)
      if (AUTH_ENDPOINTS.test(url)) return res;

      const newToken = await refresh();
      if (newToken) {
        const [req, init] = args;
        const newInit = {
          ...init,
          headers: { ...(init?.headers || {}), Authorization: `Bearer ${newToken}` },
        };
        return originalFetch(req, newInit);
      }

      // refresh fallita: sessione scaduta. Redirect UNA volta a /login.
      if (typeof window !== 'undefined' && !redirected) {
        redirected = true;
        localStorage.removeItem('access_token');
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
      }
      return res;
    };

    return () => {
      window.fetch = originalFetch;
      originalFetchRef.current = null;
    };
  }, [refresh]);

  // WebAuthn helpers
  const registerBiometric = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/webauthn/register-begin', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to begin registration');
      const options = await res.json();

      options.user.id = base64urlToBuffer(options.user.id);
      options.challenge = base64urlToBuffer(options.challenge);
      if (options.excludeCredentials) {
        options.excludeCredentials = options.excludeCredentials.map((c: any) => ({
          ...c,
          id: base64urlToBuffer(c.id),
        }));
      }

      const credential = await navigator.credentials.create({ publicKey: options });
      if (!credential) throw new Error('No credential');

      const finishRes = await fetch('/api/auth/webauthn/register-finish', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: credential.id,
          rawId: bufferToBase64url((credential as any).rawId),
          type: credential.type,
          response: {
            clientDataJSON: bufferToBase64url((credential as any).response.clientDataJSON),
            attestationObject: bufferToBase64url((credential as any).response.attestationObject),
          },
        }),
      });

      if (!finishRes.ok) throw new Error('Registration finish failed');
      localStorage.setItem('biometric_enabled', '1');
      setBiometricEnabled(true);
      return true;
    } catch {
      return false;
    }
  }, []);

  const loginBiometric = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/webauthn/login-begin', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to begin login');
      const options = await res.json();

      options.challenge = base64urlToBuffer(options.challenge);
      if (options.allowCredentials) {
        options.allowCredentials = options.allowCredentials.map((c: any) => ({
          ...c,
          id: base64urlToBuffer(c.id),
        }));
      }

      const assertion = await navigator.credentials.get({ publicKey: options });
      if (!assertion) throw new Error('No assertion');

      const finishRes = await fetch('/api/auth/webauthn/login-finish', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: assertion.id,
          rawId: bufferToBase64url((assertion as any).rawId),
          type: assertion.type,
          response: {
            clientDataJSON: bufferToBase64url((assertion as any).response.clientDataJSON),
            authenticatorData: bufferToBase64url((assertion as any).response.authenticatorData),
            signature: bufferToBase64url((assertion as any).response.signature),
            userHandle: bufferToBase64url((assertion as any).response.userHandle),
          },
        }),
      });

      if (!finishRes.ok) throw new Error('Login finish failed');
      const data = await finishRes.json();
      await login(data.access_token);
      return true;
    } catch {
      return false;
    }
  }, [login]);

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        authReady,
        login,
        logout,
        refresh,
        isAuthenticated: !!user,
        isRole: (role) => user?.ruolo === role,
        biometricEnabled,
        registerBiometric,
        loginBiometric,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(base64);
  const buffer = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < bin.length; i++) {
    view[i] = bin.charCodeAt(i);
  }
  return buffer;
}

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}