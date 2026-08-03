export type PenguDualLsV1Mode = "SHADOW" | "PAPER" | "LIVE";

export const PENGU_DUAL_LS_V1 = {
    id: "PENGU_DUAL_LS_V1",
    symbol: "PENGUUSDT",
    decisionIntervalHours: 1,
    holdHours: 36,
    longGross: 0.75,
    shortGross: 0.75,
    maximumGross: 0.75,
    long: {
        compressionLookbackHours: 24,
        compressionWindowHours: 120,
        compressionMaxRatio: 1,
        rangeLookbackHours: 24,
        rangeMaxPct: 6,
        breakoutAtrLength: 14,
        breakoutAtrMultiplier: 0.25,
        volumeRecentHours: 6,
        volumeBaseHours: 42,
        volumeFloor: 1,
        relativeMomentumHours: 24,
        btcMomentumFloorPct: -3,
        rsiLength: 14,
        rsiMaximum: 82,
        fundingMaximum: 0.0001,
        shortBlockLookbackHours: 2,
        initialStopPct: 6,
        trailingActivationPct: 6,
        trailingRetracePct: 3,
    },
    short: {
        breakdownLookbackHours: 24,
        minimumDropPct: 4,
        minimumRetracePct: 25,
        maximumRetracePct: 55,
        volumeRecentHours: 6,
        volumeBaseHours: 42,
        volumeFloor: 0.8,
        rsiLength: 14,
        rsiMinimum: 20,
        rsiMaximum: 65,
        btcSmaLength: 168,
        btcMomentumHours: 72,
        btcStrongMomentumPct: 4,
    },
    safety: {
        maxSlippageBps: 35,
        minimumOrderNotionalUsd: 5,
        cashReservePct: 2,
        maxTransactionRetries: 5,
        closeUnmanagedPositions: false,
    },
} as const;

export const PENGU_DUAL_LS_V1_RUNTIME = {
    strategyId: PENGU_DUAL_LS_V1.id,
    mode: "SHADOW" as PenguDualLsV1Mode,
    enabled: false,
    liveTradingEnabled: false,
    liveExecutionEnabled: false,
} as const;

function boolEnv(value: string | undefined, fallback: boolean) {
    if (value === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(value.trim());
}

function finiteEnv(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export interface ResolvedPenguDualLsV1Runtime {
    strategyId: typeof PENGU_DUAL_LS_V1.id;
    mode: PenguDualLsV1Mode;
    enabled: boolean;
    liveTradingEnabled: boolean;
    liveExecutionEnabled: boolean;
    maximumGross: number;
    longGross: number;
    shortGross: number;
    cashReservePct: number;
    maximumSlippageBps: number;
    minimumOrderNotionalUsd: number;
    maxTransactionRetries: number;
    portfolioGrossCap: number;
    maximumDailyLossPct: number;
    killSwitchPath?: string;
    portfolioDailyLossStatePath?: string;
    closeUnmanagedPositions: false;
}

/**
 * Resolve runtime flags without ever allowing environment values to raise the
 * strategy's fixed gross or bypass the two live gates. Defaults remain
 * SHADOW/off so adding this engine cannot activate orders by itself.
 */
export function resolvePenguDualLsV1Runtime(env: Partial<NodeJS.ProcessEnv> = process.env): ResolvedPenguDualLsV1Runtime {
    const rawMode = String(env.PENGU_DUAL_LS_V1_MODE || PENGU_DUAL_LS_V1_RUNTIME.mode).trim().toUpperCase();
    const mode: PenguDualLsV1Mode = rawMode === "LIVE" || rawMode === "PAPER" ? rawMode : "SHADOW";
    const maximumGross = Math.min(PENGU_DUAL_LS_V1.maximumGross, Math.max(0, finiteEnv(env.PENGU_DUAL_LS_V1_MAX_GROSS, PENGU_DUAL_LS_V1.maximumGross)));
    const cashReservePct = Math.min(25, Math.max(0, finiteEnv(env.PENGU_DUAL_LS_V1_CASH_RESERVE_PCT, PENGU_DUAL_LS_V1.safety.cashReservePct)));
    return {
        strategyId: PENGU_DUAL_LS_V1.id,
        mode,
        enabled: boolEnv(env.PENGU_DUAL_LS_V1_ENABLED, PENGU_DUAL_LS_V1_RUNTIME.enabled),
        liveTradingEnabled: boolEnv(env.PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED, PENGU_DUAL_LS_V1_RUNTIME.liveTradingEnabled),
        liveExecutionEnabled: boolEnv(env.PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED, PENGU_DUAL_LS_V1_RUNTIME.liveExecutionEnabled),
        maximumGross,
        longGross: Math.min(PENGU_DUAL_LS_V1.longGross, maximumGross),
        shortGross: Math.min(PENGU_DUAL_LS_V1.shortGross, maximumGross),
        cashReservePct,
        maximumSlippageBps: Math.max(1, finiteEnv(env.PENGU_DUAL_LS_V1_MAX_SLIPPAGE_BPS, PENGU_DUAL_LS_V1.safety.maxSlippageBps)),
        minimumOrderNotionalUsd: Math.max(5, finiteEnv(env.PENGU_DUAL_LS_V1_MIN_ORDER_NOTIONAL_USD, PENGU_DUAL_LS_V1.safety.minimumOrderNotionalUsd)),
        maxTransactionRetries: Math.max(1, Math.floor(finiteEnv(env.PENGU_DUAL_LS_V1_MAX_TRANSACTION_RETRIES, PENGU_DUAL_LS_V1.safety.maxTransactionRetries))),
        portfolioGrossCap: Math.max(0, Math.min(2.5, finiteEnv(env.PENGU_DUAL_LS_V1_PORTFOLIO_GROSS_CAP, 2.5))),
        maximumDailyLossPct: Math.max(0, Math.min(5, finiteEnv(env.PENGU_DUAL_LS_V1_MAX_DAILY_LOSS_PCT, 5))),
        killSwitchPath: env.PENGU_DUAL_LS_V1_KILL_SWITCH_FILE,
        portfolioDailyLossStatePath: env.PENGU_DUAL_LS_V1_PORTFOLIO_DAILY_LOSS_STATE_FILE,
        closeUnmanagedPositions: false,
    };
}
