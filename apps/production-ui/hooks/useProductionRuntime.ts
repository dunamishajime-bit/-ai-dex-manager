"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import type { CurrentProductionRuntime } from "@/lib/server/current-production-runtime";

type Snapshot = CurrentProductionRuntime | null;

export function useProductionRuntime() {
  const [snapshot, setSnapshot] = useState<Snapshot>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setSnapshot(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/system/live-runtime?refresh=${Date.now()}`, { cache: "no-store" });
      const data = await response.json() as CurrentProductionRuntime & { error?: string };
      if (!response.ok || data.ok !== true) throw new Error(data.error || "Production runtime unavailable.");
      setSnapshot(data);
      setError(null);
    } catch (cause) {
      setSnapshot(null);
      setError(cause instanceof Error ? cause.message : "Production runtime unavailable.");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [authLoading, refresh]);

  return { snapshot, loading, error, refresh };
}
