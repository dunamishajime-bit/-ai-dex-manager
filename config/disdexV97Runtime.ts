export type DisDexV97Mode = "SHADOW" | "PAPER" | "LIVE";

export const DISDEX_V97_STRATEGY_ID = "V97_ADAPTIVE_EVENT_CORE_V1" as const;

export const DISDEX_V97_CORE = {
    strategyId: DISDEX_V97_STRATEGY_ID,
    symbols: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "LINKUSDT", "AVAXUSDT"] as const,
    barInterval: "4h" as const,
    lookbackDays: 10,
    minimumDeclinePct: 5,
    bounceHours: 8,
    minimumBouncePct: 1,
    smaDays: 20,
    maximumRelativeMoveToBtcPct: 0,
    holdingHours: 84,
    baseGross: 0.75,
    maximumAdaptiveGross: 1.25,
    onePositionMaximum: true,
    side: "SHORT_ONLY" as const,
    signalChronology: "COMPLETED_4H_BAR_NEXT_4H_OPEN" as const,
    tieBreak: "SCORE_THEN_SYMBOL_DESC" as const,
    scoreWeights: { decline: 1, relativeWeakness: 0.3, bounce: 0.2, negativeCurrent4h: 0.4, volumeRatio: 0.2 },
    volumeRatio: { recentBars: 12, baseBars: 48, minimum: 0 },
} as const;

export const DISDEX_V97_RISK = {
    portfolioGrossCap: 2.5,
    maximumPortfolioDailyLossPct: 2,
    dailyLossTimeZone: "UTC" as const,
    dailyLossAction: "CANCEL_NEW_ORDERS_AND_FLATTEN_MANAGED" as const,
    maxSlippageBps: 35,
    minimumOrderNotionalUsd: 5,
    cashReservePct: 2,
    maxTransactionRetries: 5,
    closeUnmanagedPositions: false,
    killSwitchFailClosed: true,
} as const;

export const DISDEX_V97_CONTROLLER = {
    version: "RESEARCH_PENDING" as const,
    adaptiveEnabled: false,
    baseGross: DISDEX_V97_CORE.baseGross,
    maximumGross: DISDEX_V97_CORE.maximumAdaptiveGross,
} as const;

export const DISDEX_V97_RUNTIME = {
    strategyId: DISDEX_V97_STRATEGY_ID,
    mode: "SHADOW" as DisDexV97Mode,
    enabled: false,
    // This repository gate cannot be raised by environment variables. It is
    // intentionally false until research + execution parity + readiness pass.
    liveTradingEnabled: false,
    liveExecutionEnabled: false,
    implementationStatus: "RESEARCH_PARITY_AND_LIVE_READINESS_IN_PROGRESS" as const,
    stateSchemaVersion: 1,
    stateDirectory: ".runtime-state/disdex-v97",
    orderClientIdPrefix: "v97-",
} as const;

function boolEnv(value: string | undefined, fallback: boolean) {
    if (value === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(value.trim());
}
function finiteEnv(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveDisDexV97Runtime(env: Partial<NodeJS.ProcessEnv> = process.env) {
    const rawMode = String(env.DISDEX_V97_MODE || DISDEX_V97_RUNTIME.mode).trim().toUpperCase();
    const mode: DisDexV97Mode = rawMode === "LIVE" || rawMode === "PAPER" ? rawMode : "SHADOW";
    const maximumGross = Math.min(DISDEX_V97_CORE.maximumAdaptiveGross, Math.max(0, finiteEnv(env.DISDEX_V97_MAX_GROSS, DISDEX_V97_CONTROLLER.maximumGross)));
    return {
        strategyId: DISDEX_V97_STRATEGY_ID,
        mode,
        enabled: boolEnv(env.DISDEX_V97_ENABLED, DISDEX_V97_RUNTIME.enabled),
        // Explicit environment switches are necessary but never sufficient.
        liveTradingEnabled: DISDEX_V97_RUNTIME.liveTradingEnabled && boolEnv(env.DISDEX_V97_LIVE_TRADING_ENABLED, false),
        liveExecutionEnabled: boolEnv(env.DISDEX_V97_LIVE_EXECUTION_ENABLED, DISDEX_V97_RUNTIME.liveExecutionEnabled),
        baseGross: Math.min(DISDEX_V97_CORE.baseGross, maximumGross),
        maximumGross,
        portfolioGrossCap: Math.min(2.5, Math.max(0, finiteEnv(env.DISDEX_V97_PORTFOLIO_GROSS_CAP, DISDEX_V97_RISK.portfolioGrossCap))),
        maximumDailyLossPct: Math.min(2, Math.max(0, finiteEnv(env.DISDEX_V97_MAX_DAILY_LOSS_PCT, DISDEX_V97_RISK.maximumPortfolioDailyLossPct))),
        maxSlippageBps: Math.max(1, finiteEnv(env.DISDEX_V97_MAX_SLIPPAGE_BPS, DISDEX_V97_RISK.maxSlippageBps)),
        minimumOrderNotionalUsd: Math.max(5, finiteEnv(env.DISDEX_V97_MIN_ORDER_NOTIONAL_USD, DISDEX_V97_RISK.minimumOrderNotionalUsd)),
        maxTransactionRetries: Math.max(1, Math.floor(finiteEnv(env.DISDEX_V97_MAX_TRANSACTION_RETRIES, DISDEX_V97_RISK.maxTransactionRetries))),
        killSwitchPath: env.DISDEX_V97_KILL_SWITCH_FILE,
        portfolioDailyLossStatePath: env.DISDEX_V97_PORTFOLIO_DAILY_LOSS_STATE_FILE,
        adaptiveEnabled: DISDEX_V97_CONTROLLER.adaptiveEnabled && boolEnv(env.DISDEX_V97_ADAPTIVE_ENABLED, false),
        closeUnmanagedPositions: false as const,
    };
}
