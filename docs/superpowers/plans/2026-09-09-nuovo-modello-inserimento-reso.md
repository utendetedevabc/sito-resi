# Nuovo modello di inserimento reso — Implementation Plan (revisionato post pre-flight)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere l'inserimento del PV manuale come fallback quando il cldm non è in anagrafica, preservando il routing F11 e le linee auto-popolate per i cldm noti.

**Architecture:** `cldm` resta obbligatorio nel form. Su blur, lookup `anagrafica_pv`: se trovato → pv_*/linee/resp_codice derivati come oggi (PV mostrato read-only); se NON trovato → reveal condizionale di campi pv_* manuali (obbligatori) + messaggio live-region; il server accetta pv_* dal body solo quando il lookup fallisce (resp_codice NULL in quel caso). Tutto il resto del piano originale è già implementato.

**Tech Stack:** Next 16 + Express custom server (sito-resi :3002 dev), SQLite better-sqlite3, zod, React (.tsx). UI in italiano, WCAG AA.

## Global Constraints

- Dev-first, MAI restartare/toccare prod Express (:3001, pid 3545347, `.express.pid`). Modifiche `server/modules/*.js` e `server/lib/*.js` → restart dev :3002 (kill lsof:3002 + rm .next/dev/lock + node server.js). Modifiche `.tsx` → hot-reload.
- UI in italiano. WCAG AA mandatory per ogni UI (gate a11y: consultare accessibility-lead prima di editare .tsx).
- Backward compat: colonne vecchie (`prodotti, cldm, bda_autorizzazione, bda_hash, num_colli, ddt_numero, ddt_data`) restano; resi vecchi invariati.
- Nessuna nuova dipendenza. Migrazioni idempotenti (addColumnIfMissing + CREATE TABLE IF NOT EXISTS), mai drop.
- `num_reso` immutabile dopo creazione (generato solo all'INSERT).
- Password/secret mai loggati/committati.

## Pre-flight findings (riconciliazione vs F10/F11)

Il piano originale è già implementato al ~90%. NESSUNA migrazione DB necessaria (tutte le colonne esistono già in sito-resi `richieste_reso` e ABC HUB `resi_in_ingresso`).

Già fatto (NO-OP, non toccare):
- Colonne DB `linee, corriere, corriere_nome, pv_*, num_reso, resp_*` — presenti in entrambi i repo.
- `linee` shape `{nome, numero_pezzi}` (LineeForm.tsx) — identica al piano.
- `num_reso` sequenziale MAX+1 per OGNI reso (resi.js:108, query senza WHERE corriere) — non solo-GLS come diceva la memory F10 (stale).
- Corriere enum + `corriere_nome` condizionale — già in form/validation/webhook.
- `num_colli` singolo in "dati ritiro corriere".
- Destinatario XLS "ABC SRL RESI" — già applicato (xls-export.js:23, resi-webhook.js:41).
- `num_reso` come "Num. Autorizzazione" nell'XLS con precedenza su BDA (xls-export.js:77).
- Webhook payload completo di tutti i campi nuovi (webhook.js:22-47).
- 3 pagine dettaglio renderizzano linee + pv_* + badge "Reso N." (no BDA).
- BDA assente dal form e dalle pagine dettaglio.
- ABC HUB `resiWebhookSchema` accetta `pv_*` + `num_reso` (linee con numero_pezzi preservato).

UNICA parte residua: **PV manuale come fallback su cldm-non-trovato**.

## Decisione utente (raffinata)

> "l'inserimento manuale deve essere solo nel caso non trovasse il cldm."

- `cldm` resta **OBBLIGATORIO** nel form (sempre inserito dall'utente).
- Lookup `anagrafica_pv` su blur:
  - **Trovato** → pv_* derivati (read-only), linee disponibili dal PV, resp_codice/resp_nome derivati (routing F11 attivo). Come oggi.
  - **NON trovato** → reveal condizionale di campi pv_* **manuali obbligatori** (pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia; pv_regione opzionale) + messaggio live-region "CLDM non trovato in anagrafica — inserisci i dati del PV manualmente". linee: LineeForm free-text (lineeDisponibili vuote → l'utente usa 'Altro'). resp_codice NULL (reso visibile ai soli venditori generici, backward-compat F11).
- Server: usa pv_* dal body SOLO quando lookup fallisce; resp_codice NULL in quel caso. Quando lookup ha successo, ignora eventuali pv_* del body (comportamento attuale).

## File map

| File | Modifica |
|---|---|
| `server/modules/resi.js` | POST+PUT: fallback pv_* dal body quando `lookupPvByCldm` null; rimuove il 400 hard "CLDM non presente"; valida pv_* essenziali quando lookup fallisce. |
| `server/modules/validation.js` | NESSUNA modifica (pv_* già optional/nullable; cldm già required). Vincolo pv_* condizionale enforcement lato server. |
| `server/lib/db.js` | NESSUNA modifica (colonne già presenti). |
| `server/lib/xls-export.js` | NESSUNA modifica (già usa pv_* con fallback resolvePv(cldm)). |
| `server/modules/webhook.js` | NESSUNA modifica (payload già completo). |
| `src/components/ui/LineeForm.tsx` | NESSUNA modifica (shape già compatibile; lineeDisponibili vuote → free-text via Altro). |
| `src/components/resi/ResoForm.tsx` | **MODIFICA** (a11y gated): reveal condizionale campi pv_* manuali su cldm-non-trovato + live-region + focus management. |
| 3 pagine dettaglio | NESSUNA modifica (già renderizzano pv_*). |
| ABC HUB `resi-webhook.js` | NESSUNA modifica. |

---

## Task 1: Backend — fallback pv_* manuali su cldm non trovato

**Files:**
- Modify: `server/modules/resi.js` (POST `/` righe ~76-89 lookup block; PUT `/` riga ~277 lookup block)

**Interfaces:**
- Consumes: `lookupPvByCldm(cldm)` da `server/lib/anagrafica.js` (ritorna `{nome, indirizzo, citta, cap, provincia, regione, resp_codice, resp_nome, linee[], ...}` o `null`).
- Produces: POST `/` e PUT `/` accettano un cldm non in anagrafica purché il body contenga pv_* essenziali; memorizzano pv_* dal body e resp_codice=NULL.

**Stato attuale (da preservare):** resi.js POST riga 76-89 fa `const pv = lookupPvByCldm(cldm); if (!pv) return res.status(400).json({ error: 'CLDM non presente in anagrafica...', cldm });` poi deriva pvNome..respNome dal lookup. PUT riga ~277 riapplica lookupPvByCldm se cldm presente e sovrascrive pv_*/resp_*.

- [ ] **Step 1: POST — fallback pv_* dal body quando lookup null**

Sostituire il blocco `if (!pv) return res.status(400)...` con: se `pv` trovato → usa lookup (pvNome=pv.nome||null, ..., respCodice=pv.resp_codice||null, respNome=pv.resp_nome||null) [invariato]. Se `!pv` → leggi pv_* dal body validated (`pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione`), imposta `respCodice=null, respNome=null`, e valida i campi essenziali: se manca uno tra `pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia` → `return res.status(400).json({ error: 'CLDM non trovato in anagrafica: inserisci manualmente i dati del PV (nome, indirizzo, città, CAP, provincia).', cldm, pv_not_found: true })`. pv_regione resta opzionale. Mantenere l'INSERT a 27 colonne/placeholder/arg invariato (i valori pv_*/resp_* ora possono venire dal body).

- [ ] **Step 2: PUT — stesso fallback**

Nel PUT, dove riapplica `lookupPvByCldm(cldm)`: se lookup trovato → usa lookup (invariato). Se null → usa pv_* dal body (se forniti), resp_codice/resp_nome = null. Non 400are (il PUT può aggiornare un reso il cui cldm non è in anagrafica). Mantenere il SET a 22 colonne invariato.

- [ ] **Step 3: Test manuale dev**

Restart dev :3002. Test A (cldm noto, es. uno presente in anagrafica_pv): POST con cldm + linee + corriere → 201, pv_* derivati dal lookup, resp_codice popolato. Test B (cldm NON in anagrafica, es. 'ZZZFAKE'): POST con cldm + pv_* manuali completi + linee + corriere → 201, pv_* dal body, resp_codice NULL. Test C (cldm non in anagrafica SENZA pv_*): POST → 400 `{pv_not_found:true}`. Verifica GET dettaglio dei resi B ritorna pv_* manuali.

- [ ] **Step 4: Commit**

`git add server/modules/resi.js && git commit -m "feat(resi): fallback PV manuale quando cldm non in anagrafica"`

---

## Task 2: UI — reveal condizionale campi PV manuali su cldm non trovato (a11y gated)

**Files:**
- Modify: `src/components/resi/ResoForm.tsx` (sezione CLDM/PV riga ~209-273; body POST riga ~75-86)

**a11y gate:** Consultare accessibility-lead PRIMA di editare (hook PreToolUse blocca Edit/Write su .tsx). Applicare: aria-specialist (reveal condizionale aria-expanded/aria-controls), live-region-controller (messaggio stato), forms-specialist (label, required, error), keyboard-navigator (focus al primo campo pv_*, tab order), contrast-master (>=4.5:1). La guida a11y va incorporata nel brief dell'implementer.

**Interfaces:**
- Consumes: stato lookup PV (trovato/non-trovato) già calcolato su blur del campo cldm.
- Produces: body POST include `pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione` SOLO quando lookup fallisce (PV manuale); quando lookup ha successo, il body NON include pv_* (il server deriva). LineeForm riceve `lineeDisponibili=[]` quando lookup fallisce (free-text via Altro).

**Stato attuale:** ResoForm.tsx riga 209-273 ha il campo cldm con datalist + lookup on blur che mostra il PV risolto in read-only. Body POST (riga 75-86) invia `cldm, motivo_reso, note, linee, corriere, corriere_nome, ddt_numero, ddt_data, num_colli` (NO pv_*).

- [ ] **Step 1: Consultare accessibility-lead e produrre guida a11y**

Prima di editare: delegare a accessibility-lead (o leggere gli specialist agent .md e applicare le checklist) per il reveal condizionale. Documentare: aria-expanded/aria-controls sul trigger, role="status" aria-live="polite" per il messaggio "CLDM non trovato", label htmlFor per ogni pv_*, aria-required, focus management (spostare il focus al primo campo pv_* quando il reveal si attiva), restore focus quando torna trovato, touch target, contrasto. Incorporare nel brief implementer.

- [ ] **Step 2: Stato "pv non trovato" + reveal condizionale**

Aggiungere stato (es. `pvNotFound: boolean`). Sul blur del cldm, dopo il lookup: se trovato → `pvNotFound=false` + mostra PV risolto read-only (come oggi) + lineeDisponibili=pv.linee. Se non trovato → `pvNotFound=true` + render condizionale di un fieldset "Dati PV (inserimento manuale — CLDM non in anagrafica)" con i 6 input (pv_nome*, pv_indirizzo*, pv_citta*, pv_cap*, pv_provincia*, pv_regione). Messaggio live-region role="status" aria-live="polite" "CLDM non trovato in anagrafica: inserisci i dati del PV manualmente". Spostare il focus al primo input (pv_nome) all'attivazione. Quando l'utente corregge il cldm e il lookup torna OK → nascondere il fieldset + ripulire i pv_* manuali dallo stato + live-region "PV trovato in anagrafica".

- [ ] **Step 3: Body POST condizionale**

Nel body POST: se `pvNotFound` → includere `pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione`. Altrimenti NON inviarli (server deriva). Validazione client: se pvNotFound, bloccare il submit se manca uno dei 5 campi obbligatori (messaggio errore live-region).

- [ ] **Step 4: Test manuale dev + a11y**

Compilazione HTTP 200 delle pagine. Test keyboard: tab dal cldm → lookup fallito → focus si sposta su pv_nome? Tab attraverso i 6 campi. Test screen-reader (NVDA/VoiceOver se disponibile) sul messaggio live-region. Test contrasto. Test flusso: cldm noto (no reveal) + cldm finto (reveal + submit con pv_* manuali → 201) + cldm finto senza pv_* (submit bloccato client).

- [ ] **Step 5: Commit**

`git add src/components/resi/ResoForm.tsx && git commit -m "feat(ResoForm): reveal condizionale PV manuale su cldm non trovato (a11y)"`

---

## Task 3: e2e + final review + memory + finishing

- [ ] **Step 1: e2e dev (:3002, no prod)**

1. Restart dev :3002.
2. POST come store_account con cldm NOTO + linee + corriere=GLS → 201, stato=in_attesa, num_reso sequenziale, pv_* derivati, resp_codice popolato.
3. POST come store_account con cldm FINTO + pv_* manuali + linee + corriere → 201, pv_* manuali, resp_codice NULL.
4. GET dettaglio reso (3) → ritorna pv_* manuali.
5. GET `/api/customer-service/richieste/:uuid/xls` → 200, riga con PV manuale + "Num. Autorizzazione" = num_reso + destinatario "ABC SRL RESI".
6. Routing F11: reso con cldm noto (resp_codice=M6) → veduto dal venditore M6; reso con cldm finto (resp NULL) → NON veduto dai venditori assegnati, veduto dai generici.
7. Backward compat: reso vecchio (prodotti/cldm/bda_autorizzazione) → dettaglio + XLS con fallback (prodotti, PV da cldm, autorizzazione BDA) — invariato.
8. A11y: keyboard nav + live-region sul form.

- [ ] **Step 2: Final whole-branch review (opus)**

Dispatch final reviewer su tutto il branch feature/nuovo-modello-reso (diff da BASE b9270ab).

- [ ] **Step 3: Memory + ledger**

Aggiorna memory (correggi memory F10 stale: num_reso non è solo-GLS; aggiungi memory nuovo-modello-reso PV-fallback). Finalizza ledger.

- [ ] **Step 4: Finishing**

superpowers:finishing-a-development-branch → menu 3 opzioni (merge locale a feature/f11 / push+PR / keep as-is). Attesa scelta utente.

---

## Self-review

- Spec coverage: PV manuale fallback = Task 1 (backend) + Task 2 (UI). num_reso/corriere/linee/destinatario già fatti (no-op documentato). e2e = Task 3. ✅
- Placeholder: nessuno. Step con codice preciso. ✅
- Type consistency: pv_* field names coerenti tra validation.js (opzionali), resi.js (fallback), ResoForm (body). ✅
- Conflitto piano-vs-F11 risolto dalla decisione utente (cldm obbligatorio + fallback). ✅