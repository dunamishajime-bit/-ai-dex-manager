import { INTEGRATED_PRODUCTION_RISK_POLICY } from "./integratedProductionRiskPolicy";

export type HypeZecStrategy = "HYPE_LONG" | "ZEC_LONG";

export const HYPE_ZEC_STRATEGIES = ["HYPE_LONG", "ZEC_LONG"] as const satisfies readonly HypeZecStrategy[];

type LongSleevePolicy = {
  strategy: HypeZecStrategy;
  symbol: "HYPEUSDT" | "ZECUSDT";
  riskPct: number;
  maximumGross: number;
  leverage: 5;
  marginType: "cross";
  side: "LONG";
  priority: "LOWEST_SIDECAR";
  maximumReductionFraction: number;
  signal: {
    timeframe: "15m";
    btcMinMoveBps: number;
    btcMinAccelBps: number;
    btcMaxMoveBps: number;
    symbolMinMoveBps: number;
    symbolMinAccelBps: number;
    symbolMaxDistanceBps: number;
    breakoutBps: number;
    breakoutConfirmMinutes: number;
    holdMinutes: number;
    stopLossPct: number;
    takeProfitPct: number;
    trailActivationPct: number;
    trailRetracePct: number;
  };
};

/**
 * HYPE/ZEC are deliberately isolated from the existing Production sleeves.
 * These defaults are research parameters until integrated replay acceptance;
 * the runtime remains operator-gated and real-order disabled by default.
 */
export const HYPE_ZEC_LONG_POLICY: Readonly<Record<HypeZecStrategy, LongSleevePolicy>> = Object.freeze({
  HYPE_LONG: Object.freeze({
    strategy: "HYPE_LONG",
    symbol: "HYPEUSDT",
    riskPct: INTEGRATED_PRODUCTION_RISK_POLICY.hypeLongRiskPct,
    maximumGross: INTEGRATED_PRODUCTION_RISK_POLICY.hypeZecMaximumGross,
    leverage: 5,
    marginType: "cross",
    side: "LONG",
    priority: "LOWEST_SIDECAR",
    maximumReductionFraction: INTEGRATED_PRODUCTION_RISK_POLICY.hypeZecMaximumReductionFraction,
    signal: Object.freeze({
      timeframe: "15m",
      btcMinMoveBps: 3,
      btcMinAccelBps: -1,
      btcMaxMoveBps: 45,
      symbolMinMoveBps: 8,
      symbolMinAccelBps: -1,
      symbolMaxDistanceBps: 65,
      breakoutBps: 8,
      breakoutConfirmMinutes: 5,
      holdMinutes: 25,
      stopLossPct: 0.0045,
      takeProfitPct: 0.018,
      trailActivationPct: 0.008,
      trailRetracePct: 0.004,
    }),
  }),
  ZEC_LONG: Object.freeze({
    strategy: "ZEC_LONG",
    symbol: "ZECUSDT",
    riskPct: INTEGRATED_PRODUCTION_RISK_POLICY.zecLongRiskPct,
    maximumGross: INTEGRATED_PRODUCTION_RISK_POLICY.hypeZecMaximumGross,
    leverage: 5,
    marginType: "cross",
    side: "LONG",
    priority: "LOWEST_SIDECAR",
    maximumReductionFraction: INTEGRATED_PRODUCTION_RISK_POLICY.hypeZecMaximumReductionFraction,
    signal: Object.freeze({
      timeframe: "15m",
      btcMinMoveBps: 2,
      btcMinAccelBps: -1,
      btcMaxMoveBps: 55,
      symbolMinMoveBps: 12,
      symbolMinAccelBps: 0,
      symbolMaxDistanceBps: 90,
      breakoutBps: 12,
      breakoutConfirmMinutes: 10,
      holdMinutes: 60,
      stopLossPct: 0.0075,
      takeProfitPct: 0.03,
      trailActivationPct: 0.012,
      trailRetracePct: 0.006,
    }),
  }),
});

export function isHypeZecStrategy(value: string): value is HypeZecStrategy {
  return (HYPE_ZEC_STRATEGIES as readonly string[]).includes(String(value || "").trim().toUpperCase());
}
