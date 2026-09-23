import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../lib/db.js';
import logger from '../lib/logger.js';
import { csResoSchema, exportResiSchema, batchCsSchema, statsExportSchema } from './validation.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { logAudit } from '../lib/audit.js';
import { sendWebhook } from './webhook.js';
import { buildResiXls, pvDbAvailable } from '../lib/xls-export.js';
import { buildStatsXlsx } from '../lib/stats-export.js';
import { sendResoAutorizzazioneEmail } from '../lib/resi-email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Cartella dove salvare il file GLS giornaliero aggregato su disco.
// Default: VUOTA = nessuna scrittura su disco (2026-09-16, richiesta utente: niente
// piu' file di recap sparsi sulla Scrivania — il download via browser basta).
// Per riattivare la copia su disco, impostare GLS_EXPORT_DIR (es. ./data/exports,
// cartella di progetto ignorata da git).
const GLS_EXPORT_DIR = process.env.GLS_EXPORT_DIR || '';

const router = Router();

// Stati per cui il reso è già stato trasmesso ad ABC HUB (webhook sparato):
// per questi stati l'interno può scaricare il file corriere RITGIO*.xls.
const STATI_EXPORTABILI = ['approvato', 'spedito', 'completato'];

router.use(authenticate);
router.use(authorize('customer_service'));

// Notifiche post-approvazione definitiva del 2° livello (webhook ad ABC HUB +
// email di autorizzazione). Condivisa dal PUT singolo e dall'azione massiva:
// entrambi fire-and-forget, non bloccano mai la risposta HTTP (retry 5s/30s/300s,
// il processo server e' long-running quindi l'async in background completa).
function notificaApprovazioneReso(existing) {
  const uuid = existing.uuid;
  const venditore = db.prepare('SELECT codice_cliente_esterno FROM users WHERE id = ?').get(existing.venditore_id || existing.user_id);
  const richiestaAggiornata = db.prepare('SELECT * FROM richieste_reso WHERE uuid = ?').get(uuid);

  // Audit (opzionali, nullable): richiedente = utente che ha creato il reso
  // (user_id), approvatore = venditore responsabile 1° livello (venditore_id).
  // Se venditore_id è NULL (reso pre-F11 o store_account senza routing), si
  // invia null per approvatore_* — il webhook non si blocca.
  const richiedente = db.prepare('SELECT nome, ruolo FROM users WHERE id = ?').get(existing.user_id);
  const approvatore = existing.venditore_id
    ? db.prepare('SELECT nome, ruolo FROM users WHERE id = ?').get(existing.venditore_id)
    : null;

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
    motivo_altro: richiestaAggiornata.motivo_altro || null,
    note: richiestaAggiornata.note,
    data_approvazione: richiestaAggiornata.data_approvazione,
    // Campi per export corriere (RITGIO*.xls) — modello vecchio (backward compat)
    cldm: richiestaAggiornata.cldm || null,
    ddt_numero: richiestaAggiornata.ddt_numero || null,
    ddt_data: richiestaAggiornata.ddt_data || null,
    num_colli: richiestaAggiornata.num_colli ?? null,
    bda_autorizzazione: richiestaAggiornata.bda_autorizzazione || null,
    richiedente_nome: richiedente?.nome ?? null,
    richiedente_ruolo: richiedente?.ruolo ?? null,
    approvatore_nome: approvatore?.nome ?? null,
    approvatore_ruolo: approvatore?.ruolo ?? null,
  }).catch((err) => logger.error(`Webhook fallito per ${uuid}: ${err.message}`));

  // Email di autorizzazione al reso (testo + HTML) alle destinatarie fisse.
  // Fire-and-forget: non blocca la risposta HTTP. Se SMTP non configurato o env
  // RESI_AUTORIZZAZIONE_EMAIL_ON=0 → skip silente. Usa la riga completa appena
  // aggiornata cosi' i campi pv_*/ddt_*/linee/motivo sono quelli correnti.
  sendResoAutorizzazioneEmail(richiestaAggiornata).catch((err) =>
    logger.error(`Email autorizzazione fallita per ${uuid}: ${err.message}`)
  );
}

