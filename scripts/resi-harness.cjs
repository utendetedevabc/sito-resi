// scripts/resi-harness.cjs — Ricevitore del webhook resi del sito-resi (:3011).
//
// Storia: il primo go-live usava /tmp/resi_harness.cjs, che e' finito nel limbo
// (script e DB cancellati da /tmp mentre il processo teneva i fd aperti) e
// scriveva un RITGIO_*.xls sulla Scrivania per ogni reso approvato. Questa
// versione e' PERMANENTE (nel repo) e non scrive file:
//   - DB   → RESI_DB_PATH = ./data/abc_hub_webhook.db (dentro il progetto,
//            NON in /tmp: sopravvive ai reboot e ai cleanup di systemd)
//   - file → RESI_EXPORT_DIR = '' (il resi-webhook di ABC HUB dalla fix
//            2026-09-22 onora la stringa vuota = scrittura disattivata)
//
// Monta il resi-webhook.js di ABC HUB (verifica HMAC + localhost, persiste in
// resi_in_ingresso). Le sue dipendenze risolvono dal node_modules di ABC HUB;
// express risolve dal node_modules del sito-resi (script dentro scripts/).
//
// Avvio (dalla root del sito-resi):
//   DOTENV_CONFIG_PATH=.env.prod nohup node scripts/resi-harness.cjs \
//     > logs/harness-3011.log 2>&1 & echo $! > .harness-3011.pid
// Il .env.prod fornisce WEBHOOK_SECRET (firma HMAC dei webhook in uscita).
'use strict';

const path = require('path');

// Carica .env.prod (o l'env indicato) PRIMA di richiedere resi-webhook.js,
// che legge RESI_DB_PATH/RESI_EXPORT_DIR/WEBHOOK_SECRET all'import.
require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env.prod' });

// DB dedicato dentro il progetto (default sovrascrivibile via env per test).
process.env.RESI_DB_PATH = process.env.RESI_DB_PATH
  || path.resolve(__dirname, '..', 'data', 'abc_hub_webhook.db');
// Nessun file RITGIO su disco (richiesta operatori 2026-09-22).
process.env.RESI_EXPORT_DIR = '';

const express = require('express');
// Modulo di ABC HUB (path assoluto: il repo ABC HUB non e' un dependency).
const RESI_WEBHOOK_PATH = process.env.RESI_WEBHOOK_PATH
  || '/home/adimn/Scrivania/tracking-abc-italia-main/src/modules/resi-webhook.js';

const resiWebhook = require(RESI_WEBHOOK_PATH);

const PORT = parseInt(process.env.HARNESS_PORT || '3011', 10);
const app = express();
app.use(express.json());
app.use('/api/resi', resiWebhook);

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[resi-harness] In ascolto su http://127.0.0.1:${PORT}/api/resi`);
  console.log(`[resi-harness] DB resi: ${process.env.RESI_DB_PATH}`);
  console.log('[resi-harness] Scrittura file RITGIO su disco: DISATTIVATA (RESI_EXPORT_DIR="")');
});