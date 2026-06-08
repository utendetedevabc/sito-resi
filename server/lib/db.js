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

export function close() {
  try {
    db.close();
  } catch {
    // already closed
  }
}

export default db;
