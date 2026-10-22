/**
 * User-adopted 2026-10-22 HYPE LONG + Idle TAO/RENDER SHORT policy.
 *
 * These are pure, side-scoped, causal decision helpers. Importing this file
 * does not activate any trade, place an order or change a runner. Codex must
 * wire it to the certified release and real exchange protective-order flow.
 * Anchor: config/research/hype-render-tao-cumulative-adopted-20261022.json.
 */
export const HYPE_RENDER_TAO_OCT22_POLICY = Object.freeze({
  version: "HYPE_RENDER_TAO_USER_ADOPTED_20261022",
  liveActivation: "PENDING_IMPLEMENTATION_AND_VENUE_CERTIFICATION",
  hypeLong: Object.freeze({
    symbol: "HYPEUSDT",
    btc3hMaxPct: 0.6,
    hypeRelative3hMinPp: 2.0,
    initialExitAfterMinutes: 60,
    initialMaxMfeStrictlyLessThanPct: 0.3,
    initialAdversePctAtMost: -1.0,
    profitArmConfirmedM5GainPct: 3.0,
    protectEntryGainPct: 1.5,
  }),
  taoIdleShort: Object.freeze({ symbol: "TAOUSDT", ret1hPctMax: -1.0 }),
  renderIdleShort: Object.freeze({
    symbol: "RENDERUSDT",
    btc6hVetoWhenStrictlyPositivePct: 0.0,
    renderRelative6hVetoWhenStrictlyPositivePp: 0.0,
    profitArmConfirmedM5GainPct: 1.5,
    protectEntryGainPct: 0.25,
  }),
} as const);

export const ADOPTED_FIVE_MINUTE_MS = 300_000;
export type ClosedFiveMinuteClose = Readonly<{ openTs: number; close: number }>;
export type AdoptedGateResult = Readonly<{
  accepted: boolean;
  reason: string;
  btcReturnPct?: number;
  symbolReturnPct?: number;
  symbolRelativePp?: number;
}>;

/**
 * Enforce exactly N+1 contiguous COMPLETED M5 closes with current/older
 * boundaries at decisionTs-M5 and decisionTs-(N+1)*M5.
 *
 * Percent values are numeric percent, not fractional decimals. No price
 * forward-fill, rounding, forming bar, stale closes or BTC-only fallback.
 */
function closedReturnPct(
  rows: readonly ClosedFiveMinuteClose[],
  decisionTs: number,
  lookbackBars: number,
): number | null {
  const dt = ADOPTED_FIVE_MINUTE_MS;
  if (!Number.isSafeInteger(decisionTs) || decisionTs <= 0 || decisionTs % dt !== 0
    || !Number.isInteger(lookbackBars) || lookbackBars <= 0) return null;
  const end = decisionTs - dt;
  const begin = end - lookbackBars * dt;
  const indexed = new Map<number, number>();
  for (const bar of rows) {
    if (!Number.isSafeInteger(bar.openTs) || bar.openTs < begin || bar.openTs > end) continue;
    if (!Number.isFinite(bar.close) || bar.close <= 0 || indexed.has(bar.openTs)) return null;
    indexed.set(bar.openTs, bar.close);
  }
  if (indexed.size !== lookbackBars + 1) return null;
  for (let n = 0; n <= lookbackBars; n += 1) {
    if (!indexed.has(begin + n * dt)) return null;
  }
  return 100 * (indexed.get(end)! / indexed.get(begin)! - 1);
}

/** Additional HYPE LONG entry gate; original HYPE signal remains mandatory. */
export function evaluateAdoptedHypeLongEntry(input: {
  decisionTs: number;
  btc: readonly ClosedFiveMinuteClose[];
  hype: readonly ClosedFiveMinuteClose[];
}): AdoptedGateResult {
  const btc = closedReturnPct(input.btc, input.decisionTs, 36);
  const symbol = closedReturnPct(input.hype, input.decisionTs, 36);
  if (btc === null || symbol === null) return { accepted: false, reason: "HYPE_ADOPTED_M5_HISTORY_UNAVAILABLE" };
  const rel = symbol - btc;
  if (btc > HYPE_RENDER_TAO_OCT22_POLICY.hypeLong.btc3hMaxPct) {
    return { accepted: false, reason: "HYPE_BTC3H_TOO_STRONG", btcReturnPct: btc, symbolReturnPct: symbol, symbolRelativePp: rel };
  }
  const accepted = rel >= HYPE_RENDER_TAO_OCT22_POLICY.hypeLong.hypeRelative3hMinPp;
  return {
    accepted,
    reason: accepted ? "HYPE_ADOPTED_GATE_PASS" : "HYPE_3H_RELATIVE_NOT_MET",
    btcReturnPct: btc,
    symbolReturnPct: symbol,
    symbolRelativePp: rel,
  };
}

/** Additional TAO Idle SHORT gate; never admit a LONG signal. */
export function evaluateAdoptedTaoIdleShortEntry(input: {
  decisionTs: number;
  tao: readonly ClosedFiveMinuteClose[];
}): AdoptedGateResult {
  const symbol = closedReturnPct(input.tao, input.decisionTs, 12);
  if (symbol === null) return { accepted: false, reason: "TAO_ADOPTED_M5_HISTORY_UNAVAILABLE" };
  const accepted = symbol <= HYPE_RENDER_TAO_OCT22_POLICY.taoIdleShort.ret1hPctMax;
  return {
    accepted,
    reason: accepted ? "TAO_ADOPTED_SHORT_PASS" : "TAO_1H_NOT_DOWN_1PCT",
    symbolReturnPct: symbol,
  };
}

