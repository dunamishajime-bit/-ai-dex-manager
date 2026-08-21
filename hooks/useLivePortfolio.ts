"use client";

import { useCallback, useEffect, useState } from "react";

export type LivePosition = {
  symbol: string;
  side: "LONG" | "SHORT";
  positionSide: string;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
};

export type LivePortfolioSnapshot = {
  ok: true;
  capturedAt: string;
  account: {
    balanceUsd: number;
    availableUsd: number;
    maintenanceMarginUsd: number;
    initialMarginUsd: number;
    unrealizedPnlUsd: number;
  };
  wallet: {
    address: string;
    venue: string;
    ownerConnected: boolean;
  };
  positions: LivePosition[];
  orders: {
    count: number;
    protectionCount: number;
    items: Array<{
      symbol: string;
      side: string;
      type: string;
      status: string;
      quantity: number;
      protection: boolean;
    }>;
  };
};

export function useLivePortfolio() {
  const [snapshot, setSnapshot] = useState<LivePortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/system/live-portfolio", { cache: "no-store" });
      const data = (await response.json()) as LivePortfolioSnapshot | { ok?: false; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error("error" in data && data.error ? data.error : "Aster live state unavailable.");
      }
      setSnapshot(data);
      setError(null);
      return data;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Aster live state unavailable.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { snapshot, loading, error, refresh };
}
