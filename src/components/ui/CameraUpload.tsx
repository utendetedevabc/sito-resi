'use client';

import { useRef, useState, useCallback } from 'react';
import { CameraIcon, PhotoIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface CameraUploadProps {
  onUpload: (files: File[]) => void;
  maxFiles?: number;
}

export default function CameraUpload({ onUpload, maxFiles = 5 }: CameraUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<{ url: string; name: string }[]>([]);

  const handleCapture = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      const newPreviews = files.map((file) => ({
        url: URL.createObjectURL(file),
        name: file.name,
      }));
      setPreviews((prev) => [...prev, ...newPreviews].slice(0, maxFiles));
      onUpload(files);

      // Reset input to allow re-selecting same files
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [maxFiles, onUpload]
  );

  const removePreview = useCallback(
    (index: number) => {
      setPreviews((prev) => {
        const updated = [...prev];
        URL.revokeObjectURL(updated[index].url);
        updated.splice(index, 1);
        return updated;
      });
    },
    []
  );

  const triggerCapture = useCallback((capture: boolean) => {
    const input = fileInputRef.current;
    if (!input) return;
    if (capture) {
      input.setAttribute('capture', 'environment');
    } else {
      input.removeAttribute('capture');
    }
    input.click();
  }, []);

  return (
    <div>
      {/* Griglia anteprime */}
      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {previews.map((preview, i) => (
            <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-800">
              <img
                src={preview.url}
                alt={`Anteprima foto ${i + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <button
                type="button"
                onClick={() => removePreview(i)}
                className="absolute top-1 right-1 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center min-h-[32px] min-w-[32px]"
                aria-label={`Rimuovi foto ${i + 1}`}
              >
                <XMarkIcon className="w-4 h-4 text-white" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pulsanti upload */}
      {previews.length < maxFiles && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => triggerCapture(true)}
            className="flex-1 flex items-center justify-center gap-2 min-h-[48px] bg-blue-600 text-white rounded-xl font-medium active:bg-blue-700 transition-colors"
          >
            <CameraIcon className="w-5 h-5" aria-hidden="true" />
            <span className="text-sm">Fotocamera</span>
          </button>

          <button
            type="button"
            onClick={() => triggerCapture(false)}
            className="flex-1 flex items-center justify-center gap-2 min-h-[48px] bg-gray-700 text-gray-200 rounded-xl font-medium active:bg-gray-600 transition-colors"
          >
            <PhotoIcon className="w-5 h-5" aria-hidden="true" />
            <span className="text-sm">Galleria</span>
          </button>
        </div>
      )}

      {/* Input file nascosto */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleCapture}
        className="hidden"
        aria-hidden="true"
      />
    </div>
  );
}
