import { Router } from 'express';
import db from '../lib/db.js';
import logger from '../lib/logger.js';
import {
  hashPassword,
  verifyPassword,
  generateTokenPair,
  sha256,
  generateCsrfToken,
} from '../lib/security.js';
import { generateFingerprint } from '../security/fingerprint.js';
import { authenticate } from '../middleware/authenticate.js';
import { loginSchema } from './validation.js';

const router = Router();
const PEPPER = process.env.PASSWORD_PEPPER || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';

// In-memory CSRF store (production: use Redis or encrypted cookie)
const csrfStore = new Map();

function cleanExpiredCsrf() {
  const now = Date.now();
  for (const [token, exp] of csrfStore) {
    if (exp < now) csrfStore.delete(token);
  }
}

function isLocked(user) {
  if (!user.locked_until) return false;
  return new Date(user.locked_until) > new Date();
}

function computeLockout(attempts) {
  if (attempts >= 15) return 24 * 60 * 60 * 1000;
  if (attempts >= 10) return 60 * 60 * 1000;
  if (attempts >= 5) return 15 * 60 * 1000;
  return 0;
}

function logAudit(userId, azione, dettaglio, req) {
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, azione, dettaglio, ip_address, user_agent_hash)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      userId || null,
      azione,
      dettaglio ? JSON.stringify(dettaglio) : null,
      req.ip || req.connection.remoteAddress || null,
      sha256(req.headers['user-agent'] || '')
    );
  } catch (err) {
    logger.error(`Audit log error: ${err.message}`);
  }
}

// GET /api/auth/csrf-token
router.get('/csrf-token', (req, res) => {
  cleanExpiredCsrf();
  const token = generateCsrfToken();
  csrfStore.set(token, Date.now() + 3600000); // 1h
  res.json({ csrf_token: token });
});

// GET /api/auth/audit — storico delle PROPRIE azioni (audit_log dell'utente
// corrente). Disponibile per TUTTI i ruoli (store_account, venditore,
// customer_service) così ognuno vede la cronologia di ciò che ha fatto
// (login, resi creati, approvati, rifiutati, annullati). L'admin vede tutto
// (inclusi gli altri utenti) via /api/admin/audit-log.
router.get('/audit', authenticate, (req, res) => {
  const { page = '1', per_page = '25' } = req.query;
  const limit = Math.min(parseInt(per_page) || 25, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as total FROM audit_log WHERE user_id = ?').get(req.user.id).total;
  const data = db.prepare(
    `SELECT a.*, u.email as user_email
     FROM audit_log a
     LEFT JOIN users u ON a.user_id = u.id
     WHERE a.user_id = ?
     ORDER BY a.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(req.user.id, limit, offset);

  res.json({ data, total, page: Math.max(parseInt(page) || 1, 1), per_page: limit });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dati non validi', issues: parsed.error.issues });
  }

  const { email, password } = parsed.data;
  const csrf_token = req.body?.csrf_token;

  if (!csrf_token || !csrfStore.has(csrf_token)) {
    return res.status(403).json({ error: 'Token CSRF non valido' });
  }
  csrfStore.delete(csrf_token);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user) {
    // Timing-safe: compute a dummy hash to avoid timing attacks
    hashPassword('dummy', PEPPER);
    return res.status(401).json({ error: 'Credenziali non valide' });
  }

  if (isLocked(user)) {
    logAudit(user.id, 'LOGIN_LOCKED', { email }, req);
    return res.status(423).json({ error: 'Account temporaneamente bloccato. Riprova più tardi.' });
  }

  if (!user.attivo) {
    return res.status(403).json({ error: 'Account disattivato' });
  }

  const valid = verifyPassword(password, user.password_hash, PEPPER);

  if (!valid) {
    const newAttempts = (user.failed_login_attempts || 0) + 1;
    const lockMs = computeLockout(newAttempts);
    const lockedUntil = lockMs > 0 ? new Date(Date.now() + lockMs).toISOString() : null;

    db.prepare(
      `UPDATE users SET failed_login_attempts = ?, locked_until = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(newAttempts, lockedUntil, user.id);

    logAudit(user.id, 'LOGIN_FAILED', { email, attempts: newAttempts, locked: !!lockedUntil }, req);

    if (lockedUntil) {
      logger.warn(`Account locked: ${email} after ${newAttempts} attempts`);
    }

    return res.status(401).json({ error: 'Credenziali non valide' });
  }

  // Success
  db.prepare(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_ip = ?, last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(req.ip || req.connection.remoteAddress || null, user.id);

  const fingerprint = generateFingerprint(req);
  const { accessToken, refreshTokenRaw, refreshTokenHash } = generateTokenPair(user, fingerprint);

  db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_fingerprint, ip_address, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', '+7 days'))`
  ).run(user.id, refreshTokenHash, fingerprint, req.ip || req.connection.remoteAddress || null);

  logAudit(user.id, 'LOGIN_SUCCESS', { email }, req);

  res.cookie('refresh_token', refreshTokenRaw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });

  res.json({
    access_token: accessToken,
    user: {
      id: user.id,
      email: user.email,
      ruolo: user.ruolo,
      nome: user.nome,
    },
  });
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  const refreshToken = req.cookies?.refresh_token;
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token mancante' });
  }

  const tokenHash = sha256(refreshToken);
  const record = db.prepare(
    `SELECT rt.*, u.* FROM refresh_tokens rt
     JOIN users u ON rt.user_id = u.id
     WHERE rt.token_hash = ? AND rt.revoked = 0`
  ).get(tokenHash);

  if (!record || new Date(record.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Refresh token non valido o scaduto' });
  }

  const fingerprint = generateFingerprint(req);
  if (record.device_fingerprint && record.device_fingerprint !== fingerprint) {
    logger.warn(`Refresh fingerprint mismatch for user ${record.user_id}`);
    return res.status(403).json({ error: 'Dispositivo non riconosciuto' });
  }

  // Revoca vecchio token
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(tokenHash);

  // Genera nuovo token pair
  const user = {
    id: record.user_id,
    email: record.email,
    ruolo: record.ruolo,
  };
  const newPair = generateTokenPair(user, fingerprint);

  db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_fingerprint, ip_address, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', '+7 days'))`
  ).run(user.id, newPair.refreshTokenHash, fingerprint, req.ip || req.connection.remoteAddress || null);

  res.cookie('refresh_token', newPair.refreshTokenRaw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });

  res.json({ access_token: newPair.accessToken });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const refreshToken = req.cookies?.refresh_token;
  if (refreshToken) {
    const tokenHash = sha256(refreshToken);
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(tokenHash);
  }

  res.clearCookie('refresh_token', { path: '/', httpOnly: true, sameSite: 'Strict' });
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, email, ruolo, nome, azienda FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'Utente non trovato' });
  }
  res.json({ user });
});

export default router;
