"use client";

import { useV12V4HpStatus } from "@/hooks/useV12V4HpStatus";
import { v12V4LiveStatus } from "@/lib/v12-v4-hp-ui";

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
  const { snapshot: v4Snapshot, loading, error } = useV12V4HpStatus();
  const status = v12V4LiveStatus(v4Snapshot);
  const snapshot: LiveStatusSnapshot | null = v4Snapshot ? {
    ok: status === "LIVE",
    readOnly: true,
    tradingMutation: 0,
    status,
    checkedAt: new Date(v4Snapshot.timestamps.checkedAt).toISOString(),
    runnerUpdatedAt: v4Snapshot.timestamps.heartbeatUpdatedAt === null
      ? undefined
      : new Date(v4Snapshot.timestamps.heartbeatUpdatedAt).toISOString(),
    strategyId: "V12_V4",
    mode: v4Snapshot.actual.v4RunnerMode,
    reason: status === "LIVE"
      ? "V12 V4 primary runtime is LIVE_VERIFIED."
      : status === "STALE"
        ? "V12 V4 primary heartbeat is stale."
        : `V12 V4 primary is not verified (${v4Snapshot.displayStatus}).`,
  } : error ? {
    ok: false,
    readOnly: true,
    tradingMutation: 0,
    status: "UNAVAILABLE",
    checkedAt: new Date().toISOString(),
    reason: error,
    error,
  } : null;
  return { snapshot, loading };
}
