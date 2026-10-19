import 'dotenv/config';
import express from 'express';
import next from 'next';
import cookieParser from 'cookie-parser';
import { setupSecurityMiddleware, generateCsrfToken } from './server/security/middleware.js';
import { authenticate } from './server/middleware/authenticate.js';
import authRouter from './server/modules/auth.js';
import resiRouter from './server/modules/resi.js';
import venditoreRouter from './server/modules/venditore.js';
import customerServiceRouter from './server/modules/customer-service.js';
import adminRouter from './server/modules/admin.js';
import anagraficaRouter from './server/modules/anagrafica-api.js';
import upload, { processUpload } from './server/modules/upload.js';
import webauthnRouter from './server/modules/webauthn.js';
import notificationsRouter from './server/modules/notifications.js';
import db, { close } from './server/lib/db.js';
import logger from './server/lib/logger.js';
import { refreshAnagrafica } from './server/lib/anagrafica.js';
import { refreshAgenti } from './server/lib/agenti.js';
import { scheduleDbBackups, stopDbBackupScheduler } from './server/lib/backup.js';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT) || 3002;
const host = process.env.HOST || '0.0.0.0';

const app = next({ dev, turbopack: false, webpack: true });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = express();

  if (process.env.TRUST_PROXY === '1') {
    server.set('trust proxy', 1);
  }

  setupSecurityMiddleware(server);
  server.use(express.json({ limit: '1mb' }));
  server.use(express.urlencoded({ extended: false }));
  server.use(cookieParser());

  // API Routes
  server.use('/api/auth', authRouter);
  server.use('/api/auth/webauthn', webauthnRouter);
  server.use('/api/resi', resiRouter);
  server.use('/api/venditore', venditoreRouter);
  server.use('/api/customer-service', customerServiceRouter);
  server.use('/api/admin', adminRouter);
  server.use('/api/anagrafica', anagraficaRouter);
  server.use('/api/notifications', notificationsRouter);
  server.use('/api/upload', authenticate, upload.single('file'), processUpload, (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file caricato' });
    }
    res.json({ success: true, filename: req.file.filename, sha256: req.file.sha256 });
  });

  // Health check
  server.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Error handler
  server.use((err, req, res, _next) => {
    logger.error(`Unhandled error: ${err.message}`, { stack: err.stack, path: req.path });
    if (res.headersSent) return;
    res.status(err.status || 500).json({ error: dev ? err.message : 'Errore interno del server' });
  });

  // Next.js catch-all
  server.use((req, res) => handle(req, res));

  // Socket activation (systemd): se systemd passa il socket già in ascolto
  // (fd 3, LISTEN_FDS/LISTEN_PID), lo riusiamo direttamente. La porta resta
  // aperta TRA i riavvii: le connessioni mettono in coda invece di essere
  // rifiutate → deploy senza "sito offline". Fallback host:port per avvio
  // manuale (npm run dev / node server.js).
  const systemdSocket = parseInt(process.env.LISTEN_FDS || '0', 10) >= 1
    && parseInt(process.env.LISTEN_PID || '0', 10) === process.pid;
  const httpServer = systemdSocket
    ? server.listen({ fd: 3, backlog: 2048 }, () => {
        logger.info(`Sito Resi in ascolto (socket systemd, porta ${port})`);
      })
    : server.listen(port, host, () => {
        logger.info(`Sito Resi in ascolto su http://${host}:${port}`);
      });

  // F10: scheduler anagrafica — refresh settimanale ogni domenica alle 12:00
  // (locale). Env ANAGRAFICA_AUTO_WEEKLY=1 (default) per abilitare.
  const autoWeekly = process.env.ANAGRAFICA_AUTO_WEEKLY !== '0';
  let anagraficaTimer = null;
  let anagraficaInterval = null;
  function scheduleNextAnagraficaRefresh() {
    if (!autoWeekly) return;
    const now = new Date();
    const next = new Date(now);
    next.setHours(12, 0, 0, 0);
    const dow = next.getDay(); // 0=dom
    let daysUntilSun = (7 - dow) % 7;
    if (daysUntilSun === 0 && now.getTime() >= next.getTime()) daysUntilSun = 7;
    next.setDate(next.getDate() + daysUntilSun);
    const ms = next.getTime() - now.getTime();
    logger.info(`Prossimo refresh anagrafica: ${next.toLocaleString('it-IT')} (tra ${Math.round(ms / 3600000)}h)`);
    clearTimeout(anagraficaTimer);
    clearInterval(anagraficaInterval);
    anagraficaTimer = setTimeout(() => {
      try { refreshAnagrafica(); } catch (e) { logger.error(`Refresh anagrafica schedulato fallito: ${e.message}`); }
      try { refreshAgenti(); } catch (e) { logger.error(`Refresh agenti schedulato fallito: ${e.message}`); }
      // ciclo successivo: 7 giorni
      anagraficaInterval = setInterval(() => {
        try { refreshAnagrafica(); } catch (e) { logger.error(`Refresh anagrafica schedulato fallito: ${e.message}`); }
        try { refreshAgenti(); } catch (e) { logger.error(`Refresh agenti schedulato fallito: ${e.message}`); }
      }, 7 * 24 * 60 * 60 * 1000);
    }, ms);
  }
  scheduleNextAnagraficaRefresh();

  // Backup automatico del DB: snapshot post-avvio + giornaliero (default 03:00),
  // retention 30 giorni. Vedi server/lib/backup.js.
  scheduleDbBackups();

  // Graceful shutdown
  function shutdown(signal) {
    logger.info(`Ricevuto ${signal}, shutdown graceful...`);
    clearTimeout(anagraficaTimer);
    clearInterval(anagraficaInterval);
    stopDbBackupScheduler();
    httpServer.close(() => {
      close();
      logger.info('Server chiuso.');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
});
