# F11 — Anagrafica agenti + provisioning utenti + routing per responsabile

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provisioning di tutti gli account di login del sito-resi (promotori / responsabili / agenti) da `anagrafica_agenti.xlsx` in un DB interno `anagrafica_agenti` con mirror nella tabella `users` esistente (hash-only bcrypt+PEPPER), e routing delle approvazioni di 1° livello per responsabile: ogni venditore vede solo i resi `in_attesa` dei PV assegnati a lui via `anagrafica_pv.resp_codice`.

**Architecture:** Un importer (`server/lib/agenti.js`) legge il xlsx (Foglio1, 107 righe senza header), deriva il ruolo matchando il codice (col A) contro `anagrafica_pv.resp_codice`/`promo_codice`, hasha la password (col D) con bcrypt+PEPPER, upserta `anagrafica_agenti` (fonte) e mirrora in `users` per email (password solo alla creazione). Un filtro in `venditore.js` carica il `codice_cliente_esterno` del venditore loggato e, se matcha un `resp_codice` in `anagrafica_pv`, restringe lista/dettaglio/approvazione ai soli resi con `r.resp_codice` uguale; resi creati pre-F11 vengono backfillati da `anagrafica_pv`. API admin (refresh forzato + status + lista) + scheduler settimanale (dopo `refreshAnagrafica`).

**Tech Stack:** Node.js ESM, Express, better-sqlite3 (SQLite WAL), SheetJS xlsx@0.18.5 (già dipendenza — `import XLSX from 'xlsx'` default), bcrypt (`server/lib/security.js`), JWT RS256 esistente. Nessuna nuova dipendenza.

## Global Constraints

- **Dev-first, MAI restartare/toccare prod Express :3001** (pid 3545347, `.express.pid`). Restart solo dev :3002 dopo modifiche a `server/modules/*.js`/`server/lib/*.js`: `kill $(lsof -ti:3002); rm -f .next/dev/lock; node server.js > /tmp/resi-dev.log 2>&1 &`. Pagine client `.tsx` → hot-reload, no restart.
- **Sicurezza credenziali (VERBATIM):** `anagrafica_agenti.xlsx` contiene password in chiaro ed è FUORI dal repo (`/home/adimn/Scrivania/`). Conservare SOLO l'hash (bcrypt + `PASSWORD_PEPPER` via `hashPassword(password, PEPPER)` di `server/lib/security.js`). Il file xlsx NON va mai committato, copiato nel repo, né loggato. Le password in chiaro NON vanno mai loggate né inviate in risposta API. Il path del xlsx non va comunicato ad agenti non autorizzati.
- **Password su refresh:** imposta `password_hash` in `users` SOLO alla creazione del nuovo utente (INSERT). Sui refresh successivi (utente esistente per email) NON sovrascrivere `password_hash` — aggiorna solo `nome`, `codice_cliente_esterno`, `ruolo`. In `anagrafica_agenti` (tabella fonte) `password_hash` va invece SEMPRE aggiornato (è la fonte di verità interna).
- **Nessuna nuova dipendenza** (composer/npm): xlsx e bcrypt già presenti.
- **Italiano** per tutta UI, messaggi, commenti codice, log.
- **WCAG AA** per ogni UI. F11 tocca solo API + DB (nessuna UI nuova) → la constrain a11y si applica solo se si aggiungesse UI (non previsto).
- **Nessun test suite automatico** (verifica manuale via curl, come F10). Procedura login: `GET /api/auth/csrf-token` (cookie jar) → `POST /api/auth/login` body `{csrf_token, email, password}` → risposta chiave `access_token` → `Authorization: Bearer <token>`.
- **Idempotente:** migrazioni DB via `addColumnIfMissing` (pattern esistente `server/lib/db.js:54`) + `CREATE TABLE IF NOT EXISTS`. Backfill solo righe `resp_codice IS NULL`.
- **Query parametrizzate** PDO-style better-sqlite3 (placeholder `?`). Nessuna concatenazione SQL con input.
- **Branch:** `feature/f11` da `feature/f10` (HEAD `4f6581b`). Baseline registrata prima di ogni dispatch.
- **Non droppare tabelle, non rompere resi esistenti** (34 resi, 9 users pre-F11 nel dev DB).

---

## File Structure

| File | Responsabilità | Creazione/Modifica |
|---|---|---|
| `server/lib/db.js` | Migrazione: `anagrafica_agenti` table + `resp_codice`/`resp_nome` su `richieste_reso` + indici | Modifica (dopo le `addColumnIfMissing` esistenti, ~riga 100) |
| `database/schema.sql` | Fresh install: `anagrafica_agenti` + `resp_*` su `richieste_reso` + indici | Modifica |
| `server/lib/agenti.js` | Importer: `refreshAnagrafica`→`refreshAgenti` (read xlsx, role match, hash, upsert anagrafica_agenti, mirror users, backfill resi resp_*), `agentiStatus()`, `listAgenti()` | Crea |
| `server/modules/admin.js` | 3 route admin agenti: `POST /agenti/refresh`, `GET /agenti/status`, `GET /agenti` | Modifica (dopo route /users) |
| `server.js` | Import `refreshAgenti` + chiamata dopo `refreshAnagrafica()` nello scheduler dom 12:00 | Modifica (import riga 18 + scheduler riga 92-99) |
| `server/modules/resi.js` | POST/PUT memorizzano `resp_codice`/`resp_nome` da `lookupPvByCldm` | Modifica (POST INSERT + PUT update) |
| `server/modules/venditore.js` | Routing filter su 3 endpoint (lista, dettaglio, approvazione) | Modifica (3 handler) |

Nessun file UI nuovo. Nessun nuovo modulo di routing montato (le route agenti vivono dentro `admin.js`, già montato su `/api/admin` con `authenticate`+`authorize('admin')`).

---

## Task 1: Schema DB — `anagrafica_agenti` + `resp_codice`/`resp_nome` su `richieste_reso`

**Files:**
- Modify: `server/lib/db.js` (dopo il blocco `addColumnIfMissing` esistente, prima di `export function close`)
- Modify: `database/schema.sql` (blocco `richieste_reso` righe 41-74 + nuova tabella dopo `anagrafica_pv` riga 161)

