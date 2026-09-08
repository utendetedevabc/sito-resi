# F10 — Anagrafica CLDM, linee da PV, file GLS giornaliero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire l'inserimento manuale del PV con selezione del CLDM (auto-compilazione da anagrafica interna importata da ZSD127.xlsx), popolare le linee dal PV selezionato + opzione "Altro", rimuovere "Numero Ordine", e generare un file GLS giornaliero aggregato.

**Architecture:** Nuova tabella `anagrafica_pv` nel DB del sito + importer che parsa `ZSD127.xlsx` dalla share SMB; scheduler settimanale (domenica 12:00) + refresh forzato. Il form invia solo `cldm`; il server deriva `pv_*` dall'anagrafica (autorevole). `LineeForm` usa `<select>` per riga con linee del PV + "Altro". Endpoint `GET /api/customer-service/gls/giornaliero` aggrega i resi GLS approvati nella giornata in un `.xls` multi-riga (header 16-col invariato).

**Tech Stack:** Next 16 + Express custom server (`server.js`, ESM), better-sqlite3, xlsx@0.18.5 (BIFF8), zod, JWT RS256. UI in italiano, WCAG AA. No nuove dipendenze.

## Global Constraints

- Dev-first. **MAI restartare/toccare prod Express (:3001, pid 3545347, `.express.pid`)**. Lavorare su dev :3002 (`node server.js`) e harness :3011.
- Modifiche a `server/modules/*.js` e `server/lib/*.js` → richiedono restart del dev `node server.js` (no hot-reload). UI `.tsx` → hot-reload.
- UI, messaggi, commenti in **italiano**. WCAG AA per ogni UI.
- Nessuna nuova dipendenza npm senza chiedere. `xlsx@0.18.5` e `better-sqlite3` già presenti.
- File XLS: header 16 colonne/ordine di `RITGIO2836.xls` **invariato**.
- Backward compat: resi vecchi (prodotti/cldm/bda_autorizzazione/pv_* vuoti) continuano a funzionare via fallback.
- Anagrafica source: `/mnt/bolle-scan-data/Servizi/InformazioniI Generali/anagrafica_siti_rares/ZSD127.xlsx` (nota: il path reale ha `InformazioniI` con I maiuscola).
- Verifica: questo progetto **non ha framework di test**. La verifica è manuale e2e via `curl` + browser, come da workflow stabilito. Non introdurre framework di test.

## File Structure

| File | Responsabilità | Azione |
|---|---|---|
| `server/lib/db.js` | Migrazione `anagrafica_pv` + relax `numero_ordine_esterno` | Modify |
| `database/schema.sql` | Schema fresh-install `anagrafica_pv` | Modify |
| `server/lib/anagrafica.js` | Importer ZSD127.xlsx → `anagrafica_pv` + lookup helpers | Create |
| `server/modules/anagrafica-api.js` | Router: search, lookup-by-cldm, admin forced refresh | Create |
| `server/modules/admin.js` | Mount refresh route (o in anagrafica-api) | Modify |
| `server.js` | Mount router anagrafica + scheduler settimanale | Modify |
| `server/modules/validation.js` | `cldm` required, `pv_*`/`numero_ordine` optional | Modify |
| `server/modules/resi.js` | Deriva `pv_*` da `cldm` su POST/PUT; `numero_ordine` optional | Modify |
| `src/components/ui/LineeForm.tsx` | `<select>` per riga (linee PV + Altro) | Modify |
| `src/components/resi/ResoForm.tsx` | CLDM combobox + PV read-only; remove numero_ordine + manual PV | Modify |
| `src/app/customer-service/richieste/[id]/page.tsx` | Mostra CLDM | Modify |
| `src/app/dashboard/richieste/[id]/page.tsx` | Mostra CLDM | Modify |
| `src/app/venditore/richieste/[id]/page.tsx` | Mostra CLDM | Modify |
| `server/modules/customer-service.js` | Endpoint `gls/giornaliero` | Modify |
| `src/app/customer-service/gls/page.tsx` | Pagina "File GLS giornaliero" | Create |

---

### Task 1: DB — tabella `anagrafica_pv` + relax `numero_ordine_esterno`

**Files:**
- Modify: `server/lib/db.js` (dopo le migrazioni esistenti, ~riga 88)
- Modify: `database/schema.sql` (fresh-install)

**Interfaces:**
- Produces: tabella `anagrafica_pv(cldm PK, nome, indirizzo, citta, cap, provincia, regione, resp_codice, resp_nome, promo_codice, promo_nome, linee, updated_at)`. Colonna `richieste_reso.numero_ordine_esterno` resta NOT NULL ma nuovi INSERT passano `''`.

- [ ] **Step 1: Aggiungi `CREATE TABLE anagrafica_pv` in `database/schema.sql`**

In coda al file `database/schema.sql`, aggiungi:

```sql
-- Anagrafica punti vendita interna (importata da ZSD127.xlsx, F10).
-- Aggiornata settimanalmente (domenica 12:00) + refresh forzato.
CREATE TABLE IF NOT EXISTS anagrafica_pv (
  cldm TEXT PRIMARY KEY,
  nome TEXT,
  indirizzo TEXT,
  citta TEXT,
  cap TEXT,
  provincia TEXT,
  regione TEXT,
  resp_codice TEXT,    -- AL: codice responsabile (approva)
  resp_nome TEXT,      -- AM: nome responsabile
  promo_codice TEXT,   -- AN: codice promotore (inserisce)
  promo_nome TEXT,     -- AO: nome promotore
  linee TEXT,          -- AS: sigle dash-separate, es. "BA-FP-LC-MB-SX"
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_anagrafica_pv_nome ON anagrafica_pv(nome);
```

- [ ] **Step 2: Aggiungi migrazione idempotente in `server/lib/db.js`**

Dopo il blocco `addColumnIfMissing('richieste_reso', 'num_reso', ...)` (~riga 78) e prima del `CREATE INDEX idx_richieste_num_reso` (~riga 84), aggiungi:

