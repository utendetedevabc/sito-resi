'use client';

import { useRef } from 'react';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

interface Linea {
  nome: string;
  numero_pezzi: number;
}

interface Props {
  value: Linea[];
  onChange: (linee: Linea[]) => void;
}

// Form "inserimento linee": ogni riga ha nome della linea + numero pezzi.
// I colli (pacchi per il corriere) NON sono qui: sono il campo singolo
// num_colli in "dati ritiro corriere" di ResoForm.
export default function LineeForm({ value, onChange }: Props) {
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);

  function add() {
    onChange([...value, { nome: '', numero_pezzi: 1 }]);
    // Focus sul campo nome della nuova riga appena aggiunta.
    setTimeout(() => newNameRef.current?.focus(), 0);
  }

  function remove(index: number) {
    const next = [...value];
    next.splice(index, 1);
    onChange(next);
    // Dopo la rimozione, sposta il focus sul pulsante "Aggiungi linea".
    setTimeout(() => addBtnRef.current?.focus(), 0);
  }

  function update(index: number, field: keyof Linea, val: string | number) {
    const next = [...value];
    next[index] = { ...next[index], [field]: val };
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-300">
        Linee ({value.length})
      </p>

      {value.map((l, i) => (
        <fieldset key={i} className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
          <legend className="sr-only">Linea {i + 1}</legend>

          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
            <div>
              <label htmlFor={`l-nome-${i}`} className="block text-xs font-medium text-gray-400 mb-1.5">
                Nome linea
              </label>
              <input
                id={`l-nome-${i}`}
                type="text"
                required
                value={l.nome}
                onChange={(e) => update(i, 'nome', e.target.value)}
                className="input-mobile"
                placeholder="Es. Linea viso"
                maxLength={100}
                autoComplete="off"
                ref={i === value.length - 1 ? newNameRef : undefined}
              />
            </div>
            <div>
              <label htmlFor={`l-pezzi-${i}`} className="block text-xs font-medium text-gray-400 mb-1.5">
                Numero pezzi
              </label>
              <input
                id={`l-pezzi-${i}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={9999}
                required
                value={l.numero_pezzi}
                onChange={(e) => update(i, 'numero_pezzi', parseInt(e.target.value, 10) || 1)}
                className="input-mobile"
                aria-describedby={`l-pezzi-hint-${i}`}
              />
              <p id={`l-pezzi-hint-${i}`} className="text-xs text-gray-500 mt-1">Pezzi di questa linea</p>
            </div>
          </div>

          {value.length > 1 && (
            <button
              type="button"
              onClick={() => remove(i)}
              className="mt-3 flex items-center gap-1.5 text-sm text-red-400 font-medium min-h-[44px] px-2 rounded-lg active:bg-red-900/20 transition-colors"
              aria-label={`Rimuovi linea ${i + 1}`}
            >
              <TrashIcon className="w-4 h-4" aria-hidden="true" />
              Rimuovi
            </button>
          )}
        </fieldset>
      ))}

      <button
        type="button"
        onClick={add}
        ref={addBtnRef}
        className="flex items-center justify-center gap-2 w-full min-h-[48px] bg-gray-800 text-gray-300 rounded-xl font-medium active:bg-gray-700 transition-colors border border-gray-700"
      >
        <PlusIcon className="w-5 h-5" aria-hidden="true" />
        Aggiungi linea
      </button>
    </div>
  );
}