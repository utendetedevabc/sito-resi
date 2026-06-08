import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

// Sanificazione: rimuove QUALSIASI tag HTML
const sanitize = (str) => DOMPurify.sanitize(str, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });

// Numeri di ordine: solo alfanumerici + trattini/underscore/slash
const ORDINE_REGEX = /^[A-Za-z0-9\-_\/]{3,50}$/;
// BDA: solo numeri, 1-15 cifre
const BDA_REGEX = /^\d{1,15}$/;

export const loginSchema = z.object({
  email: z.string().email().max(255).transform(sanitize),
  password: z.string().min(12).max(128),
});

export const creaResoSchema = z.object({
  numero_ordine: z.string().regex(ORDINE_REGEX, 'Formato ordine non valido').transform(sanitize),
  bda: z.string().regex(BDA_REGEX, 'BDA deve contenere solo numeri').optional().nullable(),
  motivo_reso: z.enum(['difettoso', 'errato', 'non_conforme', 'altro']),
  note: z.string().max(2000).transform(s => sanitize(s).substring(0, 2000)).optional(),
  prodotti: z.array(z.object({
    codice: z.string().min(1).max(50).transform(sanitize),
    descrizione: z.string().min(1).max(500).transform(sanitize),
    quantita: z.number().int().min(1).max(9999),
    condizioni: z.enum(['integro', 'danneggiato', 'aperto', 'usato']),
  })).min(1).max(100),
});

export const approvaResoSchema = z.object({
  stato: z.enum(['approvato', 'rifiutato', 'in_revisione']),
  note: z.string().max(2000).transform(s => sanitize(s).substring(0, 2000)).optional(),
});

export const csResoSchema = z.object({
  stato: z.enum(['approvato', 'rifiutato']),
  note: z.string().max(2000).transform(s => sanitize(s).substring(0, 2000)).optional(),
});

export const createUserSchema = z.object({
  email: z.string().email().max(255).transform(sanitize),
  password: z.string().min(12).max(128),
  ruolo: z.enum(['store_account', 'venditore', 'admin', 'customer_service']),
  nome: z.string().min(1).max(255).transform(sanitize),
  azienda: z.string().max(255).transform(sanitize).optional().nullable(),
  codice_cliente_esterno: z.string().max(50).transform(sanitize).optional().nullable(),
  csrf_token: z.string().length(64),
});

export const updateUserSchema = z.object({
  ruolo: z.enum(['store_account', 'venditore', 'admin', 'customer_service']).optional(),
  nome: z.string().min(1).max(255).transform(sanitize).optional(),
  azienda: z.string().max(255).transform(sanitize).optional().nullable(),
  codice_cliente_esterno: z.string().max(50).transform(sanitize).optional().nullable(),
  attivo: z.number().int().min(0).max(1).optional(),
  csrf_token: z.string().length(64),
});
