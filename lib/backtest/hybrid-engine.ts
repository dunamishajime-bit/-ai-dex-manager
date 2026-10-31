import path from "path";
import crypto from "crypto";
import fs from "fs/promises";

import { RECLAIM_HYBRID_EXECUTION_PROFILE } from "../../config/reclaimHybridStrategy";
import { selectStrategyPreset } from "../../config/strategyMode";
import { loadHistoricalCandles } from "./binance-source";
import { buildIndicatorBars, latestIndicatorAtOrBefore as findLatestIndicatorAtOrBefore, resampleTo12h, resampleTo1d, resampleToHours, sma } from "./indicators";
import type {
    BacktestMode,
    BacktestResult,
    BacktestSettings,
    Candle1h,
    Candle12h,
    EquityPoint,
    IndicatorBar,
    PeriodReturnRow,
    PositionSide,
    PositionState,
    RegimeSnapshot,
    TradeEventRow,
    TradePairRow,
} from "./types";

const HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const LIVE_DECISION_LOOKBACK_MS = 120 * 24 * HOUR_MS;
const BASE_EQUITY = 10_000;
const TRADE_SYMBOLS = ["ETH", "SOL", "AVAX"] as const;
const EXPANDED_TREND_SYMBOLS = ["ETH", "SOL", "AVAX", "BNB", "LINK"] as const;
const RANGE_SYMBOLS = ["ETH", "SOL"] as const;
const ALL_SYMBOLS = ["BTC", "ETH", "SOL", "AVAX", "TRX", "CAKE", "BNB", "LINK", "SFP", "NEAR", "LTC", "XRP", "ATOM", "AAVE", "UNI", "ADA", "INJ"] as const;
type TradeSymbol = typeof ALL_SYMBOLS[number];
const REBALANCE_BARS = 11;
type HybridTimeframe = "15m" | "1h" | "2h" | "4h" | "6h" | "12h" | "1d";
type FrameSet = {
    bySymbol: Record<string, Candle1h[]>;
    indicators: Record<string, IndicatorBar[]>;
    timeline: number[];
};

const frameMemoryCache = new Map<string, Promise<FrameSet>>();
const indicatorMemoryCache = new WeakMap<Record<string, Candle1h[]>, Map<string, Record<string, IndicatorBar[]>>>();
const latestIndicatorLookupCache = new WeakMap<IndicatorBar[], Map<number, IndicatorBar | null>>();
const latestIndicatorIndexLookupCache = new WeakMap<IndicatorBar[], Map<number, number>>();
const executionBarLookupCache = new WeakMap<Candle1h[], Map<number, Candle1h | null>>();
const LIVE_FRAME_END_GRANULARITY_MS = 60 * 1000;

function liveFrameEndTs(timeframe?: HybridTimeframe) {
    if (timeframe === "15m") {
        return Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS - 1;
    }
    return Math.floor(Date.now() / LIVE_FRAME_END_GRANULARITY_MS) * LIVE_FRAME_END_GRANULARITY_MS;
}

function timeframeToMs(timeframe: HybridTimeframe) {
    switch (timeframe) {
        case "15m": return FIFTEEN_MIN_MS;
        case "1h": return HOUR_MS;
        case "2h": return 2 * HOUR_MS;
        case "4h": return 4 * HOUR_MS;
        case "6h": return 6 * HOUR_MS;
        case "12h": return 12 * HOUR_MS;
        case "1d": return 24 * HOUR_MS;
        default: return 12 * HOUR_MS;
    }
}

function elapsedBars(entryTs: number, currentTs: number, barMs: number) {
    if (entryTs <= 0 || currentTs <= entryTs || barMs <= 0) return 0;
    return Math.floor((currentTs - entryTs) / barMs);
}

const DEFAULT_RULES: Record<typeof ALL_SYMBOLS[number], { stepSize: number; minQty: number; minNotional: number }> = {
    BTC: { stepSize: 0.0001, minQty: 0.0001, minNotional: 10 },
    ETH: { stepSize: 0.001, minQty: 0.001, minNotional: 10 },
    SOL: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
    AVAX: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
    TRX: { stepSize: 1, minQty: 1, minNotional: 5 },
    CAKE: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
    BNB: { stepSize: 0.001, minQty: 0.001, minNotional: 10 },
    LINK: { stepSize: 0.1, minQty: 0.1, minNotional: 10 },
    SFP: { stepSize: 0.1, minQty: 0.1, minNotional: 5 },
    NEAR: { stepSize: 0.1, minQty: 0.1, minNotional: 5 },
    LTC: { stepSize: 0.001, minQty: 0.001, minNotional: 5 },
    XRP: { stepSize: 0.1, minQty: 0.1, minNotional: 5 },
    ATOM: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
    AAVE: { stepSize: 0.001, minQty: 0.001, minNotional: 10 },
    UNI: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
    ADA: { stepSize: 0.1, minQty: 0.1, minNotional: 5 },
    INJ: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
};

const EXTENDED_RULES: Record<string, { stepSize: number; minQty: number; minNotional: number }> = {
    ...DEFAULT_RULES,
    ZEC: { stepSize: 0.001, minQty: 0.001, minNotional: 10 },
    DASH: { stepSize: 0.001, minQty: 0.001, minNotional: 10 },
    BAT: { stepSize: 0.1, minQty: 0.1, minNotional: 10 },
};

export interface HybridVariantOptions {
    initialEquity?: number | null;
    backtestStartTs?: number;
    backtestEndTs?: number;
    backtestExecutionStartTs?: number | null;
    activeYears?: readonly number[];
    disableTrend?: boolean;
    forceRangeOnly?: boolean;
    ignoreRangeRegimeGate?: boolean;
    rangeSymbols?: readonly (typeof TRADE_SYMBOLS[number])[];
    useThreeWayRegime?: boolean;
    allowRangeWhenTrendWeak?: boolean;
    trendAlloc?: number;
    rangeAlloc?: number;
    rangeEntryMode?: "mean_revert" | "box_rebound" | "acceptance" | "reclaim" | "wick_rejection" | "midline_reclaim" | "volatility_spring" | "failed_breakdown" | "atr_snapback" | "compression_turn" | "sma_reclaim_pulse" | "atr_or_failed_breakdown";
    rangeRegimeBtcDistMin?: number | null;
    rangeRegimeBtcDistMax?: number | null;
    rangeRegimeBtcAdxMax?: number | null;
    rangeRegimeBreadth40Max?: number | null;
    rangeRegimeBestMom20Min?: number | null;
    rangeRegimeBestMom20Max?: number | null;
    trendExitSma?: 40 | 45;
    trendWeakExitBestMom20Below?: number | null;
    trendWeakExitBtcAdxBelow?: number | null;
    trendBreakoutLookbackBars?: number | null;
    trendBreakoutMinPct?: number | null;
    trendMinVolumeRatio?: number | null;
    trendMinMomAccel?: number | null;
    trendMinEfficiencyRatio?: number | null;
    trendMinSmaDistancePct?: number | null;
    trendBreakoutLookbackBarsBySymbol?: Record<string, number>;
    trendBreakoutMinPctBySymbol?: Record<string, number>;
    trendDisableBreakoutSymbols?: readonly string[];
    trendAllowDowBreakoutProxySymbols?: readonly string[];
    trendMinVolumeRatioBySymbol?: Record<string, number>;
    trendMinMomAccelBySymbol?: Record<string, number>;
    trendMinEfficiencyRatioBySymbol?: Record<string, number>;
    trendMinSmaDistancePctBySymbol?: Record<string, number>;
    trendWindowedOverridesBySymbol?: Record<string, {
        windows: readonly { startTs: number; endTs: number }[];
        breakoutLookbackBars?: number;
        breakoutMinPct?: number;
        minVolumeRatio?: number;
        minMomAccel?: number;
        minEfficiencyRatio?: number;
        minSmaDistancePct?: number;
        scoreAdjustment?: number;
    }>;
    trendScoreAdjustmentBySymbol?: Record<string, number>;
    trendAllocBySymbol?: Record<string, number>;
    trendScoreEfficiencyBonusWeight?: number | null;
    trendScoreOverheatPenaltyWeight?: number | null;
    trendProfitTrailActivationPct?: number | null;
    trendProfitTrailRetracePct?: number | null;
    trendProfitTrailActivationPctBySymbol?: Record<string, number>;
    trendProfitTrailRetracePctBySymbol?: Record<string, number>;
    trendMaxHoldBars?: number | null;
    trendMaxHoldBarsBySymbol?: Record<string, number>;
    rangeEntryBestMom20Below?: number | null;
    rangeEntryBtcAdxBelow?: number | null;
    rangeOverheatMax?: number;
    rangeExitMom20Above?: number;
    rangeMaxHoldBars?: number;
    auxRangeSymbols?: readonly (typeof TRADE_SYMBOLS[number])[];
    auxRangeEntryMode?: "mean_revert" | "box_rebound" | "acceptance" | "reclaim" | "wick_rejection" | "midline_reclaim" | "volatility_spring" | "failed_breakdown" | "atr_snapback" | "compression_turn" | "sma_reclaim_pulse" | "atr_or_failed_breakdown";
    auxRangeActiveYears?: readonly number[];
    auxRangeIgnoreRegimeGate?: boolean;
    auxRangeAlloc?: number;
    auxRangeEntryBestMom20Below?: number | null;
    auxRangeEntryBtcAdxBelow?: number | null;
    auxRangeOverheatMax?: number;
    auxRangeExitMom20Above?: number;
    auxRangeMaxHoldBars?: number;
    aux2RangeSymbols?: readonly (typeof TRADE_SYMBOLS[number])[];
    aux2RangeEntryMode?: "mean_revert" | "box_rebound" | "acceptance" | "reclaim" | "wick_rejection" | "midline_reclaim" | "volatility_spring" | "failed_breakdown" | "atr_snapback" | "compression_turn" | "sma_reclaim_pulse" | "atr_or_failed_breakdown";
    aux2RangeActiveYears?: readonly number[];
    aux2RangeIgnoreRegimeGate?: boolean;
    aux2RangeAlloc?: number;
    aux2RangeEntryBestMom20Below?: number | null;
    aux2RangeEntryBtcAdxBelow?: number | null;
    aux2RangeOverheatMax?: number;
    aux2RangeExitMom20Above?: number;
    aux2RangeMaxHoldBars?: number;
    trendDecisionTimeframe?: "15m" | "1h" | "2h" | "4h" | "6h" | "12h" | "1d";
    trendDecisionOffsetHours?: number;
    fridayDecisionTimeframe?: "2h";
    nightDecisionTimeframe?: "1h";
    nightDecisionJstStartHour?: number;
    nightDecisionJstEndHour?: number;
    trendExitCheckTimeframe?: "15m" | "4h" | "6h" | "12h";
    trendEntryAssistTimeframe?: "12h" | "1d";
    trendEntryAssistRequireMomentum?: boolean;
    trendEntryAssistRequireCloseAboveSma?: boolean;
    trendEntryAssistMaxMomAccelBelow?: number | null;
    expandedTrendSymbols?: readonly string[];
    strictExtraTrendSymbols?: readonly string[];
    strictExtraTrendAllowedWindows?: readonly { startTs: number; endTs: number }[];
    strictExtraTrendIdleOnly?: boolean;
    strictExtraTrendDecisionTimeframe?: "15m" | "4h" | "6h" | "12h" | "1d";
    strictExtraTrendExitCheckTimeframe?: "15m" | "4h" | "6h" | "12h";
    strictExtraTrendMinEfficiencyRatio?: number | null;
    strictExtraTrendMinEfficiencyRatioBySymbol?: Record<string, number>;
    strictExtraTrendMinVolumeRatio?: number | null;
    strictExtraTrendTrailActivationPct?: number | null;
    strictExtraTrendTrailRetracePct?: number | null;
    strictExtraTrendHardStopLossPct?: number | null;
    strictExtraTrendMaxHoldBars?: number | null;
    strictExtraTrendTrailActivationPctBySymbol?: Record<string, number>;
    strictExtraTrendTrailRetracePctBySymbol?: Record<string, number>;
    strictExtraTrendStrongTrailSymbols?: readonly string[];
    strictExtraTrendStrongTrailMinScore?: number | null;
    strictExtraTrendStrongTrailMinMom20?: number | null;
    strictExtraTrendStrongTrailMinMomAccel?: number | null;
    strictExtraTrendStrongTrailMinEfficiencyRatio?: number | null;
    strictExtraTrendStrongTrailActivationPct?: number | null;
    strictExtraTrendStrongTrailRetracePct?: number | null;
    strictExtraTrendStrongTrailDisableWhileStrong?: boolean;
    strictExtraTrendReentryAfterExitSymbols?: readonly string[];
    strictExtraTrendReentryAfterExitReasons?: readonly string[];
    strictExtraTrendReentryTimeframe?: "15m" | "1h" | "4h" | "6h" | "12h";
    strictExtraTrendReentryMinBarsAfterExit?: number;
    strictExtraTrendReentryMaxBarsAfterExit?: number;
    strictExtraTrendReentryMinScore?: number | null;
    strictExtraTrendReentryMinMom20?: number | null;
    strictExtraTrendReentryMinMomAccel?: number | null;
    strictExtraTrendReentryMinEfficiencyRatio?: number | null;
    strictExtraTrendReentryRequiredScoreGap?: number | null;
    strictExtraTrendReentryRequireTrendCandidateWeak?: boolean;
    strictExtraTrendHardStopLossPctBySymbol?: Record<string, number>;
    strictExtraTrendMaxHoldBarsBySymbol?: Record<string, number>;
    strictExtraTrendRotationWhileHolding?: boolean;
    strictExtraTrendRotationScoreGap?: number | null;
    strictExtraTrendRotationScoreGapBySymbol?: Record<string, number>;
    strictExtraTrendRotationCurrentMomAccelMax?: number | null;
    strictExtraTrendRotationCurrentMom20Max?: number | null;
    strictExtraTrendRotationCurrentSymbols?: readonly string[];
    strictExtraTrendRotationCandidateMinScore?: number | null;
    strictExtraTrendRotationCandidateMinMom20?: number | null;
    strictExtraTrendRotationCandidateMinMomAccel?: number | null;
    strictExtraTrendRotationCandidateMinAdx14?: number | null;
    strictExtraTrendRotationCandidateMinEfficiencyRatio?: number | null;
    strictExtraTrendRotationRequireConsecutiveBars?: number;
    strictExtraTrendRotationRequireConsecutiveBarsBySymbol?: Record<string, number>;
    strictExtraTrendRotationMinHoldBars?: number;
    strictExtraTrendRotationBlockBelowDrawdownPct?: number | null;
    strictExtraTrendPriorityCurrentSymbols?: readonly string[];
    strictExtraTrendPriorityScoreGap?: number | null;
    strictExtraTrendPriorityRequireHigherMom20?: boolean;
    strictExtraTrendPriorityRequireHigherEfficiency?: boolean;
    strictExtraTrendHoldUntilExit?: boolean;
    strictExtraTrendSwitchGuardSymbols?: readonly string[];
    strictExtraTrendSwitchGuardMinCurrentScore?: number | null;
    strictExtraTrendSwitchGuardMinCurrentMom20?: number | null;
    strictExtraTrendSwitchGuardMinCurrentMomAccel?: number | null;
    strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio?: number | null;
    strictExtraTrendSwitchGuardRequiredScoreGap?: number | null;
    strictExtraTrendSwitchGuardTargetSymbols?: readonly string[];
    strictExtraTrendSwitchGuardNearTrailRatio?: number | null;
    strictExtraTrendSwitchGuardBlockBelowProfitPct?: number | null;
    strictExtraTrendSwitchGuardBlockAfterTrailActivation?: boolean;
    strictExtraTrendSwitchGuardMode?: "any" | "all";
    strictExtraTrendSwitchToCashSymbols?: readonly string[];
    strictExtraTrendSwitchToCashTargetSymbols?: readonly string[];
    strictExtraTrendSwitchToCashBelowProfitPct?: number | null;
    idleBreakoutEntryWhileCash?: boolean;
    idleBreakoutEntryTimeframe?: "15m" | "1h" | "4h" | "6h" | "12h";
    idleBreakoutSymbols?: readonly string[];
    idleBreakoutAllowedWindows?: readonly { startTs: number; endTs: number }[];
    idleBreakoutAllowTradeGateOff?: boolean;
    idleBreakoutMinVolumeRatio?: number | null;
    idleBreakoutMinMomAccel?: number | null;
    idleBreakoutBreakoutLookbackBars?: number | null;
    idleBreakoutBreakoutMinPct?: number | null;
    idleBreakoutMinEfficiencyRatio?: number | null;
    idleBreakoutProfitTrailActivationPct?: number | null;
    idleBreakoutProfitTrailRetracePct?: number | null;
    idleBreakoutTieredTrailBySymbol?: Record<string, readonly { activationPct: number; retracePct: number }[]>;
    idleBreakoutConditionalEarlyTrailBySymbol?: Record<string, {
        activationPct: number;
        retracePct: number;
        maxPeakProfitPct?: number | null;
        entryMinMom20?: number | null;
        entryMaxMom20?: number | null;
        entryMinMom80?: number | null;
        entryMaxMom80?: number | null;
        entryMinMomAccel?: number | null;
        entryMaxMomAccel?: number | null;
        entryMinVolumeRatio?: number | null;
        entryMaxVolumeRatio?: number | null;
        entryMinEfficiencyRatio?: number | null;
        entryMaxEfficiencyRatio?: number | null;
        entryMinRecentHighDrawdownPct?: number | null;
        entryMinLongHighDrawdownPct?: number | null;
        maxMom20?: number | null;
        maxMom80?: number | null;
        maxMomAccel?: number | null;
        maxVolumeRatio?: number | null;
        maxEfficiencyRatio?: number | null;
        minRecentHighDrawdownPct?: number | null;
        minLongHighDrawdownPct?: number | null;
        longHighDrawdownLookbackBars?: number | null;
        minClose?: number | null;
        maxClose?: number | null;
        activeFromTs?: number | null;
        activeUntilTs?: number | null;
        minHoldBars?: number | null;
        minBarsSincePeak?: number | null;
        disableWhenMom20AtLeast?: number | null;
        disableWhenMom80AtLeast?: number | null;
        disableWhenMomAccelAtLeast?: number | null;
        disableWhenVolumeRatioAtLeast?: number | null;
        disableWhenEfficiencyRatioAtLeast?: number | null;
        disableMode?: "any" | "all";
    }>;
    idleBreakoutEarlyTrailReentryBySymbol?: Record<string, {
        reentryPct: number;
        maxBarsAfterExit?: number | null;
        referencePrice?: "exit" | "peak";
    }>;
    idleBreakoutPartialRunnerReentryBySymbol?: Record<string, {
        reentryPct: number;
        maxBarsAfterExit?: number | null;
        alloc?: number | null;
    }>;
    idleBreakoutTakeProfitExitBySymbol?: Record<string, {
        takeProfitPct: number;
    }>;
    idleBreakoutPartialExitBySymbol?: Record<string, {
        fraction: number;
        baseTakeProfitPct: number;
        strongTakeProfitPct?: number;
        strongMinMomAccel?: number;
        strongMinVolumeRatio?: number;
        stopAfterPartialPct?: number;
        runnerTrailActivationPct?: number;
        runnerTrailRetracePct?: number;
        buybackBreakoutPct?: number;
        buybackMaxBarsAfterPartial?: number;
        buybackMinMomAccel?: number;
        buybackMinVolumeRatio?: number;
    }>;
    partialExitBySymbol?: Record<string, {
        fraction: number;
        baseTakeProfitPct: number;
        strongTakeProfitPct?: number;
        strongMinMomAccel?: number;
        strongMinVolumeRatio?: number;
        stopAfterPartialPct?: number;
        runnerTrailActivationPct?: number;
        runnerTrailRetracePct?: number;
        buybackBreakoutPct?: number;
        buybackMaxBarsAfterPartial?: number;
        buybackMinMomAccel?: number;
        buybackMinVolumeRatio?: number;
    }>;
    idleBreakoutMaxHoldBars?: number | null;
    idleBreakoutStrongMaxHoldBarsBySymbol?: Record<string, number>;
    idleBreakoutStrongMaxHoldMinMom20?: number | null;
    idleBreakoutStrongMaxHoldMinMomAccel?: number | null;
    idleBreakoutWeakExitMom20Below?: number | null;
    idleBreakoutWeakExitMomAccelBelow?: number | null;
    idleBreakoutWeakExitMinHoldBars?: number | null;
    idleBreakoutWeakExitRequireCloseBelowSma40?: boolean;
    idleBreakoutWeakExitOnlyWhenLoss?: boolean;
    idleBreakoutWeakExitMinLossPct?: number | null;
    idleBreakoutFailureExitBySymbol?: Record<string, {
        minHoldBars: number;
        maxPeakProfitPct: number;
        requireLoss?: boolean;
        maxMom20?: number | null;
        maxMomAccel?: number | null;
        requireCloseBelowSma40?: boolean;
    }>;
    idleBreakoutSmaBreakGuardSymbols?: readonly string[];
    idleBreakoutSmaBreakGuardMinMom20?: number | null;
    idleBreakoutSmaBreakGuardMinMomAccel?: number | null;
    idleBreakoutSmaBreakGuardMaxCloseBelowSmaPct?: number | null;
    idleBreakoutSmaBreakGuardMinHoldBars?: number | null;
    idleBreakoutRiskOffGuardSymbols?: readonly string[];
    idleBreakoutRiskOffGuardMinMom20?: number | null;
    idleBreakoutRiskOffGuardMinMomAccel?: number | null;
    idleBreakoutRiskOffGuardMaxCloseBelowSmaPct?: number | null;
    idleBreakoutSwitchGuardMinCurrentScore?: number | null;
    idleBreakoutSwitchGuardMinCurrentMom20?: number | null;
    idleBreakoutSwitchGuardMinCurrentMomAccel?: number | null;
    idleBreakoutSwitchGuardMinCurrentEfficiencyRatio?: number | null;
    idleBreakoutSwitchGuardRequiredScoreGap?: number | null;
    idleBreakoutSwitchGuardTargetSymbols?: readonly string[];
    idleBreakoutSwitchGuardBlockBelowProfitPct?: number | null;
    idleBreakoutSwitchGuardBlockAfterTrailActivation?: boolean;
    idleBreakoutSwitchGuardMode?: "any" | "all";
    idleNightBreakoutEntryWhileCash?: boolean;
    idleNightBreakoutEntryTimeframe?: "15m" | "1h" | "4h" | "6h" | "12h";
    idleNightBreakoutSymbols?: readonly string[];
    idleNightBreakoutJstStartHour?: number;
    idleNightBreakoutJstEndHour?: number;
    idleNightBreakoutAllowTradeGateOff?: boolean;
    idleNightBreakoutMinVolumeRatio?: number | null;
    idleNightBreakoutMinMomAccel?: number | null;
    idleNightBreakoutBreakoutLookbackBars?: number | null;
    idleNightBreakoutBreakoutMinPct?: number | null;
    idleNightBreakoutMinEfficiencyRatio?: number | null;
    idleNightBreakoutMaxOneBarMovePct?: number | null;
    idleNightBreakoutMinRecentRangePct?: number | null;
    idleNightBreakoutMaxRecentRangePct?: number | null;
    idleNightBreakoutMinRecentPathPct?: number | null;
    idleNightBreakoutMaxNotionalUsd?: number | null;
    injSpringCashEntry?: boolean;
    injSpringCashQuoteCostPct?: number | null;
    injSpringCashHardStopLossPct?: number | null;
    injSpringCashTrailActivationPct?: number | null;
    injSpringCashTrailRetracePct?: number | null;
    injSpringCashMaxHoldBars?: number | null;
    penguOffRotationEntry?: boolean;
    penguOffRotationTimeframe?: "15m" | "1h" | "2h" | "4h" | "6h" | "12h";
    penguOffRotationSymbols?: readonly string[];
    penguOffRotationCurrentSymbols?: readonly string[];
    penguOffRotationScoreGap?: number | null;
    penguOffRotationMinHoldBars?: number | null;
    penguOffRotationAllowFromCash?: boolean;
    penguOffRotationAllowWhileHolding?: boolean;
    penguOffRotationAllowTradeGateOff?: boolean;
    penguOffRotationAllowedWindows?: readonly { startTs: number; endTs: number }[];
    penguOffRotationAllowedWindowsBySymbol?: Record<string, readonly { startTs: number; endTs: number }[]>;
    penguOffRotationMaxNotionalUsd?: number | null;
    penguOffRotationMaxNotionalUsdBySymbol?: Record<string, number>;
    penguStrongOverrideEntry?: boolean;
    penguStrongOverrideTimeframe?: "15m" | "1h" | "2h" | "4h" | "6h" | "12h";
    penguStrongOverrideSymbols?: readonly string[];
    penguStrongOverrideCurrentSymbols?: readonly string[];
    penguStrongOverrideScoreGap?: number | null;
    penguStrongOverrideMinHoldBars?: number | null;
    penguStrongOverrideAllowTradeGateOff?: boolean;
    penguStrongOverrideAllowedWindows?: readonly { startTs: number; endTs: number }[];
    solWaveOverrideEntry?: boolean;
    solWaveOverrideTimeframe?: "1h" | "2h" | "4h" | "6h" | "12h";
    solWaveOverrideCurrentSymbols?: readonly string[];
    solWaveOverrideScoreGap?: number | null;
    solWaveOverrideMinHoldBars?: number | null;
    solWaveOverrideAllowTradeGateOff?: boolean;
    solWaveOverrideAllowedWindows?: readonly { startTs: number; endTs: number }[];
    solWaveOverrideBreakoutLookbackBars?: number | null;
    solWaveOverrideBreakoutMinPct?: number | null;
    solWaveOverrideMinVolumeRatio?: number | null;
    solWaveOverrideMinMomAccel?: number | null;
    solWaveOverrideMinEfficiencyRatio?: number | null;
    trendRotationWhileHolding?: boolean;
    trendRotationCurrentSymbols?: readonly string[];
    trendRotationScoreGap?: number | null;
    trendRotationAlternateScoreGap?: number | null;
    trendRotationCurrentMomAccelMax?: number | null;
    trendRotationCurrentMom20Max?: number | null;
    trendRotationRequireConsecutiveBars?: number;
    trendRotationAlternateRequireConsecutiveBars?: number;
    trendRotationMinHoldBars?: number;
    trendRotationTargetBlockSymbols?: readonly string[];
    trendRotationTargetExceptionBySymbol?: Record<string, {
        minScore?: number;
        minMom20?: number;
        minMomAccel?: number;
        minVolumeRatio?: number;
        minAdx14?: number;
        minEfficiencyRatio?: number;
        requireStructureBreak?: boolean;
        requireDowHigherHighLow?: boolean;
    }>;
    trendPrioritySymbols?: readonly string[];
    trendPriorityMaxScoreGap?: number | null;
    trendCashInsteadOfEntrySymbols?: readonly string[];
    smallWalletEntryGuardMinEquity?: number | null;
    smallWalletEntryGuardAllowedSymbols?: readonly string[];
    trendSymbolBlockWindows?: Record<string, readonly { startTs: number; endTs: number }[]>;
    trendSymbolQualityBlockBySymbol?: Record<string, {
        minMom20?: number | null;
        maxMom20?: number | null;
        minMomAccel?: number | null;
        maxMomAccel?: number | null;
        minVolumeRatio?: number | null;
        maxVolumeRatio?: number | null;
        minAdx14?: number | null;
        maxAdx14?: number | null;
        minOverheatPct?: number | null;
        maxOverheatPct?: number | null;
        minSmaDistancePct?: number | null;
        maxSmaDistancePct?: number | null;
        mode?: "all" | "any";
    }>;
    trendWeakMarketBlockSymbols?: readonly string[];
    trendWeakMarketBlockRequireWeak2022?: boolean;
    trendWeakMarketBlockBestMom20Below?: number | null;
    trendWeakMarketBlockBtcAdxBelow?: number | null;
    trendWeakMarketBlockWhenBtcBelowSma90?: boolean;
    trendWeakMarketBlockBtcSma90DistanceBelow?: number | null;
    trendWeakMarketBlockBtcSma85DistanceBelow?: number | null;
    trendWeakMarketBlockBreadth40Below?: number | null;
    trendWeakMarketBlockBtcMom20Below?: number | null;
    trendWeakMarketBlockSticky?: boolean;
    symbolSpecificTrendWeakExitSymbols?: readonly string[];
    symbolSpecificTrendWeakExitMom20Below?: number | null;
    symbolSpecificTrendWeakExitMomAccelBelow?: number | null;
    symbolSpecificTrendWeakExitMom20BelowBySymbol?: Record<string, number>;
    symbolSpecificTrendWeakExitMomAccelBelowBySymbol?: Record<string, number>;
    idleCashTrendContext?: boolean;
    idleCashTrendAllowTrendGateOff?: boolean;
    idleCashTrendMinMom20?: number | null;
    idleCashTrendMinEfficiencyRatio?: number | null;
    portfolioDrawdownCashExitPct?: number | null;
    portfolioDrawdownEntryBlockPct?: number | null;
    label?: string;
}

export interface HybridLiveCandidate {
    symbol: string;
    score: number;
    eligible: boolean;
    reasons: string[];
    subVariant?: string;
    alloc?: number;
    exitMom20Above?: number | null;
    maxHoldBars?: number | null;
}

export interface HybridLiveDecision {
    ts: number;
    isoTime: string;
    reserveSymbol: string;
    regime: RegimeSnapshot;
    trendCandidate: HybridLiveCandidate | null;
    rangeCandidate: HybridLiveCandidate | null;
    desiredSymbol: string;
    desiredSide: PositionSide | "cash";
    desiredAlloc: number;
    reason: string;
}

export interface HybridTrendSymbolDecision {
    symbol: string;
    eligible: boolean;
    score: number;
    reasons: string[];
    close: number;
    sma40: number;
    mom20: number;
    mom80?: number;
    momAccel: number;
    adx14: number;
    overheatPct: number;
    volumeRatio: number;
    efficiencyRatio: number;
    recentHighDrawdownPct?: number;
    longHighDrawdownPct?: number;
    structureBreak: boolean;
    dowHigherHighLow: boolean;
}

export interface HybridLiveDecisionDetails {
    decision: HybridLiveDecision;
    trendEvaluations: HybridTrendSymbolDecision[];
}

export interface HybridDecisionWindowPoint {
    ts: number;
    isoTime: string;
    decision: HybridLiveDecision;
    trendEvaluations: HybridTrendSymbolDecision[];
}

function applyVariantSnapshot(
    snapshot: RegimeSnapshot,
    priorWeak2022Regime: boolean,
    mode: BacktestMode,
    options: HybridVariantOptions = {},
) {
    let effectiveSnapshot = mode === "RETQ22"
        ? {
            ...snapshot,
            rangeAllowed: snapshot.rangeAllowed && (snapshot.regimeLabel === "ambiguous" || priorWeak2022Regime),
        }
        : snapshot;

    if (!options.useThreeWayRegime) {
        return effectiveSnapshot;
    }

    const btcDist90 = (snapshot.btc.close / Math.max(1, snapshot.btc.sma90)) - 1;
    const rangeBaseOk =
        (options.rangeRegimeBtcDistMin == null || btcDist90 >= options.rangeRegimeBtcDistMin) &&
        (options.rangeRegimeBtcDistMax == null || btcDist90 <= options.rangeRegimeBtcDistMax) &&
        (options.rangeRegimeBtcAdxMax == null || snapshot.btc.adx14 <= options.rangeRegimeBtcAdxMax) &&
        (options.rangeRegimeBreadth40Max == null || snapshot.breadth40 <= options.rangeRegimeBreadth40Max) &&
        (options.rangeRegimeBestMom20Min == null || snapshot.bestMom20 >= options.rangeRegimeBestMom20Min) &&
        (options.rangeRegimeBestMom20Max == null || snapshot.bestMom20 <= options.rangeRegimeBestMom20Max);
    if (options.ignoreRangeRegimeGate) {
        effectiveSnapshot = {
            ...effectiveSnapshot,
            rangeAllowed: true,
        };
        return effectiveSnapshot;
    }
    if (options.forceRangeOnly) {
        effectiveSnapshot = {
            ...effectiveSnapshot,
            rangeAllowed: rangeBaseOk,
        };
        return effectiveSnapshot;
    }
    const rangeRegime =
        (!snapshot.trendAllowed && rangeBaseOk) ||
        (options.allowRangeWhenTrendWeak === true && snapshot.weak2022Regime && rangeBaseOk);

    effectiveSnapshot = {
        ...effectiveSnapshot,
        rangeAllowed: rangeRegime,
    };

    return effectiveSnapshot;
}

const LOCAL_ZIP_PATHS: Record<typeof ALL_SYMBOLS[number], string | null> = {
    BTC: path.join("C:\\Users\\dis\\Desktop", "2022BTC.zip"),
    ETH: path.join("C:\\Users\\dis\\Desktop", "2022ETH.zip"),
    SOL: path.join("C:\\Users\\dis\\Desktop", "2022SOL.zip"),
    AVAX: null,
    TRX: null,
    CAKE: null,
    BNB: null,
    LINK: null,
    SFP: null,
    NEAR: null,
    LTC: null,
    XRP: null,
    ATOM: null,
    AAVE: null,
    UNI: null,
    ADA: null,
    INJ: null,
};

const EXTRA_LOCAL_ZIP_PATHS: Record<string, string | null> = {
};

function average(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function symbolOverrideNumber(
    bySymbol: Record<string, number> | undefined,
    symbol: string,
    fallback: number | null | undefined,
) {
    const symbolKey = String(symbol || "").toUpperCase();
    if (bySymbol && Object.prototype.hasOwnProperty.call(bySymbol, symbolKey)) {
        return bySymbol[symbolKey];
    }
    return fallback ?? null;
}

function sum(values: number[]) {
    return values.reduce((total, value) => total + value, 0);
}

function formatIso(ts: number) {
    return new Date(ts).toISOString();
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function stepRound(value: number, stepSize: number) {
    return Math.floor(value / stepSize) * stepSize;
}

function markToMarket(positionQty: number, markPrice: number, cash: number, feeRate: number) {
    if (positionQty <= 0) return cash;
    return cash + (positionQty * markPrice * (1 - feeRate));
}

function calcMaxDrawdownPct(points: EquityPoint[]) {
    let peak = points[0]?.equity || BASE_EQUITY;
    let worst = 0;
    for (const point of points) {
        if (point.equity > peak) peak = point.equity;
        if (peak <= 0) continue;
        const dd = ((point.equity / peak) - 1) * 100;
        worst = Math.min(worst, dd);
    }
    return worst;
}

function periodReturns(points: EquityPoint[], keyFn: (point: EquityPoint) => string) {
    const buckets = new Map<string, EquityPoint[]>();
    for (const point of points) {
        const key = keyFn(point);
        const bucket = buckets.get(key) || [];
        bucket.push(point);
        buckets.set(key, bucket);
    }
    return [...buckets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([period, bucket]) => {
            const first = bucket[0]?.equity || BASE_EQUITY;
            const last = bucket.at(-1)?.equity || first;
            return {
                period,
                start_equity: first,
                end_equity: last,
                return_pct: first > 0 ? ((last / first) - 1) * 100 : 0,
            } satisfies PeriodReturnRow;
        });
}

async function loadRawSeries(input?: { startTs?: number; endTs?: number; interval?: "1h" | "15m" }) {
    const startTs = input?.startTs ?? Date.UTC(2022, 0, 1, 0, 0, 0);
    const endTs = input?.endTs ?? (Date.UTC(2026, 0, 1, 0, 0, 0) - 1);
    const cacheRoot = path.join(process.cwd(), ".cache", "hybrid-retq22");

    const bySymbol = {} as Record<typeof ALL_SYMBOLS[number], Candle1h[]>;
    for (const symbol of ALL_SYMBOLS) {
        const remoteSymbol = `${symbol}USDT`;
        const localZipPath = LOCAL_ZIP_PATHS[symbol];
        const candles = await loadHistoricalCandles({
            symbol: remoteSymbol,
            localZipPath: localZipPath || undefined,
            cacheRoot,
            startMs: startTs,
            endMs: endTs,
            interval: input?.interval ?? "1h",
        });
        bySymbol[symbol] = candles;
    }
    return { startTs, endTs, bySymbol };
}

async function loadRawSeriesForUniverse(
    symbols: readonly string[],
    input?: { startTs?: number; endTs?: number; interval?: "1h" | "15m" },
) {
    const startTs = input?.startTs ?? Date.UTC(2022, 0, 1, 0, 0, 0);
    const endTs = input?.endTs ?? (Date.UTC(2026, 0, 1, 0, 0, 0) - 1);
    const cacheRoot = path.join(process.cwd(), ".cache", "hybrid-universe");

    const bySymbol: Record<string, Candle1h[]> = {};
    for (const symbol of symbols) {
        const remoteSymbol = `${symbol}USDT`;
        const localZipPath = symbol in LOCAL_ZIP_PATHS
            ? LOCAL_ZIP_PATHS[symbol as keyof typeof LOCAL_ZIP_PATHS]
            : (EXTRA_LOCAL_ZIP_PATHS[symbol] ?? null);
        const candles = await loadHistoricalCandles({
            symbol: remoteSymbol,
            localZipPath: localZipPath || undefined,
            cacheRoot,
            startMs: startTs,
            endMs: endTs,
            interval: input?.interval ?? "1h",
        });
        bySymbol[symbol] = candles;
    }

    return { startTs, endTs, bySymbol };
}

function buildIndicators(bySymbol: Record<typeof ALL_SYMBOLS[number], Candle1h[]>) {
    const out = {} as Record<typeof ALL_SYMBOLS[number], IndicatorBar[]>;
    for (const symbol of ALL_SYMBOLS) {
        out[symbol] = buildIndicatorBars(resampleTo12h(bySymbol[symbol]));
    }
    return out;
}

function buildIndicatorsByTimeframe(
    bySymbol: Record<typeof ALL_SYMBOLS[number], Candle1h[]>,
    timeframe: HybridTimeframe = "12h",
    offsetHours = 0,
) {
    const out = {} as Record<typeof ALL_SYMBOLS[number], IndicatorBar[]>;
    for (const symbol of ALL_SYMBOLS) {
        const bars = timeframe === "1d"
            ? resampleTo1d(bySymbol[symbol])
            : timeframe === "1h" || timeframe === "15m"
                ? bySymbol[symbol]
            : timeframe === "2h"
                ? resampleToHours(bySymbol[symbol], 2, offsetHours)
            : timeframe === "6h"
                ? resampleToHours(bySymbol[symbol], 6, offsetHours)
                : timeframe === "4h"
                    ? resampleToHours(bySymbol[symbol], 4, offsetHours)
                    : resampleTo12h(bySymbol[symbol], offsetHours);
        out[symbol] = buildIndicatorBars(bars);
    }
    return out;
}

function buildCachedIndicatorsForUniverseByTimeframe(
    bySymbol: Record<string, Candle1h[]>,
    timeframe: HybridTimeframe = "12h",
    offsetHours = 0,
) {
    let byTimeframe = indicatorMemoryCache.get(bySymbol);
    if (!byTimeframe) {
        byTimeframe = new Map();
        indicatorMemoryCache.set(bySymbol, byTimeframe);
    }
    const cacheLabel = `${timeframe}@${offsetHours}`;
    const cached = byTimeframe.get(cacheLabel);
    if (cached) return cached;
    const indicators = buildIndicatorsForUniverseByTimeframe(bySymbol, timeframe, offsetHours);
    byTimeframe.set(cacheLabel, indicators);
    return indicators;
}

function buildCachedIndicatorsByTimeframe(
    bySymbol: Record<TradeSymbol, Candle1h[]>,
    timeframe: HybridTimeframe = "12h",
    offsetHours = 0,
) {
    return buildCachedIndicatorsForUniverseByTimeframe(bySymbol, timeframe, offsetHours) as Record<TradeSymbol, IndicatorBar[]>;
}

function readyTimeline(indicators: Record<string, IndicatorBar[]>, endTs?: number) {
    const latestAllowedTs = endTs ?? Number.POSITIVE_INFINITY;
    return (indicators.BTC || [])
        .filter((bar) => bar.ready && bar.ts <= latestAllowedTs)
        .map((bar) => bar.ts);
}

function buildIndicators1h(bySymbol: Record<typeof ALL_SYMBOLS[number], Candle1h[]>) {
    const out = {} as Record<typeof ALL_SYMBOLS[number], IndicatorBar[]>;
    for (const symbol of ALL_SYMBOLS) {
        out[symbol] = buildIndicatorBars(bySymbol[symbol] as Candle12h[]);
    }
    return out;
}

function buildIndicators1d(bySymbol: Record<typeof ALL_SYMBOLS[number], Candle1h[]>) {
    const out = {} as Record<typeof ALL_SYMBOLS[number], IndicatorBar[]>;
    for (const symbol of ALL_SYMBOLS) {
        out[symbol] = buildIndicatorBars(resampleTo1d(bySymbol[symbol]));
    }
    return out;
}

function buildIndicatorsForUniverse(bySymbol: Record<string, Candle1h[]>) {
    const out: Record<string, IndicatorBar[]> = {};
    for (const [symbol, bars] of Object.entries(bySymbol)) {
        out[symbol] = buildIndicatorBars(resampleTo12h(bars));
    }
    return out;
}

function buildIndicatorsForUniverseByTimeframe(
    bySymbol: Record<string, Candle1h[]>,
    timeframe: HybridTimeframe = "12h",
    offsetHours = 0,
) {
    const out: Record<string, IndicatorBar[]> = {};
    for (const [symbol, rawBars] of Object.entries(bySymbol)) {
        const bars = timeframe === "1d"
            ? resampleTo1d(rawBars)
            : timeframe === "1h" || timeframe === "15m"
                ? rawBars
            : timeframe === "2h"
                ? resampleToHours(rawBars, 2, offsetHours)
            : timeframe === "6h"
                ? resampleToHours(rawBars, 6, offsetHours)
                : timeframe === "4h"
                    ? resampleToHours(rawBars, 4, offsetHours)
                    : resampleTo12h(rawBars, offsetHours);
        out[symbol] = buildIndicatorBars(bars);
    }
    return out;
}

function uniqueSymbols(symbols: readonly string[]) {
    return [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
}

function isFrameSnapshotEnabled() {
    return process.env.BT_USE_FRAME_SNAPSHOT === "1";
}

function snapshotCacheRoot() {
    return process.env.BT_FRAME_SNAPSHOT_DIR
        ? path.resolve(process.cwd(), process.env.BT_FRAME_SNAPSHOT_DIR)
        : path.join(process.cwd(), ".cache", "hybrid-frame-snapshots");
}

function frameSnapshotKey(input: {
    startTs?: number;
    endTs?: number;
    timeframe?: HybridTimeframe;
    offsetHours?: number;
    interval?: "1h" | "15m";
    symbols: readonly string[];
}) {
    const payload = JSON.stringify({
        v: 1,
        startTs: input.startTs ?? null,
        endTs: input.endTs ?? null,
        timeframe: input.timeframe ?? "12h",
        offsetHours: input.offsetHours ?? 0,
        interval: input.interval ?? "1h",
        symbols: uniqueSymbols(input.symbols).sort(),
    });
    return crypto.createHash("sha1").update(payload).digest("hex");
}

function frameSnapshotPath(key: string) {
    return path.join(snapshotCacheRoot(), `${key}.json`);
}

async function readFrameSnapshot(key: string): Promise<FrameSet | null> {
    if (!isFrameSnapshotEnabled()) return null;
    try {
        const raw = await fs.readFile(frameSnapshotPath(key), "utf8");
        return JSON.parse(raw) as FrameSet;
    } catch {
        return null;
    }
}

async function writeFrameSnapshot(key: string, frames: FrameSet) {
    if (!isFrameSnapshotEnabled()) return;
    await fs.mkdir(snapshotCacheRoot(), { recursive: true });
    await fs.writeFile(frameSnapshotPath(key), JSON.stringify(frames), "utf8");
}

function latestIndicatorIndexAtOrBefore(bars: IndicatorBar[], ts: number) {
    let byTs = latestIndicatorIndexLookupCache.get(bars);
    if (!byTs) {
        byTs = new Map();
        latestIndicatorIndexLookupCache.set(bars, byTs);
    }
    const cached = byTs.get(ts);
    if (cached != null) return cached;

    let lo = 0;
    let hi = bars.length - 1;
    let best = -1;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (bars[mid].ts <= ts) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    byTs.set(ts, best);
    return best;
}

function latestIndicatorAtOrBefore(series: IndicatorBar[], ts: number) {
    let byTs = latestIndicatorLookupCache.get(series);
    if (!byTs) {
        byTs = new Map();
        latestIndicatorLookupCache.set(series, byTs);
    }
    if (byTs.has(ts)) return byTs.get(ts) ?? null;
    const bar = findLatestIndicatorAtOrBefore(series, ts);
    byTs.set(ts, bar);
    return bar;
}

function lazyIndicatorMap(indicators: Record<string, IndicatorBar[]>, ts: number) {
    const cache = new Map<string, IndicatorBar | null>();
    return new Proxy({} as Record<string, IndicatorBar | null>, {
        get(_target, property) {
            if (typeof property !== "string") return undefined;
            if (cache.has(property)) return cache.get(property) ?? null;
            const series = indicators[property];
            const bar = series ? latestIndicatorAtOrBefore(series, ts) : null;
            cache.set(property, bar);
            return bar;
        },
    });
}

function lazyExecutionRawMap(bySymbol: Record<string, Candle1h[]>, ts: number) {
    const cache = new Map<string, Candle1h | null>();
    return new Proxy({} as Record<string, Candle1h | null>, {
        get(_target, property) {
            if (typeof property !== "string") return undefined;
            if (cache.has(property)) return cache.get(property) ?? null;
            const raw = bySymbol[property];
            const bar = raw ? currentPriceAt(raw, ts) : null;
            cache.set(property, bar);
            return bar;
        },
    });
}

function createIndicatorCursorMap(indicators: Record<string, IndicatorBar[]>) {
    const entries = Object.entries(indicators).map(([symbol, series]) => ({
        symbol,
        series,
        index: -1,
    }));
    return {
        at(ts: number) {
            const out: Record<string, IndicatorBar | null> = {};
            for (const entry of entries) {
                while (entry.index + 1 < entry.series.length && entry.series[entry.index + 1].ts <= ts) {
                    entry.index += 1;
                }
                out[entry.symbol] = entry.index >= 0 ? entry.series[entry.index] : null;
            }
            return out;
        },
    };
}

function createExecutionRawCursorMap(bySymbol: Record<string, Candle1h[]>) {
    const entries = Object.entries(bySymbol).map(([symbol, series]) => ({
        symbol,
        series,
        index: -1,
    }));
    return {
        at(ts: number) {
            const out: Record<string, Candle1h | null> = {};
            for (const entry of entries) {
                while (entry.index + 1 < entry.series.length && entry.series[entry.index + 1].ts <= ts) {
                    entry.index += 1;
                }
                out[entry.symbol] = entry.index >= 0 ? entry.series[entry.index] : null;
            }
            return out;
        },
    };
}

function calcEfficiencyRatio(bars: IndicatorBar[], endIndex: number, lookback: number) {
    if (endIndex <= 0 || endIndex - lookback < 0) return 0;
    const endClose = bars[endIndex]?.close;
    const startClose = bars[endIndex - lookback]?.close;
    if (!Number.isFinite(endClose) || !Number.isFinite(startClose)) return 0;
    let path = 0;
    for (let i = endIndex - lookback + 1; i <= endIndex; i += 1) {
        path += Math.abs(bars[i].close - bars[i - 1].close);
    }
    if (path <= 0) return 0;
    return Math.abs(endClose - startClose) / path;
}

function calcMomentum(bars: IndicatorBar[], endIndex: number, lookback: number) {
    if (endIndex < lookback) return 0;
    const endClose = bars[endIndex]?.close;
    const startClose = bars[endIndex - lookback]?.close;
    if (!Number.isFinite(endClose) || !Number.isFinite(startClose) || startClose <= 0) return 0;
    return (endClose / startClose) - 1;
}

function calcRecentHighDrawdownPct(bars: IndicatorBar[], endIndex: number, lookback: number) {
    if (endIndex < 0) return 0;
    const start = Math.max(0, endIndex - lookback + 1);
    let high = -Infinity;
    for (let i = start; i <= endIndex; i += 1) {
        high = Math.max(high, bars[i]?.high ?? bars[i]?.close ?? -Infinity);
    }
    const close = bars[endIndex]?.close;
    if (!Number.isFinite(high) || high <= 0 || !Number.isFinite(close)) return 0;
    return (close / high) - 1;
}

function maxCloseInRange(bars: IndicatorBar[], startIndex: number, endIndexExclusive: number) {
    let maxClose = -Infinity;
    for (let i = Math.max(0, startIndex); i < endIndexExclusive; i += 1) {
        const close = bars[i]?.close;
        if (close > maxClose) maxClose = close;
    }
    return maxClose;
}

function shouldLoad15mRaw(options: HybridVariantOptions = {}) {
    return options.trendDecisionTimeframe === "15m"
        || options.trendExitCheckTimeframe === "15m"
        || options.strictExtraTrendDecisionTimeframe === "15m"
        || options.strictExtraTrendExitCheckTimeframe === "15m"
        || options.strictExtraTrendReentryTimeframe === "15m"
        || options.idleBreakoutEntryTimeframe === "15m"
        || options.idleNightBreakoutEntryTimeframe === "15m";
}

function calcDowHigherHighLow(bars: IndicatorBar[], endIndex: number, lookback = 12) {
    if (endIndex - lookback < 2) return false;
    const split = Math.max(0, endIndex - Math.floor(lookback / 2));
    const priorStart = Math.max(0, endIndex - lookback);
    if (endIndex + 1 - split < 2 || split - priorStart < 2) return false;
    let recentHigh = -Infinity;
    let priorHigh = -Infinity;
    let recentLow = Infinity;
    let priorLow = Infinity;
    for (let i = split; i <= endIndex; i += 1) {
        const bar = bars[i];
        if (!bar) continue;
        if (bar.high > recentHigh) recentHigh = bar.high;
        if (bar.low < recentLow) recentLow = bar.low;
    }
    for (let i = priorStart; i < split; i += 1) {
        const bar = bars[i];
        if (!bar) continue;
        if (bar.high > priorHigh) priorHigh = bar.high;
        if (bar.low < priorLow) priorLow = bar.low;
    }
    return recentHigh > priorHigh && recentLow > priorLow;
}

function strictExtraEfficiencyThresholdForSymbol(symbol: string, options: HybridVariantOptions = {}) {
    const bySymbol = options.strictExtraTrendMinEfficiencyRatioBySymbol;
    const symbolKey = String(symbol || "").toUpperCase();
    if (bySymbol && Object.prototype.hasOwnProperty.call(bySymbol, symbolKey)) {
        return bySymbol[symbolKey];
    }
    return options.trendMinEfficiencyRatio;
}

function activeTrendWindowOverrideForSymbol(symbol: string, ts: number | null | undefined, options: HybridVariantOptions = {}) {
    if (ts == null) return null;
    const bySymbol = options.trendWindowedOverridesBySymbol;
    const symbolKey = String(symbol || "").toUpperCase();
    const override = bySymbol?.[symbolKey];
    if (!override?.windows?.length) return null;
    return override.windows.some((window) => ts >= window.startTs && ts < window.endTs) ? override : null;
}

function trendBreakoutLookbackForSymbol(symbol: string, ts: number | null | undefined, options: HybridVariantOptions = {}) {
    if (options.trendDisableBreakoutSymbols?.map((item) => item.toUpperCase()).includes(symbol.toUpperCase())) return null;
    const activeOverride = activeTrendWindowOverrideForSymbol(symbol, ts, options);
    if (activeOverride?.breakoutLookbackBars != null) return activeOverride.breakoutLookbackBars;
    return symbolOverrideNumber(options.trendBreakoutLookbackBarsBySymbol, symbol, options.trendBreakoutLookbackBars);
}

function allowDowBreakoutProxyForSymbol(symbol: string, options: HybridVariantOptions = {}) {
    return options.trendAllowDowBreakoutProxySymbols?.map((item) => item.toUpperCase()).includes(symbol.toUpperCase()) ?? false;
}

function trendBreakoutMinPctForSymbol(symbol: string, ts: number | null | undefined, options: HybridVariantOptions = {}) {
    const activeOverride = activeTrendWindowOverrideForSymbol(symbol, ts, options);
    if (activeOverride?.breakoutMinPct != null) return activeOverride.breakoutMinPct;
    return symbolOverrideNumber(options.trendBreakoutMinPctBySymbol, symbol, options.trendBreakoutMinPct) ?? 0;
}

function trendMinVolumeRatioForSymbol(symbol: string, ts: number | null | undefined, options: HybridVariantOptions = {}) {
    const activeOverride = activeTrendWindowOverrideForSymbol(symbol, ts, options);
    if (activeOverride?.minVolumeRatio != null) return activeOverride.minVolumeRatio;
    return symbolOverrideNumber(options.trendMinVolumeRatioBySymbol, symbol, options.trendMinVolumeRatio);
}

function trendMinMomAccelForSymbol(symbol: string, ts: number | null | undefined, options: HybridVariantOptions = {}) {
    const activeOverride = activeTrendWindowOverrideForSymbol(symbol, ts, options);
    if (activeOverride?.minMomAccel != null) return activeOverride.minMomAccel;
    return symbolOverrideNumber(options.trendMinMomAccelBySymbol, symbol, options.trendMinMomAccel);
}

function trendMinEfficiencyRatioForSymbol(symbol: string, ts: number | null | undefined, options: HybridVariantOptions = {}) {
    const activeOverride = activeTrendWindowOverrideForSymbol(symbol, ts, options);
    if (activeOverride?.minEfficiencyRatio != null) return activeOverride.minEfficiencyRatio;
    return symbolOverrideNumber(options.trendMinEfficiencyRatioBySymbol, symbol, options.trendMinEfficiencyRatio);
}

function trendMinSmaDistancePctForSymbol(symbol: string, ts: number | null | undefined, options: HybridVariantOptions = {}) {
    const activeOverride = activeTrendWindowOverrideForSymbol(symbol, ts, options);
    if (activeOverride?.minSmaDistancePct != null) return activeOverride.minSmaDistancePct;
    return symbolOverrideNumber(options.trendMinSmaDistancePctBySymbol, symbol, options.trendMinSmaDistancePct) ?? 0;
}

function trendScoreAdjustmentForSymbol(symbol: string, ts: number | null | undefined, options: HybridVariantOptions = {}) {
    const activeOverride = activeTrendWindowOverrideForSymbol(symbol, ts, options);
    if (activeOverride?.scoreAdjustment != null) return activeOverride.scoreAdjustment;
    return symbolOverrideNumber(options.trendScoreAdjustmentBySymbol, symbol, 0) ?? 0;
}

function strictExtraRotationScoreGapForSymbol(symbol: string, options: HybridVariantOptions = {}) {
    return symbolOverrideNumber(options.strictExtraTrendRotationScoreGapBySymbol, symbol, options.strictExtraTrendRotationScoreGap) ?? 10;
}

function strictExtraRotationConsecutiveBarsForSymbol(symbol: string, options: HybridVariantOptions = {}) {
    return symbolOverrideNumber(
        options.strictExtraTrendRotationRequireConsecutiveBarsBySymbol,
        symbol,
        options.strictExtraTrendRotationRequireConsecutiveBars,
    ) ?? 1;
}

function buildTrendEvaluations(
    snapshot: RegimeSnapshot,
    indicators: Record<TradeSymbol, IndicatorBar[]>,
    options: HybridVariantOptions = {},
) {
    const symbols = (options.expandedTrendSymbols?.length
        ? options.expandedTrendSymbols
        : TRADE_SYMBOLS) as readonly string[];
    const weakGateOk = snapshot.regimeLabel !== "trend_weak" || (
        snapshot.core2_45 === 2 &&
        snapshot.avgMom20EthSol >= 0.08 &&
        snapshot.bestMomAccel >= -0.02
    );

    const evaluations: HybridTrendSymbolDecision[] = [];

    for (const symbol of symbols) {
        const series = indicators[symbol as TradeSymbol];
        const idx = latestIndicatorIndexAtOrBefore(series, snapshot.ts);
        const bar = idx >= 0 ? series[idx] : null;
        if (!bar || !bar.ready) continue;

        const baseSma = bar.sma40;
        const idleCashContext = options.idleCashTrendContext === true;
        const distanceFromSmaPct = baseSma > 0 ? ((bar.close / baseSma) - 1) * 100 : 0;
        const minSmaDistancePct = trendMinSmaDistancePctForSymbol(symbol, snapshot.ts, options);
        const smaDistanceOk = distanceFromSmaPct >= minSmaDistancePct * 100;
        const mom20Threshold = idleCashContext && options.idleCashTrendMinMom20 != null
            ? options.idleCashTrendMinMom20
            : 0;
        const baseEligible = smaDistanceOk && bar.mom20 > mom20Threshold;
        const solOk = symbol !== "SOL" || bar.overheatPct <= 0.35;
        const avaxOk = symbol !== "AVAX" || (bar.mom20 > 0.25 && bar.volume > bar.volAvg20);
        const breakoutLookback = trendBreakoutLookbackForSymbol(symbol, snapshot.ts, options);
        const breakoutMinPct = trendBreakoutMinPctForSymbol(symbol, snapshot.ts, options) ?? 0;
        const dowHigherHighLow = calcDowHigherHighLow(series, idx, 12);
        let breakoutOk = breakoutLookback == null || idx - breakoutLookback < 0
            ? true
            : bar.close > maxCloseInRange(series, idx - breakoutLookback, idx) * (1 + breakoutMinPct);
        if (!breakoutOk && allowDowBreakoutProxyForSymbol(symbol, options) && dowHigherHighLow) {
            breakoutOk = true;
        }
        const structureBreak = breakoutLookback != null && idx - breakoutLookback >= 0 && breakoutOk;
        const mom80 = calcMomentum(series, idx, 80);
        const recentHighDrawdownPct = calcRecentHighDrawdownPct(series, idx, 96);
        const longHighDrawdownPct = calcRecentHighDrawdownPct(series, idx, 960);
        const volumeRatio = bar.volAvg20 > 0 ? bar.volume / bar.volAvg20 : 0;
        const minVolumeRatio = trendMinVolumeRatioForSymbol(symbol, snapshot.ts, options);
        const volumeOk = minVolumeRatio == null || volumeRatio >= minVolumeRatio;
        const minMomAccel = trendMinMomAccelForSymbol(symbol, snapshot.ts, options);
        const accelOk = minMomAccel == null || bar.momAccel >= minMomAccel;
        const efficiencyThreshold = idleCashContext && options.idleCashTrendMinEfficiencyRatio != null
            ? options.idleCashTrendMinEfficiencyRatio
            : trendMinEfficiencyRatioForSymbol(symbol, snapshot.ts, options);
        const efficiencyRatio = efficiencyThreshold == null ? 0 : calcEfficiencyRatio(series, idx, 6);
        const efficiencyOk = efficiencyThreshold == null || efficiencyRatio >= efficiencyThreshold;
        const trendGateSatisfied = snapshot.trendAllowed || (idleCashContext && options.idleCashTrendAllowTrendGateOff === true);
        const weakMarketSymbolBlocked = isTrendSymbolBlocked(symbol, snapshot.ts, options, snapshot);
        const qualitySymbolBlocked = isTrendSymbolQualityBlocked(symbol, {
            mom20: bar.mom20,
            momAccel: bar.momAccel,
            volumeRatio,
            adx14: bar.adx14,
            overheatPct: bar.overheatPct,
            smaDistancePct: distanceFromSmaPct / 100,
        }, options);
        const preWeakEligible = trendGateSatisfied && baseEligible && solOk && avaxOk && breakoutOk && volumeOk && accelOk && efficiencyOk;
        const eligible = preWeakEligible && weakGateOk && !weakMarketSymbolBlocked && !qualitySymbolBlocked;
        const efficiencyBonusWeight = options.trendScoreEfficiencyBonusWeight ?? 0;
        const overheatPenaltyWeight = options.trendScoreOverheatPenaltyWeight ?? 0;
        const score =
            (bar.mom20 * 100) +
            distanceFromSmaPct +
            (bar.adx14 / 5) +
            (efficiencyRatio * efficiencyBonusWeight) -
            (Math.max(0, bar.overheatPct) * overheatPenaltyWeight * 100) +
            trendScoreAdjustmentForSymbol(symbol, snapshot.ts, options);

        const reasons = [
            baseEligible ? (minSmaDistancePct < 0 ? "close>=sma40-tolerance" : "close>sma40") : "close<=sma40",
            bar.mom20 > 0 ? "mom20-ok" : "mom20-low",
        ];

        if (!snapshot.trendAllowed) reasons.push(trendGateSatisfied ? "trend-gate-override" : "trend-gate-off");
        if (symbol === "SOL") reasons.push(solOk ? "sol-ok" : "sol-overheat");
        if (symbol === "AVAX") {
            reasons.push(bar.mom20 > 0.25 ? "avax-mom-ok" : "avax-mom-low");
            reasons.push(bar.volume > bar.volAvg20 ? "avax-vol-ok" : "avax-vol-low");
        }
        if (breakoutLookback != null) reasons.push(breakoutOk ? "structure-break" : "structure-flat");
        if (minVolumeRatio != null) reasons.push(volumeOk ? "volume-ok" : "volume-low");
        if (minMomAccel != null) reasons.push(accelOk ? "accel-ok" : "accel-low");
        if (efficiencyThreshold != null) reasons.push(efficiencyOk ? "eff-ok" : "eff-low");
        if (idleCashContext && options.idleCashTrendMinMom20 != null) reasons.push("idle-mom20-relaxed");
        if (idleCashContext && options.idleCashTrendMinEfficiencyRatio != null) reasons.push("idle-eff-relaxed");
        if (weakMarketSymbolBlocked) reasons.push("weak-market-symbol-block");
        if (qualitySymbolBlocked) reasons.push("symbol-quality-block");
        reasons.push(snapshot.weak2022Regime ? (weakGateOk ? "retq22-pass" : "retq22-block") : "retq22-off");

        evaluations.push({
            symbol,
            eligible,
            score,
            reasons,
            close: bar.close,
            sma40: baseSma,
            mom20: bar.mom20,
            mom80,
            momAccel: bar.momAccel,
            adx14: bar.adx14,
            overheatPct: bar.overheatPct,
            volumeRatio,
            efficiencyRatio,
            recentHighDrawdownPct,
            longHighDrawdownPct,
            structureBreak,
            dowHigherHighLow,
        });
    }

    return evaluations.sort((left, right) => right.score - left.score || right.mom20 - left.mom20 || left.symbol.localeCompare(right.symbol));
}

function buildTrendEvaluationsForSymbols(
    snapshot: RegimeSnapshot,
    indicators: Record<string, IndicatorBar[]>,
    symbols: readonly string[],
    options: HybridVariantOptions = {},
) {
    const weakGateOk = snapshot.regimeLabel !== "trend_weak" || (
        snapshot.core2_45 === 2 &&
        snapshot.avgMom20EthSol >= 0.08 &&
        snapshot.bestMomAccel >= -0.02
    );

    const evaluations: HybridTrendSymbolDecision[] = [];

    for (const symbol of symbols) {
        const series = indicators[symbol];
        if (!series?.length) continue;
        const idx = latestIndicatorIndexAtOrBefore(series, snapshot.ts);
        const bar = idx >= 0 ? series[idx] : null;
        if (!bar || !bar.ready) continue;

        const baseSma = bar.sma40;
        const idleCashContext = options.idleCashTrendContext === true;
        const distanceFromSmaPct = baseSma > 0 ? ((bar.close / baseSma) - 1) * 100 : 0;
        const minSmaDistancePct = trendMinSmaDistancePctForSymbol(symbol, snapshot.ts, options);
        const smaDistanceOk = distanceFromSmaPct >= minSmaDistancePct * 100;
        const mom20Threshold = idleCashContext && options.idleCashTrendMinMom20 != null
            ? options.idleCashTrendMinMom20
            : 0;
        const baseEligible = smaDistanceOk && bar.mom20 > mom20Threshold;
        const solOk = symbol !== "SOL" || bar.overheatPct <= 0.35;
        const avaxOk = symbol !== "AVAX" || (bar.mom20 > 0.25 && bar.volume > bar.volAvg20);
        const breakoutLookback = trendBreakoutLookbackForSymbol(symbol, snapshot.ts, options);
        const breakoutMinPct = trendBreakoutMinPctForSymbol(symbol, snapshot.ts, options) ?? 0;
        const dowHigherHighLow = calcDowHigherHighLow(series, idx, 12);
        let breakoutOk = breakoutLookback == null || idx - breakoutLookback < 0
            ? true
            : bar.close > maxCloseInRange(series, idx - breakoutLookback, idx) * (1 + breakoutMinPct);
        if (!breakoutOk && allowDowBreakoutProxyForSymbol(symbol, options) && dowHigherHighLow) {
            breakoutOk = true;
        }
        const structureBreak = breakoutLookback != null && idx - breakoutLookback >= 0 && breakoutOk;
        const mom80 = calcMomentum(series, idx, 80);
        const recentHighDrawdownPct = calcRecentHighDrawdownPct(series, idx, 96);
        const longHighDrawdownPct = calcRecentHighDrawdownPct(series, idx, 960);
        const volumeRatio = bar.volAvg20 > 0 ? bar.volume / bar.volAvg20 : 0;
        const minVolumeRatio = trendMinVolumeRatioForSymbol(symbol, snapshot.ts, options);
        const volumeOk = minVolumeRatio == null || volumeRatio >= minVolumeRatio;
        const minMomAccel = trendMinMomAccelForSymbol(symbol, snapshot.ts, options);
        const accelOk = minMomAccel == null || bar.momAccel >= minMomAccel;
        const efficiencyThreshold = idleCashContext && options.idleCashTrendMinEfficiencyRatio != null
            ? options.idleCashTrendMinEfficiencyRatio
            : trendMinEfficiencyRatioForSymbol(symbol, snapshot.ts, options);
        const efficiencyRatio = efficiencyThreshold == null ? 0 : calcEfficiencyRatio(series, idx, 6);
        const efficiencyOk = efficiencyThreshold == null || efficiencyRatio >= efficiencyThreshold;
        const trendGateSatisfied = snapshot.trendAllowed || (idleCashContext && options.idleCashTrendAllowTrendGateOff === true);
        const weakMarketSymbolBlocked = isTrendSymbolBlocked(symbol, snapshot.ts, options, snapshot);
        const qualitySymbolBlocked = isTrendSymbolQualityBlocked(symbol, {
            mom20: bar.mom20,
            momAccel: bar.momAccel,
            volumeRatio,
            adx14: bar.adx14,
            overheatPct: bar.overheatPct,
            smaDistancePct: distanceFromSmaPct / 100,
        }, options);
        const preWeakEligible = trendGateSatisfied && baseEligible && solOk && avaxOk && breakoutOk && volumeOk && accelOk && efficiencyOk;
        const eligible = preWeakEligible && weakGateOk && !weakMarketSymbolBlocked && !qualitySymbolBlocked;
        const efficiencyBonusWeight = options.trendScoreEfficiencyBonusWeight ?? 0;
        const overheatPenaltyWeight = options.trendScoreOverheatPenaltyWeight ?? 0;
        const score =
            (bar.mom20 * 100) +
            distanceFromSmaPct +
            (bar.adx14 / 5) +
            (efficiencyRatio * efficiencyBonusWeight) -
            (Math.max(0, bar.overheatPct) * overheatPenaltyWeight * 100) +
            trendScoreAdjustmentForSymbol(symbol, snapshot.ts, options);

        const reasons = [
            baseEligible ? (minSmaDistancePct < 0 ? "close>=sma40-tolerance" : "close>sma40") : "close<=sma40",
            bar.mom20 > 0 ? "mom20-ok" : "mom20-low",
        ];

        if (!snapshot.trendAllowed) reasons.push(trendGateSatisfied ? "trend-gate-override" : "trend-gate-off");
        if (symbol === "SOL") reasons.push(solOk ? "sol-ok" : "sol-overheat");
        if (symbol === "AVAX") {
            reasons.push(bar.mom20 > 0.25 ? "avax-mom-ok" : "avax-mom-low");
            reasons.push(bar.volume > bar.volAvg20 ? "avax-vol-ok" : "avax-vol-low");
        }
        if (breakoutLookback != null) reasons.push(breakoutOk ? "structure-break" : "structure-flat");
        if (minVolumeRatio != null) reasons.push(volumeOk ? "volume-ok" : "volume-low");
        if (minMomAccel != null) reasons.push(accelOk ? "accel-ok" : "accel-low");
        if (efficiencyThreshold != null) reasons.push(efficiencyOk ? "eff-ok" : "eff-low");
        if (minSmaDistancePct !== 0) reasons.push(`sma-tolerance-${(minSmaDistancePct * 100).toFixed(2)}%`);
        if (idleCashContext && options.idleCashTrendMinMom20 != null) reasons.push("idle-mom20-relaxed");
        if (idleCashContext && options.idleCashTrendMinEfficiencyRatio != null) reasons.push("idle-eff-relaxed");
        if (weakMarketSymbolBlocked) reasons.push("weak-market-symbol-block");
        if (qualitySymbolBlocked) reasons.push("symbol-quality-block");
        reasons.push(snapshot.weak2022Regime ? (weakGateOk ? "retq22-pass" : "retq22-block") : "retq22-off");

        evaluations.push({
            symbol,
            eligible,
            score,
            reasons,
            close: bar.close,
            sma40: baseSma,
            mom20: bar.mom20,
            mom80,
            momAccel: bar.momAccel,
            adx14: bar.adx14,
            overheatPct: bar.overheatPct,
            volumeRatio,
            efficiencyRatio,
            recentHighDrawdownPct,
            longHighDrawdownPct,
            structureBreak,
            dowHigherHighLow,
        });
    }

    return evaluations.sort((left, right) => right.score - left.score || right.mom20 - left.mom20 || left.symbol.localeCompare(right.symbol));
}

function isWeakMarketTrendBlockActive(snapshot: RegimeSnapshot | null | undefined, options: HybridVariantOptions = {}) {
    if (!snapshot) return false;
    const override = (snapshot as RegimeSnapshot & { weakMarketTrendBlockActive?: boolean }).weakMarketTrendBlockActive;
    if (override != null) return override;
    if (options.trendWeakMarketBlockWhenBtcBelowSma90 === true) {
        const distance = snapshot.btc.sma90 > 0 ? snapshot.btc.close / snapshot.btc.sma90 - 1 : 0;
        const threshold = options.trendWeakMarketBlockBtcSma90DistanceBelow ?? 0;
        const sma85Distance = snapshot.btc.sma85 > 0 ? snapshot.btc.close / snapshot.btc.sma85 - 1 : 0;
        const longMomentumOk = options.trendWeakMarketBlockBtcSma85DistanceBelow == null
            || sma85Distance < options.trendWeakMarketBlockBtcSma85DistanceBelow;
        const breadthOk = options.trendWeakMarketBlockBreadth40Below == null
            || snapshot.breadth40 <= options.trendWeakMarketBlockBreadth40Below;
        const btcMom20Ok = options.trendWeakMarketBlockBtcMom20Below == null
            || snapshot.btc.mom20 < options.trendWeakMarketBlockBtcMom20Below;
        if (distance < threshold && longMomentumOk && breadthOk && btcMom20Ok) return true;
    }
    const requireWeak2022 = options.trendWeakMarketBlockRequireWeak2022 ?? false;
    if (requireWeak2022 && !snapshot.weak2022Regime) return false;
    if (
        options.trendWeakMarketBlockBestMom20Below != null &&
        snapshot.bestMom20 >= options.trendWeakMarketBlockBestMom20Below
    ) {
        return false;
    }
    if (
        options.trendWeakMarketBlockBtcAdxBelow != null &&
        snapshot.btc.adx14 >= options.trendWeakMarketBlockBtcAdxBelow
    ) {
        return false;
    }
    return true;
}

function withWeakMarketTrendBlockCooldown(
    snapshot: RegimeSnapshot,
    priorWeakMarketTrendBlockActive: boolean,
    options: HybridVariantOptions = {},
) {
    const currentActive = isWeakMarketTrendBlockActive(snapshot, options);
    const sticky = options.trendWeakMarketBlockSticky ?? true;
    return {
        ...snapshot,
        weakMarketTrendBlockActive: currentActive || (sticky && priorWeakMarketTrendBlockActive),
    } as RegimeSnapshot & { weakMarketTrendBlockActive: boolean };
}

function isTrendSymbolBlocked(symbol: string | null, ts: number, options: HybridVariantOptions = {}, snapshot?: RegimeSnapshot | null) {
    if (!symbol) return false;
    const weakBlockSymbols = options.trendWeakMarketBlockSymbols?.map((item) => item.toUpperCase());
    if (
        weakBlockSymbols?.includes(symbol.toUpperCase()) &&
        isWeakMarketTrendBlockActive(snapshot, options)
    ) {
        return true;
    }

    const windows = options.trendSymbolBlockWindows?.[symbol.toUpperCase()];
    if (!windows?.length) return false;
    return windows.some((window) => ts >= window.startTs && ts <= window.endTs);
}

function isTrendSymbolQualityBlocked(
    symbol: string,
    metrics: {
        mom20: number;
        momAccel: number;
        volumeRatio: number;
        adx14: number;
        overheatPct: number;
        smaDistancePct: number;
    },
    options: HybridVariantOptions = {},
) {
    const rule = options.trendSymbolQualityBlockBySymbol?.[symbol.toUpperCase()];
    if (!rule) return false;
    const checks = [
        rule.minMom20 != null ? metrics.mom20 >= rule.minMom20 : null,
        rule.maxMom20 != null ? metrics.mom20 <= rule.maxMom20 : null,
        rule.minMomAccel != null ? metrics.momAccel >= rule.minMomAccel : null,
        rule.maxMomAccel != null ? metrics.momAccel <= rule.maxMomAccel : null,
        rule.minVolumeRatio != null ? metrics.volumeRatio >= rule.minVolumeRatio : null,
        rule.maxVolumeRatio != null ? metrics.volumeRatio <= rule.maxVolumeRatio : null,
        rule.minAdx14 != null ? metrics.adx14 >= rule.minAdx14 : null,
        rule.maxAdx14 != null ? metrics.adx14 <= rule.maxAdx14 : null,
        rule.minOverheatPct != null ? metrics.overheatPct >= rule.minOverheatPct : null,
        rule.maxOverheatPct != null ? metrics.overheatPct <= rule.maxOverheatPct : null,
        rule.minSmaDistancePct != null ? metrics.smaDistancePct >= rule.minSmaDistancePct : null,
        rule.maxSmaDistancePct != null ? metrics.smaDistancePct <= rule.maxSmaDistancePct : null,
    ].filter((value): value is boolean => value != null);
    if (!checks.length) return false;
    return (rule.mode ?? "all") === "any" ? checks.some(Boolean) : checks.every(Boolean);
}

function isInAllowedWindow(ts: number, windows?: readonly { startTs: number; endTs: number }[]) {
    if (!windows?.length) return true;
    return windows.some((window) => ts >= window.startTs && ts < window.endTs);
}

function isStrictExtraTrendSymbol(symbol: string | null, options: HybridVariantOptions = {}) {
    if (!symbol || !options.strictExtraTrendSymbols?.length) return false;
    return options.strictExtraTrendSymbols.map((item) => item.toUpperCase()).includes(symbol.toUpperCase());
}

function strictExtraDecisionOptions(options: HybridVariantOptions = {}) {
    if (
        options.strictExtraTrendMinEfficiencyRatio == null
        && options.strictExtraTrendMinVolumeRatio == null
        && !options.strictExtraTrendMinEfficiencyRatioBySymbol
    ) return options;
    return {
        ...options,
        trendMinEfficiencyRatio: options.strictExtraTrendMinEfficiencyRatio ?? options.trendMinEfficiencyRatio,
        trendMinEfficiencyRatioBySymbol: options.strictExtraTrendMinEfficiencyRatioBySymbol ?? options.trendMinEfficiencyRatioBySymbol,
        trendMinVolumeRatio: options.strictExtraTrendMinVolumeRatio ?? options.trendMinVolumeRatio,
    } satisfies HybridVariantOptions;
}

function withIdleCashTrendOverrides(options: HybridVariantOptions = {}) {
    if (
        !options.idleCashTrendAllowTrendGateOff &&
        options.idleCashTrendMinMom20 == null &&
        options.idleCashTrendMinEfficiencyRatio == null
    ) {
        return options;
    }

    return {
        ...options,
        idleCashTrendContext: true,
    } satisfies HybridVariantOptions;
}

function isSymbolSpecificWeakExitTarget(symbol: string | null, options: HybridVariantOptions = {}) {
    if (!symbol || !options.symbolSpecificTrendWeakExitSymbols?.length) return false;
    return options.symbolSpecificTrendWeakExitSymbols.map((item) => item.toUpperCase()).includes(symbol.toUpperCase());
}

function isIdleBreakoutEntry(position: PositionState) {
    return position.entryStrategy === "idle-breakout" || position.entryStrategy === "idle-breakout-night";
}

function isJstHourWindow(ts: number, startHour = 22, endHour = 2) {
    const hour = new Date(ts + 9 * HOUR_MS).getUTCHours();
    if (startHour === endHour) return true;
    if (startHour < endHour) return hour >= startHour && hour < endHour;
    return hour >= startHour || hour < endHour;
}

function isJstFriday(ts: number) {
    return new Date(ts + 9 * HOUR_MS).getUTCDay() === 5;
}

type InjSpringIndicatorBar = Candle1h & {
    sma20: number;
    sma40: number;
    sma80: number;
    volAvg20: number;
    mom20: number;
    mom72: number;
    mom120: number;
    priorHigh12: number;
    priorHigh24: number;
    priorHigh72: number;
    priorLow120: number;
};

type InjSpringCandidate = {
    symbol: "INJ";
    score: number;
    reasons: string[];
};

function isInjSpringCashEntry(position: PositionState) {
    return position.entryStrategy === "inj-spring-cash";
}

function normalizeTo1hBars(rawBars: Candle1h[]) {
    if (rawBars.length > 1 && rawBars[1].ts - rawBars[0].ts < HOUR_MS) {
        return resampleToHours(rawBars, 1, 0);
    }
    return rawBars;
}

function buildInjSpringIndicators(candles: Candle1h[]): InjSpringIndicatorBar[] {
    const closes = candles.map((bar) => bar.close);
    const highs = candles.map((bar) => bar.high);
    const lows = candles.map((bar) => bar.low);
    const volumes = candles.map((bar) => bar.volume);
    return candles.map((bar, index) => {
        const sma20 = index >= 19 ? average(closes.slice(index - 19, index + 1)) : 0;
        const sma40 = index >= 39 ? average(closes.slice(index - 39, index + 1)) : 0;
        const sma80 = index >= 79 ? average(closes.slice(index - 79, index + 1)) : 0;
        const volAvg20 = index >= 19 ? average(volumes.slice(index - 19, index + 1)) : 0;
        const mom20 = index >= 20 ? bar.close / candles[index - 20].close - 1 : 0;
        const mom72 = index >= 72 ? bar.close / candles[index - 72].close - 1 : 0;
        const mom120 = index >= 120 ? bar.close / candles[index - 120].close - 1 : 0;
        const priorHigh12 = index >= 12 ? Math.max(...highs.slice(index - 12, index)) : 0;
        const priorHigh24 = index >= 24 ? Math.max(...highs.slice(index - 24, index)) : 0;
        const priorHigh72 = index >= 72 ? Math.max(...highs.slice(index - 72, index)) : 0;
        const priorLow120 = index >= 120 ? Math.min(...lows.slice(index - 120, index)) : 0;
        return { ...bar, sma20, sma40, sma80, volAvg20, mom20, mom72, mom120, priorHigh12, priorHigh24, priorHigh72, priorLow120 };
    });
}

function isSpringPivotHigh(candles: Candle1h[], index: number, width: number) {
    const high = candles[index]?.high;
    if (high == null) return false;
    for (let i = index - width; i <= index + width; i += 1) {
        if (i === index || i < 0 || i >= candles.length) continue;
        if (candles[i].high >= high) return false;
    }
    return true;
}

function isSpringPivotLow(candles: Candle1h[], index: number, width: number) {
    const low = candles[index]?.low;
    if (low == null) return false;
    for (let i = index - width; i <= index + width; i += 1) {
        if (i === index || i < 0 || i >= candles.length) continue;
        if (candles[i].low <= low) return false;
    }
    return true;
}

function injSpringPassesCommon(bar: InjSpringIndicatorBar) {
    const volumeRatio = bar.volAvg20 > 0 ? bar.volume / bar.volAvg20 : 0;
    if (volumeRatio < 1.4) return false;
    if (bar.mom20 < 0.02) return false;
    if (bar.sma40 <= 0 || bar.sma20 <= bar.sma40 || bar.close <= bar.sma40) return false;
    if (bar.sma20 > 0 && bar.close / bar.sma20 - 1 > 0.18) return false;
    if (bar.priorHigh72 <= 0 || bar.close / bar.priorHigh72 - 1 < 0.006) return false;
    if (bar.mom72 < 0.06) return false;
    if (bar.mom120 < 0.1 || bar.mom120 > 1.2) return false;
    if (bar.sma80 <= 0 || bar.close / bar.sma80 - 1 < 0.05) return false;
    if (bar.sma80 <= 0 || bar.close / bar.sma80 - 1 > 0.8) return false;
    if (bar.priorLow120 <= 0 || bar.close / bar.priorLow120 - 1 > 2.0) return false;
    return true;
}

function injSpringAltRegimeOk(indicatorMap: Record<string, InjSpringIndicatorBar[]>, ts: number) {
    const symbols = ["SOL", "AVAX", "INJ", "DOGE", "UNI", "TWT", "ETH"];
    let stackCount = 0;
    let momentumCount = 0;
    let highBreakCount = 0;
    const moms: number[] = [];
    for (const symbol of symbols) {
        const series = indicatorMap[symbol] ?? [];
        const idx = latestSpringIndexAtOrBefore(series, ts);
        const bar = idx >= 0 ? series[idx] : null;
        if (!bar || bar.sma40 <= 0 || bar.sma80 <= 0) continue;
        if (bar.close > bar.sma40 && bar.sma20 > bar.sma40) stackCount += 1;
        if (bar.mom20 >= 0.06) momentumCount += 1;
        if (bar.priorHigh72 > 0 && bar.close / bar.priorHigh72 - 1 >= 0.006) highBreakCount += 1;
        moms.push(bar.mom20);
    }
    return stackCount >= 4 && momentumCount >= 3 && highBreakCount >= 2 && average(moms) >= 0.05;
}

function latestSpringIndexAtOrBefore(series: InjSpringIndicatorBar[], ts: number) {
    let lo = 0;
    let hi = series.length - 1;
    let best = -1;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (series[mid].ts <= ts) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return best;
}

function pickInjSpringCashCandidate(
    ts: number,
    candles: Candle1h[],
    indicators: InjSpringIndicatorBar[],
    indicatorMap: Record<string, InjSpringIndicatorBar[]>,
) {
    const index = latestSpringIndexAtOrBefore(indicators, ts);
    if (index < 180) return null;
    const bar = indicators[index];
    const month = new Date(bar.ts).getUTCMonth();
    if (month < 1 || month > 4) return null;
    const btcSeries = indicatorMap.BTC ?? [];
    const btcIndex = latestSpringIndexAtOrBefore(btcSeries, ts);
    const btc = btcIndex >= 0 ? btcSeries[btcIndex] : null;
    if (!btc || btc.mom20 < 0) return null;
    if (!injSpringAltRegimeOk(indicatorMap, ts)) return null;
    if (bar.close <= bar.sma20 || bar.sma20 <= bar.sma40) return null;
    if (bar.close <= Math.max(bar.priorHigh12, bar.priorHigh24 * 0.995)) return null;
    if (!injSpringPassesCommon(bar)) return null;

    const start = index - 180;
    const lows = candles.slice(start, index + 1).map((_, offset) => start + offset)
        .filter((i) => i >= 6 && i < index - 6 && isSpringPivotLow(candles, i, 6));
    const highs = candles.slice(start, index + 1).map((_, offset) => start + offset)
        .filter((i) => i >= 6 && i < index - 6 && isSpringPivotHigh(candles, i, 6));

    let best: { impulsePct: number; retrace: number; breakoutPct: number } | null = null;
    for (const lowIndex of lows.slice(-8)) {
        for (const highIndex of highs.filter((candidate) => candidate > lowIndex + 8 && candidate < index - 6).slice(-6)) {
            const impulseLow = candles[lowIndex].low;
            const impulseHigh = candles[highIndex].high;
            const impulsePct = impulseHigh / impulseLow - 1;
            if (impulsePct < 0.09) continue;
            const pullbackLow = Math.min(...candles.slice(highIndex + 1, index + 1).map((item) => item.low));
            const retrace = (impulseHigh - pullbackLow) / Math.max(0.0000001, impulseHigh - impulseLow);
            if (retrace < 0.3 || retrace > 0.65) continue;
            const breakoutPct = bar.close / impulseHigh - 1;
            if (breakoutPct < -0.02) continue;
            if (!best || impulsePct + Math.max(0, breakoutPct) > best.impulsePct + Math.max(0, best.breakoutPct)) {
                best = { impulsePct, retrace, breakoutPct };
            }
        }
    }
    if (!best) return null;
    const volumeRatio = bar.volAvg20 > 0 ? bar.volume / bar.volAvg20 : 0;
    const score = best.impulsePct * 90 + (1 - Math.abs(best.retrace - 0.5)) * 25 + Math.max(0, best.breakoutPct) * 200 + volumeRatio * 4 + bar.mom20 * 100;
    if (score < 30) return null;
    return {
        symbol: "INJ",
        score,
        reasons: [
            "inj-spring-cash",
            `halfback impulse ${(best.impulsePct * 100).toFixed(1)}%`,
            `retrace ${(best.retrace * 100).toFixed(1)}%`,
            `quote ${(1).toFixed(1)}%`,
        ],
    } satisfies InjSpringCandidate;
}

function shouldAllowIdleNightBreakoutCandidate(
    candidate: ReturnType<typeof pickTrendCandidate> | null,
    indicators: Record<string, IndicatorBar[]>,
    ts: number,
    options: HybridVariantOptions,
) {
    if (!candidate?.eligible) return false;
    const series = indicators[candidate.symbol] ?? [];
    const idx = latestIndicatorIndexAtOrBefore(series, ts);
    if (idx <= 0) return false;
    const current = series[idx];
    const previous = series[idx - 1];
    const lookback = options.idleNightBreakoutBreakoutLookbackBars ?? 8;
    const prior = series.slice(Math.max(0, idx - lookback), idx);
    if (!prior.length) return false;

    if (options.idleNightBreakoutMaxOneBarMovePct != null && previous.close > 0) {
        const oneBarMovePct = (current.close / previous.close) - 1;
        if (oneBarMovePct > options.idleNightBreakoutMaxOneBarMovePct) return false;
    }

    const high = Math.max(...prior.map((bar) => bar.high || bar.close || 0));
    const low = Math.min(...prior.map((bar) => bar.low || bar.close || Infinity));
    const recentRangePct = low > 0 ? (high / low) - 1 : 0;
    if (options.idleNightBreakoutMinRecentRangePct != null && recentRangePct < options.idleNightBreakoutMinRecentRangePct) return false;
    if (options.idleNightBreakoutMaxRecentRangePct != null && recentRangePct > options.idleNightBreakoutMaxRecentRangePct) return false;

    if (options.idleNightBreakoutMinRecentPathPct != null) {
        let pathPct = 0;
        for (let index = 1; index < prior.length; index += 1) {
            const prev = prior[index - 1];
            const next = prior[index];
            if (prev.close > 0) pathPct += Math.abs((next.close / prev.close) - 1);
        }
        if (pathPct < options.idleNightBreakoutMinRecentPathPct) return false;
    }

    return true;
}

function shouldGuardIdleBreakoutSmaBreak(
    current: IndicatorBar,
    position: PositionState,
    trendExitSma: 40 | 45,
    entryTs: number,
    currentTs: number,
    entryBarMs: number,
    options: HybridVariantOptions,
) {
    if (!isIdleBreakoutEntry(position)) return false;
    const guardSymbols = options.idleBreakoutSmaBreakGuardSymbols?.map((symbol) => symbol.toUpperCase());
    if (guardSymbols?.length && (!position.symbol || !guardSymbols.includes(position.symbol.toUpperCase()))) {
        return false;
    }

    const minHoldBars = options.idleBreakoutSmaBreakGuardMinHoldBars ?? null;
    if (minHoldBars != null && elapsedBars(entryTs, currentTs, entryBarMs) < minHoldBars) return false;

    const sma = trendExitSma === 40 ? current.sma40 : current.sma45;
    if (sma <= 0 || current.close > sma) return false;

    if (options.idleBreakoutSmaBreakGuardMaxCloseBelowSmaPct != null) {
        const closeBelowSmaPct = (sma - current.close) / sma;
        if (closeBelowSmaPct > options.idleBreakoutSmaBreakGuardMaxCloseBelowSmaPct) return false;
    }
    if (
        options.idleBreakoutSmaBreakGuardMinMom20 != null &&
        current.mom20 < options.idleBreakoutSmaBreakGuardMinMom20
    ) {
        return false;
    }
    if (
        options.idleBreakoutSmaBreakGuardMinMomAccel != null &&
        current.momAccel < options.idleBreakoutSmaBreakGuardMinMomAccel
    ) {
        return false;
    }

    return (
        options.idleBreakoutSmaBreakGuardMaxCloseBelowSmaPct != null ||
        options.idleBreakoutSmaBreakGuardMinMom20 != null ||
        options.idleBreakoutSmaBreakGuardMinMomAccel != null
    );
}

function shouldGuardIdleBreakoutRiskOff(
    current: IndicatorBar,
    position: PositionState,
    options: HybridVariantOptions,
) {
    if (!isIdleBreakoutEntry(position)) return false;
    const guardSymbols = options.idleBreakoutRiskOffGuardSymbols?.map((symbol) => symbol.toUpperCase());
    if (guardSymbols?.length && (!position.symbol || !guardSymbols.includes(position.symbol.toUpperCase()))) {
        return false;
    }

    const sma = current.sma40 > 0 ? current.sma40 : current.sma45;
    if (sma <= 0) return false;

    if (options.idleBreakoutRiskOffGuardMaxCloseBelowSmaPct != null) {
        const closeBelowSmaPct = (sma - current.close) / sma;
        if (closeBelowSmaPct > options.idleBreakoutRiskOffGuardMaxCloseBelowSmaPct) return false;
    } else if (current.close <= sma) {
        return false;
    }
    if (
        options.idleBreakoutRiskOffGuardMinMom20 != null &&
        current.mom20 < options.idleBreakoutRiskOffGuardMinMom20
    ) {
        return false;
    }
    if (
        options.idleBreakoutRiskOffGuardMinMomAccel != null &&
        current.momAccel < options.idleBreakoutRiskOffGuardMinMomAccel
    ) {
        return false;
    }

    return (
        options.idleBreakoutRiskOffGuardMaxCloseBelowSmaPct != null ||
        options.idleBreakoutRiskOffGuardMinMom20 != null ||
        options.idleBreakoutRiskOffGuardMinMomAccel != null
    );
}

function resolveIdleBreakoutTrail(
    symbol: string,
    entryPrice: number,
    peakPrice: number,
    options: HybridVariantOptions,
    current?: IndicatorBar | null,
    entryTs?: number | null,
    entryBarMs?: number | null,
    peakTs?: number | null,
    entryStrategy?: string | null,
    marketContext?: {
        mom80: number;
        recentHighDrawdownPct: number;
        longHighDrawdownPct: number;
    } | null,
    entryMarketContext?: {
        mom20: number | null;
        mom80: number | null;
        momAccel: number | null;
        volumeRatio: number | null;
        efficiencyRatio: number | null;
        recentHighDrawdownPct: number | null;
        longHighDrawdownPct: number | null;
    } | null,
) {
    let activationPct = options.idleBreakoutProfitTrailActivationPct ?? null;
    let retracePct = options.idleBreakoutProfitTrailRetracePct ?? null;
    let conditionalEarly = false;
    const conditionalEarlyTrail = options.idleBreakoutConditionalEarlyTrailBySymbol?.[symbol.toUpperCase()];
    const tiers = options.idleBreakoutTieredTrailBySymbol?.[symbol.toUpperCase()];
    if (!tiers?.length || entryPrice <= 0 || peakPrice <= 0) {
        if (!conditionalEarlyTrail || !current || entryPrice <= 0 || peakPrice <= 0) {
            return { activationPct, retracePct, conditionalEarly };
        }
    }

    const peakProfitPct = (peakPrice / entryPrice) - 1;
    if (conditionalEarlyTrail && entryStrategy !== "idle-breakout-reentry" && current && peakProfitPct >= conditionalEarlyTrail.activationPct) {
        const volumeRatio = current.volAvg20 > 0 ? current.volume / current.volAvg20 : 0;
        const efficiencyRatio = Math.abs(current.mom20) > 0 ? Math.abs(current.close / current.open - 1) / Math.abs(current.mom20) : 0;
        const weakEnough =
            (conditionalEarlyTrail.maxPeakProfitPct == null || peakProfitPct <= conditionalEarlyTrail.maxPeakProfitPct) &&
            (conditionalEarlyTrail.entryMinMom20 == null || (entryMarketContext?.mom20 ?? -Infinity) >= conditionalEarlyTrail.entryMinMom20) &&
            (conditionalEarlyTrail.entryMaxMom20 == null || (entryMarketContext?.mom20 ?? Infinity) <= conditionalEarlyTrail.entryMaxMom20) &&
            (conditionalEarlyTrail.entryMinMom80 == null || (entryMarketContext?.mom80 ?? -Infinity) >= conditionalEarlyTrail.entryMinMom80) &&
            (conditionalEarlyTrail.entryMaxMom80 == null || (entryMarketContext?.mom80 ?? Infinity) <= conditionalEarlyTrail.entryMaxMom80) &&
            (conditionalEarlyTrail.entryMinMomAccel == null || (entryMarketContext?.momAccel ?? -Infinity) >= conditionalEarlyTrail.entryMinMomAccel) &&
            (conditionalEarlyTrail.entryMaxMomAccel == null || (entryMarketContext?.momAccel ?? Infinity) <= conditionalEarlyTrail.entryMaxMomAccel) &&
            (conditionalEarlyTrail.entryMinVolumeRatio == null || (entryMarketContext?.volumeRatio ?? -Infinity) >= conditionalEarlyTrail.entryMinVolumeRatio) &&
            (conditionalEarlyTrail.entryMaxVolumeRatio == null || (entryMarketContext?.volumeRatio ?? Infinity) <= conditionalEarlyTrail.entryMaxVolumeRatio) &&
            (conditionalEarlyTrail.entryMinEfficiencyRatio == null || (entryMarketContext?.efficiencyRatio ?? -Infinity) >= conditionalEarlyTrail.entryMinEfficiencyRatio) &&
            (conditionalEarlyTrail.entryMaxEfficiencyRatio == null || (entryMarketContext?.efficiencyRatio ?? Infinity) <= conditionalEarlyTrail.entryMaxEfficiencyRatio) &&
            (conditionalEarlyTrail.entryMinRecentHighDrawdownPct == null || (entryMarketContext?.recentHighDrawdownPct ?? 0) <= -Math.abs(conditionalEarlyTrail.entryMinRecentHighDrawdownPct)) &&
            (conditionalEarlyTrail.entryMinLongHighDrawdownPct == null || (entryMarketContext?.longHighDrawdownPct ?? 0) <= -Math.abs(conditionalEarlyTrail.entryMinLongHighDrawdownPct)) &&
            (conditionalEarlyTrail.maxMom20 == null || current.mom20 <= conditionalEarlyTrail.maxMom20) &&
            (conditionalEarlyTrail.maxMom80 == null || (marketContext?.mom80 ?? 0) <= conditionalEarlyTrail.maxMom80) &&
            (conditionalEarlyTrail.maxMomAccel == null || current.momAccel <= conditionalEarlyTrail.maxMomAccel) &&
            (conditionalEarlyTrail.maxVolumeRatio == null || volumeRatio <= conditionalEarlyTrail.maxVolumeRatio) &&
            (conditionalEarlyTrail.maxEfficiencyRatio == null || efficiencyRatio <= conditionalEarlyTrail.maxEfficiencyRatio) &&
            (conditionalEarlyTrail.minRecentHighDrawdownPct == null || (marketContext?.recentHighDrawdownPct ?? 0) <= -Math.abs(conditionalEarlyTrail.minRecentHighDrawdownPct)) &&
            (conditionalEarlyTrail.minLongHighDrawdownPct == null || (marketContext?.longHighDrawdownPct ?? 0) <= -Math.abs(conditionalEarlyTrail.minLongHighDrawdownPct)) &&
            (conditionalEarlyTrail.minClose == null || current.close >= conditionalEarlyTrail.minClose) &&
            (conditionalEarlyTrail.maxClose == null || current.close <= conditionalEarlyTrail.maxClose) &&
            (conditionalEarlyTrail.activeFromTs == null || current.ts >= conditionalEarlyTrail.activeFromTs) &&
            (conditionalEarlyTrail.activeUntilTs == null || current.ts <= conditionalEarlyTrail.activeUntilTs) &&
            (
                conditionalEarlyTrail.minHoldBars == null ||
                entryTs == null ||
                entryBarMs == null ||
                elapsedBars(entryTs, current.ts, entryBarMs) >= conditionalEarlyTrail.minHoldBars
            ) &&
            (
                conditionalEarlyTrail.minBarsSincePeak == null ||
                peakTs == null ||
                entryBarMs == null ||
                elapsedBars(peakTs, current.ts, entryBarMs) >= conditionalEarlyTrail.minBarsSincePeak
            );
        const strongSignals = [
            conditionalEarlyTrail.disableWhenMom20AtLeast != null
                ? current.mom20 >= conditionalEarlyTrail.disableWhenMom20AtLeast
                : null,
            conditionalEarlyTrail.disableWhenMom80AtLeast != null
                ? (marketContext?.mom80 ?? 0) >= conditionalEarlyTrail.disableWhenMom80AtLeast
                : null,
            conditionalEarlyTrail.disableWhenMomAccelAtLeast != null
                ? current.momAccel >= conditionalEarlyTrail.disableWhenMomAccelAtLeast
                : null,
            conditionalEarlyTrail.disableWhenVolumeRatioAtLeast != null
                ? volumeRatio >= conditionalEarlyTrail.disableWhenVolumeRatioAtLeast
                : null,
            conditionalEarlyTrail.disableWhenEfficiencyRatioAtLeast != null
                ? efficiencyRatio >= conditionalEarlyTrail.disableWhenEfficiencyRatioAtLeast
                : null,
        ].filter((value): value is boolean => value != null);
        const strongEnough = strongSignals.length > 0 && (
            conditionalEarlyTrail.disableMode === "any"
                ? strongSignals.some(Boolean)
                : strongSignals.every(Boolean)
        );
        if (weakEnough && !strongEnough) {
            activationPct = conditionalEarlyTrail.activationPct;
            retracePct = conditionalEarlyTrail.retracePct;
            conditionalEarly = true;
        }
    }

    if (!tiers?.length || entryPrice <= 0 || peakPrice <= 0) {
        return { activationPct, retracePct, conditionalEarly };
    }

    const activeTier = [...tiers]
        .filter((tier) => peakProfitPct >= tier.activationPct)
        .sort((left, right) => right.activationPct - left.activationPct)[0];
    if (activeTier) {
        activationPct = activeTier.activationPct;
        retracePct = activeTier.retracePct;
        conditionalEarly = false;
    }

    return { activationPct, retracePct, conditionalEarly };
}

function resolveIdleBreakoutMaxHoldBars(
    current: IndicatorBar,
    position: PositionState,
    options: HybridVariantOptions,
) {
    const baseMaxHoldBars = options.idleBreakoutMaxHoldBars ?? null;
    if (!position.symbol || !isIdleBreakoutEntry(position)) return baseMaxHoldBars;

    const strongMaxHoldBars = options.idleBreakoutStrongMaxHoldBarsBySymbol?.[position.symbol.toUpperCase()];
    if (strongMaxHoldBars == null) return baseMaxHoldBars;
    if (
        options.idleBreakoutStrongMaxHoldMinMom20 != null &&
        current.mom20 < options.idleBreakoutStrongMaxHoldMinMom20
    ) {
        return baseMaxHoldBars;
    }
    if (
        options.idleBreakoutStrongMaxHoldMinMomAccel != null &&
        current.momAccel < options.idleBreakoutStrongMaxHoldMinMomAccel
    ) {
        return baseMaxHoldBars;
    }

    return strongMaxHoldBars;
}

function shouldBlockIdleBreakoutTrendSwitch(
    position: PositionState,
    currentEval: HybridTrendSymbolDecision | null,
    nextCandidate: ReturnType<typeof pickTrendCandidate> | null,
    currentClose: number | null,
    options: HybridVariantOptions = {},
) {
    if (!position.symbol || !isIdleBreakoutEntry(position)) return false;
    if (!nextCandidate?.eligible || !nextCandidate.symbol || nextCandidate.symbol === position.symbol) return false;

    const targetSymbols = options.idleBreakoutSwitchGuardTargetSymbols?.map((symbol) => symbol.toUpperCase());
    if (targetSymbols?.length && !targetSymbols.includes(nextCandidate.symbol.toUpperCase())) return false;

    const unrealizedPct = currentClose != null && position.entryPrice > 0
        ? currentClose / position.entryPrice - 1
        : null;
    const guardMode = options.idleBreakoutSwitchGuardMode ?? "any";
    const guardChecks: boolean[] = [];

    if (options.idleBreakoutSwitchGuardBlockBelowProfitPct != null) {
        guardChecks.push(
            unrealizedPct != null
            && unrealizedPct < options.idleBreakoutSwitchGuardBlockBelowProfitPct,
        );
    }

    if (options.idleBreakoutSwitchGuardMinCurrentScore != null) {
        guardChecks.push(
            !!currentEval
            && currentEval.score >= options.idleBreakoutSwitchGuardMinCurrentScore,
        );
    }

    if (options.idleBreakoutSwitchGuardMinCurrentMom20 != null) {
        guardChecks.push(
            !!currentEval
            && currentEval.mom20 >= options.idleBreakoutSwitchGuardMinCurrentMom20,
        );
    }

    if (options.idleBreakoutSwitchGuardMinCurrentMomAccel != null) {
        guardChecks.push(
            !!currentEval
            && currentEval.momAccel >= options.idleBreakoutSwitchGuardMinCurrentMomAccel,
        );
    }

    if (options.idleBreakoutSwitchGuardMinCurrentEfficiencyRatio != null) {
        guardChecks.push(
            !!currentEval
            && currentEval.efficiencyRatio >= options.idleBreakoutSwitchGuardMinCurrentEfficiencyRatio,
        );
    }

    if (options.idleBreakoutSwitchGuardRequiredScoreGap != null) {
        guardChecks.push(
            !!currentEval
            && nextCandidate.score - currentEval.score < options.idleBreakoutSwitchGuardRequiredScoreGap,
        );
    }

    if (options.idleBreakoutSwitchGuardBlockAfterTrailActivation === true) {
        const trailActivationPct = options.idleBreakoutProfitTrailActivationPct ?? null;
        guardChecks.push(
            trailActivationPct != null
            && position.peakPrice >= position.entryPrice * (1 + trailActivationPct),
        );
    }

    if (!guardChecks.length) return false;
    return guardMode === "all" ? guardChecks.every(Boolean) : guardChecks.some(Boolean);
}

function shouldAllowStrictExtraRotation(
    position: PositionState,
    currentEval: HybridTrendSymbolDecision | null,
    extraCandidate: ReturnType<typeof pickStrictExtraTrendCandidate> | null,
    currentTs: number,
    options: HybridVariantOptions = {},
) {
    if (!options.strictExtraTrendRotationWhileHolding) return false;
    if (position.side !== "trend" || !position.symbol || isStrictExtraTrendSymbol(position.symbol, options)) return false;
    if (
        options.strictExtraTrendRotationCurrentSymbols?.length &&
        !options.strictExtraTrendRotationCurrentSymbols.map((item) => item.toUpperCase()).includes(position.symbol.toUpperCase())
    ) {
        return false;
    }
    if (!currentEval || !extraCandidate?.eligible || !extraCandidate.symbol) return false;
    if (extraCandidate.symbol === position.symbol) return false;

    const scoreGap = extraCandidate.score - currentEval.score;
    const requiredGap = strictExtraRotationScoreGapForSymbol(extraCandidate.symbol, options);
    if (scoreGap < requiredGap) return false;
    if (options.strictExtraTrendRotationCandidateMinScore != null && extraCandidate.score < options.strictExtraTrendRotationCandidateMinScore) return false;
    if (options.strictExtraTrendRotationCandidateMinMom20 != null && extraCandidate.mom20 < options.strictExtraTrendRotationCandidateMinMom20) return false;
    if (options.strictExtraTrendRotationCandidateMinMomAccel != null && extraCandidate.momAccel < options.strictExtraTrendRotationCandidateMinMomAccel) return false;
    if (options.strictExtraTrendRotationCandidateMinAdx14 != null && extraCandidate.adx14 < options.strictExtraTrendRotationCandidateMinAdx14) return false;
    if (
        options.strictExtraTrendRotationCandidateMinEfficiencyRatio != null &&
        extraCandidate.efficiencyRatio < options.strictExtraTrendRotationCandidateMinEfficiencyRatio
    ) {
        return false;
    }

    const currentMomAccelMax = options.strictExtraTrendRotationCurrentMomAccelMax ?? 0;
    if (currentEval.momAccel > currentMomAccelMax) return false;

    if (
        options.strictExtraTrendRotationCurrentMom20Max != null
        && currentEval.mom20 > options.strictExtraTrendRotationCurrentMom20Max
    ) {
        return false;
    }

    const minHoldBars = options.strictExtraTrendRotationMinHoldBars ?? 1;
    if (elapsedBars(position.entryTs, currentTs, position.entryBarMs) < minHoldBars) return false;

    return true;
}

function maybePreferStrictExtraTrendCandidate(
    snapshot: RegimeSnapshot,
    indicators: Record<string, IndicatorBar[]>,
    trendCandidate: ReturnType<typeof pickTrendCandidate> | null,
    options: HybridVariantOptions = {},
    strictExtraIndicators?: Record<string, IndicatorBar[]>,
) {
    if (!trendCandidate?.eligible || !trendCandidate.symbol) return trendCandidate;
    if (!options.strictExtraTrendPriorityCurrentSymbols?.length) return trendCandidate;

    const currentSymbol = trendCandidate.symbol.toUpperCase();
    const priorityCurrentSymbols = options.strictExtraTrendPriorityCurrentSymbols.map((item) => item.toUpperCase());
    if (!priorityCurrentSymbols.includes(currentSymbol)) return trendCandidate;

    const extraCandidate = pickStrictExtraTrendCandidate(
        snapshot,
        (strictExtraIndicators ?? indicators) as Record<string, IndicatorBar[]>,
        strictExtraDecisionOptions(options),
    );
    if (!extraCandidate?.eligible || !extraCandidate.symbol) return trendCandidate;
    if (extraCandidate.symbol.toUpperCase() === currentSymbol) return trendCandidate;

    const scoreGap = extraCandidate.score - trendCandidate.score;
    const requiredGap = options.strictExtraTrendPriorityScoreGap ?? 0;
    if (scoreGap < requiredGap) return trendCandidate;

    const requireHigherMom20 = options.strictExtraTrendPriorityRequireHigherMom20 === true;
    const requireHigherEfficiency = options.strictExtraTrendPriorityRequireHigherEfficiency === true;
    if (requireHigherMom20 || requireHigherEfficiency) {
        const currentEval = buildTrendEvaluationsForSymbols(
            snapshot,
            indicators,
            [trendCandidate.symbol],
            options,
        )[0] ?? null;
        const extraEval = buildTrendEvaluationsForSymbols(
            snapshot,
            (strictExtraIndicators ?? indicators) as Record<string, IndicatorBar[]>,
            [extraCandidate.symbol],
            strictExtraDecisionOptions(options),
        )[0] ?? null;
        if (!currentEval || !extraEval) return trendCandidate;
        if (requireHigherMom20 && extraEval.mom20 < currentEval.mom20) return trendCandidate;
        if (requireHigherEfficiency && extraEval.efficiencyRatio < currentEval.efficiencyRatio) return trendCandidate;
    }

    return {
        ...extraCandidate,
        reasons: [...extraCandidate.reasons, "strict-extra-priority"],
    };
}

function shouldAllowTrendRotation(
    position: PositionState,
    currentEval: HybridTrendSymbolDecision | null,
    nextCandidate: ReturnType<typeof pickTrendCandidate> | null,
    currentTs: number,
    options: HybridVariantOptions = {},
) {
    if (!options.trendRotationWhileHolding) return false;
    if (position.side !== "trend" || !position.symbol) return false;
    if (
        options.trendRotationCurrentSymbols?.length &&
        !options.trendRotationCurrentSymbols.map((item) => item.toUpperCase()).includes(position.symbol.toUpperCase())
    ) {
        return false;
    }
    if (!currentEval || !nextCandidate?.eligible || !nextCandidate.symbol) return false;
    if (nextCandidate.symbol === position.symbol) return false;
    if (isStrictExtraTrendSymbol(nextCandidate.symbol, options)) return false;
    const targetBlocked =
        options.trendRotationTargetBlockSymbols?.length &&
        options.trendRotationTargetBlockSymbols.map((item) => item.toUpperCase()).includes(nextCandidate.symbol.toUpperCase());
    if (targetBlocked && !trendRotationTargetExceptionOk(nextCandidate, options)) {
        return false;
    }

    const scoreGap = nextCandidate.score - currentEval.score;
    const primaryGap = options.trendRotationScoreGap ?? 10;
    const alternateGap = options.trendRotationAlternateScoreGap ?? null;
    const minimumGap = alternateGap != null ? Math.min(primaryGap, alternateGap) : primaryGap;
    if (scoreGap < minimumGap) return false;

    const currentMomAccelMax = options.trendRotationCurrentMomAccelMax ?? 0;
    if (currentEval.momAccel > currentMomAccelMax) return false;

    if (
        options.trendRotationCurrentMom20Max != null
        && currentEval.mom20 > options.trendRotationCurrentMom20Max
    ) {
        return false;
    }

    const minHoldBars = options.trendRotationMinHoldBars ?? 1;
    if (elapsedBars(position.entryTs, currentTs, position.entryBarMs) < minHoldBars) return false;

    return true;
}

function shouldBlockStrictExtraTrendSwitch(
    position: PositionState,
    currentEval: HybridTrendSymbolDecision | null,
    nextCandidate: ReturnType<typeof pickTrendCandidate> | null,
    currentClose: number | null,
    options: HybridVariantOptions = {},
) {
    if (!position.symbol || !isStrictExtraTrendSymbol(position.symbol, options)) return false;
    if (!nextCandidate?.eligible || !nextCandidate.symbol || nextCandidate.symbol === position.symbol) return false;

    const guardSymbols = (options.strictExtraTrendSwitchGuardSymbols ?? options.strictExtraTrendSymbols ?? [])
        .map((symbol) => symbol.toUpperCase());
    if (guardSymbols.length && !guardSymbols.includes(position.symbol.toUpperCase())) return false;

    const targetSymbols = options.strictExtraTrendSwitchGuardTargetSymbols?.map((symbol) => symbol.toUpperCase());
    if (targetSymbols?.length && !targetSymbols.includes(nextCandidate.symbol.toUpperCase())) return false;

    const unrealizedPct = currentClose != null && position.entryPrice > 0
        ? currentClose / position.entryPrice - 1
        : null;
    const guardMode = options.strictExtraTrendSwitchGuardMode ?? "any";
    const guardChecks: boolean[] = [];

    if (options.strictExtraTrendSwitchGuardBlockBelowProfitPct != null) {
        guardChecks.push(
            unrealizedPct != null
            && unrealizedPct < options.strictExtraTrendSwitchGuardBlockBelowProfitPct,
        );
    }

    if (options.strictExtraTrendSwitchGuardMinCurrentScore != null) {
        guardChecks.push(
            !!currentEval
            && currentEval.score >= options.strictExtraTrendSwitchGuardMinCurrentScore,
        );
    }

    if (options.strictExtraTrendSwitchGuardMinCurrentMom20 != null) {
        guardChecks.push(
            !!currentEval
            && currentEval.mom20 >= options.strictExtraTrendSwitchGuardMinCurrentMom20,
        );
    }

    if (options.strictExtraTrendSwitchGuardMinCurrentMomAccel != null) {
        guardChecks.push(
            !!currentEval
            && currentEval.momAccel >= options.strictExtraTrendSwitchGuardMinCurrentMomAccel,
        );
    }

    if (options.strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio != null) {
        guardChecks.push(
            !!currentEval
            && currentEval.efficiencyRatio >= options.strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio,
        );
    }

    if (options.strictExtraTrendSwitchGuardRequiredScoreGap != null) {
        guardChecks.push(
            !!currentEval
            && nextCandidate.score - currentEval.score < options.strictExtraTrendSwitchGuardRequiredScoreGap,
        );
    }

    const nearTrailRatio = options.strictExtraTrendSwitchGuardNearTrailRatio;
    const trailActivationPct = symbolOverrideNumber(
        options.strictExtraTrendTrailActivationPctBySymbol,
        position.symbol,
        options.strictExtraTrendTrailActivationPct,
    );
    const trailRetracePct = symbolOverrideNumber(
        options.strictExtraTrendTrailRetracePctBySymbol,
        position.symbol,
        options.strictExtraTrendTrailRetracePct,
    );

    if (options.strictExtraTrendSwitchGuardBlockAfterTrailActivation === true) {
        guardChecks.push(
            trailActivationPct != null
            && position.peakPrice >= position.entryPrice * (1 + trailActivationPct),
        );
    }

    if (nearTrailRatio != null && currentClose != null && Number.isFinite(currentClose) && currentClose > 0) {
        guardChecks.push(
            trailActivationPct != null
            && trailRetracePct != null
            && position.peakPrice >= position.entryPrice * (1 + trailActivationPct)
            && currentClose <= position.peakPrice * (1 - trailRetracePct * nearTrailRatio),
        );
    }

    if (!guardChecks.length) return false;
    return guardMode === "all" ? guardChecks.every(Boolean) : guardChecks.some(Boolean);
}

function shouldConvertStrictExtraTrendSwitchToCash(
    position: PositionState,
    nextCandidate: ReturnType<typeof pickTrendCandidate> | null,
    currentClose: number | null,
    options: HybridVariantOptions = {},
) {
    if (
        !options.strictExtraTrendSwitchToCashSymbols?.length
        && !options.strictExtraTrendSwitchToCashTargetSymbols?.length
        && options.strictExtraTrendSwitchToCashBelowProfitPct == null
    ) {
        return false;
    }
    if (!position.symbol || !isStrictExtraTrendSymbol(position.symbol, options)) return false;
    if (!nextCandidate?.eligible || !nextCandidate.symbol || nextCandidate.symbol === position.symbol) return false;

    const sourceSymbols = options.strictExtraTrendSwitchToCashSymbols?.map((symbol) => symbol.toUpperCase());
    if (sourceSymbols?.length && !sourceSymbols.includes(position.symbol.toUpperCase())) return false;

    const targetSymbols = options.strictExtraTrendSwitchToCashTargetSymbols?.map((symbol) => symbol.toUpperCase());
    if (targetSymbols?.length && !targetSymbols.includes(nextCandidate.symbol.toUpperCase())) return false;

    if (options.strictExtraTrendSwitchToCashBelowProfitPct != null) {
        const unrealizedPct = currentClose != null && position.entryPrice > 0
            ? currentClose / position.entryPrice - 1
            : null;
        if (unrealizedPct == null || unrealizedPct >= options.strictExtraTrendSwitchToCashBelowProfitPct) {
            return false;
        }
    }

    return true;
}

function shouldUseStrongStrictExtraTrail(
    symbol: string,
    currentBar: IndicatorBar,
    efficiencyRatio: number,
    options: HybridVariantOptions = {},
) {
    const strongSymbols = options.strictExtraTrendStrongTrailSymbols?.map((item) => item.toUpperCase());
    if (strongSymbols?.length && !strongSymbols.includes(symbol.toUpperCase())) return false;

    const distanceFromSmaPct = currentBar.sma40 > 0 ? ((currentBar.close / currentBar.sma40) - 1) * 100 : 0;
    const score = (currentBar.mom20 * 100) + distanceFromSmaPct + (currentBar.adx14 / 5);
    if (options.strictExtraTrendStrongTrailMinScore != null && score < options.strictExtraTrendStrongTrailMinScore) return false;
    if (options.strictExtraTrendStrongTrailMinMom20 != null && currentBar.mom20 < options.strictExtraTrendStrongTrailMinMom20) return false;
    if (options.strictExtraTrendStrongTrailMinMomAccel != null && currentBar.momAccel < options.strictExtraTrendStrongTrailMinMomAccel) return false;
    if (options.strictExtraTrendStrongTrailMinEfficiencyRatio != null && efficiencyRatio < options.strictExtraTrendStrongTrailMinEfficiencyRatio) return false;
    return true;
}

function shouldUseStrictExtraReentry(
    candidate: HybridTrendSymbolDecision | null,
    trendCandidate: ReturnType<typeof pickTrendCandidate> | null,
    options: HybridVariantOptions = {},
) {
    if (!candidate?.eligible) return false;
    if (options.strictExtraTrendReentryMinScore != null && candidate.score < options.strictExtraTrendReentryMinScore) return false;
    if (options.strictExtraTrendReentryMinMom20 != null && candidate.mom20 < options.strictExtraTrendReentryMinMom20) return false;
    if (options.strictExtraTrendReentryMinMomAccel != null && candidate.momAccel < options.strictExtraTrendReentryMinMomAccel) return false;
    if (options.strictExtraTrendReentryMinEfficiencyRatio != null && candidate.efficiencyRatio < options.strictExtraTrendReentryMinEfficiencyRatio) return false;
    if (options.strictExtraTrendReentryRequireTrendCandidateWeak === true && trendCandidate?.eligible) return false;
    if (
        options.strictExtraTrendReentryRequiredScoreGap != null &&
        trendCandidate?.eligible &&
        candidate.score - trendCandidate.score < options.strictExtraTrendReentryRequiredScoreGap
    ) {
        return false;
    }
    return true;
}

function trendRotationTargetExceptionOk(
    candidate: {
        symbol: string;
        score: number;
        mom20: number;
        momAccel: number;
        adx14: number;
        volumeRatio: number;
        efficiencyRatio: number;
        structureBreak: boolean;
        dowHigherHighLow: boolean;
    },
    options: HybridVariantOptions = {},
) {
    const rule = options.trendRotationTargetExceptionBySymbol?.[candidate.symbol.toUpperCase()];
    if (!rule) return false;
    if (rule.minScore != null && candidate.score < rule.minScore) return false;
    if (rule.minMom20 != null && candidate.mom20 < rule.minMom20) return false;
    if (rule.minMomAccel != null && candidate.momAccel < rule.minMomAccel) return false;
    if (rule.minVolumeRatio != null && candidate.volumeRatio < rule.minVolumeRatio) return false;
    if (rule.minAdx14 != null && candidate.adx14 < rule.minAdx14) return false;
    if (rule.minEfficiencyRatio != null && candidate.efficiencyRatio < rule.minEfficiencyRatio) return false;
    if (rule.requireStructureBreak === true && !candidate.structureBreak) return false;
    if (rule.requireDowHigherHighLow === true && !candidate.dowHigherHighLow) return false;
    return true;
}

function trendRotationThresholdMet(
    scoreGap: number,
    leadCount: number,
    options: HybridVariantOptions = {},
) {
    const primaryGap = options.trendRotationScoreGap ?? 10;
    const primaryBars = options.trendRotationRequireConsecutiveBars ?? 1;
    const alternateGap = options.trendRotationAlternateScoreGap ?? null;
    const alternateBars = options.trendRotationAlternateRequireConsecutiveBars ?? primaryBars;

    if (scoreGap >= primaryGap && leadCount >= primaryBars) return true;
    if (alternateGap != null && scoreGap >= alternateGap && leadCount >= alternateBars) return true;
    return false;
}

function pickTrendCandidate(
    snapshot: RegimeSnapshot,
    indicators: Record<string, IndicatorBar[]>,
    mode: BacktestMode,
    options: HybridVariantOptions = {},
) {
    if (options.disableTrend) return null;
    void mode;
    const evaluations = buildTrendEvaluationsForSymbols(
        snapshot,
        indicators,
        trendUniverseSymbolsForSnapshot(snapshot.ts, options),
        options,
    );
    const cashInsteadSymbols = options.trendCashInsteadOfEntrySymbols?.map((item) => item.toUpperCase());
    const rawTop = evaluations.find((item) => item.eligible);
    if (rawTop && cashInsteadSymbols?.includes(rawTop.symbol.toUpperCase())) {
        return null;
    }
    const availableEvaluations = evaluations.filter((item) => !isTrendSymbolBlocked(item.symbol, snapshot.ts, options, snapshot));
    const prioritySymbols = options.trendPrioritySymbols ?? [];
    const priorityPick = prioritySymbols
        .map((symbol) => availableEvaluations.find((item) => item.symbol === symbol && item.eligible))
        .find(Boolean);
    const top = availableEvaluations.find((item) => item.eligible);
    const priorityGapOk = priorityPick && top
        ? options.trendPriorityMaxScoreGap == null || (top.score - priorityPick.score) <= options.trendPriorityMaxScoreGap
        : Boolean(priorityPick);
    if (priorityPick && priorityGapOk) {
        return {
            symbol: priorityPick.symbol,
            bar: latestIndicatorAtOrBefore(indicators[priorityPick.symbol], snapshot.ts)!,
            eligible: priorityPick.eligible,
            score: priorityPick.score,
            mom20: priorityPick.mom20,
            mom80: priorityPick.mom80,
            momAccel: priorityPick.momAccel,
            adx14: priorityPick.adx14,
            volumeRatio: priorityPick.volumeRatio,
            efficiencyRatio: priorityPick.efficiencyRatio,
            recentHighDrawdownPct: priorityPick.recentHighDrawdownPct,
            longHighDrawdownPct: priorityPick.longHighDrawdownPct,
            structureBreak: priorityPick.structureBreak,
            dowHigherHighLow: priorityPick.dowHigherHighLow,
            reasons: [...priorityPick.reasons, "priority-pick"],
        };
    }
    if (!top) return null;

    return {
        symbol: top.symbol,
        bar: latestIndicatorAtOrBefore(indicators[top.symbol], snapshot.ts)!,
        eligible: top.eligible,
        score: top.score,
        mom20: top.mom20,
        mom80: top.mom80,
        momAccel: top.momAccel,
        adx14: top.adx14,
        volumeRatio: top.volumeRatio,
        efficiencyRatio: top.efficiencyRatio,
        recentHighDrawdownPct: top.recentHighDrawdownPct,
        longHighDrawdownPct: top.longHighDrawdownPct,
        structureBreak: top.structureBreak,
        dowHigherHighLow: top.dowHigherHighLow,
        reasons: top.reasons,
    };
}

function pickTrendCandidateForSymbols(
    snapshot: RegimeSnapshot,
    indicators: Record<string, IndicatorBar[]>,
    symbols: readonly string[],
    options: HybridVariantOptions = {},
) {
    const evaluations = buildTrendEvaluationsForSymbols(
        snapshot,
        indicators,
        symbols,
        options,
    ).filter((item) => !isTrendSymbolBlocked(item.symbol, snapshot.ts, options, snapshot));
    const top = evaluations.find((item) => item.eligible);
    if (!top) return null;

    return {
        symbol: top.symbol,
        bar: latestIndicatorAtOrBefore(indicators[top.symbol], snapshot.ts)!,
        eligible: top.eligible,
        score: top.score,
        mom20: top.mom20,
        mom80: top.mom80,
        momAccel: top.momAccel,
        adx14: top.adx14,
        volumeRatio: top.volumeRatio,
        efficiencyRatio: top.efficiencyRatio,
        recentHighDrawdownPct: top.recentHighDrawdownPct,
        longHighDrawdownPct: top.longHighDrawdownPct,
        structureBreak: top.structureBreak,
        dowHigherHighLow: top.dowHigherHighLow,
        reasons: top.reasons,
    };
}

function pickStrictExtraTrendCandidate(
    snapshot: RegimeSnapshot,
    indicators: Record<string, IndicatorBar[]>,
    options: HybridVariantOptions = {},
) {
    const extraSymbols = options.strictExtraTrendSymbols?.length
        ? uniqueSymbols(options.strictExtraTrendSymbols)
        : [];
    if (!extraSymbols.length || !isInAllowedWindow(snapshot.ts, options.strictExtraTrendAllowedWindows)) return null;

    const top = buildTrendEvaluationsForSymbols(snapshot, indicators, extraSymbols, options)
        .filter((item) => !isTrendSymbolBlocked(item.symbol, snapshot.ts, options, snapshot))
        .find((item) => item.eligible);
    if (!top) return null;

    return {
        symbol: top.symbol,
        bar: latestIndicatorAtOrBefore(indicators[top.symbol], snapshot.ts)!,
        eligible: top.eligible,
        score: top.score,
        mom20: top.mom20,
        mom80: top.mom80,
        momAccel: top.momAccel,
        adx14: top.adx14,
        volumeRatio: top.volumeRatio,
        efficiencyRatio: top.efficiencyRatio,
        recentHighDrawdownPct: top.recentHighDrawdownPct,
        longHighDrawdownPct: top.longHighDrawdownPct,
        structureBreak: top.structureBreak,
        dowHigherHighLow: top.dowHigherHighLow,
        reasons: [...top.reasons, "idle-extra"],
    };
}

function pickRangeCandidate(
    snapshot: RegimeSnapshot,
    indicators: Record<TradeSymbol, IndicatorBar[]>,
    rangeSymbols: readonly (typeof TRADE_SYMBOLS[number])[] = RANGE_SYMBOLS,
    options: HybridVariantOptions = {},
) {
    const bars = rangeSymbols.map((symbol) => {
        const series = indicators[symbol];
        const idx = latestIndicatorIndexAtOrBefore(series, snapshot.ts);
        const bar = idx >= 0 ? series[idx] : null;
        if (!bar || !bar.ready) return null;

        const mode = options.rangeEntryMode ?? "mean_revert";
        const priorCloses = idx >= 0 ? series.slice(Math.max(0, idx - 8), idx).map((item) => item.close) : [];
        const boxHigh = priorCloses.length ? Math.max(...priorCloses) : bar.close;
        const boxLow = priorCloses.length ? Math.min(...priorCloses) : bar.close;
        const boxMid = (boxHigh + boxLow) / 2;
        const boxWidthPct = boxMid > 0 ? (boxHigh - boxLow) / boxMid : 0;
        const acceptanceCenter = average(priorCloses.length ? priorCloses : [bar.close]);
        const acceptanceDeviation = average((priorCloses.length ? priorCloses : [bar.close]).map((value) => Math.abs(value - acceptanceCenter)));

        const reclaimBand = boxLow * 1.005;
        const reclaimCeiling = boxMid * 1.01;
        const bodyStrength = bar.high > bar.low ? (bar.close - bar.low) / (bar.high - bar.low) : 0;
        const closeToHigh = bar.high > bar.low ? (bar.high - bar.close) / (bar.high - bar.low) : 1;
        const rangePct = bar.close > 0 ? (bar.high - bar.low) / bar.close : 0;
        const atrProxyPct = idx >= 4
            ? average(series.slice(idx - 4, idx + 1).map((item) => (item.close > 0 ? (item.high - item.low) / item.close : 0)))
            : rangePct;
        const recentCompressionPct = idx >= 3
            ? average(series.slice(idx - 3, idx + 1).map((item) => (item.close > 0 ? (item.high - item.low) / item.close : 0)))
            : rangePct;
        const failedBreakdownOk =
            bar.low <= boxLow * 0.992 &&
            bar.close >= boxLow * 1.002 &&
            bar.close <= boxMid * 1.015 &&
            bar.close > bar.open &&
            bodyStrength >= 0.58 &&
            bar.mom20 <= 0.015 &&
            boxWidthPct <= 0.18;
        const atrSnapbackOk =
            bar.close < bar.sma45 * 0.992 &&
            bar.close > bar.low * 1.01 &&
            bodyStrength >= 0.52 &&
            atrProxyPct >= 0.035 &&
            bar.mom20 <= 0.01 &&
            boxWidthPct <= 0.22;
        const meanReversionOk = mode === "mean_revert"
            ? bar.close < bar.sma45 && bar.mom20 <= 0
            : mode === "box_rebound"
                ? bar.close <= boxLow * 1.01 && boxWidthPct <= 0.12 && bar.mom20 <= 0
                : mode === "reclaim"
                    ? bar.close >= reclaimBand && bar.close <= reclaimCeiling && boxWidthPct <= 0.16 && bar.mom20 <= 0.01
                    : mode === "wick_rejection"
                        ? (
                            (bar.low <= Math.min(boxLow * 1.01, bar.sma45 * 0.985)) &&
                            bar.close > bar.open &&
                            bodyStrength >= 0.55 &&
                            closeToHigh <= 0.4 &&
                            bar.mom20 <= 0.02 &&
                            boxWidthPct <= 0.22
                        )
                        : mode === "midline_reclaim"
                            ? (
                                bar.close >= acceptanceCenter &&
                                bar.close <= boxMid * 1.04 &&
                                bar.open <= acceptanceCenter * 1.01 &&
                                bar.mom20 <= 0.03 &&
                                boxWidthPct <= 0.25
                            )
                            : mode === "volatility_spring"
                                ? (
                                    bar.low <= boxLow * 0.995 &&
                                    bar.close >= acceptanceCenter &&
                                    bar.close > bar.open &&
                                    bar.overheatPct <= 0.01 &&
                                    bar.mom20 <= 0.02 &&
                                    boxWidthPct <= 0.24
                                )
                                : mode === "failed_breakdown"
                                    ? failedBreakdownOk
                                    : mode === "atr_snapback"
                                        ? atrSnapbackOk
                                        : mode === "compression_turn"
                                            ? (
                                                recentCompressionPct <= 0.045 &&
                                                boxWidthPct <= 0.14 &&
                                                bar.close >= acceptanceCenter &&
                                                bar.open <= acceptanceCenter * 1.003 &&
                                                bodyStrength >= 0.5 &&
                                                bar.mom20 <= 0.025
                                            )
                                            : mode === "sma_reclaim_pulse"
                                                ? (
                                                    bar.low <= bar.sma45 * 0.988 &&
                                                    bar.open <= bar.sma45 * 0.998 &&
                                                    bar.close >= bar.sma45 * 0.999 &&
                                                    bar.close <= boxMid * 1.02 &&
                                                    bodyStrength >= 0.56 &&
                                                    bar.mom20 <= 0.02 &&
                                                    boxWidthPct <= 0.2
                                                )
                                                : mode === "atr_or_failed_breakdown"
                                                    ? (atrSnapbackOk || failedBreakdownOk)
                                : bar.close < acceptanceCenter - Math.max(acceptanceDeviation * 1.2, acceptanceCenter * 0.012) && bar.mom20 <= 0;
        const overheatOk = bar.overheatPct <= (options.rangeOverheatMax ?? -0.015);
        const bestMomGate = options.rangeEntryBestMom20Below == null || snapshot.bestMom20 < options.rangeEntryBestMom20Below;
        const btcAdxGate = options.rangeEntryBtcAdxBelow == null || snapshot.btc.adx14 < options.rangeEntryBtcAdxBelow;
        const eligible = snapshot.rangeAllowed && meanReversionOk && overheatOk && bestMomGate && btcAdxGate;
        const score = ((bar.sma45 - bar.close) / Math.max(1, bar.sma45)) * 100 + (Math.max(0, -bar.mom20) * 100) + Math.max(0, 20 - bar.adx14);

        return {
            symbol,
            bar,
            eligible,
            score,
            reasons: [
                bar.close < bar.sma45 ? "close<sma45" : "close>=sma45",
                bar.mom20 <= 0 ? "mom20-ok" : "mom20-positive",
                overheatOk ? "pullback-ok" : "pullback-weak",
                mode === "box_rebound"
                    ? "box-rebound"
                    : mode === "acceptance"
                        ? "acceptance-revert"
                        : mode === "reclaim"
                            ? "box-reclaim"
                            : mode === "wick_rejection"
                                ? "wick-rejection"
                                : mode === "midline_reclaim"
                                    ? "midline-reclaim"
                                    : mode === "volatility_spring"
                                        ? "volatility-spring"
                                        : mode === "failed_breakdown"
                                            ? "failed-breakdown"
                                            : mode === "atr_snapback"
                                                ? "atr-snapback"
                                                : mode === "compression_turn"
                                                    ? "compression-turn"
                                                    : mode === "sma_reclaim_pulse"
                                                        ? "sma-reclaim-pulse"
                                                        : mode === "atr_or_failed_breakdown"
                                                            ? "atr-or-failed-breakdown"
                                                        : "mean-revert",
            ],
        };
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    const eligible = bars
        .filter((item) => item.eligible)
        .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));

    const top = eligible[0];
    if (!top) return null;

    return {
        symbol: top.symbol,
        bar: top.bar,
        eligible: top.eligible,
        score: top.score,
        reasons: [...top.reasons, "range-fallback"],
    };
}

function buildRegimeSnapshot(ts: number, indicators: Record<TradeSymbol, IndicatorBar[]>) {
    const btc = latestIndicatorAtOrBefore(indicators.BTC, ts);
    const eth = latestIndicatorAtOrBefore(indicators.ETH, ts);
    const sol = latestIndicatorAtOrBefore(indicators.SOL, ts);
    const avax = latestIndicatorAtOrBefore(indicators.AVAX, ts);
    if (!btc || !eth || !sol || !avax || !btc.ready || !eth.ready || !sol.ready || !avax.ready) return null;

    const tradeBars = [eth, sol, avax];
    const breadth40 = tradeBars.filter((bar) => bar.close > bar.sma40).length;
    const breadth45 = tradeBars.filter((bar) => bar.close > bar.sma45).length;
    const core2_45 = [eth, sol].filter((bar) => bar.close > bar.sma45).length;
    const best = [...tradeBars].sort((left, right) => right.mom20 - left.mom20 || right.close - left.close)[0];
    const bestMom20 = best?.mom20 || 0;
    const bestMomAccel = best?.momAccel || 0;
    const avgMom20EthSol = (eth.mom20 + sol.mom20) / 2;
    const weak2022Regime =
        [
            breadth45 <= 1,
            Math.abs((btc.close / Math.max(1, btc.sma85)) - 1) < 0.01,
            btc.adx14 < 18,
            bestMom20 < 0.10,
        ].filter(Boolean).length >= 4;
    const trendAllowed = btc.close > btc.sma90;
    const regimeLabel = trendAllowed
        ? (weak2022Regime ? "trend_weak" : "trend_strong")
        : (weak2022Regime ? "range_only" : "ambiguous");

    return {
        ts,
        btc,
        breadth40,
        breadth45,
        core2_45,
        bestMom20,
        bestMomAccel,
        avgMom20EthSol,
        weak2022Regime,
        regimeLabel,
        trendAllowed,
        rangeAllowed:
            (regimeLabel === "range_only" || regimeLabel === "ambiguous") &&
            breadth40 <= 0 &&
            bestMom20 < -0.02 &&
            btc.adx14 < 20,
    } satisfies RegimeSnapshot;
}

function buildEntryAssistCandidate(
    ts: number,
    symbol: typeof TRADE_SYMBOLS[number],
    indicators: Record<TradeSymbol, IndicatorBar[]>,
    options: HybridVariantOptions = {},
) {
    const bar = latestIndicatorAtOrBefore(indicators[symbol], ts);
    if (!bar || !bar.ready) return null;

    const requireMomentum = options.trendEntryAssistRequireMomentum ?? true;
    const requireCloseAboveSma = options.trendEntryAssistRequireCloseAboveSma ?? true;
    const maxMomAccelBelow = options.trendEntryAssistMaxMomAccelBelow ?? null;

    const closeGate = !requireCloseAboveSma || bar.close > bar.sma40;
    const momentumGate = !requireMomentum || bar.mom20 > 0;
    const accelGate = maxMomAccelBelow == null || bar.momAccel >= maxMomAccelBelow;
    const eligible = closeGate && momentumGate && accelGate;

    return {
        symbol,
        eligible,
        reasons: [
            closeGate ? "assist-close>sma40" : "assist-close<=sma40",
            momentumGate ? "assist-mom20-ok" : "assist-mom20-low",
            accelGate ? "assist-accel-ok" : "assist-accel-low",
        ],
        bar,
    };
}

function createEmptyPosition(): PositionState {
    return {
        side: null,
        symbol: null,
        qty: 0,
        entryPrice: 0,
        entryTs: 0,
        entryIndex: -1,
        entryBarMs: 12 * HOUR_MS,
        entryStrategy: null,
        entryReason: "",
        lotId: "",
        entryAlloc: 0,
        entryMom20: null,
        entryMom80: null,
        entryMomAccel: null,
        entryVolumeRatio: null,
        entryEfficiencyRatio: null,
        entryRecentHighDrawdownPct: null,
        entryLongHighDrawdownPct: null,
        rangeExitMom20Above: null,
        rangeMaxHoldBars: null,
        peakPrice: 0,
        peakTs: 0,
        partialExitTaken: false,
        partialExitQty: 0,
        partialExitTs: 0,
        partialExitPeakPrice: 0,
        buybackDone: false,
    };
}

function nextTradeId(mode: BacktestMode, counter: number) {
    return `${mode.toLowerCase()}-${String(counter + 1).padStart(4, "0")}`;
}

function buildExitReason(
    snapshot: RegimeSnapshot,
    current: IndicatorBar,
    position: PositionState,
    mode: BacktestMode,
    side: PositionState["side"],
    entryTs = 0,
    currentTs = 0,
    entryBarMs = 12 * HOUR_MS,
    persistentWeak2022Regime = false,
    options: HybridVariantOptions = {},
) {
    if (side === "trend") {
        if (!snapshot.trendAllowed && !shouldGuardIdleBreakoutRiskOff(current, position, options)) return "risk-off";
        const idleBreakoutWeakExitMinHoldBars = options.idleBreakoutWeakExitMinHoldBars ?? null;
        const idleBreakoutWeakExitRequireCloseBelowSma40 = options.idleBreakoutWeakExitRequireCloseBelowSma40 ?? false;
        const idleBreakoutWeakExitLossPct = position.entryPrice > 0 ? (current.close / position.entryPrice) - 1 : 0;
        if (
            isIdleBreakoutEntry(position)
            && options.idleBreakoutWeakExitMom20Below != null
            && options.idleBreakoutWeakExitMomAccelBelow != null
            && (
                idleBreakoutWeakExitMinHoldBars == null
                || elapsedBars(entryTs, currentTs, entryBarMs) >= idleBreakoutWeakExitMinHoldBars
            )
            && current.mom20 <= options.idleBreakoutWeakExitMom20Below
            && current.momAccel <= options.idleBreakoutWeakExitMomAccelBelow
            && (!idleBreakoutWeakExitRequireCloseBelowSma40 || current.close <= current.sma40)
            && (
                options.idleBreakoutWeakExitOnlyWhenLoss !== true
                || idleBreakoutWeakExitLossPct < 0
            )
            && (
                options.idleBreakoutWeakExitMinLossPct == null
                || idleBreakoutWeakExitLossPct <= -Math.abs(options.idleBreakoutWeakExitMinLossPct)
            )
        ) {
            return "idle-breakout-weak-exit";
        }
        const weakExitMom20Below = symbolOverrideNumber(
            options.symbolSpecificTrendWeakExitMom20BelowBySymbol,
            position.symbol ?? "",
            options.symbolSpecificTrendWeakExitMom20Below,
        );
        const weakExitMomAccelBelow = symbolOverrideNumber(
            options.symbolSpecificTrendWeakExitMomAccelBelowBySymbol,
            position.symbol ?? "",
            options.symbolSpecificTrendWeakExitMomAccelBelow,
        );
        if (
            isSymbolSpecificWeakExitTarget(position.symbol, options)
            && weakExitMom20Below != null
            && weakExitMomAccelBelow != null
            && current.mom20 <= weakExitMom20Below
            && current.momAccel <= weakExitMomAccelBelow
        ) {
            return "symbol-weak-exit";
        }
        const trendExitSma = options.trendExitSma ?? 45;
        if (
            trendExitSma === 40 &&
            current.close <= current.sma40 &&
            !shouldGuardIdleBreakoutSmaBreak(current, position, trendExitSma, entryTs, currentTs, entryBarMs, options)
        ) {
            return "sma40-break";
        }
        if (
            trendExitSma === 45 &&
            current.close <= current.sma45 &&
            !shouldGuardIdleBreakoutSmaBreak(current, position, trendExitSma, entryTs, currentTs, entryBarMs, options)
        ) {
            return "sma-break";
        }

        if (mode === "RETQ22" && snapshot.regimeLabel === "trend_weak") {
            const off22WeakCount = [
                snapshot.breadth40 <= 0,
                snapshot.bestMom20 < 0.05,
                Math.abs((snapshot.btc.close / Math.max(1, snapshot.btc.sma85)) - 1) < 0.01,
                snapshot.btc.adx14 < 18,
                snapshot.core2_45 <= 1,
                snapshot.bestMomAccel < -0.02,
            ].filter(Boolean).length;
            if (off22WeakCount >= 3) return "off22-strong";
        }

        const weakBestMomGate = options.trendWeakExitBestMom20Below != null && snapshot.bestMom20 < options.trendWeakExitBestMom20Below;
        const weakBtcAdxGate = options.trendWeakExitBtcAdxBelow != null && snapshot.btc.adx14 < options.trendWeakExitBtcAdxBelow;
        if (snapshot.weak2022Regime && weakBestMomGate && weakBtcAdxGate) return "weak-trend-off";
    }

    if (side === "range") {
        if (current.close >= current.sma45) return "mean-revert";
        if (current.mom20 > (position.rangeExitMom20Above ?? options.rangeExitMom20Above ?? 0.03)) return "range-momentum";
        if (elapsedBars(entryTs, currentTs, entryBarMs) >= (position.rangeMaxHoldBars ?? options.rangeMaxHoldBars ?? 16)) return "range-time";
    }

    return null;
}

async function loadInstrumentFrames(input?: {
    startTs?: number;
    endTs?: number;
    timeframe?: HybridTimeframe;
    offsetHours?: number;
    interval?: "1h" | "15m";
    symbols?: readonly string[];
    extraSymbols?: readonly string[];
}) {
    const timeframe = input?.timeframe ?? "12h";
    const offsetHours = input?.offsetHours ?? 0;
    const interval = input?.interval ?? (timeframe === "15m" ? "15m" : "1h");
    const frameInput = { ...input, timeframe, offsetHours, interval };
    if (input?.symbols?.length) {
        const symbols = uniqueSymbols(input.symbols);
        const cacheKey = frameSnapshotKey({ ...frameInput, symbols });
        const cached = frameMemoryCache.get(cacheKey);
        if (cached) return cached;
        const promise = (async () => {
            const snapshot = await readFrameSnapshot(cacheKey);
            if (snapshot) return snapshot;
            const { bySymbol } = await loadRawSeriesForUniverse(symbols, frameInput);
            const indicators = buildCachedIndicatorsForUniverseByTimeframe(bySymbol, timeframe, offsetHours);
            const timeline = readyTimeline(indicators, input?.endTs);
            const frames = { bySymbol, indicators, timeline };
            await writeFrameSnapshot(cacheKey, frames);
            return frames;
        })();
        frameMemoryCache.set(cacheKey, promise);
        return promise;
    }

    if (input?.extraSymbols?.length) {
        const symbols = uniqueSymbols([...ALL_SYMBOLS, ...input.extraSymbols]);
        const cacheKey = frameSnapshotKey({ ...frameInput, symbols });
        const cached = frameMemoryCache.get(cacheKey);
        if (cached) return cached;
        const promise = (async () => {
            const snapshot = await readFrameSnapshot(cacheKey);
            if (snapshot) return snapshot;
            const { bySymbol } = await loadRawSeriesForUniverse(symbols, frameInput);
            const indicators = buildCachedIndicatorsForUniverseByTimeframe(bySymbol, timeframe, offsetHours);
            const timeline = readyTimeline(indicators, input?.endTs);
            const frames = { bySymbol, indicators, timeline };
            await writeFrameSnapshot(cacheKey, frames);
            return frames;
        })();
        frameMemoryCache.set(cacheKey, promise);
        return promise;
    }

    const symbols = [...ALL_SYMBOLS];
    const cacheKey = frameSnapshotKey({ ...frameInput, symbols });
    const cached = frameMemoryCache.get(cacheKey);
    if (cached) return cached;
    const promise = (async () => {
        const snapshot = await readFrameSnapshot(cacheKey);
        if (snapshot) return snapshot;
        const { bySymbol } = await loadRawSeries(frameInput);
        const indicators = buildCachedIndicatorsByTimeframe(bySymbol, timeframe, offsetHours);
        const timeline = readyTimeline(indicators, input?.endTs);
        const frames = { bySymbol, indicators, timeline };
        await writeFrameSnapshot(cacheKey, frames);
        return frames;
    })();
    frameMemoryCache.set(cacheKey, promise);
    return promise;
}

function liveUniverseExtraSymbols(options: HybridVariantOptions = {}) {
    return uniqueSymbols([
        ...(options.expandedTrendSymbols ?? []),
        ...(options.strictExtraTrendSymbols ?? []),
        ...(options.penguOffRotationSymbols ?? []),
        ...(options.penguStrongOverrideSymbols ?? []),
        ...(options.penguStrongOverrideCurrentSymbols ?? []),
        ...(options.rangeSymbols ?? []),
        ...(options.auxRangeSymbols ?? []),
        ...(options.aux2RangeSymbols ?? []),
    ]);
}

function liveUniverseSymbols(options: HybridVariantOptions = {}) {
    return uniqueSymbols(["BTC", ...liveUniverseExtraSymbols(options)]);
}

function trendUniverseSymbolsForSnapshot(
    snapshotTs: number,
    options: HybridVariantOptions = {},
) {
    const baseSymbols = options.expandedTrendSymbols?.length
        ? options.expandedTrendSymbols
        : TRADE_SYMBOLS;
    const allowedExtras = isInAllowedWindow(snapshotTs, options.strictExtraTrendAllowedWindows)
        ? options.strictExtraTrendSymbols ?? []
        : [];
    return uniqueSymbols([...baseSymbols, ...allowedExtras]);
}

function penguOffRotationSymbolAllowedAt(symbol: string, ts: number, options: HybridVariantOptions = {}) {
    const symbolWindows = options.penguOffRotationAllowedWindowsBySymbol?.[symbol.toUpperCase()];
    if (symbolWindows) return isInAllowedWindow(ts, symbolWindows);
    return isInAllowedWindow(ts, options.penguOffRotationAllowedWindows);
}

function penguOffRotationAnySymbolAllowedAt(ts: number, options: HybridVariantOptions = {}) {
    const symbols = options.penguOffRotationSymbols ?? [];
    if (!symbols.length) return isInAllowedWindow(ts, options.penguOffRotationAllowedWindows);
    return symbols.some((symbol) => penguOffRotationSymbolAllowedAt(symbol, ts, options));
}

function penguOffRotationSymbolsAllowedAt(ts: number, options: HybridVariantOptions = {}) {
    return (options.penguOffRotationSymbols ?? [])
        .filter((symbol) => penguOffRotationSymbolAllowedAt(symbol, ts, options));
}

function getExecutionBar(raw: Candle1h[], ts: number) {
    let byTs = executionBarLookupCache.get(raw);
    if (!byTs) {
        byTs = new Map();
        executionBarLookupCache.set(raw, byTs);
    }
    if (byTs.has(ts)) return byTs.get(ts) ?? null;

    let lo = 0;
    let hi = raw.length - 1;
    let best = -1;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (raw[mid].ts <= ts) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    const bar = best >= 0 ? raw[best] : null;
    byTs.set(ts, bar);
    return bar;
}

function tradeAllocForSide(side: NonNullable<PositionState["side"]>, options: HybridVariantOptions = {}) {
    if (side === "range") return options.rangeAlloc ?? 0.5;
    return options.trendAlloc ?? 1.0;
}

function trendAllocForSymbol(symbol: string | null, options: HybridVariantOptions = {}) {
    if (!symbol) return options.trendAlloc ?? 1.0;
    return symbolOverrideNumber(options.trendAllocBySymbol, symbol, options.trendAlloc ?? 1.0) ?? (options.trendAlloc ?? 1.0);
}

function positionAlloc(position: PositionState, options: HybridVariantOptions = {}) {
    if (!position.side) return 0;
    if (position.entryAlloc > 0) return position.entryAlloc;
    return tradeAllocForSide(position.side, options);
}

function ruleForSymbol(symbol: string) {
    return EXTENDED_RULES[symbol.toUpperCase()] ?? { stepSize: 0.001, minQty: 0.001, minNotional: 10 };
}

function exitPosition(
    position: PositionState,
    exitPrice: number,
    exitTs: number,
    exitIndex: number,
    exitReason: string,
    cash: number,
    tradeEvents: TradeEventRow[],
    tradePairs: TradePairRow[],
    feeRate: number,
    options: HybridVariantOptions = {},
) {
    if (!position.side || !position.symbol || position.qty <= 0) return cash;
    const grossProceeds = position.qty * exitPrice;
    const grossPnl = grossProceeds - (position.qty * position.entryPrice);
    const fee = (position.qty * position.entryPrice * feeRate) + (grossProceeds * feeRate);
    const netPnl = grossPnl - fee;
    cash += grossProceeds * (1 - feeRate);
    tradeEvents.push({
        time: formatIso(exitTs),
        symbol: position.symbol,
        action: "exit",
        strategy_type: position.side,
        sub_variant: position.entryStrategy || "trend",
        alloc: positionAlloc(position, options),
        price: exitPrice,
        qty: position.qty,
        reason: exitReason,
        trade_id: position.lotId,
    });
    tradePairs.push({
        trade_id: position.lotId,
        strategy_type: position.side,
        sub_variant: position.entryStrategy || "trend",
        symbol: position.symbol,
        entry_time: formatIso(position.entryTs),
        exit_time: formatIso(exitTs),
        entry_price: position.entryPrice,
        exit_price: exitPrice,
        qty: position.qty,
        gross_pnl: grossPnl,
        fee,
        net_pnl: netPnl,
        holding_bars: Math.max(1, elapsedBars(position.entryTs, exitTs, position.entryBarMs)),
        entry_reason: position.entryReason,
        exit_reason: exitReason,
    });
    position.side = null;
    position.symbol = null;
    position.qty = 0;
    position.entryPrice = 0;
    position.entryTs = 0;
    position.entryIndex = -1;
    position.entryBarMs = 12 * HOUR_MS;
    position.entryStrategy = null;
    position.entryReason = "";
    position.lotId = "";
    position.entryAlloc = 0;
    position.entryMom20 = null;
    position.entryMom80 = null;
    position.entryMomAccel = null;
    position.entryVolumeRatio = null;
    position.entryEfficiencyRatio = null;
    position.entryRecentHighDrawdownPct = null;
    position.entryLongHighDrawdownPct = null;
    position.rangeExitMom20Above = null;
    position.rangeMaxHoldBars = null;
    position.peakPrice = 0;
    position.peakTs = 0;
    position.partialExitTaken = false;
    position.partialExitQty = 0;
    position.partialExitTs = 0;
    position.partialExitPeakPrice = 0;
    position.buybackDone = false;
    return cash;
}

function reducePosition(
    position: PositionState,
    exitPrice: number,
    exitTs: number,
    exitIndex: number,
    exitReason: string,
    fraction: number,
    cash: number,
    tradeEvents: TradeEventRow[],
    tradePairs: TradePairRow[],
    feeRate: number,
    options: HybridVariantOptions = {},
) {
    if (!position.side || !position.symbol || position.qty <= 0) return cash;
    const clampedFraction = Math.min(Math.max(fraction, 0), 0.95);
    const exitQty = stepRound(position.qty * clampedFraction, ruleForSymbol(position.symbol).stepSize);
    if (!Number.isFinite(exitQty) || exitQty <= 0 || exitQty >= position.qty) return cash;
    const grossProceeds = exitQty * exitPrice;
    const grossPnl = grossProceeds - (exitQty * position.entryPrice);
    const fee = (exitQty * position.entryPrice * feeRate) + (grossProceeds * feeRate);
    const netPnl = grossPnl - fee;
    cash += grossProceeds * (1 - feeRate);
    tradeEvents.push({
        time: formatIso(exitTs),
        symbol: position.symbol,
        action: "exit",
        strategy_type: position.side,
        sub_variant: position.entryStrategy || "trend",
        alloc: positionAlloc(position, options) * clampedFraction,
        price: exitPrice,
        qty: exitQty,
        reason: exitReason,
        trade_id: `${position.lotId}-partial`,
    });
    tradePairs.push({
        trade_id: `${position.lotId}-partial`,
        strategy_type: position.side,
        sub_variant: position.entryStrategy || "trend",
        symbol: position.symbol,
        entry_time: formatIso(position.entryTs),
        exit_time: formatIso(exitTs),
        entry_price: position.entryPrice,
        exit_price: exitPrice,
        qty: exitQty,
        gross_pnl: grossPnl,
        fee,
        net_pnl: netPnl,
        holding_bars: Math.max(1, elapsedBars(position.entryTs, exitTs, position.entryBarMs)),
        entry_reason: position.entryReason,
        exit_reason: exitReason,
    });
    position.qty -= exitQty;
    position.partialExitTaken = true;
    position.partialExitQty += exitQty;
    position.partialExitTs = exitTs;
    position.partialExitPeakPrice = Math.max(position.partialExitPeakPrice, position.peakPrice || exitPrice);
    void exitIndex;
    return cash;
}

function buybackPartialPosition(
    position: PositionState,
    entryPrice: number,
    entryTs: number,
    feeRate: number,
    cash: number,
    tradeEvents: TradeEventRow[],
) {
    if (!position.side || !position.symbol || position.partialExitQty <= 0 || position.buybackDone) {
        return cash;
    }
    const rule = ruleForSymbol(position.symbol);
    const targetQty = Math.min(position.partialExitQty, cash / (entryPrice * (1 + feeRate)));
    const qty = stepRound(targetQty, rule.stepSize);
    const entryNotional = qty * entryPrice;
    if (!Number.isFinite(qty) || qty <= 0 || entryNotional < rule.minNotional || qty < rule.minQty) {
        return cash;
    }
    cash -= entryNotional * (1 + feeRate);
    position.qty += qty;
    position.partialExitQty = Math.max(0, position.partialExitQty - qty);
    if (position.partialExitQty <= 0) {
        position.partialExitPeakPrice = 0;
    }
    position.buybackDone = true;
    tradeEvents.push({
        time: formatIso(entryTs),
        symbol: position.symbol,
        action: "enter",
        strategy_type: position.side,
        sub_variant: position.entryStrategy || "trend",
        alloc: positionAlloc(position) * (qty / Math.max(position.qty, qty)),
        price: entryPrice,
        qty,
        reason: "idle-breakout-partial-buyback",
        trade_id: `${position.lotId}-buyback`,
    });
    return cash;
}

function entryStatsFromTrendCandidate(candidate: Partial<HybridTrendSymbolDecision> | null | undefined) {
    return {
        entryMom20: candidate?.mom20 ?? null,
        entryMom80: candidate?.mom80 ?? null,
        entryMomAccel: candidate?.momAccel ?? null,
        entryVolumeRatio: candidate?.volumeRatio ?? null,
        entryEfficiencyRatio: candidate?.efficiencyRatio ?? null,
        entryRecentHighDrawdownPct: candidate?.recentHighDrawdownPct ?? null,
        entryLongHighDrawdownPct: candidate?.longHighDrawdownPct ?? null,
    };
}

function enterPosition(
    position: PositionState,
    side: NonNullable<PositionState["side"]>,
    symbol: string,
    entryPrice: number,
    entryTs: number,
    entryIndex: number,
    entryReason: string,
    tradeEvents: TradeEventRow[],
    tradeId: string,
    cash: number,
    feeRate: number,
    options: HybridVariantOptions = {},
    entryMeta?: {
        subVariant?: string;
        alloc?: number;
        rangeExitMom20Above?: number | null;
        rangeMaxHoldBars?: number | null;
        entryBarMs?: number | null;
        maxNotionalUsd?: number | null;
        entryMom20?: number | null;
        entryMom80?: number | null;
        entryMomAccel?: number | null;
        entryVolumeRatio?: number | null;
        entryEfficiencyRatio?: number | null;
        entryRecentHighDrawdownPct?: number | null;
        entryLongHighDrawdownPct?: number | null;
    },
) {
    const baseAlloc = entryMeta?.alloc ?? (side === "trend" ? trendAllocForSymbol(symbol, options) : tradeAllocForSide(side, options));
    const cappedAlloc = entryMeta?.maxNotionalUsd != null && entryMeta.maxNotionalUsd > 0 && cash > 0
        ? Math.min(baseAlloc, entryMeta.maxNotionalUsd / cash)
        : baseAlloc;
    const alloc = Math.max(0, cappedAlloc);
    const notional = cash * alloc;
    const targetQty = notional / entryPrice;
    const rule = ruleForSymbol(symbol);
    const qty = stepRound(targetQty, rule.stepSize);
    const entryNotional = qty * entryPrice;
    if (!Number.isFinite(qty) || qty <= 0 || entryNotional < rule.minNotional || qty < rule.minQty) {
        return { cash, opened: false };
    }

    cash -= entryNotional * (1 + feeRate);
    position.side = side;
    position.symbol = symbol;
    position.qty = qty;
    position.entryPrice = entryPrice;
    position.entryTs = entryTs;
    position.entryIndex = entryIndex;
    position.entryBarMs = entryMeta?.entryBarMs ?? (12 * HOUR_MS);
    position.entryStrategy = (entryMeta?.subVariant as PositionState["entryStrategy"]) || side;
    position.entryReason = entryReason;
    position.lotId = tradeId;
    position.entryAlloc = alloc;
    position.entryMom20 = entryMeta?.entryMom20 ?? null;
    position.entryMom80 = entryMeta?.entryMom80 ?? null;
    position.entryMomAccel = entryMeta?.entryMomAccel ?? null;
    position.entryVolumeRatio = entryMeta?.entryVolumeRatio ?? null;
    position.entryEfficiencyRatio = entryMeta?.entryEfficiencyRatio ?? null;
    position.entryRecentHighDrawdownPct = entryMeta?.entryRecentHighDrawdownPct ?? null;
    position.entryLongHighDrawdownPct = entryMeta?.entryLongHighDrawdownPct ?? null;
    position.rangeExitMom20Above = entryMeta?.rangeExitMom20Above ?? null;
    position.rangeMaxHoldBars = entryMeta?.rangeMaxHoldBars ?? null;
    position.peakPrice = entryPrice;
    position.peakTs = entryTs;
    position.partialExitTaken = false;
    position.partialExitQty = 0;
    position.partialExitTs = 0;
    position.partialExitPeakPrice = 0;
    position.buybackDone = false;
    tradeEvents.push({
        time: formatIso(entryTs),
        symbol,
        action: "enter",
        strategy_type: side,
        sub_variant: entryMeta?.subVariant || (side === "trend" ? "strict6" : "range-overlay"),
        alloc,
        price: entryPrice,
        qty,
        reason: entryReason,
        trade_id: tradeId,
    });
    return { cash, opened: true };
}

function isSmallWalletEntryGuardBlocked(symbol: string, availableEquity: number, options: HybridVariantOptions = {}) {
    const minEquity = options.smallWalletEntryGuardMinEquity;
    if (minEquity == null || minEquity <= 0 || availableEquity >= minEquity) return false;
    const allowed = new Set((options.smallWalletEntryGuardAllowedSymbols ?? []).map((item) => item.toUpperCase()));
    return !allowed.has(symbol.toUpperCase());
}

function currentPriceAt(raw: Candle1h[], ts: number) {
    const bar = getExecutionBar(raw, ts);
    return bar || raw.at(-1) || null;
}

function buildExecRawMap(bySymbol: Record<TradeSymbol, Candle1h[]>, ts: number) {
    return Object.fromEntries(
        ALL_SYMBOLS.map((symbol) => [symbol, currentPriceAt(bySymbol[symbol], ts)]),
    ) as Record<TradeSymbol, Candle1h | null>;
}

function pickAnnotatedRangeCandidate(
    snapshot: RegimeSnapshot,
    indicators: Record<TradeSymbol, IndicatorBar[]>,
    options: HybridVariantOptions,
    rangeSymbols: readonly (typeof TRADE_SYMBOLS[number])[],
    layerLabel: string,
    alloc: number,
) {
    const candidate = pickRangeCandidate(snapshot, indicators, rangeSymbols, options);
    if (!candidate) return null;
    return {
        ...candidate,
        subVariant: layerLabel,
        alloc,
        exitMom20Above: options.rangeExitMom20Above ?? 0.03,
        maxHoldBars: options.rangeMaxHoldBars ?? 16,
    };
}

async function evaluateHybridLiveDecisionFromFrames(
    mode: BacktestMode = "RETQ22",
    options: HybridVariantOptions = {},
    frames: FrameSet,
): Promise<HybridLiveDecision | null> {
    const { indicators, timeline } = frames;
    const ts = timeline.at(-1);
    if (!ts) return null;

    const previousTs = timeline.length > 1 ? timeline[timeline.length - 2] : null;
    const snapshot = buildRegimeSnapshot(ts, indicators);
    if (!snapshot) return null;

    const previousSnapshot = previousTs != null ? buildRegimeSnapshot(previousTs, indicators) : null;
    const previousEffectiveSnapshot = previousSnapshot
        ? applyVariantSnapshot(previousSnapshot, false, mode, options)
        : null;
    const effectiveSnapshot = withWeakMarketTrendBlockCooldown(
        applyVariantSnapshot(snapshot, Boolean(previousSnapshot?.weak2022Regime), mode, options),
        isWeakMarketTrendBlockActive(previousEffectiveSnapshot, options),
        options,
    );
    const rangeSymbols = options.rangeSymbols ?? RANGE_SYMBOLS;

    const tradeReady = mode === "BASELINE"
        ? effectiveSnapshot.trendAllowed
        : effectiveSnapshot.trendAllowed || effectiveSnapshot.rangeAllowed;

    const baseTrendOptions = options.strictExtraTrendIdleOnly
        ? { ...options, strictExtraTrendSymbols: undefined }
        : options;
    let trendCandidate = tradeReady && !options.disableTrend
        ? pickTrendCandidate(effectiveSnapshot, indicators, mode, baseTrendOptions)
        : null;

    let rangeCandidate: ReturnType<typeof pickAnnotatedRangeCandidate> | null = null;
    if (tradeReady && mode === "RETQ22") {
        const primaryRangeCandidate = effectiveSnapshot.rangeAllowed
            ? pickAnnotatedRangeCandidate(
                effectiveSnapshot,
                indicators,
                options,
                rangeSymbols,
                options.rangeEntryMode === "reclaim" ? "range-reclaim" : "range-primary",
                options.rangeAlloc ?? 0.5,
            )
            : null;
        const auxRangeYearAllowed =
            !options.auxRangeActiveYears ||
            options.auxRangeActiveYears.includes(new Date(ts).getUTCFullYear());
        const auxSnapshot = options.auxRangeIgnoreRegimeGate
            ? { ...effectiveSnapshot, rangeAllowed: true }
            : effectiveSnapshot;
        const auxRangeOptions = options.auxRangeSymbols && auxRangeYearAllowed
            ? {
                ...options,
                rangeEntryMode: options.auxRangeEntryMode ?? options.rangeEntryMode,
                rangeEntryBestMom20Below: options.auxRangeEntryBestMom20Below ?? options.rangeEntryBestMom20Below,
                rangeEntryBtcAdxBelow: options.auxRangeEntryBtcAdxBelow ?? options.rangeEntryBtcAdxBelow,
                rangeOverheatMax: options.auxRangeOverheatMax ?? options.rangeOverheatMax,
                rangeExitMom20Above: options.auxRangeExitMom20Above ?? options.rangeExitMom20Above,
                rangeMaxHoldBars: options.auxRangeMaxHoldBars ?? options.rangeMaxHoldBars,
            }
            : null;
        const auxRangeCandidate = auxRangeOptions
            ? pickAnnotatedRangeCandidate(
                auxSnapshot,
                indicators,
                auxRangeOptions,
                options.auxRangeSymbols!,
                `range-${options.auxRangeEntryMode ?? "aux"}`,
                options.auxRangeAlloc ?? options.rangeAlloc ?? 0.5,
            )
            : null;
        const aux2RangeYearAllowed =
            !options.aux2RangeActiveYears ||
            options.aux2RangeActiveYears.includes(new Date(ts).getUTCFullYear());
        const aux2Snapshot = options.aux2RangeIgnoreRegimeGate
            ? { ...effectiveSnapshot, rangeAllowed: true }
            : effectiveSnapshot;
        const aux2RangeOptions = options.aux2RangeSymbols && aux2RangeYearAllowed
            ? {
                ...options,
                rangeEntryMode: options.aux2RangeEntryMode ?? options.rangeEntryMode,
                rangeEntryBestMom20Below: options.aux2RangeEntryBestMom20Below ?? options.rangeEntryBestMom20Below,
                rangeEntryBtcAdxBelow: options.aux2RangeEntryBtcAdxBelow ?? options.rangeEntryBtcAdxBelow,
                rangeOverheatMax: options.aux2RangeOverheatMax ?? options.rangeOverheatMax,
                rangeExitMom20Above: options.aux2RangeExitMom20Above ?? options.rangeExitMom20Above,
                rangeMaxHoldBars: options.aux2RangeMaxHoldBars ?? options.rangeMaxHoldBars,
            }
            : null;
        const aux2RangeCandidate = aux2RangeOptions
            ? pickAnnotatedRangeCandidate(
                aux2Snapshot,
                indicators,
                aux2RangeOptions,
                options.aux2RangeSymbols!,
                `range-${options.aux2RangeEntryMode ?? "aux2"}`,
                options.aux2RangeAlloc ?? options.rangeAlloc ?? 0.5,
            )
            : null;

        rangeCandidate = [primaryRangeCandidate, auxRangeCandidate, aux2RangeCandidate]
            .filter((item): item is NonNullable<typeof item> => item !== null && item.eligible)
            .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))[0] ?? null;
    }

    if (
        options.strictExtraTrendIdleOnly &&
        tradeReady &&
        !trendCandidate?.eligible &&
        !rangeCandidate?.eligible &&
        !options.disableTrend
    ) {
        trendCandidate = pickStrictExtraTrendCandidate(effectiveSnapshot, indicators, options);
    }

    trendCandidate = maybePreferStrictExtraTrendCandidate(
        effectiveSnapshot,
        indicators,
        trendCandidate,
        options,
    );

    if (
        tradeReady &&
        options.idleBreakoutEntryWhileCash &&
        !trendCandidate?.eligible &&
        !rangeCandidate?.eligible &&
        isInAllowedWindow(ts, options.idleBreakoutAllowedWindows) &&
        (tradeReady || options.idleBreakoutAllowTradeGateOff === true)
    ) {
        const idleBreakoutTimeframe = options.idleBreakoutEntryTimeframe ?? "6h";
        const idleBreakoutFrames = await loadInstrumentFrames({
            startTs: ts - LIVE_DECISION_LOOKBACK_MS,
            endTs: liveFrameEndTs(idleBreakoutTimeframe),
            timeframe: idleBreakoutTimeframe,
            symbols: uniqueSymbols(["BTC", ...(options.idleBreakoutSymbols ?? [])]),
        });
        const idleTs = idleBreakoutFrames.timeline.at(-1);
        if (idleTs != null) {
            const idleBreakoutOptions: HybridVariantOptions = {
                ...baseTrendOptions,
                strictExtraTrendSymbols: undefined,
                trendBreakoutLookbackBars: options.idleBreakoutBreakoutLookbackBars !== undefined ? options.idleBreakoutBreakoutLookbackBars : options.trendBreakoutLookbackBars,
                trendBreakoutMinPct: options.idleBreakoutBreakoutMinPct !== undefined ? options.idleBreakoutBreakoutMinPct : options.trendBreakoutMinPct,
                trendDisableBreakoutSymbols: options.idleBreakoutBreakoutLookbackBars === null ? options.idleBreakoutSymbols : options.trendDisableBreakoutSymbols,
                trendMinVolumeRatio: options.idleBreakoutMinVolumeRatio ?? options.trendMinVolumeRatio,
                trendMinMomAccel: options.idleBreakoutMinMomAccel ?? options.trendMinMomAccel,
                trendMinEfficiencyRatio: options.idleBreakoutMinEfficiencyRatio ?? options.trendMinEfficiencyRatio,
                trendMinSmaDistancePct: options.trendMinSmaDistancePct,
                trendMinSmaDistancePctBySymbol: options.trendMinSmaDistancePctBySymbol,
                idleCashTrendContext: true,
                idleCashTrendAllowTrendGateOff: options.idleBreakoutAllowTradeGateOff ?? options.idleCashTrendAllowTrendGateOff,
            };
            const idleTrendCandidate = options.idleBreakoutSymbols?.length
                ? pickTrendCandidateForSymbols(
                    effectiveSnapshot,
                    idleBreakoutFrames.indicators,
                    options.idleBreakoutSymbols,
                    idleBreakoutOptions,
                )
                : pickTrendCandidate(
                    effectiveSnapshot,
                    idleBreakoutFrames.indicators,
                    mode,
                    idleBreakoutOptions,
                );
            if (idleTrendCandidate?.eligible) {
                trendCandidate = {
                    ...idleTrendCandidate,
                    reasons: [...idleTrendCandidate.reasons, "idle-breakout-entry", `timeframe-${idleBreakoutTimeframe}`],
                };
            }
        }
    }

    if (
        options.injSpringCashEntry &&
        !trendCandidate?.eligible &&
        !rangeCandidate?.eligible
    ) {
        const injSpringFrames = await loadInstrumentFrames({
            startTs: ts - LIVE_DECISION_LOOKBACK_MS,
            endTs: liveFrameEndTs(),
            timeframe: "1h",
            symbols: ["BTC", "SOL", "AVAX", "INJ", "DOGE", "UNI", "TWT", "ETH"],
        });
        const injSpringCandles = Object.fromEntries(
            Object.entries(injSpringFrames.bySymbol).map(([symbol, bars]) => [symbol, normalizeTo1hBars(bars)]),
        ) as Record<string, Candle1h[]>;
        const injSpringIndicators = Object.fromEntries(
            Object.entries(injSpringCandles).map(([symbol, bars]) => [symbol, buildInjSpringIndicators(bars)]),
        ) as Record<string, InjSpringIndicatorBar[]>;
        const injTs = injSpringFrames.timeline.at(-1);
        const injSpringCandidate = injTs != null
            ? pickInjSpringCashCandidate(
                injTs,
                injSpringCandles.INJ ?? [],
                injSpringIndicators.INJ ?? [],
                injSpringIndicators,
            )
            : null;
        const bar = latestIndicatorAtOrBefore(indicators.INJ, ts);
        if (injSpringCandidate && bar) {
            trendCandidate = {
                ...injSpringCandidate,
                bar,
                eligible: true,
                mom20: 0,
                mom80: 0,
                momAccel: 0,
                adx14: 0,
                volumeRatio: 0,
                efficiencyRatio: 0,
                recentHighDrawdownPct: 0,
                longHighDrawdownPct: 0,
                structureBreak: true,
                dowHigherHighLow: true,
                reasons: [...injSpringCandidate.reasons, "timeframe-1h"],
            };
        }
    }

    if (trendCandidate?.eligible) {
        return {
            ts,
            isoTime: formatIso(ts),
            reserveSymbol: RECLAIM_HYBRID_EXECUTION_PROFILE?.reserveSymbol ?? "USDT",
            regime: effectiveSnapshot,
            trendCandidate: {
                symbol: trendCandidate.symbol,
                score: trendCandidate.score,
                eligible: trendCandidate.eligible,
                reasons: trendCandidate.reasons,
            },
            rangeCandidate: rangeCandidate
                ? {
                    symbol: rangeCandidate.symbol,
                    score: rangeCandidate.score,
                    eligible: rangeCandidate.eligible,
                    reasons: rangeCandidate.reasons,
                    subVariant: rangeCandidate.subVariant,
                    alloc: rangeCandidate.alloc,
                    exitMom20Above: rangeCandidate.exitMom20Above,
                    maxHoldBars: rangeCandidate.maxHoldBars,
                }
                : null,
            desiredSymbol: trendCandidate.symbol,
            desiredSide: "trend",
            desiredAlloc: trendAllocForSymbol(trendCandidate.symbol, options),
            reason: `trend:${trendCandidate.reasons.join("|")}`,
        };
    }

    if (rangeCandidate?.eligible) {
        return {
            ts,
            isoTime: formatIso(ts),
            reserveSymbol: RECLAIM_HYBRID_EXECUTION_PROFILE?.reserveSymbol ?? "USDT",
            regime: effectiveSnapshot,
            trendCandidate: trendCandidate
                ? {
                    symbol: trendCandidate.symbol,
                    score: trendCandidate.score,
                    eligible: trendCandidate.eligible,
                    reasons: trendCandidate.reasons,
                }
                : null,
            rangeCandidate: {
                symbol: rangeCandidate.symbol,
                score: rangeCandidate.score,
                eligible: rangeCandidate.eligible,
                reasons: rangeCandidate.reasons,
                subVariant: rangeCandidate.subVariant,
                alloc: rangeCandidate.alloc,
                exitMom20Above: rangeCandidate.exitMom20Above,
                maxHoldBars: rangeCandidate.maxHoldBars,
            },
            desiredSymbol: rangeCandidate.symbol,
            desiredSide: "range",
            desiredAlloc: rangeCandidate.alloc ?? options.rangeAlloc ?? 0.5,
            reason: `${rangeCandidate.subVariant || "range"}:${rangeCandidate.reasons.join("|")}`,
        };
    }

    return {
        ts,
        isoTime: formatIso(ts),
        reserveSymbol: "USDT",
        regime: effectiveSnapshot,
        trendCandidate: trendCandidate
            ? {
                symbol: trendCandidate.symbol,
                score: trendCandidate.score,
                eligible: trendCandidate.eligible,
                reasons: trendCandidate.reasons,
            }
            : null,
        rangeCandidate: rangeCandidate
            ? {
                symbol: rangeCandidate.symbol,
                score: rangeCandidate.score,
                eligible: rangeCandidate.eligible,
                reasons: rangeCandidate.reasons,
                subVariant: rangeCandidate.subVariant,
                alloc: rangeCandidate.alloc,
                exitMom20Above: rangeCandidate.exitMom20Above,
                maxHoldBars: rangeCandidate.maxHoldBars,
            }
            : null,
        desiredSymbol: "USDT",
        desiredSide: "cash",
        desiredAlloc: 0,
        reason: "reserve-wait",
    };
}

export async function evaluateHybridLiveDecision(
    mode: BacktestMode = "RETQ22",
    options: HybridVariantOptions = {},
): Promise<HybridLiveDecision | null> {
    const timeframe = options.trendDecisionTimeframe ?? "12h";
    const endTs = liveFrameEndTs(timeframe);
    const frames = await loadInstrumentFrames({
        startTs: endTs - LIVE_DECISION_LOOKBACK_MS,
        endTs,
        timeframe,
        offsetHours: options.trendDecisionOffsetHours ?? 0,
        symbols: liveUniverseSymbols(options),
    });
    return evaluateHybridLiveDecisionFromFrames(mode, options, frames);
}

export async function evaluateHybridLiveDecisionDetails(
    mode: BacktestMode = "RETQ22",
    options: HybridVariantOptions = {},
): Promise<HybridLiveDecisionDetails | null> {
    const timeframe = options.trendDecisionTimeframe ?? "12h";
    const endTs = liveFrameEndTs(timeframe);
    const frames = await loadInstrumentFrames({
        startTs: endTs - LIVE_DECISION_LOOKBACK_MS,
        endTs,
        timeframe,
        offsetHours: options.trendDecisionOffsetHours ?? 0,
        symbols: liveUniverseSymbols(options),
    });
    const { indicators, timeline } = frames;
    const ts = timeline.at(-1);
    if (!ts) return null;

    const previousTs = timeline.length > 1 ? timeline[timeline.length - 2] : null;
    const snapshot = buildRegimeSnapshot(ts, indicators);
    if (!snapshot) return null;

    const previousSnapshot = previousTs != null ? buildRegimeSnapshot(previousTs, indicators) : null;
    const previousEffectiveSnapshot = previousSnapshot
        ? applyVariantSnapshot(previousSnapshot, false, mode, options)
        : null;
    const effectiveSnapshot = withWeakMarketTrendBlockCooldown(
        applyVariantSnapshot(snapshot, Boolean(previousSnapshot?.weak2022Regime), mode, options),
        isWeakMarketTrendBlockActive(previousEffectiveSnapshot, options),
        options,
    );
    const decision = await evaluateHybridLiveDecisionFromFrames(mode, options, frames);
    if (!decision) return null;

    return {
        decision,
        trendEvaluations: buildTrendEvaluationsForSymbols(
            effectiveSnapshot,
            indicators,
            trendUniverseSymbolsForSnapshot(ts, options),
            options,
        ),
    };
}

export async function analyzeHybridDecisionWindow(
    mode: BacktestMode = "RETQ22",
    options: HybridVariantOptions = {},
): Promise<HybridDecisionWindowPoint[]> {
    const { indicators, timeline } = await loadInstrumentFrames({
        startTs: options.backtestStartTs,
        endTs: options.backtestEndTs,
        timeframe: options.trendDecisionTimeframe ?? "12h",
        offsetHours: options.trendDecisionOffsetHours ?? 0,
        symbols: liveUniverseSymbols(options),
    });

    const out: HybridDecisionWindowPoint[] = [];
    for (let index = 0; index < timeline.length; index += 1) {
        const ts = timeline[index];
        const previousTs = index > 0 ? timeline[index - 1] : null;
        const snapshot = buildRegimeSnapshot(ts, indicators);
        if (!snapshot) continue;

        const previousSnapshot = previousTs != null ? buildRegimeSnapshot(previousTs, indicators) : null;
        const effectiveSnapshot = applyVariantSnapshot(snapshot, Boolean(previousSnapshot?.weak2022Regime), mode, options);
        const rangeSymbols = options.rangeSymbols ?? RANGE_SYMBOLS;

        const tradeReady = mode === "BASELINE"
            ? effectiveSnapshot.trendAllowed
            : effectiveSnapshot.trendAllowed || effectiveSnapshot.rangeAllowed;

        const baseTrendOptions = options.strictExtraTrendIdleOnly
            ? { ...options, strictExtraTrendSymbols: undefined }
            : options;
        const idleTrendOptions = withIdleCashTrendOverrides(baseTrendOptions);
        let trendCandidate = tradeReady && !options.disableTrend
            ? pickTrendCandidate(effectiveSnapshot, indicators, mode, idleTrendOptions)
            : null;

        let rangeCandidate: ReturnType<typeof pickAnnotatedRangeCandidate> | null = null;
        if (tradeReady && mode === "RETQ22") {
            const primaryRangeCandidate = effectiveSnapshot.rangeAllowed
                ? pickAnnotatedRangeCandidate(
                    effectiveSnapshot,
                    indicators as Record<TradeSymbol, IndicatorBar[]>,
                    options,
                    rangeSymbols,
                    options.rangeEntryMode === "reclaim" ? "range-reclaim" : "range-primary",
                    options.rangeAlloc ?? 0.5,
                )
                : null;
            const auxRangeYearAllowed =
                !options.auxRangeActiveYears ||
                options.auxRangeActiveYears.includes(new Date(ts).getUTCFullYear());
            const auxSnapshot = options.auxRangeIgnoreRegimeGate
                ? { ...effectiveSnapshot, rangeAllowed: true }
                : effectiveSnapshot;
            const auxRangeOptions = options.auxRangeSymbols && auxRangeYearAllowed
                ? {
                    ...options,
                    rangeEntryMode: options.auxRangeEntryMode ?? options.rangeEntryMode,
                    rangeEntryBestMom20Below: options.auxRangeEntryBestMom20Below ?? options.rangeEntryBestMom20Below,
                    rangeEntryBtcAdxBelow: options.auxRangeEntryBtcAdxBelow ?? options.rangeEntryBtcAdxBelow,
                    rangeOverheatMax: options.auxRangeOverheatMax ?? options.rangeOverheatMax,
                    rangeExitMom20Above: options.auxRangeExitMom20Above ?? options.rangeExitMom20Above,
                    rangeMaxHoldBars: options.auxRangeMaxHoldBars ?? options.rangeMaxHoldBars,
                }
                : null;
            const auxRangeCandidate = auxRangeOptions
                ? pickAnnotatedRangeCandidate(
                    auxSnapshot,
                    indicators as Record<TradeSymbol, IndicatorBar[]>,
                    auxRangeOptions,
                    options.auxRangeSymbols!,
                    `range-${options.auxRangeEntryMode ?? "aux"}`,
                    options.auxRangeAlloc ?? options.rangeAlloc ?? 0.5,
                )
                : null;
            const aux2RangeYearAllowed =
                !options.aux2RangeActiveYears ||
                options.aux2RangeActiveYears.includes(new Date(ts).getUTCFullYear());
            const aux2Snapshot = options.aux2RangeIgnoreRegimeGate
                ? { ...effectiveSnapshot, rangeAllowed: true }
                : effectiveSnapshot;
            const aux2RangeOptions = options.aux2RangeSymbols && aux2RangeYearAllowed
                ? {
                    ...options,
                    rangeEntryMode: options.aux2RangeEntryMode ?? options.rangeEntryMode,
                    rangeEntryBestMom20Below: options.aux2RangeEntryBestMom20Below ?? options.rangeEntryBestMom20Below,
                    rangeEntryBtcAdxBelow: options.aux2RangeEntryBtcAdxBelow ?? options.rangeEntryBtcAdxBelow,
                    rangeOverheatMax: options.aux2RangeOverheatMax ?? options.rangeOverheatMax,
                    rangeExitMom20Above: options.aux2RangeExitMom20Above ?? options.rangeExitMom20Above,
                    rangeMaxHoldBars: options.aux2RangeMaxHoldBars ?? options.rangeMaxHoldBars,
                }
                : null;
            const aux2RangeCandidate = aux2RangeOptions
                ? pickAnnotatedRangeCandidate(
                    aux2Snapshot,
                    indicators as Record<TradeSymbol, IndicatorBar[]>,
                    aux2RangeOptions,
                    options.aux2RangeSymbols!,
                    `range-${options.aux2RangeEntryMode ?? "aux2"}`,
                    options.aux2RangeAlloc ?? options.rangeAlloc ?? 0.5,
                )
                : null;

            rangeCandidate = [primaryRangeCandidate, auxRangeCandidate, aux2RangeCandidate]
                .filter((item): item is NonNullable<typeof item> => item !== null && item.eligible)
                .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))[0] ?? null;
        }

        if (
            options.strictExtraTrendIdleOnly &&
            tradeReady &&
            !trendCandidate?.eligible &&
            !rangeCandidate?.eligible &&
            !options.disableTrend
        ) {
            trendCandidate = pickStrictExtraTrendCandidate(effectiveSnapshot, indicators, options);
        }

        trendCandidate = maybePreferStrictExtraTrendCandidate(
            effectiveSnapshot,
            indicators,
            trendCandidate,
            options,
        );

        const decision: HybridLiveDecision = trendCandidate?.eligible
            ? {
                ts,
                isoTime: formatIso(ts),
                reserveSymbol: RECLAIM_HYBRID_EXECUTION_PROFILE?.reserveSymbol ?? "USDT",
                regime: effectiveSnapshot,
                trendCandidate: {
                    symbol: trendCandidate.symbol,
                    score: trendCandidate.score,
                    eligible: trendCandidate.eligible,
                    reasons: trendCandidate.reasons,
                },
                rangeCandidate: rangeCandidate
                    ? {
                        symbol: rangeCandidate.symbol,
                        score: rangeCandidate.score,
                        eligible: rangeCandidate.eligible,
                        reasons: rangeCandidate.reasons,
                        subVariant: rangeCandidate.subVariant,
                        alloc: rangeCandidate.alloc,
                        exitMom20Above: rangeCandidate.exitMom20Above,
                        maxHoldBars: rangeCandidate.maxHoldBars,
                    }
                    : null,
                desiredSymbol: trendCandidate.symbol,
                desiredSide: "trend",
                desiredAlloc: trendAllocForSymbol(trendCandidate.symbol, options),
                reason: `trend:${trendCandidate.reasons.join("|")}`,
            }
            : rangeCandidate?.eligible
                ? {
                    ts,
                    isoTime: formatIso(ts),
                    reserveSymbol: RECLAIM_HYBRID_EXECUTION_PROFILE?.reserveSymbol ?? "USDT",
                    regime: effectiveSnapshot,
                    trendCandidate: trendCandidate
                        ? {
                            symbol: trendCandidate.symbol,
                            score: trendCandidate.score,
                            eligible: trendCandidate.eligible,
                            reasons: trendCandidate.reasons,
                        }
                        : null,
                    rangeCandidate: {
                        symbol: rangeCandidate.symbol,
                        score: rangeCandidate.score,
                        eligible: rangeCandidate.eligible,
                        reasons: rangeCandidate.reasons,
                        subVariant: rangeCandidate.subVariant,
                        alloc: rangeCandidate.alloc,
                        exitMom20Above: rangeCandidate.exitMom20Above,
                        maxHoldBars: rangeCandidate.maxHoldBars,
                    },
                    desiredSymbol: rangeCandidate.symbol,
                    desiredSide: "range",
                    desiredAlloc: rangeCandidate.alloc ?? options.rangeAlloc ?? 0.5,
                    reason: `${rangeCandidate.subVariant || "range"}:${rangeCandidate.reasons.join("|")}`,
                }
                : {
                    ts,
                    isoTime: formatIso(ts),
                    reserveSymbol: "USDT",
                    regime: effectiveSnapshot,
                    trendCandidate: trendCandidate
                        ? {
                            symbol: trendCandidate.symbol,
                            score: trendCandidate.score,
                            eligible: trendCandidate.eligible,
                            reasons: trendCandidate.reasons,
                        }
                        : null,
                    rangeCandidate: rangeCandidate
                        ? {
                            symbol: rangeCandidate.symbol,
                            score: rangeCandidate.score,
                            eligible: rangeCandidate.eligible,
                            reasons: rangeCandidate.reasons,
                            subVariant: rangeCandidate.subVariant,
                            alloc: rangeCandidate.alloc,
                            exitMom20Above: rangeCandidate.exitMom20Above,
                            maxHoldBars: rangeCandidate.maxHoldBars,
                        }
                        : null,
                    desiredSymbol: "USDT",
                    desiredSide: "cash",
                    desiredAlloc: 0,
                    reason: "reserve-wait",
                };

        const trendEvaluations = buildTrendEvaluationsForSymbols(
            effectiveSnapshot,
            indicators,
            trendUniverseSymbolsForSnapshot(ts, options),
            options,
        );

        out.push({
            ts,
            isoTime: formatIso(ts),
            decision,
            trendEvaluations,
        });
    }

    return out;
}

export async function runHybridBacktest(
    mode: BacktestMode,
    options: HybridVariantOptions = {},
) {
    const baselinePreset = selectStrategyPreset("A_BALANCE");
    const decisionTimeframe = options.trendDecisionTimeframe ?? "12h";
    const trendDecisionOffsetHours = options.trendDecisionOffsetHours ?? 0;
    const exitCheckTimeframe = options.trendExitCheckTimeframe ?? decisionTimeframe;
    const strictExtraTrendSymbols = uniqueSymbols(options.strictExtraTrendSymbols ?? []);
    const strictExtraDecisionTimeframe = options.strictExtraTrendDecisionTimeframe ?? decisionTimeframe;
    const strictExtraExitCheckTimeframe = options.strictExtraTrendExitCheckTimeframe ?? exitCheckTimeframe;
    const strictExtraReentryTimeframe = options.strictExtraTrendReentryTimeframe ?? strictExtraDecisionTimeframe;
    const idleBreakoutTimeframe = options.idleBreakoutEntryTimeframe ?? "6h";
    const idleNightBreakoutTimeframe = options.idleNightBreakoutEntryTimeframe ?? idleBreakoutTimeframe;
    const penguOffRotationTimeframe = options.penguOffRotationTimeframe ?? "1h";
    const penguStrongOverrideTimeframe = options.penguStrongOverrideTimeframe ?? "15m";
    const solWaveOverrideTimeframe = options.solWaveOverrideTimeframe ?? "1h";
    const extraUniverseSymbols = uniqueSymbols([
        ...strictExtraTrendSymbols,
        ...(options.expandedTrendSymbols ?? []),
        ...(options.idleBreakoutSymbols ?? []),
        ...(options.idleNightBreakoutSymbols ?? []),
        ...(options.injSpringCashEntry ? ["BTC", "SOL", "AVAX", "INJ", "DOGE", "UNI", "TWT", "ETH"] : []),
        ...(options.penguOffRotationSymbols ?? []),
        ...(options.penguStrongOverrideSymbols ?? []),
        ...(options.penguStrongOverrideCurrentSymbols ?? []),
        ...(options.solWaveOverrideEntry ? ["SOL"] : []),
        ...(options.solWaveOverrideCurrentSymbols ?? []),
    ]);
    const strictUniverseSymbols = extraUniverseSymbols.length
        ? uniqueSymbols([...ALL_SYMBOLS, ...extraUniverseSymbols])
        : null;
    const backtestStartTs = options.backtestStartTs;
    const backtestEndTs = options.backtestEndTs;
    const executionStartTs = options.backtestExecutionStartTs ?? backtestStartTs ?? -Infinity;
    const initialEquity = options.initialEquity && options.initialEquity > 0 ? options.initialEquity : BASE_EQUITY;
    const rawInterval = shouldLoad15mRaw(options) ? "15m" : "1h";
    const frames = await loadInstrumentFrames({
        startTs: backtestStartTs,
        endTs: backtestEndTs,
        timeframe: decisionTimeframe,
        offsetHours: trendDecisionOffsetHours,
        interval: rawInterval,
        symbols: strictUniverseSymbols ?? undefined,
    });
    const bySymbol: Record<string, Candle1h[]> = frames.bySymbol;
    const indicators: Record<string, IndicatorBar[]> = frames.indicators;
    const timeline = frames.timeline;
    const exitIndicators = exitCheckTimeframe === decisionTimeframe
        ? indicators
        : strictUniverseSymbols
            ? buildCachedIndicatorsForUniverseByTimeframe(bySymbol, exitCheckTimeframe, trendDecisionOffsetHours)
            : buildCachedIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, exitCheckTimeframe, trendDecisionOffsetHours);
    const strictExtraDecisionIndicators = strictExtraTrendSymbols.length && strictExtraDecisionTimeframe !== decisionTimeframe
        ? (strictUniverseSymbols
            ? buildCachedIndicatorsForUniverseByTimeframe(bySymbol, strictExtraDecisionTimeframe, trendDecisionOffsetHours)
            : buildCachedIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, strictExtraDecisionTimeframe, trendDecisionOffsetHours))
        : indicators;
    const strictExtraExitIndicators = strictExtraTrendSymbols.length && strictExtraExitCheckTimeframe !== exitCheckTimeframe
        ? (strictUniverseSymbols
            ? buildCachedIndicatorsForUniverseByTimeframe(bySymbol, strictExtraExitCheckTimeframe, trendDecisionOffsetHours)
            : buildCachedIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, strictExtraExitCheckTimeframe, trendDecisionOffsetHours))
        : exitIndicators;
    const strictExtraReentryIndicators = options.strictExtraTrendReentryAfterExitSymbols?.length && strictExtraReentryTimeframe !== strictExtraDecisionTimeframe
        ? (strictUniverseSymbols
            ? buildCachedIndicatorsForUniverseByTimeframe(bySymbol, strictExtraReentryTimeframe, trendDecisionOffsetHours)
            : buildCachedIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, strictExtraReentryTimeframe, trendDecisionOffsetHours))
        : strictExtraDecisionIndicators;
    const exitTimeline = exitCheckTimeframe === decisionTimeframe
        ? timeline
        : exitIndicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts);
    const strictExtraDecisionTimeline = strictExtraTrendSymbols.length
        ? strictExtraDecisionIndicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts)
        : timeline;
    const strictExtraExitTimeline = strictExtraTrendSymbols.length
        ? strictExtraExitIndicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts)
        : exitTimeline;
    const strictExtraReentryTimeline = options.strictExtraTrendReentryAfterExitSymbols?.length
        ? strictExtraReentryIndicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts)
        : [];
    const fridayDecisionIndicators = options.fridayDecisionTimeframe
        ? (strictUniverseSymbols
            ? buildCachedIndicatorsForUniverseByTimeframe(bySymbol, options.fridayDecisionTimeframe, trendDecisionOffsetHours)
            : buildCachedIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, options.fridayDecisionTimeframe, trendDecisionOffsetHours))
        : null;
    const fridayDecisionTimeline = fridayDecisionIndicators
        ? fridayDecisionIndicators.BTC.filter((bar) => bar.ready && isJstFriday(bar.ts)).map((bar) => bar.ts)
        : [];
    const nightDecisionIndicators = options.nightDecisionTimeframe
        ? (strictUniverseSymbols
            ? buildCachedIndicatorsForUniverseByTimeframe(bySymbol, options.nightDecisionTimeframe, trendDecisionOffsetHours)
            : buildCachedIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, options.nightDecisionTimeframe, trendDecisionOffsetHours))
        : null;
    const nightDecisionTimeline = nightDecisionIndicators
        ? nightDecisionIndicators.BTC
            .filter((bar) => bar.ready && isJstHourWindow(
                bar.ts,
                options.nightDecisionJstStartHour ?? 20,
                options.nightDecisionJstEndHour ?? 3,
            ))
            .map((bar) => bar.ts)
        : [];
    const idleBreakoutIndicators = options.idleBreakoutEntryWhileCash && idleBreakoutTimeframe !== decisionTimeframe
        ? (await loadInstrumentFrames({
            startTs: backtestStartTs,
            endTs: backtestEndTs,
            timeframe: idleBreakoutTimeframe,
            interval: rawInterval,
            symbols: uniqueSymbols(["BTC", ...(options.idleBreakoutSymbols ?? [])]),
        })).indicators
        : indicators;
    const idleBreakoutTimeline = options.idleBreakoutEntryWhileCash
        ? idleBreakoutIndicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts)
        : [];
    const idleNightBreakoutIndicators = options.idleNightBreakoutEntryWhileCash && idleNightBreakoutTimeframe !== decisionTimeframe
        ? (await loadInstrumentFrames({
            startTs: backtestStartTs,
            endTs: backtestEndTs,
            timeframe: idleNightBreakoutTimeframe,
            interval: rawInterval,
            symbols: uniqueSymbols(["BTC", ...(options.idleNightBreakoutSymbols ?? [])]),
        })).indicators
        : indicators;
    const idleNightBreakoutTimeline = options.idleNightBreakoutEntryWhileCash
        ? idleNightBreakoutIndicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts)
        : [];
    const injSpringSymbols = ["BTC", "SOL", "AVAX", "INJ", "DOGE", "UNI", "TWT", "ETH"];
    const injSpringCandles = options.injSpringCashEntry
        ? Object.fromEntries(
            injSpringSymbols
                .filter((symbol) => bySymbol[symbol]?.length)
                .map((symbol) => [symbol, normalizeTo1hBars(bySymbol[symbol])]),
        ) as Record<string, Candle1h[]>
        : {};
    const injSpringIndicators = options.injSpringCashEntry
        ? Object.fromEntries(
            Object.entries(injSpringCandles).map(([symbol, bars]) => [symbol, buildInjSpringIndicators(bars)]),
        ) as Record<string, InjSpringIndicatorBar[]>
        : {};
    const injSpringTimeline = options.injSpringCashEntry
        ? (injSpringIndicators.INJ ?? []).filter((bar) => bar.mom120 !== 0).map((bar) => bar.ts)
        : [];
    const penguOffRotationIndicators = options.penguOffRotationEntry && penguOffRotationTimeframe !== decisionTimeframe
        ? (penguOffRotationTimeframe === "15m"
            ? (await loadInstrumentFrames({
                startTs: backtestStartTs,
                endTs: backtestEndTs,
                timeframe: penguOffRotationTimeframe,
                interval: rawInterval,
                symbols: uniqueSymbols([
                    "BTC",
                    ...(options.penguOffRotationSymbols ?? []),
                    ...(options.penguOffRotationCurrentSymbols ?? []),
                ]),
            })).indicators
            : (strictUniverseSymbols
                ? buildCachedIndicatorsForUniverseByTimeframe(bySymbol, penguOffRotationTimeframe, trendDecisionOffsetHours)
                : buildCachedIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, penguOffRotationTimeframe, trendDecisionOffsetHours)))
        : indicators;
    const penguOffRotationTimeline = options.penguOffRotationEntry
        ? penguOffRotationIndicators.BTC
            .filter((bar) => bar.ready && penguOffRotationAnySymbolAllowedAt(bar.ts, options))
            .map((bar) => bar.ts)
        : [];
    const penguStrongOverrideIndicators = options.penguStrongOverrideEntry && penguStrongOverrideTimeframe !== decisionTimeframe
        ? (penguStrongOverrideTimeframe === "15m"
            ? (await loadInstrumentFrames({
                startTs: backtestStartTs,
                endTs: backtestEndTs,
                timeframe: penguStrongOverrideTimeframe,
                interval: rawInterval,
                symbols: uniqueSymbols([
                    "BTC",
                    ...(options.penguStrongOverrideSymbols ?? []),
                    ...(options.penguStrongOverrideCurrentSymbols ?? []),
                ]),
            })).indicators
            : (strictUniverseSymbols
                ? buildCachedIndicatorsForUniverseByTimeframe(bySymbol, penguStrongOverrideTimeframe, trendDecisionOffsetHours)
                : buildCachedIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, penguStrongOverrideTimeframe, trendDecisionOffsetHours)))
        : indicators;
    const penguStrongOverrideTimeline = options.penguStrongOverrideEntry
        ? penguStrongOverrideIndicators.BTC
            .filter((bar) => bar.ready && isInAllowedWindow(bar.ts, options.penguStrongOverrideAllowedWindows))
            .map((bar) => bar.ts)
        : [];
    const solWaveOverrideIndicators = options.solWaveOverrideEntry && solWaveOverrideTimeframe !== decisionTimeframe
        ? (strictUniverseSymbols
            ? buildCachedIndicatorsForUniverseByTimeframe(bySymbol, solWaveOverrideTimeframe, trendDecisionOffsetHours)
            : buildCachedIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, solWaveOverrideTimeframe, trendDecisionOffsetHours))
        : indicators;
    const solWaveOverrideTimeline = options.solWaveOverrideEntry
        ? solWaveOverrideIndicators.BTC
            .filter((bar) => bar.ready && isInAllowedWindow(bar.ts, options.solWaveOverrideAllowedWindows))
            .map((bar) => bar.ts)
        : [];
    const loopTimeline = [...new Set([
        ...exitTimeline,
        ...strictExtraExitTimeline,
        ...strictExtraDecisionTimeline,
        ...strictExtraReentryTimeline,
        ...fridayDecisionTimeline,
        ...nightDecisionTimeline,
        ...penguOffRotationTimeline,
        ...penguStrongOverrideTimeline,
        ...solWaveOverrideTimeline,
        ...injSpringTimeline,
    ])]
        .sort((left, right) => left - right);
    const mergedLoopTimeline = options.idleBreakoutEntryWhileCash || options.idleNightBreakoutEntryWhileCash
        ? [...new Set([...loopTimeline, ...idleBreakoutTimeline, ...idleNightBreakoutTimeline])].sort((left, right) => left - right)
        : loopTimeline;
    const decisionIndexByTs = new Map(timeline.map((ts, index) => [ts, index]));
    const exitSet = new Set(exitTimeline);
    const strictExtraDecisionSet = new Set(strictExtraDecisionTimeline);
    const strictExtraExitSet = new Set(strictExtraExitTimeline);
    const strictExtraReentrySet = new Set(strictExtraReentryTimeline);
    const fridayDecisionSet = new Set(fridayDecisionTimeline);
    const nightDecisionSet = new Set(nightDecisionTimeline);
    const tradeEvents: TradeEventRow[] = [];
    const tradePairs: TradePairRow[] = [];
    const equityCurve: EquityPoint[] = [];
    const monthlyBuckets = new Map<string, EquityPoint[]>();
    const annualBuckets = new Map<string, EquityPoint[]>();
    const position = createEmptyPosition();
    let cash = initialEquity;
    let tradeCount = 0;
    let highWaterMark = initialEquity;
    let lastTrendCandidate: string | null = null;
    let trendLeadSymbol: string | null = null;
    let trendLeadCount = 0;
    let strictExtraLeadSymbol: string | null = null;
    let strictExtraLeadCount = 0;
    let priorWeak2022Regime = false;
    let priorWeakMarketTrendBlockActive = false;
    let lastStrictExtraExitSymbol: string | null = null;
    let lastStrictExtraExitIndex = -Infinity;
    let lastStrictExtraExitReason: string | null = null;
    let lastIdleEarlyTrailExit: {
        symbol: string;
        price: number;
        peakPrice: number;
        ts: number;
        index: number;
        entryBarMs: number;
    } | null = null;
    let lastIdlePartialRunnerExit: {
        symbol: string;
        price: number;
        ts: number;
        index: number;
        entryBarMs: number;
        alloc: number;
    } | null = null;
    const activeYears = options.activeYears ? new Set(options.activeYears) : null;

    const idleBreakoutDecisionSet = new Set(idleBreakoutTimeline);
    const idleNightBreakoutDecisionSet = new Set(idleNightBreakoutTimeline);
    const penguOffRotationDecisionSet = new Set(penguOffRotationTimeline);
    const penguStrongOverrideDecisionSet = new Set(penguStrongOverrideTimeline);
    const solWaveOverrideDecisionSet = new Set(solWaveOverrideTimeline);
    const injSpringDecisionSet = new Set(injSpringTimeline);
    const currentBarsCursor = createIndicatorCursorMap(exitIndicators as Record<string, IndicatorBar[]>);
    const execRawCursor = createExecutionRawCursorMap(bySymbol);

    for (let index = 0; index < mergedLoopTimeline.length; index += 1) {
        const ts = mergedLoopTimeline[index];
        if (activeYears && !activeYears.has(new Date(ts).getUTCFullYear())) {
            continue;
        }
        const isFridayDecisionBar = fridayDecisionSet.has(ts);
        const isNightDecisionBar = nightDecisionSet.has(ts);
        const activeDecisionIndicators = isNightDecisionBar && nightDecisionIndicators
            ? nightDecisionIndicators
            : isFridayDecisionBar && fridayDecisionIndicators
                ? fridayDecisionIndicators
                : indicators;
        const snapshot = buildRegimeSnapshot(ts, activeDecisionIndicators as Record<TradeSymbol, IndicatorBar[]>);
        if (!snapshot) continue;
        const persistentWeak2022Regime = snapshot.weak2022Regime && priorWeak2022Regime;
        const rawEffectiveSnapshot = applyVariantSnapshot(snapshot, priorWeak2022Regime, mode, options);
        const effectiveSnapshot = withWeakMarketTrendBlockCooldown(
            rawEffectiveSnapshot,
            priorWeakMarketTrendBlockActive,
            options,
        );
        if (ts < executionStartTs) {
            priorWeak2022Regime = snapshot.weak2022Regime;
            priorWeakMarketTrendBlockActive = isWeakMarketTrendBlockActive(rawEffectiveSnapshot, options);
            continue;
        }
        const rangeSymbols = options.rangeSymbols ?? RANGE_SYMBOLS;
        const isStrictExtraDecisionBar = strictExtraDecisionSet.has(ts) || isFridayDecisionBar || isNightDecisionBar;
        const isStrictExtraExitBar = strictExtraExitSet.has(ts);
        const isStrictExtraReentryBar = strictExtraReentrySet.has(ts);

        const currentBars = currentBarsCursor.at(ts);
        const decisionIndex = decisionIndexByTs.get(ts);
        const isDecisionBar = decisionIndex != null || isFridayDecisionBar || isNightDecisionBar;
        const isIdleBreakoutDecisionBar = idleBreakoutDecisionSet.has(ts);
        const isIdleNightBreakoutDecisionBar = idleNightBreakoutDecisionSet.has(ts);
        const isInjSpringDecisionBar = injSpringDecisionSet.has(ts);
        const rebalance = decisionIndex != null && decisionIndex % REBALANCE_BARS === 0;
        const executionIndex = index;

        const execRaw = execRawCursor.at(ts);
        const currentPositionRaw = position.symbol ? execRaw[position.symbol] : null;
        const markPrice = position.symbol ? (currentPositionRaw?.open || position.entryPrice) : 0;
        const equity = markToMarket(position.qty, markPrice, cash, baselinePreset.feeRate);
        highWaterMark = Math.max(highWaterMark, equity);
        const drawdownPct = highWaterMark > 0 ? ((equity / highWaterMark) - 1) * 100 : 0;
        const shouldUpdatePeakPrice =
            !!position.side && !!position.symbol && (
                (isIdleBreakoutEntry(position) && isIdleBreakoutDecisionBar)
                || (isInjSpringCashEntry(position) && isInjSpringDecisionBar)
                || (
                    !isIdleBreakoutEntry(position)
                    && !isInjSpringCashEntry(position)
                    && (
                        (position.symbol && isStrictExtraTrendSymbol(position.symbol, options) && (isStrictExtraDecisionBar || isStrictExtraExitBar))
                        || ((!position.symbol || !isStrictExtraTrendSymbol(position.symbol, options)) && (isDecisionBar || exitSet.has(ts)))
                    )
                )
            );
        if (shouldUpdatePeakPrice && currentPositionRaw) {
            const nextPeakPrice = Math.max(position.peakPrice || position.entryPrice, currentPositionRaw.high || currentPositionRaw.close || position.entryPrice);
            if (nextPeakPrice > (position.peakPrice || 0)) {
                position.peakPrice = nextPeakPrice;
                position.peakTs = ts;
            }
        }

        if (
            position.side &&
            position.symbol &&
            isStrictExtraTrendSymbol(position.symbol, options) &&
            !isInAllowedWindow(ts, options.strictExtraTrendAllowedWindows)
        ) {
            cash = exitPosition(
                position,
                currentPositionRaw?.open || position.entryPrice,
                ts,
                executionIndex,
                "extra-window-end",
                cash,
                tradeEvents,
                tradePairs,
                baselinePreset.feeRate,
                options,
            );
        }

        const drawdownEntryBlocked =
            options.portfolioDrawdownEntryBlockPct != null &&
            drawdownPct <= options.portfolioDrawdownEntryBlockPct;
        const tradeReady = !drawdownEntryBlocked && (mode === "BASELINE"
            ? effectiveSnapshot.trendAllowed
            : effectiveSnapshot.trendAllowed || effectiveSnapshot.rangeAllowed);

        if (position.side && (exitSet.has(ts) || isStrictExtraExitBar || isDecisionBar || isIdleBreakoutDecisionBar || isInjSpringDecisionBar)) {
            const currentBar = position.symbol
                ? (
                    isStrictExtraTrendSymbol(position.symbol, options) && isStrictExtraExitBar
                        ? latestIndicatorAtOrBefore((strictExtraExitIndicators as Record<string, IndicatorBar[]>)[position.symbol], ts)
                        : currentBars[position.symbol]
                )
                : null;
            const shouldEvaluateExit =
                !!position.side && (
                    (isIdleBreakoutEntry(position) && isIdleBreakoutDecisionBar)
                    || (isInjSpringCashEntry(position) && isInjSpringDecisionBar)
                    || (
                        !isIdleBreakoutEntry(position)
                        && !isInjSpringCashEntry(position)
                        && (
                            (position.symbol && isStrictExtraTrendSymbol(position.symbol, options) && isStrictExtraExitBar)
                            || (!position.symbol || !isStrictExtraTrendSymbol(position.symbol, options)) && exitSet.has(ts)
                        )
                    )
                );
            if (currentBar && shouldEvaluateExit) {
                const positionSymbol = position.symbol ?? "";
                const exitReason = buildExitReason(
                    effectiveSnapshot,
                    currentBar,
                    position,
                    mode,
                    position.side,
                    position.entryTs,
                    ts,
                    position.entryBarMs,
                    persistentWeak2022Regime,
                    options,
                );
                const strictExtraTrailActivationPct = symbolOverrideNumber(
                    options.strictExtraTrendTrailActivationPctBySymbol,
                    positionSymbol,
                    options.strictExtraTrendTrailActivationPct,
                );
                let strictExtraTrailRetracePct = symbolOverrideNumber(
                    options.strictExtraTrendTrailRetracePctBySymbol,
                    positionSymbol,
                    options.strictExtraTrendTrailRetracePct,
                );
                let effectiveStrictExtraTrailActivationPct = strictExtraTrailActivationPct;
                const strictExtraPositionSeries = positionSymbol
                    ? (isStrictExtraTrendSymbol(positionSymbol, options) && isStrictExtraExitBar
                        ? (strictExtraExitIndicators as Record<string, IndicatorBar[]>)[positionSymbol]
                        : (exitIndicators as Record<string, IndicatorBar[]>)[positionSymbol])
                    : null;
                const strictExtraPositionIndex = strictExtraPositionSeries
                    ? latestIndicatorIndexAtOrBefore(strictExtraPositionSeries, ts)
                    : -1;
                const strictExtraPositionEfficiency = strictExtraPositionSeries && strictExtraPositionIndex >= 0
                    ? calcEfficiencyRatio(strictExtraPositionSeries, strictExtraPositionIndex, 6)
                    : 0;
                const idleBreakoutConditionalTrailConfig = positionSymbol
                    ? options.idleBreakoutConditionalEarlyTrailBySymbol?.[positionSymbol.toUpperCase()]
                    : null;
                const idleBreakoutLongHighLookbackBars = idleBreakoutConditionalTrailConfig?.longHighDrawdownLookbackBars ?? 960;
                const idleBreakoutMarketContext = strictExtraPositionSeries && strictExtraPositionIndex >= 0
                    ? {
                        mom80: calcMomentum(strictExtraPositionSeries, strictExtraPositionIndex, 80),
                        recentHighDrawdownPct: calcRecentHighDrawdownPct(strictExtraPositionSeries, strictExtraPositionIndex, 96),
                        longHighDrawdownPct: calcRecentHighDrawdownPct(strictExtraPositionSeries, strictExtraPositionIndex, idleBreakoutLongHighLookbackBars),
                    }
                    : null;
                const idleBreakoutEntryMarketContext = {
                    mom20: position.entryMom20,
                    mom80: position.entryMom80,
                    momAccel: position.entryMomAccel,
                    volumeRatio: position.entryVolumeRatio,
                    efficiencyRatio: position.entryEfficiencyRatio,
                    recentHighDrawdownPct: position.entryRecentHighDrawdownPct,
                    longHighDrawdownPct: position.entryLongHighDrawdownPct,
                };
                const strongStrictExtraTrail =
                    positionSymbol &&
                    isStrictExtraTrendSymbol(positionSymbol, options) &&
                    shouldUseStrongStrictExtraTrail(
                        positionSymbol,
                        currentBar,
                        strictExtraPositionEfficiency,
                        options,
                    );
                if (strongStrictExtraTrail && options.strictExtraTrendStrongTrailDisableWhileStrong === true) {
                    effectiveStrictExtraTrailActivationPct = null;
                    strictExtraTrailRetracePct = null;
                } else if (strongStrictExtraTrail) {
                    effectiveStrictExtraTrailActivationPct =
                        options.strictExtraTrendStrongTrailActivationPct ?? effectiveStrictExtraTrailActivationPct;
                    strictExtraTrailRetracePct =
                        options.strictExtraTrendStrongTrailRetracePct ?? strictExtraTrailRetracePct;
                }
                const trendTrailActivationPct = symbolOverrideNumber(
                    options.trendProfitTrailActivationPctBySymbol,
                    positionSymbol,
                    options.trendProfitTrailActivationPct,
                );
                const trendTrailRetracePct = symbolOverrideNumber(
                    options.trendProfitTrailRetracePctBySymbol,
                    positionSymbol,
                    options.trendProfitTrailRetracePct,
                );
                const trendMaxHoldBars = symbolOverrideNumber(
                    options.trendMaxHoldBarsBySymbol,
                    positionSymbol,
                    options.trendMaxHoldBars,
                );
                const {
                    activationPct: idleBreakoutTrailActivationPct,
                    retracePct: idleBreakoutTrailRetracePct,
                    conditionalEarly: idleBreakoutConditionalEarlyTrail,
                } = resolveIdleBreakoutTrail(
                    positionSymbol,
                    position.entryPrice,
                    position.peakPrice,
                    options,
                    currentBar,
                    position.entryTs,
                    position.entryBarMs,
                    position.peakTs,
                    position.entryStrategy,
                    idleBreakoutMarketContext,
                    idleBreakoutEntryMarketContext,
                );
                const idleBreakoutMaxHoldBars = resolveIdleBreakoutMaxHoldBars(currentBar, position, options);
                const idleBreakoutTrailingExit =
                    isIdleBreakoutEntry(position) &&
                    currentPositionRaw &&
                    idleBreakoutTrailActivationPct != null &&
                    idleBreakoutTrailRetracePct != null &&
                    position.peakPrice >= position.entryPrice * (1 + idleBreakoutTrailActivationPct) &&
                    currentPositionRaw.close <= position.peakPrice * (1 - idleBreakoutTrailRetracePct);
                const idleBreakoutTimeExit =
                    isIdleBreakoutEntry(position) &&
                    idleBreakoutMaxHoldBars != null &&
                    elapsedBars(position.entryTs, ts, position.entryBarMs) >= idleBreakoutMaxHoldBars;
                const idleBreakoutFailureConfig = positionSymbol
                    ? options.idleBreakoutFailureExitBySymbol?.[positionSymbol.toUpperCase()]
                    : null;
                const idleBreakoutFailurePeakProfitPct = position.entryPrice > 0
                    ? (position.peakPrice / position.entryPrice) - 1
                    : 0;
                const idleBreakoutFailureCurrentProfitPct = currentPositionRaw && position.entryPrice > 0
                    ? (currentPositionRaw.close / position.entryPrice) - 1
                    : 0;
                const idleBreakoutFailureExit =
                    isIdleBreakoutEntry(position) &&
                    currentPositionRaw &&
                    idleBreakoutFailureConfig &&
                    elapsedBars(position.entryTs, ts, position.entryBarMs) >= idleBreakoutFailureConfig.minHoldBars &&
                    idleBreakoutFailurePeakProfitPct <= idleBreakoutFailureConfig.maxPeakProfitPct &&
                    (idleBreakoutFailureConfig.requireLoss !== true || idleBreakoutFailureCurrentProfitPct < 0) &&
                    (idleBreakoutFailureConfig.maxMom20 == null || currentBar.mom20 <= idleBreakoutFailureConfig.maxMom20) &&
                    (idleBreakoutFailureConfig.maxMomAccel == null || currentBar.momAccel <= idleBreakoutFailureConfig.maxMomAccel) &&
                    (idleBreakoutFailureConfig.requireCloseBelowSma40 !== true || currentPositionRaw.close <= currentBar.sma40);
                const idleBreakoutTakeProfitConfig = positionSymbol
                    ? options.idleBreakoutTakeProfitExitBySymbol?.[positionSymbol.toUpperCase()]
                    : null;
                const idleBreakoutTakeProfitExitPrice =
                    idleBreakoutTakeProfitConfig && position.entryPrice > 0
                        ? position.entryPrice * (1 + idleBreakoutTakeProfitConfig.takeProfitPct)
                        : null;
                const idleBreakoutTakeProfitExit =
                    isIdleBreakoutEntry(position) &&
                    currentPositionRaw &&
                    idleBreakoutTakeProfitExitPrice != null &&
                    currentPositionRaw.high >= idleBreakoutTakeProfitExitPrice;
                const injSpringTrailActivationPct = options.injSpringCashTrailActivationPct ?? null;
                const injSpringTrailRetracePct = options.injSpringCashTrailRetracePct ?? null;
                const injSpringHardStopLossPct = options.injSpringCashHardStopLossPct ?? null;
                const injSpringMaxHoldBars = options.injSpringCashMaxHoldBars ?? null;
                const injSpringTrailingExit =
                    isInjSpringCashEntry(position) &&
                    currentPositionRaw &&
                    injSpringTrailActivationPct != null &&
                    injSpringTrailRetracePct != null &&
                    position.peakPrice >= position.entryPrice * (1 + injSpringTrailActivationPct) &&
                    currentPositionRaw.close <= position.peakPrice * (1 - injSpringTrailRetracePct);
                const injSpringHardStopExit =
                    isInjSpringCashEntry(position) &&
                    currentPositionRaw &&
                    injSpringHardStopLossPct != null &&
                    currentPositionRaw.close <= position.entryPrice * (1 - injSpringHardStopLossPct);
                const injSpringTimeExit =
                    isInjSpringCashEntry(position) &&
                    injSpringMaxHoldBars != null &&
                    elapsedBars(position.entryTs, ts, position.entryBarMs) >= injSpringMaxHoldBars;
                const idleBreakoutPartialConfig = positionSymbol
                    ? (
                        isIdleBreakoutEntry(position)
                            ? options.idleBreakoutPartialExitBySymbol?.[positionSymbol.toUpperCase()]
                            : options.partialExitBySymbol?.[positionSymbol.toUpperCase()]
                    )
                    : null;
                if (
                    idleBreakoutPartialConfig &&
                    currentPositionRaw &&
                    !position.partialExitTaken
                ) {
                    const volumeRatio = currentBar.volAvg20 > 0 ? currentBar.volume / currentBar.volAvg20 : 0;
                    const strongPartial =
                        idleBreakoutPartialConfig.strongTakeProfitPct != null &&
                        (idleBreakoutPartialConfig.strongMinMomAccel == null || currentBar.momAccel >= idleBreakoutPartialConfig.strongMinMomAccel) &&
                        (idleBreakoutPartialConfig.strongMinVolumeRatio == null || volumeRatio >= idleBreakoutPartialConfig.strongMinVolumeRatio);
                    const partialTakeProfitPct = strongPartial
                        ? idleBreakoutPartialConfig.strongTakeProfitPct!
                        : idleBreakoutPartialConfig.baseTakeProfitPct;
                    const partialPrice = position.entryPrice * (1 + partialTakeProfitPct);
                    if (currentPositionRaw.high >= partialPrice) {
                        cash = reducePosition(
                            position,
                            partialPrice,
                            ts,
                            executionIndex,
                            strongPartial ? "idle-breakout-partial-strong" : "idle-breakout-partial",
                            idleBreakoutPartialConfig.fraction,
                            cash,
                            tradeEvents,
                            tradePairs,
                            baselinePreset.feeRate,
                            options,
                        );
                    }
                }
                if (
                    idleBreakoutPartialConfig &&
                    currentPositionRaw &&
                    position.partialExitTaken &&
                    !position.buybackDone &&
                    position.partialExitQty > 0 &&
                    idleBreakoutPartialConfig.buybackBreakoutPct != null
                ) {
                    const barsAfterPartial = elapsedBars(position.partialExitTs, ts, position.entryBarMs);
                    const volumeRatio = currentBar.volAvg20 > 0 ? currentBar.volume / currentBar.volAvg20 : 0;
                    const buybackReferencePrice = position.partialExitPeakPrice || position.peakPrice || position.entryPrice;
                    const canBuyback =
                        barsAfterPartial > 0 &&
                        (idleBreakoutPartialConfig.buybackMaxBarsAfterPartial == null || barsAfterPartial <= idleBreakoutPartialConfig.buybackMaxBarsAfterPartial) &&
                        (idleBreakoutPartialConfig.buybackMinMomAccel == null || currentBar.momAccel >= idleBreakoutPartialConfig.buybackMinMomAccel) &&
                        (idleBreakoutPartialConfig.buybackMinVolumeRatio == null || volumeRatio >= idleBreakoutPartialConfig.buybackMinVolumeRatio) &&
                        currentPositionRaw.high >= buybackReferencePrice * (1 + idleBreakoutPartialConfig.buybackBreakoutPct);
                    if (canBuyback) {
                        cash = buybackPartialPosition(
                            position,
                            currentPositionRaw.close,
                            ts,
                            baselinePreset.feeRate,
                            cash,
                            tradeEvents,
                        );
                    }
                }
                const idleBreakoutPartialStopExit =
                    idleBreakoutPartialConfig &&
                    currentPositionRaw &&
                    position.partialExitTaken &&
                    idleBreakoutPartialConfig.stopAfterPartialPct != null &&
                    currentPositionRaw.close <= position.entryPrice * (1 + idleBreakoutPartialConfig.stopAfterPartialPct);
                const idleBreakoutPartialRunnerTrailExit =
                    idleBreakoutPartialConfig &&
                    currentPositionRaw &&
                    position.partialExitTaken &&
                    idleBreakoutPartialConfig.runnerTrailActivationPct != null &&
                    idleBreakoutPartialConfig.runnerTrailRetracePct != null &&
                    position.peakPrice >= position.entryPrice * (1 + idleBreakoutPartialConfig.runnerTrailActivationPct) &&
                    currentPositionRaw.close <= position.peakPrice * (1 - idleBreakoutPartialConfig.runnerTrailRetracePct);
                const strictExtraHardStopLossPct = symbolOverrideNumber(
                    options.strictExtraTrendHardStopLossPctBySymbol,
                    positionSymbol,
                    options.strictExtraTrendHardStopLossPct,
                );
                const strictExtraMaxHoldBars = symbolOverrideNumber(
                    options.strictExtraTrendMaxHoldBarsBySymbol,
                    positionSymbol,
                    options.strictExtraTrendMaxHoldBars,
                );
                const trendTrailingExit =
                    position.symbol &&
                    !isStrictExtraTrendSymbol(position.symbol, options) &&
                    currentPositionRaw &&
                    trendTrailActivationPct != null &&
                    trendTrailRetracePct != null &&
                    position.peakPrice >= position.entryPrice * (1 + trendTrailActivationPct) &&
                    currentPositionRaw.close <= position.peakPrice * (1 - trendTrailRetracePct);
                const trendTimeExit =
                    position.symbol &&
                    !isStrictExtraTrendSymbol(position.symbol, options) &&
                    trendMaxHoldBars != null &&
                    elapsedBars(position.entryTs, ts, position.entryBarMs) >= trendMaxHoldBars;
                const strictExtraTrailingExit =
                    position.symbol &&
                    isStrictExtraTrendSymbol(position.symbol, options) &&
                    currentPositionRaw &&
                    effectiveStrictExtraTrailActivationPct != null &&
                    strictExtraTrailRetracePct != null &&
                    position.peakPrice >= position.entryPrice * (1 + effectiveStrictExtraTrailActivationPct) &&
                    currentPositionRaw.close <= position.peakPrice * (1 - strictExtraTrailRetracePct);
                const strictExtraHardStopExit =
                    position.symbol &&
                    isStrictExtraTrendSymbol(position.symbol, options) &&
                    currentPositionRaw &&
                    strictExtraHardStopLossPct != null &&
                    currentPositionRaw.close <= position.entryPrice * (1 - strictExtraHardStopLossPct);
                const strictExtraTimeExit =
                    position.symbol &&
                    isStrictExtraTrendSymbol(position.symbol, options) &&
                    strictExtraMaxHoldBars != null &&
                    elapsedBars(position.entryTs, ts, position.entryBarMs) >= strictExtraMaxHoldBars;
                const portfolioDrawdownCashExit =
                    !!position.side &&
                    options.portfolioDrawdownCashExitPct != null &&
                    drawdownPct <= options.portfolioDrawdownCashExitPct;
                const ddExit = mode === "RETQ22" && position.side === "trend" && effectiveSnapshot.weak2022Regime && snapshot.regimeLabel === "trend_weak" && drawdownPct <= -22;
                if (exitReason || ddExit || portfolioDrawdownCashExit || idleBreakoutTrailingExit || idleBreakoutTimeExit || idleBreakoutFailureExit || idleBreakoutTakeProfitExit || injSpringTrailingExit || injSpringHardStopExit || injSpringTimeExit || idleBreakoutPartialStopExit || idleBreakoutPartialRunnerTrailExit || trendTrailingExit || trendTimeExit || strictExtraTrailingExit || strictExtraHardStopExit || strictExtraTimeExit) {
                    const price = idleBreakoutTakeProfitExit && idleBreakoutTakeProfitExitPrice != null
                        ? idleBreakoutTakeProfitExitPrice
                        : currentPositionRaw?.open || position.entryPrice;
                    const strictExtraExitSymbol = position.symbol && isStrictExtraTrendSymbol(position.symbol, options)
                        ? position.symbol
                        : null;
                    const resolvedExitReason = portfolioDrawdownCashExit
                        ? "portfolio-dd-cash"
                        : injSpringTrailingExit
                        ? "inj-spring-trailing"
                        : injSpringHardStopExit
                            ? "inj-spring-hard-stop"
                            : injSpringTimeExit
                                ? "inj-spring-time"
                        : idleBreakoutTrailingExit
                        ? (idleBreakoutConditionalEarlyTrail ? "idle-breakout-early-trailing" : "idle-breakout-trailing")
                        : idleBreakoutTimeExit
                            ? "idle-breakout-time"
                        : idleBreakoutFailureExit
                            ? "idle-breakout-failure"
                        : idleBreakoutTakeProfitExit
                            ? "idle-breakout-take-profit"
                        : idleBreakoutPartialStopExit
                            ? "idle-breakout-partial-stop"
                            : idleBreakoutPartialRunnerTrailExit
                                ? "idle-breakout-partial-runner-trail"
                                : trendTrailingExit
                            ? "trend-profit-trailing"
                            : trendTimeExit
                                ? "trend-time"
                            : strictExtraTrailingExit
                            ? "strict-extra-trailing"
                            : strictExtraHardStopExit
                                ? "strict-extra-hard-stop"
                                : strictExtraTimeExit
                                    ? "strict-extra-time"
                                    : (exitReason || "dd22-balanced");
                    const earlyTrailExitSymbol = (resolvedExitReason === "idle-breakout-early-trailing" || resolvedExitReason === "idle-breakout-take-profit") && position.symbol
                        ? position.symbol
                        : null;
                    const partialRunnerExitSymbol = resolvedExitReason === "idle-breakout-partial-runner-trail" && position.symbol
                        ? position.symbol
                        : null;
                    const earlyTrailEntryBarMs = position.entryBarMs;
                    const earlyTrailPeakPrice = position.peakPrice || price;
                    const partialRunnerReentryAlloc = Math.max(0, positionAlloc(position, options) * (idleBreakoutPartialConfig?.fraction ?? 0.5));
                    cash = exitPosition(
                        position,
                        price,
                        ts,
                        executionIndex,
                        resolvedExitReason,
                        cash,
                        tradeEvents,
                        tradePairs,
                        baselinePreset.feeRate,
                        options,
                    );
                    if (strictExtraExitSymbol) {
                        lastStrictExtraExitSymbol = strictExtraExitSymbol;
                        lastStrictExtraExitIndex = executionIndex;
                        lastStrictExtraExitReason = resolvedExitReason;
                    }
                    if (earlyTrailExitSymbol) {
                        lastIdleEarlyTrailExit = {
                            symbol: earlyTrailExitSymbol,
                            price,
                            peakPrice: earlyTrailPeakPrice,
                            ts,
                            index: executionIndex,
                            entryBarMs: earlyTrailEntryBarMs,
                        };
                    }
                    if (partialRunnerExitSymbol) {
                        lastIdlePartialRunnerExit = {
                            symbol: partialRunnerExitSymbol,
                            price,
                            ts,
                            index: executionIndex,
                            entryBarMs: earlyTrailEntryBarMs,
                            alloc: partialRunnerReentryAlloc,
                        };
                    }
                }
            }
        }

        let trendCandidate = null as ReturnType<typeof pickTrendCandidate> | null;
        let rangeCandidate = null as ReturnType<typeof pickAnnotatedRangeCandidate> | null;
        let trendRotationCandidate = null as ReturnType<typeof pickTrendCandidate> | null;
        let strictExtraRotationCandidate = null as ReturnType<typeof pickStrictExtraTrendCandidate> | null;
        let rotatedToPenguOffRotation = false;
        const baseTrendOptions = options.strictExtraTrendIdleOnly
            ? { ...options, strictExtraTrendSymbols: undefined }
            : options;
        const trendEntryOptions = !position.side
            ? withIdleCashTrendOverrides(baseTrendOptions)
            : baseTrendOptions;
        if (tradeReady && (isDecisionBar || isStrictExtraDecisionBar || isStrictExtraReentryBar)) {
            trendCandidate = (options.disableTrend || !isDecisionBar) ? null : pickTrendCandidate(
                effectiveSnapshot,
                activeDecisionIndicators as Record<string, IndicatorBar[]>,
                mode,
                trendEntryOptions,
            );
            if (mode === "RETQ22" && isDecisionBar) {
                const primaryRangeCandidate = effectiveSnapshot.rangeAllowed
                    ? pickAnnotatedRangeCandidate(
                        effectiveSnapshot,
                        activeDecisionIndicators as Record<TradeSymbol, IndicatorBar[]>,
                        options,
                        rangeSymbols,
                        options.rangeEntryMode === "reclaim" ? "range-reclaim" : "range-primary",
                        options.rangeAlloc ?? 0.5,
                    )
                    : null;
                const auxRangeYearAllowed =
                    !options.auxRangeActiveYears ||
                    options.auxRangeActiveYears.includes(new Date(ts).getUTCFullYear());
                const auxSnapshot = options.auxRangeIgnoreRegimeGate
                    ? { ...effectiveSnapshot, rangeAllowed: true }
                    : effectiveSnapshot;
                const auxRangeOptions = options.auxRangeSymbols && auxRangeYearAllowed
                    ? {
                        ...options,
                        rangeEntryMode: options.auxRangeEntryMode ?? options.rangeEntryMode,
                        rangeEntryBestMom20Below: options.auxRangeEntryBestMom20Below ?? options.rangeEntryBestMom20Below,
                        rangeEntryBtcAdxBelow: options.auxRangeEntryBtcAdxBelow ?? options.rangeEntryBtcAdxBelow,
                        rangeOverheatMax: options.auxRangeOverheatMax ?? options.rangeOverheatMax,
                        rangeExitMom20Above: options.auxRangeExitMom20Above ?? options.rangeExitMom20Above,
                        rangeMaxHoldBars: options.auxRangeMaxHoldBars ?? options.rangeMaxHoldBars,
                    }
                    : null;
                const auxRangeCandidate = auxRangeOptions
                    ? pickAnnotatedRangeCandidate(
                        auxSnapshot,
                        activeDecisionIndicators as Record<string, IndicatorBar[]>,
                        auxRangeOptions,
                        options.auxRangeSymbols!,
                        `range-${options.auxRangeEntryMode ?? "aux"}`,
                        options.auxRangeAlloc ?? options.rangeAlloc ?? 0.5,
                    )
                    : null;
                const aux2RangeYearAllowed =
                    !options.aux2RangeActiveYears ||
                    options.aux2RangeActiveYears.includes(new Date(ts).getUTCFullYear());
                const aux2Snapshot = options.aux2RangeIgnoreRegimeGate
                    ? { ...effectiveSnapshot, rangeAllowed: true }
                    : effectiveSnapshot;
                const aux2RangeOptions = options.aux2RangeSymbols && aux2RangeYearAllowed
                    ? {
                        ...options,
                        rangeEntryMode: options.aux2RangeEntryMode ?? options.rangeEntryMode,
                        rangeEntryBestMom20Below: options.aux2RangeEntryBestMom20Below ?? options.rangeEntryBestMom20Below,
                        rangeEntryBtcAdxBelow: options.aux2RangeEntryBtcAdxBelow ?? options.rangeEntryBtcAdxBelow,
                        rangeOverheatMax: options.aux2RangeOverheatMax ?? options.rangeOverheatMax,
                        rangeExitMom20Above: options.aux2RangeExitMom20Above ?? options.rangeExitMom20Above,
                        rangeMaxHoldBars: options.aux2RangeMaxHoldBars ?? options.rangeMaxHoldBars,
                    }
                    : null;
                const aux2RangeCandidate = aux2RangeOptions
                    ? pickAnnotatedRangeCandidate(
                        aux2Snapshot,
                        activeDecisionIndicators as Record<string, IndicatorBar[]>,
                        aux2RangeOptions,
                        options.aux2RangeSymbols!,
                        `range-${options.aux2RangeEntryMode ?? "aux2"}`,
                        options.aux2RangeAlloc ?? options.rangeAlloc ?? 0.5,
                    )
                    : null;
                rangeCandidate = [primaryRangeCandidate, auxRangeCandidate, aux2RangeCandidate]
                    .filter((item): item is NonNullable<typeof item> => item !== null && item.eligible)
                    .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))[0] ?? null;
            }
            if (
                options.strictExtraTrendIdleOnly &&
                !trendCandidate?.eligible &&
                !rangeCandidate?.eligible &&
                !options.disableTrend &&
                isStrictExtraDecisionBar
            ) {
                trendCandidate = pickStrictExtraTrendCandidate(
                    effectiveSnapshot,
                    activeDecisionIndicators as Record<string, IndicatorBar[]>,
                    strictExtraDecisionOptions(options),
                );
            }

            if (
                options.strictExtraTrendReentryAfterExitSymbols?.length &&
                !position.side &&
                isStrictExtraReentryBar &&
                lastStrictExtraExitSymbol &&
                isInAllowedWindow(ts, options.strictExtraTrendAllowedWindows)
            ) {
                const reentrySymbols = options.strictExtraTrendReentryAfterExitSymbols.map((symbol) => symbol.toUpperCase());
                const reentryReasons = options.strictExtraTrendReentryAfterExitReasons?.map((reason) => reason.toLowerCase());
                const barsSinceExit = executionIndex - lastStrictExtraExitIndex;
                const minBarsAfterExit = options.strictExtraTrendReentryMinBarsAfterExit ?? 1;
                const maxBarsAfterExit = options.strictExtraTrendReentryMaxBarsAfterExit ?? 4;
                const reasonAllowed = !reentryReasons?.length || (
                    lastStrictExtraExitReason != null &&
                    reentryReasons.includes(lastStrictExtraExitReason.toLowerCase())
                );
                if (
                    reentrySymbols.includes(lastStrictExtraExitSymbol.toUpperCase()) &&
                    reasonAllowed &&
                    barsSinceExit >= minBarsAfterExit &&
                    barsSinceExit <= maxBarsAfterExit
                ) {
                    const reentryEval = buildTrendEvaluationsForSymbols(
                        effectiveSnapshot,
                        strictExtraReentryIndicators as Record<string, IndicatorBar[]>,
                        [lastStrictExtraExitSymbol],
                        strictExtraDecisionOptions(options),
                    )[0] ?? null;
                    const reentryBar = latestIndicatorAtOrBefore(
                        (strictExtraReentryIndicators as Record<string, IndicatorBar[]>)[lastStrictExtraExitSymbol] ?? [],
                        ts,
                    );
                    if (shouldUseStrictExtraReentry(reentryEval, trendCandidate, options)) {
                        trendCandidate = {
                            symbol: reentryEval.symbol,
                            bar: reentryBar ?? currentBars[reentryEval.symbol] ?? currentBars[lastStrictExtraExitSymbol]!,
                            eligible: true,
                            score: reentryEval.score,
                            mom20: reentryEval.mom20,
                            mom80: reentryEval.mom80,
                            momAccel: reentryEval.momAccel,
                            adx14: reentryEval.adx14,
                            volumeRatio: reentryEval.volumeRatio,
                            efficiencyRatio: reentryEval.efficiencyRatio,
                            recentHighDrawdownPct: reentryEval.recentHighDrawdownPct,
                            longHighDrawdownPct: reentryEval.longHighDrawdownPct,
                            structureBreak: reentryEval.structureBreak,
                            dowHigherHighLow: reentryEval.dowHigherHighLow,
                            reasons: [...reentryEval.reasons, "strict-extra-reentry"],
                        };
                    }
                }
            }

            trendCandidate = maybePreferStrictExtraTrendCandidate(
                effectiveSnapshot,
                activeDecisionIndicators as Record<string, IndicatorBar[]>,
                trendCandidate,
                options,
                activeDecisionIndicators as Record<string, IndicatorBar[]>,
            );

            if (
                options.trendRotationWhileHolding &&
                position.side === "trend" &&
                position.symbol &&
                !isStrictExtraTrendSymbol(position.symbol, options) &&
                isDecisionBar
            ) {
                const currentTrendEval = buildTrendEvaluationsForSymbols(
                    effectiveSnapshot,
                    indicators,
                    [position.symbol],
                    baseTrendOptions,
                )[0] ?? null;
                const nextTrendCandidate = pickTrendCandidate(
                    effectiveSnapshot,
                    indicators,
                    mode,
                    baseTrendOptions,
                );

                if (
                    shouldAllowTrendRotation(
                        position,
                        currentTrendEval,
                        nextTrendCandidate,
                        ts,
                        options,
                    )
                ) {
                    const scoreGap = (nextTrendCandidate?.score ?? 0) - (currentTrendEval?.score ?? 0);
                    if (trendLeadSymbol === nextTrendCandidate!.symbol) {
                        trendLeadCount += 1;
                    } else {
                        trendLeadSymbol = nextTrendCandidate!.symbol;
                        trendLeadCount = 1;
                    }

                    if (trendRotationThresholdMet(scoreGap, trendLeadCount, options)) {
                        trendRotationCandidate = nextTrendCandidate;
                    }
                } else {
                    trendLeadSymbol = null;
                    trendLeadCount = 0;
                }
            } else if (!isDecisionBar) {
                trendLeadSymbol = null;
                trendLeadCount = 0;
            }

            if (
                options.strictExtraTrendRotationWhileHolding &&
                position.side === "trend" &&
                position.symbol &&
                !isStrictExtraTrendSymbol(position.symbol, options) &&
                isStrictExtraDecisionBar
            ) {
                const currentRotationEval = buildTrendEvaluationsForSymbols(
                    effectiveSnapshot,
                    strictExtraDecisionIndicators as Record<string, IndicatorBar[]>,
                    [position.symbol],
                    options,
                )[0] ?? null;
                const extraRotationCandidate = pickStrictExtraTrendCandidate(
                    effectiveSnapshot,
                    strictExtraDecisionIndicators as Record<string, IndicatorBar[]>,
                    strictExtraDecisionOptions(options),
                );

                if (
                    shouldAllowStrictExtraRotation(
                        position,
                        currentRotationEval,
                        extraRotationCandidate,
                        ts,
                        options,
                    )
                ) {
                    if (strictExtraLeadSymbol === extraRotationCandidate!.symbol) {
                        strictExtraLeadCount += 1;
                    } else {
                        strictExtraLeadSymbol = extraRotationCandidate!.symbol;
                        strictExtraLeadCount = 1;
                    }

                    if (strictExtraLeadCount >= strictExtraRotationConsecutiveBarsForSymbol(extraRotationCandidate!.symbol, options)) {
                        strictExtraRotationCandidate = extraRotationCandidate;
                    }
                } else {
                    strictExtraLeadSymbol = null;
                    strictExtraLeadCount = 0;
                }
            } else if (!isStrictExtraDecisionBar) {
                strictExtraLeadSymbol = null;
                strictExtraLeadCount = 0;
            }
        }

        if (
            tradeReady &&
            options.idleBreakoutEntryWhileCash &&
            !position.side &&
            !trendCandidate?.eligible &&
            !rangeCandidate?.eligible &&
            isIdleBreakoutDecisionBar &&
            isInAllowedWindow(ts, options.idleBreakoutAllowedWindows) &&
            (tradeReady || options.idleBreakoutAllowTradeGateOff === true)
        ) {
            const idleBreakoutOptions: HybridVariantOptions = {
                ...baseTrendOptions,
                strictExtraTrendSymbols: undefined,
                trendBreakoutLookbackBars: options.idleBreakoutBreakoutLookbackBars !== undefined ? options.idleBreakoutBreakoutLookbackBars : options.trendBreakoutLookbackBars,
                trendBreakoutMinPct: options.idleBreakoutBreakoutMinPct !== undefined ? options.idleBreakoutBreakoutMinPct : options.trendBreakoutMinPct,
                trendDisableBreakoutSymbols: options.idleBreakoutBreakoutLookbackBars === null ? options.idleBreakoutSymbols : options.trendDisableBreakoutSymbols,
                trendMinVolumeRatio: options.idleBreakoutMinVolumeRatio ?? options.trendMinVolumeRatio,
                trendMinMomAccel: options.idleBreakoutMinMomAccel ?? options.trendMinMomAccel,
                trendMinEfficiencyRatio: options.idleBreakoutMinEfficiencyRatio ?? options.trendMinEfficiencyRatio,
                trendMinSmaDistancePct: options.trendMinSmaDistancePct,
                trendMinSmaDistancePctBySymbol: options.trendMinSmaDistancePctBySymbol,
                idleCashTrendContext: true,
                idleCashTrendAllowTrendGateOff: options.idleBreakoutAllowTradeGateOff ?? options.idleCashTrendAllowTrendGateOff,
            };
            trendCandidate = options.idleBreakoutSymbols?.length
                ? pickTrendCandidateForSymbols(
                    effectiveSnapshot,
                    idleBreakoutIndicators,
                    options.idleBreakoutSymbols,
                    idleBreakoutOptions,
                )
                : pickTrendCandidate(
                    effectiveSnapshot,
                    idleBreakoutIndicators,
                    mode,
                    idleBreakoutOptions,
                );
            if (trendCandidate?.eligible) {
                trendCandidate = {
                    ...trendCandidate,
                    reasons: [...trendCandidate.reasons, "idle-breakout-entry"],
                };
            }
        }

        if (
            options.idleNightBreakoutEntryWhileCash &&
            !position.side &&
            !trendCandidate?.eligible &&
            !rangeCandidate?.eligible &&
            isIdleNightBreakoutDecisionBar &&
            isJstHourWindow(
                ts,
                options.idleNightBreakoutJstStartHour ?? 22,
                options.idleNightBreakoutJstEndHour ?? 2,
            ) &&
            (tradeReady || options.idleNightBreakoutAllowTradeGateOff === true)
        ) {
            const idleNightBreakoutOptions: HybridVariantOptions = {
                ...baseTrendOptions,
                strictExtraTrendSymbols: undefined,
                trendBreakoutLookbackBars: options.idleNightBreakoutBreakoutLookbackBars !== undefined
                    ? options.idleNightBreakoutBreakoutLookbackBars
                    : options.idleBreakoutBreakoutLookbackBars !== undefined
                        ? options.idleBreakoutBreakoutLookbackBars
                        : options.trendBreakoutLookbackBars,
                trendBreakoutMinPct: options.idleNightBreakoutBreakoutMinPct !== undefined
                    ? options.idleNightBreakoutBreakoutMinPct
                    : options.idleBreakoutBreakoutMinPct !== undefined
                        ? options.idleBreakoutBreakoutMinPct
                        : options.trendBreakoutMinPct,
                trendDisableBreakoutSymbols: options.idleNightBreakoutBreakoutLookbackBars === null
                    ? options.idleNightBreakoutSymbols
                    : options.idleBreakoutBreakoutLookbackBars === null
                        ? options.idleBreakoutSymbols
                        : options.trendDisableBreakoutSymbols,
                trendMinVolumeRatio: options.idleNightBreakoutMinVolumeRatio ?? options.idleBreakoutMinVolumeRatio ?? options.trendMinVolumeRatio,
                trendMinMomAccel: options.idleNightBreakoutMinMomAccel ?? options.idleBreakoutMinMomAccel ?? options.trendMinMomAccel,
                trendMinEfficiencyRatio: options.idleNightBreakoutMinEfficiencyRatio ?? options.idleBreakoutMinEfficiencyRatio ?? options.trendMinEfficiencyRatio,
                trendMinSmaDistancePct: options.trendMinSmaDistancePct,
                trendMinSmaDistancePctBySymbol: options.trendMinSmaDistancePctBySymbol,
                idleCashTrendContext: true,
                idleCashTrendAllowTrendGateOff: options.idleNightBreakoutAllowTradeGateOff ?? options.idleBreakoutAllowTradeGateOff ?? options.idleCashTrendAllowTrendGateOff,
            };
            trendCandidate = options.idleNightBreakoutSymbols?.length
                ? pickTrendCandidateForSymbols(
                    effectiveSnapshot,
                    idleNightBreakoutIndicators,
                    options.idleNightBreakoutSymbols,
                    idleNightBreakoutOptions,
                )
                : pickTrendCandidate(
                    effectiveSnapshot,
                    idleNightBreakoutIndicators,
                    mode,
                    idleNightBreakoutOptions,
                );
            if (trendCandidate?.eligible) {
                trendCandidate = shouldAllowIdleNightBreakoutCandidate(
                    trendCandidate,
                    idleNightBreakoutIndicators,
                    ts,
                    options,
                )
                    ? {
                        ...trendCandidate,
                        reasons: [...trendCandidate.reasons, "idle-breakout-night-entry"],
                    }
                    : null;
            }
        }

        if (
            options.injSpringCashEntry &&
            !position.side &&
            !trendCandidate?.eligible &&
            !rangeCandidate?.eligible &&
            isInjSpringDecisionBar &&
            cash > BASE_EQUITY * 0.05
        ) {
            const injSpringCandidate = pickInjSpringCashCandidate(
                ts,
                injSpringCandles.INJ ?? [],
                injSpringIndicators.INJ ?? [],
                injSpringIndicators,
            );
            if (injSpringCandidate) {
                trendCandidate = {
                    ...injSpringCandidate,
                    bar: (currentBars.INJ ?? latestIndicatorAtOrBefore((indicators as Record<string, IndicatorBar[]>).INJ, ts))!,
                    eligible: true,
                    mom20: 0,
                    mom80: 0,
                    momAccel: 0,
                    adx14: 0,
                    volumeRatio: 0,
                    efficiencyRatio: 0,
                    recentHighDrawdownPct: 0,
                    longHighDrawdownPct: 0,
                    structureBreak: true,
                    dowHigherHighLow: true,
                };
            }
        }

        if (
            options.penguOffRotationEntry &&
            penguOffRotationDecisionSet.has(ts) &&
            (tradeReady || options.penguOffRotationAllowTradeGateOff === true) &&
            position.symbol?.toUpperCase() !== "PENGU"
        ) {
            const penguOffSymbols = penguOffRotationSymbolsAllowedAt(ts, options);
            const penguOffRotationCandidate = penguOffSymbols.length
                ? pickTrendCandidateForSymbols(
                    effectiveSnapshot,
                    penguOffRotationIndicators,
                    penguOffSymbols,
                    {
                        ...strictExtraDecisionOptions(options),
                        idleCashTrendContext: options.penguOffRotationAllowTradeGateOff === true,
                        idleCashTrendAllowTrendGateOff: options.penguOffRotationAllowTradeGateOff,
                    },
                )
                : null;
            const currentSymbols = options.penguOffRotationCurrentSymbols?.map((symbol) => symbol.toUpperCase());
            const canReplaceCurrentSymbol =
                !currentSymbols?.length ||
                !position.symbol ||
                currentSymbols.includes(position.symbol.toUpperCase());
            const currentEval = position.symbol
                ? buildTrendEvaluationsForSymbols(
                    effectiveSnapshot,
                    penguOffRotationIndicators,
                    [position.symbol],
                    strictExtraDecisionOptions(options),
                )[0] ?? null
                : null;
            const scoreGap = (penguOffRotationCandidate?.score ?? -Infinity) - (currentEval?.score ?? 0);
            const requiredScoreGap = options.penguOffRotationScoreGap ?? 0;
            const enoughHold =
                !position.side ||
                elapsedBars(position.entryTs, ts, position.entryBarMs) >= (options.penguOffRotationMinHoldBars ?? 0);
            const canEnterFromCash = !position.side && options.penguOffRotationAllowFromCash !== false;
            const canRotateHolding =
                !!position.side &&
                options.penguOffRotationAllowWhileHolding !== false &&
                canReplaceCurrentSymbol &&
                enoughHold &&
                scoreGap >= requiredScoreGap &&
                position.symbol !== penguOffRotationCandidate?.symbol;

            if (penguOffRotationCandidate?.eligible && (canEnterFromCash || canRotateHolding)) {
                if (position.side && position.symbol) {
                    const exitSymbol = position.symbol;
                    cash = exitPosition(
                        position,
                        (exitSymbol ? execRaw[exitSymbol]?.open : null) || position.entryPrice,
                        ts,
                        executionIndex,
                        "pengu-off-rotation-switch",
                        cash,
                        tradeEvents,
                        tradePairs,
                        baselinePreset.feeRate,
                        options,
                    );
                }

                const tradeId = nextTradeId(mode, tradeCount);
                const entryBar = execRaw[penguOffRotationCandidate.symbol];
                if (entryBar) {
                    const result = enterPosition(
                        position,
                        "trend",
                        penguOffRotationCandidate.symbol,
                        entryBar.open,
                        ts,
                        executionIndex,
                        `pengu-off-rotation-${penguOffRotationCandidate.reasons.join("|")}`,
                        tradeEvents,
                        tradeId,
                        cash,
                        baselinePreset.feeRate,
                        options,
                        {
                            subVariant: "pengu-off-rotation",
                            entryBarMs: timeframeToMs(penguOffRotationTimeframe),
                            maxNotionalUsd: symbolOverrideNumber(
                                options.penguOffRotationMaxNotionalUsdBySymbol,
                                penguOffRotationCandidate.symbol,
                                options.penguOffRotationMaxNotionalUsd,
                            ),
                        },
                    );
                    cash = result.cash;
                    if (result.opened) {
                        tradeCount += 1;
                        rotatedToPenguOffRotation = true;
                        lastTrendCandidate = penguOffRotationCandidate.symbol;
                    }
                }
            }
        }

        if (
            options.penguStrongOverrideEntry &&
            penguStrongOverrideDecisionSet.has(ts) &&
            (tradeReady || options.penguStrongOverrideAllowTradeGateOff === true) &&
            position.side === "trend" &&
            position.symbol &&
            position.symbol.toUpperCase() !== "PENGU" &&
            !rotatedToPenguOffRotation
        ) {
            const targetSymbols = options.penguStrongOverrideSymbols ?? ["PENGU"];
            const strongOverrideCandidate = pickTrendCandidateForSymbols(
                effectiveSnapshot,
                penguStrongOverrideIndicators,
                targetSymbols,
                {
                    ...strictExtraDecisionOptions(options),
                    idleCashTrendContext: options.penguStrongOverrideAllowTradeGateOff === true,
                    idleCashTrendAllowTrendGateOff: options.penguStrongOverrideAllowTradeGateOff,
                },
            );
            const currentSymbols = options.penguStrongOverrideCurrentSymbols?.map((symbol) => symbol.toUpperCase());
            const canReplaceCurrentSymbol =
                !currentSymbols?.length ||
                currentSymbols.includes(position.symbol.toUpperCase());
            const currentEval = buildTrendEvaluationsForSymbols(
                effectiveSnapshot,
                penguStrongOverrideIndicators,
                [position.symbol],
                strictExtraDecisionOptions(options),
            )[0] ?? null;
            const scoreGap = (strongOverrideCandidate?.score ?? -Infinity) - (currentEval?.score ?? 0);
            const enoughHold =
                elapsedBars(position.entryTs, ts, position.entryBarMs) >= (options.penguStrongOverrideMinHoldBars ?? 0);

            if (
                strongOverrideCandidate?.eligible &&
                canReplaceCurrentSymbol &&
                enoughHold &&
                scoreGap >= (options.penguStrongOverrideScoreGap ?? 0) &&
                position.symbol !== strongOverrideCandidate.symbol
            ) {
                const exitSymbol = position.symbol;
                cash = exitPosition(
                    position,
                    (exitSymbol ? execRaw[exitSymbol]?.open : null) || position.entryPrice,
                    ts,
                    executionIndex,
                    "pengu-strong-override-switch",
                    cash,
                    tradeEvents,
                    tradePairs,
                    baselinePreset.feeRate,
                    options,
                );

                const tradeId = nextTradeId(mode, tradeCount);
                const entryBar = execRaw[strongOverrideCandidate.symbol];
                if (entryBar) {
                    const result = enterPosition(
                        position,
                        "trend",
                        strongOverrideCandidate.symbol,
                        entryBar.open,
                        ts,
                        executionIndex,
                        `pengu-strong-override-${strongOverrideCandidate.reasons.join("|")}`,
                        tradeEvents,
                        tradeId,
                        cash,
                        baselinePreset.feeRate,
                        options,
                        {
                            subVariant: "pengu-strong-override",
                            entryBarMs: timeframeToMs(penguStrongOverrideTimeframe),
                        },
                    );
                    cash = result.cash;
                    if (result.opened) {
                        tradeCount += 1;
                        rotatedToPenguOffRotation = true;
                        lastTrendCandidate = strongOverrideCandidate.symbol;
                    }
                }
            }
        }

        if (
            options.solWaveOverrideEntry &&
            solWaveOverrideDecisionSet.has(ts) &&
            (tradeReady || options.solWaveOverrideAllowTradeGateOff === true) &&
            position.side === "trend" &&
            position.symbol &&
            position.symbol.toUpperCase() !== "SOL" &&
            !rotatedToPenguOffRotation
        ) {
            const solWaveOptions: HybridVariantOptions = {
                ...baseTrendOptions,
                trendBreakoutLookbackBars: options.solWaveOverrideBreakoutLookbackBars ?? options.trendBreakoutLookbackBars,
                trendBreakoutMinPct: options.solWaveOverrideBreakoutMinPct ?? options.trendBreakoutMinPct,
                trendMinVolumeRatio: options.solWaveOverrideMinVolumeRatio ?? options.trendMinVolumeRatio,
                trendMinMomAccel: options.solWaveOverrideMinMomAccel ?? options.trendMinMomAccel,
                trendMinEfficiencyRatio: options.solWaveOverrideMinEfficiencyRatio ?? options.trendMinEfficiencyRatio,
                idleCashTrendContext: options.solWaveOverrideAllowTradeGateOff === true,
                idleCashTrendAllowTrendGateOff: options.solWaveOverrideAllowTradeGateOff,
            };
            const solWaveCandidate = pickTrendCandidateForSymbols(
                effectiveSnapshot,
                solWaveOverrideIndicators,
                ["SOL"],
                solWaveOptions,
            );
            const currentSymbols = options.solWaveOverrideCurrentSymbols?.map((symbol) => symbol.toUpperCase());
            const canReplaceCurrentSymbol =
                !currentSymbols?.length ||
                currentSymbols.includes(position.symbol.toUpperCase());
            const currentEval = buildTrendEvaluationsForSymbols(
                effectiveSnapshot,
                solWaveOverrideIndicators,
                [position.symbol],
                solWaveOptions,
            )[0] ?? null;
            const scoreGap = (solWaveCandidate?.score ?? -Infinity) - (currentEval?.score ?? 0);
            const enoughHold =
                elapsedBars(position.entryTs, ts, position.entryBarMs) >= (options.solWaveOverrideMinHoldBars ?? 0);

            if (
                solWaveCandidate?.eligible &&
                canReplaceCurrentSymbol &&
                enoughHold &&
                scoreGap >= (options.solWaveOverrideScoreGap ?? 0)
            ) {
                const exitSymbol = position.symbol;
                cash = exitPosition(
                    position,
                    (exitSymbol ? execRaw[exitSymbol]?.open : null) || position.entryPrice,
                    ts,
                    executionIndex,
                    "sol-wave-override-switch",
                    cash,
                    tradeEvents,
                    tradePairs,
                    baselinePreset.feeRate,
                    options,
                );

                const tradeId = nextTradeId(mode, tradeCount);
                const entryBar = execRaw[solWaveCandidate.symbol];
                if (entryBar) {
                    const result = enterPosition(
                        position,
                        "trend",
                        solWaveCandidate.symbol,
                        entryBar.open,
                        ts,
                        executionIndex,
                        `sol-wave-override-${solWaveCandidate.reasons.join("|")}`,
                        tradeEvents,
                        tradeId,
                        cash,
                        baselinePreset.feeRate,
                        options,
                        {
                            subVariant: "sol-wave-override",
                            entryBarMs: timeframeToMs(solWaveOverrideTimeframe),
                        },
                    );
                    cash = result.cash;
                    if (result.opened) {
                        tradeCount += 1;
                        rotatedToPenguOffRotation = true;
                        lastTrendCandidate = solWaveCandidate.symbol;
                    }
                }
            }
        }

        let rotatedToTrend = false;
        const guardIdleBreakoutTrendRotation = shouldBlockIdleBreakoutTrendSwitch(
            position,
            position.symbol && trendRotationCandidate?.eligible
                ? buildTrendEvaluationsForSymbols(
                    effectiveSnapshot,
                    indicators,
                    [position.symbol],
                    baseTrendOptions,
                )[0] ?? null
                : null,
            trendRotationCandidate,
            position.symbol ? execRaw[position.symbol]?.close ?? null : null,
            options,
        );
        if (
            trendRotationCandidate?.eligible &&
            position.side === "trend" &&
            position.symbol &&
            position.symbol !== trendRotationCandidate.symbol &&
            !rotatedToPenguOffRotation &&
            !guardIdleBreakoutTrendRotation
        ) {
            const exitSymbol = position.symbol;
            cash = exitPosition(
                position,
                (exitSymbol ? execRaw[exitSymbol]?.open : null) || position.entryPrice,
                ts,
                executionIndex,
                "trend-rotate",
                cash,
                tradeEvents,
                tradePairs,
                baselinePreset.feeRate,
                options,
            );

            const tradeId = nextTradeId(mode, tradeCount);
            const entryBar = execRaw[trendRotationCandidate.symbol];
            if (entryBar) {
                const result = enterPosition(
                    position,
                    "trend",
                    trendRotationCandidate.symbol,
                    entryBar.open,
                    ts,
                    executionIndex,
                    `trend-rotate-${trendRotationCandidate.reasons.join("|")}`,
                    tradeEvents,
                    tradeId,
                    cash,
                    baselinePreset.feeRate,
                    options,
                );
                cash = result.cash;
                if (result.opened) {
                    tradeCount += 1;
                    rotatedToTrend = true;
                    lastTrendCandidate = trendRotationCandidate.symbol;
                }
            }
            trendLeadSymbol = null;
            trendLeadCount = 0;
        }

        let rotatedToStrictExtra = false;
        if (
            strictExtraRotationCandidate?.eligible &&
            position.side === "trend" &&
            position.symbol &&
            position.symbol !== strictExtraRotationCandidate.symbol &&
            !rotatedToPenguOffRotation &&
            (
                options.strictExtraTrendRotationBlockBelowDrawdownPct == null ||
                drawdownPct > options.strictExtraTrendRotationBlockBelowDrawdownPct
            )
        ) {
            const exitSymbol = position.symbol;
            cash = exitPosition(
                position,
                (exitSymbol ? execRaw[exitSymbol]?.open : null) || position.entryPrice,
                ts,
                executionIndex,
                "strict-extra-rotate",
                cash,
                tradeEvents,
                tradePairs,
                baselinePreset.feeRate,
                options,
            );

            const tradeId = nextTradeId(mode, tradeCount);
            const entryBar = execRaw[strictExtraRotationCandidate.symbol];
            if (entryBar) {
                const result = enterPosition(
                    position,
                    "trend",
                    strictExtraRotationCandidate.symbol,
                    entryBar.open,
                    ts,
                    executionIndex,
                    `strict-extra-rotate-${strictExtraRotationCandidate.reasons.join("|")}`,
                    tradeEvents,
                    tradeId,
                    cash,
                    baselinePreset.feeRate,
                    options,
                );
                cash = result.cash;
                if (result.opened) {
                    tradeCount += 1;
                    rotatedToStrictExtra = true;
                    lastTrendCandidate = strictExtraRotationCandidate.symbol;
                }
            }
            strictExtraLeadSymbol = null;
            strictExtraLeadCount = 0;
        }

        const forceInjSpringCashEntryBar = isInjSpringDecisionBar && trendCandidate?.reasons.includes("inj-spring-cash");
        if (rebalance || forceInjSpringCashEntryBar) {
            if (mode === "BASELINE") {
                if (!position.side || position.side === "trend") {
                    if (trendCandidate?.eligible && trendCandidate.symbol) {
                        const changed = position.symbol !== trendCandidate.symbol || position.side !== "trend";
                        if (changed && position.side) {
                            const exitSymbol = position.symbol;
                            cash = exitPosition(
                                position,
                                (exitSymbol ? execRaw[exitSymbol]?.open : null) || position.entryPrice,
                                ts,
                                executionIndex,
                                "rebalance-switch",
                                cash,
                                tradeEvents,
                                tradePairs,
                                baselinePreset.feeRate,
                                options,
                            );
                        }
                        if (!position.side) {
                            const tradeId = nextTradeId(mode, tradeCount);
                            const entryBar = execRaw[trendCandidate.symbol];
                            if (entryBar) {
                                const result = enterPosition(
                                    position,
                                    "trend",
                                    trendCandidate.symbol,
                                    entryBar.open,
                                    ts,
                                    executionIndex,
                                    `baseline-${trendCandidate.reasons.join("|")}`,
                                    tradeEvents,
                                    tradeId,
                                    cash,
                                    baselinePreset.feeRate,
                                );
                                cash = result.cash;
                                if (result.opened) tradeCount += 1;
                            }
                        }
                    }
                }
            } else {
                const protectStrictExtraHold =
                    options.strictExtraTrendHoldUntilExit === true
                    && isStrictExtraTrendSymbol(position.symbol, options);
                const currentStrictExtraEval = isStrictExtraTrendSymbol(position.symbol, options)
                    ? buildTrendEvaluationsForSymbols(
                        effectiveSnapshot,
                        strictExtraDecisionIndicators as Record<string, IndicatorBar[]>,
                        position.symbol ? [position.symbol] : [],
                        strictExtraDecisionOptions(options),
                    )[0] ?? null
                    : null;
                const guardStrictExtraSwitch = shouldBlockStrictExtraTrendSwitch(
                    position,
                    currentStrictExtraEval,
                    trendCandidate,
                    position.symbol ? execRaw[position.symbol]?.close ?? null : null,
                    options,
                );
                const currentIdleBreakoutEval = isIdleBreakoutEntry(position)
                    ? buildTrendEvaluationsForSymbols(
                        effectiveSnapshot,
                        indicators,
                        position.symbol ? [position.symbol] : [],
                        baseTrendOptions,
                    )[0] ?? null
                    : null;
                const guardIdleBreakoutSwitch = shouldBlockIdleBreakoutTrendSwitch(
                    position,
                    currentIdleBreakoutEval,
                    trendCandidate,
                    position.symbol ? execRaw[position.symbol]?.close ?? null : null,
                    options,
                );
                const convertStrictExtraSwitchToCash = shouldConvertStrictExtraTrendSwitchToCash(
                    position,
                    trendCandidate,
                    position.symbol ? execRaw[position.symbol]?.close ?? null : null,
                    options,
                );
                let skipSameBarEntryAfterCashSwitch = false;
                if (convertStrictExtraSwitchToCash && !rotatedToPenguOffRotation && !rotatedToTrend && !rotatedToStrictExtra && position.side === "trend" && trendCandidate?.eligible && position.symbol !== trendCandidate.symbol) {
                    const exitSymbol = position.symbol;
                    cash = exitPosition(
                        position,
                        (exitSymbol ? execRaw[exitSymbol]?.open : null) || position.entryPrice,
                        ts,
                        executionIndex,
                        "strict-extra-switch-cash",
                        cash,
                        tradeEvents,
                        tradePairs,
                        baselinePreset.feeRate,
                        options,
                    );
                    skipSameBarEntryAfterCashSwitch = true;
                } else if (!protectStrictExtraHold && !guardStrictExtraSwitch && !guardIdleBreakoutSwitch && !rotatedToPenguOffRotation && !rotatedToTrend && !rotatedToStrictExtra && position.side === "trend" && trendCandidate?.eligible && position.symbol !== trendCandidate.symbol) {
                    const exitSymbol = position.symbol;
                    cash = exitPosition(
                        position,
                        (exitSymbol ? execRaw[exitSymbol]?.open : null) || position.entryPrice,
                        ts,
                        executionIndex,
                        "trend-switch",
                        cash,
                        tradeEvents,
                        tradePairs,
                        baselinePreset.feeRate,
                        options,
                    );
                }

                if (!position.side && !rotatedToPenguOffRotation) {
                    let reenteredAfterIdleEarlyTrail = false;
                    if (lastIdleEarlyTrailExit) {
                        const reentryConfig = options.idleBreakoutEarlyTrailReentryBySymbol?.[lastIdleEarlyTrailExit.symbol.toUpperCase()];
                        const reentryBar = execRaw[lastIdleEarlyTrailExit.symbol];
                        const barsAfterEarlyTrail = elapsedBars(lastIdleEarlyTrailExit.ts, ts, lastIdleEarlyTrailExit.entryBarMs);
                        const reentryReferencePrice = reentryConfig?.referencePrice === "peak"
                            ? Math.max(lastIdleEarlyTrailExit.peakPrice, lastIdleEarlyTrailExit.price)
                            : lastIdleEarlyTrailExit.price;
                        const canReenter =
                            reentryConfig &&
                            reentryBar &&
                            barsAfterEarlyTrail > 0 &&
                            (reentryConfig.maxBarsAfterExit == null || barsAfterEarlyTrail <= reentryConfig.maxBarsAfterExit) &&
                            reentryBar.high >= reentryReferencePrice * (1 + reentryConfig.reentryPct);
                        if (canReenter && reentryConfig && reentryBar) {
                            const tradeId = nextTradeId(mode, tradeCount);
                            const result = enterPosition(
                                position,
                                "trend",
                                lastIdleEarlyTrailExit.symbol,
                                Math.max(reentryBar.open, reentryReferencePrice * (1 + reentryConfig.reentryPct)),
                                ts,
                                executionIndex,
                                `idle-breakout-early-trail-reentry|from=${new Date(lastIdleEarlyTrailExit.ts).toISOString()}|reentryPct=${reentryConfig.reentryPct}|reference=${reentryConfig.referencePrice ?? "exit"}`,
                                tradeEvents,
                                tradeId,
                                cash,
                                baselinePreset.feeRate,
                                options,
                                {
                                    subVariant: "idle-breakout-reentry",
                                    entryBarMs: lastIdleEarlyTrailExit.entryBarMs,
                                },
                            );
                            cash = result.cash;
                            if (result.opened) {
                                tradeCount += 1;
                                reenteredAfterIdleEarlyTrail = true;
                                lastTrendCandidate = lastIdleEarlyTrailExit.symbol;
                                lastIdleEarlyTrailExit = null;
                            }
                        } else if (reentryConfig && reentryConfig.maxBarsAfterExit != null && barsAfterEarlyTrail > reentryConfig.maxBarsAfterExit) {
                            lastIdleEarlyTrailExit = null;
                        }
                    }
                    if (!reenteredAfterIdleEarlyTrail && lastIdlePartialRunnerExit) {
                        const reentryConfig = options.idleBreakoutPartialRunnerReentryBySymbol?.[lastIdlePartialRunnerExit.symbol.toUpperCase()];
                        const reentryBar = execRaw[lastIdlePartialRunnerExit.symbol];
                        const barsAfterRunnerTrail = elapsedBars(lastIdlePartialRunnerExit.ts, ts, lastIdlePartialRunnerExit.entryBarMs);
                        const canReenter =
                            reentryConfig &&
                            reentryBar &&
                            barsAfterRunnerTrail > 0 &&
                            (reentryConfig.maxBarsAfterExit == null || barsAfterRunnerTrail <= reentryConfig.maxBarsAfterExit) &&
                            reentryBar.high >= lastIdlePartialRunnerExit.price * (1 + reentryConfig.reentryPct);
                        if (canReenter && reentryConfig && reentryBar) {
                            const tradeId = nextTradeId(mode, tradeCount);
                            const result = enterPosition(
                                position,
                                "trend",
                                lastIdlePartialRunnerExit.symbol,
                                Math.max(reentryBar.open, lastIdlePartialRunnerExit.price * (1 + reentryConfig.reentryPct)),
                                ts,
                                executionIndex,
                                `idle-breakout-partial-runner-reentry|from=${new Date(lastIdlePartialRunnerExit.ts).toISOString()}|reentryPct=${reentryConfig.reentryPct}`,
                                tradeEvents,
                                tradeId,
                                cash,
                                baselinePreset.feeRate,
                                options,
                                {
                                    subVariant: "idle-breakout-reentry",
                                    entryBarMs: lastIdlePartialRunnerExit.entryBarMs,
                                    alloc: reentryConfig.alloc ?? lastIdlePartialRunnerExit.alloc,
                                },
                            );
                            cash = result.cash;
                            if (result.opened) {
                                tradeCount += 1;
                                reenteredAfterIdleEarlyTrail = true;
                                lastTrendCandidate = lastIdlePartialRunnerExit.symbol;
                                lastIdlePartialRunnerExit = null;
                            }
                        } else if (reentryConfig && reentryConfig.maxBarsAfterExit != null && barsAfterRunnerTrail > reentryConfig.maxBarsAfterExit) {
                            lastIdlePartialRunnerExit = null;
                        }
                    }
                    const trendAllowed = !skipSameBarEntryAfterCashSwitch && trendCandidate?.eligible;
                    if (!reenteredAfterIdleEarlyTrail && trendAllowed && trendCandidate) {
                        const isIdleBreakoutTrendEntry = trendCandidate.reasons.includes("idle-breakout-entry");
                        const isIdleNightBreakoutTrendEntry = trendCandidate.reasons.includes("idle-breakout-night-entry");
                        const isInjSpringTrendEntry = trendCandidate.reasons.includes("inj-spring-cash");
                        const tradeId = nextTradeId(mode, tradeCount);
                        const entryBar = execRaw[trendCandidate.symbol];
                        if (entryBar && !isSmallWalletEntryGuardBlocked(trendCandidate.symbol, cash, options)) {
                            const entryPrice = isInjSpringTrendEntry
                                ? entryBar.open * (1 + (options.injSpringCashQuoteCostPct ?? 0))
                                : entryBar.open;
                            const result = enterPosition(
                                position,
                                "trend",
                                trendCandidate.symbol,
                                entryPrice,
                                ts,
                                executionIndex,
                                `trend-${trendCandidate.reasons.join("|")}`,
                                tradeEvents,
                                tradeId,
                                cash,
                                baselinePreset.feeRate,
                                options,
                                isIdleBreakoutTrendEntry || isIdleNightBreakoutTrendEntry || isInjSpringTrendEntry
                                    ? {
                                        subVariant: isInjSpringTrendEntry
                                            ? "inj-spring-cash"
                                            : isIdleNightBreakoutTrendEntry
                                                ? "idle-breakout-night"
                                                : "idle-breakout",
                                        entryBarMs: isInjSpringTrendEntry
                                            ? HOUR_MS
                                            : timeframeToMs(isIdleNightBreakoutTrendEntry ? idleNightBreakoutTimeframe : idleBreakoutTimeframe),
                                        maxNotionalUsd: isIdleNightBreakoutTrendEntry ? options.idleNightBreakoutMaxNotionalUsd ?? null : null,
                                        ...entryStatsFromTrendCandidate(trendCandidate),
                                      }
                                    : undefined,
                            );
                            cash = result.cash;
                            if (result.opened) tradeCount += 1;
                            lastTrendCandidate = trendCandidate.symbol;
                        }
                    } else if (rangeCandidate?.eligible) {
                        const tradeId = nextTradeId(mode, tradeCount);
                        const entryBar = execRaw[rangeCandidate.symbol];
                        if (entryBar) {
                            const result = enterPosition(
                                position,
                                "range",
                                rangeCandidate.symbol,
                                entryBar.open,
                                ts,
                                executionIndex,
                                `range-${rangeCandidate.reasons.join("|")}`,
                                tradeEvents,
                                tradeId,
                                cash,
                                baselinePreset.feeRate,
                                options,
                                {
                                    subVariant: rangeCandidate.subVariant,
                                    alloc: rangeCandidate.alloc,
                                    rangeExitMom20Above: rangeCandidate.exitMom20Above,
                                    rangeMaxHoldBars: rangeCandidate.maxHoldBars,
                                },
                            );
                            cash = result.cash;
                            if (result.opened) tradeCount += 1;
                        }
                    }
                } else if (position.side === "range" && trendCandidate?.eligible) {
                    const exitSymbol = position.symbol;
                    cash = exitPosition(
                        position,
                        (exitSymbol ? execRaw[exitSymbol]?.open : null) || position.entryPrice,
                        ts,
                        executionIndex,
                        "range-to-trend",
                        cash,
                        tradeEvents,
                        tradePairs,
                        baselinePreset.feeRate,
                        options,
                    );
                    const tradeId = nextTradeId(mode, tradeCount);
                    const entryBar = execRaw[trendCandidate.symbol];
                    if (entryBar) {
                        const result = enterPosition(
                            position,
                            "trend",
                            trendCandidate.symbol,
                            entryBar.open,
                            ts,
                            executionIndex,
                            `trend-over-range-${trendCandidate.reasons.join("|")}`,
                            tradeEvents,
                            tradeId,
                            cash,
                            baselinePreset.feeRate,
                            options,
                        );
                        cash = result.cash;
                        if (result.opened) tradeCount += 1;
                    }
                }
            }
        }

        if (
            mode === "RETQ22" &&
            !rebalance &&
            !position.side &&
            (isIdleBreakoutDecisionBar || isIdleNightBreakoutDecisionBar) &&
            trendCandidate?.eligible &&
            (trendCandidate.reasons.includes("idle-breakout-entry") || trendCandidate.reasons.includes("idle-breakout-night-entry"))
        ) {
            const isIdleNightBreakoutTrendEntry = trendCandidate.reasons.includes("idle-breakout-night-entry");
            const tradeId = nextTradeId(mode, tradeCount);
            const entryBar = execRaw[trendCandidate.symbol];
            if (entryBar) {
                const result = enterPosition(
                    position,
                    "trend",
                    trendCandidate.symbol,
                    entryBar.open,
                    ts,
                    executionIndex,
                    `trend-${trendCandidate.reasons.join("|")}`,
                    tradeEvents,
                    tradeId,
                    cash,
                    baselinePreset.feeRate,
                    options,
                    {
                        subVariant: isIdleNightBreakoutTrendEntry ? "idle-breakout-night" : "idle-breakout",
                        entryBarMs: timeframeToMs(isIdleNightBreakoutTrendEntry ? idleNightBreakoutTimeframe : idleBreakoutTimeframe),
                        maxNotionalUsd: isIdleNightBreakoutTrendEntry ? options.idleNightBreakoutMaxNotionalUsd ?? null : null,
                        ...entryStatsFromTrendCandidate(trendCandidate),
                    },
                );
                cash = result.cash;
                if (result.opened) {
                    tradeCount += 1;
                    lastTrendCandidate = trendCandidate.symbol;
                }
            }
        }

        const evalBar = position.symbol ? currentBars[position.symbol] : null;
        const evalPrice = position.symbol ? (execRaw[position.symbol]?.close || position.entryPrice) : 0;
        const equityPoint = {
            ts,
            iso_time: formatIso(ts),
            equity: position.symbol ? markToMarket(position.qty, evalPrice, cash, baselinePreset.feeRate) : cash,
            cash,
            position_symbol: position.symbol || "CASH",
            position_side: position.side || "cash",
            position_qty: position.qty,
            position_entry_price: position.entryPrice,
        } satisfies EquityPoint;
        equityCurve.push(equityPoint);
        highWaterMark = Math.max(highWaterMark, equityPoint.equity);

        const bucketIso = formatIso(ts - 1);
        const monthKey = bucketIso.slice(0, 7);
        const yearKey = bucketIso.slice(0, 4);
        const monthBucket = monthlyBuckets.get(monthKey) || [];
        monthBucket.push(equityPoint);
        monthlyBuckets.set(monthKey, monthBucket);
        const yearBucket = annualBuckets.get(yearKey) || [];
        yearBucket.push(equityPoint);
        annualBuckets.set(yearKey, yearBucket);

        priorWeak2022Regime = snapshot.weak2022Regime;
        priorWeakMarketTrendBlockActive = isWeakMarketTrendBlockActive(rawEffectiveSnapshot, options);
    }

    if (position.side && position.symbol) {
        const lastTs = mergedLoopTimeline.at(-1) || Date.now();
        const lastRaw = currentPriceAt(bySymbol[position.symbol], lastTs);
        const exitPrice = lastRaw?.close || position.entryPrice;
        cash = exitPosition(
            position,
            exitPrice,
            lastTs,
            mergedLoopTimeline.length - 1,
            "end-of-test",
            cash,
            tradeEvents,
            tradePairs,
            baselinePreset.feeRate,
            options,
        );
        equityCurve.push({
            ts: lastTs,
            iso_time: formatIso(lastTs),
            equity: cash,
            cash,
            position_symbol: "CASH",
            position_side: "cash",
            position_qty: 0,
            position_entry_price: 0,
        });
    }

    const monthlyReturns = [...monthlyBuckets.entries()]
        .map(([period, points]) => {
            const first = points[0]?.equity || BASE_EQUITY;
            const last = points.at(-1)?.equity || first;
            return {
                period,
                start_equity: first,
                end_equity: last,
                return_pct: first > 0 ? ((last / first) - 1) * 100 : 0,
            } satisfies PeriodReturnRow;
        })
        .sort((left, right) => left.period.localeCompare(right.period));

    const annualReturns = [...annualBuckets.entries()]
        .map(([period, points]) => {
            const first = points[0]?.equity || BASE_EQUITY;
            const last = points.at(-1)?.equity || first;
            return {
                period,
                start_equity: first,
                end_equity: last,
                return_pct: first > 0 ? ((last / first) - 1) * 100 : 0,
            } satisfies PeriodReturnRow;
        })
        .sort((left, right) => left.period.localeCompare(right.period));

    const startEquity = equityCurve[0]?.equity || initialEquity;
    const endEquity = equityCurve.at(-1)?.equity || cash;
    const firstTs = equityCurve[0]?.ts || timeline[0] || Date.now();
    const lastTs = equityCurve.at(-1)?.ts || firstTs;
    const periodDays = Math.max(1, (lastTs - firstTs) / (24 * HOUR_MS));
    const cagrPct = (Math.pow(endEquity / startEquity, 365 / periodDays) - 1) * 100;
    const maxDrawdownPct = calcMaxDrawdownPct(equityCurve);
    const wins = tradePairs.filter((trade) => trade.net_pnl > 0).length;
    const grossWins = tradePairs.filter((trade) => trade.net_pnl > 0).reduce((acc, trade) => acc + trade.net_pnl, 0);
    const grossLosses = Math.abs(tradePairs.filter((trade) => trade.net_pnl <= 0).reduce((acc, trade) => acc + trade.net_pnl, 0));
    const symbolContribution = tradePairs.reduce<Record<string, number>>((acc, trade) => {
        acc[trade.symbol] = (acc[trade.symbol] || 0) + trade.net_pnl;
        return acc;
    }, {});
    const exposureBars = equityCurve.filter((point) => point.position_side !== "cash").length;
    const exposurePct = equityCurve.length ? (exposureBars / equityCurve.length) * 100 : 0;

    return {
        mode,
        label: options.label || (mode === "BASELINE" ? "current-logic" : "retq22-hybrid"),
        trade_events: tradeEvents,
        trade_pairs: tradePairs,
        equity_curve: equityCurve,
        annual_returns: annualReturns,
        monthly_returns: monthlyReturns,
        summary: {
            mode,
            start_equity: startEquity,
            end_equity: endEquity,
            cagr_pct: cagrPct,
            max_drawdown_pct: maxDrawdownPct,
            win_rate_pct: tradePairs.length ? (wins / tradePairs.length) * 100 : 0,
            profit_factor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0,
            trade_count: tradePairs.length,
            exposure_pct: exposurePct,
            annual_returns: annualReturns,
            monthly_returns: monthlyReturns,
            symbol_contribution: symbolContribution,
        },
    } satisfies BacktestResult;
}

export async function runDailyLead12hAssistBacktest(options: HybridVariantOptions = {}) {
    const baselinePreset = selectStrategyPreset("A_BALANCE");
    const { bySymbol } = await loadRawSeries();
    const indicators12h = buildIndicators(bySymbol);
    const indicators1d = buildIndicators1d(bySymbol);
    const timeline = indicators12h.BTC.filter((bar) => bar.ready).map((bar) => bar.ts);
    const tradeEvents: TradeEventRow[] = [];
    const tradePairs: TradePairRow[] = [];
    const equityCurve: EquityPoint[] = [];
    const monthlyBuckets = new Map<string, EquityPoint[]>();
    const annualBuckets = new Map<string, EquityPoint[]>();
    const position = createEmptyPosition();
    let cash = BASE_EQUITY;
    let tradeCount = 0;
    let highWaterMark = BASE_EQUITY;
    let priorWeakDailyRegime = false;
    const activeYears = options.activeYears ? new Set(options.activeYears) : null;

    for (let index = 0; index < timeline.length; index += 1) {
        const ts = timeline[index];
        if (activeYears && !activeYears.has(new Date(ts).getUTCFullYear())) {
            continue;
        }

        const dailySnapshot = buildRegimeSnapshot(ts, indicators1d);
        if (!dailySnapshot) continue;
        const effectiveDailySnapshot = applyVariantSnapshot(dailySnapshot, priorWeakDailyRegime, "BASELINE", options);

        const currentBars12h = {
            BTC: latestIndicatorAtOrBefore(indicators12h.BTC, ts)!,
            ETH: latestIndicatorAtOrBefore(indicators12h.ETH, ts)!,
            SOL: latestIndicatorAtOrBefore(indicators12h.SOL, ts)!,
            AVAX: latestIndicatorAtOrBefore(indicators12h.AVAX, ts)!,
        };
        const execRaw = buildExecRawMap(bySymbol, ts);

        const currentPositionRaw = position.symbol ? execRaw[position.symbol as keyof typeof execRaw] : null;
        const markPrice = position.symbol ? (currentPositionRaw?.open || position.entryPrice) : 0;
        const equity = markToMarket(position.qty, markPrice, cash, baselinePreset.feeRate);
        highWaterMark = Math.max(highWaterMark, equity);
        const drawdownPct = highWaterMark > 0 ? ((equity / highWaterMark) - 1) * 100 : 0;
        void drawdownPct;

        if (position.side) {
            const currentDailyBar = position.symbol
                ? latestIndicatorAtOrBefore(indicators1d[position.symbol as keyof typeof indicators1d], ts)
                : null;
            if (currentDailyBar) {
                const exitReason = buildExitReason(
                    effectiveDailySnapshot,
                    currentDailyBar,
                    position,
                    "BASELINE",
                    position.side,
                    position.entryTs,
                    ts,
                    position.entryBarMs,
                    false,
                    {
                        ...options,
                        trendExitSma: options.trendExitSma ?? 40,
                    },
                );
                if (exitReason) {
                    const price = currentPositionRaw?.open || position.entryPrice;
                    cash = exitPosition(
                        position,
                        price,
                        ts,
                        index,
                        exitReason,
                        cash,
                        tradeEvents,
                        tradePairs,
                        baselinePreset.feeRate,
                        options,
                    );
                }
            }
        }

        const dailyTrendCandidate = effectiveDailySnapshot.trendAllowed
            ? pickTrendCandidate(effectiveDailySnapshot, indicators1d, "BASELINE", options)
            : null;

        const assistCandidate = dailyTrendCandidate?.symbol
            ? buildEntryAssistCandidate(ts, dailyTrendCandidate.symbol as typeof TRADE_SYMBOLS[number], indicators12h, options)
            : null;

        const rebalance = index % REBALANCE_BARS === 0;
        if (rebalance) {
            if (position.side === "trend" && dailyTrendCandidate?.eligible && position.symbol !== dailyTrendCandidate.symbol) {
                cash = exitPosition(
                    position,
                    execRaw[position.symbol as keyof typeof execRaw]?.open || position.entryPrice,
                    ts,
                    index,
                    "daily-switch",
                    cash,
                    tradeEvents,
                    tradePairs,
                    baselinePreset.feeRate,
                    options,
                );
            }

            if (position.side === "trend" && !dailyTrendCandidate?.eligible) {
                cash = exitPosition(
                    position,
                    execRaw[position.symbol as keyof typeof execRaw]?.open || position.entryPrice,
                    ts,
                    index,
                    "daily-risk-off",
                    cash,
                    tradeEvents,
                    tradePairs,
                    baselinePreset.feeRate,
                    options,
                );
            }

            if (!position.side && dailyTrendCandidate?.eligible && assistCandidate?.eligible) {
                const tradeId = nextTradeId("BASELINE", tradeCount);
                const entryBar = execRaw[dailyTrendCandidate.symbol as keyof typeof execRaw];
                if (entryBar) {
                    const result = enterPosition(
                        position,
                        "trend",
                        dailyTrendCandidate.symbol,
                        entryBar.open,
                        ts,
                        index,
                        `daily-lead|${dailyTrendCandidate.reasons.join("|")}|${assistCandidate.reasons.join("|")}`,
                        tradeEvents,
                        tradeId,
                        cash,
                        baselinePreset.feeRate,
                        {
                            ...options,
                            trendAlloc: 1,
                            rangeAlloc: 0,
                        },
                    );
                    cash = result.cash;
                    if (result.opened) tradeCount += 1;
                }
            }
        }

        const evalPrice = position.symbol ? (execRaw[position.symbol as keyof typeof execRaw]?.close || position.entryPrice) : 0;
        const equityPoint = {
            ts,
            iso_time: formatIso(ts),
            equity: position.symbol ? markToMarket(position.qty, evalPrice, cash, baselinePreset.feeRate) : cash,
            cash,
            position_symbol: position.symbol || "CASH",
            position_side: position.side || "cash",
            position_qty: position.qty,
            position_entry_price: position.entryPrice,
        } satisfies EquityPoint;
        equityCurve.push(equityPoint);
        highWaterMark = Math.max(highWaterMark, equityPoint.equity);

        const bucketIso = formatIso(ts - 1);
        const monthKey = bucketIso.slice(0, 7);
        const yearKey = bucketIso.slice(0, 4);
        const monthBucket = monthlyBuckets.get(monthKey) || [];
        monthBucket.push(equityPoint);
        monthlyBuckets.set(monthKey, monthBucket);
        const yearBucket = annualBuckets.get(yearKey) || [];
        yearBucket.push(equityPoint);
        annualBuckets.set(yearKey, yearBucket);

        priorWeakDailyRegime = dailySnapshot.weak2022Regime;
    }

    if (position.side && position.symbol) {
        const lastTs = timeline.at(-1) || Date.now();
        const lastRaw = currentPriceAt(bySymbol[position.symbol as keyof typeof bySymbol], lastTs);
        const exitPrice = lastRaw?.close || position.entryPrice;
        cash = exitPosition(
            position,
            exitPrice,
            lastTs,
            timeline.length - 1,
            "end-of-test",
            cash,
            tradeEvents,
            tradePairs,
            baselinePreset.feeRate,
            options,
        );
        equityCurve.push({
            ts: lastTs,
            iso_time: formatIso(lastTs),
            equity: cash,
            cash,
            position_symbol: "CASH",
            position_side: "cash",
            position_qty: 0,
            position_entry_price: 0,
        });
    }

    const monthlyReturns = [...monthlyBuckets.entries()]
        .map(([period, points]) => {
            const first = points[0]?.equity || BASE_EQUITY;
            const last = points.at(-1)?.equity || first;
            return {
                period,
                start_equity: first,
                end_equity: last,
                return_pct: first > 0 ? ((last / first) - 1) * 100 : 0,
            } satisfies PeriodReturnRow;
        })
        .sort((left, right) => left.period.localeCompare(right.period));

    const annualReturns = [...annualBuckets.entries()]
        .map(([period, points]) => {
            const first = points[0]?.equity || BASE_EQUITY;
            const last = points.at(-1)?.equity || first;
            return {
                period,
                start_equity: first,
                end_equity: last,
                return_pct: first > 0 ? ((last / first) - 1) * 100 : 0,
            } satisfies PeriodReturnRow;
        })
        .sort((left, right) => left.period.localeCompare(right.period));

    const startEquity = equityCurve[0]?.equity || BASE_EQUITY;
    const endEquity = equityCurve.at(-1)?.equity || cash;
    const firstTs = equityCurve[0]?.ts || timeline[0] || Date.now();
    const lastTs = equityCurve.at(-1)?.ts || firstTs;
    const periodDays = Math.max(1, (lastTs - firstTs) / (24 * HOUR_MS));
    const cagrPct = (Math.pow(endEquity / startEquity, 365 / periodDays) - 1) * 100;
    const maxDrawdownPct = calcMaxDrawdownPct(equityCurve);
    const wins = tradePairs.filter((trade) => trade.net_pnl > 0).length;
    const grossWins = tradePairs.filter((trade) => trade.net_pnl > 0).reduce((acc, trade) => acc + trade.net_pnl, 0);
    const grossLosses = Math.abs(tradePairs.filter((trade) => trade.net_pnl <= 0).reduce((acc, trade) => acc + trade.net_pnl, 0));
    const symbolContribution = tradePairs.reduce<Record<string, number>>((acc, trade) => {
        acc[trade.symbol] = (acc[trade.symbol] || 0) + trade.net_pnl;
        return acc;
    }, {});
    const exposureBars = equityCurve.filter((point) => point.position_side !== "cash").length;
    const exposurePct = equityCurve.length ? (exposureBars / equityCurve.length) * 100 : 0;

    return {
        mode: "BASELINE",
        label: options.label || "daily-lead-12h-assist",
        trade_events: tradeEvents,
        trade_pairs: tradePairs,
        equity_curve: equityCurve,
        annual_returns: annualReturns,
        monthly_returns: monthlyReturns,
        summary: {
            mode: "BASELINE",
            start_equity: startEquity,
            end_equity: endEquity,
            cagr_pct: cagrPct,
            max_drawdown_pct: maxDrawdownPct,
            win_rate_pct: tradePairs.length ? (wins / tradePairs.length) * 100 : 0,
            profit_factor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0,
            trade_count: tradePairs.length,
            exposure_pct: exposurePct,
            annual_returns: annualReturns,
            monthly_returns: monthlyReturns,
            symbol_contribution: symbolContribution,
        },
    } satisfies BacktestResult;
}

interface MultiPositionLot {
    side: PositionSide;
    symbol: typeof TRADE_SYMBOLS[number];
    qty: number;
    entryPrice: number;
    entryTs: number;
    entryIndex: number;
    entryBarMs: number;
    entryReason: string;
    lotId: string;
    entryAlloc: number;
    entryStrategy: string;
}

function lotMarkToMarket(
    lots: MultiPositionLot[],
    execRaw: Record<typeof ALL_SYMBOLS[number], Candle1h | null>,
    cash: number,
    feeRate: number,
) {
    let equity = cash;
    for (const lot of lots) {
        const markPrice = execRaw[lot.symbol]?.open || lot.entryPrice;
        equity += lot.qty * markPrice * (1 - feeRate);
    }
    return equity;
}

function closeLot(
    lots: MultiPositionLot[],
    lotId: string,
    exitPrice: number,
    exitTs: number,
    exitIndex: number,
    exitReason: string,
    cash: number,
    tradeEvents: TradeEventRow[],
    tradePairs: TradePairRow[],
    feeRate: number,
) {
    const index = lots.findIndex((item) => item.lotId === lotId);
    if (index < 0) return cash;

    const lot = lots[index];
    const grossProceeds = lot.qty * exitPrice;
    const grossPnl = grossProceeds - (lot.qty * lot.entryPrice);
    const fee = (lot.qty * lot.entryPrice * feeRate) + (grossProceeds * feeRate);
    const netPnl = grossPnl - fee;
    cash += grossProceeds * (1 - feeRate);
    tradeEvents.push({
        time: formatIso(exitTs),
        symbol: lot.symbol,
        action: "exit",
        strategy_type: lot.side,
        sub_variant: lot.entryStrategy,
        alloc: lot.entryAlloc,
        price: exitPrice,
        qty: lot.qty,
        reason: exitReason,
        trade_id: lot.lotId,
    });
    tradePairs.push({
        trade_id: lot.lotId,
        strategy_type: lot.side,
        sub_variant: lot.entryStrategy,
        symbol: lot.symbol,
        entry_time: formatIso(lot.entryTs),
        exit_time: formatIso(exitTs),
        entry_price: lot.entryPrice,
        exit_price: exitPrice,
        qty: lot.qty,
        gross_pnl: grossPnl,
        fee,
        net_pnl: netPnl,
        holding_bars: Math.max(1, elapsedBars(lot.entryTs, exitTs, lot.entryBarMs)),
        entry_reason: lot.entryReason,
        exit_reason: exitReason,
    });
    lots.splice(index, 1);
    return cash;
}

function openLot(
    lots: MultiPositionLot[],
    symbol: typeof TRADE_SYMBOLS[number],
    entryPrice: number,
    entryTs: number,
    entryIndex: number,
    entryReason: string,
    alloc: number,
    tradeId: string,
    cash: number,
    tradeEvents: TradeEventRow[],
    feeRate: number,
) {
    const rule = DEFAULT_RULES[symbol];
    const notional = cash * alloc;
    const targetQty = notional / entryPrice;
    const qty = stepRound(targetQty, rule.stepSize);
    const entryNotional = qty * entryPrice;
    if (!Number.isFinite(qty) || qty <= 0 || entryNotional < rule.minNotional || qty < rule.minQty) {
        return { cash, opened: false };
    }

    cash -= entryNotional * (1 + feeRate);
    const lot: MultiPositionLot = {
        side: "trend",
        symbol,
        qty,
        entryPrice,
        entryTs,
        entryIndex,
        entryBarMs: 12 * HOUR_MS,
        entryReason,
        lotId: tradeId,
        entryAlloc: alloc,
        entryStrategy: "top2-trend",
    };
    lots.push(lot);
    tradeEvents.push({
        time: formatIso(entryTs),
        symbol,
        action: "enter",
        strategy_type: "trend",
        sub_variant: "top2-trend",
        alloc,
        price: entryPrice,
        qty,
        reason: entryReason,
        trade_id: tradeId,
    });
    return { cash, opened: true };
}

export async function runTop2TrendBacktest(options: HybridVariantOptions = {}) {
    const baselinePreset = selectStrategyPreset("A_BALANCE");
    const { bySymbol, indicators, timeline } = await loadInstrumentFrames();
    const tradeEvents: TradeEventRow[] = [];
    const tradePairs: TradePairRow[] = [];
    const equityCurve: EquityPoint[] = [];
    const monthlyBuckets = new Map<string, EquityPoint[]>();
    const annualBuckets = new Map<string, EquityPoint[]>();
    const lots: MultiPositionLot[] = [];
    const activeYears = options.activeYears ? new Set(options.activeYears) : null;

    let cash = BASE_EQUITY;
    let tradeCount = 0;
    let highWaterMark = BASE_EQUITY;
    let priorWeak2022Regime = false;

    for (let index = 0; index < timeline.length; index += 1) {
        const ts = timeline[index];
        if (activeYears && !activeYears.has(new Date(ts).getUTCFullYear())) {
            continue;
        }

        const snapshot = buildRegimeSnapshot(ts, indicators);
        if (!snapshot) continue;

        const effectiveSnapshot = applyVariantSnapshot(snapshot, priorWeak2022Regime, "RETQ22", options);
        const execRaw = buildExecRawMap(bySymbol, ts);
        const equity = lotMarkToMarket(lots, execRaw, cash, baselinePreset.feeRate);
        highWaterMark = Math.max(highWaterMark, equity);

        for (const lot of [...lots]) {
            const currentBar = latestIndicatorAtOrBefore(indicators[lot.symbol], ts);
            if (!currentBar) continue;
            const exitReason = buildExitReason(
                effectiveSnapshot,
                currentBar,
                {
                    ...createEmptyPosition(),
                    side: lot.side,
                    symbol: lot.symbol,
                    qty: lot.qty,
                    entryPrice: lot.entryPrice,
                    entryTs: lot.entryTs,
                    entryIndex: lot.entryIndex,
                    entryStrategy: lot.entryStrategy,
                    entryReason: lot.entryReason,
                    lotId: lot.lotId,
                    entryAlloc: lot.entryAlloc,
                },
                "RETQ22",
                lot.side,
                lot.entryTs,
                ts,
                lot.entryBarMs,
                snapshot.weak2022Regime && priorWeak2022Regime,
                options,
            );
            if (exitReason) {
                const price = execRaw[lot.symbol]?.open || lot.entryPrice;
                cash = closeLot(lots, lot.lotId, price, ts, index, exitReason, cash, tradeEvents, tradePairs, baselinePreset.feeRate);
            }
        }

        const rebalance = index % REBALANCE_BARS === 0;
        if (rebalance) {
            const desiredSymbols = effectiveSnapshot.trendAllowed
                ? buildTrendEvaluations(effectiveSnapshot, indicators, options)
                    .filter((item) => item.eligible)
                    .slice(0, 2)
                    .map((item) => item.symbol as typeof TRADE_SYMBOLS[number])
                : [];

            const currentSymbols = [...lots].map((lot) => lot.symbol).sort();
            const desiredSorted = [...desiredSymbols].sort();
            const needsRebalance =
                currentSymbols.length !== desiredSorted.length ||
                currentSymbols.some((symbol, symbolIndex) => symbol !== desiredSorted[symbolIndex]);

            if (needsRebalance) {
                for (const lot of [...lots]) {
                    const price = execRaw[lot.symbol]?.open || lot.entryPrice;
                    cash = closeLot(lots, lot.lotId, price, ts, index, "top2-rebalance", cash, tradeEvents, tradePairs, baselinePreset.feeRate);
                }

                if (desiredSymbols.length > 0) {
                    const allocPerLot = 1 / desiredSymbols.length;
                    for (const symbol of desiredSymbols) {
                        const entryBar = execRaw[symbol];
                        if (!entryBar) continue;
                        const tradeId = nextTradeId("RETQ22", tradeCount);
                        const result = openLot(
                            lots,
                            symbol,
                            entryBar.open,
                            ts,
                            index,
                            `top2-trend-${symbol}`,
                            allocPerLot,
                            tradeId,
                            cash,
                            tradeEvents,
                            baselinePreset.feeRate,
                        );
                        cash = result.cash;
                        if (result.opened) tradeCount += 1;
                    }
                }
            }
        }

        const evalEquity = lotMarkToMarket(lots, execRaw, cash, baselinePreset.feeRate);
        highWaterMark = Math.max(highWaterMark, evalEquity);
        const bucketIso = formatIso(ts - 1);
        const point: EquityPoint = {
            ts,
            iso_time: formatIso(ts),
            equity: evalEquity,
            cash,
            position_symbol: lots.length ? lots.map((lot) => lot.symbol).sort().join("+") : "CASH",
            position_side: lots.length ? "trend" : "cash",
            position_qty: lots.reduce((total, lot) => total + lot.qty, 0),
            position_entry_price: lots.length ? average(lots.map((lot) => lot.entryPrice)) : 0,
        };
        equityCurve.push(point);

        const monthKey = bucketIso.slice(0, 7);
        const yearKey = bucketIso.slice(0, 4);
        const monthBucket = monthlyBuckets.get(monthKey) || [];
        monthBucket.push(point);
        monthlyBuckets.set(monthKey, monthBucket);
        const yearBucket = annualBuckets.get(yearKey) || [];
        yearBucket.push(point);
        annualBuckets.set(yearKey, yearBucket);

        priorWeak2022Regime = snapshot.weak2022Regime;
    }

    if (lots.length) {
        const lastTs = timeline.at(-1) || Date.now();
        const execRaw = buildExecRawMap(bySymbol, lastTs);
        for (const lot of [...lots]) {
            const price = execRaw[lot.symbol]?.close || lot.entryPrice;
            cash = closeLot(lots, lot.lotId, price, lastTs, timeline.length - 1, "end-of-test", cash, tradeEvents, tradePairs, baselinePreset.feeRate);
        }
        equityCurve.push({
            ts: lastTs,
            iso_time: formatIso(lastTs),
            equity: cash,
            cash,
            position_symbol: "CASH",
            position_side: "cash",
            position_qty: 0,
            position_entry_price: 0,
        });
    }

    const monthlyReturns = [...monthlyBuckets.entries()]
        .map(([period, points]) => {
            const first = points[0]?.equity || BASE_EQUITY;
            const last = points.at(-1)?.equity || first;
            return {
                period,
                start_equity: first,
                end_equity: last,
                return_pct: first > 0 ? ((last / first) - 1) * 100 : 0,
            } satisfies PeriodReturnRow;
        })
        .sort((left, right) => left.period.localeCompare(right.period));

    const annualReturns = [...annualBuckets.entries()]
        .map(([period, points]) => {
            const first = points[0]?.equity || BASE_EQUITY;
            const last = points.at(-1)?.equity || first;
            return {
                period,
                start_equity: first,
                end_equity: last,
                return_pct: first > 0 ? ((last / first) - 1) * 100 : 0,
            } satisfies PeriodReturnRow;
        })
        .sort((left, right) => left.period.localeCompare(right.period));

    const startEquity = equityCurve[0]?.equity || BASE_EQUITY;
    const endEquity = equityCurve.at(-1)?.equity || cash;
    const firstTs = equityCurve[0]?.ts || timeline[0] || Date.now();
    const lastTs = equityCurve.at(-1)?.ts || firstTs;
    const periodDays = Math.max(1, (lastTs - firstTs) / (24 * HOUR_MS));
    const cagrPct = (Math.pow(endEquity / startEquity, 365 / periodDays) - 1) * 100;
    const maxDrawdownPct = calcMaxDrawdownPct(equityCurve);
    const wins = tradePairs.filter((trade) => trade.net_pnl > 0).length;
    const grossWins = tradePairs.filter((trade) => trade.net_pnl > 0).reduce((acc, trade) => acc + trade.net_pnl, 0);
    const grossLosses = Math.abs(tradePairs.filter((trade) => trade.net_pnl <= 0).reduce((acc, trade) => acc + trade.net_pnl, 0));
    const symbolContribution = tradePairs.reduce<Record<string, number>>((acc, trade) => {
        acc[trade.symbol] = (acc[trade.symbol] || 0) + trade.net_pnl;
        return acc;
    }, {});
    const exposureBars = equityCurve.filter((point) => point.position_side !== "cash").length;
    const exposurePct = equityCurve.length ? (exposureBars / equityCurve.length) * 100 : 0;

    return {
        mode: "RETQ22",
        label: options.label || "retq22-top2-trend",
        trade_events: tradeEvents,
        trade_pairs: tradePairs,
        equity_curve: equityCurve,
        annual_returns: annualReturns,
        monthly_returns: monthlyReturns,
        summary: {
            mode: "RETQ22",
            start_equity: startEquity,
            end_equity: endEquity,
            cagr_pct: cagrPct,
            max_drawdown_pct: maxDrawdownPct,
            win_rate_pct: tradePairs.length ? (wins / tradePairs.length) * 100 : 0,
            profit_factor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0,
            trade_count: tradePairs.length,
            exposure_pct: exposurePct,
            annual_returns: annualReturns,
            monthly_returns: monthlyReturns,
            symbol_contribution: symbolContribution,
        },
    } satisfies BacktestResult;
}

export async function runRetq22With1hEarlyEntryBacktest(options: HybridVariantOptions = {}) {
    const baselinePreset = selectStrategyPreset("A_BALANCE");
    const { bySymbol } = await loadRawSeries();
    const indicators12h = buildIndicators(bySymbol);
    const indicators1h = buildIndicators1h(bySymbol);
    const timeline = indicators1h.BTC.filter((bar) => bar.ready).map((bar) => bar.ts);
    const rebalanceSet = new Set(indicators12h.BTC.filter((bar) => bar.ready).map((bar) => bar.ts));
    const tradeEvents: TradeEventRow[] = [];
    const tradePairs: TradePairRow[] = [];
    const equityCurve: EquityPoint[] = [];
    const monthlyBuckets = new Map<string, EquityPoint[]>();
    const annualBuckets = new Map<string, EquityPoint[]>();
    const position = createEmptyPosition();
    const activeYears = options.activeYears ? new Set(options.activeYears) : null;

    let cash = BASE_EQUITY;
    let tradeCount = 0;
    let highWaterMark = BASE_EQUITY;

    for (let index = 0; index < timeline.length; index += 1) {
        const ts = timeline[index];
        if (activeYears && !activeYears.has(new Date(ts).getUTCFullYear())) {
            continue;
        }

        const current12hIndex = latestIndicatorIndexAtOrBefore(indicators12h.BTC, ts);
        if (current12hIndex < 0) continue;
        const previous12hTs = current12hIndex > 0 ? indicators12h.BTC[current12hIndex - 1].ts : null;
        const snapshot = buildRegimeSnapshot(ts, indicators12h);
        if (!snapshot) continue;
        const previousSnapshot = previous12hTs != null ? buildRegimeSnapshot(previous12hTs, indicators12h) : null;
        const effectiveSnapshot = applyVariantSnapshot(snapshot, Boolean(previousSnapshot?.weak2022Regime), "RETQ22", options);

        const execRaw = buildExecRawMap(bySymbol, ts);

        const currentPositionRaw = position.symbol ? execRaw[position.symbol as keyof typeof execRaw] : null;
        const markPrice = position.symbol ? (currentPositionRaw?.open || position.entryPrice) : 0;
        const equity = markToMarket(position.qty, markPrice, cash, baselinePreset.feeRate);
        highWaterMark = Math.max(highWaterMark, equity);

        const trendCandidate = effectiveSnapshot.trendAllowed
            ? pickTrendCandidate(effectiveSnapshot, indicators12h, "RETQ22", options)
            : null;

        const assistCandidate = trendCandidate?.symbol
            ? buildEntryAssistCandidate(ts, trendCandidate.symbol as typeof TRADE_SYMBOLS[number], indicators1h, {
                ...options,
                trendEntryAssistRequireMomentum: options.trendEntryAssistRequireMomentum ?? true,
                trendEntryAssistRequireCloseAboveSma: options.trendEntryAssistRequireCloseAboveSma ?? true,
            })
            : null;

        const rebalance = rebalanceSet.has(ts);
        if (rebalance && position.side) {
            const current12hBar = position.symbol
                ? latestIndicatorAtOrBefore(indicators12h[position.symbol as keyof typeof indicators12h], ts)
                : null;
            if (current12hBar) {
                const exitReason = buildExitReason(
                    effectiveSnapshot,
                    current12hBar,
                    position,
                    "RETQ22",
                    position.side,
                    position.entryTs,
                    ts,
                    position.entryBarMs,
                    snapshot.weak2022Regime && Boolean(previousSnapshot?.weak2022Regime),
                    options,
                );
                if (exitReason) {
                    const price = currentPositionRaw?.open || position.entryPrice;
                    cash = exitPosition(
                        position,
                        price,
                        ts,
                        current12hIndex,
                        exitReason,
                        cash,
                        tradeEvents,
                        tradePairs,
                        baselinePreset.feeRate,
                        options,
                    );
                }
            }
        }

        if (rebalance && position.side === "trend" && trendCandidate?.eligible && position.symbol !== trendCandidate.symbol) {
            cash = exitPosition(
                position,
                execRaw[position.symbol as keyof typeof execRaw]?.open || position.entryPrice,
                ts,
                current12hIndex,
                "trend-switch",
                cash,
                tradeEvents,
                tradePairs,
                baselinePreset.feeRate,
                options,
            );
        }

        if (!position.side && trendCandidate?.eligible && assistCandidate?.eligible) {
            const tradeId = nextTradeId("RETQ22", tradeCount);
            const entryBar = execRaw[trendCandidate.symbol as keyof typeof execRaw];
            if (entryBar) {
                const result = enterPosition(
                    position,
                    "trend",
                    trendCandidate.symbol,
                    entryBar.open,
                    ts,
                    current12hIndex,
                    `retq22-1h-entry|${trendCandidate.reasons.join("|")}|${assistCandidate.reasons.join("|")}`,
                    tradeEvents,
                    tradeId,
                    cash,
                    baselinePreset.feeRate,
                    options,
                    {
                        subVariant: "retq22-1h-entry",
                        alloc: 1,
                    },
                );
                cash = result.cash;
                if (result.opened) tradeCount += 1;
            }
        }

        const evalPrice = position.symbol ? (execRaw[position.symbol as keyof typeof execRaw]?.close || position.entryPrice) : 0;
        const equityPoint = {
            ts,
            iso_time: formatIso(ts),
            equity: position.symbol ? markToMarket(position.qty, evalPrice, cash, baselinePreset.feeRate) : cash,
            cash,
            position_symbol: position.symbol || "CASH",
            position_side: position.side || "cash",
            position_qty: position.qty,
            position_entry_price: position.entryPrice,
        } satisfies EquityPoint;
        equityCurve.push(equityPoint);
        highWaterMark = Math.max(highWaterMark, equityPoint.equity);

        const bucketIso = formatIso(ts - 1);
        const monthKey = bucketIso.slice(0, 7);
        const yearKey = bucketIso.slice(0, 4);
        const monthBucket = monthlyBuckets.get(monthKey) || [];
        monthBucket.push(equityPoint);
        monthlyBuckets.set(monthKey, monthBucket);
        const yearBucket = annualBuckets.get(yearKey) || [];
        yearBucket.push(equityPoint);
        annualBuckets.set(yearKey, yearBucket);
    }

    if (position.side && position.symbol) {
        const lastTs = timeline.at(-1) || Date.now();
        const lastRaw = currentPriceAt(bySymbol[position.symbol as keyof typeof bySymbol], lastTs);
        const exitPrice = lastRaw?.close || position.entryPrice;
        cash = exitPosition(
            position,
            exitPrice,
            lastTs,
            latestIndicatorIndexAtOrBefore(indicators12h.BTC, lastTs),
            "end-of-test",
            cash,
            tradeEvents,
            tradePairs,
            baselinePreset.feeRate,
            options,
        );
        equityCurve.push({
            ts: lastTs,
            iso_time: formatIso(lastTs),
            equity: cash,
            cash,
            position_symbol: "CASH",
            position_side: "cash",
            position_qty: 0,
            position_entry_price: 0,
        });
    }

    const monthlyReturns = [...monthlyBuckets.entries()]
        .map(([period, points]) => {
            const first = points[0]?.equity || BASE_EQUITY;
            const last = points.at(-1)?.equity || first;
            return {
                period,
                start_equity: first,
                end_equity: last,
                return_pct: first > 0 ? ((last / first) - 1) * 100 : 0,
            } satisfies PeriodReturnRow;
        })
        .sort((left, right) => left.period.localeCompare(right.period));

    const annualReturns = [...annualBuckets.entries()]
        .map(([period, points]) => {
            const first = points[0]?.equity || BASE_EQUITY;
            const last = points.at(-1)?.equity || first;
            return {
                period,
                start_equity: first,
                end_equity: last,
                return_pct: first > 0 ? ((last / first) - 1) * 100 : 0,
            } satisfies PeriodReturnRow;
        })
        .sort((left, right) => left.period.localeCompare(right.period));

    const startEquity = equityCurve[0]?.equity || BASE_EQUITY;
    const endEquity = equityCurve.at(-1)?.equity || cash;
    const firstTs = equityCurve[0]?.ts || timeline[0] || Date.now();
    const lastTs = equityCurve.at(-1)?.ts || firstTs;
    const periodDays = Math.max(1, (lastTs - firstTs) / (24 * HOUR_MS));
    const cagrPct = (Math.pow(endEquity / startEquity, 365 / periodDays) - 1) * 100;
    const maxDrawdownPct = calcMaxDrawdownPct(equityCurve);
    const wins = tradePairs.filter((trade) => trade.net_pnl > 0).length;
    const grossWins = tradePairs.filter((trade) => trade.net_pnl > 0).reduce((acc, trade) => acc + trade.net_pnl, 0);
    const grossLosses = Math.abs(tradePairs.filter((trade) => trade.net_pnl <= 0).reduce((acc, trade) => acc + trade.net_pnl, 0));
    const symbolContribution = tradePairs.reduce<Record<string, number>>((acc, trade) => {
        acc[trade.symbol] = (acc[trade.symbol] || 0) + trade.net_pnl;
        return acc;
    }, {});
    const exposureBars = equityCurve.filter((point) => point.position_side !== "cash").length;
    const exposurePct = equityCurve.length ? (exposureBars / equityCurve.length) * 100 : 0;

    return {
        mode: "RETQ22",
        label: options.label || "retq22-1h-early-entry",
        trade_events: tradeEvents,
        trade_pairs: tradePairs,
        equity_curve: equityCurve,
        annual_returns: annualReturns,
        monthly_returns: monthlyReturns,
        summary: {
            mode: "RETQ22",
            start_equity: startEquity,
            end_equity: endEquity,
            cagr_pct: cagrPct,
            max_drawdown_pct: maxDrawdownPct,
            win_rate_pct: tradePairs.length ? (wins / tradePairs.length) * 100 : 0,
            profit_factor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0,
            trade_count: tradePairs.length,
            exposure_pct: exposurePct,
            annual_returns: annualReturns,
            monthly_returns: monthlyReturns,
            symbol_contribution: symbolContribution,
        },
    } satisfies BacktestResult;
}

export async function runExpandedUniverseBacktest(options: HybridVariantOptions = {}) {
    const baselinePreset = selectStrategyPreset("A_BALANCE");
    const candidateSymbols = options.expandedTrendSymbols?.length
        ? options.expandedTrendSymbols
        : EXPANDED_TREND_SYMBOLS;
    const universeSymbols = ["BTC", ...candidateSymbols] as const;
    const { bySymbol } = await loadRawSeriesForUniverse(universeSymbols);
    const indicators = buildIndicatorsForUniverse(bySymbol);
    const timeline = indicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts);
    const tradeEvents: TradeEventRow[] = [];
    const tradePairs: TradePairRow[] = [];
    const equityCurve: EquityPoint[] = [];
    const monthlyBuckets = new Map<string, EquityPoint[]>();
    const annualBuckets = new Map<string, EquityPoint[]>();
    const position = createEmptyPosition();
    const activeYears = options.activeYears ? new Set(options.activeYears) : null;

    let cash = BASE_EQUITY;
    let tradeCount = 0;
    let highWaterMark = BASE_EQUITY;
    let priorWeak2022Regime = false;

    for (let index = 0; index < timeline.length; index += 1) {
        const ts = timeline[index];
        if (activeYears && !activeYears.has(new Date(ts).getUTCFullYear())) {
            continue;
        }

        const btc = latestIndicatorAtOrBefore(indicators.BTC, ts);
        const eth = latestIndicatorAtOrBefore(indicators.ETH, ts);
        const sol = latestIndicatorAtOrBefore(indicators.SOL, ts);
        const avax = latestIndicatorAtOrBefore(indicators.AVAX, ts);
        if (!btc || !eth || !sol || !avax || !btc.ready || !eth.ready || !sol.ready || !avax.ready) continue;

        const snapshot = buildRegimeSnapshot(ts, {
            BTC: indicators.BTC,
            ETH: indicators.ETH,
            SOL: indicators.SOL,
            AVAX: indicators.AVAX,
        } as Record<TradeSymbol, IndicatorBar[]>);
        if (!snapshot) continue;

        const effectiveSnapshot = applyVariantSnapshot(snapshot, priorWeak2022Regime, "RETQ22", options);
        const execRaw = Object.fromEntries(
            universeSymbols.map((symbol) => [symbol, currentPriceAt(bySymbol[symbol], ts)]),
        ) as Record<string, Candle1h | null>;

        const currentPositionRaw = position.symbol ? execRaw[position.symbol as keyof typeof execRaw] : null;
        const markPrice = position.symbol ? (currentPositionRaw?.open || position.entryPrice) : 0;
        const equity = markToMarket(position.qty, markPrice, cash, baselinePreset.feeRate);
        highWaterMark = Math.max(highWaterMark, equity);
        const drawdownPct = highWaterMark > 0 ? ((equity / highWaterMark) - 1) * 100 : 0;

        if (position.side && position.symbol && isTrendSymbolBlocked(position.symbol, ts, options)) {
            cash = exitPosition(
                position,
                currentPositionRaw?.open || position.entryPrice,
                ts,
                index,
                "symbol-block-window",
                cash,
                tradeEvents,
                tradePairs,
                baselinePreset.feeRate,
                options,
            );
        }

        if (position.side && position.symbol) {
            const currentBar = latestIndicatorAtOrBefore(indicators[position.symbol], ts);
            if (currentBar) {
                const exitReason = buildExitReason(
                    effectiveSnapshot,
                    currentBar,
                    position,
                    "RETQ22",
                    position.side,
                    position.entryTs,
                    ts,
                    position.entryBarMs,
                    snapshot.weak2022Regime && priorWeak2022Regime,
                    options,
                );
                const ddExit = position.side === "trend" && effectiveSnapshot.weak2022Regime && snapshot.regimeLabel === "trend_weak" && drawdownPct <= -22;
                if (exitReason || ddExit) {
                    const price = currentPositionRaw?.open || position.entryPrice;
                    cash = exitPosition(
                        position,
                        price,
                        ts,
                        index,
                        exitReason || "dd22-balanced",
                        cash,
                        tradeEvents,
                        tradePairs,
                        baselinePreset.feeRate,
                        options,
                    );
                }
            }
        }

        const tradeReady = effectiveSnapshot.trendAllowed || effectiveSnapshot.rangeAllowed;
        const trendCandidate = tradeReady
            ? buildTrendEvaluationsForSymbols(effectiveSnapshot, indicators, candidateSymbols, options)
                .filter((item) => !isTrendSymbolBlocked(item.symbol, ts, options, effectiveSnapshot))
                .find((item) => item.eligible) ?? null
            : null;

        const rebalance = index % REBALANCE_BARS === 0;
        if (rebalance) {
            if (position.side === "trend" && trendCandidate?.eligible && position.symbol !== trendCandidate.symbol) {
                cash = exitPosition(
                    position,
                    execRaw[position.symbol as keyof typeof execRaw]?.open || position.entryPrice,
                    ts,
                    index,
                    "trend-switch",
                    cash,
                    tradeEvents,
                    tradePairs,
                    baselinePreset.feeRate,
                    options,
                );
            }

            if (!position.side && trendCandidate?.eligible) {
                const tradeId = nextTradeId("RETQ22", tradeCount);
                const entryBar = execRaw[trendCandidate.symbol];
                const rule = EXTENDED_RULES[trendCandidate.symbol];
                if (entryBar && rule) {
                    const targetQty = (cash * 1) / entryBar.open;
                    const qty = stepRound(targetQty, rule.stepSize);
                    const entryNotional = qty * entryBar.open;
                    if (Number.isFinite(qty) && qty > 0 && entryNotional >= rule.minNotional && qty >= rule.minQty) {
                        cash -= entryNotional * (1 + baselinePreset.feeRate);
                        position.side = "trend";
                        position.symbol = trendCandidate.symbol;
                        position.qty = qty;
                        position.entryPrice = entryBar.open;
                        position.entryTs = ts;
                        position.entryIndex = index;
                        position.entryStrategy = "expanded-universe";
                        position.entryReason = `expanded-trend-${trendCandidate.reasons.join("|")}`;
                        position.lotId = tradeId;
                        position.entryAlloc = 1;
                        tradeEvents.push({
                            time: formatIso(ts),
                            symbol: trendCandidate.symbol,
                            action: "enter",
                            strategy_type: "trend",
                            sub_variant: "expanded-universe",
                            alloc: 1,
                            price: entryBar.open,
                            qty,
                            reason: position.entryReason,
                            trade_id: tradeId,
                        });
                        tradeCount += 1;
                    }
                }
            }
        }

        const evalPrice = position.symbol ? (execRaw[position.symbol as keyof typeof execRaw]?.close || position.entryPrice) : 0;
        const equityPoint = {
            ts,
            iso_time: formatIso(ts),
            equity: position.symbol ? markToMarket(position.qty, evalPrice, cash, baselinePreset.feeRate) : cash,
            cash,
            position_symbol: position.symbol || "CASH",
            position_side: position.side || "cash",
            position_qty: position.qty,
            position_entry_price: position.entryPrice,
        } satisfies EquityPoint;
        equityCurve.push(equityPoint);
        highWaterMark = Math.max(highWaterMark, equityPoint.equity);

        const bucketIso = formatIso(ts - 1);
        const monthKey = bucketIso.slice(0, 7);
        const yearKey = bucketIso.slice(0, 4);
        const monthBucket = monthlyBuckets.get(monthKey) || [];
        monthBucket.push(equityPoint);
        monthlyBuckets.set(monthKey, monthBucket);
        const yearBucket = annualBuckets.get(yearKey) || [];
        yearBucket.push(equityPoint);
        annualBuckets.set(yearKey, yearBucket);

        priorWeak2022Regime = snapshot.weak2022Regime;
    }

    if (position.side && position.symbol) {
        const lastTs = timeline.at(-1) || Date.now();
        const lastRaw = currentPriceAt(bySymbol[position.symbol], lastTs);
        const exitPrice = lastRaw?.close || position.entryPrice;
        cash = exitPosition(
            position,
            exitPrice,
            lastTs,
            timeline.length - 1,
            "end-of-test",
            cash,
            tradeEvents,
            tradePairs,
            baselinePreset.feeRate,
            options,
        );
        equityCurve.push({
            ts: lastTs,
            iso_time: formatIso(lastTs),
            equity: cash,
            cash,
            position_symbol: "CASH",
            position_side: "cash",
            position_qty: 0,
            position_entry_price: 0,
        });
    }

    const monthlyReturns = [...monthlyBuckets.entries()]
        .map(([period, points]) => {
            const first = points[0]?.equity || BASE_EQUITY;
            const last = points.at(-1)?.equity || first;
            return {
                period,
                start_equity: first,
                end_equity: last,
                return_pct: first > 0 ? ((last / first) - 1) * 100 : 0,
            } satisfies PeriodReturnRow;
        })
        .sort((left, right) => left.period.localeCompare(right.period));

    const annualReturns = [...annualBuckets.entries()]
        .map(([period, points]) => {
            const first = points[0]?.equity || BASE_EQUITY;
            const last = points.at(-1)?.equity || first;
            return {
                period,
                start_equity: first,
                end_equity: last,
                return_pct: first > 0 ? ((last / first) - 1) * 100 : 0,
            } satisfies PeriodReturnRow;
        })
        .sort((left, right) => left.period.localeCompare(right.period));

    const startEquity = equityCurve[0]?.equity || BASE_EQUITY;
    const endEquity = equityCurve.at(-1)?.equity || cash;
    const firstTs = equityCurve[0]?.ts || timeline[0] || Date.now();
    const lastTs = equityCurve.at(-1)?.ts || firstTs;
    const periodDays = Math.max(1, (lastTs - firstTs) / (24 * HOUR_MS));
    const cagrPct = (Math.pow(endEquity / startEquity, 365 / periodDays) - 1) * 100;
    const maxDrawdownPct = calcMaxDrawdownPct(equityCurve);
    const wins = tradePairs.filter((trade) => trade.net_pnl > 0).length;
    const grossWins = tradePairs.filter((trade) => trade.net_pnl > 0).reduce((acc, trade) => acc + trade.net_pnl, 0);
    const grossLosses = Math.abs(tradePairs.filter((trade) => trade.net_pnl <= 0).reduce((acc, trade) => acc + trade.net_pnl, 0));
    const symbolContribution = tradePairs.reduce<Record<string, number>>((acc, trade) => {
        acc[trade.symbol] = (acc[trade.symbol] || 0) + trade.net_pnl;
        return acc;
    }, {});
    const exposureBars = equityCurve.filter((point) => point.position_side !== "cash").length;
    const exposurePct = equityCurve.length ? (exposureBars / equityCurve.length) * 100 : 0;

    return {
        mode: "RETQ22",
        label: options.label || "retq22-expanded-universe",
        trade_events: tradeEvents,
        trade_pairs: tradePairs,
        equity_curve: equityCurve,
        annual_returns: annualReturns,
        monthly_returns: monthlyReturns,
        summary: {
            mode: "RETQ22",
            start_equity: startEquity,
            end_equity: endEquity,
            cagr_pct: cagrPct,
            max_drawdown_pct: maxDrawdownPct,
            win_rate_pct: tradePairs.length ? (wins / tradePairs.length) * 100 : 0,
            profit_factor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0,
            trade_count: tradePairs.length,
            exposure_pct: exposurePct,
            annual_returns: annualReturns,
            monthly_returns: monthlyReturns,
            symbol_contribution: symbolContribution,
        },
    } satisfies BacktestResult;
}

export async function runHybridComparison() {
    const baseline = await runHybridBacktest("BASELINE");
    const retq22 = await runHybridBacktest("RETQ22");
    return { baseline, retq22 };
}