```js
// F10: tabella anagrafica PV interna (importata da ZSD127.xlsx). Idempotente.
try {
  db.exec(`CREATE TABLE IF NOT EXISTS anagrafica_pv (
    cldm TEXT PRIMARY KEY,
    nome TEXT, indirizzo TEXT, citta TEXT, cap TEXT,
    provincia TEXT, regione TEXT,
    resp_codice TEXT, resp_nome TEXT,
    promo_codice TEXT, promo_nome TEXT,
    linee TEXT,
    updated_at TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_anagrafica_pv_nome ON anagrafica_pv(nome)');
} catch (err) {
  console.error('Errore creazione anagrafica_pv:', err.message);
}
```

- [ ] **Step 3: Verifica boot dev (no regressione)**

Restart dev (`node server.js`), verifica log senza errori e tabella creata:
```bash
sqlite3 data/resi.db "PRAGMA table_info(anagrafica_pv);" | head
sqlite3 data/resi.db "SELECT COUNT(*) FROM anagrafica_pv;"
```
Expected: 13 colonne listate, count = 0.

- [ ] **Step 4: Commit**

```bash
git add server/lib/db.js database/schema.sql
git commit -m "feat(F10): tabella anagrafica_pv + migrazione idempotente"
```

---

### Task 2: Importer `server/lib/anagrafica.js`

**Files:**
- Create: `server/lib/anagrafica.js`

**Interfaces:**
- Produces:
  - `refreshAnagrafica(): { imported: number, updated: number, total: number, source: string }` — legge `ZSD127_PATH`, parsa, upserta in `anagrafica_pv`.
  - `lookupPvByCldm(cldm): object|null` — `{cldm,nome,indirizzo,citta,cap,provincia,regione,resp_codice,resp_nome,promo_codice,promo_nome,linee:string[]}`.
  - `searchPv(q, limit): object[]` — search by cldm or nome (ILIKE).
  - `anagraficaStatus(): { count, source, last_updated, source_exists }`.

- [ ] **Step 1: Crea `server/lib/anagrafica.js`**

```js
// server/lib/anagrafica.js — Import e lookup dell'anagrafica punti vendita
// interna, ricavata da ZSD127.xlsx (share SMB, anagrafica_siti_rares).
// Aggiornamento: settimanale (domenica 12:00, vedi server.js) + refresh forzato
// (POST /api/admin/anagrafica/refresh). Il form resi legge solo da qui.
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import db from './db.js';
import logger from './logger.js';

// Path del file anagrafica sulla share (montaggio ro /mnt/bolle-scan-data).
export const ZSD127_PATH = process.env.ZSD127_PATH
  || '/mnt/bolle-scan-data/Servizi/InformazioniI Generali/anagrafica_siti_rares/ZSD127.xlsx';

// Indici colonna nel foglio ZSD127 (header riga 1, dati da riga 2):
// U=20 cldm | V=21 nome | W=22 indirizzo | X=23 citta | Y=24 cap | Z=25 prov
// AA=26 regione | AL=37 resp_cod | AM=38 resp_nome | AN=39 promo_cod | AO=40 promo_nome
// AS=44 linee (dash-separate)
const COL = { cldm: 20, nome: 21, indirizzo: 22, citta: 23, cap: 24, prov: 25, regione: 26, respCod: 37, respNome: 38, promoCod: 39, promoNome: 40, linee: 44 };

// Estrae il nome (senza telefono) da "NOME COGNOME 3351234567".
function parseNomePersona(raw) {
  if (raw == null) return '';
  const clean = String(raw).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || clean.toUpperCase() === 'PRIVATI') return clean || '';
  return clean.replace(/\+?\d{6,}\s*$/, '').replace(/[-\s]+$/, '').trim();
}

function cell(r, k) {
  const v = r[k];
  return v != null ? String(v).replace(/ /g, ' ').trim() : '';
}

// Importa (o aggiorna) l'anagrafica. Non svuota la tabella se la source manca.
export function refreshAnagrafica() {
  if (!fs.existsSync(ZSD127_PATH)) {
    logger.warn(`[Anagrafica] File non trovato: ${ZSD127_PATH} — mantengo dati esistenti`);
    return { imported: 0, updated: 0, total: 0, source: ZSD127_PATH, source_exists: false };
  }
  const wb = XLSX.readFile(ZSD127_PATH, { cellDates: false });
  const ws = wb.Sheets['ZSD127'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  const now = new Date().toISOString();

  const upsert = db.prepare(
    `INSERT INTO anagrafica_pv (cldm, nome, indirizzo, citta, cap, provincia, regione, resp_codice, resp_nome, promo_codice, promo_nome, linee, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(cldm) DO UPDATE SET
       nome=excluded.nome, indirizzo=excluded.indirizzo, citta=excluded.citta, cap=excluded.cap,
       provincia=excluded.provincia, regione=excluded.regione,
       resp_codice=excluded.resp_codice, resp_nome=excluded.resp_nome,
       promo_codice=excluded.promo_codice, promo_nome=excluded.promo_nome,
       linee=excluded.linee, updated_at=excluded.updated_at`
  );
  let inserted = 0, updated = 0;
  const tx = db.transaction((items) => {
    for (const it of items) {
      const info = upsert.run(...it);
      if (info.changes > 0 && info.lastInsertRowid === info.changes) inserted++;
      else updated++;
    }
  });

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const cldm = cell(r, COL.cldm);
    if (!cldm || !/^\d+$/.test(cldm)) continue; // CLDM numerico obbligatorio
    items.push([
      cldm,
      cell(r, COL.nome),
      cell(r, COL.indirizzo),
      cell(r, COL.citta),
      cell(r, COL.cap),
      cell(r, COL.prov),
      cell(r, COL.regione),
      cell(r, COL.respCod),
      parseNomePersona(cell(r, COL.respNome)),
      cell(r, COL.promoCod),
      parseNomePersona(cell(r, COL.promoNome)),
      cell(r, COL.linee),
      now,
    ]);
  }
  tx(items);
  const total = db.prepare('SELECT COUNT(*) as c FROM anagrafica_pv').get().c;
  logger.info(`[Anagrafica] Importati ${items.length} record (tabella totale: ${total}) da ${ZSD127_PATH}`);
  return { imported: inserted, updated, total, source: ZSD127_PATH, source_exists: true };
}

