export const RECOVERY_V8_FREEZE_SHA = "15c0b7586710c9db1c46b376bb5041203fc7d826" as const;
export const RECOVERY_V8_SOURCE_PRODUCTION_SHA = "a76fd7aaa0788209532a5a2c6489135dd8e4a27e" as const;

export const PENGU_RECOVERY_V8_PROMOTION = Object.freeze({
    liveEnabled: true,
    status: "LIVE_TARGET_APPROVED_20260911",
    promotionBasis: "research/IMPLEMENTATION_HANDOFF_V12_TOP2_PENGU_V8_Q102_1P0_20260911.md",
    reason: "The validated implementation target explicitly keeps Recovery V8 as supplemental Long beside Short V20. The earlier post-freeze holdout remains recorded below, while production keeps all fail-closed, protection, cooldown, and shared-risk gates.",
    freshHoldout: Object.freeze({ source: "BINANCE_USDM_1H_PROXY", startInclusive: "2026-08-28T00:00:00.000Z", endObserved: "2026-09-04T21:00:00.000Z", completedRows: 190, signals: 1, wins: 0, accountReturnPct: -3.0 }),
});

export const PENGU_V8_V64_BASE = Object.freeze({
    breakoutAtrFloor: 0.510560996033169,
    longMultiplier: 1.25,
    shortMultiplier: 1.0,
    lowGross: 0.1875,
    lowGrossRule: Object.freeze({ feature: "penguReturn72h", op: "lte", threshold: 0.12049482888834451 }),
    sourceProductionSha: RECOVERY_V8_SOURCE_PRODUCTION_SHA,
    historicalIntegratedPenguCap: 0.75,
});

export const PENGU_RECOVERY_V8 = {
    id: "PENGU_RECOVERY_V8",
    symbol: "PENGUUSDT",
    rule: "R_BTC3",
    priority: "SHORT_FIRST",
    initialGross: 0.5,
    yieldMode: "BASE_LONG",
    exit: {
        hardStopPct: 0.06,
        trailActivationPct: 0.06,
        trailRetracePct: 0.03,
        maxHoldHours: 72,
        structuralBufferPct: null,
    },
    partial: {
        afterHours: 24,
        stopPct: 0.04,
        gross: 0.25,
        remainingGross: 0.25,
    },
    thresholds: {
        rsiDelta6Min: 7.392354615445917,
        ema168DistanceMinPct: -5.864583483302943,
        btcReturn6hMinPct: 0.20571786048402818,
    },
    breakevenProtector: false,
    staticGuard: false,
    stagedEntry: false,
} as const;

export type RecoveryV8Policy = typeof PENGU_RECOVERY_V8;
