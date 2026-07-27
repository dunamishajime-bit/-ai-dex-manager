"use client";

import { useCallback, useEffect, useState } from "react";

type AsterPosition = {
  symbol: string;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  positionSide?: string;
};

export type AsterAccount = {
  address: string;
  usdtBalance: number;
  usdtAvailable: number;
  usdtCrossWalletBalance: number;
  unrealizedPnl: number;
  positions: AsterPosition[];
  fetchedAt: string;
};

export function useAsterAccount() {
  const [account, setAccount] = useState<AsterAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/aster/account", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(String(payload?.error || "Aster残高を取得できません。"));
      setAccount(payload as AsterAccount);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Aster残高を取得できません。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { account, loading, error, refresh };
}
