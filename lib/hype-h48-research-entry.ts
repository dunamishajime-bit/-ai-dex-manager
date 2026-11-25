/**
 * Source-faithful, READ-ONLY H48R4_WSIG candidate reconstruction.
 *
 * Research: C:\\tmp\\disdex-bt-20251001-20261001\\
 * hype_h48r4_market_regime_gate_pretarget_v1_20261113.py and
 * hype_h48r4_pretarget_winner_signature_v1_20261114.py
 * Frozen selected PRE-only rule, not TARGET/FORWARD-refit. The research
 * FORWARD30 sample was two trades (50% win-rate, negative average).
 *
 * This module grants NO order authority. The current TREND runner still has
 * STOP/TP semantics distinct from certified H48_TIME_ONLY.
 */
import { createHypeH48TimeOnlyContract, type HypeH48TimeOnlyContract } from "./hype-stable4-time-only-contract";

export const H48_RESEARCH_ENTRY_ROUTE = "HYPE_REDESIGN_CAUSAL_H48R4_WSIG" as const;
export const H48_RESEARCH_HOUR_MS = 3_600_000;
export const H48_RESEARCH_GRID_MS = 6 * H48_RESEARCH_HOUR_MS;
export const H48_RESEARCH_HOLD_MS = 48 * H48_RESEARCH_HOUR_MS;
export const H48_RESEARCH_OBSERVATION_WINDOW_MS = 120_000;
export const H48_FROZEN_THRESHOLDS = Object.freeze({
  hype12Max: 0.004297852251518686,
  hype24Min: 0.02047426596091347,
  relative24Max: 0.026202553353817715,
});
export const H48_RESEARCH_PROVENANCE = Object.freeze({
  researchSelection: "PRE_ONLY_H48R4_WSIG",
  target30Count: 27,
  target30WinRate: 16 / 27,
  forward30Count: 2,
  forward30WinRate: 0.5,
  forward30Mean: -0.009240799980526347,
});

export type H48ClosedHour = Readonly<{ openTs: number; close: number }>;
export type H48EntryBoundary = Readonly<{ openTs: number; open: number; observedAt: number }>;
export type H48EntrySignal =
  | Readonly<{ status: "NO_SIGNAL"; reason: "HYPE_12H" | "HYPE_24H" | "RELATIVE_24H" }>
  | Readonly<{
      status: "CANDIDATE";
      route: typeof H48_RESEARCH_ENTRY_ROUTE;
      signalTs: number;
      logicalEntryTs: number;
      logicalExitTs: number;
      entryReferenceOpen: number;
      hype12: number;
      hype24: number;
      relative24: number;
      contract: HypeH48TimeOnlyContract;
    }>;

function invalid(reason: string): never {
  throw new Error("HYPE_H48_RESEARCH_ENTRY_INVALID:" + reason);
}

function exactSourceSha(value: string) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) invalid("SOURCE_SHA");
}

function verifiedClosedWindow(rows: readonly H48ClosedHour[], lastOpenTs: number): Map<number, number> {
  if (!Array.isArray(rows) || rows.length !== 25) invalid("CLOSED_HOURS_COUNT");
  const found = new Map<number, number>();
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.openTs) || row.openTs % H48_RESEARCH_HOUR_MS !== 0
        || !Number.isFinite(row.close) || row.close <= 0 || found.has(row.openTs)) invalid("CLOSED_HOUR_INVALID");
    found.set(row.openTs, row.close);
  }
  for (let i = 0; i <= 24; i++) {
    if (!found.has(lastOpenTs - i * H48_RESEARCH_HOUR_MS)) invalid("CLOSED_HOUR_GAP");
  }
  return found;
}

export function evaluateH48R4WsigEntry(input: {
  runtimeSha: string;
  now: number;
  entry: H48EntryBoundary;
  hypeClosed: readonly H48ClosedHour[];
  btcClosed: readonly H48ClosedHour[];
  existingHypePosition: boolean;
}): H48EntrySignal {
  exactSourceSha(input.runtimeSha);
  const e = input.entry?.openTs, now = input.now;
  if (!Number.isSafeInteger(e) || e <= 0 || e % H48_RESEARCH_GRID_MS !== 0) invalid("UTC_6H_GRID");
  if (!Number.isSafeInteger(now) || now < e || now - e > H48_RESEARCH_OBSERVATION_WINDOW_MS
      || !Number.isSafeInteger(input.entry.observedAt)
      || input.entry.observedAt < e || input.entry.observedAt > now
      || now - input.entry.observedAt > H48_RESEARCH_OBSERVATION_WINDOW_MS
      || !Number.isFinite(input.entry.open) || input.entry.open <= 0) invalid("UNVERIFIED_CURRENT_OPEN");
  if (input.existingHypePosition !== false) invalid("NON_OVERLAPPING_H48_POSITION");
  const t = e - H48_RESEARCH_HOUR_MS;
  // Only e-1h and older CLOSED hourly candles are permitted. No HYPE or BTC
  // close/high/low of the entry hour is read; the entry price is its OPEN.
  const h = verifiedClosedWindow(input.hypeClosed, t);
  const b = verifiedClosedWindow(input.btcClosed, t);
  const hype12 = h.get(t)! / h.get(t - 12 * H48_RESEARCH_HOUR_MS)! - 1;
  const hype24 = h.get(t)! / h.get(t - 24 * H48_RESEARCH_HOUR_MS)! - 1;
  const btc24 = b.get(t)! / b.get(t - 24 * H48_RESEARCH_HOUR_MS)! - 1;
  const relative24 = hype24 - btc24;
  if (hype12 > H48_FROZEN_THRESHOLDS.hype12Max) return { status: "NO_SIGNAL", reason: "HYPE_12H" };
  if (hype24 < H48_FROZEN_THRESHOLDS.hype24Min) return { status: "NO_SIGNAL", reason: "HYPE_24H" };
  if (relative24 > H48_FROZEN_THRESHOLDS.relative24Max) return { status: "NO_SIGNAL", reason: "RELATIVE_24H" };
  const contract = createHypeH48TimeOnlyContract({
    positionId: `H48|HYPEUSDT|${e}`, sourceSha: input.runtimeSha, logicalEntryTs: e,
  });
  return Object.freeze({
    status: "CANDIDATE" as const, route: H48_RESEARCH_ENTRY_ROUTE,
    signalTs: t, logicalEntryTs: e, logicalExitTs: e + H48_RESEARCH_HOLD_MS,
    entryReferenceOpen: input.entry.open, hype12, hype24, relative24, contract,
  });
}
