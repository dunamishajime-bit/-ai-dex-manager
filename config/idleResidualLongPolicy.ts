export const IDLE_RESIDUAL_LONG_STRATEGY = "IDLE_RESIDUAL_LONG" as const;

export const IDLE_RESIDUAL_LONG_POLICY = Object.freeze({
  gross: 1.0,
  leverage: 5,
  marginType: "cross" as const,
  holdHours: 12,
  emergencyStopPct: 10,
  emergencyTakeProfitPct: 25,
  routes: Object.freeze({
    DOGEUSDT: Object.freeze({
      route: "DOGE_REL_VOL",
      priority: 1,
      rel24Min: 0.03,
      volumeRatioMin: 1.20,
      atrRatioMin: 0.007,
            maxHoldHours: 12,
            hardStopPct: 10,
            takeProfitPct: 25,
    }),
    AVAXUSDT: Object.freeze({
      route: "AVAX_REL_LONG",
      priority: 2,
      rel24Min: 0.03,
      volumeRatioMin: 0.80,
      atrRatioMin: 0.007,
            maxHoldHours: 6,
            hardStopPct: 5,
            takeProfitPct: 25,
            entryGate: "DUAL_CAUSAL_M5",
            trailArmPct: 3,
            trailGivebackPct: 1.5,
            softTouchPct: 3.5,
            softWatchHours: 2,
    }),
  }),
});

export type IdleResidualLongSymbol = keyof typeof IDLE_RESIDUAL_LONG_POLICY.routes;
