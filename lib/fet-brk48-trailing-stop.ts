import type { ConfirmedFiveMinuteBar } from "./disdex-exit-overlay-contract";

/**
 * The production name is deliberately the same as the adopted research case.
 * Percentages in this module are fractions (0.08 = +8%), while the giveback is
 * a percentage-point fraction (0.04 = four percentage points).
 */
export const FET_BRK48_TRAILING_STOP_POLICY = Object.freeze({
  id: "FET_TRAIL_8P_GIVEBACK_4P",
  armGainPct: 0.08,
  givebackPctPoints: 0.04,
});

export type FetBrk48TrailingStopState = {
  armed: boolean;
  bestGainPct: number;
  stopPrice?: number;
  lastConfirmedBarTs?: number;
  armedAt?: number;
};

export type FetBrk48TrailingStopResult = {
  state: FetBrk48TrailingStopState;
  stopHit: boolean;
  triggerPrice?: number;
  reason: "NO_STOP" | "STOP_HIT" | "ARMED" | "UPDATED" | "DUPLICATE_OR_OLD_BAR";
};

const EPSILON = 1e-12;

function positive(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name}_INVALID`);
  return value;
}

function validBar(bar: ConfirmedFiveMinuteBar) {
  positive(bar.timestampMs, "FET_M5_TIMESTAMP");
  positive(bar.open, "FET_M5_OPEN");
  positive(bar.high, "FET_M5_HIGH");
  positive(bar.low, "FET_M5_LOW");
  positive(bar.close, "FET_M5_CLOSE");
  if (bar.high < Math.max(bar.open, bar.close)
      || bar.low > Math.min(bar.open, bar.close)
      || bar.high < bar.low) {
    throw new Error("FET_M5_OHLC_INVALID");
  }
  return bar;
}

/**
 * Advance the FET LONG trail by exactly one completed 5-minute bar.
 *
 * The stop is checked before the current close updates the high-water mark.
 * This matches the research replay: an order armed from an earlier confirmed
 * close can trigger during this bar, but the bar cannot use its own close to
 * retroactively protect its earlier low. Gap-through execution is represented
 * by the worse of the bar open and the stop price.
 */
export function advanceFetBrk48LongTrailingStop(input: {
  entryPrice: number;
  state?: FetBrk48TrailingStopState;
  bar: ConfirmedFiveMinuteBar;
}): FetBrk48TrailingStopResult {
  const entry = positive(input.entryPrice, "FET_TRAIL_ENTRY_PRICE");
  const bar = validBar(input.bar);
  const previous: FetBrk48TrailingStopState = {
    armed: input.state?.armed === true,
    bestGainPct: Number.isFinite(input.state?.bestGainPct) && Number(input.state?.bestGainPct) >= 0
      ? Number(input.state?.bestGainPct)
      : 0,
    ...(input.state?.stopPrice === undefined ? {} : { stopPrice: positive(Number(input.state.stopPrice), "FET_TRAIL_STOP_PRICE") }),
    ...(input.state?.lastConfirmedBarTs === undefined ? {} : { lastConfirmedBarTs: input.state.lastConfirmedBarTs }),
    ...(input.state?.armedAt === undefined ? {} : { armedAt: input.state.armedAt }),
  };

  if (previous.lastConfirmedBarTs !== undefined && bar.timestampMs <= previous.lastConfirmedBarTs) {
    return { state: previous, stopHit: false, reason: "DUPLICATE_OR_OLD_BAR" };
  }

  if (previous.armed && previous.stopPrice !== undefined && bar.low <= previous.stopPrice + EPSILON) {
    return {
      state: { ...previous, lastConfirmedBarTs: bar.timestampMs },
      stopHit: true,
      triggerPrice: Math.min(bar.open, previous.stopPrice),
      reason: "STOP_HIT",
    };
  }

  const gain = bar.close / entry - 1;
  const bestGainPct = Math.max(previous.bestGainPct, gain);
  if (bestGainPct < FET_BRK48_TRAILING_STOP_POLICY.armGainPct - EPSILON) {
    return {
      state: { ...previous, bestGainPct, lastConfirmedBarTs: bar.timestampMs },
      stopHit: false,
      reason: previous.armed ? "UPDATED" : "NO_STOP",
    };
  }

  const candidate = entry * (1 + bestGainPct - FET_BRK48_TRAILING_STOP_POLICY.givebackPctPoints);
  const stopPrice = previous.stopPrice === undefined ? candidate : Math.max(previous.stopPrice, candidate);
  const armed = true;
  return {
    state: {
      ...previous,
      armed,
      bestGainPct,
      stopPrice,
      armedAt: previous.armedAt ?? bar.timestampMs,
      lastConfirmedBarTs: bar.timestampMs,
    },
    stopHit: false,
    reason: previous.armed ? "UPDATED" : "ARMED",
  };
}
