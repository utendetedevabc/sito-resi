# F11 — Anagrafica agenti + provisioning utenti del sito

Data: 2026-09-08 (aggiornato 2026-09-09: aggiunto routing per responsabile)
Stato: design finalizzato (provisioning + routing), pronto per plan
Progetto: sito-resi (dev :3002). Prod :3001 non toccato.

## Obiettivo

1. Provisioning degli account di login del sito-resi (promotori / responsabili / agenti) a partire da `anagrafica_agenti.xlsx`, in un DB interno, con mirror nella tabella `users` esistente.
2. **Routing delle approvazioni di 1° livello per responsabile**: ogni responsabile (venditore) vede solo i resi `in_attesa` dei punti vendita assegnati a lui (`anagrafica_pv.resp_codice` = codice del responsabile), invece di tutti i resi di tutti i promoter come oggi.

## Sorgente

File: `/home/adimn/Scrivania/anagrafica_agenti.xlsx` (FUORI dal repo — non committare).
- Foglio `Foglio1`, **107 righe dati, NESSUNA riga di header** (la riga 0 è già un record: `M6 / roberto.morello / roberto.morello@abcosmetique.it / <pwd>`).
- Colonne: **A**=codice (es. `M6`, `G3`, `GP`, `BI`, `ZS`, `906K`, `9046`, `9002`), **B**=nome, **C**=email (login), **D**=password in chiaro (login).

⚠️ **Sicurezza**: il file contiene password in chiaro. Il DB interno conserverà **solo l'hash** (bcrypt + `PASSWORD_PEPPER`, come `server/lib/security.js`). Il file xlsx non va mai committato né loggato.

## Decisioni utente (brainstorming)

