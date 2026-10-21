import type { Quality102Candle } from "./disdex-quality102-causal-pipeline";
import type { ConfirmedFiveMinuteBar } from "./disdex-exit-overlay-contract";

const HOUR_MS = 3_600_000;
const EPSILON = 1e-12;

export type Q102AdoptedFamily = "HIGH_VOL" | "PB" | "MR" | "BRK" | "REV";
export type Q102AdoptedSide = "LONG" | "SHORT";

export type Q102ProfitFloorStageState = {
  armed: boolean;
  stage: 0 | 1 | 2;
  stopPrice?: number;
  bestGainPct: number;
  lastConfirmedBarTs?: number;
};

export type Q102AdoptedExitReason =
  | "Q102_PB_LONG_INITIAL_ADVERSE_1P5"
  | "Q102_HIGH_VOL_LONG_H1_TWO_CLOSE_LOSS_3P0";

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name}_INVALID`);
  return value;
}

export function favorableGainPct(side: Q102AdoptedSide, entryPrice: number, price: number): number {
  const entry = positive(entryPrice, "ENTRY_PRICE");
  const current = positive(price, "CURRENT_PRICE");
  return side === "LONG" ? current / entry - 1 : 1 - current / entry;
}

/** Q102/PB/LONG only: early exit for a position that never achieved +0.5% MFE. */
export function evaluateQ102PbLongInitialAdverse(input: {
  family?: Q102AdoptedFamily;
  side: Q102AdoptedSide;
  entryPrice: number;
  entryTs: number;
  now: number;
  markPrice: number;
  maxFavorablePct: number;
}): Q102AdoptedExitReason | undefined {
  if (input.family !== "PB" || input.side !== "LONG") return undefined;
  const entryPrice = positive(input.entryPrice, "PB_ENTRY_PRICE");
  if (!Number.isFinite(input.entryTs) || !Number.isFinite(input.now) || input.now < input.entryTs) return undefined;
  if (input.now - input.entryTs < 3 * HOUR_MS) return undefined;
  if (!(Number.isFinite(input.maxFavorablePct) && input.maxFavorablePct < 0.005 - EPSILON)) return undefined;
  if (!(Number.isFinite(input.markPrice) && input.markPrice <= entryPrice * (1 - 0.015) + EPSILON)) return undefined;
  return "Q102_PB_LONG_INITIAL_ADVERSE_1P5";
}

/**
 * Q102/HIGH_VOL/LONG only: two consecutive completed H1 closes at or below
 * -3%. A row is usable only after its full hour has closed.
 */
export function evaluateQ102HighVolLongH1Loss(input: {
  family?: Q102AdoptedFamily;
  side: Q102AdoptedSide;
  entryPrice: number;
  entryTs: number;
  now: number;
  candles: readonly Quality102Candle[];
}): { reason?: Q102AdoptedExitReason; consecutiveLossCloses: number; lastConfirmedCloseTs?: number } {
  if (input.family !== "HIGH_VOL" || input.side !== "LONG") return { consecutiveLossCloses: 0 };
  const entryPrice = positive(input.entryPrice, "HIGH_VOL_LONG_ENTRY_PRICE");
  if (!Number.isFinite(input.entryTs) || !Number.isFinite(input.now) || input.now < input.entryTs) return { consecutiveLossCloses: 0 };
  if (input.now - input.entryTs < 2 * HOUR_MS) return { consecutiveLossCloses: 0 };

  const eligible = [...input.candles]
    .filter((candle) => Number.isFinite(candle.timestampMs)
      && candle.timestampMs + HOUR_MS <= input.now
      && candle.timestampMs + HOUR_MS > input.entryTs)
    .sort((left, right) => left.timestampMs - right.timestampMs);
  let consecutiveLossCloses = 0;
  let previousTimestamp: number | undefined;
  let lastConfirmedCloseTs: number | undefined;
  for (const candle of eligible) {
    if (previousTimestamp !== undefined && candle.timestampMs !== previousTimestamp + HOUR_MS) {
      consecutiveLossCloses = 0;
    }
    const loss = candle.close <= entryPrice * (1 - 0.03) + EPSILON;
    consecutiveLossCloses = loss ? consecutiveLossCloses + 1 : 0;
    previousTimestamp = candle.timestampMs;
    lastConfirmedCloseTs = candle.timestampMs + HOUR_MS;
    if (consecutiveLossCloses >= 2) {
      return {
        reason: "Q102_HIGH_VOL_LONG_H1_TWO_CLOSE_LOSS_3P0",
        consecutiveLossCloses,
        lastConfirmedCloseTs,
      };
    }
  }
  return { consecutiveLossCloses, ...(lastConfirmedCloseTs === undefined ? {} : { lastConfirmedCloseTs }) };
}

function validBar(bar: ConfirmedFiveMinuteBar): ConfirmedFiveMinuteBar {
  if (!Number.isFinite(bar.timestampMs) || bar.timestampMs <= 0) throw new Error("Q102_M5_TIMESTAMP_INVALID");
  for (const [value, field] of [[bar.open, "OPEN"], [bar.high, "HIGH"], [bar.low, "LOW"], [bar.close, "CLOSE"]] as const) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Q102_M5_${field}_INVALID`);
  }
  if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) {
    throw new Error("Q102_M5_OHLC_INVALID");
  }
  return bar;
}

