'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import MobileHeader from '@/components/layout/MobileHeader';
import { ListaSkeleton } from '@/components/ui/SkeletonLoader';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import ConfirmSheet from '@/components/ui/ConfirmSheet';
import { useToast } from '@/components/ui/Toast';
import { CheckCircleIcon, XCircleIcon, ChevronDownIcon, ChevronUpIcon, ArrowRightIcon, DocumentArrowDownIcon, PaperAirplaneIcon, PrinterIcon } from '@heroicons/react/24/outline';

interface Richiesta {
  id: number;
  uuid: string;
  numero_ordine_esterno: string;
  motivo_reso: string;
  // 2026-09-16 P1: motivazione manuale (solo quando motivo_reso = 'altro')
  motivo_altro?: string | null;
  stato: string;
  note: string | null;
  note_venditore: string | null;
  data_approvazione: string;
  created_at: string;
  richiedente_nome: string;
  richiedente_azienda: string;
  venditore_nome: string | null;
  cldm?: string | null;
  ddt_numero?: string | null;
  num_colli?: number | null;
  bda_autorizzazione?: string | null;
  num_reso?: number | null;
  data_spedizione?: string | null;
  corriere?: string | null;
}

type Vista = 'da_approvare' | 'approvati' | 'inviati';

const TABS: { v: Vista; label: string; tabId: string; panelId: string }[] = [
  { v: 'da_approvare', label: 'Da gestire', tabId: 'tab-da-approvare', panelId: 'panel-da-approvare' },
  { v: 'approvati', label: 'Approvati', tabId: 'tab-approvati', panelId: 'panel-approvati' },
  { v: 'inviati', label: 'Inviati', tabId: 'tab-inviati', panelId: 'panel-inviati' },
];

