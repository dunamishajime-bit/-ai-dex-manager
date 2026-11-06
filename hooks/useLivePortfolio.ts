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
  markVerified: boolean;
  pnlVerified: boolean;
};

export type LivePortfolioSnapshot = {
  ok: true;
  capturedAt: string;
  readOnly: true;
  partial: boolean;
  positionSource: "POSITION_RISK" | "ACCOUNT_SNAPSHOT" | "ACCOUNT_DISCREPANCY" | "UNAVAILABLE";
  availability: { account: boolean; positions: boolean; orders: boolean };
  account: {
    balanceUsd: number;
    availableUsd: number;
    unrealizedPnlUsd: number;
  };
  positions: LivePosition[];
  strategyUsage: {
    v12: {
      positionCount: number;
      gross: number;
      symbols: string[];
    } | null;
  };
  orders: {
    count: number;
    protectionCount: number;
    entryOrderCount: number;
    items: Array<{
      symbol: string;
      side: string;
      type: string;
      status: string;
      quantity: number;
      reduceOnly: boolean;
      closePosition: boolean;
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
      const response = await fetch("/api/system/live-portfolio", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        setSnapshot(null);
        window.dispatchEvent(new Event("disdex-owner-session-expired"));
        throw new Error("HPのログイン認証が期限切れです。再ログインしてください。");
      }
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Live portfolio API returned a non-JSON response.");
      }
      const data = (await response.json()) as LivePortfolioSnapshot | { ok?: false; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error("error" in data && data.error ? data.error : "Aster live state unavailable.");
      }
      setSnapshot(data);
      setError(null);
      return data;
    } catch (nextError) {
      // Never show a previously successful balance as though it were current.
      setSnapshot(null);
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
