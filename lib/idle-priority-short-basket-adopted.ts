/**
 * Idle SHORT - research-adopted, NOT ACTUATED.
 * Source: docs/research/results/idle-short-cluster-20261019/
 * H1_20PCT_WIN_PRESERVING_DECISION_20261019.md
 *
 * The caller MUST hold the shared account lock, pass a complete and fresh
 * exchange-signed readback of EVERY open SHORT STOP across all runners, and
 * include all pending SHORT risk reservations. This module never sends orders.
 * It is intentionally not yet imported by the LIVE runner.
 */
export const IDLE_SHORT_BASKET_ADOPTED_CANDIDATE = Object.freeze({
  atrRatioMax: 0.025,
  shortBasketStopLossBudgetPct: 20,
  adverseStopSlippagePct: 2,
  roundTripFeeBps: 10,
  minResearchGross: 0.25,
  maxVenueReadbackAgeMs: 90_000,
  nativeHardStopPct: 10,
  dynamicGrossAllowed: true,
  // Deliberately NOT adopted: +6% profit-lock, 1.5x blanket gross cap,
  // early exits and unconditional one-per-H1 block.
  profitLockAdopted: false,
} as const);

export type SignedShortStopSnapshot = {
  symbol: string;
  side: "SHORT";
  entryPrice: number;
  currentMarkPrice: number;
  quantity: number;
  exchangeStopReadback: {
    stopPrice: number;
    quantity: number;
    reduceOnly: true;
    verified: true;
    verifiedAtMs: number;
  } | null;
};

export type PendingShortRiskReservation = {
  symbol: string;
  side: "SHORT";
  worstCaseLossUsd: number;
  complete: true;
  verifiedAtMs: number;
};

export type IdleShortBasketRequest = {
  nowMs: number;
  sharedAccountLockHeld: true;
  signedExposureSnapshotComplete: true;
  equityUsd: number;
  atrRatio: number;
  requestedGross: number;
  cryptoAndTotalGrossRoom: number;
  entryPrice: number;
  quantityStep: number;
  venueMinQuantity: number;
  venueMinNotionalUsd: number;
  existingShorts: readonly SignedShortStopSnapshot[];
  pendingShortReservations: readonly PendingShortRiskReservation[];
};

export type IdleShortBasketDecision = {
  allowed: boolean;
  reason: string;
  quantity: number;
  gross: number;
  orderNotionalUsd: number;
  currentShortStopRiskUsd: number;
  pendingShortRiskUsd: number;
  acceptedOrderStopRiskUsd: number;
  aggregateRiskPct: number;
  remainingStopRiskBudgetUsd: number;
};

const C = IDLE_SHORT_BASKET_ADOPTED_CANDIDATE;
const EPS = 1e-9;
const finitePositive = (x: number) => Number.isFinite(x) && x > 0;
function deny(reason: string): IdleShortBasketDecision {
  return {allowed: false, reason, quantity: 0, gross: 0, orderNotionalUsd: 0,
    currentShortStopRiskUsd: 0, pendingShortRiskUsd: 0, acceptedOrderStopRiskUsd: 0,
    aggregateRiskPct: 0, remainingStopRiskBudgetUsd: 0};
}

/**
 * A pure sizing decision. Fail closed on absent/old/ambiguous stop information.
 * The exchange must be re-read after reservation, fill, and STOP placement;
 * this pure function cannot certify those later lifecycle steps.
 */
