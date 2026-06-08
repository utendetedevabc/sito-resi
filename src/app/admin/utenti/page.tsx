'use client';

import { useEffect, useState } from 'react';
import MobileHeader from '@/components/layout/MobileHeader';
import { ListaSkeleton } from '@/components/ui/SkeletonLoader';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';

interface User {
  id: number;
  email: string;
  ruolo: string;
  nome: string;
  azienda: string | null;
  attivo: number;
  created_at: string;
}

export default function AdminUtentiPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState('');

  const [form, setForm] = useState({
    email: '',
    password: '',
    ruolo: 'store_account' as const,
    nome: '',
    azienda: '',
    codice_cliente_esterno: '',
  });

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/admin/users?page=${page}&per_page=${perPage}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setUsers(data.data || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, [page]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...form, csrf_token: 'placeholder' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Errore creazione utente');
        return;
      }
      setShowForm(false);
      setForm({ email: '', password: '', ruolo: 'store_account', nome: '', azienda: '', codice_cliente_esterno: '' });
      loadUsers();
    } catch {
      setFormError('Errore di connessione');
    }
  }

  async function toggleAttivo(user: User) {
    try {
      const token = localStorage.getItem('access_token');
      await fetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ attivo: user.attivo ? 0 : 1, csrf_token: 'placeholder' }),
      });
      loadUsers();
    } catch {
      // silent
    }
  }

  return (
    <div className="min-h-dvh bg-gray-950">
      <MobileHeader title="Gestione utenti" />

      <div className="pt-4 space-y-4">
        <button
          onClick={() => setShowForm(!showForm)}
          className="w-full h-12 bg-blue-600 text-white font-medium rounded-2xl active:bg-blue-700 transition-colors"
        >
          {showForm ? 'Chiudi form' : 'Aggiungi utente'}
        </button>

        {showForm && (
          <div className="card-mobile space-y-3">
            <h2 className="text-sm font-semibold text-gray-200">Nuovo utente</h2>
            {formError && (
              <div role="alert" className="p-2 bg-red-900/30 text-red-300 rounded-lg border border-red-800 text-sm">
                {formError}
              </div>
            )}
            <form onSubmit={handleCreate} className="space-y-3">
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Email"
                className="input-mobile"
              />
              <input
                type="password"
                required
                minLength={12}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Password"
                className="input-mobile"
              />
              <input
                type="text"
                required
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Nome"
                className="input-mobile"
              />
              <select
                value={form.ruolo}
                onChange={(e) => setForm((f) => ({ ...f, ruolo: e.target.value as any }))}
                className="input-mobile"
              >
                <option value="store_account">Store Account</option>
                <option value="venditore">Venditore</option>
                <option value="admin">Admin</option>
              </select>
              <input
                type="text"
                value={form.azienda}
                onChange={(e) => setForm((f) => ({ ...f, azienda: e.target.value }))}
                placeholder="Azienda"
                className="input-mobile"
              />
              <input
                type="text"
                value={form.codice_cliente_esterno}
                onChange={(e) => setForm((f) => ({ ...f, codice_cliente_esterno: e.target.value }))}
                placeholder="Codice cliente esterno"
                className="input-mobile"
              />
              <button type="submit" className="btn-mobile">Crea</button>
            </form>
          </div>
        )}

        {loading ? (
          <ListaSkeleton count={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={loadUsers} />
        ) : users.length === 0 ? (
          <EmptyState title="Nessun utente" description="Non ci sono utenti registrati." />
        ) : (
          <div className="space-y-3">
            {users.map((u) => (
              <div key={u.id} className="card-mobile flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-100 truncate">{u.nome}</p>
                  <p className="text-xs text-gray-400 truncate">{u.email}</p>
                  <p className="text-xs text-gray-500 capitalize mt-0.5">{u.ruolo.replace('_', ' ')} {u.azienda ? `· ${u.azienda}` : ''}</p>
                </div>
                <button
                  onClick={() => toggleAttivo(u)}
                  className={`ml-3 flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium min-h-[32px] ${
                    u.attivo
                      ? 'bg-green-600/20 text-green-400 border border-green-600/30'
                      : 'bg-red-600/20 text-red-400 border border-red-600/30'
                  }`}
                >
                  {u.attivo ? 'Attivo' : 'Sospeso'}
                </button>
              </div>
            ))}
          </div>
        )}

        {total > perPage && (
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="h-10 px-4 bg-gray-800 text-gray-200 rounded-xl disabled:opacity-40 active:bg-gray-700"
            >
              Precedente
            </button>
            <span className="text-sm text-gray-400">
              Pagina {page}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page * perPage >= total}
              className="h-10 px-4 bg-gray-800 text-gray-200 rounded-xl disabled:opacity-40 active:bg-gray-700"
            >
              Successiva
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
