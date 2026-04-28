'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReportHistoryEntry } from '@/lib/types/reports';

const KEY = 'media-ops:report-history:v1';
const MAX = 10;

function safeRead(): ReportHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function useReportHistory() {
  const [history, setHistory] = useState<ReportHistoryEntry[]>([]);

  useEffect(() => {
    setHistory(safeRead());
  }, []);

  const add = useCallback((entry: Omit<ReportHistoryEntry, 'id' | 'generatedAt'>) => {
    const newEntry: ReportHistoryEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      generatedAt: new Date().toISOString(),
    };
    setHistory((prev) => {
      const next = [newEntry, ...prev].slice(0, MAX);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // quota or disabled — bỏ qua
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(KEY);
    } catch {}
  }, []);

  return { history, add, clear };
}
