'use client';

import { useEffect, useRef, useState } from 'react';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

interface Linea {
  nome: string;
  numero_pezzi: number;
}

// Valore sentinella per l'opzione "Altro…" della <select>.
// NON viene mai inviato al server: selezionandolo, `nome` va a '' e poi
// prende il testo digitato nell'input personalizzato.
export const ALTRO_VALUE = '__ALTRO__';

interface Props {
  value: Linea[];
  onChange: (linee: Linea[]) => void;
  // F10: linee aperte del PV selezionato. Se assente/vuoto, si mostra
  // l'input testo libero (retrocompatibile con ResoForm pre-Task-8).
  lineeDisponibili?: string[];
}

// Form "inserimento linee": ogni riga ha nome della linea + numero pezzi.
// I colli (pacchi per il corriere) NON sono qui: sono il campo singolo
// num_colli in "dati ritiro corriere" di ResoForm.
export default function LineeForm({ value, onChange, lineeDisponibili }: Props) {
  const addBtnRef = useRef<HTMLButtonElement>(null);
  // Ref al primo campo (select o input) dell'ultima riga: serve a spostarvi
  // il focus quando l'utente aggiunge una riga.
  const newRowFieldRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  // Ref agli input "Altro" per riga: serve a spostarvi il focus quando
  // l'utente seleziona "Altro…" nella select di quella riga.
  const altroInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // `altre[i] === true` → la riga i è in modalità "Altro…" (input testo
  // libero visibile sotto la select). Mantenuto in sync per indice con
  // `value`: add/remove modificano entrambi gli array nella stessa posizione.
  const [altre, setAltre] = useState<boolean[]>(() =>
    value.map((l) => {
      if (!lineeDisponibili || lineeDisponibili.length === 0) return false;
      return !!l.nome && !lineeDisponibili.includes(l.nome);
    })
  );

  const hasLinee = !!(lineeDisponibili && lineeDisponibili.length > 0);

  // Ricalcola `altre` quando cambia l'INSIEME delle linee disponibili
  // (cambio PV o prefill reso esistente in PUT). Confronto sul contenuto
  // (non sul riferimento) così il componente è robusto anche se il parent
  // passa un nuovo array con lo stesso contenuto ad ogni render. Le
  // modifiche interne (select / input Altro) aggiornano `altre`
  // esplicitamente in onSelectChange e NON devono essere sovrascritte.
  const lineeKey = (lineeDisponibili ?? []).join('|');
  const prevLineeKeyRef = useRef(lineeKey);
  useEffect(() => {
    if (prevLineeKeyRef.current === lineeKey) return;
    prevLineeKeyRef.current = lineeKey;
    setAltre(
      value.map((l) => {
        if (!lineeDisponibili || lineeDisponibili.length === 0) return false;
        return !!l.nome && !lineeDisponibili.includes(l.nome);
      })
    );
  }, [lineeKey]); // dipende solo dalla key di contenuto, NON da value

  function add() {
    onChange([...value, { nome: '', numero_pezzi: 1 }]);
    // La nuova riga parte in modalità "linea da selezionare" (non Altro).
    setAltre((prev) => [...prev, false]);
    // Focus sul primo campo (select o input) della nuova riga.
    setTimeout(() => newRowFieldRef.current?.focus(), 0);
  }

  function remove(index: number) {
    const next = [...value];
    next.splice(index, 1);
    onChange(next);
    // Mantieni `altre` allineato per indice con `value`.
    setAltre((prev) => {
      const nextAltre = [...prev];
      nextAltre.splice(index, 1);
      return nextAltre;
    });
    // Dopo la rimozione, sposta il focus sul pulsante "Aggiungi linea" (F9).
    setTimeout(() => addBtnRef.current?.focus(), 0);
  }

  function updateNome(index: number, val: string) {
    const next = [...value];
    next[index] = { ...next[index], nome: val };
    onChange(next);
  }

  function updatePezzi(index: number, val: number) {
    const next = [...value];
    next[index] = { ...next[index], numero_pezzi: val };
    onChange(next);
  }

  function onSelectChange(index: number, val: string) {
    if (val === ALTRO_VALUE) {
      // Passa in modalità Altro: svuota il nome e sposta il focus
      // sull'input testo personalizzato.
      setAltre((prev) => {
        const next = [...prev];
        next[index] = true;
        return next;
      });
      updateNome(index, '');
      setTimeout(() => altroInputRefs.current[index]?.focus(), 0);
    } else {
      // Linea reale o placeholder: esci dalla modalità Altro e aggiorna nome.
      setAltre((prev) => {
        const next = [...prev];
        next[index] = false;
        return next;
      });
      updateNome(index, val);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-300">
        Linee ({value.length})
      </p>

      {value.map((l, i) => {
        const isAltro = !!altre[i];
        const isLast = i === value.length - 1;
        return (
          <fieldset key={i} className="bg-gray-800 rounded-2xl p-4 border border-gray-700">
            <legend className="sr-only">Linea {i + 1}</legend>

            <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
              <div>
                {hasLinee ? (
                  <>
                    <label
                      htmlFor={`l-linea-${i}`}
                      className="block text-xs font-medium text-gray-400 mb-1.5"
                    >
                      Linea
                    </label>
                    <select
                      id={`l-linea-${i}`}
                      required
                      value={
                        isAltro
                          ? ALTRO_VALUE
                          : l.nome && lineeDisponibili!.includes(l.nome)
                          ? l.nome
                          : ''
                      }
                      onChange={(e) => onSelectChange(i, e.target.value)}
                      className="input-mobile"
                      aria-describedby={`l-linea-hint-${i}`}
                      ref={isLast ? (el) => { newRowFieldRef.current = el; } : undefined}
                    >
                      <option value="">— Seleziona linea —</option>
                      {lineeDisponibili!.map((ln) => (
                        <option key={ln} value={ln}>
                          {ln}
                        </option>
                      ))}
                      <option value={ALTRO_VALUE}>Altro…</option>
                    </select>
                    <p id={`l-linea-hint-${i}`} className="text-xs text-gray-500 mt-1">
                      Scegli una linea del punto vendita, oppure &quot;Altro…&quot; per
                      inserirne una personalizzata
                    </p>
                    {isAltro && (
                      <div className="mt-3">
                        <label
                          htmlFor={`l-altro-${i}`}
                          className="block text-xs font-medium text-gray-400 mb-1.5"
                        >
                          Nome linea personalizzata
                        </label>
                        <input
                          id={`l-altro-${i}`}
                          type="text"
                          required
                          value={l.nome}
                          onChange={(e) => updateNome(i, e.target.value)}
                          className="input-mobile"
                          placeholder="Es. Linea viso"
                          maxLength={100}
                          autoComplete="off"
                          ref={(el) => {
                            altroInputRefs.current[i] = el;
                          }}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <label
                      htmlFor={`l-nome-${i}`}
                      className="block text-xs font-medium text-gray-400 mb-1.5"
                    >
                      Nome linea
                    </label>
                    <input
                      id={`l-nome-${i}`}
                      type="text"
                      required
                      value={l.nome}
                      onChange={(e) => updateNome(i, e.target.value)}
                      className="input-mobile"
                      placeholder="Es. Linea viso"
                      maxLength={100}
                      autoComplete="off"
                      aria-describedby={`l-nome-hint-${i}`}
                      ref={isLast ? (el) => { newRowFieldRef.current = el; } : undefined}
                    />
                    <p id={`l-nome-hint-${i}`} className="text-xs text-gray-500 mt-1">
                      Seleziona prima un punto vendita
                    </p>
                  </>
                )}
              </div>
              <div>
                <label
                  htmlFor={`l-pezzi-${i}`}
                  className="block text-xs font-medium text-gray-400 mb-1.5"
                >
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
                  onChange={(e) => updatePezzi(i, parseInt(e.target.value, 10) || 1)}
                  className="input-mobile"
                  aria-describedby={`l-pezzi-hint-${i}`}
                />
                <p id={`l-pezzi-hint-${i}`} className="text-xs text-gray-500 mt-1">
                  Pezzi di questa linea
                </p>
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
        );
      })}

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