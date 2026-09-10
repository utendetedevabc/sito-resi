import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import { randomBytes } from 'crypto';

// 1. CSP + header HTTPS.
// "Produzione" (NODE_ENV=production) NON implica "deployment HTTPS": il go-live
// attuale è PROD su HTTP interno (LAN :3003, no TLS). Gli header che forzano
// HTTPS sono corretti SOLO su un deployment HTTPS reale; su HTTP interno
// rompono il sito:
//   - upgrade-insecure-requests: il browser upgradea i subresource (CSS/JS) a
//     https → ERR_SSL_PROTOCOL_ERROR → "non carica la grafica" sull'IP LAN.
//   - script-src 'self' (senza nonce): blocca gli script inline di bootstrap di
//     Next.js → niente idratazione → "Caricamento…" infinito (cerchiamento).
//   - HSTS: ignorato su HTTP (spec), ma ininfluente; tenuto solo su HTTPS.
//   - COEP require-corp: blocca risorse cross-origin (font Google) su HTTP.
// HTTPS_DEPLOYMENT=true attiva gli header strict (per un futuro deploy HTTPS).
// Sul go-live HTTP interno NON si imposta (default false) → path rilassato.
const isDev = process.env.NODE_ENV !== 'production';
const isHttps = process.env.HTTPS_DEPLOYMENT === 'true';
const cspConfig = {
  directives: {
    defaultSrc: ["'self'"],
    // script inline di bootstrap di Next.js: servono 'unsafe-inline' (i nonce
    // non sono implementati). 'unsafe-eval' solo in dev (HMR/source map).
    scriptSrc: isHttps
      ? ["'self'", "'unsafe-inline'"]
      : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    // style-src include i font CSS Google (preload in layout); su HTTP serve
    // per non bloccare il stylesheet esterno.
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    imgSrc: ["'self'", "data:", "blob:"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    manifestSrc: ["'self'"],
    workerSrc: ["'self'", "blob:"],
  },
};

// upgrade-insecure-requests ha senso SOLO su HTTPS (forza i subresource http
// residui a https). Su HTTP interno va OMESSO, altrimenti il browser converte
// CSS/JS in https e il sito non carica la grafica.
if (isHttps) {
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
  // helmet() di default attiva HSTS (maxAge 180gg): su HTTP va disattivato
  // (false), su HTTPS si configura esplicitamente. Così si evita anche la riga
  // helmet.hsts() separata. Gate su isHttps, non isDev: il go-live è PROD su
  // HTTP, e HSTS non va inviato.
  app.use(helmet({
    contentSecurityPolicy: cspConfig,
    hsts: isHttps ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  }));
  app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));
  // COEP require-corp blocca risorse cross-origin (es. font Google) su HTTP
  // interno. Path rilassato (unsafe-none) quando NON è un deployment HTTPS.
  app.use(helmet.crossOriginEmbedderPolicy({ policy: isHttps ? 'require-corp' : 'unsafe-none' }));
  // COOP same-origin su HTTPS; su HTTP non-trustworthy il browser lo ignora
  // comunque (warning console). 'unsafe-none' su HTTP evita il warning.
  app.use(helmet.crossOriginOpenerPolicy({ policy: isHttps ? 'same-origin' : 'unsafe-none' }));
  app.use(helmet.crossOriginResourcePolicy({ policy: 'same-origin' }));
  app.use(helmet.dnsPrefetchControl({ allow: false }));
  app.use(helmet.permittedCrossDomainPolicies({ permittedPolicies: 'none' }));
  app.use(helmet.hidePoweredBy());

  app.use(cors(corsOptions));
  app.use(hpp());

  // HTTP interno (no TLS, dev ORE prod-LAN): rimuove gli header che forzano
  // HTTPS, altrimenti il browser converte le fetch API / subresource in https
  // e il sito non carica. Cintura + bretelle: anche se cspConfig non aggiunge
  // upgrade-insecure-requests quando !isHttps, helmet potrebbe iniettarlo.
  // Va dopo helmet/cors così leggi i header già impostati e li pulisci.
  if (!isHttps) {
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