export function lookupPvByCldm(cldm) {
  if (!cldm) return null;
  const row = db.prepare('SELECT * FROM anagrafica_pv WHERE cldm = ?').get(String(cldm).trim());
  if (!row) return null;
  return {
    ...row,
    linee: row.linee ? row.linee.split('-').map(s => s.trim()).filter(Boolean) : [],
  };
}

export function searchPv(q, limit = 20) {
  const term = String(q || '').trim();
  if (term.length < 1) return [];
  const like = `%${term}%`;
  return db.prepare(
    `SELECT cldm, nome, citta, provincia FROM anagrafica_pv
     WHERE cldm LIKE ? OR nome LIKE ? COLLATE NOCASE
     ORDER BY LENGTH(cldm) ASC, nome ASC LIMIT ?`
  ).all(like, like, Math.min(parseInt(limit) || 20, 100));
}

export function anagraficaStatus() {
  const row = db.prepare('SELECT COUNT(*) as count, MAX(updated_at) as last_updated FROM anagrafica_pv').get();
  return {
    count: row.count,
    last_updated: row.last_updated,
    source: ZSD127_PATH,
    source_exists: fs.existsSync(ZSD127_PATH),
  };
}
```

- [ ] **Step 2: Verifica importer da CLI**

```bash
node --input-type=module -e '
import { refreshAnagrafica, lookupPvByCldm } from "./server/lib/anagrafica.js";
console.log(refreshAnagrafica());
console.log(lookupPvByCldm("507888"));
'
```
Expected: `{ imported: ~6000, total: ~6000, source_exists: true }` e lookup ritorna `GHEZZI LUIGI` con `linee: ["BA","FP","LC","MB","SX"]`.

- [ ] **Step 3: Commit**

```bash
git add server/lib/anagrafica.js
git commit -m "feat(F10): importer anagrafica da ZSD127.xlsx + lookup helpers"
```

---

### Task 3: API anagrafica + refresh forzato

**Files:**
- Create: `server/modules/anagrafica-api.js`
- Modify: `server.js` (mount router)

**Interfaces:**
- Produces: `GET /api/anagrafica?q=&limit=`, `GET /api/anagrafica/:cldm`, `POST /api/admin/anagrafica/refresh`, `GET /api/anagrafica/status`.
- Consumes: `refreshAnagrafica, lookupPvByCldm, searchPv, anagraficaStatus` from Task 2.

- [ ] **Step 1: Crea `server/modules/anagrafica-api.js`**

```js
// server/modules/anagrafica-api.js — API anagrafica PV (lookup/search per il form
// resi) + refresh forzato (admin). Tutte le rotte richiedono login (authenticate);
// il refresh richiede admin.
import { Router } from 'express';
import { lookupPvByCldm, searchPv, anagraficaStatus, refreshAnagrafica } from '../lib/anagrafica.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { logAudit } from '../lib/audit.js';
import logger from '../lib/logger.js';

const router = Router();
router.use(authenticate);

// Ricerca per combobox (cldm o nome).
router.get('/', (req, res) => {
  const { q = '', limit = 20 } = req.query;
  res.json({ data: searchPv(q, parseInt(limit) || 20) });
});

// Dettaglio PV per cldm (usato dal form per auto-compilare + linee).
router.get('/:cldm', (req, res) => {
  const pv = lookupPvByCldm(req.params.cldm);
  if (!pv) return res.status(404).json({ error: 'CLDM non trovato in anagrafica', found: false });
  res.json({ found: true, pv });
});

// Stato anagrafica (count, last_updated, source_exists).
router.get('/status', (req, res) => {
  res.json(anagraficaStatus());
});

// Refresh forzato (admin only).
router.post('/refresh', authorize('admin'), (req, res) => {
  try {
    const stats = refreshAnagrafica();
    logAudit(req.user.id, 'ANAGRAFICA_REFRESH', stats, req);
    logger.info(`Anagrafica refresh forzato da admin ${req.user.id}: ${stats.total} record`);
    res.json({ success: true, ...stats });
  } catch (err) {
    logger.error(`Errore refresh anagrafica: ${err.message}`);
    res.status(500).json({ error: 'Errore refresh anagrafica', detail: err.message });
  }
});

