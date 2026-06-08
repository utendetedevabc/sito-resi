import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import { randomBytes } from 'crypto';

// 1. CSP strict — in dev permette inline scripts per Next.js HMR
const isDev = process.env.NODE_ENV === 'development';
const cspConfig = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: isDev ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"] : ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "blob:"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    manifestSrc: ["'self'"],
    workerSrc: ["'self'", "blob:"],
  },
};

if (!isDev) {
  cspConfig.directives.upgradeInsecureRequests = [];
}

// 2. CORS — solo il dominio configurato
const corsOptions = {
  origin: process.env.CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Device-Fingerprint'],
  credentials: true,
  maxAge: 600,
};

// 3. Rate limit globale
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppe richieste. Riprova più tardi.' },
  skip: (req) => req.ip === '127.0.0.1',
});

// 4. Rate limit auth (anti brute-force)
const authLimiter = rateLimit({
  windowMs: 900000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppi tentativi di accesso. Account temporaneamente bloccato.' },
});

// 5. CSRF token per form (generato lato server)
export function generateCsrfToken() {
  return randomBytes(32).toString('hex');
}

export function setupSecurityMiddleware(app) {
  app.use(helmet({ contentSecurityPolicy: cspConfig }));
  app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true, preload: true }));
  app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));
  app.use(helmet.crossOriginEmbedderPolicy());
  app.use(helmet.crossOriginOpenerPolicy({ policy: 'same-origin' }));
  app.use(helmet.crossOriginResourcePolicy({ policy: 'same-origin' }));
  app.use(helmet.dnsPrefetchControl({ allow: false }));
  app.use(helmet.permittedCrossDomainPolicies({ permittedPolicies: 'none' }));
  app.use(helmet.hidePoweredBy());

  app.use(cors(corsOptions));
  app.use(hpp());

  app.use('/api/', globalLimiter);
  app.use('/api/auth/login', authLimiter);
}
