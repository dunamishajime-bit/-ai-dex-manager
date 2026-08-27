export const RECOVERY_V8_FREEZE_SHA = "15c0b7586710c9db1c46b376bb5041203fc7d826" as const;
export const RECOVERY_V8_SOURCE_PRODUCTION_SHA = "a76fd7aaa0788209532a5a2c6489135dd8e4a27e" as const;

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

