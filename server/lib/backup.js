// server/lib/backup.js — Backup automatico del DB (VACUUM INTO)
//
// Perche' VACUUM INTO e non `cp`: con journal_mode=WAL un file copiato a mano
// e' incoerente (le scritture recenti stanno nel -wal). VACUUM INTO produce uno
// snapshot coerente del DB in una operazione atomica. Con SQLCipher attivo il
// file prodotto resta cifrato con la stessa chiave del DB principale (verificato
// sul byte header al primo run).
//
// Cadenza: un backup poco dopo l'avvio (snapshot post-restart, i restart sono
// rari ma e' li' che qualcosa puo' andare storto) + uno giornaliero alle
// BACKUP_HOUR (default 03:00, ora a basso traffico). Disattivabile con
// DB_BACKUP_AUTO=0. Retention: gli ultimi BACKUP_RETENTION_DAYS giorni
// (default 30) — GDPR Art. 5 (limitazione della conservazione) e Art. 32
// (capacita' di ripristino tempestivo).

import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import db from './db.js';

const DB_PATH = process.env.DB_PATH || './data/resi.db';
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
const BACKUP_HOUR = parseInt(process.env.BACKUP_HOUR || '3', 10);

let running = false;
let bootTimer = null;
let dailyTimer = null;

// resi-backup-YYYY-MM-DD_HHMM.db
function timestampName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `resi-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.db`;
}

// Cancella i backup oltre RETENTION_DAYS (per mtime, pattern rigido sul nome).
function pruneOldBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return 0;
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (!/^resi-backup-\d{4}-\d{2}-\d{2}_\d{4}\.db$/.test(f)) continue;
    const full = path.join(BACKUP_DIR, f);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed += 1;
      }
    } catch (err) {
      logger.error(`[BACKUP] Impossibile rimuovere ${f}: ${err.message}`);
    }
  }
  return removed;
}

export function runDbBackup() {
  if (running) return { ok: false, skipped: true, reason: 'already_running' };
  running = true;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, timestampName());
    db.prepare('VACUUM INTO ?').run(file);
    // I backup contengono tutti i dati personali del DB: permessi minimi
    // (lettura/scrittura solo per l'utente del processo), a prescindere dall'umask.
    fs.chmodSync(BACKUP_DIR, 0o700);
    fs.chmodSync(file, 0o600);
    const size = fs.statSync(file).size;
    const removed = pruneOldBackups();
    logger.info(
      `[BACKUP] DB salvato in ${file} (${(size / 1024 / 1024).toFixed(1)} MB)` +
      (removed > 0 ? `, rimossi ${removed} backup oltre ${RETENTION_DAYS} giorni` : '')
    );
    return { ok: true, file, size, removed };
  } catch (err) {
    logger.error(`[BACKUP] Backup del DB fallito: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    running = false;
  }
}

// Scheduler: backup post-avvio + ricorsivo giornaliero (self-rescheduling,
// cosi' l'ora resta corretta anche con DST/ora legale).
export function scheduleDbBackups() {
  if (process.env.DB_BACKUP_AUTO === '0') {
    logger.info('[BACKUP] Backup automatico disattivato (DB_BACKUP_AUTO=0)');
    return;
  }
  // Snapshot post-restart (dopo 15s, quando il server e' gia' in servizio).
  clearTimeout(bootTimer);
  bootTimer = setTimeout(() => { runDbBackup(); }, 15 * 1000);

  const nextDaily = () => {
    const n = new Date();
    n.setHours(BACKUP_HOUR, 0, 0, 0);
    if (n.getTime() <= Date.now()) n.setDate(n.getDate() + 1);
    return n;
  };
  const scheduleNext = () => {
    const n = nextDaily();
    logger.info(`Prossimo backup DB: ${n.toLocaleString('it-IT')}`);
    clearTimeout(dailyTimer);
    dailyTimer = setTimeout(() => {
      runDbBackup();
      scheduleNext();
    }, n.getTime() - Date.now());
  };
  scheduleNext();
}

// Per lo shutdown graceful: il backup in corso (VACUUM INTO) non e'
// interrompibile in modo sicuro, ma non si cancella il timer giornaliero.
export function stopDbBackupScheduler() {
  clearTimeout(bootTimer);
  clearTimeout(dailyTimer);
}