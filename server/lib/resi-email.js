// server/lib/resi-email.js — Email di autorizzazione al reso (testo + PDF)
//
// Sistema SMTP copiato da ABC HUB (src/modules/email-sender.js): transporter
// nodemailer pooled con verify/cache, testMode che redirige tutto a un indirizzo
// di test, env lette dinamicamente cosi' resetTransporter() rilegge la config.
// Qui in piu' c'e' la generazione del PDF (pdfkit) e il template italiano della
// "Autorizzazione al reso" (spec 2026-09-09-gestione-resi-cs-avanzata-design.md,
// riga Sup/Aut rimossa per scelta utente).
//
// L'email parte dal sito-resi (NON da ABC HUB): il trigger e' nel codice che
// approva il reso (customer-service.js PUT 2° livello + resi.js auto-chiuso CS).
// Fire-and-forget: non deve bloccare la risposta HTTP.

import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import logger from './logger.js';

// --- Config SMTP (letta dinamicamente, come in ABC HUB) ---
function getSmtpHost() { return process.env.SMTP_HOST || ''; }
function getSmtpPort() { return parseInt(process.env.SMTP_PORT || '587', 10); }
function getSmtpSecure() { return process.env.SMTP_SECURE === 'true'; }
function getSmtpUser() { return process.env.SMTP_USER || ''; }
function getSmtpPass() { return process.env.SMTP_PASS || ''; }
function getSmtpFrom() { return process.env.SMTP_FROM || getSmtpUser(); }

let transporter = null;
let lastVerifyOk = false;
let lastVerifyTime = 0;

// In modalita' test tutte le email vanno a questo indirizzo (come ABC HUB).
const TEST_OVERRIDE_EMAIL = 'abc.test.dev.ambient@gmail.com';

let testMode = process.env.EMAIL_TEST_MODE !== 'false';
export function isTestMode() { return testMode; }
export function setTestMode(v) { testMode = !!v; }

export function resetTransporter() {
  if (transporter) {
    try { transporter.close(); } catch {}
  }
  transporter = null;
  lastVerifyOk = false;
  lastVerifyTime = 0;
}

export function getTransporter() {
  if (transporter) return transporter;
  const host = getSmtpHost();
  const user = getSmtpUser();
  if (!host || !user) return null;

  transporter = nodemailer.createTransport({
    host,
    port: getSmtpPort(),
    secure: getSmtpSecure(),
    auth: { user, pass: getSmtpPass() },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    rateLimit: 5,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });

  transporter.on('error', (err) => {
    logger.error(`[RESI-EMAIL] Transport error: ${err.message}`);
  });

  return transporter;
}

export async function isSmtpReady() {
  const now = Date.now();
  if (now - lastVerifyTime < 5 * 60 * 1000 && lastVerifyOk) return true;
  try {
    const t = getTransporter();
    if (!t) return false;
    await t.verify();
    lastVerifyOk = true;
    lastVerifyTime = now;
    return true;
  } catch (err) {
    lastVerifyOk = false;
    lastVerifyTime = now;
    if (transporter) {
      try { transporter.close(); } catch {}
      transporter = null;
    }
    logger.error(`[RESI-EMAIL] SMTP non pronto: ${err.message}`);
    return false;
  }
}

export function isConfigured() {
  return !!(getSmtpHost() && getSmtpUser());
}