**Interfaces:**
- Produces: tabella `anagrafica_agenti(codice PK, nome, email, password_hash, ruolo, updated_at)` + indice `idx_anagrafica_agenti_email`; colonne `richieste_reso.resp_codice TEXT`, `richieste_reso.resp_nome TEXT` + indice `idx_richieste_reso_resp_codice`. Task 2 le popola, Task 4/5 le leggono/filtrano.

- [ ] **Step 1: Aggiungi migrazione colonne + tabella in `server/lib/db.js`**

Inserisci dopo l'ultima `addColumnIfMissing('richieste_reso', 'num_reso', 'INTEGER')` e prima del blocco `CREATE TABLE IF NOT EXISTS anagrafica_pv` (o subito dopo quest'ultimo, mantenendo l'ordine esistente). Aggiungi le due colonne resp e la tabella agenti:

```js
// F11: routing approvazioni per responsabile. resp_codice/resp_nome memorizzati
// sul reso alla creazione (lookupPvByCldm) e usati dal filtro venditore.js.
addColumnIfMissing('richieste_reso', 'resp_codice', 'TEXT');
addColumnIfMissing('richieste_reso', 'resp_nome', 'TEXT');
```

Dopo il blocco `CREATE TABLE IF NOT EXISTS anagrafica_pv` (dopo il suo `try/catch`), aggiungi la tabella agenti e gli indici:

```js
// F11: anagrafica agenti interna (fonte per provisioning users). Importata da
// anagrafica_agenti.xlsx (FUORI repo). password_hash = bcrypt+PEPPER, mai chiaro.
try {
  db.exec(`CREATE TABLE IF NOT EXISTS anagrafica_agenti (
    codice TEXT PRIMARY KEY,
    nome TEXT,
    email TEXT,
    password_hash TEXT,
    ruolo TEXT,
    updated_at TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_anagrafica_agenti_email ON anagrafica_agenti(email)');
} catch (err) {
  console.error('Errore creazione anagrafica_agenti:', err.message);
}
// Indice resp_codice per il filtro venditore (idempotente).
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_richieste_reso_resp_codice ON richieste_reso(resp_codice)');
} catch (err) {
  console.error('Errore creazione idx_richieste_reso_resp_codice:', err.message);
}
```

- [ ] **Step 2: Aggiorna `database/schema.sql` per i fresh install**

Nel blocco `richieste_reso`, dopo `num_reso INTEGER` (ultima colonna, riga ~74), aggiungi prima della parentesi di chiusura:

```sql
  -- F11: routing per responsabile. Popolati alla creazione da lookupPvByCldm(cldm).
  resp_codice TEXT,                       -- codice responsabile (anagrafica_pv.resp_codice)
  resp_nome TEXT                          -- nome responsabile (anagrafica_pv.resp_nome)
```

Dopo `CREATE INDEX IF NOT EXISTS idx_anagrafica_pv_nome ON anagrafica_pv(nome);` (riga 161), aggiungi la tabella agenti + indice:

```sql

