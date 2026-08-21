"use client";

import { useCallback, useEffect, useState } from "react";

export type LogicServiceState = {
  unit: string;
  activeState: string;
  subState: string;
  mainPid: number;
  active: boolean;
};

export type LogicStatusSnapshot = {
  ok: boolean;
  generatedAt: string;
  release?: string;
  status: "running" | "blocked";
  ownerBinding?: { connected: boolean; walletAddress: string | null; venue: string; strategies: string[] };
  v12: {
    status: "running" | "blocked";
    mode: string;
    enabled: boolean;
    service: LogicServiceState;
    activePositions: Array<{ symbol?: string; side?: string; quantity?: number; gross?: number }>;
    killSwitch?: { active?: boolean; reason?: string } | null;
    manualReview?: string | null;
    reason?: string | null;
  };
  pengu: { status: "running" | "blocked"; service: LogicServiceState };
  v52: { status: "running" | "blocked"; service: LogicServiceState };
};

export function useLogicStatus() {
  const [snapshot, setSnapshot] = useState<LogicStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/system/v12-status", { cache: "no-store" });
      const payload = await response.json() as LogicStatusSnapshot;
      if (!response.ok || payload.ok !== true) throw new Error("ロジック状態を取得できません。");
      setSnapshot(payload);
    } catch {
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return {
    snapshot,
    loading,
    refresh,
    status: snapshot?.status,
    ownerBinding: snapshot?.ownerBinding,
    v12: snapshot?.v12,
    pengu: snapshot?.pengu,
    v52: snapshot?.v52,
  };
}
