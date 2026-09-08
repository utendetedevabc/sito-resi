import Database from 'better-sqlite3';
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

// Apply SQLCipher settings if key is provided
if (DB_KEY) {
  try {
    db.pragma(`key = "${DB_KEY}"`);
    db.pragma('cipher_page_size = 4096');
    db.pragma('kdf_iter = 256000');
    db.pragma('cipher_hmac_algorithm = HMAC_SHA512');
    db.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512');
  } catch (err) {
    console.warn('SQLCipher non disponibile, uso SQLite standard');
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
addColumnIfMissing('richieste_reso', 'corriere', 'TEXT');         // GLS/NIEDDU/TRAMES/PARENA/ALTRI
addColumnIfMissing('richieste_reso', 'corriere_nome', 'TEXT');    // nome libero se corriere=ALTRI
addColumnIfMissing('richieste_reso', 'pv_nome', 'TEXT');          // ragione sociale PV (manuale)
addColumnIfMissing('richieste_reso', 'pv_indirizzo', 'TEXT');
addColumnIfMissing('richieste_reso', 'pv_citta', 'TEXT');
addColumnIfMissing('richieste_reso', 'pv_cap', 'TEXT');
addColumnIfMissing('richieste_reso', 'pv_provincia', 'TEXT');
addColumnIfMissing('richieste_reso', 'pv_regione', 'TEXT');
addColumnIfMissing('richieste_reso', 'num_reso', 'INTEGER');      // identificativo sequenziale 1..1.000.000
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
