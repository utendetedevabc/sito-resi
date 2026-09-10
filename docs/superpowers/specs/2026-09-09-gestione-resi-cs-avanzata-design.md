# Spec — Gestione resi CS avanzata (ricerca, export selezionati, 3 tab, email autorizzazione PDF)

## Goal
Pagina customer-service (interno) del sito-resi: ricerca resi per cldm/num_reso/range date, 3 tab (da gestire / approvati / inviati), export XLS multi-riga dei resi selezionati che li marca "spediti", e per ogni reso approvato invio automatico di una email di autorizzazione (testo + PDF allegato) a due destinatarie fisse via SMTP di ABC HUB.

## Architecture
- **sito-resi** (dev :3002, branch feature/nuovo-modello-reso): estende payload webhook (richiedente/approvatore), API CS (search + 3 view + export-selezionati + transizione spedito), UI CS (3 tab + search + checkbox/export). Tutta testabile su :3002.
- **ABC HUB** (tracking-abc-italia-main, branch feature/resi-autorizzazione-email): riceve il reso approvato via webhook (payload esteso) e, dopo l'INSERT, invia l'email di autorizzazione riusando `src/modules/email-sender.js` (nodemailer, SMTP Gmail già configurato) con un PDF generato da `pdfkit` (nuova dep, pure JS). Fire-and-forget come l'auto-export XLS già esistente. **Non testabile runtime** senza restartare l'harness dev :3011 (vietato dal vincolo porte) → codice pronto, test differito all'operatore.
- L'email parte sul passaggio a `approvato` (sia 2° livello customer-service.js che CS auto-chiuso resi.js), cioè dove già parte il webhook ad ABC HUB.

## Tech stack
sito-resi: Next 16 + Express custom server, SQLite better-sqlite3, zod, React .tsx. UI italiano, WCAG AA.
ABC HUB: Express + nodemailer ^8 + xlsx ^0.18.5 + (nuovo) pdfkit.

## Risposte utente (brainstorming)
- Riga "Autorizzazione richiesta da Direzione (Sup/Aut)" → **RIMOSSA** (era predefinita).
- Export selezionati → **un XLS multi-riga** (riuso buildResiXls).
- Email → **corpo testo + PDF allegato** (pdfkit).
- Tab → **3 tab**: da gestire (in_revisione) | approvati (approvato) | inviati (spedito+completato).

## Flag risolti (con default confermato/proposti)
1. **Codice Interno = cldm zero-padded a 10 cifre** (`cldm.padStart(10,'0')`). Verificato: IPERCOOP CUNEO cldm=520059 → "0000520059" come nell'esempio utente.
2. **Destinatari**: entrambe in **To** — francesca.cacciavillani@abcosmetique.it + raffaella.leardi@abcosmetique.it (default; l'utente può cambiare in To+CC).
3. **DDT/colli mancanti** all'approvazione (opzionali nel form): l'email mostra placeholder `n. — del —` / `n. — colli` (default; non blocca l'approvazione).
4. **"Esporta e invia"** = XLS multi-riga + marca `spedito` in **unica azione**.
5. **Ricerca**: si applica **dentro il tab attivo** (combinata col filtro tab); data = `data_approvazione`.
6. **pdfkit** come libreria PDF (nuova dep ABC HUB).

## Email template (corpo testo, italiano, riga Sup/Aut rimossa)
```
Autorizzazione al reso n. {num_reso} merce da ritirare in nome e per conto di ABC Italia

Con la presente vi preghiamo recarvi presso il nostro cliente: (Codice Interno {cldm_pad10})
{pv_nome}
{pv_indirizzo}
{pv_citta} {pv_cap} - {pv_provincia}
e provvedere al ritiro e alla successiva consegna al nostro magazzino sito in Via Industria s/n, Pozzolo Formigaro (AL)

delle merci che saranno accompagnate dalla bolla di accompagnamento n. {ddt_numero} del {ddt_data}
La spedizione sara' composta da n. {num_colli} colli; delle linee {linee_nomi} per circa {totale_pezzi} pezzi.

Motivo reso {motivo_label} - {note}

La presente autorizzazione dovra' essere allegata alla bolla di accompagnamento al momento del reso presso il nostro magazzino.

Cordiali Saluti
ABC Italia
```
- `cldm_pad10` = cldm.padStart(10,'0').
- `linee_nomi` = nomi delle linee separati da ", "; `totale_pezzi` = somma `numero_pezzi`. Se una sola linea: "delle linee {nome} per circa {N} pezzi". Se zero linee (reso vecchio con prodotti): fallback "dei prodotti" o omit.
- `motivo_label` = mappa enum→it: difettoso→"difettoso", errato→"errato", non_conforme→"non conforme", altro→"ALTRO". (L'esempio mostra "ALTRO" maiuscolo per `altro`.) + " - " + note (se note presente, altrimenti solo label).
- `ddt_numero`/`ddt_data`/`num_colli`: se mancanti → "—" (placeholder).
- `pv_*` dal reso (pv_* manuali o derivati dal cldm).
- **PDF allegato**: stesso testo, header "ABC Italia — Autorizzazione al reso n. {num_reso}", formato lettera A4. Filename: `Autorizzazione_reso_{num_reso}.pdf`.
- **Subject**: `Autorizzazione al reso n. {num_reso} — {pv_nome}`.
- **From**: `SMTP_FROM` (già configurato in ABC HUB). **To**: francesca + raffaella.

## Mappature campi (da richieste_reso + users)
- `num_reso` (reso), `cldm` (reso), `pv_*` (reso), `ddt_numero`/`ddt_data` (reso), `num_colli` (reso), `linee` (JSON reso), `motivo_reso` (reso), `note` (reso).
- `richiedente_nome`/`richiedente_ruolo` = users del `user_id` (chi ha creato il reso).
- `approvatore_nome`/`approvatore_ruolo` = users del `venditore_id` (approvatore 1° livello) per il path 2-livelli; per CS auto-chiuso = il CS stesso (user_id) con ruolo customer_service. → aggiunti al payload webhook.

## Stati resi (sito-resi)
enum: in_attesa, in_revisione, approvato, rifiutato, spedito, completato, annullato.
- NUOVA transizione `approvato → spedito` via "esporta e invia" (POST /api/customer-service/richieste/export).
- NUOVA colonna `data_spedizione` su richieste_reso (addColumnIfMissing).
- `completato` resta non gestito (future); la tab inviati include spedito+completato per forward-compat.

## Global constraints
- UI italiano, WCAG AA (gate a11y .tsx, marker sessione padre presente).
- sito-resi zero-dipendenze (la dip pdfkit va in ABC HUB, non sito-resi).
- Migrazioni idempotenti (addColumnIfMissing + CREATE TABLE IF NOT EXISTS), mai drop.
- Backward compat: resi vecchi (prodotti/cldm/bda_autorizzazione) invariati; webhook payload campi nuovi opzionali.
- Port safety: NON toccare porte ABC HUB (:3000/:3001/:3011) né bot; dev/test sito-resi SOLO :3002; kill via `kill $(lsof -ti:3002)`, MAI pkill.
- ABC HUB email/PDF: codice + commit, NON runtime-test (no restart :3011) → flag operatore.
- Password/secret mai loggati/committati. Credenziali SMTP solo nomi env, mai valori.
- num_reso immutabile dopo creazione.

## Out of scope
- Tab "completato" transizione (future).
- Sostituzione del GLS giornaliero esistente (resta per backward-compat, non marca spedito).
- Autenticazione AD / migrazione SQL Server.
- UI del venditore (la richiesta è solo pagina interno/CS).