-- F11: anagrafica agenti (fonte provisioning users). xlsx FUORI repo.
CREATE TABLE IF NOT EXISTS anagrafica_agenti (
  codice TEXT PRIMARY KEY,
  nome TEXT,
  email TEXT,
  password_hash TEXT,                     -- bcrypt + PASSWORD_PEPPER, mai in chiaro
  ruolo TEXT,                             -- store_account|venditore (match vs anagrafica_pv)
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_anagrafica_agenti_email ON anagrafica_agenti(email);
CREATE INDEX IF NOT EXISTS idx_richieste_reso_resp_codice ON richieste_reso(resp_codice);
```

- [ ] **Step 3: Restart dev e verifica presenza colonne/tabella**

Run:
```bash
kill $(lsof -ti:3002); rm -f .next/dev/lock; node server.js > /tmp/resi-dev.log 2>&1 &
sleep 2
```

Verifica (expected: entrambe le colonne presenti, tabella con 6 colonne, indici presenti, 0 righe in anagrafica_agenti, 9 users e 34 resi invariati):
```bash
node -e "const db=require('better-sqlite3')('./data/resi.db'); const cols=db.prepare('PRAGMA table_info(richieste_reso)').all().map(c=>c.name); console.log('resp_codice:', cols.includes('resp_codice'), 'resp_nome:', cols.includes('resp_nome')); console.log('anagrafica_agenti cols:', db.prepare('PRAGMA table_info(anagrafica_agenti)').all().map(c=>c.name)); console.log('agenti rows:', db.prepare('SELECT COUNT(*) c FROM anagrafica_agenti').get().c); console.log('users:', db.prepare('SELECT COUNT(*) c FROM users').get().c, 'resi:', db.prepare('SELECT COUNT(*) c FROM richieste_reso').get().c); console.log('idx resp:', db.prepare(\"SELECT name FROM sqlite_master WHERE type='index' AND name='idx_richieste_reso_resp_codice'\").get());"
```

- [ ] **Step 4: Commit**

```bash
git add server/lib/db.js database/schema.sql
git commit -m "feat(F11): schema anagrafica_agenti + resp_codice/resp_nome su richieste_reso

Aggiunge la tabella anagrafica_agenti (fonte provisioning utenti) e le
colonne resp_codice/resp_nome su richieste_reso per il routing delle
approvazioni di 1° livello per responsabile. Migrazione idempotente
(addColumnIfMissing + CREATE TABLE IF NOT EXISTS), indici inclusi."
```

---

## Task 2: Importer `server/lib/agenti.js`

**Files:**
- Create: `server/lib/agenti.js`

**Interfaces:**
- Consumes: `db` da `./db.js`; `hashPassword(password, pepper)` da `./security.js`; `logger` da `./logger.js`; `XLSX` default import da `xlsx`; `fs` da `fs`. Legge `anagrafica_pv` (popolata F10, 6180 righe) per il role match. `PEPPER = process.env.PASSWORD_PEPPER || ''`.
- Produces: `refreshAgenti()` → `{imported, updated, total, unmatched:[codici...], source, source_exists}`; `agentiStatus()` → `{count, last_updated, source, source_exists, unmatched_count}`; `listAgenti()` → array `{codice, nome, email, ruolo, updated_at}`. Side effect: upsert `anagrafica_agenti`, upsert `users` by email (password solo su new), backfill `richieste_reso.resp_*`.

- [ ] **Step 1: Crea `server/lib/agenti.js`**

```js
// server/lib/agenti.js — Import anagrafica agenti (promotori/responsabili/agenti)
// da anagrafica_agenti.xlsx (file FUORI repo, /home/adimn/Scrivania/) per il
// provisioning degli account di login del sito-resi. Tabella fonte: anagrafica_agenti.
// Mirror (upsert by email) nella tabella users esistente: password_hash impostato
// SOLO alla creazione del nuovo utente; sui refresh successivi si aggiornano
// nome/codice_cliente_esterno/ruolo ma NON la password (preserva cambi utente).
//
// Routing: il ruolo derivato (match codice vs anagrafica_pv.resp_codice/promo_codice)
// abilita il filtro venditore.js — ogni responsabile vede solo i resi dei PV a lui
// assegnati. Aggiorna: scheduler dom 12:00 (dopo refreshAnagrafica) + refresh
// forzato POST /api/admin/agenti/refresh.
//
// SICUREZZA: il xlsx contiene password in chiaro. Il DB conserva SOLO l'hash
// (bcrypt + PASSWORD_PEPPER). Password in chiaro MAI loggate/committate/inviate.
import fs from 'fs';
import XLSX from 'xlsx';
import db from './db.js';
import logger from './logger.js';
import { hashPassword } from './security.js';

const PEPPER = process.env.PASSWORD_PEPPER || '';

// File fuori repo. Default assoluto. Mai committare né loggare il contenuto.
export const AGENTI_PATH = process.env.AGENTI_PATH || '/home/adimn/Scrivania/anagrafica_agenti.xlsx';

// Foglio "Foglio1", 107 righe dati, NESSUN header (riga 0 = primo record).
// Colonne: A=0 codice, B=1 nome, C=2 email, D=3 password (chiaro).
function cell(r, k) {
  const v = r[k];
  return v != null ? String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : '';
}

// Deriva il ruolo matchando il codice contro anagrafica_pv.
// - codice in resp_codice  -> venditore (responsabile, approva)
// - codice in promo_codice -> store_account (promotore, inserisce)
// - entrambi               -> venditore (privilegio piu' alto)
// - nessuno                -> venditore (agente generico, senza routing) + unmatched
function deriveRuolo(codice) {
  const isResp = db.prepare('SELECT 1 FROM anagrafica_pv WHERE resp_codice = ? LIMIT 1').get(codice);
  if (isResp) return { ruolo: 'venditore', matched: true };
  const isPromo = db.prepare('SELECT 1 FROM anagrafica_pv WHERE promo_codice = ? LIMIT 1').get(codice);
  if (isPromo) return { ruolo: 'store_account', matched: true };
  return { ruolo: 'venditore', matched: false };
}

// Importa/aggiorna anagrafica_agenti + mirror users. Non svuota se la source manca.
export function refreshAgenti() {
  if (!fs.existsSync(AGENTI_PATH)) {
    logger.warn(`[Agenti] File non trovato: ${AGENTI_PATH} — mantengo dati esistenti`);
    return { imported: 0, updated: 0, total: 0, unmatched: [], source: AGENTI_PATH, source_exists: false };
  }
  const wb = XLSX.readFile(AGENTI_PATH, { cellDates: false });
  const ws = wb.Sheets['Foglio1'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  const now = new Date().toISOString();

  const upsertAgente = db.prepare(
    `INSERT INTO anagrafica_agenti (codice, nome, email, password_hash, ruolo, updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(codice) DO UPDATE SET
       nome=excluded.nome, email=excluded.email, password_hash=excluded.password_hash,
       ruolo=excluded.ruolo, updated_at=excluded.updated_at`
  );
  const findUser = db.prepare('SELECT id FROM users WHERE email = ?');
  const insertUser = db.prepare(
    `INSERT INTO users (email, password_hash, ruolo, nome, codice_cliente_esterno, attivo)
     VALUES (?,?,?,?,?,1)`
  );
  const updateUser = db.prepare(
    `UPDATE users SET nome=?, codice_cliente_esterno=?, ruolo=?, updated_at=datetime('now')
     WHERE email=?`
  );

  let inserted = 0, updated = 0, createdUsers = 0, updatedUsers = 0;
  const unmatched = [];

  const tx = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || [];
      const codice = cell(r, 0);
      if (!codice) continue; // salta righe vuote
      const nome = cell(r, 1);
      const email = cell(r, 2);
      const password = cell(r, 3);
      if (!email || !password) continue; // email + password obbligatorie

      const { ruolo, matched } = deriveRuolo(codice);
      if (!matched) unmatched.push(codice);

      const hash = hashPassword(password, PEPPER);
      const info = upsertAgente.run(codice, nome, email, hash, ruolo, now);
      if (info.changes > 0 && info.lastInsertRowid === info.changes) inserted++;
      else updated++;

      // Mirror in users by email. Password SOLO su nuovo utente.
      const existing = findUser.get(email);
      if (existing) {
        updateUser.run(nome, codice, ruolo, email);
        updatedUsers++;
      } else {
        insertUser.run(email, hash, ruolo, nome, codice);
        createdUsers++;
      }
    }
  });
  tx();

  // Backfill una-tantum resi pre-F11 (idempotente: solo righe resp_codice IS NULL).
  try {
    const info = db.prepare(
      `UPDATE richieste_reso
       SET resp_codice = (SELECT resp_codice FROM anagrafica_pv WHERE anagrafica_pv.cldm = richieste_reso.cldm),
           resp_nome   = (SELECT resp_nome   FROM anagrafica_pv WHERE anagrafica_pv.cldm = richieste_reso.cldm)
       WHERE resp_codice IS NULL AND cldm IS NOT NULL`
    ).run();
    if (info.changes > 0) logger.info(`[Agenti] Backfill resp_codice su ${info.changes} resi pre-F11`);
  } catch (err) {
    logger.error(`[Agenti] Backfill resp_codice fallito: ${err.message}`);
  }

  const total = db.prepare('SELECT COUNT(*) as c FROM anagrafica_agenti').get().c;
  logger.info(`[Agenti] Importati ${inserted + updated} agenti (nuovi ${inserted}, agg ${updated}; users nuovi ${createdUsers}, agg ${updatedUsers}; tabella totale ${total}; unmatched ${unmatched.length}) da ${AGENTI_PATH}`);
  return { imported: inserted, updated, total, unmatched, source: AGENTI_PATH, source_exists: true };
}

