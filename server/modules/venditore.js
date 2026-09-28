import { Router } from 'express';
import db from '../lib/db.js';
import logger from '../lib/logger.js';
import { approvaResoSchema } from './validation.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { logAudit } from '../lib/audit.js';

// F11: routing per responsabile. Determina il filtro resp_codice del venditore
// loggato. Se il suo codice_cliente_esterno matcha un resp_codice in anagrafica_pv,
// vede solo i resi dei PV a lui assegnati; altrimenti backward-compat (tutti).
// Ritorna { codice, filter } dove filter e' null (vede tutto) oppure il codice.
function venditoreRoutingFilter(venditoreId) {
  const row = db.prepare('SELECT codice_cliente_esterno FROM users WHERE id = ?').get(venditoreId);
  const codice = row?.codice_cliente_esterno || null;
  if (!codice) return { codice: null, filter: null };
  const assegnato = db.prepare('SELECT 1 FROM anagrafica_pv WHERE resp_codice = ? LIMIT 1').get(codice);
  return { codice, filter: assegnato ? codice : null };
}

const router = Router();

// 2026-09-28 P3: filtro gruppo PV (clit). Come CS/admin: nome gruppo con spazi
// ammessi (es. "SEVEN SPA"), mai wildcard SQL (% _) né caratteri di controllo.
const CLIT_SEARCH_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿ' .\-]{1,60}$/;

router.use(authenticate);
router.use(authorize('venditore'));

