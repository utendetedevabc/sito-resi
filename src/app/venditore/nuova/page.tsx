'use client';

import MobileHeader from '@/components/layout/MobileHeader';
import ResoForm from '@/components/resi/ResoForm';

// venditore (responsabile): nuovo reso. Stato iniziale in_revisione → salta
// il 1° livello (il proprio) e va dritto al customer service (interna) per
// l'approvazione finale.
export default function VenditoreNuovaPage() {
  return (
    <div className="min-h-dvh bg-gray-950 pb-8">
      <MobileHeader title="Nuova Richiesta" />
      <ResoForm
        redirectAfter="/venditore/storico"
        noteBanner={
          <div role="note" className="p-3 bg-blue-900/20 border border-blue-800 rounded-xl">
            <p className="text-xs text-blue-200 leading-relaxed">
              Come responsabile, il reso salta la tua approvazione e va diretto al customer service (interna) per l'approvazione finale.
            </p>
          </div>
        }
      />
    </div>
  );
}