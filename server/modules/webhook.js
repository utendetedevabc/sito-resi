import { createHmac } from 'crypto';
import db from '../lib/db.js';
import logger from '../lib/logger.js';

const WEBHOOK_URL = process.env.ABC_HUB_WEBHOOK_URL || 'http://127.0.0.1:3001/api/resi';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const MAX_RETRIES = parseInt(process.env.WEBHOOK_RETRY_MAX) || 3;
const RETRY_DELAYS = (process.env.WEBHOOK_RETRY_DELAYS || '5000,30000,300000')
  .split(',').map(n => parseInt(n.trim()));

// Fail-loud: se WEBHOOK_SECRET è vuoto, firma con chiave vuota -> ABC HUB
// rifiuta 401 su ogni tentativo -> retry silenziosi fino al esaurimento.
if (!WEBHOOK_SECRET) {
  logger.error('WEBHOOK_SECRET non configurato — il webhook sarà firmato con chiave vuota e rifiutato da ABC HUB');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendWebhook(richiesta) {
  const payload = {
    id_richiesta: richiesta.id_richiesta,
    numero_ordine: richiesta.numero_ordine,
    bda_hash: richiesta.bda_hash,
    venditore_codice: richiesta.venditore_codice,
    prodotti: richiesta.prodotti,
    linee: richiesta.linee || null,
    corriere: richiesta.corriere || null,
    corriere_nome: richiesta.corriere_nome || null,
    pv_nome: richiesta.pv_nome || null,
    pv_indirizzo: richiesta.pv_indirizzo || null,
    pv_citta: richiesta.pv_citta || null,
    pv_cap: richiesta.pv_cap || null,
    pv_provincia: richiesta.pv_provincia || null,
    pv_regione: richiesta.pv_regione || null,
    num_reso: richiesta.num_reso ?? null,
    motivo_reso: richiesta.motivo_reso,
    note: richiesta.note,
    data_approvazione: richiesta.data_approvazione,
    // Campi per export corriere (RITGIO*.xls) — modello vecchio (backward compat)
    cldm: richiesta.cldm || null,
    ddt_numero: richiesta.ddt_numero || null,
    ddt_data: richiesta.ddt_data || null,
    num_colli: richiesta.num_colli ?? null,
    bda_autorizzazione: richiesta.bda_autorizzazione || null,
    // Audit (opzionali, nullable): chi ha creato il reso (richiedente) e chi lo
    // ha approvato al 1° livello (approvatore). Per CS auto-chiuso coincidono
    // (l'interno è sia richiedente che approvatore). Backward compat: payload
    // precedenti senza questi campi restano validi lato ABC HUB (undefined/null).
    richiedente_nome: richiesta.richiedente_nome ?? null,
    richiedente_ruolo: richiesta.richiedente_ruolo ?? null,
    approvatore_nome: richiesta.approvatore_nome ?? null,
    approvatore_ruolo: richiesta.approvatore_ruolo ?? null,
  };

  const body = JSON.stringify(payload);
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  const headers = {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': signature,
    'X-Webhook-Timestamp': timestamp,
    'User-Agent': 'SitoResi/1.0',
  };

  let lastError = null;
  const richiestaDb = db.prepare('SELECT id FROM richieste_reso WHERE uuid = ?').get(richiesta.id_richiesta);
  const richiestaId = richiestaDb?.id || null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const duration = Date.now() - start;
      const responseBody = await res.text();

      // Log attempt
      db.prepare(
        `INSERT INTO webhook_log (richiesta_id, attempt_number, status_code, response_body, duration_ms)
         VALUES (?, ?, ?, ?, ?)`
      ).run(richiestaId, attempt + 1, res.status, responseBody.substring(0, 2000), duration);

      if (res.ok) {
        if (richiestaId) {
          db.prepare(
            `UPDATE richieste_reso SET webhook_sent = 1, webhook_attempts = ?, webhook_last_attempt = datetime('now'), webhook_response_code = ?
             WHERE id = ?`
          ).run(attempt + 1, res.status, richiestaId);
        }
        logger.info(`Webhook inviato con successo per ${richiesta.id_richiesta} (tentativo ${attempt + 1})`);
        return { success: true };
      }

      lastError = new Error(`HTTP ${res.status}: ${responseBody}`);
      logger.warn(`Webhook tentativo ${attempt + 1} fallito: HTTP ${res.status}`);
    } catch (err) {
      const duration = Date.now() - start;
      db.prepare(
        `INSERT INTO webhook_log (richiesta_id, attempt_number, error_message, duration_ms)
         VALUES (?, ?, ?, ?)`
      ).run(richiestaId, attempt + 1, err.message.substring(0, 500), duration);

      lastError = err;
      logger.warn(`Webhook tentativo ${attempt + 1} fallito: ${err.message}`);
    }

    if (attempt < MAX_RETRIES - 1) {
      const delay = RETRY_DELAYS[attempt] || 5000;
      logger.info(`Webhook retry per ${richiesta.id_richiesta} tra ${delay}ms`);
      await sleep(delay);
    }
  }

  if (richiestaId) {
    db.prepare(
      `UPDATE richieste_reso SET webhook_attempts = ?, webhook_last_attempt = datetime('now')
       WHERE id = ?`
    ).run(MAX_RETRIES, richiestaId);
  }

  logger.error(`Webhook fallito definitivamente per ${richiesta.id_richiesta}`);
  throw lastError || new Error('Webhook fallito dopo tutti i tentativi');
}
