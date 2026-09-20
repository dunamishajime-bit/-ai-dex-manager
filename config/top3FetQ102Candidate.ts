import { INTEGRATED_PRODUCTION_RISK_POLICY } from "./integratedProductionRiskPolicy";

export const TOP3_FET_Q102_CANDIDATE = Object.freeze({
  mode: "SHADOW" as const,
  ordersEnabled: false,
  v12: Object.freeze({
    maximumPositions: 3,
    baseMaximumPositions: 2,
    rank3GrossCap: 0.10,
    rank3MinimumScore: 0.70,
    aggregateGrossCap: 2.0,
  }),
  fet: Object.freeze({
    strategyId: "FET_BRK48_LONG",
    symbol: "FETUSDT",
    side: "LONG" as const,
    breakoutLookbackHours: 48,
    volumeMedianHours: 72,
    minimumVolumeRatio: 1.20,
    decisionModuloHours: 4,
    decisionHourRemainderUtc: 1,
    holdHours: 24,
    hardStopPct: 0.05,
    maximumGross: 1.25,
  }),
  q102Governor: Object.freeze({
    maximumGross: 3.0,
    maximumEntryDrawdownPct: 0.30,
    maximumPositions: 1,
    baseFamilyGross: INTEGRATED_PRODUCTION_RISK_POLICY.q102FamilyGross,
  }),
  portfolio: Object.freeze({
    cryptoGrossCap: INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap,
    totalGrossCap: INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap,
  }),
});
