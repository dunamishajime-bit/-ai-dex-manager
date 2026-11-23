/**
 * Exit overlays for the 2026-10-17 research handoff.
 *
 * This module contains only deterministic, venue-agnostic calculations.  A
 * runner must persist the returned state and obtain a successful venue
 * read-back before treating a new stop as active.  No entry signal, PENGU
 * rule, or shared-risk limit is defined here.
 */

export type OverlaySide = "LONG" | "SHORT";

export type ConfirmedFiveMinuteBar = {
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type Q102ProfitFloorState = {
  armed: boolean;
  stopPrice?: number;
  bestGainPct: number;
  lastConfirmedBarTs?: number;
};

export type IdleTrailState = {
  armed: boolean;
  bestGainPct: number;
  stopPrice?: number;
  lastConfirmedBarTs?: number;
};

export type OverlayBarResult<T> = {
  state: T;
  stopHit: boolean;
  triggerPrice?: number;
  reason: "NO_STOP" | "STOP_HIT" | "ARMED" | "UPDATED" | "DUPLICATE_OR_OLD_BAR";
};

const EPSILON = 1e-12;

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name}_INVALID`);
  return value;
}

function validBar(bar: ConfirmedFiveMinuteBar): ConfirmedFiveMinuteBar {
  for (const [value, name] of [[bar.timestampMs, "timestamp"], [bar.open, "open"], [bar.high, "high"], [bar.low, "low"], [bar.close, "close"]] as const) {
    positive(value, `FIVE_MINUTE_${name.toUpperCase()}`);
  }
  if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) {
    throw new Error("FIVE_MINUTE_OHLC_INVALID");
  }
  return bar;
}

/** Positive means favourable movement for the supplied side. */
export function favorableGainPct(side: OverlaySide, entryPrice: number, price: number): number {
  const entry = positive(entryPrice, "ENTRY_PRICE");
  const current = positive(price, "CURRENT_PRICE");
  return side === "LONG" ? current / entry - 1 : 1 - current / entry;
}

function stopHit(side: OverlaySide, bar: ConfirmedFiveMinuteBar, stopPrice: number): boolean {
  return side === "LONG" ? bar.low <= stopPrice + EPSILON : bar.high >= stopPrice - EPSILON;
}

function gapAwareTriggerPrice(side: OverlaySide, bar: ConfirmedFiveMinuteBar, stopPrice: number): number {
  if (side === "LONG") return Math.min(bar.open, stopPrice);
  return Math.max(bar.open, stopPrice);
}

function monotonicStop(side: OverlaySide, previous: number | undefined, candidate: number): number {
  if (previous === undefined) return candidate;
  return side === "LONG" ? Math.max(previous, candidate) : Math.min(previous, candidate);
}

/**
 * Apply Q102's +2% confirmed-close floor.  The existing STOP is evaluated
 * before the new bar close is used, so the bar cannot look ahead into its own
 * close.  The returned floor becomes effective on the next bar after venue
 * read-back.
 */
export function applyQ102ProfitFloorBar(input: {
  side: OverlaySide;
  entryPrice: number;
  state?: Q102ProfitFloorState;
  bar: ConfirmedFiveMinuteBar;
}): OverlayBarResult<Q102ProfitFloorState> {
  const entry = positive(input.entryPrice, "Q102_ENTRY_PRICE");
  const bar = validBar(input.bar);
  const previous: Q102ProfitFloorState = {
    armed: input.state?.armed === true,
    stopPrice: input.state?.stopPrice,
    bestGainPct: Number.isFinite(input.state?.bestGainPct) ? Number(input.state?.bestGainPct) : 0,
    lastConfirmedBarTs: input.state?.lastConfirmedBarTs,
  };
  if (previous.lastConfirmedBarTs !== undefined && bar.timestampMs <= previous.lastConfirmedBarTs) {
    return { state: previous, stopHit: false, reason: "DUPLICATE_OR_OLD_BAR" };
  }
  if (previous.armed && previous.stopPrice !== undefined && stopHit(input.side, bar, previous.stopPrice)) {
    return {
      state: { ...previous, lastConfirmedBarTs: bar.timestampMs },
      stopHit: true,
      triggerPrice: gapAwareTriggerPrice(input.side, bar, previous.stopPrice),
      reason: "STOP_HIT",
    };
  }
  const gain = favorableGainPct(input.side, entry, bar.close);
  const bestGainPct = Math.max(previous.bestGainPct, gain);
  if (!previous.armed && gain >= 0.02 - EPSILON) {
    const candidate = entry * (input.side === "LONG" ? 1.005 : 0.995);
    return {
      state: { armed: true, stopPrice: candidate, bestGainPct, lastConfirmedBarTs: bar.timestampMs },
      stopHit: false,
      reason: "ARMED",
    };
  }
  return {
    state: { ...previous, bestGainPct, lastConfirmedBarTs: bar.timestampMs },
    stopHit: false,
    reason: previous.armed ? "UPDATED" : "NO_STOP",
  };
}

/**
 * Apply DOT/RENDER's +3% / 1.5 percentage-point giveback trail using only
 * confirmed five-minute closes.  Existing stops are checked first, and the
 * stop is monotonic (never loosened).
 */
export function applyIdleProfitTrailBar(input: {
  side: OverlaySide;
  entryPrice: number;
  state?: IdleTrailState;
  bar: ConfirmedFiveMinuteBar;
}): OverlayBarResult<IdleTrailState> {
  const entry = positive(input.entryPrice, "IDLE_ENTRY_PRICE");
  const bar = validBar(input.bar);
  const previous: IdleTrailState = {
    armed: input.state?.armed === true,
    bestGainPct: Number.isFinite(input.state?.bestGainPct) ? Number(input.state?.bestGainPct) : 0,
    stopPrice: input.state?.stopPrice,
    lastConfirmedBarTs: input.state?.lastConfirmedBarTs,
  };
  if (previous.lastConfirmedBarTs !== undefined && bar.timestampMs <= previous.lastConfirmedBarTs) {
    return { state: previous, stopHit: false, reason: "DUPLICATE_OR_OLD_BAR" };
  }
  if (previous.armed && previous.stopPrice !== undefined && stopHit(input.side, bar, previous.stopPrice)) {
    return {
      state: { ...previous, lastConfirmedBarTs: bar.timestampMs },
      stopHit: true,
      triggerPrice: gapAwareTriggerPrice(input.side, bar, previous.stopPrice),
      reason: "STOP_HIT",
    };
  }
  const gain = favorableGainPct(input.side, entry, bar.close);
  const bestGainPct = Math.max(previous.bestGainPct, gain);
  if (bestGainPct >= 0.03 - EPSILON) {
    const candidate = entry * (input.side === "LONG" ? 1 + bestGainPct - 0.015 : 1 - bestGainPct + 0.015);
    const stopPrice = monotonicStop(input.side, previous.stopPrice, candidate);
    return {
      state: { armed: true, bestGainPct, stopPrice, lastConfirmedBarTs: bar.timestampMs },
      stopHit: false,
      reason: previous.armed ? "UPDATED" : "ARMED",
    };
  }
  return {
    state: { ...previous, bestGainPct, lastConfirmedBarTs: bar.timestampMs },
    stopHit: false,
    reason: "NO_STOP",
  };
}

/** Select the more protective absolute stop without changing the base exit. */
export function moreProtectiveStop(side: OverlaySide, baseStopPrice: number, overlayStopPrice?: number): number {
  const base = positive(baseStopPrice, "BASE_STOP_PRICE");
  if (overlayStopPrice === undefined) return base;
  const overlay = positive(overlayStopPrice, "OVERLAY_STOP_PRICE");
  return side === "LONG" ? Math.max(base, overlay) : Math.min(base, overlay);
}

/**
 * Convert HYPE's wallet-loss budget into an absolute protective stop.  The
 * budget includes the supplied round-trip execution-cost rate and is capped
 * at a 25% price distance so a missing/absurd market value cannot create an
 * unbounded stop.  Entry sizing remains controlled by the existing HYPE risk
 * policy; this is only the post-fill emergency protection.
 */
export function calculateWalletRiskStop(input: {
  side: OverlaySide;
  entryPrice: number;
  equity: number;
  acceptedGross: number;
  walletRiskPct?: number;
  roundTripCostBps?: number;
}): { stopPrice: number; priceLossFraction: number; walletLossAtStop: number; notional: number } {
  const entry = positive(input.entryPrice, "HYPE_ENTRY_PRICE");
  const equity = positive(input.equity, "HYPE_EQUITY");
  const gross = positive(input.acceptedGross, "HYPE_ACCEPTED_GROSS");
  const walletRiskPct = input.walletRiskPct ?? 2;
  const costBps = input.roundTripCostBps ?? 0;
  if (!Number.isFinite(walletRiskPct) || walletRiskPct <= 0 || !Number.isFinite(costBps) || costBps < 0) throw new Error("HYPE_WALLET_RISK_INPUT_INVALID");
  const notional = equity * gross;
  const cost = notional * costBps / 10_000;
  const budget = equity * walletRiskPct / 100;
  const priceLossFraction = Math.min(0.25, Math.max(EPSILON, (budget - cost) / notional));
  const stopPrice = input.side === "LONG" ? entry * (1 - priceLossFraction) : entry * (1 + priceLossFraction);
  const walletLossAtStop = notional * priceLossFraction + cost;
  if (!(stopPrice > 0) || !Number.isFinite(stopPrice)) throw new Error("HYPE_WALLET_RISK_STOP_INVALID");
  return { stopPrice, priceLossFraction, walletLossAtStop, notional };
}