// GET /api/venditore/richieste — tutti i resi in_attesa degli store
// 2026-09-28 P3: filtro testuale `clit` (codice o nome del gruppo PV) oltre a
// stato/date. Sempre parametrizzato, mai concatenato.
router.get('/richieste', (req, res) => {
  const { stato, data_da, data_a, clit, page = '1', per_page = '20' } = req.query;
  const { filter: respFilter } = venditoreRoutingFilter(req.user.id);

  let where = "WHERE r.stato = 'in_attesa' AND u.ruolo = 'store_account'";
  const params = [];

  if (respFilter) {
    where += ' AND r.resp_codice = ?';
    params.push(respFilter);
  } else {
    // backward-compat: nessuna assegnazione territoriale -> vede tutti gli in_attesa
    // (inclusi resi pre-F11 con resp_codice NULL)
  }

  if (clit !== undefined && clit !== '' && clit !== null) {
    const g = String(clit).trim();
    if (!CLIT_SEARCH_RE.test(g)) {
      return res.status(400).json({ error: 'Parametro clit non valido' });
    }
    where += ' AND (r.pv_clit_codice LIKE ? OR r.pv_clit_nome LIKE ? COLLATE NOCASE)';
    params.push(`%${g}%`, `%${g}%`);
  }

  if (data_da) {
    where += " AND date(r.created_at) >= date(?)";
    params.push(data_da);
  }
  if (data_a) {
    where += " AND date(r.created_at) <= date(?)";
    params.push(data_a);
  }

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM richieste_reso r JOIN users u ON r.user_id = u.id ${where}`);
  const { total } = countStmt.get(...params);

  const limit = Math.min(parseInt(per_page) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const dataStmt = db.prepare(
    `SELECT r.id, r.uuid, r.numero_ordine_esterno, r.motivo_reso, r.stato, r.note, r.corriere, r.corriere_nome, r.created_at,
            u.nome as richiedente_nome, u.azienda as richiedente_azienda
     FROM richieste_reso r
     JOIN users u ON r.user_id = u.id
     ${where}
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`
  );
  const data = dataStmt.all(...params, limit, offset);

  res.json({ data, total, page: Math.max(parseInt(page) || 1, 1), per_page: limit });
});

// GET /api/venditore/richieste/:uuid
router.get('/richieste/:uuid', (req, res) => {
  const { uuid } = req.params;
  const { filter: respFilter } = venditoreRoutingFilter(req.user.id);

  const where = respFilter
    ? "WHERE r.uuid = ? AND r.stato = 'in_attesa' AND u.ruolo = 'store_account' AND r.resp_codice = ?"
    : "WHERE r.uuid = ? AND r.stato = 'in_attesa' AND u.ruolo = 'store_account'";
  const params = respFilter ? [uuid, respFilter] : [uuid];

  const richiesta = db.prepare(
    `SELECT r.*, u.nome as richiedente_nome, u.azienda as richiedente_azienda
     FROM richieste_reso r
     JOIN users u ON r.user_id = u.id
     ${where}`
  ).get(...params);

  if (!richiesta) {
    return res.status(404).json({ error: 'Richiesta non trovata' });
  }

  const uploads = db.prepare(
    'SELECT id, mime_type, size_bytes, sha256_hash, uploaded_at FROM uploads WHERE richiesta_id = ?'
  ).all(richiesta.id);

  res.json({ ...richiesta, prodotti: JSON.parse(richiesta.prodotti || '[]'), uploads });
});

// PUT /api/venditore/richieste/:uuid — approva/rifiuta
// Approva → stato 'in_revisione' (non invia webhook, aspetta customer_service)
router.put('/richieste/:uuid', (req, res) => {
  const { uuid } = req.params;
  const venditoreId = req.user.id;

  const parsed = approvaResoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dati non validi', issues: parsed.error.issues });
  }

  const { stato, note } = parsed.data;

  const { filter: respFilter } = venditoreRoutingFilter(venditoreId);

  const where = respFilter
    ? "WHERE r.uuid = ? AND r.stato = 'in_attesa' AND u.ruolo = 'store_account' AND r.resp_codice = ?"
    : "WHERE r.uuid = ? AND r.stato = 'in_attesa' AND u.ruolo = 'store_account'";
  const params = respFilter ? [uuid, respFilter] : [uuid];

  const existing = db.prepare(
    `SELECT r.* FROM richieste_reso r
     JOIN users u ON r.user_id = u.id
     ${where}`
  ).get(...params);

  if (!existing) {
    return res.status(404).json({ error: 'Richiesta non trovata o già processata' });
  }

  const dataApprovazione = new Date().toISOString();
  const nuovoStato = stato === 'approvato' ? 'in_revisione' : stato;

  db.prepare(
    `UPDATE richieste_reso SET
     stato = ?, note_venditore = ?, data_approvazione = ?, venditore_id = ?, updated_at = datetime('now')
     WHERE uuid = ?`
  ).run(nuovoStato, note || null, dataApprovazione, venditoreId, uuid);

  logger.info(`Richiesta ${uuid} ${nuovoStato} da venditore ${venditoreId}`);
  logAudit(venditoreId, stato === 'approvato' ? 'RESO_APPROVATO_1' : 'RESO_RIFIUTATO_1', { uuid, stato: nuovoStato, note: note || null }, req);

  res.json({ success: true, stato: nuovoStato });
});

// GET /api/venditore/stats
router.get('/stats', (req, res) => {
  const venditoreId = req.user.id;

  const stats = db.prepare(
    `SELECT stato, COUNT(*) as count FROM richieste_reso WHERE venditore_id = ? GROUP BY stato`
  ).all(venditoreId);

  const oggi = new Date().toISOString().split('T')[0];
  const oggiStats = db.prepare(
    `SELECT stato, COUNT(*) as count FROM richieste_reso
     WHERE venditore_id = ? AND date(data_approvazione) = date(?)
     GROUP BY stato`
  ).all(venditoreId, oggi);

  const result = {
    total: stats.reduce((sum, s) => sum + s.count, 0),
    by_stato: stats.reduce((acc, s) => { acc[s.stato] = s.count; return acc; }, {}),
    oggi: oggiStats.reduce((acc, s) => { acc[s.stato] = s.count; return acc; }, {}),
  };

  res.json(result);
});

// POST /api/venditore/webhook/config
router.post('/webhook/config', (req, res) => {
  const venditoreId = req.user.id;
  const { webhook_url } = req.body;

  if (webhook_url && !/^https?:\/\/.+/.test(webhook_url)) {
    return res.status(400).json({ error: 'URL webhook non valido' });
  }

  db.prepare('UPDATE users SET webhook_url = ? WHERE id = ?').run(webhook_url || null, venditoreId);
  res.json({ success: true });
});

export default router;
