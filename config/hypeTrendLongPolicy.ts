/**
 * Production contract for the approved high-win HYPE long overlay.
 *
 * This is intentionally separate from the older HYPE/ZEC 15m sidecar.  The
 * old sidecar remains disabled unless its own operator gate is armed.  The
 * live HYPE overlay uses the fixed Aster-ledger research parameters below;
 * no parameter is inferred from the current candle.
 */
export const HYPE_TREND_LONG_POLICY = Object.freeze({
  strategy: "HYPE_LONG" as const,
  symbol: "HYPEUSDT" as const,
  side: "LONG" as const,
  timeframe: "1h" as const,
  fastEmaPeriod: 12,
  slowEmaPeriod: 48,
  breakoutLookbackHours: 24,
  minimumBreakoutBps: 30,
  maximumDistanceFromSlowEmaBps: 900,
  regimeEmaPeriod: 240,
  minimumRegimeSlopeBps: 25,
  atrPeriod: 14,
  stopAtrMultiple: 2.5,
  trailingAtrMultiple: 3,
  maximumHoldHours: 168,
  riskPct: 5,
  maximumGross: 1.5,
  leverage: 5 as const,
  marginType: "cross" as const,
});

export type HypeTrendLongPolicy = typeof HYPE_TREND_LONG_POLICY;
