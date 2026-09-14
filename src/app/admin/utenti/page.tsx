'use client';

import { useEffect, useRef, useState } from 'react';
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

// Opzioni ruolo condivise tra form creazione e modifica. customer_service era
// assente nella select di creazione (bug preesistente) — ora presente in entrambi.
const RUOLO_OPTIONS: { value: string; label: string }[] = [
  { value: 'store_account', label: 'Store Account' },
  { value: 'venditore', label: 'Venditore' },
  { value: 'customer_service', label: 'Customer Service' },
  { value: 'admin', label: 'Admin' },
];

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

  // --- Modal modifica utente esistente ---
  // editing = utente in modifica (null = modal chiuso). Manteniamo email
  // read-only (è l'identificatore di login: non modificabile qui).
  const [editing, setEditing] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({
    ruolo: 'venditore',
    nome: '',
    azienda: '',
    codice_cliente_esterno: '',
    attivo: 1,
    password: '',
  });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // A11y: focus management. Riferimenti per (1) focus iniziale nel modal e
  // (2) restore del focus al bottone di trigger alla chiusura.
  const editNameRef = useRef<HTMLInputElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

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

  // Apre il modal di modifica: popola il form dall'utente, cattura il focus
  // corrente (per il restore alla chiusura) e blocca lo scroll del body.
  function openEdit(user: User) {
    lastFocusedRef.current = document.activeElement as HTMLElement;
    setEditForm({
      ruolo: user.ruolo,
      nome: user.nome,
      azienda: user.azienda || '',
      codice_cliente_esterno: '',
      attivo: user.attivo,
      password: '',
    });
    setEditError('');
    setEditing(user);
  }

  // Chiude il modal e restituisce il focus al bottone di trigger.
  function closeEdit() {
    setEditing(null);
    setEditSaving(false);
    // Restore focus asincrono (dopo il re-render che smonta il modal).
    setTimeout(() => {
      lastFocusedRef.current?.focus();
    }, 0);
  }

  // Quando il modal si monta: focus sul primo campo (nome) + blocco scroll body.
  useEffect(() => {
    if (!editing) return;
    document.body.style.overflow = 'hidden';
    // Focus ritardato per attendere il paint del modal.
    const t = setTimeout(() => editNameRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = '';
    };
  }, [editing]);

  // A11y: ESC chiude il modal; Tab fa da focus trap (wrappa tra gli elementi
  // focusable del dialog). Listener su window quando il modal è aperto.
  useEffect(() => {
    if (!editing) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeEdit();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditError('');
    setEditSaving(true);
    try {
      const token = localStorage.getItem('access_token');
      // Password opzionale: inviata solo se compilata (stringa non vuota).
      const payload: Record<string, unknown> = {
        ruolo: editForm.ruolo,
        nome: editForm.nome,
        azienda: editForm.azienda || null,
        codice_cliente_esterno: editForm.codice_cliente_esterno || null,
        attivo: editForm.attivo,
        csrf_token: 'placeholder',
      };
      if (editForm.password !== '') {
        payload.password = editForm.password;
      }
      const res = await fetch(`/api/admin/users/${editing.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || 'Errore modifica utente');
        if (data.issues) {
          const pwIssue = data.issues.find((i: any) => i.path?.includes('password'));
          if (pwIssue) setEditError(pwIssue.message || 'Password non valida');
        }
        return;
      }
      closeEdit();
      loadUsers();
    } catch {
      setEditError('Errore di connessione');
    } finally {
      setEditSaving(false);
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
                aria-label="Email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Email"
                className="input-mobile"
              />
              <input
                type="password"
                required
                minLength={8}
                aria-label="Password (minimo 8 caratteri)"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Password (min 8 caratteri)"
                className="input-mobile"
              />
              <input
                type="text"
                required
                aria-label="Nome"
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Nome"
                className="input-mobile"
              />
              <select
                aria-label="Ruolo"
                value={form.ruolo}
                onChange={(e) => setForm((f) => ({ ...f, ruolo: e.target.value as any }))}
                className="input-mobile"
              >
                {RUOLO_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <input
                type="text"
                aria-label="Azienda"
                value={form.azienda}
                onChange={(e) => setForm((f) => ({ ...f, azienda: e.target.value }))}
                placeholder="Azienda"
                className="input-mobile"
              />
              <input
                type="text"
                aria-label="Codice cliente esterno"
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
              <div key={u.id} className="card-mobile">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-100 truncate">{u.nome}</p>
                    <p className="text-xs text-gray-400 truncate">{u.email}</p>
                    <p className="text-xs text-gray-500 capitalize mt-0.5">{u.ruolo.replace('_', ' ')} {u.azienda ? `· ${u.azienda}` : ''}</p>
                  </div>
                  <button
                    onClick={() => toggleAttivo(u)}
                    className={`flex-shrink-0 px-3 min-h-[44px] rounded-lg text-xs font-medium ${
                      u.attivo
                        ? 'bg-green-600/20 text-green-400 border border-green-600/30'
                        : 'bg-red-600/20 text-red-400 border border-red-600/30'
                    }`}
                    aria-pressed={u.attivo === 1}
                    aria-label={`${u.attivo ? 'Sospendi' : 'Attiva'} utente ${u.nome}`}
                  >
                    {u.attivo ? 'Attivo' : 'Sospeso'}
                  </button>
                </div>
                {/* Pulsante modifica a riga: target ≥44px, etichetta esplicita. */}
                <button
                  onClick={() => openEdit(u)}
                  className="mt-3 w-full min-h-[44px] bg-gray-800 text-gray-100 rounded-xl active:bg-gray-700 transition-colors text-sm font-medium"
                  aria-haspopup="dialog"
                >
                  Modifica
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

      {/* === Modal modifica utente ===
          A11y: role=dialog + aria-modal + aria-labelledby; focus iniziale sul
          campo Nome; focus trap con Tab/Shift+Tab; ESC chiude; restore focus
          al trigger; blocco scroll body. Label <label htmlFor> per ogni input. */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
          onClick={closeEdit}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-user-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg bg-gray-900 rounded-t-2xl sm:rounded-2xl border border-gray-800 max-h-[90dvh] overflow-y-auto"
          >
            <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
              <h2 id="edit-user-title" className="text-base font-semibold text-gray-100">
                Modifica utente
              </h2>
              <button
                onClick={closeEdit}
                aria-label="Chiudi modifica utente"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-200 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Email: read-only (identificatore di login, non modificabile). */}
              <div>
                <label htmlFor="edit-email" className="block text-xs font-medium text-gray-400 mb-1">
                  Email (non modificabile)
                </label>
                <input
                  id="edit-email"
                  type="email"
                  value={editing.email}
                  readOnly
                  aria-readonly="true"
                  className="input-mobile opacity-60 cursor-not-allowed"
                />
              </div>

              {editError && (
                <div role="alert" aria-live="assertive" className="p-2 bg-red-900/30 text-red-300 rounded-lg border border-red-800 text-sm">
                  {editError}
                </div>
              )}

              <form onSubmit={handleEditSubmit} className="space-y-3">
                <div>
                  <label htmlFor="edit-nome" className="block text-xs font-medium text-gray-400 mb-1">
                    Nome
                  </label>
                  <input
                    id="edit-nome"
                    ref={editNameRef}
                    type="text"
                    required
                    value={editForm.nome}
                    onChange={(e) => setEditForm((f) => ({ ...f, nome: e.target.value }))}
                    className="input-mobile"
                  />
                </div>

                <div>
                  <label htmlFor="edit-ruolo" className="block text-xs font-medium text-gray-400 mb-1">
                    Ruolo
                  </label>
                  <select
                    id="edit-ruolo"
                    value={editForm.ruolo}
                    onChange={(e) => setEditForm((f) => ({ ...f, ruolo: e.target.value }))}
                    className="input-mobile"
                  >
                    {RUOLO_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="edit-azienda" className="block text-xs font-medium text-gray-400 mb-1">
                    Azienda
                  </label>
                  <input
                    id="edit-azienda"
                    type="text"
                    value={editForm.azienda}
                    onChange={(e) => setEditForm((f) => ({ ...f, azienda: e.target.value }))}
                    className="input-mobile"
                  />
                </div>

                <div>
                  <label htmlFor="edit-codice" className="block text-xs font-medium text-gray-400 mb-1">
                    Codice cliente esterno
                  </label>
                  <input
                    id="edit-codice"
                    type="text"
                    value={editForm.codice_cliente_esterno}
                    onChange={(e) => setEditForm((f) => ({ ...f, codice_cliente_esterno: e.target.value }))}
                    className="input-mobile"
                  />
                </div>

                {/* Checkbox attivo: aria-pressed non serve, label associata. */}
                <div className="flex items-center gap-3 min-h-[44px]">
                  <input
                    id="edit-attivo"
                    type="checkbox"
                    checked={editForm.attivo === 1}
                    onChange={(e) => setEditForm((f) => ({ ...f, attivo: e.target.checked ? 1 : 0 }))}
                    className="h-5 w-5"
                  />
                  <label htmlFor="edit-attivo" className="text-sm text-gray-200">
                    Utente attivo
                  </label>
                </div>

                <div>
                  <label htmlFor="edit-password" className="block text-xs font-medium text-gray-400 mb-1">
                    Nuova password (opzionale)
                  </label>
                  <input
                    id="edit-password"
                    type="password"
                    minLength={8}
                    autoComplete="new-password"
                    value={editForm.password}
                    onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="Lascia vuoto per non modificare"
                    className="input-mobile"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Minimo 8 caratteri. Compila solo per reimpostare la password.
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeEdit}
                    disabled={editSaving}
                    className="flex-1 min-h-[44px] bg-gray-800 text-gray-200 rounded-xl active:bg-gray-700 disabled:opacity-40 transition-colors"
                  >
                    Annulla
                  </button>
                  <button
                    type="submit"
                    disabled={editSaving}
                    className="flex-1 min-h-[44px] bg-blue-600 text-white font-medium rounded-xl active:bg-blue-700 disabled:opacity-40 transition-colors"
                  >
                    {editSaving ? 'Salvataggio…' : 'Salva'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}