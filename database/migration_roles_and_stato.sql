-- Migration 002: Aggiunge ruolo customer_service e stato in_revisione
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- ===== Tabella users: aggiungi customer_service =====
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  ruolo TEXT NOT NULL CHECK(ruolo IN ('store_account','venditore','admin','customer_service')),
  nome TEXT NOT NULL,
  azienda TEXT,
  codice_cliente_esterno TEXT,
  webhook_url TEXT,
  attivo INTEGER DEFAULT 1,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TEXT,
  last_login_ip TEXT,
  last_login_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO users_new SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- ===== Tabella richieste_reso: aggiungi in_revisione =====
CREATE TABLE richieste_reso_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  numero_ordine_esterno TEXT NOT NULL,
  bda_hash TEXT,
  motivo_reso TEXT NOT NULL CHECK(motivo_reso IN ('difettoso','errato','non_conforme','altro')),
  note TEXT,
  prodotti TEXT NOT NULL,
  stato TEXT NOT NULL DEFAULT 'in_attesa'
    CHECK(stato IN ('in_attesa','in_revisione','approvato','rifiutato','spedito','completato','annullato')),
  venditore_id INTEGER REFERENCES users(id),
  note_venditore TEXT,
  data_approvazione TEXT,
  data_scadenza TEXT,
  webhook_sent INTEGER DEFAULT 0,
  webhook_attempts INTEGER DEFAULT 0,
  webhook_last_attempt TEXT,
  webhook_response_code INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO richieste_reso_new SELECT * FROM richieste_reso;
DROP TABLE richieste_reso;
ALTER TABLE richieste_reso_new RENAME TO richieste_reso;

-- ===== Ricrea indici =====
CREATE INDEX IF NOT EXISTS idx_richieste_user ON richieste_reso(user_id);
CREATE INDEX IF NOT EXISTS idx_richieste_stato ON richieste_reso(stato);
CREATE INDEX IF NOT EXISTS idx_richieste_venditore ON richieste_reso(venditore_id);
CREATE INDEX IF NOT EXISTS idx_richieste_uuid ON richieste_reso(uuid);

COMMIT;
PRAGMA foreign_keys = ON;