const STATO_BADGE: Record<string, { label: string; cls: string }> = {
  approvato: { label: 'Approvato', cls: 'text-green-400 bg-green-500/10 border-green-500/20' },
  spedito: { label: 'Spedito', cls: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  completato: { label: 'Completato', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
};

interface SearchParams { cldm: string; num_reso: string; data_da: string; data_a: string; }

export default function CSRRichiestePage() {
  const { addToast } = useToast();
  const [data, setData] = useState<Richiesta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [azione, setAzione] = useState<{ uuid: string; tipo: 'approvato' | 'rifiutato'; note: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [vista, setVista] = useState<Vista>('da_approvare');
  const [downloadingUuid, setDownloadingUuid] = useState<string | null>(null);

  // Paginazione (2026-09-16 P3): il server pagina (per_page=20) ma prima la UI
  // non la gestiva — i resi oltre la prima pagina erano invisibili.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const PER_PAGE = 20;

  // Ricerca
  const [sCldm, setSCldm] = useState('');
  const [sNumReso, setSNumReso] = useState('');
  const [sDataDa, setSDataDa] = useState('');
  const [sDataA, setSDataA] = useState('');
  const [applied, setApplied] = useState<SearchParams | null>(null);

  // Selezione + azioni massive (tutte le tab, 2026-09-16 P4):
  // da_approvare → approva/rifiuta batch; approvati → export; inviati → ristampa.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  // Nota condivisa opzionale per l'azione massiva su "Da gestire".
  const [notaBatch, setNotaBatch] = useState('');
  // Conferma batch: {tipo} apre il ConfirmSheet (il batch approvato spara
  // N webhook + N email — conferma esplicita come per l'export singolo).
  const [batchConfirm, setBatchConfirm] = useState<{ tipo: 'approvato' | 'rifiutato' } | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);
  const [ristampando, setRistampando] = useState(false);

  // Live region persistente
  const [msg, setMsg] = useState('');

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  function buildQuery(v: Vista, s: SearchParams | null, p: number) {
    const params = new URLSearchParams();
    params.set('view', v);
    params.set('page', String(p));
    params.set('per_page', String(PER_PAGE));
    if (s) {
      if (s.cldm.trim()) params.set('cldm', s.cldm.trim());
      if (s.num_reso.trim()) params.set('num_reso', s.num_reso.trim());
      if (s.data_da) params.set('data_da', s.data_da);
      if (s.data_a) params.set('data_a', s.data_a);
    }
    return params.toString();
  }

  const fetchData = useCallback(async (v: Vista, s: SearchParams | null, p: number) => {
    setLoading(true);
    setError('');
    setMsg('Ricerca in corso…');
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/customer-service/richieste?${buildQuery(v, s, p)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Errore caricamento');
      const json = await res.json();
      setData(json.data || []);
      setTotal(json.total || 0);
      setMsg((json.data?.length || 0) > 0
        ? `${json.total} risultati trovati — pagina ${json.page} di ${Math.max(1, Math.ceil((json.total || 1) / (json.per_page || PER_PAGE)))}`
        : 'Nessun risultato');
    } catch {
      setError('Impossibile caricare le richieste.');
      setMsg('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setExpanded(null);
    setAzione(null);
    setSelected(new Set());
    fetchData(vista, applied, page);
  }, [fetchData, vista, applied, page]);

  // Cambio pagina: azzera la selezione (i checkbox selezionati non sono piu'
  // visibili) e annuncia la nuova pagina agli screen reader.
  function onPageChange(p: number) {
    setSelected(new Set());
    setPage(p);
  }

  // Select-all indeterminato: visivo per stato parziale (WCAG: l'attr indeterminate non
  // si setta via React, serve ref + effetto). Attivo in tutte le tab (selezione
  // multipla ovunque, 2026-09-16 P4).
  useEffect(() => {
    if (selectAllRef.current) {
      const n = selected.size;
      selectAllRef.current.indeterminate = n > 0 && n < data.length;
    }
  }, [selected, data.length]);

  // Navigazione tastiera tabs (WAI-ARIA APG): frecce sx/dx, Home/End, roving tabindex.
  function onTabKeyDown(e: React.KeyboardEvent, idx: number) {
    const last = TABS.length - 1;
    let next = idx;
    if (e.key === 'ArrowRight') next = idx === last ? 0 : idx + 1;
    else if (e.key === 'ArrowLeft') next = idx === 0 ? last : idx - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    const target = TABS[next];
    setVista(target.v);
    setPage(1);
    requestAnimationFrame(() => tabRefs.current[target.v]?.focus());
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setApplied({ cldm: sCldm, num_reso: sNumReso, data_da: sDataDa, data_a: sDataA });
  }

  function onSearchReset() {
    setSCldm('');
    setSNumReso('');
    setSDataDa('');
    setSDataA('');
    setPage(1);
    setApplied(null);
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(data.map((r) => r.uuid)) : new Set());
  }

  function toggleOne(uuid: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(uuid); else next.delete(uuid);
      return next;
    });
  }

  // Scarica il file corriere RITGIO*.xls del reso (download diretto dalla lista).
  async function downloadXls(uuid: string) {
    setDownloadingUuid(uuid);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/customer-service/richieste/${uuid}/xls`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Errore generazione file');
      }
      const disp = res.headers.get('Content-Disposition') || '';
      const m = disp.match(/filename="?([^"]+)"?/i);
      const filename = m ? m[1] : `RITGIO_${uuid.slice(0, 8)}.xls`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      addToast('success', `File ${filename} scaricato`);
    } catch (err: unknown) {
      addToast('error', (err as Error).message || 'Errore download file corriere');
    } finally {
      setDownloadingUuid(null);
    }
  }

  // Esporta e invia: POST /richieste/export con i selezionati → XLS multi-riga + mark spedito.
  async function onExport() {
    if (selected.size === 0) return;
    setExporting(true);
    setMsg(`Esportazione di ${selected.size} resi in corso…`);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/customer-service/richieste/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ uuids: Array.from(selected) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Errore esportazione');
      }
      const disp = res.headers.get('Content-Disposition') || '';
      const m = disp.match(/filename="?([^"]+)"?/i);
      const filename = m ? m[1] : `RITGIO_selezionati.xls`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      addToast('success', `Esportati ${selected.size} resi — ora in "Inviati"`);
      setMsg(`Esportati ${selected.size} resi. Ora si trovano in "Inviati".`);
      setSelected(new Set());
      // Ricarica: i resi esportati lasciano "Approvati" (ora spediti).
      await fetchData(vista, applied, page);
      // Focus management: la barra export (e i suoi checkbox) potrebbero scomparire
      // dopo il refresh (resi→spediti, lista vuota). Sposta il focus sul tab
      // "Approvati" (sempre presente) per evitare focus nel vuoto (WCAG 2.4.3).
      requestAnimationFrame(() => tabRefs.current['approvati']?.focus());
    } catch (err: unknown) {
      const m = (err as Error).message || 'Errore esportazione';
      addToast('error', m);
      setMsg(`Esportazione fallita: ${m}`);
    } finally {
      setExporting(false);
    }
  }

  // Azione massiva sulla tab "Da gestire" (2026-09-16 P4): POST /richieste/
  // azione-batch con i selezionati + nota condivisa opzionale. Idempotente
  // lato server (solo resi in_revisione).
  async function onBatchAzione(tipo: 'approvato' | 'rifiutato') {
    if (selected.size === 0) return;
    setBatchConfirm(null);
    setBatchSaving(true);
    setMsg(`${tipo === 'approvato' ? 'Approvazione' : 'Rifiuto'} di ${selected.size} resi in corso…`);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/customer-service/richieste/azione-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ uuids: Array.from(selected), stato: tipo, note: notaBatch.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Errore azione massiva');
      const n = j.aggiornati ?? selected.size;
      addToast('success', tipo === 'approvato' ? `${n} resi approvati — ora in "Approvati"` : `${n} resi rifiutati`);
      setMsg(`${n} resi ${tipo === 'approvato' ? 'approvati' : 'rifiutati'}.`);
      setSelected(new Set());
      setNotaBatch('');
      await fetchData('da_approvare', applied, page);
      // Focus management: la barra azioni (checkbox + textarea) puo' scomparire
      // dopo il refresh (lista svuotata). Focus sul tab sempre presente (WCAG 2.4.3).
      requestAnimationFrame(() => tabRefs.current['da_approvare']?.focus());
    } catch (err: unknown) {
      const m = (err as Error).message || 'Errore azione massiva';
      addToast('error', m);
      setMsg(`Azione fallita: ${m}`);
    } finally {
      setBatchSaving(false);
    }
  }

  // Ristampa report XLS multi-riga dei selezionati nella tab "Inviati"
  // (2026-09-16 P4): POST /richieste/ristampa-xls. Nessun cambio di stato.
  async function onRistampa() {
    if (selected.size === 0) return;
    setRistampando(true);
    setMsg(`Generazione report XLS di ${selected.size} resi in corso…`);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/customer-service/richieste/ristampa-xls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ uuids: Array.from(selected) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Errore ristampa');
      }
      const disp = res.headers.get('Content-Disposition') || '';
      const m = disp.match(/filename="?([^"]+)"?/i);
      const filename = m ? m[1] : `RITGIO_ristampa.xls`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      addToast('success', `Report ${filename} scaricato`);
      setMsg(`Report XLS di ${selected.size} resi scaricato.`);
    } catch (err: unknown) {
      const m = (err as Error).message || 'Errore ristampa XLS';
      addToast('error', m);
      setMsg(`Ristampa fallita: ${m}`);
    } finally {
      setRistampando(false);
    }
  }

  async function handleAzione(uuid: string, tipo: 'approvato' | 'rifiutato') {
    if (!azione || azione.uuid !== uuid) {
      setAzione({ uuid, tipo, note: '' });
      return;
    }
    setSaving(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/customer-service/richieste/${uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stato: tipo, note: azione.note || undefined }),
      });
      if (!res.ok) throw new Error('Errore');
      addToast('success', tipo === 'approvato' ? 'Richiesta approvata — ora in "Approvati"' : 'Richiesta rifiutata');
      setAzione(null);
      if (tipo === 'approvato') { setVista('approvati'); setPage(1); }
      else fetchData('da_approvare', applied, page);
    } catch {
      addToast('error', 'Errore durante l\'operazione');
    } finally {
      setSaving(false);
    }
  }

  const activeTab = TABS.findIndex((t) => t.v === vista);

  return (
    <div className="min-h-dvh bg-gray-950">
      <MobileHeader title="Gestione resi" />

      <div className="pt-4">
        {/* Tabs WAI-ARIA: role=tablist, roving tabindex, aria-selected/aria-controls,
            navigazione tastiera (frecce/Home/End). WCAG 2.1.1 + 4.1.2 + APG tabs. */}
        <div role="tablist" aria-label="Filtro richieste resi" className="mb-4 flex gap-2 p-1 bg-gray-800 rounded-2xl border border-gray-700">
          {TABS.map((t, idx) => {
            const selected = vista === t.v;
            return (
              <button
                key={t.v}
                ref={(el) => { tabRefs.current[t.v] = el; }}
                id={t.tabId}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={t.panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => { setVista(t.v); setPage(1); }}
                onKeyDown={(e) => onTabKeyDown(e, idx)}
                className={`flex-1 h-11 rounded-xl text-sm font-medium transition-colors ${selected ? 'bg-blue-600 text-white' : 'text-gray-300 active:bg-gray-700'}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Pannello attivo (render condizionale: aria-controls punta a panel esistente). */}
        <div role="tabpanel" id={TABS[activeTab].panelId} aria-labelledby={TABS[activeTab].tabId} tabIndex={0}>
          {/* Ricerca: si applica dentro il tab attivo (spec flag #5). Fieldset+legend, label htmlFor. */}
          <form onSubmit={onSearchSubmit} className="mb-4">
            <fieldset className="bg-gray-800 rounded-2xl border border-gray-700 p-4">
              <legend className="px-2 text-sm font-medium text-gray-300">Ricerca resi</legend>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label htmlFor="src-cldm" className="block text-xs font-medium text-gray-400 mb-1">CLDM</label>
                  <input
                    id="src-cldm" name="cldm" type="text" autoComplete="off"
                    value={sCldm} onChange={(e) => setSCldm(e.target.value)}
                    className="input-mobile" placeholder="es. 520059"
                  />
                </div>
                <div>
                  <label htmlFor="src-numreso" className="block text-xs font-medium text-gray-400 mb-1">Num. reso</label>
                  <input
                    id="src-numreso" name="num_reso" type="number" inputMode="numeric" autoComplete="off"
                    value={sNumReso} onChange={(e) => setSNumReso(e.target.value)}
                    className="input-mobile" placeholder="es. 1"
                  />
                </div>
                <div>
                  <label htmlFor="src-data-da" className="block text-xs font-medium text-gray-400 mb-1">Approvato dal</label>
                  <input
                    id="src-data-da" name="data_da" type="date" autoComplete="off"
                    value={sDataDa} onChange={(e) => setSDataDa(e.target.value)}
                    className="input-mobile"
                  />
                </div>
                <div>
                  <label htmlFor="src-data-a" className="block text-xs font-medium text-gray-400 mb-1">Al</label>
                  <input
                    id="src-data-a" name="data_a" type="date" autoComplete="off"
                    value={sDataA} onChange={(e) => setSDataA(e.target.value)}
                    className="input-mobile"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button type="submit" className="flex-1 h-11 bg-blue-600 text-white font-medium rounded-xl active:bg-blue-700 transition-colors">
                  Cerca
                </button>
                <button type="reset" onClick={onSearchReset} className="h-11 px-4 bg-gray-700 text-gray-200 font-medium rounded-xl active:bg-gray-600 transition-colors">
                  Reset
                </button>
              </div>
            </fieldset>
          </form>

          {/* Live region persistente (sempre in DOM, contenuto via stato). */}
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{msg}</div>

          {error && (
            <div role="alert" className="mb-4 p-3 bg-red-900/30 text-red-300 rounded-xl border border-red-800 text-sm">
              {error}
            </div>
          )}

          {/* Barra azioni massive (2026-09-16 P4): selezione multipla in tutte
              le tab. Select-all con aria-label contestuale per tab. */}
          {!loading && data.length > 0 && (
            <div className="mb-3 p-3 bg-gray-800 rounded-2xl border border-gray-700 space-y-3">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-300 min-h-[44px] cursor-pointer">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="w-5 h-5 accent-blue-600"
                    checked={selected.size === data.length && data.length > 0}
                    onChange={(e) => toggleAll(e.target.checked)}
                    aria-label={`Seleziona tutti i ${vista === 'da_approvare' ? 'resi da gestire' : vista === 'approvati' ? 'resi approvati' : 'resi inviati'}`}
                  />
                  <span>Seleziona tutti</span>
                </label>

                {vista === 'da_approvare' && (
                  <div className="ml-auto flex gap-2">
                    <button
                      type="button"
                      onClick={() => setBatchConfirm({ tipo: 'rifiutato' })}
                      disabled={selected.size === 0 || batchSaving}
                      aria-label={`Rifiuta ${selected.size} resi selezionati`}
                      className="inline-flex items-center justify-center gap-1.5 h-11 px-3 bg-red-900/30 text-red-300 font-medium rounded-xl border border-red-800 active:bg-red-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <XCircleIcon className="w-5 h-5" aria-hidden="true" />
                      Rifiuta ({selected.size})
                    </button>
                    <button
                      type="button"
                      onClick={() => setBatchConfirm({ tipo: 'approvato' })}
                      disabled={selected.size === 0 || batchSaving}
                      aria-label={`Approva ${selected.size} resi selezionati`}
                      className="inline-flex items-center justify-center gap-1.5 h-11 px-3 bg-green-600 text-white font-medium rounded-xl active:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckCircleIcon className="w-5 h-5" aria-hidden="true" />
                      Approva ({selected.size})
                    </button>
                  </div>
                )}

                {vista === 'approvati' && (
                  <button
                    type="button"
                    onClick={onExport}
                    disabled={selected.size === 0 || exporting}
                    aria-busy={exporting}
                    aria-label={`Esporta e invia ${selected.size} resi selezionati al corriere`}
                    className="ml-auto inline-flex items-center justify-center gap-2 h-11 px-4 bg-green-600 text-white font-medium rounded-xl active:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {exporting ? (
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                    ) : (
                      <PaperAirplaneIcon className="w-5 h-5" aria-hidden="true" />
                    )}
                    Esporta e invia ({selected.size})
                  </button>
                )}

                {vista === 'inviati' && (
                  <button
                    type="button"
                    onClick={onRistampa}
                    disabled={selected.size === 0 || ristampando}
                    aria-busy={ristampando}
                    aria-label={`Ristampa report XLS di ${selected.size} resi selezionati`}
                    className="ml-auto inline-flex items-center justify-center gap-2 h-11 px-4 bg-blue-600 text-white font-medium rounded-xl active:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {ristampando ? (
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                    ) : (
                      <PrinterIcon className="w-5 h-5" aria-hidden="true" />
                    )}
                    Ristampa report XLS ({selected.size})
                  </button>
                )}
              </div>

              {/* Nota condivisa opzionale per l'azione massiva (solo "Da gestire"). */}
              {vista === 'da_approvare' && (
                <div>
                  <label htmlFor="nota-batch" className="block text-xs font-medium text-gray-400 mb-1">
                    Nota (opzionale per tutti i selezionati)
                  </label>
                  <textarea
                    id="nota-batch"
                    value={notaBatch}
                    onChange={(e) => setNotaBatch(e.target.value)}
                    className="input-mobile min-h-[60px] resize-y"
                    placeholder="Note opzionali applicate a tutti i resi selezionati..."
                    maxLength={2000}
                  />
                </div>
              )}
            </div>
          )}

          {loading ? (
            <ListaSkeleton count={5} />
          ) : data.length === 0 ? (
            <EmptyState
              title={vista === 'da_approvare' ? 'Nessuna richiesta' : vista === 'approvati' ? 'Nessun reso approvato' : 'Nessun reso inviato'}
              description={vista === 'da_approvare'
                ? 'Non ci sono richieste in attesa di gestione.'
                : vista === 'approvati'
                  ? 'Non ci sono resi approvati. Quando approvi un reso lo ritrovi qui per esportarlo e inviarlo al corriere.'
                  : 'Non ci sono resi inviati al corriere. Esporta i resi approvati per trovarli qui.'}
            />
          ) : (
            <div className="space-y-3">
              {data.map((r) => {
                const panelId = `det-${r.uuid}`;
                const isExpanded = expanded === r.uuid;
                const badge = STATO_BADGE[r.stato];
                const isSelected = selected.has(r.uuid);
                return (
                <div key={r.uuid} className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
                  <div className="flex items-stretch">
                    {/* Checkbox (tutte le tab, 2026-09-16 P4): elemento separato
                        dall'accordion header (click non espande la riga). */}
                    <div className="flex items-center justify-center min-w-[44px] min-h-[44px] pl-3">
                      <input
                        type="checkbox"
                        className="w-5 h-5 accent-blue-600"
                        checked={isSelected}
                        onChange={(e) => toggleOne(r.uuid, e.target.checked)}
                        aria-label={`Seleziona reso n. ${r.num_reso ?? r.numero_ordine_esterno}`}
                      />
                    </div>
                    {/* Header espandibile: <button> reale (focusabile, aria-expanded/aria-controls). */}
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      onClick={() => setExpanded(isExpanded ? null : r.uuid)}
                      className="flex-1 flex items-center justify-between p-4 text-left active:bg-gray-700/50 transition-colors"
                    >
                      <span className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronUpIcon className="w-5 h-5 text-gray-400" aria-hidden="true" />
                        ) : (
                          <ChevronDownIcon className="w-5 h-5 text-gray-400" aria-hidden="true" />
                        )}
                        <span className="text-left">
                          <span className="block font-medium text-white text-sm">
                            {r.num_reso ? `Reso N. ${r.num_reso}` : r.numero_ordine_esterno}
                          </span>
                          <span className="block text-xs text-gray-400">{r.richiedente_nome} — {r.richiedente_azienda}</span>
                        </span>
                      </span>
                      {vista === 'da_approvare' ? (
                        <span className="text-xs font-medium text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-1 rounded-full">
                          In revisione
                        </span>
                      ) : badge ? (
                        <span className={`text-xs font-medium px-2 py-1 rounded-full border ${badge.cls}`}>
                          {badge.label}
                        </span>
                      ) : null}
                    </button>
                  </div>

                  {isExpanded && (
                    <div id={panelId} className="px-4 pb-4 border-t border-gray-700">
                      <div className="py-3 space-y-2 text-sm text-gray-300">
                        <p><span className="text-gray-500">Motivo:</span> {r.motivo_reso.replace('_', ' ')}</p>
                        {r.motivo_altro && <p><span className="text-gray-500">Altro:</span> {r.motivo_altro}</p>}
                        <p><span className="text-gray-500">Venditore:</span> {r.venditore_nome || '—'}</p>
                        {r.note && <p><span className="text-gray-500">Note:</span> {r.note}</p>}
                        {r.note_venditore && <p><span className="text-gray-500">Note venditore:</span> {r.note_venditore}</p>}
                        {r.data_approvazione && (
                          <p><span className="text-gray-500">Data approvazione:</span> {new Date(r.data_approvazione).toLocaleString('it-IT')}</p>
                        )}
                        {r.data_spedizione && (
                          <p><span className="text-gray-500">Data spedizione:</span> {new Date(r.data_spedizione).toLocaleString('it-IT')}</p>
                        )}
                        {(r.cldm || r.ddt_numero || r.num_colli || r.corriere) && (
                          <p className="text-xs text-gray-500">
                            CLDM {r.cldm || '—'} · DDT {r.ddt_numero || '—'} · Colli {r.num_colli ?? '—'} · Corriere {r.corriere || '—'}
                          </p>
                        )}
                      </div>

                      <Link
                        href={`/customer-service/richieste/${r.uuid}`}
                        className="mb-3 inline-flex items-center gap-1 text-xs text-blue-400 active:text-blue-300 min-h-[44px] py-2"
                      >
                        Vedi dettaglio completo (prodotti e dati corriere)
                        <ArrowRightIcon className="w-4 h-4" aria-hidden="true" />
                      </Link>

                      {vista === 'da_approvare' && azione?.uuid === r.uuid && (
                        <div className="mb-3">
                          <label htmlFor={`note-${r.uuid}`} className="block text-xs font-medium text-gray-400 mb-1.5">
                            Note {azione.tipo === 'approvato' ? 'approvazione' : 'rifiuto'}
                          </label>
                          <textarea
                            id={`note-${r.uuid}`}
                            value={azione.note}
                            onChange={(e) => setAzione({ ...azione, note: e.target.value })}
                            className="input-mobile min-h-[60px] resize-y"
                            placeholder="Note opzionali..."
                          />
                        </div>
                      )}

                      {vista === 'da_approvare' ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAzione(r.uuid, 'rifiutato')}
                            disabled={saving}
                            className="flex-1 h-12 bg-red-900/30 text-red-300 font-medium rounded-xl border border-red-800 active:bg-red-900/50 transition-colors flex items-center justify-center gap-2"
                          >
                            <XCircleIcon className="w-5 h-5" aria-hidden />
                            {azione?.uuid === r.uuid && azione.tipo === 'rifiutato' ? 'Conferma rifiuto' : 'Rifiuta'}
                          </button>
                          <button
                            onClick={() => handleAzione(r.uuid, 'approvato')}
                            disabled={saving}
                            className="flex-1 h-12 bg-green-600 text-white font-medium rounded-xl active:bg-green-700 transition-colors flex items-center justify-center gap-2"
                          >
                            <CheckCircleIcon className="w-5 h-5" aria-hidden />
                            {azione?.uuid === r.uuid && azione.tipo === 'approvato' ? 'Conferma approvazione' : 'Approva'}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => downloadXls(r.uuid)}
                          disabled={downloadingUuid === r.uuid}
                          aria-busy={downloadingUuid === r.uuid}
                          aria-label={`Scarica file corriere RITGIO del reso ${r.num_reso ?? r.numero_ordine_esterno}`}
                          className="w-full h-12 flex items-center justify-center gap-2 bg-blue-600 text-white font-medium rounded-xl active:bg-blue-700 transition-colors disabled:opacity-60"
                        >
                          {downloadingUuid === r.uuid ? (
                            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                          ) : (
                            <DocumentArrowDownIcon className="w-5 h-5" aria-hidden="true" />
                          )}
                          Scarica file corriere (RITGIO*.xls)
                        </button>
                      )}
                      {vista === 'da_approvare' && (
                        <p className="mt-2 text-[11px] text-gray-500">
                          L'approvazione finale invia il reso ad ABC HUB e genera l'email di autorizzazione al corriere. Il rifiuto chiude la pratica.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}

          {/* Paginazione (2026-09-16 P3): visibile solo se c'e' piu' di una
              pagina. Etichetta contestuale per tab nel nav aria-label. */}
          {!loading && total > PER_PAGE && (
            <Pagination
              page={page}
              total={total}
              perPage={PER_PAGE}
              label={vista === 'da_approvare' ? 'resi da gestire' : vista === 'approvati' ? 'resi approvati' : 'resi inviati'}
              onPageChange={onPageChange}
            />
          )}
        </div>
      </div>

      {/* Conferma azione massiva (2026-09-16 P4): il batch approvato spara N
          webhook + N email — conferma esplicita come per l'export. */}
      <ConfirmSheet
        open={batchConfirm !== null}
        title={batchConfirm?.tipo === 'approvato' ? 'Approvazione massiva' : 'Rifiuto massivo'}
        message={`Confermi l'operazione su ${selected.size} resi selezionati?${batchConfirm?.tipo === 'approvato' ? ' Per ogni reso partiranno l\'invio ad ABC HUB e l\'email di autorizzazione.' : ''}${notaBatch.trim() ? ' La nota verrà applicata a tutti.' : ''}`}
        confirmText={batchConfirm?.tipo === 'approvato' ? `Approva ${selected.size} resi` : `Rifiuta ${selected.size} resi`}
        variant={batchConfirm?.tipo === 'approvato' ? 'primary' : 'danger'}
        onConfirm={() => batchConfirm && onBatchAzione(batchConfirm.tipo)}
        onCancel={() => setBatchConfirm(null)}
      />
    </div>
  );
}
