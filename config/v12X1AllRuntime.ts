/**
 * Frozen production contract for V12_X1.00_ALL.  This module is deliberately
 * side-effect free: importing it cannot enable a runner or submit an order.
 */
export type V12RuntimeMode = "SHADOW" | "PAPER" | "LIVE";

export const V12_X1_ALL = Object.freeze({
    strategyId: "V12_X1.00_ALL",
    sourceSha: "27f023a37d08b71c6e59b797fdc03c20d6032da2",
    venue: "ASTER_FUTURES_V3",
    timeframeHours: 2,
    inputTimeframeHours: 1,
    multiplier: 1,
    grossMultiplier: 1.5,
    maximumGross: 1.5,
    entryPolicy: "ALL" as const,
    maximumPositions: 1,
    leverage: 1,
    riskPerTradePct: 3.19,
    maxMarginUsagePct: 100,
    btcRegimeSmaBars: 53,
    btcRegimeMomentumBars: 52,
    regimeThresholdPct: 0.0377,
    momentumBars: 45,
    breakoutBars: 18,
    breakoutBufferPct: 0.0233,
    minimumMomentumPct: 0.0227,
    minimumVolumeRatio: 0.9845,
    minimumEdgeToCostRatio: 6.0879,
    volatilityLookbackBars: 15,
    volatilityPenalty: 2.3953,
    atrBars: 31,
    stopAtr: 2.477,
    takeProfitAtr: 3.1995,
    trailingAtr: 0.4,
    maxHoldBars: 23,
    rebalanceBars: 20,
    cooldownBars: 1,
    allowNeutralRegime: true,
    neutralScoreThreshold: 1.4649,
    normalRoundTripCostBps: 10,
    universe: ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR"] as const,
});

export const V12_X1_ALL_RUNTIME = Object.freeze({
    mode: "SHADOW" as V12RuntimeMode,
    enabled: false,
    liveTradingEnabled: false,
    liveExecutionEnabled: false,
});

function boolEnv(value: string | undefined, fallback: boolean) {
    if (value === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(value.trim());
}

export interface ResolvedV12Runtime {
    strategyId: typeof V12_X1_ALL.strategyId;
    mode: V12RuntimeMode;
    enabled: boolean;
    liveTradingEnabled: boolean;
    liveExecutionEnabled: boolean;
    multiplier: 1;
    grossMultiplier: number;
    maximumGross: number;
    lockPath?: string;
    statePath: string;
    riskPath: string;
}

export function resolveV12X1AllRuntime(env: Partial<NodeJS.ProcessEnv> = process.env): ResolvedV12Runtime {
    const raw = String(env.V12_X1_ALL_MODE || V12_X1_ALL_RUNTIME.mode).toUpperCase();
    const mode: V12RuntimeMode = raw === "PAPER" || raw === "LIVE" ? raw : "SHADOW";
    return {
        strategyId: V12_X1_ALL.strategyId,
        mode,
        enabled: boolEnv(env.V12_X1_ALL_ENABLED, V12_X1_ALL_RUNTIME.enabled),
        liveTradingEnabled: boolEnv(env.V12_X1_ALL_LIVE_TRADING_ENABLED, V12_X1_ALL_RUNTIME.liveTradingEnabled),
        liveExecutionEnabled: boolEnv(env.V12_X1_ALL_LIVE_EXECUTION_ENABLED, V12_X1_ALL_RUNTIME.liveExecutionEnabled),
        multiplier: 1,
        grossMultiplier: V12_X1_ALL.grossMultiplier,
        maximumGross: V12_X1_ALL.maximumGross,
        lockPath: env.DISDEX_ACCOUNT_LOCK_PATH,
        statePath: env.V12_X1_ALL_STATE_PATH || ".runtime-state/v12-x1-all/runner.json",
        riskPath: env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH || ".runtime-state/shared/crypto-daily-risk.json",
    };
}
