import Database from 'better-sqlite3-multiple-ciphers';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH || './data/resi.db';
const DB_KEY = process.env.DB_ENCRYPTION_KEY || '';

// Ensure data directory exists
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Cifratura a riposo (sqlite3mc = fork di better-sqlite3 con supporto multi-cipher,
// migrazione 14/09). Si imposta SOLO `key`: i parametri cipher_* del vecchio
// SQLCipher (page_size, kdf_iter, algoritmi...) non sono portabili tra build,
// mentre i default di sqlite3mc sono forti e restano coerenti tra il file
// migrato e ogni successiva apertura.
if (DB_KEY) {
  try {
    db.pragma(`key = "${DB_KEY}"`);
  } catch (err) {
    console.error(`Impossibile impostare la chiave di cifratura: ${err.message}`);
  }
  // GOTCHA (appreso 14/09): con una build SENZA supporto cipher `PRAGMA key` e'
  // un no-op silenzioso — il DB resterebbe in chiaro SENZA alcun errore.
  // Controllo affidabile e indipendente dalla build: il file su disco NON deve
  // portare la firma plaintext di SQLite.
  try {
    const fd = fs.openSync(DB_PATH, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    if (buf.toString('latin1').startsWith('SQLite format 3')) {
      console.error('⚠ DB IN CHIARO: DB_ENCRYPTION_KEY impostata ma il file NON e\' cifrato.');
    }
  } catch {
    // file appena creato o non ancora scritto: niente da verificare
  }
}

// General pragmas
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
db.pragma('secure_delete = ON');

// Apply schema if tables don't exist
const schemaPath = join(__dirname, '..', '..', 'database', 'schema.sql');
try {
  let schema = readFileSync(schemaPath, 'utf-8');
  // Remove SQLCipher-specific PRAGMAs for plain SQLite fallback
  schema = schema
    .split('\n')
    .filter(line => !line.startsWith('PRAGMA key') && !line.startsWith('PRAGMA cipher'))
    .join('\n');
  db.exec(schema);
} catch (err) {
  console.error('Errore caricamento schema:', err.message);
}

// Migrazione idempotente: colonne per export corriere (file RITGIO*.xls).
// Aggiunge a richieste_reso i dati mancanti necessari al manifest ritiri.
function addColumnIfMissing(table, col, def) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  } catch (err) {
    console.error(`Errore migrazione colonna ${table}.${col}:`, err.message);
  }
}
addColumnIfMissing('richieste_reso', 'cldm', 'TEXT');
addColumnIfMissing('richieste_reso', 'ddt_numero', 'TEXT');
addColumnIfMissing('richieste_reso', 'ddt_data', 'TEXT');
addColumnIfMissing('richieste_reso', 'num_colli', 'INTEGER');
addColumnIfMissing('richieste_reso', 'bda_autorizzazione', 'TEXT');
// Nuovo modello reso (linee + corriere + PV manuale + num_reso sequenziale).
// Le colonne vecchie restano per backward compat con resi gia' inseriti.
addColumnIfMissing('richieste_reso', 'linee', 'TEXT');            // JSON [{nome}]
addColumnIfMissing('richieste_reso', 'corriere', 'TEXT');         // GLS/NIEDDU/TRAMES/PARENA/PROMOTORE/ALTRI
addColumnIfMissing('richieste_reso', 'corriere_nome', 'TEXT');    // nome libero se corriere=ALTRI
addColumnIfMissing('richieste_reso', 'pv_nome', 'TEXT');          // ragione sociale PV (manuale)
addColumnIfMissing('richieste_reso', 'pv_indirizzo', 'TEXT');
addColumnIfMissing('richieste_reso', 'pv_citta', 'TEXT');
addColumnIfMissing('richieste_reso', 'pv_cap', 'TEXT');
addColumnIfMissing('richieste_reso', 'pv_provincia', 'TEXT');
addColumnIfMissing('richieste_reso', 'pv_regione', 'TEXT');
addColumnIfMissing('richieste_reso', 'num_reso', 'INTEGER');      // identificativo sequenziale 1..1.000.000
// 2026-09-16 (richiesta operatori): motivazione manuale obbligatoria quando
// motivo_reso = 'altro' ("Altro" nel form).
addColumnIfMissing('richieste_reso', 'motivo_altro', 'TEXT');
// Task 4 (CS avanzata): data_spedizione impostata dal POST /richieste/export
// quando l'interno esporta i resi approvati (XLS multi-riga + mark spedito).
// NULL finche' il reso e' "approvato"; valorizzato allo switch in "spedito".
addColumnIfMissing('richieste_reso', 'data_spedizione', 'TEXT');
// F11: routing approvazioni per responsabile. resp_codice/resp_nome memorizzati
// sul reso alla creazione (lookupPvByCldm) e usati dal filtro venditore.js.
addColumnIfMissing('richieste_reso', 'resp_codice', 'TEXT');
addColumnIfMissing('richieste_reso', 'resp_nome', 'TEXT');
// 2026-09-28 P3: gruppi PV (clit, ZSD127 col A/B) denormalizzati sul reso alla
// creazione (lookupPvByCldm), come resp_*. Base del filtro di ricerca "clit".
addColumnIfMissing('richieste_reso', 'pv_clit_codice', 'TEXT');
addColumnIfMissing('richieste_reso', 'pv_clit_nome', 'TEXT');
// 2026-09-22 P1 ("Residuo promo autorizzato da sede"): il CHECK storico su
// motivo_reso ammetteva solo 4 valori — 'residuo_promo' passava la validazione
// zod ma veniva rifiutato dal DB (CHECK constraint failed). SQLite non puo'
// ALTERare un CHECK: rebuild della tabella (stessa DDL con enum esteso, le
// righe copiate 1:1) + ricreazione indici. Idempotente: parte solo se il CHECK
// vecchio e' ancora presente nella DDL effettiva del DB.
try {
  const master = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'richieste_reso'`).get();
  if (master?.sql && master.sql.includes('CHECK(motivo_reso IN') && !master.sql.includes('residuo_promo')) {
    const newSql = master.sql
      .replace('CREATE TABLE "richieste_reso"', 'CREATE TABLE "richieste_reso_new"')
      .replace("'non_conforme','altro'", "'non_conforme','residuo_promo','altro'");
    // uploads/allegati referenziano richieste_reso(id): FK OFF per il DROP del
    // parent (le righe non cambiano, l'integrita' resta garantita dalla copia).
    // Il pragma va impostato FUORI dalla transazione (dentro e' un no-op).
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(newSql);
      db.exec('INSERT INTO richieste_reso_new SELECT * FROM richieste_reso');
      db.exec('DROP TABLE richieste_reso');
      db.exec('ALTER TABLE richieste_reso_new RENAME TO richieste_reso');
      // Gli indici sulla tabella cadono col DROP: ricreati tutti (idempotenti).
      db.exec('CREATE INDEX IF NOT EXISTS idx_richieste_user ON richieste_reso(user_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_richieste_stato ON richieste_reso(stato)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_richieste_venditore ON richieste_reso(venditore_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_richieste_uuid ON richieste_reso(uuid)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_richieste_num_reso ON richieste_reso(num_reso)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_richieste_reso_resp_codice ON richieste_reso(resp_codice)');
    })();
    db.pragma('foreign_keys = ON');
    console.error('[db] Migrazione motivo_reso completata: CHECK esteso con residuo_promo');
  }
} catch (err) {
  console.error('[db] Errore migrazione CHECK motivo_reso:', err.message);
}
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
// 2026-09-28 P3: colonne gruppi PV (clit) su DB esistente — CREATE TABLE IF NOT
// EXISTS non altera la tabella già presente.
addColumnIfMissing('anagrafica_pv', 'clit_codice', 'TEXT');
addColumnIfMissing('anagrafica_pv', 'clit_nome', 'TEXT');
// 2026-09-28 P3: backfill idempotente dei gruppi clit sui resi storici.
// Al primo avvio dopo il deploy l'import esteso non è ancora girato → 0 righe;
// il backfill viene ripetuto a fine refreshAnagrafica (server/lib/anagrafica.js)
// così il ciclo boot→import→backfill si chiude da solo.
try {
  const info = db.prepare(
    `UPDATE richieste_reso SET
       pv_clit_codice = a.clit_codice, pv_clit_nome = a.clit_nome
     FROM anagrafica_pv a
     WHERE richieste_reso.cldm = a.cldm AND richieste_reso.pv_clit_codice IS NULL`
  ).run();
  if (info.changes > 0) console.error(`[db] Backfill pv_clit: ${info.changes} resi aggiornati`);
} catch (err) {
  console.error('[db] Errore backfill pv_clit:', err.message);
}
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
// Indice su num_reso: nello schema.sql viene creato insieme alla tabella (fresh
// install), ma su DB esistente la colonna num_reso arriva solo dopo la
// migrazione sopra, quindi l'CREATE INDEX dello schema fallisce (colonna
// assente) e l'catch sopra lo ingoia. Lo si ricrea qui idempotente per garantire
// l'indice sia su DB esistenti che fresh.
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_richieste_num_reso ON richieste_reso(num_reso)');
} catch (err) {
  console.error('Errore creazione idx_richieste_num_reso:', err.message);
}

export function close() {
  try {
    db.close();
  } catch {
    // already closed
  }
}

export default db;
