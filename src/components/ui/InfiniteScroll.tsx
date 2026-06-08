'use client';

import { useEffect, useRef, useCallback } from 'react';

interface InfiniteScrollProps {
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
  children: React.ReactNode;
}

export default function InfiniteScroll({ onLoadMore, hasMore, loading, children }: InfiniteScrollProps) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry.isIntersecting && hasMore && !loading) {
        onLoadMore();
      }
    },
    [hasMore, loading, onLoadMore]
  );

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;

    observerRef.current = new IntersectionObserver(handleIntersect, {
      rootMargin: '100px',
      threshold: 0,
    });
    observerRef.current.observe(el);

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [handleIntersect]);

  return (
    <div className="space-y-3">
      {children}
      <div ref={loadMoreRef} className="h-12 flex items-center justify-center">
        {loading && (
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" aria-label="Caricamento..." />
        )}
        {!hasMore && !loading && (
          <p className="text-xs text-gray-500">Non ci sono altri elementi</p>
        )}
      </div>
    </div>
  );
}
