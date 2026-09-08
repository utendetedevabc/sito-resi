// Generazione del manifest ritiri corriere in formato .xls (BIFF8).
// Replica fedele della logica di ABC HUB (src/modules/resi-webhook.js:
// buildResiXls + resolvePv + CARRIER_DEST) adattata alla forma della riga
// `richieste_reso` del sito-resi (numero_ordine_esterno, bda_autorizzazione,
// cldm, ddt_numero, ddt_data, num_colli). L'anagrafica PV viene risolta con
// un join read-only su punti_vendita.db (di ABC HUB); il path e' configurabile
// via env PV_DB_PATH (default: data/punti_vendita.db di ABC HUB).
import path from 'path';
import fs from 'fs';
import XLSX from 'xlsx';
import Database from 'better-sqlite3';

// Path del db anagrafica punti vendita. Default: quello di ABC HUB (dev).
const PV_DB_PATH = process.env.PV_DB_PATH
  || '/home/adimn/Scrivania/tracking-abc-italia-main/data/punti_vendita.db';

const pvDb = fs.existsSync(PV_DB_PATH)
  ? new Database(PV_DB_PATH, { readonly: true })
  : null;

// Destinatario fisso = magazzino corriere (config via env).
const CARRIER_DEST = {
  ragione_sociale: process.env.RESI_CARRIER_DEST_NAME || 'ABC SRL RESI',
  indirizzo: process.env.RESI_CARRIER_DEST_ADDR || 'Via Industria s/n',
  citta: process.env.RESI_CARRIER_DEST_CITY || 'Pozzolo Formigaro',
  prov: process.env.RESI_CARRIER_DEST_PROV || 'AL',
};
const CARRIER_REFERENTE = process.env.RESI_CARRIER_REFERENTE || 'ABC Italia';

function pad2(n) { return String(n).padStart(2, '0'); }

// Data di creazione del manifest in formato DDMMYY (usata sia nell'header
// della riga che nel nome file RITGIO_<DDMMYY>.xls).
export function todayDDMMYY() {
  const d = new Date();
  return `${pad2(d.getDate())}${pad2(d.getMonth() + 1)}${String(d.getFullYear()).slice(-2)}`;
}

// Normalizza una data (ISO YYYY-MM-DD o DD/MM/YYYY o DDMMYY) -> DD/MM/YYYY.
export function normalizeDDMMYYYY(v) {
  if (!v) return '';
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const ddmmyy = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (ddmmyy) return `${ddmmyy[1]}/${ddmmyy[2]}/20${ddmmyy[3]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  return s;
}

// Risolve l'anagrafica PV da punti_vendita via cldm.
function resolvePv(cldm) {
  if (!pvDb || !cldm) return null;
  return pvDb.prepare(
    'SELECT ragione_sociale, indirizzo, localita, cap, provincia FROM punti_vendita WHERE cldm = ?'
  ).get(String(cldm)) || null;
}

// Costruisce il buffer .xls (BIFF8) del manifest ritiri corriere a partire
// da una lista di righe richieste_reso. Stesso header/ordine di RITGIO2836.xls.
export function buildResiXls(rows) {
  const headers = [
    'Data Creazione', 'Num. Autorizzazione', 'Rag. Soc PV', 'Indirizzo', 'Città',
    'Cap', 'Prov.', 'Num. DDT', 'Data DDT', 'Num. Colli', 'Rag. Soc. Destinatario',
    'Indirizzo Destinatario', 'Città Destinatario', 'Prov. Destinatario', 'Ora ritiro', 'REFERENTE',
  ];
  const dataCreazione = todayDDMMYY();
  const aoa = [headers];
  for (const r of rows) {
    // PV: modello nuovo (inserito manualmente in pv_*) con fallback al vecchio
    // modello (resolvePv da cldm) per resi gia' presenti.
    const pv = r.pv_nome
      ? { ragione_sociale: r.pv_nome, indirizzo: r.pv_indirizzo, localita: r.pv_citta, cap: r.pv_cap, provincia: r.pv_provincia }
      : resolvePv(r.cldm);
    // Autorizzazione: modello nuovo = num_reso sequenziale (BDA rimossa);
    // fallback al vecchio bda_autorizzazione / numero_ordine.
    const aut = r.num_reso
      ? `Aut. N. ${r.num_reso}`
      : (r.bda_autorizzazione
          ? `RITIRARE SOLO CON BDA Aut. ${r.bda_autorizzazione}`
          : `RITIRARE SOLO CON BDA Aut. ${r.numero_ordine_esterno}`);
    aoa.push([
      dataCreazione,
      aut,
      pv ? pv.ragione_sociale : '',
      pv ? pv.indirizzo : '',
      pv ? pv.localita : '',
      pv ? pv.cap : '',
      pv ? pv.provincia : '',
      r.ddt_numero || '',
      normalizeDDMMYYYY(r.ddt_data),
      r.num_colli || '',
      CARRIER_DEST.ragione_sociale,
      CARRIER_DEST.indirizzo,
      CARRIER_DEST.citta,
      CARRIER_DEST.prov,
      '0000',
      CARRIER_REFERENTE,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Foglio1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }); // .xls (Excel vecchio)
  return { buf, dataCreazione, filename: `RITGIO_${dataCreazione}.xls` };
}

export const pvDbAvailable = !!pvDb;