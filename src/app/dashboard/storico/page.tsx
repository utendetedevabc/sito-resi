'use client';

import MobileHeader from '@/components/layout/MobileHeader';
import StoricoAzioni from '@/components/storico/StoricoAzioni';

// store_account (promoter): storico delle proprie azioni.
export default function DashboardStoricoPage() {
  return (
    <div className="min-h-dvh bg-gray-950">
      <MobileHeader title="Storico" />
      <StoricoAzioni subtitle="Cronologia delle tue azioni: resi creati, annullati e accessi." />
    </div>
  );
}