export default router;
```

- [ ] **Step 2: Monta il router in `server.js`**

Aggiungi l'import (vicino agli altri, ~riga 12):
```js
import anagraficaRouter from './server/modules/anagrafica-api.js';
```
E il mount (vicino a `server.use('/api/admin', adminRouter);`):
```js
server.use('/api/anagrafica', anagraficaRouter);
```
**Attenzione ordine rotte**: `GET /:cldm` e `GET /status` coesistono. In Express 5, `/status` è più specifica ma `/:cldm` cattura tutto. Metti `/status` **dopo** `/:cldm`? No — `/:cldm` matcherebbe "status". **Soluzione**: registra `GET /status` **prima** di `GET /:cldm` (come nello snippet sopra: ordine status → :cldm va bene perché status è dichiarato prima). Verifica con curl nel Step 4.

- [ ] **Step 3: Restart dev + verifica**

Restart `node server.js`. Con un token valido:
```bash
TOK=$(curl -s -X POST localhost:3002/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"<demo>"}' | jq -r .access_token)
curl -s "localhost:3002/api/anagrafica?q=507888" -H "Authorization: Bearer $TOK" | jq .
curl -s localhost:3002/api/anagrafica/status -H "Authorization: Bearer $TOK" | jq .
curl -s localhost:3002/api/anagrafica/507888 -H "Authorization: Bearer $TOK" | jq '.pv.nome, .pv.linee'
curl -s -X POST localhost:3002/api/admin/anagrafica/refresh -H "Authorization: Bearer $TOK" | jq .
```
Expected: search ritorna 507888; status `source_exists:true, count>0`; lookup `nome:"GHEZZI LUIGI SRL"`, `linee` array; refresh `{success:true, total:~6000}`.

- [ ] **Step 4: Commit**

```bash
git add server/modules/anagrafica-api.js server.js
git commit -m "feat(F10): API anagrafica (search/lookup) + refresh forzato admin"
```

---

### Task 4: Scheduler settimanale (domenica 12:00)

**Files:**
- Modify: `server.js` (dentro `app.prepare().then(...)`, dopo `httpServer.listen`)

**Interfaces:**
- Consumes: `refreshAnagrafica` from Task 2.
- Produces: scheduler che chiama `refreshAnagrafica()` ogni domenica 12:00 locale.

- [ ] **Step 1: Aggiungi import in `server.js`**

```js
import { refreshAnagrafica } from './server/lib/anagrafica.js';
```

- [ ] **Step 2: Aggiungi scheduler dopo `httpServer.listen`**

Dentro il callback di `app.prepare().then(...)`, dopo `const httpServer = server.listen(...)`:

```js
  // F10: scheduler anagrafica — refresh settimanale ogni domenica alle 12:00
  // (locale). Env ANAGRAFICA_AUTO_WEEKLY=1 (default) per abilitare.
  const autoWeekly = process.env.ANAGRAFICA_AUTO_WEEKLY !== '0';
  let anagraficaTimer = null;
  function scheduleNextAnagraficaRefresh() {
    if (!autoWeekly) return;
    const now = new Date();
    const next = new Date(now);
    next.setHours(12, 0, 0, 0);
    const dow = next.getDay(); // 0=dom
    let daysUntilSun = (7 - dow) % 7;
    if (daysUntilSun === 0 && now.getTime() >= next.getTime()) daysUntilSun = 7;
    next.setDate(next.getDate() + daysUntilSun);
    const ms = next.getTime() - now.getTime();
    logger.info(`Prossimo refresh anagrafica: ${next.toLocaleString('it-IT')} (tra ${Math.round(ms/3600000)}h)`);
    clearTimeout(anagraficaTimer);
    anagraficaTimer = setTimeout(() => {
      try { refreshAnagrafica(); } catch (e) { logger.error(`Refresh anagrafica schedulato fallito: ${e.message}`); }
      // ciclo successivo: 7 giorni
      anagraficaTimer = setInterval(() => {
        try { refreshAnagrafica(); } catch (e) { logger.error(`Refresh anagrafica schedulato fallito: ${e.message}`); }
      }, 7 * 24 * 60 * 60 * 1000);
    }, ms);
  }
  scheduleNextAnagraficaRefresh();
```

E nel `shutdown(signal)` aggiungi `clearTimeout(anagraficaTimer);` prima di `httpServer.close`.

- [ ] **Step 3: Verifica log boot**

Restart dev. Expected log: `Prossimo refresh anagrafica: <domenica 12:00 it-IT> (tra Nh)`. Verifica che non ci siano crash.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(F10): scheduler refresh anagrafica settimanale (domenica 12:00)"
```

---

### Task 5: Validation — `cldm` required, `pv_*`/`numero_ordine` optional

**Files:**
- Modify: `server/modules/validation.js` (~riga 22-61, `creaResoSchema`)

**Interfaces:**
- Produces: `creaResoSchema` con `cldm` obbligatorio, `pv_*` opzionali, `numero_ordine` opzionale/nullable.

- [ ] **Step 1: Modifica `creaResoSchema`**

Sostituisci il campo `numero_ordine` (riga ~23):
```js
numero_ordine: z.string().regex(ORDINE_REGEX, 'Formato ordine non valido').transform(sanitize).optional().nullable(),
```
Sostituisci `cldm` (riga ~28) da optional a obbligatorio:
```js
cldm: z.string().regex(CLDM_REGEX, 'CLDM non valido').transform(sanitize),
```
Rendi `pv_*` opzionali (righe ~52-57), perché il server li deriva dal `cldm`:
```js
pv_nome: z.string().min(1).max(255).transform(sanitize).optional().nullable(),
pv_indirizzo: z.string().min(1).max(255).transform(sanitize).optional().nullable(),
pv_citta: z.string().min(1).max(100).transform(sanitize).optional().nullable(),
pv_cap: z.string().min(1).max(10).transform(sanitize).optional().nullable(),
pv_provincia: z.string().min(1).max(50).transform(sanitize).optional().nullable(),
pv_regione: z.string().max(50).transform(sanitize).optional().nullable(),
```
`linee`, `corriere`, `corriere_nome`, `num_colli`, `ddt_*` restano invariati.

- [ ] **Step 2: Verifica boot + schema**