export function evaluateIdleShortBasketCandidate(
  request: IdleShortBasketRequest
): IdleShortBasketDecision {
  const r = request;
  if (r.sharedAccountLockHeld !== true || r.signedExposureSnapshotComplete !== true)
    return deny("SHARED_LOCK_OR_SIGNED_SNAPSHOT_MISSING");
  if (!Number.isSafeInteger(r.nowMs) || r.nowMs <= 0 || !finitePositive(r.equityUsd)
    || !finitePositive(r.entryPrice) || !finitePositive(r.quantityStep)
    || !finitePositive(r.venueMinQuantity) || !finitePositive(r.venueMinNotionalUsd)
    || !finitePositive(r.requestedGross) || !Number.isFinite(r.atrRatio) || r.atrRatio < 0
    || !Number.isFinite(r.cryptoAndTotalGrossRoom) || r.cryptoAndTotalGrossRoom < 0)
    return deny("BASKET_NUMERIC_OR_VENUE_FILTER_INVALID");
  if (r.atrRatio > C.atrRatioMax + EPS)
    return deny("IDLE_ATR_OVER_2P5_PCT");
  let existingRisk = 0;
  const fresh = (ts: number) => Number.isSafeInteger(ts) && ts > 0
    && ts <= r.nowMs && r.nowMs - ts <= C.maxVenueReadbackAgeMs;
  for (const p of r.existingShorts) {
    const stop = p.exchangeStopReadback;
    if (p.side !== "SHORT" || !p.symbol || !finitePositive(p.quantity)
      || !finitePositive(p.entryPrice) || !finitePositive(p.currentMarkPrice)
      || stop?.reduceOnly !== true || stop.verified !== true
      || !finitePositive(stop.stopPrice) || !fresh(stop.verifiedAtMs)
      || Math.abs(stop.quantity - p.quantity) > 1e-9)
      return deny("EXISTING_SHORT_SIGNED_STOP_MISSING_OR_STALE");
    // Never count floating profit as verified protected profit.
    // Negative mark-to-STOP loss is floored at zero: no negative risk credit.
    const stressedStop = stop.stopPrice + p.entryPrice * C.adverseStopSlippagePct / 100;
    existingRisk += p.quantity * Math.max(0, stressedStop - p.currentMarkPrice);
  }
  let pendingRisk = 0;
  for (const p of r.pendingShortReservations) {
    if (p.side !== "SHORT" || !p.symbol || p.complete !== true
      || !fresh(p.verifiedAtMs) || !Number.isFinite(p.worstCaseLossUsd)
      || p.worstCaseLossUsd < 0)
      return deny("PENDING_SHORT_RESERVATION_UNVERIFIED");
    pendingRisk += p.worstCaseLossUsd;
  }
  const budgetUsd = r.equityUsd * C.shortBasketStopLossBudgetPct / 100;
  const remaining = Math.max(0, budgetUsd - existingRisk - pendingRisk);
  const newPositionStressedLossPerNotional =
    (C.nativeHardStopPct + C.adverseStopSlippagePct) / 100
    + C.roundTripFeeBps / 10_000;
  const minGross = Math.min(r.requestedGross, C.minResearchGross);
  const roomGross = Math.min(
    r.requestedGross,
    r.cryptoAndTotalGrossRoom,
    remaining / (r.equityUsd * newPositionStressedLossPerNotional)
  );
  if (!(roomGross >= minGross - EPS)) return deny("BASKET_STOP_BUDGET_INSUFFICIENT");
  const notionalCapacityUsd = r.equityUsd * Math.max(0, roomGross);
  // Exchange quantity MUST be rounded DOWN; never round up beyond budget.
  const rawQty = notionalCapacityUsd / r.entryPrice;
  const decimals = Math.min(12, (String(r.quantityStep).split(".")[1] || "").length);
  const roundedQty = Math.floor(rawQty / r.quantityStep + 1e-10) * r.quantityStep;
  const qty = Number(roundedQty.toFixed(decimals));
  const notional = qty * r.entryPrice;
  if (!finitePositive(qty) || qty + EPS < r.venueMinQuantity
    || notional + EPS < r.venueMinNotionalUsd)
    return deny("BASKET_QUANTITY_NOT_EXCHANGE_FEASIBLE");
  const orderRisk = notional * newPositionStressedLossPerNotional;
  const total = existingRisk + pendingRisk + orderRisk;
  if (total > budgetUsd + EPS)
    return deny("BASKET_STOP_BUDGET_POST_QUANTITY_BREACH");
  return {
    allowed: true,
    reason: "ADOPTED_CANDIDATE_RESEARCH_ONLY_NOT_LIVE_ARMED",
    quantity: qty,
    gross: notional / r.equityUsd,
    orderNotionalUsd: notional,
    currentShortStopRiskUsd: existingRisk,
    pendingShortRiskUsd: pendingRisk,
    acceptedOrderStopRiskUsd: orderRisk,
    aggregateRiskPct: total / r.equityUsd * 100,
    remainingStopRiskBudgetUsd: budgetUsd - total,
  };
}
