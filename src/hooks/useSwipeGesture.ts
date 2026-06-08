'use client';

import { useRef, useState, useCallback } from 'react';

interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

export function useSwipeGesture({ onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown }: SwipeHandlers) {
  const startX = useRef(0);
  const startY = useRef(0);
  const [swiping, setSwiping] = useState(false);

  const threshold = 50;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    setSwiping(true);
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!swiping) return;
      setSwiping(false);

      const diffX = e.changedTouches[0].clientX - startX.current;
      const diffY = e.changedTouches[0].clientY - startY.current;

      if (Math.abs(diffX) > Math.abs(diffY)) {
        if (Math.abs(diffX) > threshold) {
          if (diffX > 0) {
            onSwipeRight?.();
          } else {
            onSwipeLeft?.();
          }
        }
      } else {
        if (Math.abs(diffY) > threshold) {
          if (diffY > 0) {
            onSwipeDown?.();
          } else {
            onSwipeUp?.();
          }
        }
      }
    },
    [swiping, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown]
  );

  return { onTouchStart, onTouchEnd, swiping };
}
