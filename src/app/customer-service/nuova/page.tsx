'use client';

import MobileHeader from '@/components/layout/MobileHeader';
import ResoForm from '@/components/resi/ResoForm';

// customer_service (interno): nuovo reso AUTO-CHIUSO. Stato iniziale
// 'approvato' → il reso viene chiuso subito alla creazione e parte subito
// il webhook ad ABC HUB + generazione file RITGIO*.xls. Nessuna approvazione.
export default function CustomerServiceNuovaPage() {
  return (
    <div className="min-h-dvh bg-gray-950 pb-8">
      <MobileHeader title="Nuova Richiesta" />
      <ResoForm
        redirectAfter="/customer-service/richieste"
        redirectToDetail
        noteBanner={
          <div role="note" className="p-3 bg-green-900/20 border border-green-800 rounded-xl">
            <p className="text-xs text-green-200 leading-relaxed">
              Come interno, il reso viene <strong>approvato e chiuso subito</strong> alla creazione: parte subito il webhook ad ABC HUB e viene generato il file corriere <span className="font-mono">RITGIO*.xls</span>. Nessuna approvazione necessaria.
            </p>
          </div>
        }
      />
    </div>
  );
}