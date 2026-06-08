import { timingSafeEqual } from 'crypto';
import { verifyAccessToken } from '../lib/security.js';
import { generateFingerprint } from '../security/fingerprint.js';
import logger from '../lib/logger.js';

export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token non valido o scaduto' });
  }

  const token = authHeader.slice(7);
  const decoded = verifyAccessToken(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Token non valido o scaduto' });
  }

  // Verify device fingerprint
  const clientFingerprint = req.headers['x-device-fingerprint'] || '';
  if (decoded.fingerprint && decoded.fingerprint.length === clientFingerprint.length) {
    try {
      const match = timingSafeEqual(Buffer.from(decoded.fingerprint), Buffer.from(clientFingerprint));
      if (!match) {
        logger.warn(`Fingerprint mismatch for user ${decoded.id}`);
        return res.status(403).json({ error: 'Dispositivo non riconosciuto' });
      }
    } catch {
      if (decoded.fingerprint !== clientFingerprint) {
        logger.warn(`Fingerprint mismatch for user ${decoded.id}`);
        return res.status(403).json({ error: 'Dispositivo non riconosciuto' });
      }
    }
  }

  req.user = {
    id: decoded.id,
    email: decoded.email,
    ruolo: decoded.ruolo,
    fingerprint: decoded.fingerprint,
  };

  next();
}
