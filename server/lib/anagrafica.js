// server/lib/anagrafica.js — Import e lookup dell'anagrafica punti vendita
// interna, ricavata da ZSD127.xlsx (share SMB, anagrafica_siti_rares).
// Aggiornamento: settimanale (domenica 12:00, vedi server.js) + refresh forzato
// (POST /api/admin/anagrafica/refresh). Il form resi legge solo da qui.
import fs from 'fs';
import XLSX from 'xlsx';
import db from './db.js';
import logger from './logger.js';

// Path del file anagrafica sulla share (montaggio ro /mnt/bolle-scan-data).
export const ZSD127_PATH = process.env.ZSD127_PATH
  || '/mnt/bolle-scan-data/Servizi/InformazioniI Generali/anagrafica_siti_rares/ZSD127.xlsx';

// Mappa campo → header atteso nella riga 1 del foglio ZSD127.
// 19/10/2026: il file sulla share è CAMBIATO di formato senza preavviso
// (7544→7585 righe, +4 colonne) e la colonna "linee" si è spostata da
// AS=44 ad AW=48; il refresh domenicale con indice fisso ha importato per
// TUTTI i PV i valori "Force de vente" (IMA/ILX) al posto delle linee
// vere, senza nessun errore. Per questo l'import ora aggancia le colonne
// per NOME HEADER (il file può spostarle quanto vuole) e "fallback" è solo
// l'indice dell'ultima versione verificata, usato SOLO per il confronto.
// Se un header non si trova → ABORT dell'import (dati esistenti intatti):
// meglio anagrafica ferma ma corretta che fresca ma corrotta.
const HEADER_MAP = {
  clitCod: { header: 'Client facturé', fallback: 0 },     // A=0  gruppo PV (clit)
  clitNome: { header: 'CLIFRS', fallback: 1 },           // B=1  nome gruppo
  cldm: { header: 'Code client commandé', prefix: true, fallback: 20 }, // U=20
  nome: { header: 'CLICRS', fallback: 21 },              // V=21
  indirizzo: { header: 'CLICADR', fallback: 22 },        // W=22
  citta: { header: 'CLICVIL', fallback: 23 },           // X=23
  cap: { header: 'CLICCP', fallback: 24 },              // Y=24
  prov: { header: 'CLICBD', fallback: 25 },              // Z=25
  regione: { header: 'CLICREG', fallback: 26 },          // AA=26
  respCod: { header: 'CLICRP2', fallback: 37 },          // AL=37
  respNome: { header: 'CLICRP2N', fallback: 38 },       // AM=38
  promoCod: { header: 'CLICRP1', fallback: 39 },         // AN=39
  promoNome: { header: 'CLICRP1N', fallback: 40 },      // AO=40
  linee: { header: 'linee', fallback: 48 },              // AW=48 (dash-separate)
};

// Risolve gli indici colonna dagli header reali del foglio. Ritorna
// { col, warnings, missing }: `missing` elenca i campi il cui header non
// esiste (in quel caso l'import va interrotto dal chiamante).
function buildColMap(headerRow) {
  const headers = (headerRow || []).map((h) =>
    h == null ? '' : String(h).replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  );
  const col = {};
  const warnings = [];
  const missing = [];
  for (const [k, spec] of Object.entries(HEADER_MAP)) {
    const want = spec.header.toLowerCase();
    const idx = spec.prefix
      ? headers.findIndex((h) => h.startsWith(want))
      : headers.indexOf(want);
    if (idx < 0) {
      missing.push(`${k} (header "${spec.header}")`);
    } else {
      if (idx !== spec.fallback) {
        warnings.push(`${k}: header "${spec.header}" spostato a colonna ${idx} (attesa ${spec.fallback}) — file aggiornato`);
      }
      col[k] = idx;
    }
  }
  return { col, warnings, missing };
}

// 2026-09-28 P3: backfill dei gruppi clit sui resi storici (denormalizzazione
// pv_clit_codice/pv_clit_nome in richieste_reso). Idempotente: tocca solo le
// righe ancora NULL. Eseguito sia al boot (server/lib/db.js) sia qui, a fine
// import: al primo avvio dopo il deploy l'import esteso non è ancora girato e
// il backfill al boot popolerebbe 0 righe — ripeterlo qui chiude il ciclo
// boot→import→backfill. Resi con cldm non in anagrafica restano NULL.
export function backfillPvClit() {
  try {
    const info = db.prepare(
      `UPDATE richieste_reso SET
         pv_clit_codice = a.clit_codice, pv_clit_nome = a.clit_nome
       FROM anagrafica_pv a
       WHERE richieste_reso.cldm = a.cldm AND richieste_reso.pv_clit_codice IS NULL`
    ).run();
    if (info.changes > 0) logger.info(`[Anagrafica] Backfill gruppi clit: ${info.changes} resi aggiornati`);
    return info.changes;
  } catch (err) {
    logger.error(`[Anagrafica] Errore backfill pv_clit: ${err.message}`);
    return 0;
  }
}

// Estrae il nome (senza telefono) da "NOME COGNOME 3351234567".
function parseNomePersona(raw) {
  if (raw == null) return '';
  const clean = String(raw).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || clean.toUpperCase() === 'PRIVATI') return clean || '';
  return clean.replace(/\+?\d{6,}\s*$/, '').replace(/[-\s]+$/, '').trim();
}

function cell(r, k) {
  const v = r[k];
  return v != null ? String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : '';
}

