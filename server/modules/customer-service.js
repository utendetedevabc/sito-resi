import { Router } from 'express';
import db from '../lib/db.js';
import logger from '../lib/logger.js';
import { csResoSchema } from './validation.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { sendWebhook } from './webhook.js';

const router = Router();

router.use(authenticate);
router.use(authorize('customer_service'));

// GET /api/customer-service/richieste — resi in_revisione
router.get('/richieste', (req, res) => {
  const { page = '1', per_page = '20' } = req.query;

  const where = "WHERE r.stato = 'in_revisione'";

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM richieste_reso r ${where}`);
  const { total } = countStmt.get();

  const limit = Math.min(parseInt(per_page) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const dataStmt = db.prepare(
    `SELECT r.id, r.uuid, r.numero_ordine_esterno, r.motivo_reso, r.stato, r.note, r.note_venditore, r.data_approvazione, r.created_at,
            u.nome as richiedente_nome, u.azienda as richiedente_azienda,
            v.nome as venditore_nome
     FROM richieste_reso r
     JOIN users u ON r.user_id = u.id
     LEFT JOIN users v ON r.venditore_id = v.id
     ${where}
     ORDER BY r.data_approvazione DESC
     LIMIT ? OFFSET ?`
  );
  const data = dataStmt.all(limit, offset);

  res.json({ data, total, page: Math.max(parseInt(page) || 1, 1), per_page: limit });
});

// GET /api/customer-service/richieste/:uuid
router.get('/richieste/:uuid', (req, res) => {
  const { uuid } = req.params;

  const richiesta = db.prepare(
    `SELECT r.*, u.nome as richiedente_nome, u.azienda as richiedente_azienda,
            v.nome as venditore_nome
     FROM richieste_reso r
     JOIN users u ON r.user_id = u.id
     LEFT JOIN users v ON r.venditore_id = v.id
     WHERE r.uuid = ? AND r.stato = 'in_revisione'`
  ).get(uuid);

  if (!richiesta) {
    return res.status(404).json({ error: 'Richiesta non trovata' });
  }

  const uploads = db.prepare(
    'SELECT id, mime_type, size_bytes, sha256_hash, uploaded_at FROM uploads WHERE richiesta_id = ?'
  ).all(richiesta.id);

  res.json({ ...richiesta, prodotti: JSON.parse(richiesta.prodotti || '[]'), uploads });
});

// PUT /api/customer-service/richieste/:uuid — accetta/rifiuta
router.put('/richieste/:uuid', async (req, res) => {
  const { uuid } = req.params;
  const csId = req.user.id;

  const parsed = csResoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dati non validi', issues: parsed.error.issues });
  }

  const { stato, note } = parsed.data;

  const existing = db.prepare(
    'SELECT * FROM richieste_reso WHERE uuid = ? AND stato = ?'
  ).get(uuid, 'in_revisione');

  if (!existing) {
    return res.status(404).json({ error: 'Richiesta non trovata o già processata' });
  }

  const dataApprovazione = new Date().toISOString();

  db.prepare(
    `UPDATE richieste_reso SET
     stato = ?, note_venditore = COALESCE(?, note_venditore), data_approvazione = ?, updated_at = datetime('now')
     WHERE uuid = ?`
  ).run(stato, note || null, dataApprovazione, uuid);

  logger.info(`Richiesta ${uuid} ${stato} da customer_service ${csId}`);

  // Se approvata, invia webhook ad ABC HUB
  if (stato === 'approvato') {
    const venditore = db.prepare('SELECT codice_cliente_esterno FROM users WHERE id = ?').get(existing.venditore_id || existing.user_id);
    const richiestaAggiornata = db.prepare('SELECT * FROM richieste_reso WHERE uuid = ?').get(uuid);

    try {
      await sendWebhook({
        id_richiesta: uuid,
        numero_ordine: richiestaAggiornata.numero_ordine_esterno,
        bda_hash: richiestaAggiornata.bda_hash,
        venditore_codice: venditore?.codice_cliente_esterno || '',
        prodotti: JSON.parse(richiestaAggiornata.prodotti || '[]'),
        motivo_reso: richiestaAggiornata.motivo_reso,
        note: richiestaAggiornata.note,
        data_approvazione: dataApprovazione,
      });
    } catch (err) {
      logger.error(`Webhook fallito per ${uuid}: ${err.message}`);
    }
  }

  res.json({ success: true, stato });
});

// GET /api/customer-service/stats
router.get('/stats', (req, res) => {
  const stats = db.prepare(
    `SELECT stato, COUNT(*) as count FROM richieste_reso GROUP BY stato`
  ).all();

  const oggi = new Date().toISOString().split('T')[0];
  const oggiStats = db.prepare(
    `SELECT stato, COUNT(*) as count FROM richieste_reso
     WHERE date(data_approvazione) = date(?)
     GROUP BY stato`
  ).all(oggi);

  const result = {
    total: stats.reduce((sum, s) => sum + s.count, 0),
    by_stato: stats.reduce((acc, s) => { acc[s.stato] = s.count; return acc; }, {}),
    oggi: oggiStats.reduce((acc, s) => { acc[s.stato] = s.count; return acc; }, {}),
  };

  res.json(result);
});

export default router;
