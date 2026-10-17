import { useState, useCallback } from 'react';

const STORAGE_KEY = 'pdd_search_history';
const MAX_ITEMS = 5;

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  });

  const add = useCallback((keyword: string) => {
    if (!keyword.trim()) return;
    setHistory(prev => {
      const next = [keyword.trim(), ...prev.filter(k => k !== keyword.trim())].slice(0, MAX_ITEMS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { history, add, clear };
}
