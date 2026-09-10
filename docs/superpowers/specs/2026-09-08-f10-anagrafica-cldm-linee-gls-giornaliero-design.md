# F10 — Anagrafica CLDM, linee da PV, file GLS giornaliero

Data: 2026-09-08
Stato: approvato (design)
Progetto: sito-resi (dev :3002). Prod :3001 non toccato.

## Obiettivo

Riformare la fase di inserimento reso (F9) secondo le specifiche utente:

1. **Rimuovere il campo "Numero Ordine"** dal form.
2. **Sostituire l'inserimento manuale del PV** con l'**associazione al CLDM**: l'utente seleziona un CLDM e i dati del punto vendita (nome, indirizzo, città, CAP, provincia) si auto-compilano dall'anagrafica.
3. **Anagrafica dedicata** del sito, ricavata da `ZSD127.xlsx` (share `\\192.168.90.35\Data\Servizi\InformazioniI Generali\anagrafica_siti_rares\ZSD127.xlsx`).
   - Colonne: U=CLDM, V=nome PV, W=indirizzo, X=città, Y=CAP, Z=provincia, AA=regione, AL=codice responsabile (approva), AM=nome responsabile, AN=codice promotore (inserisce), AO=nome promotore, AS=linee aperte nel PV (sigle dash-separate, es. `BA-FP-LC-MB-SX`).
4. **Linee**: ogni riga del form seleziona una linea da un dropdown popolato con le linee aperte del PV selezionato (colonna AS) **+ opzione "Altro"** per inserire una linea non in elenco. Ogni riga: `{nome, numero_pezzi}`.
5. **File GLS giornaliero**: un unico `.xls` con tutti i resi approvati dall'interno (customer_service) nella giornata con `corriere=GLS`, da inviare a GLS.

## Decisioni utente (brainstorming)

- **Selezione CLDM**: libera per tutti (promoter/responsabile/interno). Nessun vincolo per ruolo. I codici AL/AN sono salvati nell'anagrafica ma non filtrano la lista.
- **File GLS**: solo `corriere=GLS`; una riga per reso approvato nella giornata; generato su disco + scaricabile da pulsante.
- **Aggiornamento anagrafica**: il sito ha un **DB interno** aggiornato **una volta a settimana (domenica alle 12:00)** + **aggiornamento forzato** (endpoint/pulsante). Non si legge l'XLSX live a ogni richiesta.

## Vincoli (non rompere)

- Dev-first, MAI restartare/toccare prod Express (:3001, pid 3545347, `.express.pid`).
- Modifiche a `server/modules/*.js` e `server/lib/*.js` richiedono restart del dev `node server.js` (no hot-reload). UI `.tsx` hot-reload.
- UI in italiano, WCAG AA. Consultare accessibility-lead prima di editare `.tsx` (edit-gate).
- File XLS: mantenere le 16 colonne/ordine di `RITGIO2836.xls` (consumato dal corriere).
- Nessuna nuova dipendenza esterna (composer/npm package) senza chiedere. `xlsx@0.18.5` e `better-sqlite3` già presenti.
- Backward compat: resi vecchi (prodotti/cldm/bda_autorizzazione/pv_* vuoti) continuano a funzionare nel dettaglio e nell'XLS via fallback.

## Architettura

### 1. Anagrafica interna

**Tabella** in `data/resi.db` (migrazione idempotente in `server/lib/db.js`):
```sql
CREATE TABLE IF NOT EXISTS anagrafica_pv (
  cldm TEXT PRIMARY KEY,
  nome TEXT, indirizzo TEXT, citta TEXT, cap TEXT,
  provincia TEXT, regione TEXT,
  resp_codice TEXT, resp_nome TEXT,
  promo_codice TEXT, promo_nome TEXT,
  linee TEXT,           -- AS dash-join, es. "BA-FP-LC-MB-SX"
  updated_at TEXT
);
```

**Importer** `server/lib/anagrafica.js`:
- `ZSD127_PATH` da env (default `/mnt/bolle-scan-data/Servizi/InformazioniI Generali/anagrafica_siti_rares/ZSD127.xlsx`).
- Foglio `ZSD127`. Colonne posizionali: idx 20 (U)=cldm, 21 (V)=nome, 22 (W)=indirizzo, 23 (X)=citta, 24 (Y)=cap, 25 (Z)=provincia, 26 (AA)=regione, 37 (AL)=resp_codice, 38 (AM)=resp_nome, 39 (AN)=promo_codice, 40 (AO)=promo_nome, 44 (AS)=linee.
- `parsePersona` riusato da `zsd127-parser.js` (ABC HUB) per estrarre nome senza telefono da AM/AO (stringa "NOME 335xxxx"); qui serve solo il nome → si copia la logica (no import cross-project, zero-dipendenze).
- Upsert in transazione (`INSERT ... ON CONFLICT(cldm) DO UPDATE`). Ritorna `{imported, updated, total}`. Log audit `ANAGRAFICA_REFRESH`.
- Su share/file mancante: warning, **non svuota** la tabella (mantiene i dati esistenti).

**Scheduler** (in `server.js` dopo `app.prepare`):
- Calcola ms al prossimo **domenica 12:00** locale; `setTimeout` → importer → `setInterval(7*24h)`.
- Env `ANAGRAFICA_AUTO_WEEKLY=1` (default on) per disabilitare in test.

**Endpoint**:
- `POST /api/admin/anagrafica/refresh` (admin only) → importer forzato, ritorna stats.
- `GET /api/anagrafica?q=<term>&limit=20` (logged-in) → search by cldm or nome (ILIKE), per combobox.
- `GET /api/anagrafica/:cldm` (logged-in) → record completo incl. `linee` array.

