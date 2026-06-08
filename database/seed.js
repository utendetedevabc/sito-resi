import 'dotenv/config';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PEPPER = process.env.PASSWORD_PEPPER || '';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'resi.db');
const DB_KEY = process.env.DB_ENCRYPTION_KEY || '';

// Ensure directories exist
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

try {
  db.pragma(`key = '${DB_KEY}'`);
} catch {
  console.warn('SQLCipher key non applicata (modalità SQLite standard)');
}

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Apply schema
const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
// Remove SQLCipher-specific PRAGMAs that fail on plain SQLite
const cleanSchema = schema
  .split('\n')
  .filter(line => !line.startsWith('PRAGMA key') && !line.startsWith('PRAGMA cipher'))
  .join('\n');

db.exec(cleanSchema);

function hashPassword(password) {
  return bcrypt.hashSync(password + PEPPER, 12);
}

const users = [
  {
    email: 'admin@example.com',
    password: 'AdminSecure123!',
    ruolo: 'admin',
    nome: 'Amministratore',
    azienda: 'ABC Srl',
  },
  {
    email: 'venditore1@example.com',
    password: 'VenditoreSecure123!',
    ruolo: 'venditore',
    nome: 'Mario Rossi',
    azienda: 'Vendite ABC',
    codice_cliente_esterno: 'V001',
  },
  {
    email: 'venditore2@example.com',
    password: 'VenditoreSecure123!',
    ruolo: 'venditore',
    nome: 'Laura Bianchi',
    azienda: 'Vendite ABC',
    codice_cliente_esterno: 'V002',
  },
  {
    email: 'store1@example.com',
    password: 'StoreSecure123!',
    ruolo: 'store_account',
    nome: 'Negozio Milano',
    azienda: 'Store Milano Srl',
  },
  {
    email: 'store2@example.com',
    password: 'StoreSecure123!',
    ruolo: 'store_account',
    nome: 'Negozio Roma',
    azienda: 'Store Roma Srl',
  },
  {
    email: 'cs@example.com',
    password: 'CustomerService123!',
    ruolo: 'customer_service',
    nome: 'Customer Service ABC',
    azienda: 'ABC Srl',
  },
];

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (email, password_hash, ruolo, nome, azienda, codice_cliente_esterno, attivo)
  VALUES (?, ?, ?, ?, ?, ?, 1)
`);

console.log('Inserimento utenti di test...');

for (const u of users) {
  const hash = hashPassword(u.password);
  const info = insertUser.run(
    u.email,
    hash,
    u.ruolo,
    u.nome,
    u.azienda || null,
    u.codice_cliente_esterno || null
  );
  if (info.changes > 0) {
    console.log(`✅ Creato: ${u.nome} (${u.ruolo}) - ${u.email}`);
  } else {
    console.log(`⏭️  Esiste già: ${u.email}`);
  }
}

console.log('Seed completato.');
db.close();