// Importa (o aggiorna) l'anagrafica. Non svuota la tabella se la source manca.
export function refreshAnagrafica() {
  if (!fs.existsSync(ZSD127_PATH)) {
    logger.warn(`[Anagrafica] File non trovato: ${ZSD127_PATH} — mantengo dati esistenti`);
    return { imported: 0, updated: 0, total: 0, source: ZSD127_PATH, source_exists: false };
  }
  const wb = XLSX.readFile(ZSD127_PATH, { cellDates: false });
  const ws = wb.Sheets['ZSD127'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  const now = new Date().toISOString();

  // Aggancio colonne per NOME HEADER (robusto agli spostamenti di colonna).
  const { col: COL, warnings, missing } = buildColMap(rows[0]);
  for (const w of warnings) logger.warn(`[Anagrafica] ${w}`);
  if (missing.length > 0) {
    const total = db.prepare('SELECT COUNT(*) as c FROM anagrafica_pv').get().c;
    logger.error(`[Anagrafica] ABORT import: header mancanti o irriconoscibili nel file → ${missing.join(', ')}. Mantengo i ${total} record esistenti.`);
    return { imported: 0, updated: 0, total, source: ZSD127_PATH, source_exists: true, error: `Header mancanti: ${missing.join(', ')}` };
  }

  const upsert = db.prepare(
    `INSERT INTO anagrafica_pv (cldm, clit_codice, clit_nome, nome, indirizzo, citta, cap, provincia, regione, resp_codice, resp_nome, promo_codice, promo_nome, linee, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(cldm) DO UPDATE SET
       clit_codice=excluded.clit_codice, clit_nome=excluded.clit_nome,
       nome=excluded.nome, indirizzo=excluded.indirizzo, citta=excluded.citta, cap=excluded.cap,
       provincia=excluded.provincia, regione=excluded.regione,
       resp_codice=excluded.resp_codice, resp_nome=excluded.resp_nome,
       promo_codice=excluded.promo_codice, promo_nome=excluded.promo_nome,
       linee=excluded.linee, updated_at=excluded.updated_at`
  );
  let inserted = 0, updated = 0;
  const tx = db.transaction((items) => {
    for (const it of items) {
      const info = upsert.run(...it);
      if (info.changes > 0 && info.lastInsertRowid === info.changes) inserted++;
      else updated++;
    }
  });

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const cldm = cell(r, COL.cldm);
    if (!cldm || !/^\d+$/.test(cldm)) continue; // CLDM numerico obbligatorio
    items.push([
      cldm,
      cell(r, COL.clitCod),
      cell(r, COL.clitNome),
      cell(r, COL.nome),
      cell(r, COL.indirizzo),
      cell(r, COL.citta),
      cell(r, COL.cap),
      cell(r, COL.prov),
      cell(r, COL.regione),
      cell(r, COL.respCod),
      parseNomePersona(cell(r, COL.respNome)),
      cell(r, COL.promoCod),
      parseNomePersona(cell(r, COL.promoNome)),
      cell(r, COL.linee),
      now,
    ]);
  }
  // Guardia anti-shift: se la colonna agganciata come cldm contiene pochi
  // valori numerici, il file è irriconoscibile → ABORT (niente garbage).
  const righeDati = Math.max(0, rows.length - 1);
  if (righeDati > 0 && items.length < righeDati * 0.5) {
    const total = db.prepare('SELECT COUNT(*) as c FROM anagrafica_pv').get().c;
    logger.error(`[Anagrafica] ABORT import: solo ${items.length} cldm validi su ${righeDati} righe (colonna agganciata a ${COL.cldm}) — file cambiato oltre ogni riconoscimento. Mantengo i ${total} record esistenti.`);
    return { imported: 0, updated: 0, total, source: ZSD127_PATH, source_exists: true, error: 'Colonna cldm non riconosciuta' };
  }

  tx(items);
  // 2026-09-28 P3: dopo l'import, backfill dei gruppi sui resi storici.
  backfillPvClit();
  const total = db.prepare('SELECT COUNT(*) as c FROM anagrafica_pv').get().c;
  logger.info(`[Anagrafica] Importati ${items.length} record (tabella totale: ${total}) da ${ZSD127_PATH}`);
  return { imported: inserted, updated, total, source: ZSD127_PATH, source_exists: true };
}

export function lookupPvByCldm(cldm) {
  if (!cldm) return null;
  const row = db.prepare('SELECT * FROM anagrafica_pv WHERE cldm = ?').get(String(cldm).trim());
  if (!row) return null;
  return {
    ...row,
    linee: row.linee ? row.linee.split('-').map(s => s.trim()).filter(Boolean) : [],
  };
}

export function searchPv(q, limit = 20) {
  const term = String(q || '').trim();
  if (term.length < 1) return [];
  const like = `%${term}%`;
  return db.prepare(
    `SELECT cldm, nome, citta, provincia FROM anagrafica_pv
     WHERE cldm LIKE ? OR nome LIKE ? COLLATE NOCASE
       OR clit_nome LIKE ? COLLATE NOCASE
     ORDER BY LENGTH(cldm) ASC, nome ASC LIMIT ?`
  ).all(like, like, like, Math.min(parseInt(limit) || 20, 100));
}

export function anagraficaStatus() {
  const row = db.prepare('SELECT COUNT(*) as count, MAX(updated_at) as last_updated FROM anagrafica_pv').get();
  return {
    count: row.count,
    last_updated: row.last_updated,
    source: ZSD127_PATH,
    source_exists: fs.existsSync(ZSD127_PATH),
  };
}