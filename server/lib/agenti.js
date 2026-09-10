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

// Foglio "Foglio1", righe dati, NESSUN header (riga 0 = primo record).
// Colonne: A=0 codice, B=1 nome, C=2 email, D=3 password (chiaro).
function cell(r, k) {
  const v = r[k];
  return v != null ? String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : '';
}

// Email valida minima (stesso spirito di loginSchema email().email()). Usata per
// scartare righe con email "token" garbage (es. export ERP con placeholder) che
// altrimenti verrebbero mirrorate in users come account non loggabili.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(s) { return EMAIL_RE.test(s); }

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
  // COLLATE NOCASE: match email case-insensitive. Evita di creare account
  // duplicati quando il xlsx ha lo stesso email con case diverso (es.
  // "M68.carlo@gmail.com" vs "m68.carlo@gmail.com" = stessa persona).
  const findUser = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE');
  const insertUser = db.prepare(
    `INSERT INTO users (email, password_hash, ruolo, nome, codice_cliente_esterno, attivo)
     VALUES (?,?,?,?,?,1)`
  );
  const updateUser = db.prepare(
    `UPDATE users SET nome=?, codice_cliente_esterno=?, ruolo=?, updated_at=datetime('now')
     WHERE email=? COLLATE NOCASE`
  );

  let inserted = 0, updated = 0, createdUsers = 0, updatedUsers = 0;
  const unmatched = [];
  const skippedInvalidEmail = [];
  const skippedDupCodice = [];
  const seenCodici = new Set();

  const tx = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || [];
      const codice = cell(r, 0);
      if (!codice) continue; // salta righe vuote
      const nome = cell(r, 1);
      const email = cell(r, 2);
      const password = cell(r, 3);
      if (!email || !password) continue; // email + password obbligatorie
      // Scarta email non valide (token/placeholder): NON creare account non
      // loggabili. Logga solo il codice, mai l'email/password.
      if (!isValidEmail(email)) { skippedInvalidEmail.push(codice); continue; }
      // Dedup per codice: un codice = un account. Se il codice e' gia' stato
      // processato in questa riga, salta i duplicati (es. export ERP con righe
      // ripetute). Mantiene la PRIMA riga valida incontrata.
      if (seenCodici.has(codice)) { skippedDupCodice.push(codice); continue; }
      seenCodici.add(codice);

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

  if (skippedInvalidEmail.length) logger.warn(`[Agenti] Saltate ${skippedInvalidEmail.length} righe con email non valida (codici: ${skippedInvalidEmail.join(', ')})`);
  if (skippedDupCodice.length) logger.warn(`[Agenti] Saltate ${skippedDupCodice.length} righe duplicate per codice gia' visto (codici: ${skippedDupCodice.join(', ')})`);

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
  logger.info(`[Agenti] Importati ${inserted + updated} agenti (nuovi ${inserted}, agg ${updated}; users nuovi ${createdUsers}, agg ${updatedUsers}; tabella totale ${total}; unmatched ${unmatched.length}; saltati email-invalid ${skippedInvalidEmail.length}, dup-codice ${skippedDupCodice.length}) da ${AGENTI_PATH}`);
  return { imported: inserted, updated, total, unmatched, skippedInvalidEmail: skippedInvalidEmail.length, skippedDupCodice: skippedDupCodice.length, source: AGENTI_PATH, source_exists: true };
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