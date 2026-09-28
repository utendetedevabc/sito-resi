import { Router } from 'express';
import db from '../lib/db.js';
import logger from '../lib/logger.js';
import { generateUUID, sha256 } from '../lib/security.js';
import { creaResoSchema } from './validation.js';
import { lookupPvByCldm } from '../lib/anagrafica.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { logAudit } from '../lib/audit.js';
import { sendWebhook } from './webhook.js';
import { sendResoAutorizzazioneEmail } from '../lib/resi-email.js';
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

  const { numero_ordine, bda, motivo_reso, motivo_altro, note, prodotti,
          cldm, ddt_numero, ddt_data, num_colli,
          linee, corriere, corriere_nome,
          pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione } = parsed.data;
  const userId = req.user.id;
  const uuid = generateUUID();
  const bdaHash = bda ? sha256(bda) : null;
  // bda_autorizzazione in chiaro = numero BDA (per il manifest ritiri corriere)
  const bdaAutorizzazione = parsed.data.bda_autorizzazione || bda || null;

  // F10: il client invia cldm; pv_* derivano dall'anagrafica (autorevole) quando
  // il cldm e' presente. Se il cldm NON e' in anagrafica (PV manuale fallback),
  // i pv_* vengono letti dal body (inseriti manualmente dall'utente) e
  // resp_codice/resp_nome restano NULL (nessun routing per responsabile).
  const pv = lookupPvByCldm(cldm);
  let pvNome, pvIndirizzo, pvCitta, pvCap, pvProvincia, pvRegione, respCodice, respNome,
      pvClitCodice, pvClitNome;
  if (pv) {
    // Path felice: cldm in anagrafica — usa lookup (invariato).
    pvNome = pv.nome || null;
    pvIndirizzo = pv.indirizzo || null;
    pvCitta = pv.citta || null;
    pvCap = pv.cap || null;
    pvProvincia = pv.provincia || null;
    pvRegione = pv.regione || null;
    // F11: routing per responsabile. Memorizzati per tutti i resi (anche
    // CS/venditore) — utile per audit/display e filtro venditore (in_attesa).
    respCodice = pv.resp_codice || null;
    respNome = pv.resp_nome || null;
    // 2026-09-28 P3: gruppo PV (clit) denormalizzato come resp_* — base della
    // ricerca per gruppo su CS/admin/venditore e della colonna Gruppo nelle stats.
    pvClitCodice = pv.clit_codice || null;
    pvClitNome = pv.clit_nome || null;
  } else {
    // Fallback PV manuale: cldm non in anagrafica. Richiede pv_* essenziali dal
    // body. pv_regione resta opzionale. resp_* NULL (nessun routing responsabile).
    const mancanti = [];
    if (!pv_nome) mancanti.push('pv_nome');
    if (!pv_indirizzo) mancanti.push('pv_indirizzo');
    if (!pv_citta) mancanti.push('pv_citta');
    if (!pv_cap) mancanti.push('pv_cap');
    if (!pv_provincia) mancanti.push('pv_provincia');
    if (mancanti.length > 0) {
      return res.status(400).json({
        error: 'CLDM non trovato in anagrafica: inserisci manualmente i dati del PV (nome, indirizzo, città, CAP, provincia).',
        cldm,
        pv_not_found: true,
      });
    }
    pvNome = pv_nome;
    pvIndirizzo = pv_indirizzo;
    pvCitta = pv_citta;
    pvCap = pv_cap;
    pvProvincia = pv_provincia;
    pvRegione = pv_regione || null;
    respCodice = null;
    respNome = null;
    pvClitCodice = null;
    pvClitNome = null;
  }

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

  // F10: data_approvazione va popolata gia' all'INSERT quando il reso nasce
  // auto-chiuso (customer_service). Per store_account (in_attesa) e venditore
  // (in_revisione) resta NULL (non ancora approvato). Senza questo, l'endpoint
  // GLS giornaliero (filtro date(data_approvazione)=date(?)) non cattura i resi
  // creati come CS e le stats "oggi" li sottostimano.
  const dataApprovazione = statoIniziale === 'approvato' ? new Date().toISOString() : null;

  try {
    const stmt = db.prepare(
      `INSERT INTO richieste_reso
       (uuid, user_id, numero_ordine_esterno, bda_hash, motivo_reso, motivo_altro, note, prodotti, data_scadenza, stato, data_approvazione,
        cldm, ddt_numero, ddt_data, num_colli, bda_autorizzazione,
        linee, corriere, corriere_nome, pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione, resp_codice, resp_nome,
        pv_clit_codice, pv_clit_nome, num_reso)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      uuid,
      userId,
      // numero_ordine_esterno: colonna NOT NULL su DB esistenti; '' e' sicuro
      // (gestito come "nessun ordine") e coerente con PUT. Mai undefined→NULL.
      numero_ordine || '',
      bdaHash,
      motivo_reso,
      motivo_altro || null,
      note || null,
      // prodotte: nel nuovo modello (linee) non si inviano prodotti. Si store '[]'
      // (array vuoto) invece di null perche' alcuni DB esistenti hanno ancora la
      // colonna prodotti NOT NULL (lo schema.sql la rende nullable solo su fresh
      // install, ma CREATE TABLE IF NOT EXISTS e' no-op su DB esistenti). Il
      // webhook e le pagine dettaglio gestiscono [] come "nessun prodotto".
      prodotti ? JSON.stringify(prodotti) : '[]',
      scadenza.toISOString(),
      statoIniziale,
      dataApprovazione,
      cldm || null,
      ddt_numero || null,
      ddt_data || null,
      num_colli || null,
      bdaAutorizzazione,
      linee ? JSON.stringify(linee) : null,
      corriere || null,
      corriere_nome || null,
      pvNome,
      pvIndirizzo,
      pvCitta,
      pvCap,
      pvProvincia,
      pvRegione,
      respCodice,
      respNome,
      pvClitCodice,
      pvClitNome,
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
        const creator = db.prepare('SELECT codice_cliente_esterno, nome, ruolo FROM users WHERE id = ?').get(userId);
        const row = db.prepare('SELECT * FROM richieste_reso WHERE uuid = ?').get(uuid);
        if (row) {
          // CS auto-chiuso: l'interno è sia richiedente che approvatore (1° e
          // unico livello). nome/ruolo arrivano dalla riga users; se il lookup
          // fallisce (utente rimosso?), si invia null — il webhook non si blocca.
          const csNome = creator?.nome ?? null;
          const csRuolo = creator?.ruolo ?? null;
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
            motivo_altro: row.motivo_altro || null,
            note: row.note,
            data_approvazione: new Date().toISOString(),
            cldm: row.cldm || null,
            ddt_numero: row.ddt_numero || null,
            ddt_data: row.ddt_data || null,
            num_colli: row.num_colli ?? null,
            bda_autorizzazione: row.bda_autorizzazione || null,
            richiedente_nome: csNome,
            richiedente_ruolo: csRuolo,
            approvatore_nome: csNome,
            approvatore_ruolo: csRuolo,
          }).catch((err) => logger.error(`Webhook fallito per ${uuid} (CS auto-chiuso): ${err.message}`));

          // Email di autorizzazione (testo + HTML) — stesso trigger del CS PUT
          // 2° livello. Fire-and-forget. Usa la riga completa appena creata.
          sendResoAutorizzazioneEmail(row).catch((err) =>
            logger.error(`Email autorizzazione fallita per ${uuid} (CS auto-chiuso): ${err.message}`)
          );
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

  const { numero_ordine, bda, motivo_reso, motivo_altro, note, prodotti,
          cldm, ddt_numero, ddt_data, num_colli,
          linee, corriere, corriere_nome,
          pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione } = parsed.data;
  const bdaHash = bda ? sha256(bda) : null;
  const bdaAutorizzazione = parsed.data.bda_autorizzazione || bda || null;

  // F10/F12: se cldm presente e in anagrafica, pv_* derivano dal lookup
  // (autorevole). Se cldm presente ma NON in anagrafica (PV manuale fallback)
  // usiamo i pv_* dal body senza 400are: il PUT puo' aggiornare un reso il cui
  // cldm non e' in anagrafica, e resp_* restano NULL. Se cldm assente, i pv_*
  // del body (eventualmente undefined/null) restano invariati.
  // Nota: i PUT di resi pre-F9 (senza cldm/linee/corriere) non sono supportati
  // dal form nuovo (ResoForm manda sempre cldm+linee+corriere) — limitazione
  // accettata da F9.
  let pvNome = pv_nome || null, pvIndirizzo = pv_indirizzo || null, pvCitta = pv_citta || null,
      pvCap = pv_cap || null, pvProvincia = pv_provincia || null, pvRegione = pv_regione || null;
  // F11: resp_* seguono lo stesso pattern di pv_* (default null, valorizzati
  // dal lookup del PV quando cldm presente). Base per il filtro venditore.
  let respCodice = null, respNome = null;
  // 2026-09-28 P3: gruppo clit stesso pattern (default null, dal lookup).
  let pvClitCodice = null, pvClitNome = null;
  if (cldm) {
    const pv = lookupPvByCldm(cldm);
    if (pv) {
      pvNome = pv.nome || pvNome;
      pvIndirizzo = pv.indirizzo || pvIndirizzo;
      pvCitta = pv.citta || pvCitta;
      pvCap = pv.cap || pvCap;
      pvProvincia = pv.provincia || pvProvincia;
      pvRegione = pv.regione || pvRegione;
      respCodice = pv.resp_codice || null;
      respNome = pv.resp_nome || null;
      pvClitCodice = pv.clit_codice || null;
      pvClitNome = pv.clit_nome || null;
    }
    // PV manuale fallback: pv_* dal body (già impostati sopra), resp_*/pv_clit_*=null.
  }

  try {
    db.prepare(
      `UPDATE richieste_reso SET
       numero_ordine_esterno = ?, bda_hash = ?, motivo_reso = ?, motivo_altro = ?, note = ?, prodotti = ?, updated_at = datetime('now'),
       cldm = ?, ddt_numero = ?, ddt_data = ?, num_colli = ?, bda_autorizzazione = ?,
       linee = ?, corriere = ?, corriere_nome = ?,
       pv_nome = ?, pv_indirizzo = ?, pv_citta = ?, pv_cap = ?, pv_provincia = ?, pv_regione = ?,
       resp_codice = ?, resp_nome = ?,
       pv_clit_codice = ?, pv_clit_nome = ?
       WHERE uuid = ?`
    ).run(
      // numero_ordine_esterno NOT NULL su DB esistenti: '' invece di undefined.
      numero_ordine || '',
      bdaHash,
      motivo_reso,
      motivo_altro || null,
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
      pvNome,
      pvIndirizzo,
      pvCitta,
      pvCap,
      pvProvincia,
      pvRegione,
      respCodice,
      respNome,
      pvClitCodice,
      pvClitNome,
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