// GET /api/customer-service/richieste — resi da gestire (3 view + search).
//   ?view=da_approvare (default) → resi in_revisione (coda approvazione).
//   ?view=approvati               → resi approvati (coda export/spedizione).
//   ?view=inviati                 → resi spedito/completato (già inviati).
//   ?view=elaborati (LEGACY)      → alias approvato+spedito+completato
//                                  (backward compat con vecchi caller).
//   Search (opzionali, combinati AND dentro il view):
//     cldm     LIKE '%?%' su r.cldm
//     num_reso exact int su r.num_reso
//     data_da  ISO date YYYY-MM-DD → date(r.data_approvazione) >= date(?)
//     data_a   ISO date YYYY-MM-DD → date(r.data_approvazione) <= date(?)
//   Paginazione invariata. Ordine: da_approvare → r.created_at DESC;
//   approvati/inviati/elaborati → r.data_approvazione DESC.
//   Tutti i parametri utente entrano in SQL parametrizzati (?), mai concatenati.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLDM_SEARCH_RE = /^[A-Za-z0-9_\-]{1,20}$/;

router.get('/richieste', (req, res) => {
  const { page = '1', per_page = '20', view = 'da_approvare' } = req.query;

  // 1. Risolve il filtro view (stato) come base del WHERE.
  let statoCond;
  let orderBy;
  if (view === 'elaborati') {
    // LEGACY: alias per backward compat con eventuali vecchi caller.
    statoCond = "r.stato IN ('approvato','spedito','completato')";
    orderBy = 'r.data_approvazione DESC';
  } else if (view === 'approvati') {
    statoCond = "r.stato = 'approvato'";
    orderBy = 'r.data_approvazione DESC';
  } else if (view === 'inviati') {
    statoCond = "r.stato IN ('spedito','completato')";
    orderBy = 'r.data_approvazione DESC';
  } else {
    // default (anche per valori non riconosciuti): da_approvare.
    statoCond = "r.stato = 'in_revisione'";
    orderBy = 'r.created_at DESC';
  }

  // 2. Costruisce condizioni di search dinamicamente (sempre parametrizzate).
  const conds = [statoCond];
  const params = [];
  const { cldm, num_reso, data_da, data_a } = req.query;

  if (cldm !== undefined && cldm !== '' && cldm !== null) {
    const c = String(cldm);
    if (!CLDM_SEARCH_RE.test(c)) {
      return res.status(400).json({ error: 'Parametro cldm non valido' });
    }
    conds.push('r.cldm LIKE ?');
    params.push(`%${c}%`);
  }
  if (num_reso !== undefined && num_reso !== '' && num_reso !== null) {
    const n = Number.parseInt(num_reso, 10);
    if (!Number.isFinite(n) || n < 1 || n > 1_000_000) {
      return res.status(400).json({ error: 'Parametro num_reso non valido' });
    }
    conds.push('r.num_reso = ?');
    params.push(n);
  }
  if (data_da !== undefined && data_da !== '' && data_da !== null) {
    const d = String(data_da);
    if (!ISO_DATE_RE.test(d)) {
      return res.status(400).json({ error: 'Parametro data_da non valido (YYYY-MM-DD)' });
    }
    conds.push('date(r.data_approvazione) >= date(?)');
    params.push(d);
  }
  if (data_a !== undefined && data_a !== '' && data_a !== null) {
    const d = String(data_a);
    if (!ISO_DATE_RE.test(d)) {
      return res.status(400).json({ error: 'Parametro data_a non valido (YYYY-MM-DD)' });
    }
    conds.push('date(r.data_approvazione) <= date(?)');
    params.push(d);
  }

  const where = `WHERE ${conds.join(' AND ')}`;

  // COUNT con stesso WHERE dinamico (stesso array params).
  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM richieste_reso r ${where}`);
  const { total } = countStmt.get(...params);

  const limit = Math.min(parseInt(per_page) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const dataStmt = db.prepare(
    `SELECT r.id, r.uuid, r.numero_ordine_esterno, r.motivo_reso, r.motivo_altro, r.stato, r.note, r.note_venditore, r.data_approvazione, r.created_at,
            r.cldm, r.ddt_numero, r.num_colli, r.bda_autorizzazione,
            r.num_reso, r.data_spedizione, r.corriere, r.corriere_nome,
            u.nome as richiedente_nome, u.azienda as richiedente_azienda,
            v.nome as venditore_nome
     FROM richieste_reso r
     JOIN users u ON r.user_id = u.id
     LEFT JOIN users v ON r.venditore_id = v.id
     ${where}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`
  );
  const data = dataStmt.all(...params, limit, offset);

  res.json({ data, total, page: Math.max(parseInt(page) || 1, 1), per_page: limit });
});

// POST /api/customer-service/richieste/export — export XLS multi-riga dei resi
// selezionati (solo approvati) e mark spedito in un'azione atomica.
//   Body: { uuids: string[] } (1..500 uuid validi).
//   - Solo resi con stato='approvato' vengono marcati spediti: resi gia'
//     spediti/completati/annullati sono skippati dal WHERE della SELECT e
//     dell'UPDATE (idempotenti: non vengono riesportati ne' ri-marcati).
//   - Atomicita': l'XLS e' generato PRIMA della transazione UPDATE; se
//     buildResiXls lancia, i resi restano 'approvato' (nessuno spedito senza
//     file). Se una UPDATE fallisce, la transazione fa rollback (nessuno
//     diventa spedito).
//   - XLS: buildResiXls(rows) gia' itera rows in un unico worksheet multi-riga
//     (riuso, nessuna modifica a xls-export.js).
router.post('/richieste/export', (req, res) => {
  const parsed = exportResiSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dati non validi', issues: parsed.error.issues });
  }
  const { uuids } = parsed.data;

  const placeholders = uuids.map(() => '?').join(',');
  // Solo approvati: resi gia' spediti/completati sono esclusi dall'export.
  const resi = db.prepare(
    `SELECT * FROM richieste_reso WHERE uuid IN (${placeholders}) AND stato = 'approvato'`
  ).all(...uuids);

  if (resi.length === 0) {
    return res.status(404).json({ error: 'Nessun reso approvato selezionato' });
  }

  // Genera l'XLS PRIMA di marcare spedito: se buildResiXls fallisce, i resi
  // restano 'approvato' (azione atomica, niente stato inconsistente senza file).
  let buf, filename;
  try {
    ({ buf, filename } = buildResiXls(resi));
  } catch (err) {
    logger.error(`Errore generazione XLS export selezionati: ${err.message}`);
    return res.status(500).json({ error: 'Errore generazione file corriere', detail: err.message });
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const r of resi) {
      db.prepare(
        `UPDATE richieste_reso SET stato = 'spedito', data_spedizione = ?, updated_at = datetime('now')
         WHERE uuid = ? AND stato = 'approvato'`
      ).run(now, r.uuid);
    }
  });
  tx();

  logAudit(req.user.id, 'RESI_EXPORT_SELEZIONATI', { count: resi.length, uuids }, req);
  logger.info(`Export selezionati: ${resi.length} resi → spedito da CS ${req.user.id}`);

  const outName = filename.replace('RITGIO_', 'RITGIO_selezionati_');
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
  res.send(Buffer.from(buf));
});

// POST /api/customer-service/richieste/azione-batch — approvazione/rifiuto
// massivo sulla coda "Da approvare" (2026-09-16 P4, richiesta operatori).
//   Body: { uuids: string[] (1..500), stato: 'approvato'|'rifiutato', note?: string }.
//   - Idempotente come l'export: solo i resi con stato='in_revisione' vengono
//     aggiornati (gia' processati/annullati sono skippati dal WHERE e restituiti
//     solo come uuids_saltati, nessun errore).
//   - Atomicita': db.transaction — o tutti i selezionati cambiano stato o nessuno.
//   - La nota (opzionale per scelta utente) e' condivisa: COALESCE mantiene le
//     note_venditore esistenti quando non viene fornita.
//   - Per ogni approvato partono webhook + email (notificaApprovazioneReso,
//     fire-and-forget — non bloccano la risposta nemmeno in batch).
router.post('/richieste/azione-batch', (req, res) => {
  const parsed = batchCsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dati non validi', issues: parsed.error.issues });
  }
  const { uuids, stato, note } = parsed.data;

  const placeholders = uuids.map(() => '?').join(',');
  // Solo in_revisione: resi gia' processati sono skippati (idempotente).
  const resi = db.prepare(
    `SELECT * FROM richieste_reso WHERE uuid IN (${placeholders}) AND stato = 'in_revisione'`
  ).all(...uuids);

  if (resi.length === 0) {
    return res.status(404).json({ error: 'Nessun reso da approvare selezionato' });
  }

  const dataApprovazione = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const r of resi) {
      db.prepare(
        `UPDATE richieste_reso SET
         stato = ?, note_venditore = COALESCE(?, note_venditore), data_approvazione = ?, updated_at = datetime('now')
         WHERE uuid = ? AND stato = 'in_revisione'`
      ).run(stato, note || null, dataApprovazione, r.uuid);
    }
  });
  tx();

  const uuidsAggiornati = resi.map((r) => r.uuid);
  const uuidsSaltati = uuids.filter((u) => !uuidsAggiornati.includes(u));

  logger.info(`Batch CS: ${resi.length} resi → ${stato} da CS ${req.user.id}`);
  logAudit(req.user.id, stato === 'approvato' ? 'RESO_BATCH_APPROVAZIONE' : 'RESO_BATCH_RIFIUTO',
    { count: resi.length, uuids: uuidsAggiornati, stato, note: note || null }, req);

  // Per ogni approvato: webhook ad ABC HUB + email di autorizzazione
  // (fire-and-forget, stessa funzione del PUT singolo).
  if (stato === 'approvato') {
    for (const r of resi) {
      notificaApprovazioneReso(r);
    }
  }

  res.json({ success: true, stato, aggiornati: resi.length, uuids_saltati: uuidsSaltati });
});

// POST /api/customer-service/richieste/ristampa-xls — ristampa del report XLS
// multi-riga dei resi selezionati nella tab "Inviati" (2026-09-16 P4).
//   Body: { uuids: string[] } (1..500 uuid validi, stesso schema dell'export).
//   - Solo resi spedito/completato: la ristampa NON cambia stato e NON scrive
//     su disco (nessun file di recap — richiesta utente).
//   - buildResiXls genera un unico worksheet multi-riga (riuso).
router.post('/richieste/ristampa-xls', (req, res) => {
  const parsed = exportResiSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dati non validi', issues: parsed.error.issues });
  }
  const { uuids } = parsed.data;

  const placeholders = uuids.map(() => '?').join(',');
  const resi = db.prepare(
    `SELECT * FROM richieste_reso WHERE uuid IN (${placeholders}) AND stato IN ('spedito','completato')`
  ).all(...uuids);

  if (resi.length === 0) {
    return res.status(404).json({ error: 'Nessun reso spedito selezionato' });
  }

  try {
    const { buf, dataCreazione } = buildResiXls(resi);
    const filename = `RITGIO_ristampa_${dataCreazione}.xls`;
    logger.info(`Ristampa XLS: ${resi.length} resi da CS ${req.user.id}`);
    logAudit(req.user.id, 'RESI_RISTAMPA_XLS', { count: resi.length, uuids }, req);
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    logger.error(`Errore ristampa XLS: ${err.message}`);
    res.status(500).json({ error: 'Errore generazione file corriere', detail: err.message });
  }
});

// POST /api/customer-service/richieste/export-statistiche — estrazione massiva
// dei resi per le statistiche INTERNE (2026-09-22, richieste operatori: NON e'
// il file per il corriere). Body: i filtri della ricerca (cldm / num_reso /
// data_da / data_a su data_approvazione), tutti opzionali.
//   - SENZA filtro di stato/tab: copre TUTTI i resi che rispettano i filtri,
//     con colonna Stato (la vista di provenienza non conta).
//   - Nessun cambio di stato, nessuna scrittura su disco: solo download.
//   - Cap difensivo 5000 righe (dump completo dell'intero DB con un click e'
//     un rischio di timeout/ODM, non un caso d'uso statistico reale).
router.post('/richieste/export-statistiche', (req, res) => {
  const parsed = statsExportSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dati non validi', issues: parsed.error.issues });
  }
  const { cldm, num_reso, data_da, data_a } = parsed.data;

  // Stessa clausola WHERE della ricerca del GET /richieste (parametrizzata),
  // senza la condizione di stato della tab.
  const conds = [];
  const params = [];
  if (cldm) {
    conds.push('r.cldm LIKE ?');
    params.push(`%${cldm}%`);
  }
  if (num_reso !== undefined) {
    conds.push('r.num_reso = ?');
    params.push(num_reso);
  }
  if (data_da) {
    conds.push('date(r.data_approvazione) >= date(?)');
    params.push(data_da);
  }
  if (data_a) {
    conds.push('date(r.data_approvazione) <= date(?)');
    params.push(data_a);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const resi = db.prepare(
    `SELECT r.*, u.nome as richiedente_nome, u.azienda as richiedente_azienda,
            v.nome as venditore_nome
     FROM richieste_reso r
     JOIN users u ON r.user_id = u.id
     LEFT JOIN users v ON r.venditore_id = v.id
     ${where}
     ORDER BY r.created_at ASC
     LIMIT 5000`
  ).all(...params);

  if (resi.length === 0) {
    return res.status(404).json({ error: 'Nessun reso trovato con i filtri indicati' });
  }

  try {
    const { buf, filename } = buildStatsXlsx(resi);
    logger.info(`Export statistiche: ${resi.length} resi da CS ${req.user.id}`);
    logAudit(req.user.id, 'RESI_EXPORT_STATISTICHE', { count: resi.length, filtri: { cldm: cldm || null, num_reso: num_reso ?? null, data_da: data_da || null, data_a: data_a || null } }, req);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    logger.error(`Errore export statistiche: ${err.message}`);
    res.status(500).json({ error: 'Errore generazione file statistiche', detail: err.message });
  }
});

// GET /api/customer-service/gls/giornaliero?data=YYYY-MM-DD (default oggi)
// File GLS giornaliero aggregato: tutti i resi approvati dall'interno nella
// giornata con corriere=GLS. Una riga per reso, header 16-col RITGIO invariato.
// Stream download (+ copia su disco SOLO se GLS_EXPORT_DIR e' impostata).
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
    // Copia su disco solo se GLS_EXPORT_DIR e' impostata (default: disattivata).
    if (GLS_EXPORT_DIR) {
      try {
        if (!fs.existsSync(GLS_EXPORT_DIR)) fs.mkdirSync(GLS_EXPORT_DIR, { recursive: true });
        const outPath = path.join(GLS_EXPORT_DIR, glsFilename);
        fs.writeFileSync(outPath, Buffer.from(buf));
      } catch (e) {
        logger.error(`Scrittura file GLS su disco fallita: ${e.message}`);
      }
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

  // Se approvata, invia webhook ad ABC HUB + email di autorizzazione
  // (funzione condivisa con l'azione massiva, fire-and-forget).
  if (stato === 'approvato') {
    notificaApprovazioneReso(existing);
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