function gapAwareShortTrigger(bar: ConfirmedFiveMinuteBar, stopPrice: number): number {
  return Math.max(bar.open, stopPrice);
}

/** Q102/HIGH_VOL/SHORT staged confirmed-M5 profit floor. */
export function advanceQ102HighVolShortProfitFloor(input: {
  family?: Q102AdoptedFamily;
  side: Q102AdoptedSide;
  entryPrice: number;
  state?: Q102ProfitFloorStageState;
  bar: ConfirmedFiveMinuteBar;
}): {
  state: Q102ProfitFloorStageState;
  stopHit: boolean;
  triggerPrice?: number;
  reason: "NOT_APPLICABLE" | "NO_STOP" | "ARMED_0P5" | "ARMED_1P0" | "UPDATED" | "STOP_HIT" | "DUPLICATE_OR_OLD_BAR";
} {
  const previous: Q102ProfitFloorStageState = {
    armed: input.state?.armed === true,
    stage: input.state?.stage === 2 ? 2 : input.state?.stage === 1 ? 1 : input.state?.armed ? 1 : 0,
    ...(input.state?.stopPrice === undefined ? {} : { stopPrice: input.state.stopPrice }),
    bestGainPct: Number.isFinite(input.state?.bestGainPct) ? Number(input.state?.bestGainPct) : 0,
    ...(input.state?.lastConfirmedBarTs === undefined ? {} : { lastConfirmedBarTs: input.state.lastConfirmedBarTs }),
  };
  if (input.family !== "HIGH_VOL" || input.side !== "SHORT") {
    return { state: previous, stopHit: false, reason: "NOT_APPLICABLE" };
  }
  const entryPrice = positive(input.entryPrice, "HIGH_VOL_SHORT_ENTRY_PRICE");
  const bar = validBar(input.bar);
  if (previous.lastConfirmedBarTs !== undefined && bar.timestampMs <= previous.lastConfirmedBarTs) {
    return { state: previous, stopHit: false, reason: "DUPLICATE_OR_OLD_BAR" };
  }
  if (previous.armed && previous.stopPrice !== undefined && bar.high >= previous.stopPrice - EPSILON) {
    return {
      state: { ...previous, lastConfirmedBarTs: bar.timestampMs },
      stopHit: true,
      triggerPrice: gapAwareShortTrigger(bar, previous.stopPrice),
      reason: "STOP_HIT",
    };
  }
  const gain = favorableGainPct("SHORT", entryPrice, bar.close);
  const bestGainPct = Math.max(previous.bestGainPct, gain);
  if (bestGainPct >= 0.03 - EPSILON) {
    const stopPrice = Math.min(previous.stopPrice ?? entryPrice * 0.995, entryPrice * 0.99);
    return {
      state: { armed: true, stage: 2, stopPrice, bestGainPct, lastConfirmedBarTs: bar.timestampMs },
      stopHit: false,
      reason: previous.stage >= 2 ? "UPDATED" : "ARMED_1P0",
    };
  }
  if (bestGainPct >= 0.02 - EPSILON) {
    const stopPrice = Math.min(previous.stopPrice ?? entryPrice * 0.995, entryPrice * 0.995);
    return {
      state: { armed: true, stage: Math.max(previous.stage, 1) as 1 | 2, stopPrice, bestGainPct, lastConfirmedBarTs: bar.timestampMs },
      stopHit: false,
      reason: previous.stage >= 1 ? "UPDATED" : "ARMED_0P5",
    };
  }
  return { state: { ...previous, bestGainPct, lastConfirmedBarTs: bar.timestampMs }, stopHit: false, reason: previous.armed ? "UPDATED" : "NO_STOP" };
}