1. **Mapping ruolo**: match del codice (A) contro `anagrafica_pv` (popolata in F10 Task 2, ~6180 PV):
   - codice presente in `anagrafica_pv.resp_codice` (colonna AL/CLICRP2) → `venditore` (responsabile, approva)
   - codice presente in `anagrafica_pv.promo_codice` (colonna AN/CLICRP1) → `store_account` (promotore, inserisce)
   - codice che matcha **entrambi** → preferisci `venditore` (privilegio più alto)
   - codice **non matchato** (agenti/utenti generici non legati a un PV) → default `venditore`, ma **logga la lista dei codici non matchati** per review manuale (l'utente potrà correggere ruolo via admin).
2. **Target DB**: tabella `anagrafica_agenti` interna (fonte) + mirror (upsert) nella tabella `users` esistente, chiave = email.
3. **Password su refresh**: imposta `password_hash` solo alla **creazione** del nuovo utente. Sui refresh successivi **NON sovrascrivere** la password (preserva cambi utente); aggiorna solo `nome`, `codice_cliente_esterno`, `ruolo`, `email`.

## Architettura (da dettagliare nel plan)

### Tabella `anagrafica_agenti`
```sql
CREATE TABLE IF NOT EXISTS anagrafica_agenti (
  codice TEXT PRIMARY KEY,          -- colonna A
  nome TEXT,                        -- colonna B
  email TEXT,                       -- colonna C (chiave login)
  password_hash TEXT,               -- hash di colonna D (bcrypt+pepper)
  ruolo TEXT,                        -- store_account|venditore (derivation match)
  updated_at TEXT
);
```
Indice su `email`.

### Importer `server/lib/agenti.js`
- `AGENTI_PATH` env (default `/home/adimn/Scrivania/anagrafica_agenti.xlsx`).
- Foglio `Foglio1`, dati da riga 0 (no header). Colonne: A=codice, B=nome, C=email, D=password.
- Per ogni riga: deriva ruolo matchando codice contro `anagrafica_pv.resp_codice`/`promo_codice` (SQL: `SELECT 1 FROM anagrafica_pv WHERE resp_codice=?` etc.). Codici non matchati → `venditore`, raccolti in lista `unmatched` ritornata.
- Hash password con `hashPassword` di `server/lib/security.js` + `PASSWORD_PEPPER`.
- Upsert `anagrafica_agenti` (ON CONFLICT(codice) DO UPDATE di nome/email/ruolo/updated_at; password_hash SEMPRE aggiornato nell'anagrafica_agenti perché è la fonte — ma vedi mirror sotto).
- **Mirror in `users`**: upsert by `email`:
  - se utente NON esiste → INSERT (email, password_hash, ruolo, nome, codice_cliente_esterno=codice, attivo=1).
  - se esiste → UPDATE nome, codice_cliente_esterno, ruolo; **NON toccare password_hash** (decisione utente).
- Ritorna `{imported, updated, total, unmatched: [codici...]}`. Log audit `AGENTI_REFRESH`.

### API + refresh
- `POST /api/admin/agenti/refresh` (admin only) → importer forzato.
- `GET /api/admin/agenti/status` → count, last_updated, unmatched count, source_exists.
- (Eventuale) `GET /api/admin/agenti` → lista agenti (per review).

### Scheduler
- Stesso scheduler di F10 (domenica 12:00) — aggiungi `refreshAgenti()` dopo `refreshAnagrafica()`. + refresh forzato admin.

## Routing approvazioni per responsabile (resp_codice)

### Problema
`server/modules/venditore.js` oggi filtra solo `WHERE r.stato='in_attesa' AND u.ruolo='store_account'`: **tutti** i resi `in_attesa` di **tutti** i promoter sono visibili a **qualsiasi** venditore. Ogni responsabile dovrebbe vedere solo i resi dei PV a lui assegnati (es. Salvati Daniele / `AS` → i suoi 682 PV; Ghio Luca è un promoter i cui 211 PV hanno resp `M6` → le sue richieste vanno a Morello Roberto).

### Dati (già presenti da F10)
- `anagrafica_pv.resp_codice` / `resp_nome` per ogni PV (colonne AL/AM di ZSD127).
- `lookupPvByCldm(cldm)` restituisce già `resp_codice`/`resp_nome` (F10 Task 2 — `SELECT * FROM anagrafica_pv`).
- Il provisioning F11 imposta `users.codice_cliente_esterno` = codice (col A) per ogni utente. Per i responsabili (ruolo `venditore`) questo codice matcha `resp_codice` → il routing si attiva automaticamente. Per i promoter (`store_account`) matcha `promo_codice` (non usato per routing).

### Schema (migrazione idempotente)
Aggiungi a `richieste_reso`: `resp_codice TEXT`, `resp_nome TEXT` via `addColumnIfMissing` in `server/lib/db.js` + indice `idx_richieste_reso_resp_codice`. Aggiorna `database/schema.sql` per i fresh install.

### Creazione/aggiornamento reso (`server/modules/resi.js`)
- **POST**: dopo `lookupPvByCldm(cldm)`, estrai anche `resp_codice`/`resp_nome` e includili nell'INSERT (insieme a pv_*). Memorizzare per tutti i resi (anche CS/venditore) — utile per audit/display, indipendentemente dal routing (che opera solo su `in_attesa`).
- **PUT**: aggiorna `resp_codice`/`resp_nome` quando cambia il `cldm` (stessa guardia `if (pv)` di F10).

### Filtro `venditore.js` (3 endpoint: GET /richieste, GET /richieste/:uuid, PUT /richieste/:uuid)
- Carica `codice_cliente_esterno` del venditore loggato (`req.user.id` → users).
- Determina se il codice matcha un `resp_codice` in `anagrafica_pv`:
  - **Match** → il venditore vede solo i resi con `r.resp_codice = <suo codice>` (oltre a `stato='in_attesa' AND u.ruolo='store_account'`).
  - **No match / codice vuoto** → backward-compat: vede tutti i resi `in_attesa` (venditori generici senza assegnazione territoriale).
- Applica il filtro sia alla lista (`GET /richieste` count + data) sia al dettaglio (`GET /richieste/:uuid`: 404 se il reso non è suo) sia all'approvazione (`PUT /richieste/:uuid`: 404 se non è suo — non può approvare resi non assegnati).

### Backfill resi pre-F11
I resi esistenti (creati prima di F11) hanno `resp_codice=NULL` → i venditori con assegnazione NON li vedrebbero. Backfill una tantum (al primo refresh F11 o manuale):
```sql
UPDATE richieste_reso
SET resp_codice = (SELECT resp_codice FROM anagrafica_pv WHERE anagrafica_pv.cldm = richieste_reso.cldm),
    resp_nome   = (SELECT resp_nome   FROM anagrafica_pv WHERE anagrafica_pv.cldm = richieste_reso.cldm)
WHERE resp_codice IS NULL AND cldm IS NOT NULL;
```
Resi con `cldm` NULL (molto vecchi) restano `resp_codice=NULL` → visibili solo ai venditori generici (backward-compat).

### Interplay provisioning ↔ routing
F11 provisioning + routing sono sinergici: dopo il provisioning, ogni responsabile ha `codice_cliente_esterno` = suo `resp_codice` → il routing è attivo senza configurazione aggiuntiva. I codici non matchati (agenti generici) → ruolo `venditore` senza routing (vedono tutto).

## Vincoli
- Dev-first, no restart prod :3001. No new deps. Italian. No test suite (verifica manuale).
- Password in chiaro mai loggate/committate.
- File fuori repo (`/home/adimn/Scrivania/`), non copiare nel repo.

## Verifica (dev)
1. Forced refresh → ~107 agenti in `anagrafica_agenti`, mirror in `users` (nuovi utenti creati con password hash).
2. Login con un agente (email C + password D) → 200 + token.
3. Logga unmatched codes (review ruolo).
4. Re-refresh → utenti esistenti NON hanno password sovrascritta (verifica hash invariato).
5. **Routing**: un promoter inserisce un reso per un PV con resp `M6` → `resp_codice='M6'` memorizzato. Morello (venditore, codice `M6`) lo vede in `/richieste`; un altro responsabile (es. `AS`) NON lo vede; un venditore generico senza codice li vede tutti.
6. **Routing approvazione**: Morello apre dettaglio del reso suo → 200; prova dettaglio reso non suo (resp `AS`) → 404; approva reso suo → OK; prova approvare reso non suo → 404.
7. **Backfill**: dopo backfill, resi pre-F11 con cldm hanno `resp_codice` popolato; resi senza cldm restano NULL (visibili ai generici).
8. Password mai loggate/committate; xlsx mai nel repo.

## Sequenza
Eseguire DOPO F10. F11 non blocca F10; riusa `anagrafica_pv` (F10 Task 2 ✅).