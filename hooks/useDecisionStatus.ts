"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import type { DecisionViewInput } from "@/lib/ui/disterminal-ui-view-model";

export type DecisionStatusPayload = DecisionViewInput & {
  ok: boolean;
  readOnly: true;
  tradingMutation: 0;
  checkedAt: string;
  refreshIntervalMinutes: number;
  source: string;
  error?: string;
  v12?: { items: unknown[] };
  v52?: { marketOpen: boolean; marketLabel: string; items: unknown[] };
  v12Observability?: DecisionViewInput["v12Observability"] & Record<string, unknown>;
  penguRuntime?: DecisionViewInput["penguRuntime"] & Record<string, unknown>;
  v52Top2Observability?: DecisionViewInput["v52Top2Observability"] & Record<string, unknown>;
};

export function useDecisionStatus() {
  const [snapshot, setSnapshot] = useState<DecisionStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const refresh = useCallback(async (force = false) => {
    if (!isAuthenticated) {
      setSnapshot(null);
      setError(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/system/decision-status${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      const data = await response.json() as DecisionStatusPayload & { error?: string };
      if (!response.ok || !data?.readOnly) throw new Error(data?.error || "判定データを取得できません。");
      setSnapshot(data);
      setError(data.error || null);
      return data;
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "判定データを取得できません。";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [authLoading, refresh]);

  return { snapshot, loading, error, refresh };
}
