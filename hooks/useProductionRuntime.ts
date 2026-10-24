"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { parseProductionRuntimeResponse } from "@/lib/ui/production-runtime";
import type { CurrentProductionRuntime } from "@/lib/server/current-production-runtime";

export function useProductionRuntime() {
  const [snapshot, setSnapshot] = useState<CurrentProductionRuntime | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    requestRef.current = null;

    if (!isAuthenticated) {
      setSnapshot(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);

    try {
      const response = await fetch(`/api/system/live-runtime?refresh=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = parseProductionRuntimeResponse(response.ok, await response.json());
      setSnapshot(data);
      setError(null);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      setSnapshot(null);
      setError(cause instanceof Error ? cause.message : "Production runtime unavailable; manual review required.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      window.clearInterval(timer);
      requestRef.current?.abort();
    };
  }, [authLoading, refresh]);

  return { snapshot, loading, error, refresh };
}
