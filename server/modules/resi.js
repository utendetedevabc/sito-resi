import { Router } from 'express';
import db from '../lib/db.js';
import logger from '../lib/logger.js';
import { generateUUID, sha256 } from '../lib/security.js';
import { creaResoSchema } from './validation.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import upload from './upload.js';

const router = Router();

router.use(authenticate);
router.use(authorize('store_account', 'venditore', 'customer_service'));

// GET /api/resi — lista con filtri
router.get('/', (req, res) => {
  const userId = req.user.id;
  const { stato, data_da, data_a, page = '1', per_page = '20' } = req.query;

  let where = 'WHERE user_id = ?';
  const params = [userId];

  if (stato) {
    where += ' AND stato = ?';
    params.push(stato);
  }
  if (data_da) {
    where += " AND date(created_at) >= date(?)";
    params.push(data_da);
  }
  if (data_a) {
    where += " AND date(created_at) <= date(?)";
    params.push(data_a);
  }

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM richieste_reso ${where}`);
  const { total } = countStmt.get(...params);

  const limit = Math.min(parseInt(per_page) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const dataStmt = db.prepare(
    `SELECT id, uuid, numero_ordine_esterno, motivo_reso, stato, note, created_at, updated_at
     FROM richieste_reso ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  );
  const data = dataStmt.all(...params, limit, offset);

  res.json({ data, total, page: Math.max(parseInt(page) || 1, 1), per_page: limit });
});

// POST /api/resi — crea richiesta
router.post('/', (req, res) => {
  const parsed = creaResoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dati non validi', issues: parsed.error.issues });
  }

  const { numero_ordine, bda, motivo_reso, note, prodotti } = parsed.data;
  const userId = req.user.id;
  const uuid = generateUUID();
  const bdaHash = bda ? sha256(bda) : null;

  // Scadenza 30 giorni
  const scadenza = new Date();
  scadenza.setDate(scadenza.getDate() + 30);

  // Stato iniziale in base al ruolo
  const statoIniziale = req.user.ruolo === 'venditore' ? 'in_revisione' : 'in_attesa';

  try {
    const stmt = db.prepare(
      `INSERT INTO richieste_reso
       (uuid, user_id, numero_ordine_esterno, bda_hash, motivo_reso, note, prodotti, data_scadenza, stato)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      uuid,
      userId,
      numero_ordine,
      bdaHash,
      motivo_reso,
      note || null,
      JSON.stringify(prodotti),
      scadenza.toISOString(),
      statoIniziale
    );

    logger.info(`Richiesta reso creata: ${uuid} da utente ${userId} (${req.user.ruolo}) → ${statoIniziale}`);
    res.status(201).json({ uuid, stato: statoIniziale, id: info.lastInsertRowid });
  } catch (err) {
    logger.error(`Errore creazione reso: ${err.message}`);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// GET /api/resi/:uuid — dettaglio
router.get('/:uuid', (req, res) => {
  const { uuid } = req.params;
  const userId = req.user.id;

  const richiesta = db.prepare(
    `SELECT r.*, u.nome as venditore_nome
     FROM richieste_reso r
     LEFT JOIN users u ON r.venditore_id = u.id
     WHERE r.uuid = ? AND r.user_id = ?`
  ).get(uuid, userId);

  if (!richiesta) {
    return res.status(404).json({ error: 'Richiesta non trovata' });
  }

  const uploads = db.prepare(
    'SELECT id, mime_type, size_bytes, sha256_hash, uploaded_at FROM uploads WHERE richiesta_id = ?'
  ).all(richiesta.id);

  res.json({ ...richiesta, prodotti: JSON.parse(richiesta.prodotti || '[]'), uploads });
});

// PUT /api/resi/:uuid — modifica (solo in_attesa)
router.put('/:uuid', (req, res) => {
  const { uuid } = req.params;
  const userId = req.user.id;

  const existing = db.prepare(
    'SELECT id, stato FROM richieste_reso WHERE uuid = ? AND user_id = ?'
  ).get(uuid, userId);

  if (!existing) {
    return res.status(404).json({ error: 'Richiesta non trovata' });
  }
  if (existing.stato !== 'in_attesa') {
    return res.status(409).json({ error: 'Impossibile modificare una richiesta già processata' });
  }

  const parsed = creaResoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dati non validi', issues: parsed.error.issues });
  }

  const { numero_ordine, bda, motivo_reso, note, prodotti } = parsed.data;
  const bdaHash = bda ? sha256(bda) : null;

  try {
    db.prepare(
      `UPDATE richieste_reso SET
       numero_ordine_esterno = ?, bda_hash = ?, motivo_reso = ?, note = ?, prodotti = ?, updated_at = datetime('now')
       WHERE uuid = ?`
    ).run(
      numero_ordine,
      bdaHash,
      motivo_reso,
      note || null,
      JSON.stringify(prodotti),
      uuid
    );

    res.json({ success: true });
  } catch (err) {
    logger.error(`Errore aggiornamento reso: ${err.message}`);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// DELETE /api/resi/:uuid — annulla (solo in_attesa)
router.delete('/:uuid', (req, res) => {
  const { uuid } = req.params;
  const userId = req.user.id;

  const existing = db.prepare(
    'SELECT id, stato FROM richieste_reso WHERE uuid = ? AND user_id = ?'
  ).get(uuid, userId);

  if (!existing) {
    return res.status(404).json({ error: 'Richiesta non trovata' });
  }
  if (existing.stato !== 'in_attesa') {
    return res.status(409).json({ error: 'Impossibile annullare una richiesta già processata' });
  }

  db.prepare(
    `UPDATE richieste_reso SET stato = 'annullato', updated_at = datetime('now') WHERE uuid = ?`
  ).run(uuid);

  logger.info(`Richiesta reso annullata: ${uuid}`);
  res.json({ success: true });
});

// POST /api/resi/:uuid/foto — upload foto
router.post('/:uuid/foto', upload.array('foto', 5), async (req, res) => {
  const { uuid } = req.params;
  const userId = req.user.id;

  const existing = db.prepare(
    'SELECT id, stato FROM richieste_reso WHERE uuid = ? AND user_id = ?'
  ).get(uuid, userId);

  if (!existing) {
    return res.status(404).json({ error: 'Richiesta non trovata' });
  }
  if (existing.stato !== 'in_attesa') {
    return res.status(409).json({ error: 'Impossibile caricare foto su richiesta già processata' });
  }

  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'Nessun file caricato' });
  }

  const existingCount = db.prepare(
    'SELECT COUNT(*) as count FROM uploads WHERE richiesta_id = ?'
  ).get(existing.id).count;

  if (existingCount + files.length > 5) {
    return res.status(400).json({ error: 'Massimo 5 foto per richiesta' });
  }

  const insert = db.prepare(
    `INSERT INTO uploads (richiesta_id, original_filename_hash, stored_filename, mime_type, size_bytes, sha256_hash)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const file of files) {
    insert.run(
      existing.id,
      sha256(file.originalname),
      file.filename,
      file.mimetype,
      file.size,
      file.sha256 || ''
    );
  }

  res.json({ success: true, uploaded: files.length });
});

export default router;