/** RENDER Idle SHORT veto ONLY when both BTC6h >0 AND RENDER-minus-BTC6h >0. */
export function evaluateAdoptedRenderIdleShortEntry(input: {
  decisionTs: number;
  btc: readonly ClosedFiveMinuteClose[];
  render: readonly ClosedFiveMinuteClose[];
}): AdoptedGateResult {
  const btc = closedReturnPct(input.btc, input.decisionTs, 72);
  const symbol = closedReturnPct(input.render, input.decisionTs, 72);
  if (btc === null || symbol === null) return { accepted: false, reason: "RENDER_ADOPTED_M5_HISTORY_UNAVAILABLE" };
  const rel = symbol - btc;
  const veto = btc > 0 && rel > 0;
  return {
    accepted: !veto,
    reason: veto ? "RENDER_BTC6H_AND_RELATIVE6H_BOTH_POSITIVE_VETO" : "RENDER_ADOPTED_SHORT_PASS",
    btcReturnPct: btc,
    symbolReturnPct: symbol,
    symbolRelativePp: rel,
  };
}

export type AdoptedExitDecision =
  | Readonly<{ kind: "KEEP"; reason: string }>
  | Readonly<{ kind: "CLOSE_LONG"; reason: string }>
  | Readonly<{ kind: "ARM_PROTECTIVE_STOP"; reason: string; stopPrice: number }>;

/**
 * HYPE after-fill LONG exit decision. Caller must maintain MFE from actual
 * historical fills/high-water mark and persist it over restarts. Its input
 * "confirmedCloseReturnPct" may only come from a fully completed M5 bar;
 * stop-arm is NOT same-bar executable. Existing earlier exits win.
 */
export function evaluateAdoptedHypeLongExit(input: {
  entryPrice: number;
  elapsedMinutes: number;
  maxFavorableExcursionPct: number;
  currentReturnFromEntryPct: number;
  confirmedCloseReturnPct: number;
  stopAlreadyArmed: boolean;
}): AdoptedExitDecision {
  const p = HYPE_RENDER_TAO_OCT22_POLICY.hypeLong;
  if (![input.entryPrice, input.elapsedMinutes, input.maxFavorableExcursionPct,
         input.currentReturnFromEntryPct, input.confirmedCloseReturnPct].every(Number.isFinite)
      || input.entryPrice <= 0 || input.elapsedMinutes < 0) {
    return { kind: "KEEP", reason: "HYPE_EXIT_UNVERIFIED_INPUT_REQUEST_RECONCILIATION" };
  }
  if (input.elapsedMinutes >= p.initialExitAfterMinutes
      && input.maxFavorableExcursionPct < p.initialMaxMfeStrictlyLessThanPct
      && input.currentReturnFromEntryPct <= p.initialAdversePctAtMost) {
    return { kind: "CLOSE_LONG", reason: "HYPE_1H_LOW_MFE_EARLY_ADVERSE_EXIT" };
  }
  if (!input.stopAlreadyArmed && input.confirmedCloseReturnPct >= p.profitArmConfirmedM5GainPct) {
    return {
      kind: "ARM_PROTECTIVE_STOP",
      reason: "HYPE_CONFIRMED_M5_PROTECT_1P5",
      stopPrice: input.entryPrice * (1 + p.protectEntryGainPct / 100),
    };
  }
  return { kind: "KEEP", reason: input.stopAlreadyArmed ? "HYPE_PROTECTION_ALREADY_ARMED" : "HYPE_NO_ADOPTED_EXIT" };
}

/**
 * RENDER SHORT protective price to arm only AFTER confirmed M5 close
 * demonstrates >=1.5% favorable price return. STOP BUY is 0.25% below
 * actual entry. Never overwrite an already more protective trailing stop.
 * Position state and venue read-back are the caller's responsibility.
 */
export function evaluateAdoptedRenderShortProfitArm(input: {
  entryPrice: number;
  confirmedClose: number;
  existingProtectiveStopPrice?: number;
}): AdoptedExitDecision {
  const p = HYPE_RENDER_TAO_OCT22_POLICY.renderIdleShort;
  if (![input.entryPrice, input.confirmedClose].every(Number.isFinite)
      || input.entryPrice <= 0 || input.confirmedClose <= 0) {
    return { kind: "KEEP", reason: "RENDER_STOP_UNVERIFIED_INPUT_REQUEST_RECONCILIATION" };
  }
  const bestLimit = input.entryPrice * (1 - p.protectEntryGainPct / 100);
  const currentGainPct = 100 * (1 - input.confirmedClose / input.entryPrice);
  if (currentGainPct < p.profitArmConfirmedM5GainPct) {
    return { kind: "KEEP", reason: "RENDER_PROFIT_NOT_ARMED" };
  }
  if (input.existingProtectiveStopPrice !== undefined) {
    if (!Number.isFinite(input.existingProtectiveStopPrice) || input.existingProtectiveStopPrice <= 0) {
      return { kind: "KEEP", reason: "RENDER_EXISTING_STOP_INVALID_REQUEST_RECONCILIATION" };
    }
    if (input.existingProtectiveStopPrice <= bestLimit) {
      return { kind: "KEEP", reason: "RENDER_EXISTING_STOP_ALREADY_MORE_PROTECTIVE" };
    }
  }
  return { kind: "ARM_PROTECTIVE_STOP", reason: "RENDER_CONFIRMED_M5_PROTECT_0P25", stopPrice: bestLimit };
}
