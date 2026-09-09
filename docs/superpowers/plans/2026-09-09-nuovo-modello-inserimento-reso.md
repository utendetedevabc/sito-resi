# Piano: nuovo modello di inserimento reso (linee, corriere, PV manuale, num_reso sequenziale)

## Context

L'utente ha chiesto di modificare l'inserimento del reso nel sito-resi (:3002, dev). Oggi il form raccoglie **prodotti** (codice/descrizione/quantità/condizioni), un CLDM (da joinare a `punti_vendita.db`), e un numero BDA. Il file corriere `RITGIO*.xls` viene generato con PV risolto dal CLDM e "Num. Autorizzazione" = BDA.

Nuove richieste (testo utente):
- Cambia "inserimento prodotti" → **"inserimento linee"**: al posto del codice prodotto, il **nome** della linea; al posto di "quantità prodotto", il **numero pezzi** per linea. (I `colli`/pacchi per il corriere restano un campo separato in "dati ritiro", vedi decisione sotto.)
- **Selezione del corriere**: GLS / NIEDDU / TRAMES / PARENA / ALTRI (con campo nome libero se ALTRI).
- Nei dati di ritiro, promoter/venditore/interno **inseriscono manualmente** il PV: nome, indirizzo, provincia, regione, CAP, città. **Rimuovere l'autorizzazione BDA**.
- Il programma **genera un numero sequenziale** (1, 2, 3… fino a 1.000.000) che identifica il reso (va nella colonna "Num. Autorizzazione" dell'XLS al posto della BDA).

Decisioni confermate dall'utente:
- **num_reso = sequenziale** (MAX+1, non casuale).
- **corriere = solo registrato** sul reso (non cambia il formato XLS). Destinatario XLS **fisso** = stesso indirizzo di oggi (Via Industria s/n, Pozzolo Formigaro, AL) ma ragione sociale **"ABC SRL RESI"** al posto di "DPV FLEX SRL RESI".

Vincoli (NON rompere): dev-first, MAI restartare/toccare prod Express (:3001, pid 3545347, `.express.pid`). Modifiche a `server/modules/*.js` e `server/lib/*.js` richiedono restart del dev `node server.js` (NON hot-reload). UI in italiano, WCAG AA. Il file XLS è consumato dal corriere → mantenere le 16 colonne/ordine di `RITGIO2836.xls`.

## Modello dati nuovo (vs vecchio)

| Campo | Vecchio | Nuovo |
|---|---|---|
| dettaglio reso | `prodotti` (codice/descr/qta/condizioni) | `linee` (**nome** + **numero_pezzi** per linea) |
| PV | `cldm` (→ join punti_vendita.db) | `pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione` (manuale) |
| colli totali | `num_colli` (singolo, in "dati ritiro corriere") | **invariato**: `num_colli` resta **singolo** nel fieldset "Dati per il ritiro del corriere" (NON per-linea). Le linee hanno `nome` + `numero_pezzi`; i `colli` (pacchi per il corriere) sono campo separato in ritiro. |
| autorizzazione | `bda_autorizzazione` (BDA) | `num_reso` (sequenziale, generato server) |
| corriere | — | `corriere` (enum) + `corriere_nome` (se ALTRI) |
| BDA (campo alto) | `bda`/`bda_hash` | rimosso dal form |

**Backward compat**: le colonne vecchie (`prodotti, cldm, num_colli, bda_autorizzazione, bda_hash`) restano nel DB. Resi vecchi le usano; resi nuovi usano le colonne nuove. Pagine dettaglio + XLS renderizzano con **fallback** (se `linee` assente → mostra `prodotti`; se `pv_nome` assente → `resolvePv(cldm)`; se `num_reso` assente → `bda_autorizzazione`).

## File da modificare

### 1. DB schema + migrazione (sito-resi) — `server/lib/db.js`
Aggiungere (idempotente, pattern `addColumnIfMissing` già presente riga 54) a `richieste_reso`:
`linee TEXT, corriere TEXT, corriere_nome TEXT, pv_nome TEXT, pv_indirizzo TEXT, pv_citta TEXT, pv_cap TEXT, pv_provincia TEXT, pv_regione TEXT, num_reso INTEGER`.
Aggiornare anche `database/schema.sql` per i fresh install.

### 2. Validation — `server/modules/validation.js`
`creaResoSchema`: sostituire `prodotti` con `linee` (array min 1 max 100 di `{ nome: string 1-100, numero_pezzi: int 1-9999 }` — nome + numero pezzi, niente colli per linea); aggiungere `corriere: enum(['GLS','NIEDDU','TRAMES','PARENA','ALTRI'])`, `corriere_nome: string max 100` (obbligatorio se corriere=ALTRI → refine zod), `pv_nome/pv_indirizzo/pv_citta/pv_cap/pv_provincia/pv_regione` (stringhe sanificate, obbligatori tranne regione opzionale); `ddt_numero/ddt_data` restano. **`num_colli` resta** come campo singolo opzionale (in "dati ritiro corriere", NON nelle linee). Rendere `prodotti/bda/bda_autorizzazione/cldm` opzionali nullable (vecchi PUT). `num_reso` NON nel body (generato server).

### 3. Server crea reso — `server/modules/resi.js` (POST `/`)
- Generare `num_reso` sequenziale: `SELECT COALESCE(MAX(num_reso),0)+1 FROM richieste_reso`; se > 1.000.000 → wrap a 1. Inserire nelle nuove colonne. Restituire `num_reso` nella risposta 201 (l'UI lo mostra).
- `statoIniziale` (macchina a stati 3-vie F4) **invariato**; auto-chiusura CS (webhook + audit) **invariata**, ma il payload webhook passa i campi nuovi.
- PUT `/`: aggiornare anche le nuove colonne.

### 4. Webhook — `server/modules/webhook.js`
`sendWebhook` payload: aggiungere `linee, corriere, corriere_nome, pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione, num_reso`. Mantenere `prodotti/cldm/num_colli/bda_autorizzazione` (null per resi nuovi) per compatibilità ABC HUB.

### 5. ABC HUB ricezione — `tracking-abc-italia-main/src/modules/resi-webhook.js`
- `addColumnIfMissing` su `resi_in_ingresso`: `linee, corriere, corriere_nome, pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione, num_reso INTEGER`.
- `resiWebhookSchema` (zod): campi nuovi opzionali (backward compat). Aggiornare `linee` a `z.array(z.object({ nome: z.string().max(100), numero_pezzi: z.number().int().min(1).max(9999).optional() }))` cosicché `numero_pezzi` non venga strippato e venga persistito nel JSON della colonna `linee` (serve anche al dettaglio/audit ABC HUB; l'XLS non lo usa).
- `INSERT`: includere i campi nuovi.
- `CARRIER_DEST.ragione_sociale` default: `"DPV FLEX SRL RESI"` → `"ABC SRL RESI"` (stesso indirizzo/città/prov). Configurabile via `RESI_CARRIER_DEST_NAME` (già esiste).
- `buildResiXls`: PV da `pv_nome/pv_indirizzo/pv_citta/pv_cap/pv_provincia` se presenti, **fallback** `resolvePv(cldm)` per resi vecchi; `num_colli` = `r.num_colli` (campo singolo, invariato — le linee non hanno colli); "Num. Autorizzazione" = `num_reso` se presente (testo `Aut. N. ${num_reso}`, BDA rimosso), fallback `bda_autorizzazione` (vecchio testo). Header 16 colonne **invariato**.
- **Gotcha**: modifiche qui richiedono restart dell'**harness dev** :3011 (require cache), NON di prod :3001.

### 6. Lib XLS sito-resi — `server/lib/xls-export.js`
Stessa logica di `buildResiXls` (PV manuale + fallback resolvePv, `num_colli` singolo, num_reso come autorizzazione, destinatario "ABC SRL RESI"). Usata dall'endpoint `GET /api/customer-service/richieste/:uuid/xls` (F7).

### 7. UI form — `src/components/resi/ResoForm.tsx`
- Rimuovere import `ProdottiForm` + campo `bda` in alto.
- Sostituire con nuovo `LineeForm` (vedi 8).
- Fieldset "Dati per il ritiro corriere": rimuovere `cldm`, `bda_autorizzazione`; **tenere `num_colli`** (campo singolo in questo fieldset); aggiungere `corriere` (select GLS/NIEDDU/TRAMES/PARENA/ALTRI) + `corriere_nome` (input condizionale se ALTRI); aggiungere PV manuale: `pv_nome, pv_indirizzo, pv_citta, pv_cap, pv_provincia, pv_regione`. Tenere `ddt_numero, ddt_data`.
- POST body: inviare `linee, corriere, corriere_nome, pv_*, num_colli, ddt_numero, ddt_data`; non inviare `bda/bda_autorizzazione/cldm/prodotti`.
- Mostrare `num_reso` nel toast di successo ("Reso N. {num_reso} creato").

### 8. Nuovo componente — `src/components/ui/LineeForm.tsx`
Pattern identico a `ProdottiForm` (fieldset per riga, `<label htmlFor>`, add/remove button ≥44px, `aria-label`). Riga = `{ nome: string, numero_pezzi: number }` (nome + numero pezzi). Titolo "Linee ({n})". Aggiungi linea → `{ nome: '', numero_pezzi: 1 }`.

### 9. Pagine dettaglio (3) — renderizzano linee + campi nuovi
`src/app/dashboard/richieste/[id]/page.tsx`, `src/app/venditore/richieste/[id]/page.tsx`, `src/app/customer-service/richieste/[id]/page.tsx`:
- Sezione "Linee" (se `linee` presente) al posto di "Prodotti"; ogni riga mostra `nome` + `numero_pezzi`; **fallback** a `prodotti` per resi vecchi.
- Card "Dati ritiro corriere": mostrare `pv_nome/indirizzo/città/cap/provincia/regione` (o cldm per vecchi), `corriere` (+ `corriere_nome`), `num_reso` (badge "Reso N. {num_reso}"), `ddt_numero/ddt_data`. Rimuovere riferimento BDA.

### 10. A11y (WCAG AA) — tutte le UI sopra
`<label htmlFor>` per ogni input/select; `<select>` nativo per corriere; input condizionale ALTRI con `aria-expanded`/`aria-controls` gestito via stato (mostrare/nascondere); touch target ≥44px; live region per errori; focus management su add/remove linea. Consultare accessibility-lead prima di editare i .tsx (edit-gate).

## Verifica end-to-end (dev :3002 + harness :3011, no prod :3001)

1. Restart dev sito-resi (`kill -9 <pid node dev>`, `rm .next/dev/lock`, `node server.js`) e restart harness :3011.
2. curl POST `/api/resi` come interno (auto-chiuso) con payload nuovo (linee + corriere=GLS + PV manuale) → 201, `stato=approvato`, `num_reso` sequenziale (1, poi 2…).
3. GET dettaglio → ritorna `linee, corriere, pv_*, num_reso`.
4. GET `/api/customer-service/richieste/:uuid/xls` → 200, BIFF8; verifica riga: PV manuale (nome/indirizzo/città/cap/prov inseriti), colli = `num_colli` (campo singolo), "Num. Autorizzazione" = `Aut. N. {num_reso}`, destinatario = "ABC SRL RESI / Via Industria s/n / Pozzolo Formigaro / AL".
5. Verifica webhook → harness inserisce reso #N con campi nuovi; auto-export su disco usa PV manuale + destinatario "ABC SRL RESI".
6. Backward compat: GET dettaglio + XLS di un **reso vecchio** (prodotti/cldm/bda_autorizzazione) → fallback funziona ( mostra prodotti, PV da cldm, autorizzazione BDA).
7. 3 pagine dettaglio + ResoForm + nuova pagina compilano (HTTP 200).
8. num_reso: due inserimenti consecutivi → 1 e 2 (sequenziale).
9. A11y: keyboard nav sul form (tab tra campi, add/remove linee, select corriere → focus su input ALTRI), contrasto, label.

## Out of scope
- Formati XLS diversi per corriere (confermato: corriere solo registrato, formato unico).
- Backfill num_reso su resi vecchi (restano NULL, mostrati come "—").
- Restart prod Express (lascia il default ABC HUB "ABC SRL RESI" attivo dal prossimo restart prod, a discrezione utente).