'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileHeader from '@/components/layout/MobileHeader';
import CameraUpload from '@/components/ui/CameraUpload';
import ProdottiForm from '@/components/ui/ProdottiForm';
import { useToast } from '@/components/ui/Toast';

interface Prodotto {
  codice: string;
  descrizione: string;
  quantita: number;
  condizioni: 'integro' | 'danneggiato' | 'aperto' | 'usato';
}

export default function NuovaRichiestaPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const [numeroOrdine, setNumeroOrdine] = useState('');
  const [bda, setBda] = useState('');
  const [motivo, setMotivo] = useState('');
  const [note, setNote] = useState('');
  const [prodotti, setProdotti] = useState<Prodotto[]>([
    { codice: '', descrizione: '', quantita: 1, condizioni: 'integro' },
  ]);
  const [foto, setFoto] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/api/resi', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          numero_ordine: numeroOrdine,
          bda: bda || null,
          motivo_reso: motivo,
          note: note || undefined,
          prodotti,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Errore creazione richiesta');
        return;
      }

      // Upload foto
      if (foto.length > 0 && data.uuid) {
        const formData = new FormData();
        foto.forEach((f) => formData.append('foto', f));
        await fetch(`/api/resi/${data.uuid}/foto`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
      }

      addToast('success', 'Richiesta creata con successo');
      router.push('/dashboard/richieste');
    } catch {
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-gray-950 pb-8">
      <MobileHeader title="Nuova Richiesta" />

      <form onSubmit={handleSubmit} className="pt-4 space-y-4">
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
          <label htmlFor="bda" className="block text-sm font-medium text-gray-300 mb-1.5">
            BDA <span className="text-gray-500">(opzionale)</span>
          </label>
          <input
            id="bda"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={bda}
            onChange={(e) => setBda(e.target.value.replace(/\D/g, ''))}
            className="input-mobile"
            placeholder="Solo numeri"
            maxLength={15}
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

        <ProdottiForm value={prodotti} onChange={setProdotti} />

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

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Foto <span className="text-gray-500">(max 5)</span>
          </label>
          <CameraUpload onUpload={setFoto} maxFiles={5} />
        </div>

        <button
          type="submit"
          disabled={loading || !motivo}
          className="btn-mobile sticky bottom-20 z-30"
        >
          {loading ? (
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Invio in corso...</span>
            </div>
          ) : (
            'Invia Richiesta Reso'
          )}
        </button>
      </form>
    </div>
  );
}