Restart dev. Verifica con un payload mancante `cldm` → 400:
```bash
curl -s -X POST localhost:3002/api/resi -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"motivo_reso":"difettoso","linee":[{"nome":"BA","numero_pezzi":1}],"corriere":"GLS"}' | jq .
```
Expected: 400 con issue su `cldm`. (Il 201 richiede `cldm` valido + deriva `pv_*` — verificato in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add server/modules/validation.js
git commit -m "feat(F10): cldm obbligatorio, pv_* e numero_ordine opzionali nello schema"
```

---

### Task 6: `resi.js` — deriva `pv_*` dal `cldm`; `numero_ordine` optional

**Files:**
- Modify: `server/modules/resi.js` (POST ~riga 56-180, PUT ~riga 206-269)

**Interfaces:**
- Consumes: `lookupPvByCldm` from Task 2; `creaResoSchema` (Task 5).
- Produces: POST/PUT risolvono `pv_nome/pv_indirizzo/pv_citta/pv_cap/pv_provincia/pv_regione` da `anagrafica_pv` usando `cldm`.

- [ ] **Step 1: Aggiungi import in `resi.js`**

```js
import { lookupPvByCldm } from '../lib/anagrafica.js';
```

- [ ] **Step 2: Modifica POST `/` — risolvi pv_* e num_ordine nullo**

Dopo `const { ... } = parsed.data;` (~riga 65), aggiungi risoluzione PV. Sostituisci il blocco che prepara i valori `pv_*` per l'INSERT. Trova le righe che passano `pv_nome || null, ...` (~riga 123-128) e sostituisci con valori derivati:

```js
  // F10: il client invia solo cldm; pv_* derivano dall'anagrafica (autorevole).
  const pv = lookupPvByCldm(cldm);
  if (!pv) {
    return res.status(400).json({ error: 'CLDM non presente in anagrafica. Aggiornare l\'anagrafica o verificare il codice.', cldm });
  }
  const pvNome = pv.nome || null;
  const pvIndirizzo = pv.indirizzo || null;
  const pvCitta = pv.citta || null;
  const pvCap = pv.cap || null;
  const pvProvincia = pv.provincia || null;
  const pvRegione = pv.regione || null;
```

Nell'INSERT stmt.run(...), sostituisci gli argomenti `pv_nome || null, pv_indirizzo || null, ...` (righe ~123-128) con `pvNome, pvIndirizzo, pvCitta, pvCap, pvProvincia, pvRegione`. Cambia anche `numero_ordine` → `numero_ordine || ''` (la colonna è NOT NULL sui DB esistenti; '' è sicuro e gestito come "nessun ordine").

- [ ] **Step 3: Stessa derivazione in PUT `/`**

Nel PUT (~riga 233-262), dopo `const { ... } = parsed.data;`, replica la risoluzione `pv`/`pvNome/...` e usa quei valori nell'UPDATE. Se `cldm` assente nel PUT (vecchi PUT), fallback: mantieni i `pv_*` esistenti (non sovrascrivere a null). Aggiungi guardia:
```js
  let pvNome = existing... // per PUT vecchi senza cldm, non derivare
```
Pragmatico: in PUT, se `cldm` presente → deriva; se assente → usa i `pv_*` del body (che ora sono opzionali) o mantieni gli esistenti. Implementazione minima:
```js
  let pvNome = pv_nome || null, pvIndirizzo = pv_indirizzo || null, pvCitta = pv_citta || null, pvCap = pv_cap || null, pvProvincia = pv_provincia || null, pvRegione = pv_regione || null;
  if (cldm) {
    const pv = lookupPvByCldm(cldm);
    if (pv) { pvNome = pv.nome || pvNome; pvIndirizzo = pv.indirizzo || pvIndirizzo; pvCitta = pv.citta || pvCitta; pvCap = pv.cap || pvCap; pvProvincia = pv.provincia || pvProvincia; pvRegione = pv.regione || pvRegione; }
  }
```
Usa questi nel `.run(...)` dell'UPDATE.

- [ ] **Step 4: Verifica e2e POST**

Restart dev. Con un CS token (auto-chiuso):
```bash
curl -s -X POST localhost:3002/api/resi -H "Authorization: Bearer $CS_TOK" -H 'Content-Type: application/json' \
  -d '{"cldm":"507888","motivo_reso":"difettoso","linee":[{"nome":"BA","numero_pezzi":3}],"corriere":"GLS","num_colli":2}' | jq .
```
Expected: 201 con `num_reso` e `stato:"approvato"`. Verifica riga DB:
```bash
sqlite3 data/resi.db "SELECT cldm, pv_nome, pv_citta, num_reso, corriere, linee FROM richieste_reso ORDER BY id DESC LIMIT 1;"
```
Expected: `507888|GHEZZI LUIGI SRL|ANDALO|<N>|GLS|[{"nome":"BA","numero_pezzi":3}]`.

- [ ] **Step 5: Commit**

```bash
git add server/modules/resi.js
git commit -m "feat(F10): resi.js deriva pv_* dal cldm (anagrafica autorevole)"
```

---

### Task 7: `LineeForm.tsx` — `<select>` per riga + "Altro…"

**Files:**
- Modify: `src/components/ui/LineeForm.tsx`

**Interfaces:**
- Consumes: `lineeDisponibili: string[]` (prop nuova) — linee aperte del PV selezionato (vuoto se nessun PV).
- Produces: riga con `nome` da `<select>` (opzioni = `lineeDisponibili` + "Altro…") o testo libero se "Altro…"; `numero_pezzi` invariato.

- [ ] **Step 1: Consulta accessibility-lead (edit-gate .tsx)**

Prima di editare `.tsx`, delega a `accessibility-lead` (o leggi `forms-specialist.md`/`keyboard-navigator.md`) per il pattern select+Altro con focus management. Applica i suggerimenti.

- [ ] **Step 2: Modifica `LineeForm.tsx`**

Aggiungi prop `lineeDisponibili: string[]`. Per ogni riga:
- Se `lineeDisponibili` è vuota → mostra input testo libero (come ora) con hint "Seleziona prima un punto vendita".
- Altrimenti → `<select>` con `<option value="">—</option>`, le opzioni da `lineeDisponibili`, e `<option value="__ALTRO__">Altro…</option>`. Quando `nome === '__ALTRO__'` (o un flag `isAltro`) mostra un input testo libero per il nome custom. Mantieni `numero_pezzi` input.
- `<fieldset>` + `<legend className="sr-only">Linea {i+1}</legend>` invariati. `<label htmlFor>` per select e numero_pezzi. Remove button ≥44px `aria-label`. Add button ≥48px.
- Focus management: selezionando "Altro…" → focus sull'input custom (ref). Add linea → focus sul nuovo select. Remove → focus sul add button (come da F9).

Struttura stato riga: mantieni `{ nome, numero_pezzi }`; per "Altro…" usa un valore sentinella: quando l'utente seleziona "Altro…" imposta `nome = ''` e un flag locale `altre[i] = true`; l'input testo aggiorna `nome`. Alla submit, se `altre[i]` è false il `nome` è il valore della select; se true è il testo libero.

```tsx
interface Linea { nome: string; numero_pezzi: number; }
interface Props {
  value: Linea[];
  onChange: (v: Linea[]) => void;
  lineeDisponibili?: string[]; // F10: linee aperte del PV selezionato
}
```
Implementa il rendering condizionale select vs input secondo `lineeDisponibili?.length > 0`.

- [ ] **Step 3: Verifica hot-reload + keyboard**

Apri il form nel browser, seleziona un CLDM con linee, verifica: select popolata, scelta linea, scelta "Altro…" → compare input e ci va il focus, tab tra campi, add/remove riga. Verifica con tastiera (Tab/Shift+Tab/Enter) e screen reader (live region).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/LineeForm.tsx
git commit -m "feat(F10): LineeForm select da linee PV + opzione Altro"
```

---

### Task 8: `ResoForm.tsx` — CLDM combobox + PV read-only; remove numero_ordine + manual PV

**Files:**
- Modify: `src/components/resi/ResoForm.tsx`

**Interfaces:**
- Consumes: `GET /api/anagrafica?q=` (search) e `GET /api/anagrafica/:cldm` (lookup) from Task 3; `LineeForm` con `lineeDisponibili` (Task 7).
- Produces: POST body `{ cldm, linee, corriere, corriere_nome, num_colli, ddt_numero, ddt_data, motivo_reso, note }` (NO `numero_ordine`, NO `pv_*`).

- [ ] **Step 1: Consulta accessibility-lead (edit-gate .tsx)**

Delega a `accessibility-lead` per il pattern combobox (input + datalist) con live region + read-only fields. Applica i suggerimenti.

- [ ] **Step 2: Rimuovi stato numero_ordine e pv_* manuali**

Rimuovi: `numeroOrdine` state + il campo "Numero Ordine". Rimuovi: `pvNome/pvIndirizzo/pvCitta/pvCap/pvProvincia/pvRegione` state + il fieldset PV manuale. Aggiungi stato:
```tsx
const [cldm, setCldm] = useState('');
const [pv, setPv] = useState<{nome?:string; indirizzo?:string; citta?:string; cap?:string; provincia?:string; regione?:string; linee?:string[]} | null>(null);
const [opzioniCldm, setOpzioniCldm] = useState<{cldm:string; nome:string; citta?:string}[]>([]);
const [cldmError, setCldmError] = useState('');
const [lineePv, setLineePv] = useState<string[]>([]);
```

- [ ] **Step 3: Combobox CLDM + lookup**

Input CLDM con `<datalist>`:
```tsx
<input
  id="cldm" list="cldm-options" required
  inputMode="numeric" pattern="[A-Za-z0-9_\-]{2,20}"
  value={cldm}
  onChange={(e) => {
    setCldm(e.target.value);
    // debounced search — vedi Step 4
  }}
  onBlur={() => fetchPv(cldm)}
  className="input-mobile"
  aria-describedby="cldm-hint"
/>
<datalist id="cldm-options">
  {opzioniCldm.map(o => <option key={o.cldm} value={o.cldm}>{o.cldm} — {o.nome} ({o.citta})</option>)}
</datalist>
```
Lookup on blur/selezione:
```tsx
async function fetchPv(code: string) {
  if (!code) { setPv(null); setLineePv([]); return; }
  try {
    const res = await fetch(`/api/anagrafica/${encodeURIComponent(code)}`, { headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` } });
    if (!res.ok) { setPv(null); setLineePv([]); setCldmError('CLDM non trovato in anagrafica'); return; }
    const data = await res.json();
    setPv(data.pv);
    setLineePv(data.pv.linee || []);
    setCldmError('');
  } catch { setCldmError('Errore caricamento PV'); }
}
```
Search debounced (≥2 char):
```tsx
useEffect(() => {
  if (cldm.length < 2) { setOpzioniCldm([]); return; }
  const t = setTimeout(async () => {
    try {
      const res = await fetch(`/api/anagrafica?q=${encodeURIComponent(cldm)}`, { headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` } });
      if (res.ok) setOpzioniCldm((await res.json()).data || []);
    } catch {}
  }, 250);
  return () => clearTimeout(t);
}, [cldm]);
```

- [ ] **Step 4: PV read-only + live region**

Sotto l'input CLDM, mostra i campi PV read-only (solo se `pv`):
```tsx
{pv && (
  <div className="pt-2 border-t border-gray-700" aria-live="polite">
    <p className="text-sm font-semibold text-gray-200 mb-2">Punto vendita (da anagrafica)</p>
    <dl className="text-sm text-gray-300 space-y-1">
      <div><dt className="font-medium">Nome</dt><dd>{pv.nome}</dd></div>
      <div><dt className="font-medium">Indirizzo</dt><dd>{pv.indirizzo}</dd></div>
      <div><dt className="font-medium">Città</dt><dd>{pv.citta} ({pv.cap}) — {pv.provincia}</dd></div>
    </dl>
  </div>
)}
<div role="status" aria-live="polite" className="sr-only">
  {pv ? `Punto vendita trovato: ${pv.nome}` : cldmError || ''}
</div>
```

- [ ] **Step 5: Aggiorna LineeForm + POST body**

```tsx
<LineeForm value={linee} onChange={setLinee} lineeDisponibili={lineePv} />
```
POST body (rimuovi `numero_ordine` e `pv_*`, aggiungi `cldm`):
```tsx
body: JSON.stringify({
  cldm,
  motivo_reso: motivo,
  note: note || undefined,
  linee,
  corriere,
  corriere_nome: corriere === 'ALTRI' ? corriereNome : null,
  ddt_numero: ddtNumero || null,
  ddt_data: ddtData || null,
  num_colli: numColli ? Number(numColli) : null,
}),
```
Submit disabled: `loading || !motivo || !corriere || !cldm || !pv`.

- [ ] **Step 6: Verifica browser**

Apri il form, digita "507888" → datalist mostra opzioni; seleziona → PV read-only compilato (GHEZZI LUIGI); linee dropdown popolate (BA-FP-LC-MB-SX); scegli una linea + "Altro…"; invia → toast "Reso N. X creato". Verifica keyboard + screen reader.

- [ ] **Step 7: Commit**

```bash
git add src/components/resi/ResoForm.tsx
git commit -m "feat(F10): ResoForm CLDM combobox + PV read-only, remove numero_ordine/PV manuale"
```

---

### Task 9: Pagine dettaglio — mostra CLDM

**Files:**
- Modify: `src/app/customer-service/richieste/[id]/page.tsx`
- Modify: `src/app/dashboard/richieste/[id]/page.tsx`
- Modify: `src/app/venditore/richieste/[id]/page.tsx`

**Interfaces:**
- Consumes: campo `cldm` già presente nel JSON dettaglio (richieste_reso.cldm).

- [ ] **Step 1: Aggiungi `cldm?` all'interfaccia richiesta (3 file)**

Aggiungi `cldm?: string | null;` all'interfaccia `Richiesta` di ciascuna pagina.

- [ ] **Step 2: Mostra "CLDM {cldm}" nella card PV (3 file)**

Nella card "Dati ritiro corriere" / "Punto vendita", aggiungi una riga sotto il nome PV:
```tsx
{richiesta.cldm && (
  <p className="text-sm text-gray-400">CLDM: {richiesta.cldm}</p>
)}
```
Solo se `cldm` presente (resi nuovi F10); resi vecchi senza cldm non lo mostrano.

- [ ] **Step 3: Verifica hot-reload 3 pagine**

Apri il dettaglio di un reso F10 appena creato → mostra "CLDM: 507888". Apri un reso vecchio → nessuna riga CLDM (backward compat).

- [ ] **Step 4: Commit**

```bash
git add src/app/customer-service/richieste/[id]/page.tsx src/app/dashboard/richieste/[id]/page.tsx src/app/venditore/richieste/[id]/page.tsx
git commit -m "feat(F10): pagine dettaglio mostrano CLDM del PV"
```

---

### Task 10: Endpoint file GLS giornaliero

**Files:**
- Modify: `server/modules/customer-service.js`

**Interfaces:**
- Consumes: `buildResiXls` from `server/lib/xls-export.js` (già importato, riga 9).
- Produces: `GET /api/customer-service/gls/giornaliero?data=YYYY-MM-DD` → `.xls` multi-riga + scrittura su disco.

- [ ] **Step 1: Aggiungi import fs + path + export dir**

In cima a `customer-service.js`:
```js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GLS_EXPORT_DIR = process.env.GLS_EXPORT_DIR || '/home/adimn/Scrivania';
```

- [ ] **Step 2: Aggiungi endpoint `gls/giornaliero`**

**Importante**: registra questa rotta **prima** di `/richieste/:uuid` e `/richieste/:uuid/xls` per evitare che `:uuid` catturi "gls". Inseriscila dopo `router.get('/richieste', ...)` e prima di `router.get('/richieste/:uuid', ...)`.

```js
// GET /api/customer-service/gls/giornaliero?data=YYYY-MM-DD (default oggi)
// File GLS giornaliero aggregato: tutti i resi approvati dall'interno nella
// giornata con corriere=GLS. Una riga per reso, header 16-col RITGIO invariato.
// Salva su disco (RITGIO_GLS_<DDMMYY>.xls) + stream download.
router.get('/gls/giornaliero', (req, res) => {
  const dataParam = req.query.data || new Date().toISOString().split('T')[0];
  const rows = db.prepare(
    `SELECT * FROM richieste_reso
     WHERE stato = 'approvato' AND corriere = 'GLS' AND date(data_approvazione) = date(?)
     ORDER BY num_reso ASC`
  ).all(dataParam);

  if (rows.length === 0) {
    return res.status(404).json({ error: `Nessun reso GLS approvato in data ${dataParam}`, count: 0 });
  }

  try {
    const { buf, filename } = buildResiXls(rows);
    // nome file distintivo per il giornaliero aggregato
    const glsFilename = filename.replace('RITGIO_', 'RITGIO_GLS_');
    const outPath = path.join(GLS_EXPORT_DIR, glsFilename);
    try { fs.writeFileSync(outPath, Buffer.from(buf)); } catch (e) {
      logger.error(`Scrittura file GLS su disco fallita: ${e.message}`);
    }
    logger.info(`File GLS giornaliero generato: ${glsFilename} (${rows.length} resi) da CS ${req.user.id}`);
    logAudit(req.user.id, 'GLS_EXPORT_GIORNALIERO', { filename: glsFilename, count: rows.length, data: dataParam }, req);
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', `attachment; filename="${glsFilename}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    logger.error(`Errore generazione file GLS giornaliero: ${err.message}`);
    res.status(500).json({ error: 'Errore generazione file GLS', detail: err.message });
  }
});
```

- [ ] **Step 3: Verifica endpoint**

Restart dev. Crea/approva almeno 1 reso GLS oggi (Task 6 ne crea uno auto-chiuso), poi:
```bash
curl -s "localhost:3002/api/customer-service/gls/giornaliero" -H "Authorization: Bearer $CS_TOK" -o /tmp/gls.xls -w '%{http_code}\n'
ls -la /tmp/gls.xls
ls -la /home/adimn/Scrivania/RITGIO_GLS_*.xls
```
Expected: 200, file creato, file su disco in Scrivania. Verifica contenuto:
```bash
node --input-type=module -e 'import XLSX from "xlsx"; const wb=XLSX.readFile("/tmp/gls.xls"); const ws=wb.Sheets[wb.SheetNames[0]]; console.log(XLSX.utils.sheet_to_json(ws,{header:1}).map(r=>r.slice(0,7)));'
```
Expected: header 16-col + N righe (una per reso GLS odierno), PV da anagrafica.

- [ ] **Step 4: Commit**

```bash
git add server/modules/customer-service.js
git commit -m "feat(F10): endpoint file GLS giornaliero aggregato (disco + download)"
```

---

### Task 11: Pagina "File GLS giornaliero"

**Files:**
- Create: `src/app/customer-service/gls/page.tsx`

**Interfaces:**
- Consumes: `GET /api/customer-service/gls/giornaliero?data=` (Task 10).

- [ ] **Step 1: Consulta accessibility-lead (edit-gate .tsx)**

Delega a `accessibility-lead` per la pagina con bottone + date picker + conteggio. Applica i suggerimenti.

- [ ] **Step 2: Crea `src/app/customer-service/gls/page.tsx`**

Pagina client con: H1 "File GLS giornaliero", `<input type="date">` (default oggi), bottone "Genera e scarica file GLS", conteggio (da un endpoint o mostrato dopo il download). Il click chiama l'endpoint e triggera il download del blob:

```tsx
'use client';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';

export default function GlsGiornalieroPage() {
  const { addToast } = useToast();
  const [data, setData] = useState(() => new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  async function scarica() {
    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/customer-service/gls/giornaliero?data=${data}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        addToast('error', d.error || 'Nessun reso GLS per questa data');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RITGIO_GLS_${data.replaceAll('-', '')}.xls`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      addToast('success', 'File GLS generato e scaricato');
    } catch {
      addToast('error', 'Errore generazione file GLS');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pt-4 space-y-4">
      <h1 className="text-2xl font-bold text-white">File GLS giornaliero</h1>
      <p className="text-sm text-gray-400">
        Genera un unico file con tutti i resi approvati dall'interno nella giornata con corriere GLS.
      </p>
      <div className="space-y-3">
        <div>
          <label htmlFor="data" className="block text-sm font-medium text-gray-300 mb-1.5">Data</label>
          <input id="data" type="date" value={data} onChange={(e) => setData(e.target.value)} className="input-mobile" />
        </div>
        <button onClick={scarica} disabled={loading} className="btn-mobile min-h-[48px]">
          {loading ? 'Generazione...' : 'Genera e scarica file GLS'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Aggiungi link nella navigazione customer-service**

Trova la nav/sidebar del customer-service (cerca `link`/`nav` in `src/app/customer-service/layout.tsx` o simile) e aggiungi un link a `/customer-service/gls` "File GLS". Verifica WCAG: link testuale descrittivo, contrasto, focus visibile.

- [ ] **Step 4: Verifica browser**

Apri `/customer-service/gls`, scegli data, click "Genera e scarica" → file scaricato + toast. Verifica keyboard (Tab fino al bottone, Enter attiva) e contrasto.

- [ ] **Step 5: Commit**

```bash
git add src/app/customer-service/gls/page.tsx src/app/customer-service/layout.tsx
git commit -m "feat(F10): pagina File GLS giornaliero + nav"
```

---

### Task 12: Verifica e2e + cleanup

**Files:** nessuno (verifica).

- [ ] **Step 1: Verifica anagrafica end-to-end**

```bash
node --input-type=module -e 'import {anagraficaStatus} from "./server/lib/anagrafica.js"; console.log(anagraficaStatus());'
```
Expected: count ~6000, source_exists true.

- [ ] **Step 2: Flusso reso completo (browser)**

Come interno (CS): form → CLDM 507888 → PV read-only → 2 linee (una da elenco, una "Altro…") → corriere GLS → invia → toast "Reso N. X" → dettaglio mostra CLDM + PV da anagrafica + linee.

- [ ] **Step 3: File GLS giornaliero**

Pagina `/customer-service/gls` → genera → file multi-riga con il reso appena creato. Verifica su disco `/home/adimn/Scrivania/RITGIO_GLS_*.xls`.

- [ ] **Step 4: Backward compat**

Dettaglio di un reso vecchio (es. `b497d777` o uuid pre-F10) → mostra prodotti (fallback), PV da cldm (resolvePv), nessuna riga CLDM se cldm vuoto. XLS del reso vecchio → fallback BDA. Verifica:
```bash
sqlite3 data/resi.db "SELECT uuid, cldm, num_reso, linee FROM richieste_reso WHERE linee IS NULL OR linee='' LIMIT 3;"
```

- [ ] **Step 5: XLS reso nuovo**

`GET /api/customer-service/richieste/<uuid>/xls` del reso F10 → PV da anagrafica (pv_nome), "Aut. N. X", destinatario "ABC SRL RESI".

- [ ] **Step 6: A11y keyboard pass**

Tab attraverso tutto il form: CLDM → datalist → linee select → Altro input → corriere → num_colli → submit. Verifica focus visibile, nessuna trappola, live region annunci.

- [ ] **Step 7: Prod intatto**

```bash
ps -o pid,etime,cmd -p 3545347 2>/dev/null || echo "prod non su questa macchina"
```
Expected: prod :3001 non toccato (uptime invariato).

- [ ] **Step 8: Aggiorna memoria**

Aggiorna `/home/adimn/.claude/projects/-home-adimn-Scrivania/memory/abc-hub-resi-3features-content-audit-xls.md` con sezione F10 (anagrafica interna, ZSD127.xlsx path/colonne, scheduler dom 12:00, file GLS giornaliero, gotchas).

- [ ] **Step 9: Commit finale**

```bash
git add docs/superpowers/specs/2026-09-08-f10-anagrafica-cldm-linee-gls-giornaliero-design.md
git commit -m "docs(F10): spec + piano implementazione"
```

---

## Self-Review

**Spec coverage:**
- Rimuovi numero ordine → Task 5 (optional) + Task 8 (rimuovi campo form) + Task 6 (insert ''). ✅
- CLDM association + auto-fill → Task 2 (lookup) + Task 3 (API) + Task 8 (combobox). ✅
- Anagrafica ZSD127.xlsx colonne U/V/W/X/Y/Z/AL/AM/AN/AO/AS → Task 2 (COL map). ✅
- Linee da PV + Altro → Task 7. ✅
- File GLS giornaliero → Task 10 + Task 11. ✅
- Anagrafica DB interno + dom 12:00 + refresh forzato → Task 1 (table) + Task 2 (importer) + Task 3 (refresh API) + Task 4 (scheduler). ✅
- pv_* derivati server-side (hardening) → Task 6. ✅
- Backward compat → Task 9 (cldm opzionale nel dettaglio) + Task 12 Step 4. ✅
- A11y → Task 7/8/11 consultano accessibility-lead. ✅

**Placeholder scan:** nessun "TBD/TODO". I passi "Consulta accessibility-lead" sono azioni reali (delega richiesta dall'edit-gate), non placeholder.

**Type consistency:** `lookupPvByCldm` restituisce `linee:string[]` (Task 2) → `LineeForm` riceve `lineeDisponibili:string[]` (Task 7) → `ResoForm` passa `lineePv` (Task 8). `searchPv` ritorna `{cldm,nome,citta,provincia}[]` (Task 2) → `ResoForm` datalist (Task 8). `buildResiXls(rows)` accetta lista (Task 10) — già definito in `xls-export.js`. `refreshAnagrafica()` usato da Task 3 e Task 4 — firma identica. ✅