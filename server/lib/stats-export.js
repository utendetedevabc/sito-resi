// Estrazione massiva dei resi per le STATISTICHE interne (2026-09-22, P4
// richieste operatori). Diverso dal manifest corriere (xls-export.js): qui
// servono linee e pezzi di ogni reso, tutti gli stati, per analisi interne —
// il file NON va al corriere. Formato .xlsx (non BIFF8) con 2 fogli:
//   "Resi"           — una riga per reso (linee aggregate in testo + totale pezzi)
//   "Dettaglio linee" — una riga per linea prodotto
import XLSX from 'xlsx';
import { todayDDMMYY } from './xls-export.js';

// Label umane per le colonne Motivo/Stato (i valori DB sono enum snake_case).
const MOTIVO_LABEL = {
  difettoso: 'Difettoso',
  errato: 'Errato',
  non_conforme: 'Non conforme',
  residuo_promo: 'Residuo promo autorizzato da sede',
  altro: 'Altro',
};
const STATO_LABEL = {
  in_attesa: 'In attesa',
  in_revisione: 'In revisione',
  approvato: 'Approvato',
  spedito: 'Spedito',
  completato: 'Completato',
  rifiutato: 'Rifiutato',
  annullato: 'Annullato',
};

// linee e' JSON su colonna TEXT: [{nome, numero_pezzi}] (numero_pezzi opzionale
// nei resi molto vecchi). Mai throw: un JSON malformato degrada a [] (statistica
// incompleta, non errore 500 su tutta l'estrazione).
function parseLinee(r) {
  if (typeof r.linee !== 'string' || !r.linee.trim()) return [];
  try {
    const arr = JSON.parse(r.linee);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Corriere mostrato all'operatore: nome libero per ALTRI, valore raw altrimenti
// (stesso criterio delle pagine di dettaglio).
function corriereLabel(r) {
  if (r.corriere === 'ALTRI') return r.corriere_nome || 'ALTRI';
  return r.corriere || '';
}

// Costruisce il buffer .xlsx delle statistiche resi a partire da righe
// richieste_reso (con richiedente_nome/venditore_nome dal join della SELECT).
export function buildStatsXlsx(rows) {
  const headers = [
    'N. Reso', 'Numero ordine', 'Stato', 'CLDM', 'PV', 'Gruppo', 'Richiedente', 'Venditore',
    'Motivo', 'Motivazione Altro', 'Corriere', 'Colli', 'DDT Numero', 'DDT Data',
    'Linee', 'Totale pezzi', 'Data creazione', 'Data approvazione',
  ];
  const aoaResi = [headers];
  const aoaLinee = [['N. Reso', 'Numero ordine', 'Linea', 'Pezzi']];

  for (const r of rows) {
    const linee = parseLinee(r);
    const totale = linee.reduce((s, l) => s + (Number(l.numero_pezzi) || 0), 0);
    const lineeTxt = linee
      .map((l) => `${l.nome}${l.numero_pezzi != null ? ` (${l.numero_pezzi} pezzi)` : ''}`)
      .join('; ');
    aoaResi.push([
      r.num_reso ?? '',
      r.numero_ordine_esterno || '',
      STATO_LABEL[r.stato] || r.stato || '',
      r.cldm || '',
      r.pv_nome || '',
      // 2026-09-28 P3: gruppo PV (clit) — nome, o codice se il nome manca
      // (resi pre-backfill con anagrafica parziale), '' se del tutto assente.
      r.pv_clit_nome || r.pv_clit_codice || '',
      r.richiedente_nome || '',
      r.venditore_nome || '',
      MOTIVO_LABEL[r.motivo_reso] || r.motivo_reso || '',
      r.motivo_altro || '',
      corriereLabel(r),
      r.num_colli ?? '',
      r.ddt_numero || '',
      r.ddt_data || '',
      lineeTxt,
      totale,
      r.created_at || '',
      r.data_approvazione || '',
    ]);
    for (const l of linee) {
      aoaLinee.push([
        r.num_reso ?? '',
        r.numero_ordine_esterno || '',
        l.nome || '',
        l.numero_pezzi ?? '',
      ]);
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoaResi), 'Resi');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoaLinee), 'Dettaglio linee');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buf, filename: `Statistiche_resi_${todayDDMMYY()}.xlsx` };
}