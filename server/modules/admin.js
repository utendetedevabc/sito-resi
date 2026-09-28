import { Router } from 'express';
import db from '../lib/db.js';
import logger from '../lib/logger.js';
import { hashPassword, generateUUID } from '../lib/security.js';
import { createUserSchema, updateUserSchema } from './validation.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { refreshAgenti, agentiStatus, listAgenti } from '../lib/agenti.js';
import { logAudit } from '../lib/audit.js';

const router = Router();
const PEPPER = process.env.PASSWORD_PEPPER || '';

// 2026-09-28 P3: filtro gruppo PV (clit) per la ricerca admin. Come CS: nome
// gruppo con spazi ammessi (es. "SEVEN SPA"), mai wildcard SQL (% _).
const CLIT_SEARCH_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿ' .\-]{1,60}$/;

router.use(authenticate);
router.use(authorize('admin'));

// GET /api/admin/users
router.get('/users', (req, res) => {
  const { page = '1', per_page = '20', q } = req.query;

  let where = '';
  const params = [];
  if (q) {
    where = 'WHERE nome LIKE ? OR email LIKE ?';
    params.push(`%${q}%`, `%${q}%`);
  }

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM users ${where}`);
  const { total } = countStmt.get(...params);

  const limit = Math.min(parseInt(per_page) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const dataStmt = db.prepare(
    `SELECT id, email, ruolo, nome, azienda, codice_cliente_esterno, attivo, last_login_at, created_at
     FROM users ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  );
  const data = dataStmt.all(...params, limit, offset);

  res.json({ data, total, page: Math.max(parseInt(page) || 1, 1), per_page: limit });
});

