import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../lib/db.js';
import logger from '../lib/logger.js';
import { csResoSchema } from './validation.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { logAudit } from '../lib/audit.js';
import { sendWebhook } from './webhook.js';
import { buildResiXls, pvDbAvailable } from '../lib/xls-export.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Cartella dove salvare il file GLS giornaliero aggregato su disco
// (configurabile via env; default Scrivania dell'utente, scrivibile in dev).
const GLS_EXPORT_DIR = process.env.GLS_EXPORT_DIR || '/home/adimn/Scrivania';

const router = Router();

// Stati per cui il reso è già stato trasmesso ad ABC HUB (webhook sparato):
// per questi stati l'interno può scaricare il file corriere RITGIO*.xls.
const STATI_EXPORTABILI = ['approvato', 'spedito', 'completato'];

router.use(authenticate);
router.use(authorize('customer_service'));

// GET /api/customer-service/richieste — resi da gestire.
//   ?view=da_approvare (default) → resi in_revisione (coda approvazione).
//   ?view=elaborati              → resi approvato/spedito/completato (già
//                                 trasmessi ad ABC HUB): l'interno li ritrova
//                                 qui per scaricare il file corriere RITGIO*.xls.
router.get('/richieste', (req, res) => {
  const { page = '1', per_page = '20', view = 'da_approvare' } = req.query;

  const where = view === 'elaborati'
    ? "WHERE r.stato IN ('approvato','spedito','completato')"
    : "WHERE r.stato = 'in_revisione'";

  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM richieste_reso r ${where}`);
  const { total } = countStmt.get();

  const limit = Math.min(parseInt(per_page) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const dataStmt = db.prepare(
    `SELECT r.id, r.uuid, r.numero_ordine_esterno, r.motivo_reso, r.stato, r.note, r.note_venditore, r.data_approvazione, r.created_at,
            r.cldm, r.ddt_numero, r.num_colli, r.bda_autorizzazione,
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

// GET /api/customer-service/gls/giornaliero?data=YYYY-MM-DD (default oggi)
// File GLS giornaliero aggregato: tutti i resi approvati dall'interno nella
// giornata con corriere=GLS. Una riga per reso, header 16-col RITGIO invariato.
// Salva su disco (RITGIO_GLS_<DDMMYY>.xls) + stream download.
router.get('/gls/giornaliero', (req, res) => {
  const dataParam = req.query.data || new Date().toISOString().split('T')[0];
  const rows = db.prepare(
    `SELECT * FROM richieste_reso
     WHERE stato = 'approvato' AND corriere = 'GLS' AND date(data_approvazione) = date(?)
     ORDER BY num_reso ASC`
  ).all(dataParam);

  if (rows.length === 0) {
    return res.status(404).json({ error: `Nessun reso GLS approvato in data ${dataParam}`, count: 0 });
  }

  try {
    const { buf, filename } = buildResiXls(rows);
    // nome file distintivo per il giornaliero aggregato
    const glsFilename = filename.replace('RITGIO_', 'RITGIO_GLS_');
    const outPath = path.join(GLS_EXPORT_DIR, glsFilename);
    try { fs.writeFileSync(outPath, Buffer.from(buf)); } catch (e) {
      logger.error(`Scrittura file GLS su disco fallita: ${e.message}`);
    }
    logger.info(`File GLS giornaliero generato: ${glsFilename} (${rows.length} resi) da CS ${req.user.id}`);
    logAudit(req.user.id, 'GLS_EXPORT_GIORNALIERO', { filename: glsFilename, count: rows.length, data: dataParam }, req);
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', `attachment; filename="${glsFilename}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    logger.error(`Errore generazione file GLS giornaliero: ${err.message}`);
    res.status(500).json({ error: 'Errore generazione file GLS', detail: err.message });
  }
});

// GET /api/customer-service/richieste/:uuid
// Mostra il dettaglio sia dei resi in_revisione (da approvare) sia di quelli
// già approvati/spediti/completati (read-only, per scaricare il file corriere).
router.get('/richieste/:uuid', (req, res) => {
  const { uuid } = req.params;

  const richiesta = db.prepare(
    `SELECT r.*, u.nome as richiedente_nome, u.azienda as richiedente_azienda,
            v.nome as venditore_nome
     FROM richieste_reso r
     JOIN users u ON r.user_id = u.id
     LEFT JOIN users v ON r.venditore_id = v.id
     WHERE r.uuid = ? AND r.stato IN ('in_revisione','approvato','spedito','completato')`
  ).get(uuid);

  if (!richiesta) {
    return res.status(404).json({ error: 'Richiesta non trovata' });
  }

  const uploads = db.prepare(
    'SELECT id, mime_type, size_bytes, sha256_hash, uploaded_at FROM uploads WHERE richiesta_id = ?'
  ).all(richiesta.id);

  res.json({ ...richiesta, prodotti: JSON.parse(richiesta.prodotti || '[]'), uploads });
});

// GET /api/customer-service/richieste/:uuid/xls — genera il manifest ritiri
// corriere (RITGIO_<DDMMYY>.xls) on-demand per il reso specificato. Disponibile
// solo per resi già trasmessi ad ABC HUB (stati exportabili). L'interno scarica
// il file dalla sua pagina senza dipendere dalla scrittura su disco di ABC HUB.
router.get('/richieste/:uuid/xls', (req, res) => {
  const { uuid } = req.params;

  const richiesta = db.prepare(
    `SELECT * FROM richieste_reso WHERE uuid = ?`
  ).get(uuid);

  if (!richiesta) {
    return res.status(404).json({ error: 'Richiesta non trovata' });
  }
  if (!STATI_EXPORTABILI.includes(richiesta.stato)) {
    return res.status(409).json({ error: 'File corriere disponibile solo dopo l\'approvazione finale' });
  }

  try {
    const { buf, filename } = buildResiXls([richiesta]);
    logger.info(`XLS corriere generato per ${uuid} (stato=${richiesta.stato}) da customer_service ${req.user.id}`);
    logAudit(req.user.id, 'RESO_EXPORT_XLS', { uuid, filename, stato: richiesta.stato }, req);
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    logger.error(`Errore generazione XLS per ${uuid}: ${err.message}`);
    res.status(500).json({ error: 'Errore generazione file corriere', pv_db: pvDbAvailable });
  }
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
  logAudit(csId, stato === 'approvato' ? 'RESO_APPROVATO_FINALE' : 'RESO_RIFIUTATO_FINALE', { uuid, stato, note: note || null }, req);

  // Se approvata, invia webhook ad ABC HUB.
  // Fire-and-forget: risponde subito al client, il webhook gira in background.
  // Con retry 5s/30s/300s, awaitare bloccherebbe l'UI CS fino a ~5.5min se
  // l'endpoint è down/401. Il processo server è long-running quindi l'async
  // in background completa senza essere troncato.
  if (stato === 'approvato') {
    const venditore = db.prepare('SELECT codice_cliente_esterno FROM users WHERE id = ?').get(existing.venditore_id || existing.user_id);
    const richiestaAggiornata = db.prepare('SELECT * FROM richieste_reso WHERE uuid = ?').get(uuid);

    sendWebhook({
      id_richiesta: uuid,
      numero_ordine: richiestaAggiornata.numero_ordine_esterno,
      bda_hash: richiestaAggiornata.bda_hash,
      venditore_codice: venditore?.codice_cliente_esterno || '',
      prodotti: richiestaAggiornata.prodotti ? JSON.parse(richiestaAggiornata.prodotti) : [],
      linee: richiestaAggiornata.linee ? JSON.parse(richiestaAggiornata.linee) : [],
      corriere: richiestaAggiornata.corriere || null,
      corriere_nome: richiestaAggiornata.corriere_nome || null,
      pv_nome: richiestaAggiornata.pv_nome || null,
      pv_indirizzo: richiestaAggiornata.pv_indirizzo || null,
      pv_citta: richiestaAggiornata.pv_citta || null,
      pv_cap: richiestaAggiornata.pv_cap || null,
      pv_provincia: richiestaAggiornata.pv_provincia || null,
      pv_regione: richiestaAggiornata.pv_regione || null,
      num_reso: richiestaAggiornata.num_reso ?? null,
      motivo_reso: richiestaAggiornata.motivo_reso,
      note: richiestaAggiornata.note,
      data_approvazione: dataApprovazione,
      // Campi per export corriere (RITGIO*.xls) — modello vecchio (backward compat)
      cldm: richiestaAggiornata.cldm || null,
      ddt_numero: richiestaAggiornata.ddt_numero || null,
      ddt_data: richiestaAggiornata.ddt_data || null,
      num_colli: richiestaAggiornata.num_colli ?? null,
      bda_autorizzazione: richiestaAggiornata.bda_autorizzazione || null,
    }).catch((err) => logger.error(`Webhook fallito per ${uuid}: ${err.message}`));
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
