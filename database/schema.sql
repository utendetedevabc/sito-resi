-- PRAGMA per SQLCipher (crittografia a riposo)
PRAGMA key = '{{DB_ENCRYPTION_KEY}}';
PRAGMA cipher_page_size = 4096;
PRAGMA kdf_iter = 256000;
PRAGMA cipher_hmac_algorithm = HMAC_SHA512;
PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
PRAGMA secure_delete = ON;           -- Sovrascrive dati cancellati

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,         -- bcrypt $2b$12$ + pepper
  ruolo TEXT NOT NULL CHECK(ruolo IN ('store_account','venditore','customer_service','admin')),
  nome TEXT NOT NULL,
  azienda TEXT,
  codice_cliente_esterno TEXT,         -- Mai codice reale ABC HUB
  webhook_url TEXT,
  attivo INTEGER DEFAULT 1,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TEXT,
  last_login_ip TEXT,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_fingerprint TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS richieste_reso (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE NOT NULL,            -- UUID v4 per riferimento esterno
  user_id INTEGER NOT NULL REFERENCES users(id),
  numero_ordine_esterno TEXT NOT NULL,
  bda_hash TEXT,                        -- SHA-256 del BDA
  motivo_reso TEXT NOT NULL CHECK(motivo_reso IN ('difettoso','errato','non_conforme','altro')),
  note TEXT,
  prodotti TEXT,                        -- JSON array (modello vecchio, nullable)
  stato TEXT NOT NULL DEFAULT 'in_attesa'
    CHECK(stato IN ('in_attesa','in_revisione','approvato','rifiutato','spedito','completato','annullato')),
  venditore_id INTEGER REFERENCES users(id),
  note_venditore TEXT,
  data_approvazione TEXT,
  data_scadenza TEXT,                   -- 30gg dalla creazione
  webhook_sent INTEGER DEFAULT 0,
  webhook_attempts INTEGER DEFAULT 0,
  webhook_last_attempt TEXT,
  webhook_response_code INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  -- Modello nuovo (linee + corriere + PV manuale + num_reso). Colonne vecchie
  -- (prodotti, cldm, num_colli, bda_autorizzazione) restano per backward compat.
  linee TEXT,                            -- JSON [{nome}]
  corriere TEXT,                         -- GLS/NIEDDU/TRAMES/PARENA/ALTRI
  corriere_nome TEXT,                    -- nome libero se corriere=ALTRI
  pv_nome TEXT,                          -- ragione sociale PV (inserito manualmente)
  pv_indirizzo TEXT,
  pv_citta TEXT,
  pv_cap TEXT,
  pv_provincia TEXT,
  pv_regione TEXT,
  num_reso INTEGER                       -- identificativo sequenziale 1..1.000.000
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  azione TEXT NOT NULL,
  dettaglio TEXT,                       -- JSON
  ip_address TEXT,
  user_agent_hash TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  richiesta_id INTEGER REFERENCES richieste_reso(id),
  original_filename_hash TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256_hash TEXT NOT NULL,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  richiesta_id INTEGER REFERENCES richieste_reso(id),
  attempt_number INTEGER NOT NULL,
  status_code INTEGER,
  response_body TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indici
CREATE INDEX IF NOT EXISTS idx_richieste_user ON richieste_reso(user_id);
CREATE INDEX IF NOT EXISTS idx_richieste_stato ON richieste_reso(stato);
CREATE INDEX IF NOT EXISTS idx_richieste_venditore ON richieste_reso(venditore_id);
CREATE INDEX IF NOT EXISTS idx_richieste_uuid ON richieste_reso(uuid);
CREATE INDEX IF NOT EXISTS idx_richieste_num_reso ON richieste_reso(num_reso);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_data ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_richiesta ON webhook_log(richiesta_id);

-- WebAuthn credentials
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);

-- Push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
