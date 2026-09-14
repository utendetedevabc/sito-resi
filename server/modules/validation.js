import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

// Sanificazione: rimuove QUALSIASI tag HTML
const sanitize = (str) => DOMPurify.sanitize(str, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });

// Numeri di ordine: solo alfanumerici + trattini/underscore/slash
const ORDINE_REGEX = /^[A-Za-z0-9\-_\/]{3,50}$/;
// BDA: solo numeri, 1-15 cifre
const BDA_REGEX = /^\d{1,15}$/;

// Login: la lunghezza minima della password è una policy di CREAZIONE
// (enforced in createUserSchema, min(8)), NON di verifica login.
// Il login accetta qualsiasi password non-vuota e delega a verifyPassword
// (auth.js:121) il controllo dell'hash bcrypt — una password sbagliata di
// qualsiasi lunghezza fallisce comunque. Necessario per F11: provisioning
// account dal xlsx con password 8/10 char.
export const loginSchema = z.object({
  email: z.string().email().max(255).transform(sanitize),
  password: z.string().min(1).max(128),
});

// CLDM punto vendita: alfanumerico (es. 503990, TIGULLIO)
const CLDM_REGEX = /^[A-Za-z0-9_\-]{2,20}$/;
// Data DDT: DD/MM/YYYY
const DDT_DATA_REGEX = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;

export const creaResoSchema = z.object({
  numero_ordine: z.string().regex(ORDINE_REGEX, 'Formato ordine non valido').transform(sanitize).optional().nullable(),
  bda: z.string().regex(BDA_REGEX, 'BDA deve contenere solo numeri').optional().nullable(),
  motivo_reso: z.enum(['difettoso', 'errato', 'non_conforme', 'altro']),
  note: z.string().max(2000).transform(s => sanitize(s).substring(0, 2000)).optional(),
  // Campi per export corriere (manifest RITGIO*.xls). Tutti opzionali.
  cldm: z.string().regex(CLDM_REGEX, 'CLDM non valido').transform(sanitize),
  ddt_numero: z.string().max(30).transform(sanitize).optional().nullable(),
  ddt_data: z.string().regex(DDT_DATA_REGEX, 'Data DDT deve essere GG/MM/AAAA').optional().nullable(),
  num_colli: z.number().int().min(1).max(9999).optional().nullable(),
  // bda_autorizzazione = numero BDA in chiaro (per la riga "Aut. N" del file corriere)
  bda_autorizzazione: z.string().regex(BDA_REGEX, 'Autorizzazione BDA deve contenere solo numeri').optional().nullable(),
  // Modello nuovo: linee (nome + numero_pezzi) al posto di prodotti
  // (codice/descr/qta/condizioni). prodotti resta accettato per backward compat
  // (vecchi PUT); linee e' il nuovo modello. I "colli" (pacchi per il corriere)
  // NON sono qui: sono il campo singolo num_colli in "dati ritiro corriere".
  prodotti: z.array(z.object({
    codice: z.string().min(1).max(50).transform(sanitize),
    descrizione: z.string().min(1).max(500).transform(sanitize),
    quantita: z.number().int().min(1).max(9999),
    condizioni: z.enum(['integro', 'danneggiato', 'aperto', 'usato']),
  })).max(100).optional(),
  linee: z.array(z.object({
    nome: z.string().min(1).max(100).transform(sanitize),
    numero_pezzi: z.number().int().min(1).max(9999),
  })).min(1).max(100),
  // Corriere: uno tra GLS/NIEDDU/TRAMES/PARENA/ALTRI. Se ALTRI, corriere_nome obbligatorio.
  corriere: z.enum(['GLS', 'NIEDDU', 'TRAMES', 'PARENA', 'ALTRI']),
  corriere_nome: z.string().max(100).transform(sanitize).optional().nullable(),
  // Punto vendita: opzionali perche' il server li deriva dal cldm via anagrafica_pv.
  pv_nome: z.string().min(1).max(255).transform(sanitize).optional().nullable(),
  pv_indirizzo: z.string().min(1).max(255).transform(sanitize).optional().nullable(),
  pv_citta: z.string().min(1).max(100).transform(sanitize).optional().nullable(),
  pv_cap: z.string().min(1).max(10).transform(sanitize).optional().nullable(),
  pv_provincia: z.string().min(1).max(50).transform(sanitize).optional().nullable(),
  pv_regione: z.string().max(50).transform(sanitize).optional().nullable(),
}).refine(
  (d) => d.corriere !== 'ALTRI' || (typeof d.corriere_nome === 'string' && d.corriere_nome.trim().length >= 1),
  { message: 'Nome corriere obbligatorio quando si seleziona ALTRI', path: ['corriere_nome'] }
);

export const approvaResoSchema = z.object({
  stato: z.enum(['approvato', 'rifiutato', 'in_revisione']),
  note: z.string().max(2000).transform(s => sanitize(s).substring(0, 2000)).optional(),
});

export const csResoSchema = z.object({
  stato: z.enum(['approvato', 'rifiutato']),
  note: z.string().max(2000).transform(s => sanitize(s).substring(0, 2000)).optional(),
});

// Task 4: export selezionati — POST /api/customer-service/richieste/export.
// Lista di uuid di resi da esportare in un unico XLS multi-riga + mark spedito.
// Limite 500 per evitare abuse/timeout; min 1 perche' l'azione e' no-op senza uuid.
export const exportResiSchema = z.object({
  uuids: z.array(z.string().uuid()).min(1).max(500),
});

export const createUserSchema = z.object({
  email: z.string().email().max(255).transform(sanitize),
  // min(8): le password di provisioning da anagrafica_agenti.xlsx sono 8/10
  // char — la soglia 12 le avrebbe rifiutate (incoerenza col provisioning).
  password: z.string().min(8).max(128),
  ruolo: z.enum(['store_account', 'venditore', 'admin', 'customer_service']),
  nome: z.string().min(1).max(255).transform(sanitize),
  azienda: z.string().max(255).transform(sanitize).optional().nullable(),
  codice_cliente_esterno: z.string().max(50).transform(sanitize).optional().nullable(),
  // csrf_token opzionale: le route admin sono protette da Bearer JWT +
  // authorize('admin') (i Bearer token sono immuni da CSRF per design) e NON
  // hanno middleware di validazione CSRF lato server (solo il route di login
  // in auth.js valida contro csrfStore). Rendere il campo opzionale sblocca
  // create/PUT/toggle che inviano 'placeholder' (in precedenza safeParse
  // falliva su length(64) → 400 silente). Nessuna regressione di sicurezza.
  csrf_token: z.string().optional(),
});

export const updateUserSchema = z.object({
  ruolo: z.enum(['store_account', 'venditore', 'admin', 'customer_service']).optional(),
  nome: z.string().min(1).max(255).transform(sanitize).optional(),
  azienda: z.string().max(255).transform(sanitize).optional().nullable(),
  codice_cliente_esterno: z.string().max(50).transform(sanitize).optional().nullable(),
  attivo: z.number().int().min(0).max(1).optional(),
  // Reset password opzionale su utente esistente: accetta assente/'' (non
  // modificare) oppure una stringa >=8 char (come createUserSchema, coerente
  // col provisioning da xlsx). Non sanificata (coerente con createUserSchema
  // password) — la password può contenere qualsiasi carattere.
  password: z.string()
    .max(128)
    .optional()
    .refine((v) => v === undefined || v === '' || (typeof v === 'string' && v.length >= 8), {
      message: 'Password minimo 8 caratteri',
      path: ['password'],
    }),
  csrf_token: z.string().optional(),
});
