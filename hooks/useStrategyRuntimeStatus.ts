"use client";

import { useEffect, useState } from "react";

import type { RuntimeDisplayState, StrategyRuntimeStatus } from "@/lib/disdex-runtime-status";

export type StrategyRuntimeStatusSnapshot = {
  data: StrategyRuntimeStatus[] | null;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  error: string | null;
};

export function parseRuntimeStatusPayload(payload: unknown): StrategyRuntimeStatus[] | null {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { strategies?: unknown }).strategies)) return null;
  return (payload as { strategies: StrategyRuntimeStatus[] }).strategies;
}

export function runtimeStateLabel(state: RuntimeDisplayState): string {
  return state;
}

export function heartbeatAgeLabel(heartbeatAt: number | null, now = Date.now()): string {
  if (heartbeatAt === null || !Number.isFinite(heartbeatAt)) return "要確認";
  const ageSeconds = Math.max(0, Math.floor((now - heartbeatAt) / 1000));
  if (ageSeconds < 60) return `${ageSeconds}秒前`;
  return `${Math.floor(ageSeconds / 60)}分前`;
}

export function useStrategyRuntimeStatus(): StrategyRuntimeStatusSnapshot {
  const [snapshot, setSnapshot] = useState<StrategyRuntimeStatusSnapshot>({
    data: null,
    loading: true,
    refreshing: false,
    stale: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setSnapshot((current) => ({ ...current, refreshing: true }));
      try {
        const response = await fetch("/api/strategy/runtime-status", { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        const data = response.ok ? parseRuntimeStatusPayload(payload) : null;
        if (!data) throw new Error("runtime status unavailable");
        if (!cancelled) {
          setSnapshot({ data, loading: false, refreshing: false, stale: false, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setSnapshot((current) => ({
            ...current,
            loading: false,
            refreshing: false,
            stale: true,
            error: error instanceof Error ? error.message : "runtime status unavailable",
          }));
        }
      }
    }

    void load();
    const timer = window.setInterval(load, 60000);
    window.addEventListener("auto-trade-live-decision-refresh", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("auto-trade-live-decision-refresh", load);
    };
  }, []);

  return snapshot;
}