// POST /api/admin/users
router.post('/users', (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dati non validi', issues: parsed.error.issues });
  }

  const { email, password, ruolo, nome, azienda, codice_cliente_esterno } = parsed.data;

  try {
    const hash = hashPassword(password, PEPPER);
    const stmt = db.prepare(
      `INSERT INTO users (email, password_hash, ruolo, nome, azienda, codice_cliente_esterno)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(email, hash, ruolo, nome, azienda || null, codice_cliente_esterno || null);

    logger.info(`Admin ${req.user.id} ha creato utente ${email} (${ruolo})`);
    res.status(201).json({ id: info.lastInsertRowid, email, ruolo, nome });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Email già registrata' });
    }
    logger.error(`Errore creazione utente: ${err.message}`);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// PUT /api/admin/users/:id
router.put('/users/:id', (req, res) => {
  const { id } = req.params;
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dati non validi', issues: parsed.error.issues });
  }

  const fields = [];
  const values = [];
  const data = parsed.data;
  let passwordChanged = false;

  if (data.ruolo !== undefined) { fields.push('ruolo = ?'); values.push(data.ruolo); }
  if (data.nome !== undefined) { fields.push('nome = ?'); values.push(data.nome); }
  if (data.azienda !== undefined) { fields.push('azienda = ?'); values.push(data.azienda); }
  if (data.codice_cliente_esterno !== undefined) { fields.push('codice_cliente_esterno = ?'); values.push(data.codice_cliente_esterno); }
  if (data.attivo !== undefined) { fields.push('attivo = ?'); values.push(data.attivo); }
  // Reset password opzionale: solo se fornita una stringa non vuota (lo schema
  // ammette ''/undefined = "non modificare"; >=12 char altrimenti). Password
  // mai loggata né restituita — solo il fatto del reset va in audit.
  if (typeof data.password === 'string' && data.password !== '') {
    fields.push('password_hash = ?');
    values.push(hashPassword(data.password, PEPPER));
    passwordChanged = true;
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'Nessun campo da aggiornare' });
  }

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  // Audit: registra SEMPRE l'aggiornamento; flag password_changed quando il
  // reset è stato eseguito (senza valore della password).
  logAudit(req.user.id, 'USER_UPDATE', {
    target_user_id: Number(id),
    updated_fields: fields.filter((f) => f !== "updated_at = datetime('now')").map((f) => f.split(' =')[0].trim()),
    password_changed: passwordChanged,
  }, req);

  logger.info(`Admin ${req.user.id} ha aggiornato utente ${id}${passwordChanged ? ' (password resettata)' : ''}`);

  res.json({ success: true, password_changed: passwordChanged });
});

// --- F11: anagrafica agenti (provisioning users) ---

// POST /api/admin/agenti/refresh — refresh forzato da xlsx.
router.post('/agenti/refresh', (req, res) => {
  try {
    const result = refreshAgenti();
    logAudit(req.user.id, 'AGENTI_REFRESH', {
      imported: result.imported, updated: result.updated, total: result.total,
      unmatched_count: (result.unmatched || []).length, source_exists: result.source_exists,
      skipped_invalid_email: result.skippedInvalidEmail || 0,
      skipped_dup_codice: result.skippedDupCodice || 0,
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

// GET /api/admin/resi
// 2026-09-28 P3: filtro testuale `clit` (codice o nome del gruppo PV) oltre a
// stato/date/venditore. Sempre parametrizzato, mai concatenato.
router.get('/resi', (req, res) => {
  const { stato, data_da, data_a, venditore_id, clit, page = '1', per_page = '20' } = req.query;

  let where = 'WHERE 1=1';
  const params = [];

  if (stato) { where += ' AND r.stato = ?'; params.push(stato); }
  if (data_da) { where += " AND date(r.created_at) >= date(?)"; params.push(data_da); }
  if (data_a) { where += " AND date(r.created_at) <= date(?)"; params.push(data_a); }
  if (venditore_id) { where += ' AND r.venditore_id = ?'; params.push(venditore_id); }
  if (clit !== undefined && clit !== '' && clit !== null) {
    const g = String(clit).trim();
    if (!CLIT_SEARCH_RE.test(g)) {
      return res.status(400).json({ error: 'Parametro clit non valido' });
    }
    where += ' AND (r.pv_clit_codice LIKE ? OR r.pv_clit_nome LIKE ? COLLATE NOCASE)';
    params.push(`%${g}%`, `%${g}%`);
  }

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM richieste_reso r ${where}`);
  const { total } = countStmt.get(...params);

  const limit = Math.min(parseInt(per_page) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const dataStmt = db.prepare(
    `SELECT r.*, u.nome as richiedente_nome, v.nome as venditore_nome
     FROM richieste_reso r
     JOIN users u ON r.user_id = u.id
     LEFT JOIN users v ON r.venditore_id = v.id
     ${where}
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`
  );
  const data = dataStmt.all(...params, limit, offset);

  res.json({ data, total, page: Math.max(parseInt(page) || 1, 1), per_page: limit });
});

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  const usersCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const resiCount = db.prepare('SELECT COUNT(*) as count FROM richieste_reso').get().count;

  const statoStats = db.prepare(
    'SELECT stato, COUNT(*) as count FROM richieste_reso GROUP BY stato'
  ).all();

  const trentaGiorniFa = new Date();
  trentaGiorniFa.setDate(trentaGiorniFa.getDate() - 30);
  const recentResi = db.prepare(
    "SELECT COUNT(*) as count FROM richieste_reso WHERE date(created_at) >= date(?)"
  ).get(trentaGiorniFa.toISOString()).count;

  res.json({
    users: usersCount,
    resi: resiCount,
    by_stato: statoStats.reduce((acc, s) => { acc[s.stato] = s.count; return acc; }, {}),
    ultimi_30_giorni: recentResi,
  });
});

// GET /api/admin/audit-log
router.get('/audit-log', (req, res) => {
  const { page = '1', per_page = '20' } = req.query;
  const limit = Math.min(parseInt(per_page) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as total FROM audit_log').get().total;
  const data = db.prepare(
    `SELECT a.*, u.email as user_email
     FROM audit_log a
     LEFT JOIN users u ON a.user_id = u.id
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(limit, offset);

  res.json({ data, total, page: Math.max(parseInt(page) || 1, 1), per_page: limit });
});

// GET /api/admin/webhook-log
router.get('/webhook-log', (req, res) => {
  const { page = '1', per_page = '20' } = req.query;
  const limit = Math.min(parseInt(per_page) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as total FROM webhook_log').get().total;
  const data = db.prepare(
    `SELECT w.*, r.uuid as richiesta_uuid
     FROM webhook_log w
     LEFT JOIN richieste_reso r ON w.richiesta_id = r.id
     ORDER BY w.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(limit, offset);

  res.json({ data, total, page: Math.max(parseInt(page) || 1, 1), per_page: limit });
});

export default router;
