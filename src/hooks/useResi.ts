'use client';

import { useState, useCallback, useRef } from 'react';

interface Filters {
  stato?: string;
  data_da?: string;
  data_a?: string;
}

export function useResi() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchResi = useCallback(async (filters: Filters = {}, page = 1, perPage = 20) => {
    setLoading(true);
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = localStorage.getItem('access_token');
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('per_page', String(perPage));
      if (filters.stato) params.set('stato', filters.stato);
      if (filters.data_da) params.set('data_da', filters.data_da);
      if (filters.data_a) params.set('data_a', filters.data_a);

      const res = await fetch(`/api/resi?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Errore caricamento');
      const json = await res.json();
      setData(json.data || []);
      return json;
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const createReso = useCallback(async (payload: any) => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/api/resi', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err.message };
    }
  }, []);

  const updateReso = useCallback(async (uuid: string, payload: any) => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/resi/${uuid}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      return await res.json();
    } catch (err: any) {
      return { error: err.message };
    }
  }, []);

  const deleteReso = useCallback(async (uuid: string) => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/api/resi/${uuid}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return await res.json();
    } catch (err: any) {
      return { error: err.message };
    }
  }, []);

  return { data, loading, error, fetchResi, createReso, updateReso, deleteReso };
}
