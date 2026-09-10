# Gestione resi CS avanzata — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pagina customer-service (interno) del sito-resi: ricerca resi (cldm/num_reso/range date), 3 tab (da gestire/approvati/inviati), export XLS multi-riga dei resi selezionati che li marca "spediti", e per ogni reso approvato invio automatico di email di autorizzazione (testo + PDF) a due destinatarie fisse via SMTP di ABC HUB.

**Architecture:** sito-resi (dev :3002, branch `feature/nuovo-modello-reso`) estende payload webhook (richiedente/approvatore), API CS (search + 3 view + export-selezionati + transizione `approvato→spedito`), UI CS (3 tab + search + checkbox/export). ABC HUB (`tracking-abc-italia-main`, branch `feature/resi-autorizzazione-email`) riceve il reso approvato via webhook e, dopo l'INSERT, invia l'email di autorizzazione (pdfkit PDF + nodemailer, fire-and-forget come l'auto-export XLS). L'email parte sul passaggio a `approvato` (2° livello + CS auto-chiuso), dove già parte il webhook.

**Tech Stack:** sito-resi: Next 16 + Express custom server, SQLite better-sqlite3, zod, React .tsx (WCAG AA, italiano). ABC HUB: Express + nodemailer ^8 + xlsx ^0.18.5 + (nuovo) pdfkit.

## Global Constraints

- UI e messaggi in **italiano**; WCAG AA per ogni UI (gate a11y .tsx, marker sessione padre).
- sito-resi **zero-dipendenze** (pdfkit va in ABC HUB, NON sito-resi).
- Migrazioni **idempotenti** (`addColumnIfMissing` + `CREATE TABLE IF NOT EXISTS`), **mai drop** tabelle/colonne.
- Backward compat: resi vecchi invariati; campi nuovi del webhook **opzionali** (zod nullable/optional).
- **Port safety**: NON toccare porte ABC HUB (:3000/:3001/:3011) né bot; dev/test sito-resi SOLO :3002; kill via `kill $(lsof -ti:3002)`, **MAI** `pkill -f "node server.js"`.
- ABC HUB email/PDF: **codice + commit, NON runtime-test** (no restart :3011) → flag operatore al task e2e.
- Password/secret **mai loggati/committati**; credenziali SMTP solo nomi env.
- `num_reso` immutabile dopo creazione.
- Spec di riferimento: `docs/superpowers/specs/2026-09-09-gestione-resi-cs-avanzata-design.md`.
- Repo paths: sito-resi = `/home/adimn/Scrivania/sito_resi_ABC_hub/sito-resi` (cwd); ABC HUB = `/home/adimn/Scrivania/tracking-abc-italia-main`.

---

## File Structure

### sito-resi (modifiche)
- `server/modules/webhook.js` — `sendWebhook` payload: + `richiedente_nome, richiedente_ruolo, approvatore_nome, approvatore_ruolo`.
- `server/modules/resi.js` — CS auto-chiuso: passa richiedente/approvatore (CS stesso) al webhook.
- `server/modules/customer-service.js` — GET `/richieste` (search + 3 view); POST `/richieste/export` (XLS multi-riga + mark spedito); PUT `/richieste/:uuid` passa richiedente/approvatore al webhook.
- `server/lib/db.js` — `addColumnIfMissing('richieste_reso','data_spedizione','TEXT')`.
- `server/modules/validation.js` — `exportResiSchema` (array UUID).
- `server/lib/xls-export.js` — `buildResiXlsMulti(resi[])` (riuso di `buildResiXls` riga per riga).
- `src/app/customer-service/richieste/page.tsx` — 3 tab + search bar + checkbox + bottone "Esporta e invia" (a11y).

### ABC HUB (modifiche)
- `package.json` — + `pdfkit` (^0.17.x, pure JS, no native).
- `src/modules/email-sender.js` — + `sendResoAutorizzazioneEmail(payload)` (costruisce corpo testo + PDF via pdfkit, invia via nodemailer a francesca+raffaella, rispetta TEST_OVERRIDE_EMAIL).
- `src/modules/resi-webhook.js` — zod schema + `richiedente_nome/ruolo, approvatore_nome/ruolo`; INSERT + 4 colonne; dopo INSERT trigger `sendResoAutorizzazioneEmail` (fire-and-forget); `addColumnIfMissing` su `resi_in_ingresso` per le 4 colonne.

---

## Task 1: ABC HUB — pdfkit + modulo email autorizzazione PDF

**Files:**
- Modify: `package.json` (+pdfkit)
- Modify: `src/modules/email-sender.js` (+`sendResoAutorizzazioneEmail`)
- Read: `src/modules/email-sender.js` (intero, per `getTransporter`, `isTestMode`, `TEST_OVERRIDE_EMAIL`, `sendResponsabileEmail` pattern)

**Interfaces:**
- Produces: `sendResoAutorizzazioneEmail(payload)` async, fire-and-forget-safe (caller non awaiting). `payload` shape = `{ num_reso, cldm, pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, ddt_numero, ddt_data, num_colli, linee:[{nome,numero_pezzi}], motivo_reso, note }`. Resituisce `{ok, messageId?}`; mai throw (logga errore).
- Destinatari: `francesca.cacciavillani@abcosmetique.it, raffaella.leardi@abcosmetique.it` (To). In `EMAIL_TEST_MODE` → `TEST_OVERRIDE_EMAIL` (come sendResponsabileEmail).
- Subject: `Autorizzazione al reso n. {num_reso} — {pv_nome}`.
- PDF: pdfkit A4, header "ABC Italia — Autorizzazione al reso n. {num_reso}", corpo = template testo. Filename `Autorizzazione_reso_{num_reso}.pdf`. Allegato `attachments:[{filename, content: <Buffer>}]` (pdfkit restituisce Buffer via `doc.end()` + `Buffer.concat(chunks)` su 'data').

- [ ] **Step 1: aggiungi pdfkit a package.json**

`dependencies` + `"pdfkit": "^0.17.1"`. NON `npm install` (l'operatore farà deploy; se serve verifica require, l'implementer può `npm install pdfkit` nella copia di lavoro ma NON committare package-lock se assente — verificare se esiste package-lock.json).

- [ ] **Step 2: implementa `sendResoAutorizzazioneEmail` in email-sender.js**

Costruttore corpo testo dalla template (spec sezione "Email template"). Helper:
- `cldmPad10 = (cldm||'').padStart(10,'0')`.
- `motivoLabel = {difettoso:'difettoso',errato:'errato',non_conforme:'non conforme',altro:'ALTRO'}[motivo_reso] || motivo_reso`.
- `motivoLine = note ? `${motivoLabel} - ${note}` : motivoLabel`.
- `lineeNomi = (linee||[]).map(l=>l.nome).join(', ')`; `totalePezzi = (linee||[]).reduce((s,l)=>s+(l.numero_pezzi||0),0)`.
- `lineeFrase = linee.length ? `delle linee ${lineeNomi} per circa ${totalePezzi} pezzi` : `dei prodotti` (fallback resi vecchi senza linee).
- placeholder `—` per ddt_numero/ddt_data/num_colli mancanti.

Corpo testo esattamente come template spec (riga "Autorizzazione richiesta da Direzione" RIMOSSA). Costruisci PDF con pdfkit: `const doc=new PDFDocument({size:'A4',margin:50});` header bold, poi `doc.text(linea)` per ogni riga del corpo (usa `\n` join o multiple `doc.text`). Raccogli Buffer: `const chunks=[]; doc.on('data',c=>chunks.push(c)); doc.on('end',()=>resolve(Buffer.concat(chunks))); doc.end();` (wrap in Promise). Invia: `transporter.sendMail({from:getSmtpFrom(), to:destinatari, subject, text:corpoTesto, attachments:[{filename, content:pdfBuffer}]})`. In testMode → `to: TEST_OVERRIDE_EMAIL`. Wrap tutto in try/catch, logga `[RESI-AUT-EMAIL]`, ritorna `{ok:false}` mai throw.

- [ ] **Step 3: esporta la nuova funzione**

Aggiungi `sendResoAutorizzazioneEmail` agli `module.exports` di email-sender.js (insieme a sendDeliveryEmail, sendResponsabileEmail).

- [ ] **Step 4: verifica sintassi + require**

`node -e "require('./src/modules/email-sender.js'); console.log('ok')"` (NON avvia server, NON tocca porte). Verifica pdfkit: `node -e "const PDFDocument=require('pdfkit'); const d=new PDFDocument(); d.text('x'); d.end();"` dopo `npm install pdfkit` (se non installato). Se non si può installare, verifica solo sintassi con `node --check src/modules/email-sender.js`.

- [ ] **Step 5: commit (branch feature/resi-autorizzazione-email)**

```bash
cd /home/adimn/Scrivania/tracking-abc-italia-main
git checkout -b feature/resi-autorizzazione-email 2>/dev/null || git checkout feature/resi-autorizzazione-email
git add package.json src/modules/email-sender.js package-lock.json 2>/dev/null
git commit -m "feat(resi): email autorizzazione PDF via pdfkit + sendResoAutorizzazioneEmail"
```
Solo i file del task. Nessun secret.

---

## Task 2: sito-resi — estendi payload webhook (richiedente/approvatore)

**Files:**
- Modify: `server/modules/webhook.js` (`sendWebhook` payload + campi)
- Modify: `server/modules/resi.js` (CS auto-chiuso ~riga 197-232)
- Modify: `server/modules/customer-service.js` (PUT `/richieste/:uuid` ~riga 156-224)

**Interfaces:**
- Consumes: `users` row del `user_id` (richiedente) e `venditore_id` (approvatore 1° livello).
- Produces: payload webhook + `{ richiedente_nome, richiedente_ruolo, approvatore_nome, approvatore_ruolo }` (tutti string nullable). Per CS auto-chiuso: richiedente=approvatore=CS stesso (user_id), ruolo `customer_service`.

- [ ] **Step 1: webhook.js — aggiungi 4 campi al payload**

In `sendWebhook`, il payload costruito: aggiungi `richiedente_nome, richiedente_ruolo, approvatore_nome, approvatore_ruolo` (nullable). I campi sono opzionali lato ABC HUB (Task 4) → backward compat.

- [ ] **Step 2: resi.js — CS auto-chiuso passa richiedente/approvatore**

Nel blocco auto-chiuso CS, dove si costruisce il payload/chiama sendWebhook: fetcha il nome/ruolo dell'`user_id` (CS) e passa `richiedente_nome/ruolo = approvatore_nome/ruolo = CS.nome/CS.ruolo`. Riusa la query users già presente o una `SELECT nome, ruolo FROM users WHERE id=?`.

- [ ] **Step 3: customer-service.js — PUT 2° livello passa richiedente/approvatore**

Nel PUT `/richieste/:uuid` (transizione in_revisione→approvato), prima di sendWebhook: fetcha richiedente (user_id del reso) + approvatore (venditore_id del reso, = approvatore 1° livello) nomi/ruoli da `users`. Passa al payload webhook. (L'approvatore 2° livello = il CS che preme Approva, ma l'email di autorizzazione identifica l'autorità 1° livello che ha approvato; coerente col template "Autorizzazione richiesta da" rimosso → in realtà i campi vanno solo al webhook per persistenza ABC HUB, non nell'email.)

- [ ] **Step 4: test curl (dev :3002)**

Restart dev sito-resi (`kill $(lsof -ti:3002)` poi `node server.js` in bg su :3002). POST crea reso come interno (auto-chiuso) → 201 approvato. Verifica payload webhook: o leggi log del webhook (se logga), o punta il webhook a un endpoint di test (netcat) e verifica i 4 campi presenti. In alternativa, dato che ABC HUB non è testabile (Task 4 non deployato), verifica la presenza dei campi nel codice + un assert con `grep`/log. Documenta nel report come verificato.

- [ ] **Step 5: commit**

```bash
git add server/modules/webhook.js server/modules/resi.js server/modules/customer-service.js
git commit -m "feat(webhook): payload + richiedente_nome/ruolo approvatore_nome/ruolo"
```

---

## Task 3: ABC HUB — resi-webhook zod + INSERT + trigger email

**Files:**
- Modify: `src/modules/resi-webhook.js` (schema riga ~132-172, INSERT ~395-430, trigger dopo auto-export ~435-450)
- Read: `src/modules/email-sender.js` (per `sendResoAutorizzazioneEmail` da Task 1)

**Interfaces:**
- Consumes: `sendResoAutorizzazioneEmail` (Task 1). Payload webhook + 4 campi (Task 2).
- Produces: persistenza 4 colonne + email inviata fire-and-forget dopo INSERT.

- [ ] **Step 1: addColumnIfMissing 4 colonne su resi_in_ingresso**

Dopo riga 129 (`num_reso`), aggiungi:
```js
addColumnIfMissing('resi_in_ingresso', 'richiedente_nome', 'TEXT');
addColumnIfMissing('resi_in_ingresso', 'richiedente_ruolo', 'TEXT');
addColumnIfMissing('resi_in_ingresso', 'approvatore_nome', 'TEXT');
addColumnIfMissing('resi_in_ingresso', 'approvatore_ruolo', 'TEXT');
```

- [ ] **Step 2: zod schema + 4 campi opzionali**

In `resiWebhookSchema`, dopo `num_reso`:
```js
richiedente_nome: z.string().max(200).nullable().optional(),
richiedente_ruolo: z.string().max(50).nullable().optional(),
approvatore_nome: z.string().max(200).nullable().optional(),
approvatore_ruolo: z.string().max(50).nullable().optional(),
```

- [ ] **Step 3: INSERT + 4 colonne**

Nella INSERT su `resi_in_ingresso` (~395-430), aggiungi le 4 colonne + valori `payload.richiedente_nome/ruolo, approvatore_nome/ruolo` (o `null`). Mantieni idempotenza e backward compat.

- [ ] **Step 4: trigger email dopo INSERT**

Dopo l'INSERT (e dopo l'auto-export XLS esistente), fire-and-forget:
```js
setImmediate(async () => {
  try {
    const { sendResoAutorizzazioneEmail } = require('./email-sender.js');
    await sendResoAutorizzazioneEmail({
      num_reso: payload.num_reso, cldm: payload.cldm,
      pv_nome: payload.pv_nome, pv_indirizzo: payload.pv_indirizzo,
      pv_citta: payload.pv_citta, pv_cap: payload.pv_cap, pv_provincia: payload.pv_provincia,
      ddt_numero: payload.ddt_numero, ddt_data: payload.ddt_data, num_colli: payload.num_colli,
      linee: payload.linee, motivo_reso: payload.motivo_reso, note: payload.note,
    });
    console.log(`[RESI-WEBHOOK] Email autorizzazione inviata reso n. ${payload.num_reso}`);
  } catch (err) {
    console.error('[RESI-WEBHOOK] Email autorizzazione fallita:', err.message);
  }
});
```
`setImmediate` (non `await`) = fire-and-forget, non blocca la response 200. require inline per evitare circular-load issues (o require in cima, come preferito).

- [ ] **Step 5: verifica sintassi**

`node --check src/modules/resi-webhook.js`. NON restart :3011. NON test runtime (vietato).

- [ ] **Step 6: commit**

```bash
git add src/modules/resi-webhook.js
git commit -m "feat(resi-webhook): persist richiedente/approvatore + trigger email autorizzazione"
```

---

## Task 4: sito-resi — API CS search + 3 view + export-selezionati + spedito

**Files:**
- Modify: `server/lib/db.js` (+`data_spedizione` column)
- Modify: `server/modules/validation.js` (+`exportResiSchema`)
- Modify: `server/lib/xls-export.js` (+`buildResiXlsMulti`)
- Modify: `server/modules/customer-service.js` (GET `/richieste` search + 3 view; POST `/richieste/export`)

**Interfaces:**
- Consumes: ruoli CS/admin auth (middleware esistente). `buildResiXls` (riga-per-riga).
- Produces: `GET /api/customer-service/richieste?view=da_approvare|approvati|inviati&cldm=&num_reso=&data_da=&data_a=&page=`; `POST /api/customer-service/richieste/export` body `{uuids:[...]}` → XLS + mark spediti.

- [ ] **Step 1: db.js — colonna data_spedizione**

`addColumnIfMissing('richieste_reso','data_spedizione','TEXT');` (idempotente, come pattern esistente riga ~54).

- [ ] **Step 2: validation.js — exportResiSchema**

```js
const exportResiSchema = z.object({
  uuids: z.array(z.string().uuid()).min(1).max(500),
});
```

- [ ] **Step 3: xls-export.js — buildResiXlsMulti**

Funzione che prende `resi[]` (con tutti i campi joinati), genera un workbook con una riga per reso (riuso della logica riga di `buildResiXls` — estrai il mapping riga in helper condiviso o richiama buildResiXls per ogni reso su worksheet separate? NO: un workbook, righe multiple). Implementa: crea workbook+worksheet una volta, itera resi, per ognuno scrive la riga 16-col (stesso header di buildResiXls). Ritorna Buffer XLS (BIFF8). Riporta il mapping colonne da `buildResiXls` esistente (PV, cldm, num_reso, num_colli, ddt, destinatario ABC SRL RESI, ecc.).

- [ ] **Step 4: customer-service.js — GET /richieste search + 3 view**

Estendi GET esistente:
- `view` values: `da_approvare` (in_revisione) | `approvati` (approvato) | `inviati` (spedito, completato). Backward compat: se `view=elaborati` → mappa a `inviati` (o gestisci come alias).
- Search params (tutti opzionali, combinati con AND dentro il tab):
  - `cldm` (LIKE '%?%')
  - `num_reso` (exact int)
  - `data_da` / `data_a` (range su `data_approvazione`, ISO date; confronto `substr(data_approvazione,1,10) BETWEEN data_da AND data_a` o `>= / <=`).
- Paginazione invariata. Ordine `data_approvazione DESC` per approvati/inviati, `data_creazione DESC` per da_approvare.
- zod validation dei query params (string max, int safe parse).

- [ ] **Step 5: customer-service.js — POST /richieste/export**

```js
// auth CS/admin già sul router
router.post('/richieste/export', async (req,res) => {
  const parsed = exportResiSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({error: parsed.error.issues});
  const { uuids } = parsed.data;
  // 1. fetch resi WHERE uuid IN (uuids) AND stato='approvato' AND user_id/ruolo accessibile
  const resi = db.prepare(`SELECT ... FROM richieste_reso WHERE uuid IN (${placeholders}) AND stato='approvato'`).all(...uuids);
  if (resi.length === 0) return res.status(404).json({error:'Nessun reso approvato selezionato'});
  // 2. mark spedito + data_spedizione
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const r of resi) db.prepare(`UPDATE richieste_reso SET stato='spedito', data_spedizione=? WHERE uuid=? AND stato='approvato'`).run(now, r.uuid);
  });
  tx();
  // 3. XLS multi-riga
  const buf = buildResiXlsMulti(resi);
  res.setHeader('Content-Type','application/vnd.ms-excel');
  res.setHeader('Content-Disposition',`attachment; filename="Resi_selezionati_${data}.xls"`);
  res.send(buf);
});
```
Transazione atomica: o tutti i selezionati diventano spediti, o nessuno (se uno fallisce rollback). Solo `stato='approvato'` → spedito (resi già spediti/completati sono skippati dal WHERE, documentato nel report).

- [ ] **Step 6: test curl (dev :3002)**

Restart dev. Crea 2-3 resi approvati (interno auto-chiuso + 2° livello). 
- GET `/api/customer-service/richieste?view=approvati&cldm=520059` → solo IPERCOOP CUNEO.
- GET `?view=approvati&data_da=2026-09-01&data_a=2026-09-30` → resi del range.
- GET `?view=inviati` → vuoto (nessuno spedito ancora).
- POST `/api/customer-service/richieste/export` body `{"uuids":["<uuid1>","<uuid2>"]}` → 200 + XLS; verifica i 2 resi ora `stato='spedito'` + `data_spedizione` impostata.
- GET `?view=inviati` → i 2 resi.
- POST con uuid non approvato → skip / 404.

- [ ] **Step 7: commit**

```bash
git add server/lib/db.js server/modules/validation.js server/lib/xls-export.js server/modules/customer-service.js
git commit -m "feat(cs): search + 3 view (da gestire/approvati/inviati) + export selezionati (XLS + spedito)"
```

---

## Task 5: sito-resi — UI CS: 3 tab + search bar + checkbox + "Esporta e invia"

**Files:**
- Modify: `src/app/customer-service/richieste/page.tsx`

**a11y gate:** marker sessione padre presente. Consultare accessibility-lead PRIMA di editare (hook PreToolUse blocca .tsx). Applicare: forms-specialist (search bar labels), aria-specialist (tabs role=tablist/tab/tabpanel, aria-selected), keyboard-navigator (tab nav frecce, checkbox), live-region-controller (annunci risultato ricerca/export), link-checker (testo link).

**Interfaces:**
- Consumes: GET `/api/customer-service/richieste?view=...&cldm=&num_reso=&data_da=&data_a=`, POST `/api/customer-service/richieste/export`.
- Produces: UI 3 tab + search bar + tabella resi con checkbox + bottone "Esporta e invia" (visibile solo su tab "approvati").

- [ ] **Step 1: consulta accessibility-lead + scrivi guida a11y**

Delega a accessibility-lead (o leggi specialist .md + checklist) per: tabs WAI-ARIA pattern (role=tablist/tab/tabpanel, aria-selected, aria-controls, keyboard arrow nav), search form (label htmlFor per cldm/num_reso/data_da/data_a), checkbox "seleziona tutti" + per-riga (label accessibile, stato indeterminato), live region per "N risultati" + "N resi esportati", focus management su cambio tab e dopo export.

- [ ] **Step 2: 3 tab WAI-ARIA**

Sostituisci i 2 tab attuali con 3: "Da gestire" (da_approvare), "Approvati" (approvati), "Inviati" (inviati). `role=tablist` orizzontale, ogni `button role=tab` con `aria-selected`, `aria-controls={panelId}`, `id={tabId}`; `div role=tabpanel` con `aria-labelledby`. Keyboard: frecce sx/dx tra tab, Home/End, Enter/Space attiva. Stato attivo nel query param `view`.

- [ ] **Step 3: search bar**

Form (sopra la tabella, dentro il tab panel) con: input `cldm` (text), `num_reso` (number), `data_da` (date), `data_a` (date), bottone "Cerca", bottone "Reset". Ogni campo `label htmlFor`. Submit via query params (fetch GET). Live region `role=status` "N risultati trovati".

- [ ] **Step 4: tabella con checkbox + "Esporta e invia"**

Solo tab "Approvati": colonna checkbox (header "Seleziona tutti" con `aria-label`, stato indeterminato quando parziale). Checkbox per riga con `aria-label="Seleziona reso n. {num_reso}"`. Bottone "Esporta e invia" (sopra/sotto tabella), `disabled` se 0 selezionati, `aria-disabled`. Click → conferma? (NO, azione diretta; live region annuncia) → POST export → download XLS (blob) + refresh lista (i resi ora in "Inviati"). Annuncio live: "Esportati N resi, ora in Inviati".

- [ ] **Step 5: test manuale dev + a11y**

Compile HTTP 200 `/customer-service/richieste`. Keyboard: tab tra tab (frecce), tab nella search, checkbox. Screen-reader: live region annunci. Test flusso: search cldm → risultati; seleziona 2 → "Esporta e invia" → XLS scaricato + tab Inviati mostra i 2.

- [ ] **Step 6: commit**

```bash
git add src/app/customer-service/richieste/page.tsx
git commit -m "feat(cs-ui): 3 tab + search bar + export selezionati (a11y)"
```

---

## Task 6: e2e + final review + memory + finishing

**Files:** nessuno (verifica + docs + memory).

- [ ] **Step 1: e2e sito-resi dev :3002**

Flusso completo: crea reso (interno, auto-chiuso) → tab "Approvati" lo mostra → search per cldm → seleziona → "Esporta e invia" → XLS scaricato + reso "spedito" → tab "Inviati" lo mostra. Verifica webhook payload ha 4 campi (log/grep). Backward compat: reso vecchio (prodotti/cldm) mostra ancora in dettaglio + XLS fallback.

- [ ] **Step 2: flag ABC HUB email/PDF non testato**

ABC HUB Task 1+3 NON runtime-testati (no restart :3011, port-safety). Documenta nel report + memoria: codice pronto, richiede restart :3011 + `npm install pdfkit` per test invio email a francesca/raffaella (o TEST_OVERRIDE_EMAIL). Chiedi all'utente autorizzazione restart :3011 per smoke test (come fatto per prod :3001).

- [ ] **Step 3: final whole-branch review**

Dispatch final reviewer (modello capable) su entrambi i branch (sito-resi feature/nuovo-modello-reso, ABC HUB feature/resi-autorizzazione-email). Fix loop (1 round) se findings.

- [ ] **Step 4: memory**

Scrivi/aggiorna memoria `abc-hub-resi-*.md` con: feature CS avanzata (search/3tab/export selezionati/spedito/email autorizzazione PDF via pdfkit), vincolo ABC HUB email non testato (restart :3011 pendente), flag cldm zero-padded 10 cifre.

- [ ] **Step 5: finishing**

Usa superpowers:finishing-a-development-branch. Presenta menu (merge/PR/keep) per entrambi i branch. Rispetta port-safety.

---

## Out of scope
- Transizione `completato` (future).
- Sostituzione GLS giornaliero esistente (resta backward-compat).
- UI venditore (richiesta solo CS).
- AD auth / SQL Server migration.