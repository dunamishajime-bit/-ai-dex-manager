"use client";

import { useEffect, useState } from "react";

import type { RuntimeDisplayState, RuntimeStrategyId, StrategyRuntimeStatus } from "@/lib/disdex-runtime-status";

export type StrategyRuntimeStatusSnapshot = {
  data: StrategyRuntimeStatus[] | null;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  error: string | null;
};

const STRATEGY_IDS: readonly RuntimeStrategyId[] = [
  "V12_X1.00_ALL",
  "PENGU_DUAL_LS_V2_FINAL",
  "V52_ASTER_ONLY",
  "QUALITY102_CAUSAL_V1",
];

const DISPLAY_NAMES: Record<RuntimeStrategyId, string> = {
  "V12_X1.00_ALL": "V12 X1.00 ALL",
  "PENGU_DUAL_LS_V2_FINAL": "PENGU Dual LS V2 Final",
  "V52_ASTER_ONLY": "V52 ASTER Only",
  "QUALITY102_CAUSAL_V1": "Quality102 Causal V1",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === "number" && Number.isFinite(value);
}

function isStatus(value: unknown): value is StrategyRuntimeStatus {
  if (!isRecord(value) || !STRATEGY_IDS.includes(value.strategyId as RuntimeStrategyId)) return false;
  if (typeof value.displayName !== "string" || !["LIVE", "WAITING", "FAIL_CLOSED", "MANUAL_REVIEW", "RECOVERING", "要確認"].includes(value.state as string)) return false;
  if (typeof value.serviceActive !== "boolean" || !["ACTIVE", "INACTIVE", "UNAVAILABLE"].includes(value.serviceActivity as string)) return false;
  if (!isFiniteNumberOrNull(value.heartbeatAt) || (value.runtimeSha !== null && typeof value.runtimeSha !== "string") || typeof value.releaseShaMatch !== "boolean") return false;
  if (typeof value.safetyReason !== "string" || (value.lastDecision !== null && typeof value.lastDecision !== "string")) return false;
  if (!isRecord(value.recovery) || !["NONE", "RESTARTED", "HELD_FAIL_CLOSED", "EXHAUSTED"].includes(value.recovery.action as string) || typeof value.recovery.attempts !== "number" || !Number.isFinite(value.recovery.attempts)) return false;
  if (!isRecord(value.gross) || !isFiniteNumberOrNull(value.gross.strategyCap) || !isFiniteNumberOrNull(value.gross.cryptoCap) || !isFiniteNumberOrNull(value.gross.totalCap)) return false;
  if (!Array.isArray(value.symbols) || !value.symbols.every((symbol) => isRecord(symbol) && typeof symbol.symbol === "string" && typeof symbol.eligible === "boolean" && typeof symbol.reason === "string")) return false;
  if (value.strategyId === "QUALITY102_CAUSAL_V1") {
    const quality102 = value.quality102;
    if (!isRecord(quality102) || quality102.selectorMode !== "DERIVED_HIGH_VOL_ONLY" || quality102.historicalSelectorParity !== false || quality102.brkLiveEnabled !== false) return false;
  }
  return true;
}

export function createUnavailableRuntimeStatus(): StrategyRuntimeStatus[] {
  return STRATEGY_IDS.map((strategyId) => ({
    strategyId,
    displayName: DISPLAY_NAMES[strategyId],
    state: "要確認",
    serviceActive: false,
    serviceActivity: "UNAVAILABLE",
    heartbeatAt: null,
    runtimeSha: null,
    releaseShaMatch: false,
    safetyReason: "runtime status unavailable",
    lastDecision: null,
    recovery: { action: "HELD_FAIL_CLOSED", attempts: 0 },
    gross: { strategyCap: null, cryptoCap: null, totalCap: null },
    symbols: [],
    ...(strategyId === "QUALITY102_CAUSAL_V1" ? { quality102: { selectorMode: "DERIVED_HIGH_VOL_ONLY", historicalSelectorParity: false, brkLiveEnabled: false } } : {}),
  }));
}

export function parseRuntimeStatusPayload(payload: unknown): StrategyRuntimeStatus[] {
  const strategies = isRecord(payload) ? payload.strategies : undefined;
  if (!Array.isArray(strategies) || strategies.length !== STRATEGY_IDS.length || !strategies.every(isStatus)) return createUnavailableRuntimeStatus();
  const ids = strategies.map((item) => item.strategyId);
  if (new Set(ids).size !== STRATEGY_IDS.length || STRATEGY_IDS.some((id) => !ids.includes(id))) return createUnavailableRuntimeStatus();
  return strategies;
}

export function projectRuntimeStatusForDisplay(data: StrategyRuntimeStatus[], stale: boolean): StrategyRuntimeStatus[] {
  if (!stale) return data;
  return data.map((item) => ({
    ...item,
    state: "要確認",
    serviceActive: false,
    serviceActivity: "UNAVAILABLE",
    releaseShaMatch: false,
    safetyReason: `要確認: status stale; last known reason: ${item.safetyReason}`,
    lastDecision: item.lastDecision ? `要確認: stale; last known decision: ${item.lastDecision}` : null,
    recovery: { action: "HELD_FAIL_CLOSED", attempts: item.recovery.attempts },
    symbols: item.symbols.map((symbol) => ({ ...symbol, eligible: false, reason: `要確認: status stale; last known: ${symbol.reason || "reason unavailable"}` })),
  }));
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
            data: current.data ?? createUnavailableRuntimeStatus(),
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
