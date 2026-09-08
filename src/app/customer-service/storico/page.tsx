'use client';

import MobileHeader from '@/components/layout/MobileHeader';
import StoricoAzioni from '@/components/storico/StoricoAzioni';

// customer_service (interno): storico delle proprie azioni (resi approvati /
// rifiutati definitivamente, resi creati auto-chiusi, accessi).
export default function CustomerServiceStoricoPage() {
  return (
    <div className="min-h-dvh bg-gray-950">
      <MobileHeader title="Storico" />
      <StoricoAzioni subtitle="Cronologia delle tue azioni: resi approvati, rifiutati, creati e accessi." />
    </div>
  );
}