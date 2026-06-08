import { randomUUID, randomBytes, createHash, createHmac, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';

const PRIVATE_KEY_PATH = process.env.JWT_PRIVATE_KEY_PATH || './keys/jwt-private.pem';
const PUBLIC_KEY_PATH = process.env.JWT_PUBLIC_KEY_PATH || './keys/jwt-public.pem';
const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

function getPrivateKey() {
  return readFileSync(PRIVATE_KEY_PATH, 'utf-8');
}

function getPublicKey() {
  return readFileSync(PUBLIC_KEY_PATH, 'utf-8');
}

export function hashPassword(password, pepper) {
  return bcrypt.hashSync(password + (pepper || ''), 12);
}

export function verifyPassword(password, hash, pepper) {
  return bcrypt.compareSync(password + (pepper || ''), hash);
}

export function generateUUID() {
  return randomUUID();
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function hmacSha256(secret, data) {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function secureCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function generateTokenPair(user, fingerprint) {
  const privateKey = getPrivateKey();
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, ruolo: user.ruolo, fingerprint },
    privateKey,
    { algorithm: 'RS256', expiresIn: ACCESS_EXPIRY }
  );

  const refreshTokenRaw = randomBytes(64).toString('hex');
  const refreshTokenHash = sha256(refreshTokenRaw);

  return { accessToken, refreshTokenRaw, refreshTokenHash };
}

export function verifyAccessToken(token) {
  try {
    const publicKey = getPublicKey();
    return jwt.verify(token, publicKey, { algorithms: ['RS256'] });
  } catch {
    return null;
  }
}

export function generateRandomHex(length = 32) {
  return randomBytes(length).toString('hex');
}

export function generateCsrfToken() {
  return randomBytes(32).toString('hex');
}
