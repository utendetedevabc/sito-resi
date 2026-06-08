'use client';

import { useState, useCallback, createContext, useContext, useEffect } from 'react';
import { CheckCircleIcon, XCircleIcon, InformationCircleIcon, XMarkIcon } from '@heroicons/react/24/solid';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastContextValue {
  toasts: ToastItem[];
  addToast: (type: ToastItem['type'], message: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: ToastItem['type'], message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

function ToastContainer() {
  const ctx = useContext(ToastContext);
  if (!ctx) return null;
  const { toasts, removeToast } = ctx;

  return (
    <div
      className="fixed top-4 left-4 right-4 z-[60] space-y-2 max-w-lg mx-auto pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((toast) => (
        <ToastItemComponent key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
}

function ToastItemComponent({
  toast,
  onRemove,
}: {
  toast: ToastItem;
  onRemove: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  const bgClass =
    toast.type === 'success'
      ? 'bg-green-600'
      : toast.type === 'error'
      ? 'bg-red-600'
      : 'bg-gray-700';

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg animate-slide-down ${bgClass}`}
      role="status"
    >
      {toast.type === 'success' && <CheckCircleIcon className="w-5 h-5 flex-shrink-0 text-white" aria-hidden="true" />}
      {toast.type === 'error' && <XCircleIcon className="w-5 h-5 flex-shrink-0 text-white" aria-hidden="true" />}
      {toast.type === 'info' && <InformationCircleIcon className="w-5 h-5 flex-shrink-0 text-white" aria-hidden="true" />}
      <span className="text-sm font-medium flex-1 text-white">{toast.message}</span>
      <button
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 min-h-[48px] min-w-[48px] flex items-center justify-center rounded-lg active:bg-white/10"
        aria-label="Chiudi notifica"
      >
        <XMarkIcon className="w-4 h-4 text-white" aria-hidden="true" />
      </button>
    </div>
  );
}