// --- Destinatari ---
// Default: le due destinatarie fisse. Override via env RESO_AUTORIZZAZIONE_TO
// (lista separata da virgole). In testMode tutto va a TEST_OVERRIDE_EMAIL.
const DEFAULT_TO = [
  'francesca.cacciavillani@abcosmetique.it',
  'raffaella.leardi@abcosmetique.it',
];
function getRecipients() {
  const env = process.env.RESO_AUTORIZZAZIONE_TO;
  if (env && env.trim()) {
    return env.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_TO;
}

// --- Etichette / helper template ---
const MOTIVO_RESO_LABEL = {
  difettoso: 'difettoso',
  errato: 'errato',
  non_conforme: 'non conforme',
  altro: 'ALTRO',
};

// linee puo' arrivare come stringa JSON (riga DB) o come array gia' parsato.
function parseLinee(linee) {
  if (!linee) return [];
  if (Array.isArray(linee)) return linee;
  try {
    const v = JSON.parse(linee);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function placeholder(v) {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

// Frase "delle linee X, Y per circa N pezzi" (fallback "dei prodotti" se zero).
function fraseLinee(linee) {
  const arr = parseLinee(linee);
  if (arr.length > 0) {
    const nomi = arr.map((l) => l.nome || '').filter(Boolean).join(', ');
    const totale = arr.reduce((s, l) => s + (Number(l.numero_pezzi) || 0), 0);
    if (nomi) return `delle linee ${nomi} per circa ${totale} pezzi`;
  }
  return 'dei prodotti';
}

function fraseMotivo(motivoReso, note) {
  const label = MOTIVO_RESO_LABEL[motivoReso] || (motivoReso ? String(motivoReso) : '—');
  const n = note ? String(note).trim() : '';
  return n ? `${label} - ${n}` : label;
}

// --- Costruzione testo (corpo unico, usato sia per text/plain sia per PDF) ---
export function buildResoAutorizzazioneText(richiesta) {
  const numReso = placeholder(richiesta.num_reso);
  const cldmPad10 = richiesta.cldm
    ? String(richiesta.cldm).padStart(10, '0')
    : '—';
  const pvNome = placeholder(richiesta.pv_nome);
  const pvIndirizzo = placeholder(richiesta.pv_indirizzo);
  const pvCitta = placeholder(richiesta.pv_citta);
  const pvCap = placeholder(richiesta.pv_cap);
  const pvProvincia = placeholder(richiesta.pv_provincia);
  const ddtNumero = placeholder(richiesta.ddt_numero);
  const ddtData = placeholder(richiesta.ddt_data);
  const numColli = placeholder(richiesta.num_colli);
  const lineeFrase = fraseLinee(richiesta.linee);
  const motivoFrase = fraseMotivo(richiesta.motivo_reso, richiesta.note);

  return [
    `Autorizzazione al reso n. ${numReso} merce da ritirare in nome e per conto di ABC Italia`,
    '',
    `Con la presente vi preghiamo recarvi presso il nostro cliente: (Codice Interno ${cldmPad10})`,
    pvNome,
    pvIndirizzo,
    `${pvCitta} ${pvCap} - ${pvProvincia}`,
    'e provvedere al ritiro e alla successiva consegna al nostro magazzino sito in Via Industria s/n, Pozzolo Formigaro (AL)',
    '',
    `delle merci che saranno accompagnate dalla bolla di accompagnamento n. ${ddtNumero} del ${ddtData}`,
    `La spedizione sara' composta da n. ${numColli} colli; ${lineeFrase}.`,
    '',
    `Motivo reso ${motivoFrase}`,
    '',
    "La presente autorizzazione dovra' essere allegata alla bolla di accompagnamento al momento del reso presso il nostro magazzino.",
    '',
    'Cordiali Saluti',
    'ABC Italia',
  ].join('\n');
}

// --- PDF (pdfkit, A4) ---
// Restituisce un Buffer. Stesso testo del corpo, con header in alto.
export function buildResoAutorizzazionePdf(richiesta) {
  return new Promise((resolve, reject) => {
    try {
      const numReso = placeholder(richiesta.num_reso);
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // Header
      doc.font('Helvetica-Bold').fontSize(13)
        .text(`ABC Italia — Autorizzazione al reso n. ${numReso}`, { align: 'left' });
      doc.moveDown(1.5);

      // Corpo
      doc.font('Helvetica').fontSize(11);
      const corpo = buildResoAutorizzazioneText(richiesta);
      // riga vuota come paragrafo: pdfkit gestisce '\n' dentro .text con lineBreak
      doc.text(corpo, { lineGap: 2 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// --- Invio email (testo + PDF allegato) ---
// richiesta: riga di richieste_reso (con num_reso, cldm, pv_*, ddt_*, num_colli,
// linee [JSON], motivo_reso, note). Fire-and-forget per il caller.
//
// Disattivabile via env RESI_AUTORIZZAZIONE_EMAIL_ON=0 (default: attivo quando
// SMTP e' configurato). Se SMTP non configurato → skip silente (non blocca).
export async function sendResoAutorizzazioneEmail(richiesta) {
  if (process.env.RESI_AUTORIZZAZIONE_EMAIL_ON === '0') {
    return { ok: false, skipped: true, reason: 'disabled_by_env' };
  }
  if (!isConfigured()) {
    logger.info('[RESI-EMAIL] SMTP non configurato, skip email autorizzazione');
    return { ok: false, skipped: true, reason: 'smtp_not_configured' };
  }
  const ready = await isSmtpReady();
  if (!ready) {
    return { ok: false, skipped: true, reason: 'smtp_not_ready' };
  }
  const transport = getTransporter();
  if (!transport) {
    return { ok: false, skipped: true, reason: 'transporter_not_available' };
  }

  const numReso = placeholder(richiesta.num_reso);
  const pvNome = placeholder(richiesta.pv_nome);
  const subject = `Autorizzazione al reso n. ${numReso} — ${pvNome}`;
  const text = buildResoAutorizzazioneText(richiesta);

  let pdfBuf;
  try {
    pdfBuf = await buildResoAutorizzazionePdf(richiesta);
  } catch (err) {
    logger.error(`[RESI-EMAIL] Generazione PDF fallita reso n. ${numReso}: ${err.message}`);
    // Procedi comunque senza allegato? No: l'utente vuole testo + PDF.
    // Se il PDF fallisce, non inviare un'email incompleta: segnala e torna.
    return { ok: false, error: `pdf_failed: ${err.message}` };
  }

  const recipients = getRecipients();
  const toAddr = testMode ? TEST_OVERRIDE_EMAIL : recipients.join(', ');
  const filename = `Autorizzazione_reso_${numReso}.pdf`;

  const mailOpts = {
    from: getSmtpFrom(),
    to: toAddr,
    subject: testMode ? `[TEST → ${recipients.join(', ')}] ${subject}` : subject,
    text,
    attachments: [
      { filename, content: pdfBuf, contentType: 'application/pdf' },
    ],
  };

  try {
    const info = await transport.sendMail(mailOpts);
    if (testMode) {
      logger.info(`[RESI-EMAIL] Autorizzazione reso n. ${numReso} inviata a ${TEST_OVERRIDE_EMAIL} (originale: ${recipients.join(', ')}) — ${info.messageId}`);
    } else {
      logger.info(`[RESI-EMAIL] Autorizzazione reso n. ${numReso} inviata a ${recipients.join(', ')} — ${info.messageId}`);
    }
    return { ok: true, messageId: info.messageId, pdfAttached: true };
  } catch (err) {
    logger.error(`[RESI-EMAIL] Invio email autorizzazione reso n. ${numReso} fallito: ${err.message}`);
    return { ok: false, error: err.message };
  }
}