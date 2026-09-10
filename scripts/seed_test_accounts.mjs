// scripts/seed_test_accounts.mjs — Crea 3 account di test DEV per il flusso resi:
//   promoter     (store_account)   -> inserisce il reso            -> stato in_attesa
//   responsabile (venditore)       -> approva il reso del promoter -> in_revisione
//                                       (se inserisce lui -> in_revisione, salta il passo)
//   interno      (customer_service)-> approvazione finale          -> approvato + webhook ABC HUB
// Password DEV: TestResi123!  (bcrypt + PASSWORD_PEPPER, come seed.js)
import 'dotenv/config';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const DB_PATH = process.env.DB_PATH || './data/resi.db';
const DB_KEY = process.env.DB_ENCRYPTION_KEY || '';
const PEPPER = process.env.PASSWORD_PEPPER || '';
const PASSWORD = 'TestResi123!';

const db = new Database(DB_PATH);
if (DB_KEY) {
  try {
    db.pragma(`key = "${DB_KEY}"`);
    db.pragma('cipher_page_size = 4096');
    db.pragma('kdf_iter = 256000');
    db.pragma('cipher_hmac_algorithm = HMAC_SHA512');
    db.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512');
  } catch {
    console.warn('SQLCipher non disponibile, uso SQLite standard');
  }
}

const hash = bcrypt.hashSync(PASSWORD + PEPPER, 12);

const accounts = [
  { email: 'promoter@abctest.it',      ruolo: 'store_account',   nome: 'Promoter Test',     azienda: 'ABC Test' },
  { email: 'responsabile@abctest.it',  ruolo: 'venditore',       nome: 'Responsabile Test', azienda: 'ABC Test' },
  { email: 'interno@abctest.it',       ruolo: 'customer_service', nome: 'Interno Test',      azienda: 'ABC Test' },
];

const ins = db.prepare(
  `INSERT OR IGNORE INTO users (email, password_hash, ruolo, nome, azienda, attivo)
   VALUES (?, ?, ?, ?, ?, 1)`
);

console.log('Creazione account di test DEV (password: ' + PASSWORD + ')');
for (const a of accounts) {
  const r = ins.run(a.email, hash, a.ruolo, a.nome, a.azienda);
  console.log((r.changes ? '✅ Creato: ' : '⏭️  Esiste: ') + a.email + ' [' + a.ruolo + ']');
}

const rows = db.prepare(
  `SELECT id, email, ruolo, nome, attivo FROM users
   WHERE email IN ('promoter@abctest.it','responsabile@abctest.it','interno@abctest.it')`
).all();
console.log('\nAccount attivi:');
console.table(rows);
db.close();