export function agentiStatus() {
  const row = db.prepare('SELECT COUNT(*) as count, MAX(updated_at) as last_updated FROM anagrafica_agenti').get();
  // unmatched = agenti il cui codice non e' ne' un resp_codice ne' un promo_codice.
  const unmatched = db.prepare(
    `SELECT COUNT(*) as c FROM anagrafica_agenti a
     WHERE a.codice NOT IN (SELECT resp_codice FROM anagrafica_pv WHERE resp_codice IS NOT NULL)
       AND a.codice NOT IN (SELECT promo_codice FROM anagrafica_pv WHERE promo_codice IS NOT NULL)`
  ).get().c;
  return {
    count: row.count,
    last_updated: row.last_updated,
    source: AGENTI_PATH,
    source_exists: fs.existsSync(AGENTI_PATH),
    unmatched_count: unmatched,
  };
}

export function listAgenti() {
  return db.prepare(
    'SELECT codice, nome, email, ruolo, updated_at FROM anagrafica_agenti ORDER BY codice ASC'
  ).all();
}
```

- [ ] **Step 2: Restart dev e verifica importer (e2e provisioning)**

Run:
```bash
kill $(lsof -ti:3002); rm -f .next/dev/lock; node server.js > /tmp/resi-dev.log 2>&1 &
sleep 2
```

Esegui l'importer contro il dev DB (crea i ~107 utenti — esito voluto) e verifica:
```bash
node -e "
import('./server/lib/agenti.js').then(a => {
  const r = a.refreshAgenti();
  console.log('result:', JSON.stringify(r, null, 2));
  const db = require('better-sqlite3')('./data/resi.db');
  console.log('anagrafica_agenti:', db.prepare('SELECT COUNT(*) c FROM anagrafica_agenti').get().c);
  console.log('users total:', db.prepare('SELECT COUNT(*) c FROM users').get().c);
  console.log('users by ruolo:', db.prepare('SELECT ruolo, COUNT(*) c FROM users GROUP BY ruolo').all());
  console.log('resi with resp_codice:', db.prepare('SELECT COUNT(*) c FROM richieste_reso WHERE resp_codice IS NOT NULL').get().c, '/ 34');
  // verifica password preservate su utenti pre-F11 (es. admin@example.com hash invariato)
  console.log('admin hash len:', db.prepare('SELECT password_hash FROM users WHERE email=?').get('admin@example.com').password_hash.length);
}).catch(e => { console.error(e); process.exit(1); });
"
```
Expected: `total` ≈ 107, `users total` ≈ 9 + nuovi (gli agenti con email non già presenti), utenti pre-F11 (admin@example.com etc.) mantengono il loro hash originale (lunghezza invariata — password NON sovrascritta), `unmatched` array non vuoto (codici agente generici), resi con `resp_codice` popolati dal backfill (quelli con cldm non NULL).

- [ ] **Step 3: Verifica re-refresh non sovrascrive password (idempotenza)**

Cattura l'hash di un utente creato dal primo refresh, esegui un secondo refresh, verifica hash invariato in `users` (ma aggiorna nome/ruolo):
```bash
node -e "
const db0 = require('better-sqlite3')('./data/resi.db');
const email = db0.prepare(\"SELECT email FROM anagrafica_agenti LIMIT 1\").get().email;
const before = db0.prepare('SELECT password_hash, nome, ruolo FROM users WHERE email=?').get(email);
console.log('before:', email, before.ruolo, before.password_hash.slice(0,10));
import('./server/lib/agenti.js').then(a => {
  a.refreshAgenti();
  const db1 = require('better-sqlite3')('./data/resi.db');
  const after = db1.prepare('SELECT password_hash, nome, ruolo FROM users WHERE email=?').get(email);
  console.log('after:', after.ruolo, after.password_hash.slice(0,10));
  console.log('users password PRESERVED:', before.password_hash === after.password_hash);
}).catch(e => { console.error(e); process.exit(1); });
"
```
Expected: `users password PRESERVED: true` (mirror users NON tocca password_hash su utente esistente).

- [ ] **Step 4: Verifica login con un agente provisionato**

Prendi email+password di un agente dal xlsx (manuale, NON loggarle), login:
```bash
# sostituisci EMAIL/PWD con una riga reale del xlsx (es. M6 / roberto.morello@... / <pwd>)
CJ=$(mktemp); curl -s -c $CJ http://localhost:3002/api/auth/csrf-token | sed 's/.*csrf_token":"//;s/".*//' > /tmp/csrf
curl -s -b $CJ -X POST http://localhost:3002/api/auth/login -H 'Content-Type: application/json' -d "{\"csrf_token\":\"$(cat /tmp/csrf)\",\"email\":\"EMAIL\",\"password\":\"PWD\"}" | head -c 120
```
Expected: 200 + `access_token` (login riuscito con credenziali dal xlsx). Le credenziali non vanno loggate né committate.

- [ ] **Step 5: Commit**

```bash
git add server/lib/agenti.js
git commit -m "feat(F11): importer anagrafica agenti + provisioning users + backfill resp

server/lib/agenti.js legge anagrafica_agenti.xlsx (Foglio1, no header),
deriva il ruolo matchando il codice vs anagrafica_pv.resp_codice/promo_codice
(venditore/store_account), hasha la password con bcrypt+PEPPER, upserta
anagrafica_agenti (fonte) e mirrora in users by email (password solo su
creazione). Backfill idempotente di resp_codice/resp_nome sui resi pre-F11.
Password in chiaro mai loggate/committate; xlsx fuori repo."
```

---

## Task 3: API admin agenti + scheduler

**Files:**
- Modify: `server/modules/admin.js` (import `refreshAgenti`/`agentiStatus`/`listAgenti` + 3 route dopo `/users`)
- Modify: `server.js` (import `refreshAgenti` riga 18 + chiamata scheduler riga 92-99)

**Interfaces:**
- Consumes: `refreshAgenti`, `agentiStatus`, `listAgenti` da `../lib/agenti.js`; `logAudit` da `../lib/audit.js` (firma `logAudit(userId, azione, dettaglio, req)` — `userId`/`req` null OK da scheduler).
- Produces: `POST /api/admin/agenti/refresh` → 200 `{imported,updated,total,unmatched,source,source_exists}`; `GET /api/admin/agenti/status` → 200 status object; `GET /api/admin/agenti` → 200 `{data:[...]}`. Scheduler chiama `refreshAgenti()` dopo `refreshAnagrafica()`.

- [ ] **Step 1: Aggiungi import e 3 route in `server/modules/admin.js`**

In cima, aggiungi agli import esistenti:
```js
import { refreshAgenti, agentiStatus, listAgenti } from '../lib/agenti.js';
import { logAudit } from '../lib/audit.js';
```

Dopo la route `PUT /users/:id` (prima di `GET /resi`), aggiungi:
```js
// --- F11: anagrafica agenti (provisioning users) ---

// POST /api/admin/agenti/refresh — refresh forzato da xlsx.
router.post('/agenti/refresh', (req, res) => {
  try {
    const result = refreshAgenti();
    logAudit(req.user.id, 'AGENTI_REFRESH', {
      imported: result.imported, updated: result.updated, total: result.total,
      unmatched_count: (result.unmatched || []).length, source_exists: result.source_exists,
    }, req);
    res.json(result);
  } catch (err) {
    logger.error(`Errore refresh agenti: ${err.message}`);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// GET /api/admin/agenti/status — stato anagrafica agenti.
router.get('/agenti/status', (req, res) => {
  res.json(agentiStatus());
});

// GET /api/admin/agenti — lista agenti (per review ruoli/unmatched).
router.get('/agenti', (req, res) => {
  res.json({ data: listAgenti() });
});
```

- [ ] **Step 2: Aggiungi `refreshAgenti` allo scheduler in `server.js`**

Import (riga 18, dopo `import { refreshAnagrafica } from './server/lib/anagrafica.js';`):
```js
import { refreshAgenti } from './server/lib/agenti.js';
```

Nello scheduler `scheduleNextAnagraficaRefresh`, nel `setTimeout` callback (riga ~92) e nel `setInterval` callback (riga ~95), aggiungi la chiamata a `refreshAgenti()` DOPO `refreshAnagrafica()`:

```js
    anagraficaTimer = setTimeout(() => {
      try { refreshAnagrafica(); } catch (e) { logger.error(`Refresh anagrafica schedulato fallito: ${e.message}`); }
      try { refreshAgenti(); } catch (e) { logger.error(`Refresh agenti schedulato fallito: ${e.message}`); }
      // ciclo successivo: 7 giorni
      anagraficaInterval = setInterval(() => {
        try { refreshAnagrafica(); } catch (e) { logger.error(`Refresh anagrafica schedulato fallito: ${e.message}`); }
        try { refreshAgenti(); } catch (e) { logger.error(`Refresh agenti schedulato fallito: ${e.message}`); }
      }, 7 * 24 * 60 * 60 * 1000);
    }, ms);
```

- [ ] **Step 3: Restart dev e verifica API + scheduler log**

Run:
```bash
kill $(lsof -ti:3002); rm -f .next/dev/lock; node server.js > /tmp/resi-dev.log 2>&1 &
sleep 2
grep -i "agenti\|Prossimo refresh" /tmp/resi-dev.log | tail -5
```

Verifica API come admin (login admin prima):
```bash
CJ=$(mktemp); curl -s -c $CJ http://localhost:3002/api/auth/csrf-token | sed 's/.*csrf_token":"//;s/".*//' > /tmp/csrf
TOK=$(curl -s -b $CJ -X POST http://localhost:3002/api/auth/login -H 'Content-Type: application/json' -d "{\"csrf_token\":\"$(cat /tmp/csrf)\",\"email\":\"admin@example.com\",\"password\":\"admin\"}" | sed 's/.*access_token":"//;s/".*//')
echo "=== POST /agenti/refresh ==="
curl -s -X POST http://localhost:3002/api/admin/agenti/refresh -H "Authorization: Bearer $TOK" | head -c 200
echo ""; echo "=== GET /agenti/status ==="
curl -s http://localhost:3002/api/admin/agenti/status -H "Authorization: Bearer $TOK"
echo ""; echo "=== GET /agenti (count) ==="
curl -s http://localhost:3002/api/admin/agenti -H "Authorization: Bearer $TOK" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('agenti count:', JSON.parse(s).data.length))"
echo "=== audit AGENTI_REFRESH ==="
node -e "const db=require('better-sqlite3')('./data/resi.db'); console.log(db.prepare(\"SELECT azione, dettaglio FROM audit_log WHERE azione='AGENTI_REFRESH' ORDER BY id DESC LIMIT 1\").get())"
```
Expected: refresh 200 con stats, status `{count, last_updated, source, source_exists, unmatched_count}`, lista count ≈ 107, riga audit `AGENTI_REFRESH` presente (dettaglio contiene `imported/updated/total/unmatched_count`, NON password/email).

- [ ] **Step 4: Commit**

```bash
git add server/modules/admin.js server.js
git commit -m "feat(F11): API admin agenti (refresh/status/list) + scheduler dom 12:00

POST /api/admin/agenti/refresh (forzato, logAudit AGENTI_REFRESH),
GET /api/admin/agenti/status, GET /api/admin/agenti. Scheduler dom 12:00
chiama refreshAgenti() dopo refreshAnagrafica(). Audit dettaglio senza
password/email."
```

---

## Task 4: `resi.js` POST/PUT memorizzano `resp_codice`/`resp_nome`

**Files:**
- Modify: `server/modules/resi.js` (POST INSERT righe 115-155 + PUT update righe 265-309)

**Interfaces:**
- Consumes: `lookupPvByCldm(cldm)` da `../lib/anagrafica.js` → restituisce `{..., resp_codice, resp_nome, linee:[]}` (F10: `SELECT * FROM anagrafica_pv`).
- Produces: ogni reso creato/modificato ha `resp_codice`/`resp_nome` popolati dal PV del cldm. Task 5 (venditore.js) filtra su `r.resp_codice`.

- [ ] **Step 1: POST — estrai e inserisci `resp_codice`/`resp_nome`**

In `server/modules/resi.js` POST, dopo il blocco `const pvRegione = pv.regione || null;` (riga ~85), aggiungi:
```js
  // F11: routing per responsabile. Memorizzati per tutti i resi (anche
  // CS/venditore) — utile per audit/display e filtro venditore (in_attesa).
  const respCodice = pv.resp_codice || null;
  const respNome = pv.resp_nome || null;
```

Modifica l'INSERT (righe 115-121): aggiungi `resp_codice, resp_nome` alla lista colonne (dopo `pv_regione`, prima di `num_reso`) e i 2 placeholder corrispondenti:
```js
    const stmt = db.prepare(
      `INSERT INTO richieste_reso
       (uuid, user_id, numero_ordine_esterno, bda_hash, motivo_reso, note, prodotti, data_scadenza, stato, data_approvazione,
        cldm, ddt_numero, ddt_data, num_colli, bda_autorizzazione,
        linee, corriere, corriere_nome, pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione, resp_codice, resp_nome, num_reso)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
```
Aggiungi i 2 argomenti nella `stmt.run(...)` (dopo `pvRegione,`, prima di `numReso`):
```js
      pvRegione,
      respCodice,
      respNome,
      numReso
```
⚠️ Verifica conteggio: 27 colonne / 27 placeholder / 27 argomenti allineati.

- [ ] **Step 2: PUT — aggiorna `resp_codice`/`resp_nome` quando cldm presente**

Nel PUT, dentro la guardia `if (cldm) { const pv = lookupPvByCldm(cldm); if (pv) { ... } }` (riga ~267-277), aggiungi dopo `pvRegione = pv.regione || pvRegione;`:
```js
      // F11: aggiorna resp_* quando cambia il cldm (stessa guardia if(pv) di F10).
      let respCodice = null, respNome = null;
```
(sposta fuori dal `if` con i default dai valori esistenti — model identico a pv_*). Modello coerente con pv_*: dichiara prima del `if (cldm)`:
```js
  let respCodice = null, respNome = null;
  if (cldm) {
    const pv = lookupPvByCldm(cldm);
    if (pv) {
      pvNome = pv.nome || pvNome;
      pvIndirizzo = pv.indirizzo || pvIndirizzo;
      pvCitta = pv.citta || pvCitta;
      pvCap = pv.cap || pvCap;
      pvProvincia = pv.provincia || pvProvincia;
      pvRegione = pv.regione || pvRegione;
      respCodice = pv.resp_codice || null;
      respNome = pv.resp_nome || null;
    }
  }
```
Aggiungi `resp_codice = ?, resp_nome = ?` alla clausola SET dell'UPDATE (dopo `pv_regione = ?`, prima di `WHERE uuid = ?`) e i 2 argomenti (`respCodice, respNome,`) prima di `uuid`:
```js
    db.prepare(
      `UPDATE richieste_reso SET
       numero_ordine_esterno = ?, bda_hash = ?, motivo_reso = ?, note = ?, prodotti = ?, updated_at = datetime('now'),
       cldm = ?, ddt_numero = ?, ddt_data = ?, num_colli = ?, bda_autorizzazione = ?,
       linee = ?, corriere = ?, corriere_nome = ?,
       pv_nome = ?, pv_indirizzo = ?, pv_citta = ?, pv_cap = ?, pv_provincia = ?, pv_regione = ?,
       resp_codice = ?, resp_nome = ?
       WHERE uuid = ?`
    ).run(
      ...
      pvRegione,
      respCodice,
      respNome,
      uuid
    );
```

- [ ] **Step 3: Restart dev e verifica POST memorizza resp_***

Run:
```bash
kill $(lsof -ti:3002); rm -f .next/dev/lock; node server.js > /tmp/resi-dev.log 2>&1 &
sleep 2
```

Crea un reso come store_account con un cldm il cui PV ha resp_codice noto (es. 507888 → verificare resp dal DB; oppure un cldm con resp `M6`):
```bash
node -e "const db=require('better-sqlite3')('./data/resi.db'); console.log(db.prepare('SELECT cldm, nome, resp_codice, resp_nome FROM anagrafica_pv WHERE resp_codice=? LIMIT 1').get('M6'))"
```
Poi login come store1@example.com (o un promoter provisionato) e POST un reso con quel cldm:
```bash
CJ=$(mktemp); curl -s -c $CJ http://localhost:3002/api/auth/csrf-token | sed 's/.*csrf_token":"//;s/".*//' > /tmp/csrf
TOK=$(curl -s -b $CJ -X POST http://localhost:3002/api/auth/login -H 'Content-Type: application/json' -d "{\"csrf_token\":\"$(cat /tmp/csrf)\",\"email\":\"store1@example.com\",\"password\":\"demo\"}" | sed 's/.*access_token":"//;s/".*//')
CLDM=$(node -e "console.log(require('better-sqlite3')('./data/resi.db').prepare(\"SELECT cldm FROM anagrafica_pv WHERE resp_codice='M6' LIMIT 1\").get().cldm)")
curl -s -X POST http://localhost:3002/api/resi -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "{\"cldm\":\"$CLDM\",\"motivo_reso\":\"difettoso\",\"linee\":[{\"nome\":\"BA\",\"numero_pezzi\":2}],\"corriere\":\"GLS\",\"num_colli\":1}" | head -c 200
echo ""
node -e "const db=require('better-sqlite3')('./data/resi.db'); const r=db.prepare('SELECT num_reso, cldm, resp_codice, resp_nome, pv_nome, stato FROM richieste_reso ORDER BY id DESC LIMIT 1').get(); console.log('ultimo reso:', r)"
```
Expected: 201, ultimo reso ha `resp_codice='M6'`, `resp_nome` popolato, `stato='in_attesa'` (store_account).

- [ ] **Step 4: Commit**

```bash
git add server/modules/resi.js
git commit -m "feat(F11): resi POST/PUT memorizzano resp_codice/resp_nome da lookupPvByCldm

Il reso memorizza il responsabile del PV (anagrafica_pv.resp_codice/resp_nome)
alla creazione e all'aggiornamento (quando cambia cldm). Base per il filtro
venditore (Task 5). POST: 27 colonne/placeholder/arg allineati. PUT: stessa
guardia if(pv) di F10."
```

---

## Task 5: Routing `venditore.js` — filtro per `resp_codice` su 3 endpoint

**Files:**
- Modify: `server/modules/venditore.js` (3 handler: GET /richieste, GET /richieste/:uuid, PUT /richieste/:uuid)

**Interfaces:**
- Consumes: `req.user.id` (JWT) → `users.codice_cliente_esterno`; `anagrafica_pv.resp_codice` per determinare se il venditore ha assegnazione territoriale; `richieste_reso.resp_codice` (popolato Task 4 + backfill Task 2).
- Produces: venditore con codice matching un `resp_codice` vede solo i resi `in_attesa` con `r.resp_codice` = suo codice (lista + dettaglio + approvazione); venditore senza match/codice vuoto → backward-compat (vede tutti, come oggi). 404 su dettaglio/approvazione di reso non assegnato.

- [ ] **Step 1: Aggiungi helper di routing in cima a `venditore.js`**

Dopo gli import (prima di `const router = Router();` o subito dopo), aggiungi:
```js
// F11: routing per responsabile. Determina il filtro resp_codice del venditore
// loggato. Se il suo codice_cliente_esterno matcha un resp_codice in anagrafica_pv,
// vede solo i resi dei PV a lui assegnati; altrimenti backward-compat (tutti).
// Ritorna { codice, filter } dove filter e' null (vede tutto) oppure il codice.
function venditoreRoutingFilter(venditoreId) {
  const row = db.prepare('SELECT codice_cliente_esterno FROM users WHERE id = ?').get(venditoreId);
  const codice = row?.codice_cliente_esterno || null;
  if (!codice) return { codice: null, filter: null };
  const assegnato = db.prepare('SELECT 1 FROM anagrafica_pv WHERE resp_codice = ? LIMIT 1').get(codice);
  return { codice, filter: assegnato ? codice : null };
}
```

- [ ] **Step 2: Applica il filtro a `GET /richieste` (lista)**

Nel handler `GET /richieste`, dopo `const { stato, ... } = req.query;` costruisci il filtro:
```js
  const { stato, data_da, data_a, page = '1', per_page = '20' } = req.query;
  const { filter: respFilter } = venditoreRoutingFilter(req.user.id);
```
Aggiungi alla clausola `where` (dopo `WHERE r.stato = 'in_attesa' AND u.ruolo = 'store_account'`):
```js
  let where = "WHERE r.stato = 'in_attesa' AND u.ruolo = 'store_account'";
  const params = [];
  if (respFilter) {
    where += ' AND r.resp_codice = ?';
    params.push(respFilter);
  } else {
    // backward-compat: nessuna assegnazione territoriale -> vede tutti gli in_attesa
    // (inclusi resi pre-F11 con resp_codice NULL)
  }
```
(Il resto del handler count/data resta invariato — `where`/`params` già usati.)

- [ ] **Step 3: Applica il filtro a `GET /richieste/:uuid` (dettaglio)**

```js
router.get('/richieste/:uuid', (req, res) => {
  const { uuid } = req.params;
  const { filter: respFilter } = venditoreRoutingFilter(req.user.id);

  const where = respFilter
    ? "WHERE r.uuid = ? AND r.stato = 'in_attesa' AND u.ruolo = 'store_account' AND r.resp_codice = ?"
    : "WHERE r.uuid = ? AND r.stato = 'in_attesa' AND u.ruolo = 'store_account'";
  const params = respFilter ? [uuid, respFilter] : [uuid];

  const richiesta = db.prepare(
    `SELECT r.*, u.nome as richiedente_nome, u.azienda as richiedente_azienda
     FROM richieste_reso r
     JOIN users u ON r.user_id = u.id
     ${where}`
  ).get(...params);

  if (!richiesta) {
    return res.status(404).json({ error: 'Richiesta non trovata' });
  }
  // ...resto invariato (uploads, res.json)
```

- [ ] **Step 4: Applica il filtro a `PUT /richieste/:uuid` (approvazione)**

Nel handler PUT, sostituisci la query `existing`:
```js
  const { filter: respFilter } = venditoreRoutingFilter(venditoreId);

  const where = respFilter
    ? "WHERE r.uuid = ? AND r.stato = 'in_attesa' AND u.ruolo = 'store_account' AND r.resp_codice = ?"
    : "WHERE r.uuid = ? AND r.stato = 'in_attesa' AND u.ruolo = 'store_account'";
  const params = respFilter ? [uuid, respFilter] : [uuid];

  const existing = db.prepare(
    `SELECT r.* FROM richieste_reso r
     JOIN users u ON r.user_id = u.id
     ${where}`
  ).get(...params);

  if (!existing) {
    return res.status(404).json({ error: 'Richiesta non trovata o già processata' });
  }
  // ...resto invariato (UPDATE stato, logAudit)
```

- [ ] **Step 5: Restart dev e verifica routing (3 scenari)**

Run:
```bash
kill $(lsof -ti:3002); rm -f .next/dev/lock; node server.js > /tmp/resi-dev.log 2>&1 &
sleep 2
```

Prepara: 2 resi in_attesa con resp_codice diversi (es. uno `M6`, uno `AS`) — usa store_account + cldm con resp noto (Task 4 Step 3 ne crea uno `M6`; creane un altro `AS`). Poi testa 3 venditori:

**A) Venditore con assegnazione M6** (es. roberto.morello@abcosmetique.it, codice M6 dal provisioning — verificare `codice_cliente_esterno='M6'` nel DB):
```bash
node -e "const db=require('better-sqlite3')('./data/resi.db'); console.log(db.prepare(\"SELECT email, codice_cliente_esterno, ruolo FROM users WHERE codice_cliente_esterno='M6' LIMIT 2\").all())"
```
Login come quel venditore → `GET /api/venditore/richieste` deve mostrare SOLO resi con `resp_codice='M6'`; `GET /api/venditore/richieste/:uuid` del reso `AS` → 404; `GET` del reso `M6` → 200.

**B) Venditore con assegnazione AS**: vede solo resi `AS`; reso `M6` → 404 dettaglio/approvazione.

**C) Venditore generico senza codice** (es. venditore1@example.com, `codice_cliente_esterno='V001'` che non matcha alcun resp_codice): `GET /richieste` vede TUTTI gli in_attesa (backward-compat).

Verifica anche `PUT` approvazione: venditore M6 approva reso M6 → 200 `stato=in_revisione`; venditore M6 prova approvare reso AS → 404.

```bash
# Esempio verifica A (sostituisci email/pwd reali del xlsx per M6)
CJ=$(mktemp); curl -s -c $CJ http://localhost:3002/api/auth/csrf-token | sed 's/.*csrf_token":"//;s/".*//' > /tmp/csrf
TOK=$(curl -s -b $CJ -X POST http://localhost:3002/api/auth/login -H 'Content-Type: application/json' -d "{\"csrf_token\":\"$(cat /tmp/csrf)\",\"email\":\"EMAIL_M6\",\"password\":\"PWD_M6\"}" | sed 's/.*access_token":"//;s/".*//')
curl -s http://localhost:3002/api/venditore/richieste -H "Authorization: Bearer $TOK" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s); console.log('total:', j.total, 'resp_codici:', [...new Set(j.data.map(r=>r.resp_codice))])})"
```
Expected A: `total` = # resi in_attesa con resp M6, `resp_codici: ['M6']`.

- [ ] **Step 6: Commit**

```bash
git add server/modules/venditore.js
git commit -m "feat(F11): routing approvazioni 1° livello per responsabile (resp_codice)

venditore.js filtra i 3 endpoint (lista/dettaglio/approvazione) per
r.resp_codice = codice_cliente_esterno del venditore loggato, quando questo
matcha un resp_codice in anagrafica_pv. Venditori generici senza codice
mantengono backward-compat (vedono tutti gli in_attesa). 404 su dettaglio/
approvazione di reso non assegnato."
```

---

## Task 6: E2e coordinatore + cleanup + memory

**Files:**
- Nessun file codice (verifica coordinatore). Scrive: `.superpowers/sdd/2026-09-09-f11-.../progress.md` (ledger), memory file.

**Interfaces:**
- Consumes: tutti i task precedenti.

- [ ] **Step 1: E2e completo (coordinatore)**

1. `POST /api/admin/agenti/refresh` come admin → ~107 agenti, mirror users, backfill resi.
2. Login con un agente provisionato (email C + password D dal xlsx) → 200 token.
3. `GET /api/admin/agenti/status` → count, last_updated, unmatched_count > 0.
4. Re-refresh → utenti esistenti NON hanno password sovrascritta (verifica hash invariato in `users`).
5. Store_account crea reso con cldm (resp M6) → `resp_codice='M6'` nel DB.
6. Venditore M6 vede il reso in `/richieste`; venditore AS NON lo vede; venditore generico li vede tutti.
7. Venditore M6 apre dettaglio reso M6 → 200; dettaglio reso AS → 404; approva reso M6 → 200 `in_revisione`; approva reso AS → 404.
8. Backfill: resi pre-F11 con cldm hanno `resp_codice` popolato; resi senza cldm restano NULL (visibili ai generici).
9. Sicurezza: nessuna password in chiaro in log/audit/risposte API; xlsx non nel repo (`git status` pulito da xlsx); `git log` non contiene il path del xlsx in messaggi che rivelino credenziali.
10. Prod :3001 intatto (pid 3545347, etime invariato); dev :3002 funziona.

- [ ] **Step 2: Final whole-branch review (opus)**

Dispatch final reviewer su `feature/f11` range `4f6581b..HEAD`: spec coverage, cross-task integration (provisioning↔routing), security (hash-only, password-only-on-create, xlsx fuori repo, no secret loggati), backward-compat (venditori generici, resi pre-F11), query parametrizzate. Triage minors.

- [ ] **Step 3: Scrivi memory + ledger**

Memory file `abc-hub-resi-f11-anagrafica-agenti-user-provisioning-routing.md` + indice `MEMORY.md`. Ledger `.superpowers/sdd/2026-09-09-f11-.../progress.md` con tutti i task + final review + parked minors.

- [ ] **Step 4: Invoca `superpowers:finishing-a-development-branch`**

Presenta il menu 3 opzioni (merge locale / PR / keep as-is) per `feature/f11` (base `feature/f10`). Attendi scelta utente.

---

## Self-Review (coordinatore, pre-dispatch)

1. **Spec coverage:** provisioning (Task 2 importer + Task 3 API/scheduler) ✅; routing schema (Task 1) ✅; routing store (Task 4) ✅; routing filter (Task 5) ✅; e2e (Task 6) ✅; backfill (Task 2 Step 1) ✅; password-only-on-create (Task 2 mirror) ✅; role match (Task 2 deriveRuolo) ✅; scheduler (Task 3) ✅.
2. **Placeholder scan:** nessun TBD/TODO; tutti gli step hanno codice o comandi curl concreti.
3. **Type consistency:** `refreshAgenti()` ritorna `{imported,updated,total,unmatched,source,source_exists}` usato coerentemente in Task 3 API + audit; `agentiStatus()` → `{count,last_updated,source,source_exists,unmatched_count}`; `listAgenti()` → array; `venditoreRoutingFilter(id)` → `{codice,filter}` usato in 3 endpoint Task 5; `lookupPvByCldm` → include `resp_codice`/`resp_nome` (F10 `SELECT *`). POST INSERT 27 colonne/placeholder/arg allineati (verifica esplicita Step 1 Task 4).
4. **Sicurezza:** xlsx fuori repo (path default assoluto fuori cwd), hash-only bcrypt+PEPPER, password mai loggate (audit dettaglio solo counts), password-only-on-create in mirror, query parametrizzate, no new deps, dev-only restart.