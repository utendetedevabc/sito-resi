import { Router } from 'express';
import db from '../lib/db.js';
import logger from '../lib/logger.js';
import { generateUUID, sha256 } from '../lib/security.js';
import { creaResoSchema } from './validation.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { logAudit } from '../lib/audit.js';
import { sendWebhook } from './webhook.js';
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

  const { numero_ordine, bda, motivo_reso, note, prodotti,
          cldm, ddt_numero, ddt_data, num_colli,
          linee, corriere, corriere_nome,
          pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione } = parsed.data;
  const userId = req.user.id;
  const uuid = generateUUID();
  const bdaHash = bda ? sha256(bda) : null;
  // bda_autorizzazione in chiaro = numero BDA (per il manifest ritiri corriere)
  const bdaAutorizzazione = parsed.data.bda_autorizzazione || bda || null;

  // Scadenza 30 giorni
  const scadenza = new Date();
  scadenza.setDate(scadenza.getDate() + 30);

  // Stato iniziale in base al ruolo:
  // - store_account (promoter): in_attesa → serve BOTH approvazioni (venditore + CS)
  // - venditore (responsabile): in_revisione → salta il 1° livello, approva solo il CS
  // - customer_service (interno): approvato → AUTO-CHIUSO (l'interno è il livello
  //   più alto): il reso viene chiuso subito all'inserimento e partono subito il
  //   webhook ad ABC HUB + generazione file RITGIO*.xls. Nessuna approvazione.
  const ruolo = req.user.ruolo;
  const statoIniziale = ruolo === 'venditore' ? 'in_revisione'
    : ruolo === 'customer_service' ? 'approvato'
    : 'in_attesa';

  // Identificativo sequenziale del reso (1..1.000.000). Sostituisce la BDA come
  // "Num. Autorizzazione" nel file corriere. MAX+1; wrap a 1 se supera 1.000.000.
  let numReso = db.prepare('SELECT COALESCE(MAX(num_reso), 0) + 1 AS n FROM richieste_reso').get().n;
  if (numReso > 1000000) numReso = 1;

  try {
    const stmt = db.prepare(
      `INSERT INTO richieste_reso
       (uuid, user_id, numero_ordine_esterno, bda_hash, motivo_reso, note, prodotti, data_scadenza, stato,
        cldm, ddt_numero, ddt_data, num_colli, bda_autorizzazione,
        linee, corriere, corriere_nome, pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione, num_reso)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      uuid,
      userId,
      numero_ordine,
      bdaHash,
      motivo_reso,
      note || null,
      // prodotte: nel nuovo modello (linee) non si inviano prodotti. Si store '[]'
      // (array vuoto) invece di null perche' alcuni DB esistenti hanno ancora la
      // colonna prodotti NOT NULL (lo schema.sql la rende nullable solo su fresh
      // install, ma CREATE TABLE IF NOT EXISTS e' no-op su DB esistenti). Il
      // webhook e le pagine dettaglio gestiscono [] come "nessun prodotto".
      prodotti ? JSON.stringify(prodotti) : '[]',
      scadenza.toISOString(),
      statoIniziale,
      cldm || null,
      ddt_numero || null,
      ddt_data || null,
      num_colli || null,
      bdaAutorizzazione,
      linee ? JSON.stringify(linee) : null,
      corriere || null,
      corriere_nome || null,
      pv_nome || null,
      pv_indirizzo || null,
      pv_citta || null,
      pv_cap || null,
      pv_provincia || null,
      pv_regione || null,
      numReso
    );

    logger.info(`Richiesta reso creata: ${uuid} (N. ${numReso}) da utente ${userId} (${req.user.ruolo}) → ${statoIniziale}`);
    logAudit(userId, 'RESO_CREATO', { uuid, numero_ordine, stato: statoIniziale, num_reso: numReso, corriere: corriere || null }, req);
    res.status(201).json({ uuid, stato: statoIniziale, id: info.lastInsertRowid, num_reso: numReso });

    // Interno (customer_service): auto-chiuso. Il reso è approvato definitivamente
    // già alla creazione → invia subito il webhook ad ABC HUB (che genera il file
    // RITGIO*.xls su disco). Fire-and-forget (DOPO res.json): non blocca la
    // risposta. Stesso payload del customer-service.js PUT approvato.
    if (ruolo === 'customer_service') {
      try {
        const creator = db.prepare('SELECT codice_cliente_esterno FROM users WHERE id = ?').get(userId);
        const row = db.prepare('SELECT * FROM richieste_reso WHERE uuid = ?').get(uuid);
        if (row) {
          sendWebhook({
            id_richiesta: uuid,
            numero_ordine: row.numero_ordine_esterno,
            bda_hash: row.bda_hash,
            venditore_codice: creator?.codice_cliente_esterno || '',
            prodotti: row.prodotti ? JSON.parse(row.prodotti) : [],
            linee: row.linee ? JSON.parse(row.linee) : [],
            corriere: row.corriere || null,
            corriere_nome: row.corriere_nome || null,
            pv_nome: row.pv_nome || null,
            pv_indirizzo: row.pv_indirizzo || null,
            pv_citta: row.pv_citta || null,
            pv_cap: row.pv_cap || null,
            pv_provincia: row.pv_provincia || null,
            pv_regione: row.pv_regione || null,
            num_reso: row.num_reso ?? null,
            motivo_reso: row.motivo_reso,
            note: row.note,
            data_approvazione: new Date().toISOString(),
            cldm: row.cldm || null,
            ddt_numero: row.ddt_numero || null,
            ddt_data: row.ddt_data || null,
            num_colli: row.num_colli ?? null,
            bda_autorizzazione: row.bda_autorizzazione || null,
          }).catch((err) => logger.error(`Webhook fallito per ${uuid} (CS auto-chiuso): ${err.message}`));
          logAudit(userId, 'RESO_APPROVATO_FINALE', { uuid, stato: 'approvato', auto: true }, req);
        }
      } catch (e) {
        logger.error(`Post-creazione CS fallita per ${uuid}: ${e.message}`);
      }
    }
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

  const { numero_ordine, bda, motivo_reso, note, prodotti,
          cldm, ddt_numero, ddt_data, num_colli,
          linee, corriere, corriere_nome,
          pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione } = parsed.data;
  const bdaHash = bda ? sha256(bda) : null;
  const bdaAutorizzazione = parsed.data.bda_autorizzazione || bda || null;

  try {
    db.prepare(
      `UPDATE richieste_reso SET
       numero_ordine_esterno = ?, bda_hash = ?, motivo_reso = ?, note = ?, prodotti = ?, updated_at = datetime('now'),
       cldm = ?, ddt_numero = ?, ddt_data = ?, num_colli = ?, bda_autorizzazione = ?,
       linee = ?, corriere = ?, corriere_nome = ?,
       pv_nome = ?, pv_indirizzo = ?, pv_citta = ?, pv_cap = ?, pv_provincia = ?, pv_regione = ?
       WHERE uuid = ?`
    ).run(
      numero_ordine,
      bdaHash,
      motivo_reso,
      note || null,
      prodotti ? JSON.stringify(prodotti) : '[]',
      cldm || null,
      ddt_numero || null,
      ddt_data || null,
      num_colli || null,
      bdaAutorizzazione,
      linee ? JSON.stringify(linee) : null,
      corriere || null,
      corriere_nome || null,
      pv_nome || null,
      pv_indirizzo || null,
      pv_citta || null,
      pv_cap || null,
      pv_provincia || null,
      pv_regione || null,
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
  logAudit(userId, 'RESO_ANNULLATO', { uuid }, req);
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
