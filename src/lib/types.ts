export type Ruolo = 'store_account' | 'venditore' | 'admin';

export type StatoReso = 'in_attesa' | 'approvato' | 'rifiutato' | 'spedito' | 'completato' | 'annullato';

export interface User {
  id: number;
  email: string;
  ruolo: Ruolo;
  nome: string;
  azienda?: string | null;
  codice_cliente_esterno?: string | null;
  webhook_url?: string | null;
  attivo: number;
  created_at: string;
}

export interface Prodotto {
  codice: string;
  descrizione: string;
  quantita: number;
  condizioni: 'integro' | 'danneggiato' | 'aperto' | 'usato';
}

export interface RichiestaReso {
  id: number;
  uuid: string;
  user_id: number;
  numero_ordine_esterno: string;
  bda_hash?: string | null;
  motivo_reso: string;
  note?: string | null;
  prodotti: Prodotto[];
  stato: StatoReso;
  venditore_id?: number | null;
  note_venditore?: string | null;
  data_approvazione?: string | null;
  data_scadenza?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Upload {
  id: number;
  richiesta_id: number;
  stored_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256_hash: string;
  uploaded_at: string;
}

export interface AuditLog {
  id: number;
  user_id?: number | null;
  azione: string;
  dettaglio?: string | null;
  ip_address?: string | null;
  user_agent_hash?: string | null;
  created_at: string;
}

export interface WebhookLog {
  id: number;
  richiesta_id?: number | null;
  attempt_number: number;
  status_code?: number | null;
  response_body?: string | null;
  error_message?: string | null;
  duration_ms?: number | null;
  created_at: string;
}

export interface RefreshToken {
  id: number;
  user_id: number;
  token_hash: string;
  device_fingerprint: string;
  ip_address: string;
  expires_at: string;
  revoked: number;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  total?: number;
  page?: number;
  per_page?: number;
}
