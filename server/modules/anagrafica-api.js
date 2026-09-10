// server/modules/anagrafica-api.js — API anagrafica PV (lookup/search per il
// form resi) + refresh forzato (admin). Tutte le rotte richiedono login
// (authenticate); il refresh richiede additionally authorize('admin').
//
// Router montato in server.js su /api/anagrafica (senza authorize a livello di
// mount: il router applica authenticate internamente + authorize per-route).
//
// ATTENZIONE ordine rotte: /status e /refresh sono registrate PRIMA di /:cldm,
// altrimenti il parametro :cldm catturerebbe le stringhe "status" e "refresh".
import { Router } from 'express';
import { lookupPvByCldm, searchPv, anagraficaStatus, refreshAnagrafica } from '../lib/anagrafica.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { logAudit } from '../lib/audit.js';
import logger from '../lib/logger.js';

const router = Router();

// Tutte le rotte di questo router richiedono login.
router.use(authenticate);

// Ricerca per combobox (cldm o nome). Usata dal form resi (Task 8).
router.get('/', (req, res) => {
  const { q = '', limit = 20 } = req.query;
  res.json({ data: searchPv(q, parseInt(limit) || 20) });
});

// Stato anagrafica (count, last_updated, source_exists).
// Registrata PRIMA di /:cldm per evitare cattura del parametro.
router.get('/status', (req, res) => {
  res.json(anagraficaStatus());
});

// Refresh forzato (admin only). Registrata PRIMA di /:cldm per evitare
// cattura del parametro. Path completo: POST /api/anagrafica/refresh.
router.post('/refresh', authorize('admin'), (req, res) => {
  try {
    const stats = refreshAnagrafica();
    logAudit(req.user.id, 'ANAGRAFICA_REFRESH', stats, req);
    logger.info(`Anagrafica refresh forzato da admin ${req.user.id}: ${stats.total} record`);
    res.json({ success: true, ...stats });
  } catch (err) {
    logger.error(`Errore refresh anagrafica: ${err.message}`);
    res.status(500).json({ error: 'Errore refresh anagrafica', detail: err.message });
  }
});

// Dettaglio PV per cldm (usato dal form per auto-compilare + linee).
// Deve restare DOPO /status e /refresh per non catturarle.
router.get('/:cldm', (req, res) => {
  const pv = lookupPvByCldm(req.params.cldm);
  if (!pv) return res.status(404).json({ error: 'CLDM non trovato in anagrafica', found: false });
  res.json({ found: true, pv });
});

export default router;