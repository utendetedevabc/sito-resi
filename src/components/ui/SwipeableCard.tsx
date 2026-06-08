'use client';

import { useRef, useState, useCallback } from 'react';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/solid';

interface SwipeableCardProps {
  children: React.ReactNode;
  onApprove?: () => void;
  onReject?: () => void;
}

export default function SwipeableCard({ children, onApprove, onReject }: SwipeableCardProps) {
  const startX = useRef(0);
  const currentX = useRef(0);
  const [translateX, setTranslateX] = useState(0);
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const isDragging = useRef(false);

  const THRESHOLD = 80;

  const reset = useCallback(() => {
    setTranslateX(0);
    setShowApprove(false);
    setShowReject(false);
    isDragging.current = false;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onApprove && !onReject) return;
    startX.current = e.touches[0].clientX;
    isDragging.current = true;
  }, [onApprove, onReject]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const diff = e.touches[0].clientX - startX.current;
    currentX.current = diff;
    setTranslateX(diff);
    setShowApprove(onApprove ? diff < -THRESHOLD / 2 : false);
    setShowReject(onReject ? diff > THRESHOLD / 2 : false);
  }, [onApprove, onReject]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    const diff = currentX.current;

    if (onApprove && diff < -THRESHOLD) {
      onApprove();
    } else if (onReject && diff > THRESHOLD) {
      onReject();
    }
    reset();
  }, [onApprove, onReject, reset]);

  return (
    <div className="relative overflow-hidden rounded-2xl select-none">
      {/* Sfondo swipe sinistra (Approva - Verde) */}
      {onApprove && (
        <div
          className={`absolute inset-0 bg-green-600 flex items-center justify-start pl-6 transition-opacity rounded-2xl ${
            showApprove ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden="true"
        >
          <CheckIcon className="w-8 h-8 text-white" />
          <span className="text-white font-semibold ml-2">Approva</span>
        </div>
      )}

      {/* Sfondo swipe destra (Rifiuta - Rosso) */}
      {onReject && (
        <div
          className={`absolute inset-0 bg-red-600 flex items-center justify-end pr-6 transition-opacity rounded-2xl ${
            showReject ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden="true"
        >
          <span className="text-white font-semibold mr-2">Rifiuta</span>
          <XMarkIcon className="w-8 h-8 text-white" />
        </div>
      )}

      {/* Card contenuto */}
      <div
        className="relative bg-gray-800 rounded-2xl transition-transform will-change-transform"
        style={{ transform: `translateX(${translateX}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
