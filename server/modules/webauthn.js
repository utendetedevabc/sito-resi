import { Router } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import db from '../lib/db.js';
import logger from '../lib/logger.js';
import { generateTokenPair } from '../lib/security.js';
import { generateFingerprint } from '../security/fingerprint.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Resi';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3002';

// POST /api/auth/webauthn/register-begin
router.post('/register-begin', authenticate, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Non autenticato' });

    const existing = db
      .prepare('SELECT credential_id FROM webauthn_credentials WHERE user_id = ?')
      .all(user.id)
      .map((r) => r.credential_id);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: new Uint8Array(Buffer.from(String(user.id), 'utf-8')),
      userName: user.email,
      userDisplayName: user.nome,
      attestationType: 'none',
      excludeCredentials: existing.map((id) => ({
        id,
        type: 'public-key',
      })),
      authenticatorSelection: {
        residentKey: 'discouraged',
        userVerification: 'preferred',
      },
    });

    // Store challenge in session/cookie (simplified: use CSRF token approach or in-memory)
    res.cookie('webauthn_challenge', options.challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 5 * 60 * 1000,
    });

    res.json(options);
  } catch (err) {
    logger.error(`WebAuthn register begin error: ${err.message}`);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /api/auth/webauthn/register-finish
router.post('/register-finish', authenticate, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Non autenticato' });

    const challenge = req.cookies?.webauthn_challenge;
    if (!challenge) return res.status(400).json({ error: 'Challenge mancante' });

    const { id, rawId, response, type } = req.body;
    if (type !== 'public-key') return res.status(400).json({ error: 'Tipo non valido' });

    const verification = await verifyRegistrationResponse({
      response: { id, rawId, response, type },
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Verifica fallita' });
    }

    const { credential } = verification.registrationInfo;

    db.prepare(
      `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      user.id,
      Buffer.from(credential.id).toString('base64url'),
      Buffer.from(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports || [])
    );

    res.clearCookie('webauthn_challenge', { path: '/' });
    res.json({ success: true });
  } catch (err) {
    logger.error(`WebAuthn register finish error: ${err.message}`);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /api/auth/webauthn/login-begin
router.post('/login-begin', async (req, res) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: [],
      userVerification: 'preferred',
    });

    res.cookie('webauthn_challenge', options.challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 5 * 60 * 1000,
    });

    res.json(options);
  } catch (err) {
    logger.error(`WebAuthn login begin error: ${err.message}`);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// POST /api/auth/webauthn/login-finish
router.post('/login-finish', async (req, res) => {
  try {
    const challenge = req.cookies?.webauthn_challenge;
    if (!challenge) return res.status(400).json({ error: 'Challenge mancante' });

    const { id, rawId, response, type } = req.body;
    if (type !== 'public-key') return res.status(400).json({ error: 'Tipo non valido' });

    const credentialId = id;
    const credRow = db
      .prepare('SELECT * FROM webauthn_credentials WHERE credential_id = ?')
      .get(credentialId);

    if (!credRow) return res.status(400).json({ error: 'Credenziale non trovata' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(credRow.user_id);
    if (!user || !user.attivo) return res.status(403).json({ error: 'Account non valido' });

    const verification = await verifyAuthenticationResponse({
      response: { id, rawId, response, type },
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: credentialId,
        publicKey: Buffer.from(credRow.public_key),
        counter: credRow.counter,
        transports: JSON.parse(credRow.transports || '[]'),
      },
    });

    if (!verification.verified) {
      return res.status(400).json({ error: 'Verifica fallita' });
    }

    // Update counter
    db.prepare('UPDATE webauthn_credentials SET counter = ? WHERE id = ?').run(
      verification.authenticationInfo.newCounter,
      credRow.id
    );

    const fingerprint = generateFingerprint(req);
    const { accessToken, refreshTokenRaw, refreshTokenHash } = generateTokenPair(user, fingerprint);

    db.prepare(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_fingerprint, ip_address, expires_at)
       VALUES (?, ?, ?, ?, datetime('now', '+7 days'))`
    ).run(user.id, refreshTokenHash, fingerprint, req.ip || req.connection.remoteAddress || null);

    res.cookie('refresh_token', refreshTokenRaw, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.clearCookie('webauthn_challenge', { path: '/' });
    res.json({ access_token: accessToken });
  } catch (err) {
    logger.error(`WebAuthn login finish error: ${err.message}`);
    res.status(500).json({ error: 'Errore interno' });
  }
});

export default router;
