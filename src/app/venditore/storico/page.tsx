'use client';

import MobileHeader from '@/components/layout/MobileHeader';
import StoricoAzioni from '@/components/storico/StoricoAzioni';

// venditore (responsabile): storico delle proprie azioni (resi approvati /
// rifiutati al 1° livello, accessi). Sostituisce la vecchia lista resi
// (che usava /api/venditore/richieste con stato hardcoded in_attesa — rotto).
export default function StoricoPage() {
  return (
    <div className="min-h-dvh bg-gray-950">
      <MobileHeader title="Storico" />
      <StoricoAzioni subtitle="Cronologia delle tue azioni: resi approvati, rifiutati e accessi." />
    </div>
  );
}