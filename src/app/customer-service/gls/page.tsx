'use client';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';

// Live region visivamente nascosta ma annunciata agli screen reader.
// globals.css non definisce `.sr-only`, usiamo stile inline (clip rect classico WCAG).
const srOnlyStyle: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: '0',
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: '0',
};

export default function GlsGiornalieroPage() {
  const { addToast } = useToast();
  const [data, setData] = useState(() => new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  async function scarica() {
    if (!data) {
      addToast('error', 'Seleziona una data');
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/customer-service/gls/giornaliero?data=${data}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        addToast('error', d.error || 'Nessun reso GLS per questa data');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `RITGIO_GLS_${data.replaceAll('-', '')}.xls`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      addToast('success', 'File GLS generato e scaricato');
    } catch {
      addToast('error', 'Errore generazione file GLS');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pt-4 space-y-4">
      <h1 className="text-2xl font-bold text-white">File GLS giornaliero</h1>
      <p className="text-sm text-gray-400">
        Genera un unico file con tutti i resi approvati dall&apos;interno nella giornata con corriere GLS.
      </p>
      <div className="space-y-3">
        <div>
          <label htmlFor="data" className="block text-sm font-medium text-gray-300 mb-1.5">
            Data
          </label>
          <input
            id="data"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="input-mobile"
          />
        </div>
        <button
          onClick={scarica}
          disabled={loading}
          aria-busy={loading}
          className="btn-mobile min-h-[48px]"
        >
          {loading ? 'Generazione…' : 'Genera e scarica file GLS'}
        </button>
        {/* Live region: annuncia lo stato di caricamento agli SR senza spostare il focus */}
        <span aria-live="polite" style={srOnlyStyle}>
          {loading ? 'Generazione del file in corso…' : ''}
        </span>
      </div>
    </div>
  );
}