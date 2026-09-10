import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import { randomBytes } from 'crypto';

// 1. CSP strict — in dev permette inline scripts per Next.js HMR
// NOTA: allineato a server.js (dev = NODE_ENV !== 'production'): con NODE_ENV
// non impostato (es. `node server.js`) si è in dev, non prod. Prima qui si usava
// === 'development' e undefined veniva trattato come prod, attivando
// upgrade-insecure-requests + HSTS che su HTTP LAN rompevano il login da mobile.
const isDev = process.env.NODE_ENV !== 'production';
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

// upgrade-insecure-requests è un DEFAULT di helmet (forza HTTPS). In prod va
// tenuto; in dev viene rimosso dal middleware di cleanup sotto (v. fine file),
// perché sui test LAN in HTTP il browser altrimenti converte le fetch API in
// https (nessun TLS su :3002) e il login da mobile fallisce.
if (!isDev) {
  cspConfig.directives.upgradeInsecureRequests = [];
}

// 2. CORS — in dev accetta qualsiasi origine (tunnel mobile), in prod solo il dominio configurato
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : [];

const corsOptions = {
  origin: isDev
    ? true  // Accetta qualsiasi origine in development
    : (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('CORS origin not allowed: ' + origin));
        }
      },
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
  skip: (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip),
});

// 4. Rate limit auth (anti brute-force)
const authLimiter = rateLimit({
  windowMs: 900000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 5,
  // Conta solo i veri fallimenti auth (401 credenziali errate, 403, 423, 5xx).
  // Un 400 (es. CSRF invalido) NON deve incrementare il contatore, altrimenti
  // un loop frontend con CSRF non valido auto-blocca l'IP dopo N tentativi
  // mascherando il bug come "account bloccato".
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode <= 400,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Troppi tentativi di accesso. Account temporaneamente bloccato.' },
});

// 5. CSRF token per form (generato lato server)
export function generateCsrfToken() {
  return randomBytes(32).toString('hex');
}

export function setupSecurityMiddleware(app) {
  // helmet() di default attiva HSTS (maxAge 180gg): in dev su HTTP va disattivato
  // (false), in prod si configura esplicitamente. Così si evita anche la riga
  // helmet.hsts() separata.
  app.use(helmet({
    contentSecurityPolicy: cspConfig,
    hsts: isDev ? false : { maxAge: 31536000, includeSubDomains: true, preload: true },
  }));
  app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));
  // COEP require-corp in dev HTTP LAN blocca risorse cross-origin (es. font
  // Google) e aggiunge rumore/errori JS mobile. In dev usiamo unsafe-none
  // (stesso pattern di HSTS/upgrade-insecure-requests); in prod require-corp.
  app.use(helmet.crossOriginEmbedderPolicy({ policy: isDev ? 'unsafe-none' : 'require-corp' }));
  app.use(helmet.crossOriginOpenerPolicy({ policy: 'same-origin' }));
  app.use(helmet.crossOriginResourcePolicy({ policy: 'same-origin' }));
  app.use(helmet.dnsPrefetchControl({ allow: false }));
  app.use(helmet.permittedCrossDomainPolicies({ permittedPolicies: 'none' }));
  app.use(helmet.hidePoweredBy());

  app.use(cors(corsOptions));
  app.use(hpp());

  // DEV (HTTP LAN, niente TLS): rimuove gli header che forzano HTTPS, altrimenti
  // il browser mobile converte le fetch API in https e il login fallisce.
  // Va dopo helmet/cors così leggi i header già impostati e li pulisci.
  if (isDev) {
    app.use((req, res, next) => {
      res.removeHeader('Strict-Transport-Security');
      const csp = res.getHeader('Content-Security-Policy');
      if (csp) {
        res.setHeader(
          'Content-Security-Policy',
          String(csp).replace(/;?\s*upgrade-insecure-requests/g, '').trim()
        );
      }
      next();
    });
  }

  app.use('/api/', globalLimiter);
  app.use('/api/auth/login', authLimiter);
}
