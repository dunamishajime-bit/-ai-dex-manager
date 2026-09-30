export const IDLE_PRIORITY_SHORT_STRATEGY = "IDLE_PRIORITY_SHORT" as const;

export const IDLE_PRIORITY_SHORT_POLICY = {
  gross: 1.0,
  leverage: 5,
  marginType: "cross",
  cooldownHours: 12,
  emergencyStopPct: 10,
  emergencyTakeProfitPct: 25,
  routes: {
    TAOUSDT: { route: "IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2", archetype: "BREAKOUT", rel24Max: -0.02, holdHours: 12 },
    TIAUSDT: { route: "IDLE_TIA_BREAKDOWN_SHORT_VOLCAP100", archetype: "BREAKOUT", volumeRatioMax: 100, holdHours: 24 },
    DOTUSDT: { route: "IDLE_DOT_MOMENTUM_SHORT_BTCREL", archetype: "MOMENTUM", btc24Max: 0, rel24Max: 0, holdHours: 24 },
    JUPUSDT: { route: "IDLE_JUP_RELATIVE_SHORT", archetype: "RELATIVE", holdHours: 12 },
    RENDERUSDT: { route: "IDLE_RENDER_RELATIVE_SHORT", archetype: "RELATIVE", holdHours: 12 },
  },
  generic: {
    // Historical 495-row candidate lifecycle.  Generic archetype selection
    // happens BEFORE the five-symbol route filter and advances the per-symbol
    // 12h lifecycle for both LONG and SHORT candidates.
    priority: ["BREAKOUT", "RELATIVE", "MOMENTUM"] as const,
    breakout: { ret24AbsMin: 0.02, volumeRatioMin: 1.30, atrRatioMin: 0.007 },
    momentum: { ret12AbsMin: 0.03, volumeRatioMin: 1.00, atrRatioMin: 0.007 },
    relative: { rel24AbsMin: 0.03, ret24AbsMin: 0.015, volumeRatioMin: 0.80, atrRatioMin: 0.007 },
  },
} as const;

export type IdlePrioritySymbol = keyof typeof IDLE_PRIORITY_SHORT_POLICY.routes;
export type IdlePriorityRoute = (typeof IDLE_PRIORITY_SHORT_POLICY.routes)[IdlePrioritySymbol]["route"];
