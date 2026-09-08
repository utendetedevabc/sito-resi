const BASE_URL = '';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

async function request(method: string, path: string, body?: any): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  // La gestione 401 (refresh + retry + redirect) è delegata ALL'INTERCEPTOR
  // globale di window.fetch in src/hooks/useAuth.tsx (unica fonte di verità).
  // Un secondo gestore qui causava doppia ricorsione e redirect multipli.

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw Object.assign(new Error(data?.error || 'Errore richiesta'), { status: res.status, data });
  }
  return data;
}

export const api = {
  get: (path: string) => request('GET', path),
  post: (path: string, body?: any) => request('POST', path, body),
  put: (path: string, body?: any) => request('PUT', path, body),
  del: (path: string) => request('DELETE', path),
};

export default api;
