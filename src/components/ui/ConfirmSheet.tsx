'use client';

import { useEffect, useRef } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface ConfirmSheetProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmSheet({
  open,
  title,
  message,
  confirmText = 'Conferma',
  cancelText = 'Annulla',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  // 2026-09-28 P1 (a11y, pattern modal-specialist): alla apertura il focus va
  // sul bottone ANNULLA (azione meno distruttiva) — non su Conferma. Premere
  // Invio senza leggere non deve mai eseguire l'azione irreversibile.
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    // Il focus arriva DOPO il paint del dialog (il return null sopra non
    // lascia il bottone nel DOM prima dell'apertura).
    const raf = requestAnimationFrame(() => cancelRef.current?.focus());
    return () => {
      window.removeEventListener('keydown', handler);
      cancelAnimationFrame(raf);
    };
  }, [open, onCancel]);

  if (!open) return null;

  const confirmClass =
    variant === 'danger'
      ? 'bg-red-600 active:bg-red-700'
      : 'bg-blue-600 active:bg-blue-700';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="bg-gray-900 rounded-3xl p-6 w-full max-w-sm animate-slide-up">
        <div className="flex flex-col items-center text-center">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${variant === 'danger' ? 'bg-red-900/30' : 'bg-blue-900/30'}`}>
            <ExclamationTriangleIcon className={`w-7 h-7 ${variant === 'danger' ? 'text-red-500' : 'text-blue-500'}`} aria-hidden="true" />
          </div>

          <h2 id="confirm-title" className="text-lg font-semibold mb-2">{title}</h2>
          <p className="text-gray-400 text-sm mb-6 leading-relaxed">{message}</p>

          <button
            onClick={onConfirm}
            className={`w-full h-12 text-white font-semibold rounded-xl mb-3 transition-colors ${confirmClass}`}
          >
            {confirmText}
          </button>

          <button
            ref={cancelRef}
            onClick={onCancel}
            className="text-gray-500 text-sm active:text-gray-300 transition-colors min-h-[48px] min-w-[48px]"
          >
            {cancelText}
          </button>
        </div>
      </div>
    </div>
  );
}
