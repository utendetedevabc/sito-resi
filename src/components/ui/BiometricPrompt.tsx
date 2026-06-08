'use client';

import { FingerPrintIcon, FaceSmileIcon } from '@heroicons/react/24/outline';

interface BiometricPromptProps {
  onEnable: () => void;
  onSkip: () => void;
}

export default function BiometricPrompt({ onEnable, onSkip }: BiometricPromptProps) {
  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isAndroid = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);

  const biometricName = isIOS
    ? 'Face ID / Touch ID'
    : isAndroid
    ? 'Impronta digitale / Riconoscimento facciale'
    : 'Autenticazione biometrica';
  const Icon = isIOS ? FaceSmileIcon : FingerPrintIcon;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-gray-900 rounded-3xl p-6 w-full max-w-sm animate-slide-up">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center mb-4">
            <Icon className="w-8 h-8 text-blue-500" aria-hidden="true" />
          </div>

          <h2 className="text-xl font-semibold mb-2">Accesso rapido</h2>
          <p className="text-gray-400 text-sm mb-6 leading-relaxed">
            Usa {biometricName} per accedere velocemente senza digitare la password ogni volta.
          </p>

          <button
            onClick={onEnable}
            className="w-full h-12 bg-blue-600 text-white font-semibold rounded-xl mb-3 active:bg-blue-700 transition-colors"
          >
            Attiva {biometricName}
          </button>

          <button
            onClick={onSkip}
            className="text-gray-500 text-sm active:text-gray-300 transition-colors min-h-[48px] min-w-[48px]"
          >
            Non ora
          </button>
        </div>
      </div>
    </div>
  );
}
