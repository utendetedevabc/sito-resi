'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';

interface User {
  id: number;
  email: string;
  ruolo: string;
  nome: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<string | null>;
  isAuthenticated: boolean;
  isRole: (role: string) => boolean;
  biometricEnabled: boolean;
  registerBiometric: () => Promise<boolean>;
  loginBiometric: () => Promise<boolean>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBiometricEnabled(localStorage.getItem('biometric_enabled') === '1');
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Refresh failed');
      const data = await res.json();
      setAccessToken(data.access_token);
      return data.access_token;
    } catch {
      setAccessToken(null);
      setUser(null);
      return null;
    }
  }, []);

  const login = useCallback(async (token: string) => {
    setAccessToken(token);
    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json();
      setUser(data.user);
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

  // Auto-restore session
  useEffect(() => {
    const stored = localStorage.getItem('access_token');
    if (stored) {
      login(stored).catch(() => {
        refresh();
      });
    }
  }, [login, refresh]);

  // Auto-refresh on 401 (interceptor)
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      if (res.status === 401) {
        const newToken = await refresh();
        if (newToken) {
          const [url, init] = args;
          const newInit = { ...init, headers: { ...init?.headers, Authorization: `Bearer ${newToken}` } };
          return originalFetch(url, newInit);
        }
      }
      return res;
    };
    return () => {
      window.fetch = originalFetch;
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
