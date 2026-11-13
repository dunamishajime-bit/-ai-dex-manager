"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import type { V12V4HpSnapshot } from "@/lib/v12-v4-hp-contract";

type State = { snapshot: V12V4HpSnapshot | null; loading: boolean; error: string | null };

function parseSnapshot(value: unknown): V12V4HpSnapshot {
  if (!value || typeof value !== "object") throw new Error("V12 V4 status response invalid.");
  const row = value as Partial<V12V4HpSnapshot>;
  if (row.schema !== "v12-v4-hp-status/v1" || row.readOnly !== true || row.tradingMutation !== 0 ||
    !row.actual || !row.target || !row.freshness || !Array.isArray(row.errors)) {
    throw new Error("V12 V4 status response failed the read-only contract.");
  }
  return row as V12V4HpSnapshot;
}

export function useV12V4HpStatus() {
  const [state, setState] = useState<State>({ snapshot: null, loading: true, error: null });
  const requestRef = useRef<AbortController | null>(null);
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      requestRef.current?.abort();
      requestRef.current = null;
      setState({ snapshot: null, loading: false, error: null });
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState((current) => ({ ...current, loading: true }));
    try {
      const response = await fetch(`/api/system/v12-v4-hp-status?refresh=${Date.now()}`, { cache: "no-store", signal: controller.signal });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(response.status === 401 ? "認証が必要です。" : "V12 V4 runtimeを取得できません。");
      setState({ snapshot: parseSnapshot(data), loading: false, error: null });
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      setState({ snapshot: null, loading: false, error: cause instanceof Error ? cause.message : "V12 V4 runtimeを取得できません。" });
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

  return { ...state, refresh };
}
