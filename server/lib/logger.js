import winston from 'winston';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const LOG_PATH = process.env.LOG_PATH || './logs';

if (!existsSync(LOG_PATH)) {
  mkdirSync(LOG_PATH, { recursive: true });
}

const PII_PATTERNS = [
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replace: '[EMAIL]' },
  { pattern: /\b\d{10,15}\b/g, replace: '[BDA]' },
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, replace: '[PHONE]' },
  { pattern: /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g, replace: '[CODICE_FISCALE]' },
  { pattern: /\b\d{11}\b/g, replace: '[PIVA]' },
];

function redactPII(message) {
  if (typeof message !== 'string') return message;
  let cleaned = message;
  for (const { pattern, replace } of PII_PATTERNS) {
    cleaned = cleaned.replace(pattern, replace);
  }
  return cleaned;
}

const piiRedactFormat = winston.format((info) => {
  info.message = redactPII(info.message);
  if (info[Symbol.for('splat')]) {
    info[Symbol.for('splat')] = info[Symbol.for('splat')].map(arg =>
      typeof arg === 'string' ? redactPII(arg) : arg
    );
  }
  return info;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    piiRedactFormat(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.File({
      filename: join(LOG_PATH, 'error.log'),
      level: 'error',
      maxsize: 10485760,  // 10 MB
      maxFiles: 30,
    }),
    new winston.transports.File({
      filename: join(LOG_PATH, 'combined.log'),
      maxsize: 10485760,
      maxFiles: 30,
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
    ),
  }));
}

export default logger;
