'use client';

import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

interface Prodotto {
  codice: string;
  descrizione: string;
  quantita: number;
  condizioni: 'integro' | 'danneggiato' | 'aperto' | 'usato';
}

interface Props {
  value: Prodotto[];
  onChange: (prodotti: Prodotto[]) => void;
}

export default function ProdottiForm({ value, onChange }: Props) {
  function add() {
    onChange([...value, { codice: '', descrizione: '', quantita: 1, condizioni: 'integro' }]);
  }

  function remove(index: number) {
    const next = [...value];
    next.splice(index, 1);
    onChange(next);
  }

  function update(index: number, field: keyof Prodotto, val: string | number) {
    const next = [...value];
    next[index] = { ...next[index], [field]: val };
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-300">Prodotti ({value.length})</p>

      {value.map((p, i) => (
        <fieldset key={i} className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
          <legend className="sr-only">Prodotto {i + 1}</legend>

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label htmlFor={`p-codice-${i}`} className="block text-xs font-medium text-gray-400 mb-1.5">Codice</label>
              <input
                id={`p-codice-${i}`}
                type="text"
                required
                value={p.codice}
                onChange={(e) => update(i, 'codice', e.target.value)}
                className="input-mobile"
                placeholder="Codice prodotto"
              />
            </div>
            <div>
              <label htmlFor={`p-desc-${i}`} className="block text-xs font-medium text-gray-400 mb-1.5">Descrizione</label>
              <input
                id={`p-desc-${i}`}
                type="text"
                required
                value={p.descrizione}
                onChange={(e) => update(i, 'descrizione', e.target.value)}
                className="input-mobile"
                placeholder="Descrizione"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`p-qta-${i}`} className="block text-xs font-medium text-gray-400 mb-1.5">Q.tà</label>
                <input
                  id={`p-qta-${i}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={9999}
                  required
                  value={p.quantita}
                  onChange={(e) => update(i, 'quantita', parseInt(e.target.value) || 1)}
                  className="input-mobile"
                />
              </div>
              <div>
                <label htmlFor={`p-cond-${i}`} className="block text-xs font-medium text-gray-400 mb-1.5">Condizioni</label>
                <select
                  id={`p-cond-${i}`}
                  value={p.condizioni}
                  onChange={(e) => update(i, 'condizioni', e.target.value as Prodotto['condizioni'])}
                  className="input-mobile"
                >
                  <option value="integro">Integro</option>
                  <option value="danneggiato">Danneggiato</option>
                  <option value="aperto">Aperto</option>
                  <option value="usato">Usato</option>
                </select>
              </div>
            </div>
          </div>

          {value.length > 1 && (
            <button
              type="button"
              onClick={() => remove(i)}
              className="mt-3 flex items-center gap-1.5 text-sm text-red-400 font-medium min-h-[40px] px-2 rounded-lg active:bg-red-900/20 transition-colors"
              aria-label={`Rimuovi prodotto ${i + 1}`}
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
        className="flex items-center justify-center gap-2 w-full min-h-[48px] bg-gray-800 text-gray-300 rounded-xl font-medium active:bg-gray-700 transition-colors border border-gray-700"
      >
        <PlusIcon className="w-5 h-5" aria-hidden="true" />
        Aggiungi prodotto
      </button>
    </div>
  );
}
