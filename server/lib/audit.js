// server/lib/audit.js — helper condiviso per lo storico azioni (audit_log).
// Scrive una riga immutabile per ogni azione significativa sul reso, così
// l'admin ha una cronologia completa (chi, cosa, quando, da quale IP).
//
// Azioni registrate (stringa stabile, usata come chiave di lettura lato UI):
//   RESO_CREATO, RESO_MODIFICATO, RESO_ANNULLATO (store_account/venditore/CS)
//   RESO_APPROVATO_1, RESO_RIFIUTATO_1 (responsabile = venditore, 1° livello)
//   RESO_APPROVATO_FINALE, RESO_RIFIUTATO_FINALE (customer_service = interno)
//   LOGIN_SUCCESS, LOGIN_FAILED, LOGIN_LOCKED (già in auth.js)
import db from './db.js';
import logger from './logger.js';
import { sha256 } from './security.js';

export function logAudit(userId, azione, dettaglio, req) {
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, azione, dettaglio, ip_address, user_agent_hash)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      userId || null,
      azione,
      dettaglio ? JSON.stringify(dettaglio) : null,
      req?.ip || req?.connection?.remoteAddress || null,
      sha256(req?.headers?.['user-agent'] || '')
    );
  } catch (err) {
    // L'audit non deve mai bloccare l'azione principale: logga e vai avanti.
    logger.error(`Audit log error: ${err.message}`);
  }
}