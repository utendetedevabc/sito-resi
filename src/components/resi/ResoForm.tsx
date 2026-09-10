'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import CameraUpload from '@/components/ui/CameraUpload';
import LineeForm from '@/components/ui/LineeForm';
import { useToast } from '@/components/ui/Toast';

interface Linea {
  nome: string;
  numero_pezzi: number;
}

interface Props {
  // Dove andare dopo aver creato il reso (es. '/venditore/storico').
  redirectAfter: string;
  // Se true, il redirect diventa `${redirectAfter}/${uuid}` (utile per mandare
  // l'interno al dettaglio del reso appena creato auto-chiuso, dove può subito
  // scaricare il file corriere RITGIO*.xls).
  redirectToDetail?: boolean;
  // Banner informativo opzionale sul flusso (es. "va dritto al CS" / "auto-chiuso").
  noteBanner?: ReactNode;
}

// Form di inserimento reso condiviso tra store_account, venditore e
// customer_service. POST /api/resi (autorizzato per tutti e 3 i ruoli).
// Il server decide lo stato iniziale in base al ruolo:
//   store_account -> in_attesa | venditore -> in_revisione | CS -> approvato (auto-chiuso + webhook)
// Modello nuovo: linee (nome + numero_pezzi) + corriere + PV manuale + num_reso
// sequenziale generato server (restuito nella risposta 201).
export default function ResoForm({ redirectAfter, redirectToDetail, noteBanner }: Props) {
  const router = useRouter();
  const { addToast } = useToast();
  const [motivo, setMotivo] = useState('');
  const [note, setNote] = useState('');
  const [linee, setLinee] = useState<Linea[]>([{ nome: '', numero_pezzi: 1 }]);
  const [corriere, setCorriere] = useState('');
  const [corriereNome, setCorriereNome] = useState('');
  const [cldm, setCldm] = useState('');
  const [pv, setPv] = useState<{
    nome?: string;
    indirizzo?: string;
    citta?: string;
    cap?: string;
    provincia?: string;
    regione?: string;
    linee?: string[];
  } | null>(null);
  const [opzioniCldm, setOpzioniCldm] = useState<{ cldm: string; nome: string; citta?: string }[]>([]);
  const [cldmError, setCldmError] = useState('');
  const [lineePv, setLineePv] = useState<string[]>([]);
  const [ddtNumero, setDdtNumero] = useState('');
  const [ddtData, setDdtData] = useState('');
  const [numColli, setNumColli] = useState('');
  const [foto, setFoto] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const corriereNomeRef = useRef<HTMLInputElement>(null);
  // Ref al cldm corrente per gestire le race tra fetchPv (lookup on blur) e
  // la search debounced: dopo await, verifichiamo che il code richiesto sia
  // ancora quello attivo prima di applicare i setState (evita stale closure
  // quando l'utente digita velocemente o cambia campo).
  const cldmCorrenteRef = useRef('');

  // Fallback PV manuale: attivo quando il CLDM non è in anagrafica (lookup fail).
  const [pvNotFound, setPvNotFound] = useState(false);
  const [pvNome, setPvNome] = useState('');
  const [pvIndirizzo, setPvIndirizzo] = useState('');
  const [pvCitta, setPvCitta] = useState('');
  const [pvCap, setPvCap] = useState('');
  const [pvProvincia, setPvProvincia] = useState('');
  const [pvRegione, setPvRegione] = useState('');
  const [pvErrors, setPvErrors] = useState<Record<string, string>>({});
  // Messaggio della live region persistente (annuncio esito lookup PV).
  const [pvLookupMsg, setPvLookupMsg] = useState('');
  const pvNomeRef = useRef<HTMLInputElement>(null);
  const pvIndirizzoRef = useRef<HTMLInputElement>(null);
  const pvCittaRef = useRef<HTMLInputElement>(null);
  const pvCapRef = useRef<HTMLInputElement>(null);
  const pvProvinciaRef = useRef<HTMLInputElement>(null);
  // Ref al campo cldm: quando il fieldset manuale si smonta (lookup torna OK o
  // cldm svuotato), riportiamo il focus sul cldm se prima era sul fieldset.
  const cldmRef = useRef<HTMLInputElement>(null);

  // Ripulisce i campi PV manuali + i relativi errori. Usato quando il lookup
  // torna OK (utente ha corretto il CLDM) o quando il CLDM viene svuotato.
  function clearPvManuali() {
    setPvNome(''); setPvIndirizzo(''); setPvCitta(''); setPvCap(''); setPvProvincia(''); setPvRegione('');
    setPvErrors({});
  }

  // Pulisce l'errore di un singolo campo PV manuale (onChange).
  function clearPvError(campo: string) {
    setPvErrors((p) => {
      if (!p[campo]) return p;
      const n = { ...p }; delete n[campo]; return n;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Fallback PV manuale: se il CLDM non è in anagrafica, i 5 campi essenziali
    // sono obbligatori lato client (il server li validerebbe con 400 pv_not_found).
    if (pvNotFound) {
      const errs: Record<string, string> = {};
      if (!pvNome.trim()) errs.pv_nome = 'Inserisci il nome del PV.';
      if (!pvIndirizzo.trim()) errs.pv_indirizzo = "Inserisci l'indirizzo.";
      if (!pvCitta.trim()) errs.pv_citta = 'Inserisci la città.';
      if (!pvCap.trim()) errs.pv_cap = 'Inserisci il CAP.';
      if (!pvProvincia.trim()) errs.pv_provincia = 'Inserisci la provincia.';
      if (Object.keys(errs).length > 0) {
        setPvErrors(errs);
        setError('Completa i dati del PV obbligatori prima di inviare.');
        const firstRef = errs.pv_nome ? pvNomeRef
          : errs.pv_indirizzo ? pvIndirizzoRef
          : errs.pv_citta ? pvCittaRef
          : errs.pv_cap ? pvCapRef
          : pvProvinciaRef;
        requestAnimationFrame(() => firstRef.current?.focus());
        setLoading(false);
        return;
      }
    }

    try {
      const token = localStorage.getItem('access_token');
      const body: Record<string, unknown> = {
        cldm,
        motivo_reso: motivo,
        note: note || undefined,
        linee,
        corriere,
        corriere_nome: corriere === 'ALTRI' ? corriereNome : null,
        ddt_numero: ddtNumero || null,
        ddt_data: ddtData || null,
        num_colli: numColli ? Number(numColli) : null,
      };
      // Invia i pv_* solo nel fallback manuale; se il lookup è OK il server
      // deriva i pv_* dal cldm (ignora eventuali pv_* del body).
      if (pvNotFound) {
        body.pv_nome = pvNome.trim();
        body.pv_indirizzo = pvIndirizzo.trim();
        body.pv_citta = pvCitta.trim();
        body.pv_cap = pvCap.trim();
        body.pv_provincia = pvProvincia.trim();
        body.pv_regione = pvRegione.trim() || undefined;
      }
      const res = await fetch('/api/resi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Errore creazione richiesta');
        return;
      }

      if (foto.length > 0 && data.uuid) {
        const formData = new FormData();
        foto.forEach((f) => formData.append('foto', f));
        await fetch(`/api/resi/${data.uuid}/foto`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
      }

      addToast('success', data.num_reso ? `Reso N. ${data.num_reso} creato con successo` : 'Richiesta creata con successo');
      router.push(redirectToDetail && data.uuid ? `${redirectAfter}/${data.uuid}` : redirectAfter);
    } catch {
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  }

  function onCorriereChange(val: string) {
    setCorriere(val);
    // Quando si seleziona ALTRI, porta il focus sul campo nome corriere.
    if (val === 'ALTRI') {
      setTimeout(() => corriereNomeRef.current?.focus(), 0);
    } else {
      setCorriereNome('');
    }
  }

  // Lookup del PV a partire dal codice CLDM. Chiamato on blur e quando
  // l'utente seleziona un'option dalla datalist (il value dell'input diventa
  // il cldm esatto). Su code vuoto resetta pv/linee. Gestione race: dopo
  // await verifichiamo che `code` sia ancora il cldm corrente (ref) prima
  // di applicare i setState — evita stale state se l'utente digita veloce
  // o se la search debounced restituisce risultati dopo un nuovo blur.
  async function fetchPv(code: string) {
    cldmCorrenteRef.current = code;
    // Cattura lo stato precedente (prima di questa lookup): serve per il
    // focus management quando il fieldset manuale si smonta.
    const eraPvNotFound = pvNotFound;
    if (!code) {
      setPv(null);
      setLineePv([]);
      setCldmError('');
      setPvNotFound(false);
      setPvLookupMsg('');
      clearPvManuali();
      // Se il fieldset manuale era aperto e ora si chiude (cldm svuotato),
      // riporta il focus sul cldm (era sul fieldset, ora smontato).
      if (eraPvNotFound) requestAnimationFrame(() => cldmRef.current?.focus());
      return;
    }
    try {
      const res = await fetch(`/api/anagrafica/${encodeURIComponent(code)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
      });
      if (code !== cldmCorrenteRef.current) return; // stale: l'utente ha cambiato cldm
      if (!res.ok) {
        // CLDM non in anagrafica: reveal dei campi PV manuali (fallback).
        // resp_* restano NULL lato server (nessun routing responsabile).
        setPv(null);
        setLineePv([]);
        setCldmError('CLDM non trovato in anagrafica');
        setPvNotFound(true);
        setPvLookupMsg('CLDM non trovato in anagrafica: inserisci i dati del PV manualmente');
        // Sposta il focus sul primo campo manuale solo alla PRIMA attivazione
        // del reveal (non a ogni re-blur di un cldm già fallito).
        if (!eraPvNotFound) requestAnimationFrame(() => pvNomeRef.current?.focus());
        return;
      }
      const data = await res.json();
      if (code !== cldmCorrenteRef.current) return; // stale
      setPv(data.pv);
      setLineePv(data.pv.linee || []);
      setCldmError('');
      // Lookup OK: chiudi il fieldset manuale e ripulisci i dati inseriti.
      setPvNotFound(false);
      setPvLookupMsg(`Punto vendita trovato: ${data.pv.nome}`);
      clearPvManuali();
      // Se il fieldset manuale era aperto e ora si chiude (lookup OK),
      // riporta il focus sul cldm (era sul fieldset, ora smontato).
      if (eraPvNotFound) requestAnimationFrame(() => cldmRef.current?.focus());
    } catch {
      if (code !== cldmCorrenteRef.current) return;
      setCldmError('Errore caricamento PV');
      setPv(null);
      setLineePv([]);
      setPvNotFound(false);
      setPvLookupMsg('');
    }
  }

  // Search debounced: a fronte di cambio `cldm`, dopo 250ms chiama
  // GET /api/anagrafica?q=<cldm> per popolare la datalist. Se cldm < 2 char
  // svuota le opzioni. Cleanup del timeout a ogni keystroke.
  useEffect(() => {
    if (cldm.length < 2) {
      setOpzioniCldm([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/anagrafica?q=${encodeURIComponent(cldm)}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        // Non guardiamo cldmCorrenteRef qui: le opzioni della datalist sono
        // solo suggerimenti, una race non produce stato errato (al massimo
        // una lista leggermente stale che verrà rinfrescata al prossimo keystroke).
        setOpzioniCldm(data.data || []);
      } catch {
        // Silenzioso: la datalist è solo un aiuto, non bloccare il form.
      }
    }, 250);
    return () => clearTimeout(t);
  }, [cldm]);

  // Quando l'utente seleziona un'option dalla datalist, l'input riceve il
  // cldm esatto. Trigger immediatamente il lookup così il PV compare senza
  // dover blur/re-focus. L'onBlur rimane come fallback per il caso in cui
  // l'utente digiti un cldm valido senza selezionare dalla lista.
  function onCldmChange(value: string) {
    setCldm(value);
    if (value.length >= 2 && opzioniCldm.some((o) => o.cldm === value)) {
      // Selezione da lista: lookup immediato.
      fetchPv(value);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="pt-4 space-y-4">
      {noteBanner}

      {error && (
        <div role="alert" className="p-3 bg-red-900/30 text-red-300 rounded-xl border border-red-800 text-sm">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="cldm" className="block text-sm font-medium text-gray-300 mb-1.5">
          CLDM / Punto vendita *
        </label>
        <input
          id="cldm"
          type="text"
          list="cldm-options"
          required
          inputMode="numeric"
          pattern="[A-Za-z0-9_\-]{2,20}"
          value={cldm}
          onChange={(e) => onCldmChange(e.target.value)}
          onBlur={(e) => fetchPv(e.target.value)}
          ref={cldmRef}
          className="input-mobile"
          placeholder="Es. 507888"
          autoComplete="off"
          aria-describedby="cldm-hint cldm-error"
          aria-invalid={!!cldmError}
        />
        <datalist id="cldm-options">
          {opzioniCldm.map((o) => (
            <option key={o.cldm} value={o.cldm}>
              {o.cldm} — {o.nome}{o.citta ? ` (${o.citta})` : ''}
            </option>
          ))}
        </datalist>
        <p id="cldm-hint" className="text-xs text-gray-500 mt-1">
          Digita il codice CLDM (es. 507888) e seleziona dalla lista.
        </p>
        {cldmError && (
          <p id="cldm-error" role="status" className="text-sm text-red-300 mt-1">
            {cldmError}
          </p>
        )}
        {pv && (
          <div className="pt-2 mt-2 border-t border-gray-700">
            <p className="text-sm font-semibold text-gray-200 mb-2">Punto vendita (da anagrafica)</p>
            <dl className="text-sm text-gray-300 space-y-1">
              <div>
                <dt className="inline font-medium">Nome: </dt>
                <dd className="inline">{pv.nome}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Indirizzo: </dt>
                <dd className="inline">{pv.indirizzo}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Città: </dt>
                <dd className="inline">{pv.citta} ({pv.cap}) — {pv.provincia}</dd>
              </div>
              {pv.regione && (
                <div>
                  <dt className="inline font-medium">Regione: </dt>
                  <dd className="inline">{pv.regione}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
        {/* Fallback PV manuale: reveal condizionale reattivo al lookup
            (niente disclosure button). Visibile solo quando pvNotFound. */}
        {pvNotFound && (
          <fieldset className="mt-3 p-3 border border-gray-700 rounded-xl space-y-3">
            <legend className="px-1 text-sm font-semibold text-gray-200">
              Dati PV (inserimento manuale — CLDM non in anagrafica)
            </legend>
            <p id="pv-manual-help" className="text-xs text-gray-400">
              Il CLDM non è presente in anagrafica. Inserisci manualmente i dati del punto vendita.
              I campi contrassegnati con * sono obbligatori.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pv_nome" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Nome PV <span aria-hidden="true">*</span>
                </label>
                <input
                  id="pv_nome" name="pv_nome" type="text" required aria-required="true"
                  autoComplete="organization" maxLength={120} className="input-mobile"
                  ref={pvNomeRef} value={pvNome}
                  onChange={(e) => { setPvNome(e.target.value); clearPvError('pv_nome'); }}
                  aria-invalid={!!pvErrors.pv_nome}
                  aria-describedby={pvErrors.pv_nome ? 'pv_nome-err' : 'pv-manual-help'}
                />
                {pvErrors.pv_nome && <p id="pv_nome-err" role="alert" className="text-sm text-red-300 mt-1">{pvErrors.pv_nome}</p>}
              </div>
              <div>
                <label htmlFor="pv_indirizzo" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Indirizzo <span aria-hidden="true">*</span>
                </label>
                <input
                  id="pv_indirizzo" name="pv_indirizzo" type="text" required aria-required="true"
                  autoComplete="street-address" maxLength={120} className="input-mobile"
                  ref={pvIndirizzoRef} value={pvIndirizzo}
                  onChange={(e) => { setPvIndirizzo(e.target.value); clearPvError('pv_indirizzo'); }}
                  aria-invalid={!!pvErrors.pv_indirizzo}
                  aria-describedby={pvErrors.pv_indirizzo ? 'pv_indirizzo-err' : undefined}
                />
                {pvErrors.pv_indirizzo && <p id="pv_indirizzo-err" role="alert" className="text-sm text-red-300 mt-1">{pvErrors.pv_indirizzo}</p>}
              </div>
              <div>
                <label htmlFor="pv_citta" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Città <span aria-hidden="true">*</span>
                </label>
                <input
                  id="pv_citta" name="pv_citta" type="text" required aria-required="true"
                  autoComplete="address-level2" maxLength={80} className="input-mobile"
                  ref={pvCittaRef} value={pvCitta}
                  onChange={(e) => { setPvCitta(e.target.value); clearPvError('pv_citta'); }}
                  aria-invalid={!!pvErrors.pv_citta}
                  aria-describedby={pvErrors.pv_citta ? 'pv_citta-err' : undefined}
                />
                {pvErrors.pv_citta && <p id="pv_citta-err" role="alert" className="text-sm text-red-300 mt-1">{pvErrors.pv_citta}</p>}
              </div>
              <div>
                <label htmlFor="pv_cap" className="block text-sm font-medium text-gray-300 mb-1.5">
                  CAP <span aria-hidden="true">*</span>
                </label>
                <input
                  id="pv_cap" name="pv_cap" type="text" inputMode="numeric" required aria-required="true"
                  autoComplete="postal-code" maxLength={10} className="input-mobile"
                  ref={pvCapRef} value={pvCap}
                  onChange={(e) => { setPvCap(e.target.value); clearPvError('pv_cap'); }}
                  aria-invalid={!!pvErrors.pv_cap}
                  aria-describedby={pvErrors.pv_cap ? 'pv_cap-err' : undefined}
                />
                {pvErrors.pv_cap && <p id="pv_cap-err" role="alert" className="text-sm text-red-300 mt-1">{pvErrors.pv_cap}</p>}
              </div>
              <div>
                <label htmlFor="pv_provincia" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Provincia <span aria-hidden="true">*</span>
                </label>
                <input
                  id="pv_provincia" name="pv_provincia" type="text" required aria-required="true"
                  autoComplete="address-level1" maxLength={40} className="input-mobile"
                  ref={pvProvinciaRef} value={pvProvincia}
                  onChange={(e) => { setPvProvincia(e.target.value); clearPvError('pv_provincia'); }}
                  aria-invalid={!!pvErrors.pv_provincia}
                  aria-describedby={pvErrors.pv_provincia ? 'pv_provincia-err' : undefined}
                />
                {pvErrors.pv_provincia && <p id="pv_provincia-err" role="alert" className="text-sm text-red-300 mt-1">{pvErrors.pv_provincia}</p>}
              </div>
              <div>
                <label htmlFor="pv_regione" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Regione
                </label>
                <input
                  id="pv_regione" name="pv_regione" type="text"
                  autoComplete="address-level1" maxLength={60} className="input-mobile"
                  value={pvRegione}
                  onChange={(e) => setPvRegione(e.target.value)}
                />
              </div>
            </div>
          </fieldset>
        )}
        {/* Live region persistente (sempre in DOM, contenuto via state):
            annuncia l'esito del lookup PV a screen reader. Mai render condizionale. */}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {pvLookupMsg}
        </div>
      </div>

      <div>
        <label htmlFor="motivo" className="block text-sm font-medium text-gray-300 mb-1.5">
          Motivo Reso *
        </label>
        <select
          id="motivo"
          required
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="input-mobile"
        >
          <option value="" disabled>Seleziona motivo...</option>
          <option value="difettoso">Prodotto difettoso</option>
          <option value="errato">Prodotto errato</option>
          <option value="non_conforme">Non conforme alla descrizione</option>
          <option value="altro">Altro</option>
        </select>
      </div>

      <LineeForm value={linee} onChange={setLinee} lineeDisponibili={lineePv} />

      <div>
        <label htmlFor="note" className="block text-sm font-medium text-gray-300 mb-1.5">
          Note aggiuntive
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="input-mobile min-h-[100px] resize-y"
          placeholder="Descrivi il problema riscontrato..."
          maxLength={2000}
        />
        <p className="text-xs text-gray-500 mt-1">{note.length}/2000</p>
      </div>

      <fieldset className="card-mobile space-y-4 min-w-0">
        <legend className="px-1 text-sm font-semibold text-gray-200">
          Dati per il ritiro corriere
          <span className="text-gray-500 font-normal"> (consigliato)</span>
        </legend>
        <p className="text-xs text-gray-400 -mt-2">
          Usati per generare il file di ritiro (.xls) dopo le approvazioni.
        </p>

        {/* Corriere */}
        <div>
          <label htmlFor="corriere" className="block text-sm font-medium text-gray-300 mb-1.5">
            Corriere *
          </label>
          <select
            id="corriere"
            required
            value={corriere}
            onChange={(e) => onCorriereChange(e.target.value)}
            className="input-mobile"
          >
            <option value="" disabled>Seleziona corriere...</option>
            <option value="GLS">GLS</option>
            <option value="NIEDDU">NIEDDU</option>
            <option value="TRAMES">TRAMES</option>
            <option value="PARENA">PARENA</option>
            <option value="ALTRI">ALTRI</option>
          </select>
        </div>

        {/* Nome corriere — solo se ALTRI. Live region annuncia la comparsa. */}
        {corriere === 'ALTRI' && (
          <div>
            <label htmlFor="corriere_nome" className="block text-sm font-medium text-gray-300 mb-1.5">
              Nome corriere *
            </label>
            <input
              id="corriere_nome"
              type="text"
              required
              value={corriereNome}
              onChange={(e) => setCorriereNome(e.target.value)}
              className="input-mobile"
              placeholder="Nome del corriere"
              maxLength={100}
              autoComplete="off"
              ref={corriereNomeRef}
            />
          </div>
        )}
        <div role="status" aria-live="polite" className="sr-only">
          {corriere === 'ALTRI' ? 'Inserisci il nome del corriere.' : ''}
        </div>

        {/* DDT + colli */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-700">
          <div>
            <label htmlFor="ddt_numero" className="block text-sm font-medium text-gray-300 mb-1.5">
              Numero DDT
            </label>
            <input
              id="ddt_numero"
              type="text"
              value={ddtNumero}
              onChange={(e) => setDdtNumero(e.target.value)}
              className="input-mobile"
              placeholder="Es. 12345"
              maxLength={30}
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor="ddt_data" className="block text-sm font-medium text-gray-300 mb-1.5">
              Data DDT
            </label>
            <input
              id="ddt_data"
              type="text"
              inputMode="numeric"
              value={ddtData}
              onChange={(e) => setDdtData(e.target.value)}
              className="input-mobile"
              placeholder="GG/MM/AAAA"
              pattern="(0[1-9]|[12]\d|3[01])/(0[1-9]|1[0-2])/\d{4}"
              aria-describedby="ddt_data-hint"
            />
            <p id="ddt_data-hint" className="text-xs text-gray-500 mt-1">Formato GG/MM/AAAA</p>
          </div>
        </div>

        <div>
          <label htmlFor="num_colli" className="block text-sm font-medium text-gray-300 mb-1.5">
            Numero colli
          </label>
          <input
            id="num_colli"
            type="number"
            inputMode="numeric"
            min={1}
            max={9999}
            value={numColli}
            onChange={(e) => setNumColli(e.target.value)}
            className="input-mobile"
            placeholder="1"
            autoComplete="off"
            aria-describedby="num_colli-hint"
          />
          <p id="num_colli-hint" className="text-xs text-gray-500 mt-1">
            Pacchi totali per il corriere (non per linea).
          </p>
        </div>
      </fieldset>

      <div>
        <span className="block text-sm font-medium text-gray-300 mb-1.5">
          Foto <span className="text-gray-500">(max 5)</span>
        </span>
        <CameraUpload onUpload={setFoto} maxFiles={5} />
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {loading ? 'Invio della richiesta in corso.' : ''}
      </div>

      <button type="submit" disabled={loading || !motivo || !corriere || !cldm || (!pv && !pvNotFound)} className="btn-mobile">
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            Invio in corso...
          </span>
        ) : (
          'Invia Richiesta Reso'
        )}
      </button>
    </form>
  );
}