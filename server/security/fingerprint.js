import { createHash, timingSafeEqual } from 'crypto';

export function generateFingerprint(req) {
  const ua = req.headers['user-agent'] || '';
  const al = req.headers['accept-language'] || '';
  const secUa = req.headers['sec-ch-ua'] || '';
  const secPlatform = req.headers['sec-ch-ua-platform'] || '';
  const data = `${ua}|${al}|${secUa}|${secPlatform}`;
  return createHash('sha256').update(data).digest('hex');
}

export function verifyFingerprint(req, stored) {
  if (!stored) return false;
  const current = generateFingerprint(req);
  if (current.length !== stored.length) return false;
  try {
    return timingSafeEqual(Buffer.from(current), Buffer.from(stored));
  } catch {
    return current === stored;
  }
}