### 2. Form (`ResoForm.tsx`, `LineeForm.tsx`)

- **Rimuovi** campo "Numero Ordine" (state + POST `numero_ordine`).
- **Rimuovi** blocco PV manuale (`pv_nome…pv_regione`).
- **CLDM selector**: `<input>` (numeric) + `<datalist>`; typing ≥2 char → `GET /api/anagrafica?q=`; selezione/blur → `GET /api/anagrafica/:cldm` → fill **read-only** di nome/indirizzo/città/CAP/provincia/regione + linee disponibili. Live region: "PV trovato: <nome>" / "CLDM non trovato".
- **Sicurezza**: il client invia solo `cldm`; il **server** deriva `pv_*` da `anagrafica_pv` (autorevole). Il client non può inviare dati PV arbitrari (hardening F9).
- **LineeForm**: `nome` per riga = `<select>` con opzioni = linee del PV selezionato + "Altro…". Se "Altro…" → compare input testo libero (stesso pattern focus di corriere-ALTRI). `numero_pezzi` resta. Se nessun CLDM selezionato → select disabilitato con hint "Seleziona prima un punto vendita".
- Invariati: `corriere`, `corriere_nome` (ALTRI), `num_colli`, `ddt_numero`, `ddt_data`, `motivo`, `note`, `foto`.
- POST body: `cldm, linee, corriere, corriere_nome, num_colli, ddt_numero, ddt_data, motivo_reso, note`. **Non** `numero_ordine`, **non** `pv_*` (deriva server).

### 3. File GLS giornaliero

- **Endpoint** `GET /api/customer-service/gls/giornaliero?data=YYYY-MM-DD` (default oggi):
  - Select `stato='approvato' AND corriere='GLS' AND date(data_approvazione)=date(?)` (pattern già usato in `customer-service.js:192`).
  - `buildResiXls(rows)` (già accetta lista) → multi-riga, **header 16 colonne invariato**.
  - Scrive su disco `RITGIO_GLS_<DDMMYY>.xls` (dir da env `GLS_EXPORT_DIR`, default `/home/adimn/Scrivania`) + stream download.
- **Pagina** (area customer-service) "File GLS giornaliero": bottone "Genera e scarica file GLS di oggi" + date picker + conteggio resi inclusi.

### 4. Validation, server, webhook, dettaglio, XLS (backward compat)

- `validation.js`: `cldm` **obbligatorio** (regex `CLDM_REGEX`), `pv_*` **opzionali** (server deriva), `numero_ordine` opzionale/nullable, `linee` invariato, `prodotti/bda/bda_autorizzazione` opzionali (vecchi PUT).
- `resi.js` POST/PUT: su `cldm` valido → lookup `anagrafica_pv` → scrive `pv_*` risolti. `num_reso` sequenziale invariato. `numero_ordine_esterno` nullo per nuovi resi (DB: `ALTER` + default `''`).
- `webhook.js` + ABC HUB `resi-webhook.js`: passano `cldm` (ora sempre presente) + campi esistenti. ABC HUB risolve già PV via `resolvePv(cldm)` → coerente. Nessuna rottura schema.
- 3 pagine dettaglio: mostrano "Punto vendita" da `pv_*` (come ora) + nuova riga "CLDM {cldm}"; sezione linee invariata.
- `xls-export.js`: la risoluzione PV fa già fallback a `resolvePv(cldm)` quando `pv_nome` assente; ora `pv_nome` sarà presente (da anagrafica) → usato direttamente. Nessuna modifica necessaria.

### 5. A11y (WCAG AA)

Datalist combobox con `<label>` + `aria-describedby`; campi PV read-only annunciati via live region; `<select>` linee per riga con `<label>`; input "Altro…" condizionale con focus move + `aria-expanded/controls`; touch target ≥44px; keyboard nav CLDM→linee→corriere. Consultare accessibility-lead prima di editare `.tsx` (edit-gate).

### 6. Migrazione DB

- `ALTER TABLE richieste_reso` per `numero_ordine_esterno` default `''` (idempotente: la colonna esiste già, si relaxa il NOT NULL via `ALTER ... DROP NOT NULL` supportato da SQLite ≥3.25 su colonna non-PK; se problematico, i nuovi INSERT passano `''` e la colonna resta NOT NULL ma sempre popolata).
- `CREATE TABLE IF NOT EXISTS anagrafica_pv`.
- Nessun drop tabella; `resi.db` esistente compatibile.

## Verifica e2e (dev :3002 + harness :3011)

1. Forced refresh anagrafica → 6000+ righe in `anagrafica_pv`.
2. `GET /api/anagrafica?q=507888` → ritorna GHEZZI LUIGI.
3. Form: inserisci CLDM 507888 → PV auto-compilato read-only, linee dropdown = `BA-FP-LC-MB-SX` (+ Altro). Crea reso con 2 linee (una da elenco, una Altro) + corriere GLS → 201, `num_reso` sequenziale.
4. XLS del reso: PV da anagrafica, "Aut. N. X", destinatario "ABC SRL RESI".
5. Approva un reso GLS come CS (o crea come CS auto-chiuso) con data_approvazione oggi → endpoint `gls/giornaliero` ritorna `.xls` multi-riga con tutti i GLS odierni; file scritto su disco.
6. Backward compat: dettaglio + XLS di un reso vecchio (prodotti/cldm/bda) → fallback OK.
7. Pagine compilano (HTTP 200); a11y keyboard pass.
8. Prod :3001 intatto.

## Out of scope

- Filtraggio CLDM per ruolo (decisione: libero per tutti).
- Invio automatico del file GLS via email/FTP (solo generazione su disco + download).
- Backfill `num_reso` su resi vecchi (restano NULL).
- Restart prod Express.