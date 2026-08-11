export type PenguDualLsV2Mode = "SHADOW" | "PAPER" | "LIVE";

export const PENGU_DUAL_LS_V2 = {
    id: "PENGU_DUAL_LS_V2_FINAL",
    symbol: "PENGUUSDT",
    decisionIntervalHours: 1,
    longGross: 0.75,
    shortGross: 0.75,
    maximumGross: 0.75,
    portfolioGrossCap: 1.5,
    short: {
        regimeReturn72hMaximum: 0,
        impulseReturn24hMaximum: -0.07,
        setupExpiryHours: 24,
        armBounceMinimum: 0.0125,
        invalidateBounceAbove: 0.06,
        penguReturn24hMinimum: -0.12,
        btcEma168DistanceMinimum: -0.04,
        rsiMinimum: 30,
        volumeRatioMinimum: 0.25,
        volumeRatioMaximum: 3,
        relativeReturn24hMaximum: -0.02,
        btcReturn24hMaximum: 0.04,
        maxHoldHours: 72,
        hardStopPct: 0.08,
        trailingActivationPct: 0.15,
        trailingRetracePct: 0.04,
    },
    long: {
        regimeReturn72hMinimum: 0.15,
        breakoutLookbackHours: 18,
        penguReturn24hMinimum: 0.10,
        relativeReturn24hMinimum: 0.01,
        btcReturn24hMinimum: 0,
        rsiMinimum: 48,
        rsiMaximum: 78,
        volumeRatioMinimum: 0.25,
        volumeRatioMaximum: 3,
        atr24RatioMaximum: 0.05,
        maxHoldHours: 120,
        hardStopPct: 0.08,
        trailingActivationPct: 0.10,
        trailingRetracePct: 0.03,
    },
    sizing: {
        targetVolatility: 0.02,
        grossMultiplier: 0.75,
        grossFloor: 0.60,
        grossCap: 0.75,
    },
    cooldownHours: 6,
    safety: {
        maxSlippageBps: 35,
        minimumOrderNotionalUsd: 5,
        cashReservePct: 2,
        maxTransactionRetries: 5,
        closeUnmanagedPositions: false,
    },
} as const;

export const PENGU_DUAL_LS_V2_RUNTIME = {
    strategyId: PENGU_DUAL_LS_V2.id,
    mode: "SHADOW" as PenguDualLsV2Mode,
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

export interface ResolvedPenguDualLsV2Runtime {
    strategyId: typeof PENGU_DUAL_LS_V2.id;
    mode: PenguDualLsV2Mode;
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
    maximumEntryDelayMs: number;
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
export function resolvePenguDualLsV2Runtime(env: Partial<NodeJS.ProcessEnv> = process.env): ResolvedPenguDualLsV2Runtime {
    const rawMode = String(env.PENGU_DUAL_LS_V2_MODE || PENGU_DUAL_LS_V2_RUNTIME.mode).trim().toUpperCase();
    const mode: PenguDualLsV2Mode = rawMode === "LIVE" || rawMode === "PAPER" ? rawMode : "SHADOW";
    const maximumGross = Math.min(PENGU_DUAL_LS_V2.maximumGross, Math.max(0, finiteEnv(env.PENGU_DUAL_LS_V2_MAX_GROSS, PENGU_DUAL_LS_V2.maximumGross)));
    const cashReservePct = Math.min(25, Math.max(0, finiteEnv(env.PENGU_DUAL_LS_V2_CASH_RESERVE_PCT, PENGU_DUAL_LS_V2.safety.cashReservePct)));
    return {
        strategyId: PENGU_DUAL_LS_V2.id,
        mode,
        enabled: boolEnv(env.PENGU_DUAL_LS_V2_ENABLED, PENGU_DUAL_LS_V2_RUNTIME.enabled),
        liveTradingEnabled: boolEnv(env.PENGU_DUAL_LS_V2_LIVE_TRADING_ENABLED, PENGU_DUAL_LS_V2_RUNTIME.liveTradingEnabled),
        liveExecutionEnabled: boolEnv(env.PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED, PENGU_DUAL_LS_V2_RUNTIME.liveExecutionEnabled),
        maximumGross,
        longGross: Math.min(PENGU_DUAL_LS_V2.longGross, maximumGross),
        shortGross: Math.min(PENGU_DUAL_LS_V2.shortGross, maximumGross),
        cashReservePct,
        maximumSlippageBps: Math.max(1, finiteEnv(env.PENGU_DUAL_LS_V2_MAX_SLIPPAGE_BPS, PENGU_DUAL_LS_V2.safety.maxSlippageBps)),
        minimumOrderNotionalUsd: Math.max(5, finiteEnv(env.PENGU_DUAL_LS_V2_MIN_ORDER_NOTIONAL_USD, PENGU_DUAL_LS_V2.safety.minimumOrderNotionalUsd)),
        maxTransactionRetries: Math.max(1, Math.floor(finiteEnv(env.PENGU_DUAL_LS_V2_MAX_TRANSACTION_RETRIES, PENGU_DUAL_LS_V2.safety.maxTransactionRetries))),
        maximumEntryDelayMs: Math.min(5 * 60_000, Math.max(5_000, finiteEnv(env.PENGU_DUAL_LS_V2_MAX_ENTRY_DELAY_MS, 5 * 60_000))),
        portfolioGrossCap: Math.max(0, Math.min(PENGU_DUAL_LS_V2.portfolioGrossCap, finiteEnv(env.PENGU_DUAL_LS_V2_PORTFOLIO_GROSS_CAP, PENGU_DUAL_LS_V2.portfolioGrossCap))),
        maximumDailyLossPct: Math.max(0, Math.min(5, finiteEnv(env.PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT, 5))),
        killSwitchPath: env.PENGU_DUAL_LS_V2_KILL_SWITCH_FILE,
        portfolioDailyLossStatePath: env.PENGU_DUAL_LS_V2_PORTFOLIO_DAILY_LOSS_STATE_FILE,
        closeUnmanagedPositions: false,
    };
}
