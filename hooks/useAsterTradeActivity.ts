"use client";

import { useCallback, useEffect, useState } from "react";

export type AsterTradeStrategy = "V12" | "PENGU" | "V52" | "V96" | "UNKNOWN";

export type AsterTradeEntry = {
  id: string;
  executedAt: string;
  action: "BUY" | "SELL";
  sourceSymbol: string;
  destSymbol: string;
  sourceAmount: number;
  destAmount: number;
  sourceUsdValue: number;
  destUsdValue: number;
  entryPriceUsd?: number;
  exitPriceUsd?: number;
  realizedPnlUsd?: number;
  realizedPnlPct?: number;
  reason: string;
  tradeStatus?: "open" | "closed" | "unmatched_exit";
  strategyId?: AsterTradeStrategy;
  netPnlUsd?: number;
};

type RecentTradeSummary = {
  total: number;
  byStrategy: { V12: number; PENGU: number; V52: number };
};

export type AsterTradeActivity = RecentTradeSummary & { recent24h: RecentTradeSummary };

const EMPTY_RECENT: RecentTradeSummary = { total: 0, byStrategy: { V12: 0, PENGU: 0, V52: 0 } };

export function useAsterTradeActivity() {
  const [entries, setEntries] = useState<AsterTradeEntry[]>([]);
  const [activity, setActivity] = useState<AsterTradeActivity>({ ...EMPTY_RECENT, recent24h: EMPTY_RECENT });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/system/trade-history", { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; entries?: AsterTradeEntry[]; recent24h?: AsterTradeActivity; readOnlyError?: string };
      if (!response.ok || payload.ok !== true) throw new Error(payload.readOnlyError || "Aster取引履歴を取得できません。");
      setEntries(Array.isArray(payload.entries) ? payload.entries : []);
      const recent = payload.recent24h || EMPTY_RECENT;
      setActivity({ ...recent, recent24h: recent });
      setError(payload.readOnlyError || null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Aster取引履歴を取得できません。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { entries, activity, loading, error, refresh };
}
