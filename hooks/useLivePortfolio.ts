"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { livePortfolioFailureState } from "@/lib/ui/live-portfolio-state";
import { LatestRequestGate } from "@/lib/ui/latest-request";

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
    unrealizedPnlUsd: number;
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
  const requestGate = useRef(new LatestRequestGate()).current;

  const refresh = useCallback(async () => {
    const request = requestGate.begin();
    setLoading(true);
    try {
      const response = await fetch("/api/system/live-portfolio", { cache: "no-store", signal: request.signal });
      const data = (await response.json()) as LivePortfolioSnapshot | { ok?: false; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error("error" in data && data.error ? data.error : "Aster live state unavailable.");
      }
      if (!request.isLatest()) return data;
      setSnapshot(data);
      setError(null);
      return data;
    } catch (nextError) {
      if (!request.isLatest()) return null;
      const failure = livePortfolioFailureState({ snapshot: null, error: null }, nextError instanceof Error ? nextError.message : "Aster live state unavailable.");
      setSnapshot(failure.snapshot);
      setError(failure.error);
      return null;
    } finally {
      if (request.isLatest()) {
        requestGate.finish(request);
        setLoading(false);
      }
    }
  }, [requestGate]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => {
      window.clearInterval(interval);
      requestGate.cancel();
    };
  }, [refresh]);

  return { snapshot, loading, error, refresh };
}
