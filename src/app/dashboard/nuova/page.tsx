'use client';

import MobileHeader from '@/components/layout/MobileHeader';
import ResoForm from '@/components/resi/ResoForm';

// store_account (promoter): nuovo reso. Stato iniziale in_attesa → serve
// BOTH approvazioni (responsabile + interno).
export default function NuovaRichiestaPage() {
  return (
    <div className="min-h-dvh bg-gray-950 pb-8">
      <MobileHeader title="Nuova Richiesta" />
      <ResoForm redirectAfter="/dashboard/richieste" />
    </div>
  );
}