'use client';

import { useState, useRef, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import CameraUpload from '@/components/ui/CameraUpload';
import LineeForm from '@/components/ui/LineeForm';
import { useToast } from '@/components/ui/Toast';

interface Linea {
  nome: string;
  numero_pezzi: number;
}

interface Props {
  // Dove andare dopo aver creato il reso (es. '/venditore/storico').
  redirectAfter: string;
  // Se true, il redirect diventa `${redirectAfter}/${uuid}` (utile per mandare
  // l'interno al dettaglio del reso appena creato auto-chiuso, dove può subito
  // scaricare il file corriere RITGIO*.xls).
  redirectToDetail?: boolean;
  // Banner informativo opzionale sul flusso (es. "va dritto al CS" / "auto-chiuso").
  noteBanner?: ReactNode;
}

// Form di inserimento reso condiviso tra store_account, venditore e
// customer_service. POST /api/resi (autorizzato per tutti e 3 i ruoli).
// Il server decide lo stato iniziale in base al ruolo:
//   store_account -> in_attesa | venditore -> in_revisione | CS -> approvato (auto-chiuso + webhook)
// Modello nuovo: linee (nome + numero_pezzi) + corriere + PV manuale + num_reso
// sequenziale generato server (restuito nella risposta 201).
export default function ResoForm({ redirectAfter, redirectToDetail, noteBanner }: Props) {
  const router = useRouter();
  const { addToast } = useToast();
  const [numeroOrdine, setNumeroOrdine] = useState('');
  const [motivo, setMotivo] = useState('');
  const [note, setNote] = useState('');
  const [linee, setLinee] = useState<Linea[]>([{ nome: '', numero_pezzi: 1 }]);
  const [corriere, setCorriere] = useState('');
  const [corriereNome, setCorriereNome] = useState('');
  const [pvNome, setPvNome] = useState('');
  const [pvIndirizzo, setPvIndirizzo] = useState('');
  const [pvCitta, setPvCitta] = useState('');
  const [pvCap, setPvCap] = useState('');
  const [pvProvincia, setPvProvincia] = useState('');
  const [pvRegione, setPvRegione] = useState('');
  const [ddtNumero, setDdtNumero] = useState('');
  const [ddtData, setDdtData] = useState('');
  const [numColli, setNumColli] = useState('');
  const [foto, setFoto] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const corriereNomeRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/api/resi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          numero_ordine: numeroOrdine,
          motivo_reso: motivo,
          note: note || undefined,
          linee,
          corriere,
          corriere_nome: corriere === 'ALTRI' ? corriereNome : null,
          pv_nome: pvNome,
          pv_indirizzo: pvIndirizzo,
          pv_citta: pvCitta,
          pv_cap: pvCap,
          pv_provincia: pvProvincia,
          pv_regione: pvRegione || null,
          ddt_numero: ddtNumero || null,
          ddt_data: ddtData || null,
          num_colli: numColli ? Number(numColli) : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Errore creazione richiesta');
        return;
      }

      if (foto.length > 0 && data.uuid) {
        const formData = new FormData();
        foto.forEach((f) => formData.append('foto', f));
        await fetch(`/api/resi/${data.uuid}/foto`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
      }

      addToast('success', data.num_reso ? `Reso N. ${data.num_reso} creato con successo` : 'Richiesta creata con successo');
      router.push(redirectToDetail && data.uuid ? `${redirectAfter}/${data.uuid}` : redirectAfter);
    } catch {
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  }

  function onCorriereChange(val: string) {
    setCorriere(val);
    // Quando si seleziona ALTRI, porta il focus sul campo nome corriere.
    if (val === 'ALTRI') {
      setTimeout(() => corriereNomeRef.current?.focus(), 0);
    } else {
      setCorriereNome('');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="pt-4 space-y-4">
      {noteBanner}

      {error && (
        <div role="alert" className="p-3 bg-red-900/30 text-red-300 rounded-xl border border-red-800 text-sm">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="numero_ordine" className="block text-sm font-medium text-gray-300 mb-1.5">
          Numero Ordine *
        </label>
        <input
          id="numero_ordine"
          type="text"
          inputMode="text"
          required
          pattern="[A-Za-z0-9\-_\/]{3,50}"
          value={numeroOrdine}
          onChange={(e) => setNumeroOrdine(e.target.value)}
          className="input-mobile"
          placeholder="Es. ORD-2026-001"
          autoComplete="off"
        />
      </div>

      <div>
        <label htmlFor="motivo" className="block text-sm font-medium text-gray-300 mb-1.5">
          Motivo Reso *
        </label>
        <select
          id="motivo"
          required
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="input-mobile"
        >
          <option value="" disabled>Seleziona motivo...</option>
          <option value="difettoso">Prodotto difettoso</option>
          <option value="errato">Prodotto errato</option>
          <option value="non_conforme">Non conforme alla descrizione</option>
          <option value="altro">Altro</option>
        </select>
      </div>

      <LineeForm value={linee} onChange={setLinee} />

      <div>
        <label htmlFor="note" className="block text-sm font-medium text-gray-300 mb-1.5">
          Note aggiuntive
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="input-mobile min-h-[100px] resize-y"
          placeholder="Descrivi il problema riscontrato..."
          maxLength={2000}
        />
        <p className="text-xs text-gray-500 mt-1">{note.length}/2000</p>
      </div>

      <fieldset className="card-mobile space-y-4 min-w-0">
        <legend className="px-1 text-sm font-semibold text-gray-200">
          Dati per il ritiro corriere
          <span className="text-gray-500 font-normal"> (consigliato)</span>
        </legend>
        <p className="text-xs text-gray-400 -mt-2">
          Usati per generare il file di ritiro (.xls) dopo le approvazioni.
        </p>

        {/* Corriere */}
        <div>
          <label htmlFor="corriere" className="block text-sm font-medium text-gray-300 mb-1.5">
            Corriere *
          </label>
          <select
            id="corriere"
            required
            value={corriere}
            onChange={(e) => onCorriereChange(e.target.value)}
            className="input-mobile"
          >
            <option value="" disabled>Seleziona corriere...</option>
            <option value="GLS">GLS</option>
            <option value="NIEDDU">NIEDDU</option>
            <option value="TRAMES">TRAMES</option>
            <option value="PARENA">PARENA</option>
            <option value="ALTRI">ALTRI</option>
          </select>
        </div>

        {/* Nome corriere — solo se ALTRI. Live region annuncia la comparsa. */}
        {corriere === 'ALTRI' && (
          <div>
            <label htmlFor="corriere_nome" className="block text-sm font-medium text-gray-300 mb-1.5">
              Nome corriere *
            </label>
            <input
              id="corriere_nome"
              type="text"
              required
              value={corriereNome}
              onChange={(e) => setCorriereNome(e.target.value)}
              className="input-mobile"
              placeholder="Nome del corriere"
              maxLength={100}
              autoComplete="off"
              ref={corriereNomeRef}
            />
          </div>
        )}
        <div role="status" aria-live="polite" className="sr-only">
          {corriere === 'ALTRI' ? 'Inserisci il nome del corriere.' : ''}
        </div>

        {/* Punto vendita (inserimento manuale) */}
        <div className="pt-2 border-t border-gray-700">
          <p className="text-sm font-semibold text-gray-200 mb-3">Punto vendita (ritiro)</p>
          <div className="space-y-3">
            <div>
              <label htmlFor="pv_nome" className="block text-sm font-medium text-gray-300 mb-1.5">
                Nome punto vendita *
              </label>
              <input
                id="pv_nome"
                type="text"
                required
                value={pvNome}
                onChange={(e) => setPvNome(e.target.value)}
                className="input-mobile"
                placeholder="Es. ABC Store Roma"
                maxLength={255}
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="pv_indirizzo" className="block text-sm font-medium text-gray-300 mb-1.5">
                Indirizzo *
              </label>
              <input
                id="pv_indirizzo"
                type="text"
                required
                value={pvIndirizzo}
                onChange={(e) => setPvIndirizzo(e.target.value)}
                className="input-mobile"
                placeholder="Via, numero, città"
                maxLength={255}
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pv_citta" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Città *
                </label>
                <input
                  id="pv_citta"
                  type="text"
                  required
                  value={pvCitta}
                  onChange={(e) => setPvCitta(e.target.value)}
                  className="input-mobile"
                  maxLength={100}
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="pv_cap" className="block text-sm font-medium text-gray-300 mb-1.5">
                  CAP *
                </label>
                <input
                  id="pv_cap"
                  type="text"
                  inputMode="numeric"
                  required
                  pattern="[0-9]{5}"
                  value={pvCap}
                  onChange={(e) => setPvCap(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="input-mobile"
                  placeholder="Es. 00100"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pv_provincia" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Provincia *
                </label>
                <input
                  id="pv_provincia"
                  type="text"
                  required
                  value={pvProvincia}
                  onChange={(e) => setPvProvincia(e.target.value)}
                  className="input-mobile"
                  maxLength={50}
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="pv_regione" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Regione <span className="text-gray-500">(opzionale)</span>
                </label>
                <input
                  id="pv_regione"
                  type="text"
                  value={pvRegione}
                  onChange={(e) => setPvRegione(e.target.value)}
                  className="input-mobile"
                  maxLength={50}
                  autoComplete="off"
                />
              </div>
            </div>
          </div>
        </div>

        {/* DDT + colli */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-700">
          <div>
            <label htmlFor="ddt_numero" className="block text-sm font-medium text-gray-300 mb-1.5">
              Numero DDT
            </label>
            <input
              id="ddt_numero"
              type="text"
              value={ddtNumero}
              onChange={(e) => setDdtNumero(e.target.value)}
              className="input-mobile"
              placeholder="Es. 12345"
              maxLength={30}
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor="ddt_data" className="block text-sm font-medium text-gray-300 mb-1.5">
              Data DDT
            </label>
            <input
              id="ddt_data"
              type="text"
              inputMode="numeric"
              value={ddtData}
              onChange={(e) => setDdtData(e.target.value)}
              className="input-mobile"
              placeholder="GG/MM/AAAA"
              pattern="(0[1-9]|[12]\d|3[01])/(0[1-9]|1[0-2])/\d{4}"
              aria-describedby="ddt_data-hint"
            />
            <p id="ddt_data-hint" className="text-xs text-gray-500 mt-1">Formato GG/MM/AAAA</p>
          </div>
        </div>

        <div>
          <label htmlFor="num_colli" className="block text-sm font-medium text-gray-300 mb-1.5">
            Numero colli
          </label>
          <input
            id="num_colli"
            type="number"
            inputMode="numeric"
            min={1}
            max={9999}
            value={numColli}
            onChange={(e) => setNumColli(e.target.value)}
            className="input-mobile"
            placeholder="1"
            autoComplete="off"
            aria-describedby="num_colli-hint"
          />
          <p id="num_colli-hint" className="text-xs text-gray-500 mt-1">
            Pacchi totali per il corriere (non per linea).
          </p>
        </div>
      </fieldset>

      <div>
        <span className="block text-sm font-medium text-gray-300 mb-1.5">
          Foto <span className="text-gray-500">(max 5)</span>
        </span>
        <CameraUpload onUpload={setFoto} maxFiles={5} />
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {loading ? 'Invio della richiesta in corso.' : ''}
      </div>

      <button type="submit" disabled={loading || !motivo || !corriere} className="btn-mobile">
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            Invio in corso...
          </span>
        ) : (
          'Invia Richiesta Reso'
        )}
      </button>
    </form>
  );
}