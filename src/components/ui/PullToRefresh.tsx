'use client';

import { useRef, useState, useCallback } from 'react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

export default function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const isDragging = useRef(false);
  const THRESHOLD = 80;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (containerRef.current?.scrollTop === 0 && !refreshing) {
      startY.current = e.touches[0].clientY;
      isDragging.current = true;
    }
  }, [refreshing]);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging.current || refreshing) return;
      if (containerRef.current?.scrollTop !== 0) {
        isDragging.current = false;
        setPullDistance(0);
        return;
      }
      const diff = e.touches[0].clientY - startY.current;
      if (diff > 0) {
        setPullDistance(Math.min(diff * 0.5, 120));
      }
    },
    [refreshing]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isDragging.current) return;
    isDragging.current = false;

    if (pullDistance > THRESHOLD && !refreshing) {
      setRefreshing(true);
      try {
        await onRefresh();
      } catch {
        // silent
      } finally {
        setRefreshing(false);
      }
    }
    setPullDistance(0);
  }, [pullDistance, refreshing, onRefresh]);

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto h-full"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Indicatore pull */}
      <div
        className="flex items-center justify-center transition-all"
        style={{
          height: `${pullDistance}px`,
          opacity: Math.min(pullDistance / THRESHOLD, 1),
        }}
        aria-hidden="true"
      >
        <div
          className={`w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full ${
            refreshing ? 'animate-spin' : ''
          }`}
        />
      </div>

      {children}
    </div>
  );
}
