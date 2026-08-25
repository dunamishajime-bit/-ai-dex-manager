"use client";

import { useEffect, useState } from "react";

export type LiveStatusSnapshot = {
  ok: boolean;
  readOnly: true;
  tradingMutation: 0;
  status: "LIVE" | "STALE" | "UNAVAILABLE";
  checkedAt: string;
  runnerUpdatedAt?: string;
  strategyId?: string;
  mode?: string;
  activeSymbol?: string;
  reason?: string;
  error?: string;
};

export function useLiveStatus() {
  const [snapshot, setSnapshot] = useState<LiveStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch(`/api/system/live-status?refresh=${Date.now()}`, { cache: "no-store" });
      const data = await response.json() as LiveStatusSnapshot;
      setSnapshot(data);
    } catch {
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return { snapshot, loading };
}
