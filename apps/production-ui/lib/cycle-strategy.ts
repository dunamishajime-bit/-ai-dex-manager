import { CANDIDATE_SCORE_MAX, CANDIDATE_SCORE_MAX_TOTAL, STRATEGY_CONFIG, type StrategyTier } from "@/config/strategyConfig";
import { BOT_CONFIG } from "@/config/botConfig";
import { STRATEGY_UNIVERSE_SEEDS, type StrategyUniverseChain, type StrategyUniverseSeed } from "@/config/strategyUniverse";
import { TRADE_CONFIG } from "@/config/tradeConfig";
import { isAutoTradeExcludedExecutionTarget } from "@/lib/proxy-assets";

function normalizeTrackedSymbol(symbol: string): string {
    return String(symbol || "").trim().toUpperCase();
}

export const CYCLE_BLOCKS = ["0:00-6:00", "6:00-12:00", "12:00-18:00", "18:00-24:00"] as const;

export type CycleBlock = (typeof CYCLE_BLOCKS)[number];
export type TradeMode = "TREND" | "MEAN_REVERSION";
export type CandidateRank = "A" | "B" | "C" | "D";
export type CandidateSelectionStage = "SELECTED" | "VETO" | "SCORE" | "CORRELATION" | "RESERVE";
export type CandidateExecutionStatus = "Pass" | "VETO NG" | "Route Missing" | "Seed Fallback" | "Data Missing";
export type CandidateTradeDecision = "Selected" | "Half-size Eligible" | "Watchlist" | "Blocked";
export type CandidatePositionSizeLabel = "0.5x" | "0.3x" | "0.2x" | "0x";
export type CandidateRrStatus = "OK" | "Weak" | "NG";
export type CandidateResistanceStatus = "Open" | "Tight" | "Blocked";
export type StrategyRegime = "Trend" | "Range" | "No-trade";
export type StrategyTriggerType =
    | "Breakout"
    | "Pullback Resume"
    | "Retest Success"
    | "VWAP Reclaim"
    | "Support Bounce"
    | "VWAP Mean Reclaim"
    | "Retest Bounce"
    | "Range Reversal"
    | "None";
export type StrategyTriggerState = "Ready" | "Armed" | "Triggered" | "Executed" | "Cooldown";
export type StrategyOrderGateStatus = "armed" | "slot" | "blocked";
export type CandidateStatus =
    | "Selected"
    | "Watchlist"
    | "Below Threshold"
    | "VETO Rejected"
    | "Correlation Rejected"
    | "Data Missing";

export interface PriceSample {
    ts: number;
    price: number;
}

export interface MarketSnapshot {
    price: number;
    change24h?: number;
    chain?: StrategyUniverseChain;
    displaySymbol?: string;
    volume?: number;
    liquidity?: number;
    spreadBps?: number;
    marketCap?: number;
    tokenAgeDays?: number;
    txns1h?: number;
    dexPairFound?: boolean;
    contractAddress?: string;
    dexPairUrl?: string;
    executionSupported?: boolean;
    executionChain?: StrategyUniverseChain;
    executionChainId?: number;
    executionAddress?: string;
    executionDecimals?: number;
    executionRouteKind?: "native" | "proxy" | "cross-chain";
    executionSource?: string;
    executionPairUrl?: string;
    executionLiquidityUsd?: number;
    executionVolume24hUsd?: number;
    executionTxns1h?: number;
    source?: string;
}

export interface ExistingPosition {
    symbol: string;
    amount: number;
    entryPrice: number;
}

export interface ContinuousMonitorRuntimeState {
    openSymbols?: string[];
    pendingSymbols?: string[];
    recentTrades?: Array<{
        symbol: string;
        action: "BUY" | "SELL";
        timestamp: number;
    }>;
}

export interface CyclePerformanceSnapshot {
    symbol: string;
    block: CycleBlock;
    trades: number;
    winRate: number;
    expectancyPct: number;
}

export interface UniverseAsset {
    symbol: string;
    displaySymbol: string;
    chain: StrategyUniverseChain;
    providerId: string;
    tier?: StrategyTier;
    price: number;
    change24h: number;
    liquidity: number;
    volume24h: number;
    spreadBps: number;
    marketCap: number;
    tokenAgeDays: number;
    txns1h: number;
    dexPairFound: boolean;
    historyBars: number;
    dataCompleteness: number;
    stabilityScore: number;
    priceDataScore: number;
    universeRankScore: number;
    executionSupported?: boolean;
    contractAddress?: string;
    dexPairUrl?: string;
    executionChain?: StrategyUniverseChain;
    executionChainId?: number;
    executionAddress?: string;
    executionDecimals?: number;
    executionRouteKind?: "native" | "proxy" | "cross-chain";
    executionSource?: string;
    executionPairUrl?: string;
    executionLiquidityUsd?: number;
    executionVolume24hUsd?: number;
    executionTxns1h?: number;
    marketSource?: string;
    excludedFromUniverse?: boolean;
    universeExclusionReason?: string;
    prefilterPass?: boolean;
    prefilterReason?: string;
    tags: string[];
}

export interface CandidateAnalysis {
    symbol: string;
    displaySymbol: string;
    chain: StrategyUniverseChain;
    tier?: StrategyTier;
    price: number;
    change24h: number;
    volume: number;
    liquidity: number;
    spreadBps: number;
    txns1h: number;
    dexPairFound: boolean;
    historyBars: number;
    dataCompleteness: number;
    universeRankScore: number;
    executionSupported?: boolean;
    contractAddress?: string;
    dexPairUrl?: string;
    executionChain?: StrategyUniverseChain;
    executionChainId?: number;
    executionAddress?: string;
    executionDecimals?: number;
    executionRouteKind?: "native" | "proxy" | "cross-chain";
    executionSource?: string;
    executionPairUrl?: string;
    executionLiquidityUsd?: number;
    executionVolume24hUsd?: number;
    executionTxns1h?: number;
    marketSource?: string;
    mode: TradeMode;
    rank: CandidateRank;
    status: CandidateStatus;
    executionStatus: CandidateExecutionStatus;
    tradeDecision: CandidateTradeDecision;
    marketScore: number;
    score: number;
    rawScore: number;
    weightedScore: number;
    maxPossibleScore: number;
    confidence: number;
    veto: boolean;
    vetoPass: boolean;
    vetoReasons: string[];
    mainReason: string;
    reasonTags: string[];
    indicatorNotes: string[];
    scoreBreakdown: Record<string, number>;
    supportDistancePct: number;
    resistanceDistancePct: number;
    atrPct: number;
    volumeRatio: number;
    relativeStrengthScore: number;
    correlationGroup: string;
    selectionStage?: CandidateSelectionStage;
    thresholdGap?: number;
    exclusionReason?: string;
    autoTradeExcludedReason?: string;
    positionSizeMultiplier: number;
    positionSizeLabel: CandidatePositionSizeLabel;
    halfSizeEligible: boolean;
    fullSizeEligible: boolean;
    aHalfSizeEligible: boolean;
    bHalfSizeEligible: boolean;
    seedProxyHalfSizeEligible: boolean;
    conditionalReferencePass: boolean;
    probationaryEligible: boolean;
    selectionEligible: boolean;
    relativeStrengthPercentile: number;
    volumeConfirmed: boolean;
    routeMissing: boolean;
    seedFallback: boolean;
    rrCheck: boolean;
    rrStatus: CandidateRrStatus;
    resistanceStatus: CandidateResistanceStatus;
    halfSizeMinRr: number;
    correlationRejected?: boolean;
    finalSelectedEligible?: boolean;
    finalRejectReason?: string;
    prefilterPass?: boolean;
    prefilterReason?: string;
    metrics: {
        r1: number;
        r5: number;
        r15: number;
        r60: number;
        r360: number;
        r1440: number;
        rsi1d: number;
        rsi6h: number;
        rsi1h: number;
        macd1d: number;
        macd6h: number;
        macd1h: number;
        vwap1h: number;
        vwap15m: number;
        adx1h: number;
        plusDi1h: number;
        minusDi1h: number;
        emaBull1h: boolean;
        emaBull4h: boolean;
        emaSlope1h: number;
        emaSlope4h: number;
        bandWidth1h: number;
        chop1h: number;
        chop15m: number;
        rr: number;
    };
}

export interface CycleSelectionStats {
    rawUniverseCount: number;
    universeCount: number;
    universeExcludedCount: number;
    monitoredUniverseCount: number;
    prefilterPassCount: number;
    prefilterExcludedCount: number;
    prefilterMode?: "Trend" | "Range";
    prefilterRescuedCount?: number;
    prefilterTargetMin?: number;
    marketDataPassCount: number;
    vetoCount: number;
    vetoPassCount: number;
    scoreCalculatedCount: number;
    thresholdScore: number;
    thresholdPassCount: number;
    fullSizeEligibleCount?: number;
    halfSizeEligibleCount?: number;
    finalSelectionEligibleCount?: number;
    scoreRejectedCount: number;
    correlationPassCount: number;
    correlationRejectedCount: number;
    finalSelectedCount: number;
    topUniverseAssets: { symbol: string; displaySymbol: string; chain: StrategyUniverseChain; tier: StrategyTier; universeRankScore: number }[];
    experimentalTierAssets: { symbol: string; displaySymbol: string; chain: StrategyUniverseChain; universeRankScore: number }[];
    debug?: CycleDebugInfo;
}

export interface CycleDebugInfo {
    cycleLabel: CycleBlock;
    anchorTime: number;
    cycleStart: number;
    cycleEnd: number;
    anchorSource: "completed" | "live" | "previous-day";
    monitoredUniverseCount: number;
    prefilterPassCount: number;
    prefilterMode?: "Trend" | "Range";
    prefilterRescuedCount?: number;
    prefilterTargetMin?: number;
    scoredCount: number;
    selectedCount: number;
    monitoredUniverseFirst5: string[];
    prefilterFirst5: string[];
    scoredFirst5: string[];
    averageMarketScore: number;
    rankingTop3: { symbol: string; score: number }[];
    monitoredUniverseSameRefAsPrev: boolean;
    prefilterSameRefAsPrev: boolean;
    scoredPoolSameRefAsPrev: boolean;
    reviewedCandidatesSameRefAsPrev: boolean;
    anchorTimeSameAsPrev: boolean;
    monitoredUniverseSameSymbolsAsPrev: boolean;
    prefilterSameSymbolsAsPrev: boolean;
    scoredSameSymbolsAsPrev: boolean;
}

interface CycleComputationContext {
    block: CycleBlock;
    blockIndex: number;
    cycleStartTs: number;
    cycleEndTs: number;
    anchorTs: number;
    anchorSource: "completed" | "live" | "previous-day";
}

export interface SymbolPlanDraft {
    symbol: string;
    displaySymbol: string;
    chain: StrategyUniverseChain;
    executionChain?: StrategyUniverseChain;
    executionChainId?: number;
    executionAddress?: string;
    executionDecimals?: number;
    executionRouteKind?: "native" | "proxy" | "cross-chain";
    executionSource?: string;
    executionPairUrl?: string;
    weight: number;
    source: "current" | "next";
    rank: CandidateRank;
    mode: TradeMode;
    score: number;
    plannedEntryAt: number;
    plannedExitAt: number;
    entryMin: number;
    entryMax: number;
    plannedTakeProfit: number;
    plannedStopLoss: number;
    positionSizeMultiplier: number;
    positionSizeLabel: CandidatePositionSizeLabel;
    settlementSymbol?: string;
    reasonTags: string[];
    indicatorNotes: string[];
}

export interface AgentScenarioDraft {
    agentId: "technical" | "sentiment" | "security" | "fundamental";
    title: string;
    summary: string;
}

export interface CyclePlanDraft {
    block: CycleBlock;
    mode: "TREND" | "MEAN_REVERSION" | "MIXED";
    rankSummary: string;
    settlementSymbol?: string;
    symbolPlans: SymbolPlanDraft[];
    topCandidates: CandidateAnalysis[];
    selectionStats: CycleSelectionStats;
    agentScenarios: AgentScenarioDraft[];
}

export interface DailyPlanBuildResult {
    dayKey: string;
    currentBlock: CycleBlock;
    plans: CyclePlanDraft[];
    candidates: CandidateAnalysis[];
}

export interface ContinuousStrategyCandidate extends CandidateAnalysis {
    regime: StrategyRegime;
    triggerType: StrategyTriggerType;
    triggerFamily: "Trend" | "Range";
    triggerState: StrategyTriggerState;
    triggerReason: string;
    triggerScore: number;
    triggerPassedCount: number;
    triggerRuleCount: number;
    triggerProgressRatio: number;
    triggerMissingReasons: string[];
    cooldownUntil?: number;
    autoTradeLiveEligible: boolean;
    autoTradeTarget: boolean;
    allocationWeight: number;
    timedExitMinutes: number;
    dynamicTakeProfit: number;
    dynamicStopLoss: number;
    eventPriority: number;
    orderGateStatus?: StrategyOrderGateStatus;
    orderGateReason?: string;
    orderGateDetail?: string;
    orderTriggeredAt?: number;
    orderArmEligible?: boolean;
}

export interface ContinuousStrategyMonitor {
    dayKey: string;
    currentBlock: CycleBlock;
    monitoredAt: number;
    regimeUpdatedAt: number;
    candidateUpdatedAt: number;
    triggerUpdatedAt: number;
    stats: {
        rawUniverseCount: number;
        monitoredUniverseCount: number;
        prefilterPassCount: number;
        prefilterMode?: "Trend" | "Range";
        prefilterRescuedCount?: number;
        prefilterTargetMin?: number;
        scoredCount: number;
        readyCount: number;
        armedCount: number;
        triggeredCount: number;
        executedCount: number;
        cooldownCount: number;
        selectedCount: number;
        selectedBasketCap?: number;
        selectionEligibleCount: number;
        conditionalReferencePassCount: number;
        probationaryCount?: number;
        waitingForSlotCount: number;
        orderArmedCount: number;
        finalAlignmentWaitCount?: number;
        volumeHeldCount?: number;
        ordersTodayCount?: number;
        selectedOrderBlockedCount: number;
        selectedOrderBlockedReasons?: Array<{ reason: string; count: number }>;
    };
    candidates: ContinuousStrategyCandidate[];
    selected: ContinuousStrategyCandidate[];
    fullSizeTargets: ContinuousStrategyCandidate[];
    halfSizeTargets: ContinuousStrategyCandidate[];
    armed: ContinuousStrategyCandidate[];
    triggered: ContinuousStrategyCandidate[];
    executed: ContinuousStrategyCandidate[];
    cooldown: ContinuousStrategyCandidate[];
    watchlist: ContinuousStrategyCandidate[];
    blocked: ContinuousStrategyCandidate[];
}

export interface StrategyEngineInput {
    referenceTs: number;
    marketSnapshots: Record<string, MarketSnapshot | undefined>;
    priceHistory: Record<string, PriceSample[] | undefined>;
    positions: ExistingPosition[];
    cyclePerformance: CyclePerformanceSnapshot[];
    lastAutoTradeSymbol?: string;
    preferredSymbol?: string;
}

const TOKYO_TIMEZONE = "Asia/Tokyo";
const SCORE_LABELS: Record<keyof typeof CANDIDATE_SCORE_MAX, string> = {
    trend: "Trend",
    momentum: "Momentum",
    volume: "Volume Confirmation",
    structure: "Structure",
    relativeStrength: "Relative Strength",
    riskFit: "Risk Fit",
    bonus: "Bonus",
};

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
    if (values.length < 2) return 0;
    const avg = average(values);
    return Math.sqrt(average(values.map((value) => (value - avg) ** 2)));
}

function ema(values: number[], period: number) {
    if (!values.length) return 0;
    if (values.length < period) return average(values);
    const multiplier = 2 / (period + 1);
    let result = average(values.slice(0, period));
    for (let index = period; index < values.length; index += 1) {
        result = (values[index] - result) * multiplier + result;
    }
    return result;
}

function rsi(values: number[], period = 14) {
    if (values.length <= period) return 50;
    let gains = 0;
    let losses = 0;
    for (let index = values.length - period; index < values.length; index += 1) {
        const diff = values[index] - values[index - 1];
        if (diff >= 0) gains += diff;
        else losses += Math.abs(diff);
    }
    if (losses === 0) return 100;
    if (gains === 0) return 0;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
}

function macdHistogram(values: number[]) {
    if (values.length < 35) return 0;
    const macdSeries: number[] = [];
    for (let index = 0; index < values.length; index += 1) {
        const slice = values.slice(0, index + 1);
        macdSeries.push(ema(slice, 12) - ema(slice, 26));
    }
    const line = macdSeries[macdSeries.length - 1] || 0;
    const signal = ema(macdSeries, 9);
    return line - signal;
}

function atrPct(values: number[], period = 14) {
    if (values.length <= period) return 0;
    const ranges: number[] = [];
    for (let index = 1; index < values.length; index += 1) {
        const previous = values[index - 1];
        const current = values[index];
        if (previous <= 0) continue;
        ranges.push(Math.abs(current - previous) / previous);
    }
    return average(ranges.slice(-period));
}

function bollingerWidthPct(values: number[], period = 20) {
    if (values.length < period) return 0;
    const window = values.slice(-period);
    const basis = average(window);
    if (basis <= 0) return 0;
    const sigma = standardDeviation(window);
    return ((basis + sigma * 2) - (basis - sigma * 2)) / basis;
}

function choppiness(values: number[], period = 14) {
    if (values.length <= period) return 50;
    const window = values.slice(-(period + 1));
    const highs = Math.max(...window);
    const lows = Math.min(...window);
    const sumRanges = window.slice(1).reduce((sum, value, index) => sum + Math.abs(value - window[index]), 0);
    const denominator = highs - lows;
    if (denominator <= 0 || sumRanges <= 0) return 50;
    return clamp((Math.log10(sumRanges / denominator) / Math.log10(period)) * 100, 0, 100);
}

function vwapProxyDeltaPct(values: number[], currentPrice: number) {
    if (!values.length || currentPrice <= 0) return 0;
    const weighted = values.reduce((sum, value, index) => sum + value * (index + 1), 0);
    const weights = values.reduce((sum, _value, index) => sum + (index + 1), 0);
    if (!weights) return 0;
    const proxy = weighted / weights;
    return proxy > 0 ? (currentPrice - proxy) / proxy : 0;
}

function supportResistancePct(values: number[], currentPrice: number) {
    if (!values.length || currentPrice <= 0) {
        return { supportPct: 0, resistancePct: 0 };
    }
    const support = Math.min(...values);
    const resistance = Math.max(...values);
    return {
        supportPct: support > 0 ? (currentPrice - support) / currentPrice : 0,
        resistancePct: resistance > 0 ? (resistance - currentPrice) / currentPrice : 0,
    };
}

function dmiAdxProxy(values: number[], period = 14) {
    if (values.length <= period + 1) {
        return { adx: 12, plusDi: 20, minusDi: 20 };
    }
    const positives: number[] = [];
    const negatives: number[] = [];
    for (let index = values.length - period; index < values.length; index += 1) {
        const diff = values[index] - values[index - 1];
        positives.push(Math.max(diff, 0));
        negatives.push(Math.max(-diff, 0));
    }
    const plus = average(positives);
    const minus = average(negatives);
    const base = plus + minus;
    const plusDi = base > 0 ? (plus / base) * 100 : 0;
    const minusDi = base > 0 ? (minus / base) * 100 : 0;
    const adx = clamp(Math.abs(plusDi - minusDi) * 1.35, 5, 55);
    return { adx, plusDi, minusDi };
}

function emaSlopePct(values: number[], period: number, lookback = 3) {
    if (values.length < period + lookback) return 0;
    const current = ema(values, period);
    const previous = ema(values.slice(0, values.length - lookback), period);
    if (!previous) return 0;
    return (current - previous) / previous;
}

function correlation(left: number[], right: number[]) {
    const length = Math.min(left.length, right.length);
    if (length < 8) return 0;
    const x = left.slice(-length);
    const y = right.slice(-length);
    const avgX = average(x);
    const avgY = average(y);
    let numerator = 0;
    let denominatorX = 0;
    let denominatorY = 0;
    for (let index = 0; index < length; index += 1) {
        const dx = x[index] - avgX;
        const dy = y[index] - avgY;
        numerator += dx * dy;
        denominatorX += dx * dx;
        denominatorY += dy * dy;
    }
    const denominator = Math.sqrt(denominatorX * denominatorY);
    return denominator ? clamp(numerator / denominator, -1, 1) : 0;
}

function toJstParts(ts: number) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: TOKYO_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    const parts = formatter.formatToParts(new Date(ts));
    const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
    return {
        year: pick("year"),
        month: pick("month"),
        day: pick("day"),
        hour: pick("hour"),
        minute: pick("minute"),
    };
}

export function getJstDateKey(ts: number = Date.now()) {
    const { year, month, day } = toJstParts(ts);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getTokyoCycleInfo(ts: number = Date.now()) {
    const parts = toJstParts(ts);
    const minutes = parts.hour * 60 + parts.minute;
    const blockIndex = minutes < 360 ? 0 : minutes < 720 ? 1 : minutes < 1080 ? 2 : 3;
    const block = CYCLE_BLOCKS[blockIndex];
    const startHour = blockIndex * 6;
    const endHour = blockIndex === 3 ? 24 : startHour + 6;
    const nextBlock = CYCLE_BLOCKS[(blockIndex + 1) % CYCLE_BLOCKS.length];
    const buildUtcTs = (hour: number, minute = 0) => Date.UTC(parts.year, parts.month - 1, parts.day, hour - 9, minute, 0, 0);
    return {
        dayKey: getJstDateKey(ts),
        blockIndex,
        block,
        nextBlock,
        startTs: buildUtcTs(startHour),
        endTs: blockIndex === 3 ? buildUtcTs(24, 0) - 1 : buildUtcTs(endHour),
        minutesIntoBlock: minutes - startHour * 60,
    };
}

function buildJstUtcTs(parts: ReturnType<typeof toJstParts>, dayOffset: number, hour: number, minute = 0) {
    return Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset, hour - 9, minute, 0, 0);
}

function getCycleComputationContext(referenceTs: number, block: CycleBlock): CycleComputationContext {
    const parts = toJstParts(referenceTs);
    const blockIndex = CYCLE_BLOCKS.indexOf(block);
    const startHour = blockIndex * 6;
    const endHour = blockIndex === 3 ? 24 : startHour + 6;
    const todayStartTs = buildJstUtcTs(parts, 0, startHour, 0);
    const todayEndExclusiveTs = buildJstUtcTs(parts, 0, endHour, 0);

    if (referenceTs >= todayEndExclusiveTs) {
        return {
            block,
            blockIndex,
            cycleStartTs: todayStartTs,
            cycleEndTs: todayEndExclusiveTs - 1,
            anchorTs: todayEndExclusiveTs - 1,
            anchorSource: "completed",
        };
    }

    if (referenceTs >= todayStartTs) {
        return {
            block,
            blockIndex,
            cycleStartTs: todayStartTs,
            cycleEndTs: todayEndExclusiveTs - 1,
            anchorTs: referenceTs,
            anchorSource: "live",
        };
    }

    const previousStartTs = buildJstUtcTs(parts, -1, startHour, 0);
    const previousEndExclusiveTs = buildJstUtcTs(parts, -1, endHour, 0);

    return {
        block,
        blockIndex,
        cycleStartTs: previousStartTs,
        cycleEndTs: previousEndExclusiveTs - 1,
        anchorTs: previousEndExclusiveTs - 1,
        anchorSource: "previous-day",
    };
}

function latestPriceAtOrBefore(samples: PriceSample[], targetTs: number, fallback = 0) {
    for (let index = samples.length - 1; index >= 0; index -= 1) {
        const sample = samples[index];
        if (sample.ts <= targetTs && Number.isFinite(sample.price) && sample.price > 0) {
            return sample.price;
        }
    }
    return fallback;
}

function samplesBetween(samples: PriceSample[], startTs: number, endTs: number) {
    return samples.filter((sample) => sample.ts >= startTs && sample.ts <= endTs);
}

function pctChange(current: number, previous: number) {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return 0;
    return (current - previous) / previous;
}

function sameSymbolSlice(left: string[], right: string[]) {
    if (left.length !== right.length) return false;
    return left.every((symbol, index) => symbol === right[index]);
}

function hashString(input: string) {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
        hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
    }
    return Math.abs(hash);
}

function bucketSeries(samples: PriceSample[], bucketMs: number, lookbackMs: number, referenceTs: number) {
    const startTs = referenceTs - lookbackMs;
    const filtered = samples.filter((sample) => sample.ts >= startTs && sample.ts <= referenceTs);
    if (!filtered.length) return [];
    const closes: number[] = [];
    let cursor = startTs;
    let pointer = 0;
    let lastPrice = filtered[0].price;
    while (cursor <= referenceTs) {
        const bucketEnd = cursor + bucketMs;
        while (pointer < filtered.length && filtered[pointer].ts <= bucketEnd) {
            lastPrice = filtered[pointer].price;
            pointer += 1;
        }
        closes.push(lastPrice);
        cursor = bucketEnd;
    }
    return closes.filter((value) => Number.isFinite(value) && value > 0);
}

function buildSyntheticSeries(symbol: string, currentPrice: number, change24hPct: number, minLength: number, volatilityHint: number) {
    const safePrice = Math.max(currentPrice, 0.0000001);
    const totalReturn = clamp(change24hPct / 100, -0.35, 0.35);
    const startPrice = safePrice / Math.max(0.4, 1 + totalReturn);
    const phase = (hashString(symbol) % 17) / 17;
    const amplitude = clamp(volatilityHint, 0.004, 0.06);
    const synthetic: number[] = [];

    for (let index = 0; index < Math.max(minLength, 2); index += 1) {
        const progress = minLength <= 1 ? 1 : index / (Math.max(minLength, 2) - 1);
        const drift = totalReturn * progress;
        const oscillation = Math.sin((progress + phase) * Math.PI * 4) * amplitude * 0.35;
        synthetic.push(clamp(startPrice * (1 + drift + oscillation), safePrice * 0.3, safePrice * 1.7));
    }

    synthetic[synthetic.length - 1] = safePrice;
    return synthetic;
}

function bucketSeriesWithFallback(
    symbol: string,
    samples: PriceSample[],
    bucketMs: number,
    lookbackMs: number,
    referenceTs: number,
    currentPrice: number,
    change24hPct: number,
    minLength: number,
    volatilityHint: number,
) {
    const actual = bucketSeries(samples, bucketMs, lookbackMs, referenceTs);
    if (actual.length >= minLength) return actual;
    const synthetic = buildSyntheticSeries(symbol, currentPrice, change24hPct, minLength, volatilityHint);
    if (!actual.length) return synthetic;
    return [...synthetic.slice(0, Math.max(0, minLength - actual.length)), ...actual].slice(-Math.max(minLength, actual.length));
}

function pctFromSeries(series: number[], barsAgo: number) {
    if (series.length <= barsAgo) return 0;
    const current = series[series.length - 1];
    const previous = series[series.length - 1 - barsAgo];
    if (!current || !previous) return 0;
    return (current - previous) / previous;
}

function scaleScore(value: number, inputMin: number, inputMax: number, outputMin: number, outputMax: number) {
    if (inputMin === inputMax) return outputMin;
    const ratio = clamp((value - inputMin) / (inputMax - inputMin), 0, 1);
    return outputMin + ratio * (outputMax - outputMin);
}

function scaleLogScore(value: number, floor: number, ceiling: number) {
    const safeValue = Math.max(1, value);
    const safeFloor = Math.max(1, floor);
    const safeCeiling = Math.max(safeFloor + 1, ceiling);
    const logValue = Math.log10(safeValue);
    const logFloor = Math.log10(safeFloor);
    const logCeiling = Math.log10(safeCeiling);
    return scaleScore(logValue, logFloor, logCeiling, 0, 100);
}

function normalizedScoreToRank(score: number): CandidateRank {
    if (score >= STRATEGY_CONFIG.SCORE_THRESHOLD_A) return "A";
    if (score >= STRATEGY_CONFIG.SCORE_THRESHOLD_B) return "B";
    if (score >= STRATEGY_CONFIG.REVIEW_THRESHOLD) return "C";
    return "D";
}

function normalizeCandidateScore(rawScore: number, maxPossibleScore = CANDIDATE_SCORE_MAX_TOTAL) {
    const safeRawScore = clamp(rawScore, 0, maxPossibleScore);
    // normalizedScore = clamp(Math.round((rawScore / maxPossibleScore) * 100), 0, 100)
    return {
        rawScore: Number(safeRawScore.toFixed(2)),
        weightedScore: Number(safeRawScore.toFixed(2)),
        maxPossibleScore,
        normalizedScore: clamp(Math.round((safeRawScore / maxPossibleScore) * 100), 0, 100),
    };
}

function confidenceFromNormalizedScore(score: number, dataCompleteness = 1) {
    return clamp(Math.round(30 + score * 0.6 + dataCompleteness * 10), 15, 96);
}

function positionSizeLabel(multiplier: number): CandidatePositionSizeLabel {
    if (multiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER) return "0.5x";
    if (multiplier >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER) return "0.3x";
    if (multiplier >= STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER) return "0.2x";
    return "0x";
}

function resolveExecutionStatus(candidate: Pick<CandidateAnalysis, "price" | "dataCompleteness" | "executionSupported" | "marketSource" | "vetoReasons">): CandidateExecutionStatus {
    if (!Number.isFinite(candidate.price) || candidate.price <= 0 || candidate.dataCompleteness <= 0) return "Data Missing";
    if (candidate.executionSupported === false) return "Route Missing";
    if ((candidate.vetoReasons || []).length > 0) return "VETO NG";
    if (candidate.marketSource === "seed") return "Seed Fallback";
    return "Pass";
}

function resolveAutoTradeExcludedReason(candidate: {
    symbol: string;
    liquidity: number;
    executionLiquidityUsd?: number;
    executionAddress?: string;
    executionRouteKind?: "native" | "proxy" | "cross-chain";
}) {
    if (STRATEGY_CONFIG.AUTO_TRADE_EXCLUDED_SYMBOLS.some((symbol) => symbol === normalizeTrackedSymbol(candidate.symbol))) {
        return "自動売買対象外";
    }
    if (isAutoTradeExcludedExecutionTarget(candidate.executionAddress)) {
        return "実行資産除外";
    }
    if (candidate.executionRouteKind === "cross-chain" && !BOT_CONFIG.ENABLE_CROSS_CHAIN) {
        return "クロスチェーンの実売買が未設定です";
    }
    const minLiquidity = candidate.executionRouteKind === "proxy"
        ? STRATEGY_CONFIG.AUTO_TRADE_MIN_PROXY_LIQUIDITY
        : candidate.executionRouteKind === "cross-chain"
            ? STRATEGY_CONFIG.AUTO_TRADE_MIN_CROSS_CHAIN_LIQUIDITY
            : STRATEGY_CONFIG.AUTO_TRADE_MIN_LIQUIDITY;
    if (!Number.isFinite(candidate.liquidity) || candidate.liquidity < minLiquidity) {
        return "自動トレード対象外";
    }
    return undefined;
}

function resolveCandidateRouteLiquidity(input: {
    executionLiquidityUsd?: number;
    liquidity: number;
}) {
    return Math.max(Number(input.executionLiquidityUsd || 0), Number(input.liquidity || 0));
}

function resolveCandidateRouteTxns(input: {
    executionTxns1h?: number;
    txns1h: number;
}) {
    return Math.max(Number(input.executionTxns1h || 0), Number(input.txns1h || 0));
}

function resolveCandidateRouteVolume(input: {
    executionVolume24hUsd?: number;
    volume24h: number;
}) {
    return Math.max(Number(input.executionVolume24hUsd || 0), Number(input.volume24h || 0));
}

function resolveAutoTradeExcludedReasonRouteBased(candidate: {
    symbol?: string;
    liquidity: number;
    executionLiquidityUsd?: number;
    executionAddress?: string;
    executionRouteKind?: "native" | "proxy" | "cross-chain";
}) {
    const normalizedCandidateSymbol = candidate.symbol ? normalizeTrackedSymbol(candidate.symbol) : "";
    if (normalizedCandidateSymbol && STRATEGY_CONFIG.AUTO_TRADE_EXCLUDED_SYMBOLS.some((symbol) => symbol === normalizedCandidateSymbol)) {
        return "自動売買対象外";
    }
    if (isAutoTradeExcludedExecutionTarget(candidate.executionAddress)) {
        return "実行資産除外";
    }
    if (candidate.executionRouteKind === "cross-chain" && !BOT_CONFIG.ENABLE_CROSS_CHAIN) {
        return "クロスチェーン実売買が未設定";
    }
    return undefined;
}

function resolveExecutionBlockReason(candidate: {
    executionRouteKind?: "native" | "proxy" | "cross-chain";
    executionChain?: StrategyUniverseChain;
}) {
    if (
        candidate.executionRouteKind === "native"
        && candidate.executionChain
        && !TRADE_CONFIG.SUPPORTED_CHAINS.includes(candidate.executionChain as never)
    ) {
        if (candidate.executionChain === "SOLANA") {
            return "Solana live未対応";
        }
        return `${candidate.executionChain} live未対応`;
    }
    if (candidate.executionRouteKind === "cross-chain" && !BOT_CONFIG.ENABLE_CROSS_CHAIN) {
        return "実売買不可: クロスチェーン未稼働";
    }
    return undefined;
}

function hasLiquidityBackedVolumePass(input: {
    executionRouteKind?: "native" | "proxy" | "cross-chain";
    executionLiquidityUsd?: number;
    liquidity: number;
    executionTxns1h?: number;
    txns1h: number;
    volumeRatio: number;
    r15?: number;
    r60?: number;
    r360?: number;
    r1440?: number;
}) {
    const routeTxns1h = resolveCandidateRouteTxns(input);
    const momentumFloorOk =
        Number(input.r15 || 0) > -0.012
        || Number(input.r60 || 0) > -0.02
        || Number(input.r360 || 0) > -0.03
        || Number(input.r1440 || 0) > -0.05;
    return routeTxns1h >= Math.max(2, STRATEGY_CONFIG.LIQUIDITY_BACKED_VOLUME_MIN_TXNS_1H - 6)
        && momentumFloorOk;
}

function isVolumeOnlyHoldCandidate(candidate: Pick<
    ContinuousStrategyCandidate,
    | "selectionEligible"
    | "positionSizeLabel"
    | "orderGateReason"
    | "orderGateDetail"
    | "triggerMissingReasons"
    | "mainReason"
    | "autoTradeExcludedReason"
    | "executionStatus"
    | "routeMissing"
    | "triggerProgressRatio"
>): boolean {
    return false;
}

function hasPriorityExecutionProfileCandidate(input: {
    tier?: StrategyTier;
    marketScore: number;
    universeRankScore: number;
    relativeStrengthPercentile: number;
    executionLiquidityUsd?: number;
    liquidity: number;
    executionTxns1h?: number;
    txns1h: number;
}) {
    const routeLiquidityUsd = resolveCandidateRouteLiquidity(input);
    const routeTxns1h = resolveCandidateRouteTxns(input);
    const priorityTier = input.tier === "core" || input.tier === "secondary";
    const premiumExperimental =
        input.tier === "experimental"
        && input.marketScore >= STRATEGY_CONFIG.PRIORITY_EXECUTION_MIN_SCORE + 4
        && input.relativeStrengthPercentile >= STRATEGY_CONFIG.PRIORITY_EXECUTION_MIN_RS_PERCENTILE + 0.08;

    return routeTxns1h >= STRATEGY_CONFIG.PRIORITY_EXECUTION_MIN_TXNS_1H
        && (
            input.marketScore >= STRATEGY_CONFIG.PRIORITY_EXECUTION_MIN_SCORE
            || input.universeRankScore >= STRATEGY_CONFIG.PRIORITY_EXECUTION_MIN_UNIVERSE_RANK
            || (
                (priorityTier || premiumExperimental)
                && input.relativeStrengthPercentile >= STRATEGY_CONFIG.PRIORITY_EXECUTION_MIN_RS_PERCENTILE
            )
        );
}

function isConditionalReferencePassCandidate(input: {
    executionSupported?: boolean;
    routeMissing: boolean;
    seedFallback: boolean;
    autoTradeExcludedReason?: string;
    tier?: StrategyTier;
    marketScore: number;
    universeRankScore: number;
    rr: number;
    resistanceStatus: CandidateResistanceStatus;
    volumeRatio: number;
    volumeConfirmed: boolean;
    relativeStrengthPercentile: number;
    executionLiquidityUsd?: number;
    liquidity: number;
    executionTxns1h?: number;
    txns1h: number;
}) {
    if (!input.seedFallback || input.routeMissing || !input.executionSupported || input.autoTradeExcludedReason) return false;
    const routeTxns1h = resolveCandidateRouteTxns(input);
    const priorityProfile = hasPriorityExecutionProfileCandidate(input);
    const tierQualified = input.tier === "core" || input.tier === "secondary";

    return input.marketScore >= Math.max(STRATEGY_CONFIG.CONDITIONAL_REFERENCE_MIN_SCORE, STRATEGY_CONFIG.SCORE_THRESHOLD_B)
        && input.rr >= Math.max(0.98, STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_RR)
        && input.resistanceStatus !== "Blocked"
        && (input.volumeConfirmed || input.volumeRatio >= STRATEGY_CONFIG.CONDITIONAL_REFERENCE_MIN_VOLUME_RATIO)
        && input.relativeStrengthPercentile >= 0.35
        && routeTxns1h >= STRATEGY_CONFIG.CONDITIONAL_REFERENCE_MIN_TXNS_1H
        && (
            priorityProfile
            || (
                tierQualified
                && routeTxns1h >= Math.max(
                    STRATEGY_CONFIG.CONDITIONAL_REFERENCE_MIN_TXNS_1H,
                    Math.round(STRATEGY_CONFIG.PRIORITY_EXECUTION_MIN_TXNS_1H * 0.7),
                )
                && input.universeRankScore >= Math.max(72, STRATEGY_CONFIG.PRIORITY_EXECUTION_MIN_UNIVERSE_RANK - 8)
            )
        );
}

function isSeedRouteReviewCandidate(input: {
    executionSupported?: boolean;
    routeMissing: boolean;
    seedFallback: boolean;
    autoTradeExcludedReason?: string;
    marketScore: number;
    rrStatus: CandidateRrStatus;
    resistanceStatus: CandidateResistanceStatus;
    executionLiquidityUsd?: number;
    liquidity: number;
    executionTxns1h?: number;
    txns1h: number;
}) {
    if (!input.seedFallback || input.routeMissing || !input.executionSupported || input.autoTradeExcludedReason) return false;
    const routeTxns1h = resolveCandidateRouteTxns(input);

    return input.marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_A
        && routeTxns1h >= STRATEGY_CONFIG.SEED_PROXY_REVIEW_MIN_TXNS_1H
        && input.rrStatus !== "NG"
        && input.resistanceStatus !== "Blocked";
}

function rankFactor(rank: CandidateRank) {
    if (rank === "A") return 1;
    if (rank === "B") return 0.8;
    if (rank === "C") return 0.58;
    return 0.42;
}

function rankSummaryOf(ranks: CandidateRank[]) {
    const summary = (["A", "B", "C", "D"] as CandidateRank[])
        .map((rank) => ({ rank, count: ranks.filter((value) => value === rank).length }))
        .filter((item) => item.count > 0)
        .map((item) => `${item.rank}${item.count}`);
    return summary.length > 0 ? summary.join(" / ") : "Skip";
}

type PrefilterMode = "Trend" | "Range";

type ContinuousBasketCapInput = {
    selectionEligibleCount: number;
    probationaryCount?: number;
    conditionalReferenceCount?: number;
    rangeCandidateCount?: number;
    prefilterMode?: PrefilterMode;
    prefilterPassCount?: number;
};

function baseTrackedSymbol(symbol: string) {
    return symbol.toUpperCase().replace(/\.SOL$/, "");
}

function buildCorrelationGroup(symbol: string) {
    const baseSymbol = baseTrackedSymbol(symbol);
    if (["BTC", "BCH", "LTC", "WBTC"].includes(baseSymbol)) return "btc-beta";
    if (["ETH", "LINK", "AAVE", "UNI", "WETH", "LDO", "MKR", "CRV"].includes(baseSymbol)) return "eth-beta";
    if (["BNB", "CAKE", "XVS", "TWT", "DODO", "ALPACA", "ASTER", "WLFI", "ID", "SFP"].includes(baseSymbol)) return "bnb-beta";
    if (["SHIB", "PEPE", "BONK", "WIF", "FLOKI"].includes(baseSymbol)) return "meme-beta";
    return symbol;
}

type SelectionLikeCandidate = {
    symbol: string;
    chain: "BNB" | "SOLANA";
    correlationGroup: string;
    regime?: StrategyRegime;
    conditionalReferencePass?: boolean;
    fullSizeEligible?: boolean;
    halfSizeEligible?: boolean;
    aHalfSizeEligible?: boolean;
    bHalfSizeEligible?: boolean;
    seedProxyHalfSizeEligible?: boolean;
    probationaryEligible?: boolean;
    positionSizeMultiplier?: number;
};

function selectionSizeOf(candidate: SelectionLikeCandidate, fallbackSize: number) {
    const explicitSize = Number(candidate.positionSizeMultiplier || 0);
    if (explicitSize > 0) return explicitSize;
    if (candidate.fullSizeEligible) return STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER;
    if (
        candidate.halfSizeEligible
        || candidate.aHalfSizeEligible
        || candidate.bHalfSizeEligible
        || candidate.seedProxyHalfSizeEligible
    ) {
        return STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER;
    }
    if (candidate.probationaryEligible) return STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER;
    return fallbackSize;
}

function maxCorrelationGroupSelections(candidate: SelectionLikeCandidate, intendedSize: number) {
    if (intendedSize >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER) return 1;
    if (candidate.conditionalReferencePass) return STRATEGY_CONFIG.MAX_SELECTED_PER_CORRELATION_GROUP;
    if (candidate.regime === "Range" || intendedSize <= STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER) {
        return STRATEGY_CONFIG.MAX_SELECTED_PER_CORRELATION_GROUP;
    }
    return 1;
}

function hasSelectionConflict(
    selected: SelectionLikeCandidate[],
    candidate: SelectionLikeCandidate,
    intendedSize: number,
    correlations: Record<string, Record<string, number>>,
) {
    const sameComparableSymbol = (left: string, right: string) => baseTrackedSymbol(left) === baseTrackedSymbol(right);
    const sameGroupSelections = selected.filter((existing) => existing.correlationGroup === candidate.correlationGroup);

    for (const existing of selected) {
        if (sameComparableSymbol(existing.symbol, candidate.symbol)) return true;

        const direct = Math.max(
            correlations[candidate.symbol]?.[existing.symbol] || 0,
            correlations[existing.symbol]?.[candidate.symbol] || 0,
        );
        if (direct > STRATEGY_CONFIG.CORRELATION_MAX) return true;
        if (existing.correlationGroup !== candidate.correlationGroup) continue;

        const existingSize = selectionSizeOf(existing, STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER);
        const sameChain = existing.chain === candidate.chain;
        const bothLarge = existingSize >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
            && intendedSize >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER;

        if (
            sameChain
            && bothLarge
            && (existingSize >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER || intendedSize >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER)
            && existing.regime !== "Range"
            && candidate.regime !== "Range"
        ) {
            return true;
        }
        if (existingSize >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER && intendedSize >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER) return true;
    }

    return sameGroupSelections.length >= maxCorrelationGroupSelections(candidate, intendedSize);
}

export function deriveContinuousBasketCap(input: ContinuousBasketCapInput) {
    const baseCap = STRATEGY_CONFIG.MAX_SELECTED_PER_CYCLE;
    const eligibleCount = Math.max(0, Number(input.selectionEligibleCount || 0));
    const prefilterPassCount = Math.max(eligibleCount, Number(input.prefilterPassCount || 0));
    const probationaryCount = Math.max(0, Number(input.probationaryCount || 0));
    const conditionalReferenceCount = Math.max(0, Number(input.conditionalReferenceCount || 0));
    const rangeCandidateCount = Math.max(0, Number(input.rangeCandidateCount || 0));
    const isRange = input.prefilterMode === "Range";

    let cap = Math.max(
        baseCap,
        Math.ceil(eligibleCount * (isRange ? 1.05 : 0.82)),
        Math.ceil(prefilterPassCount * (isRange ? 0.68 : 0.5)),
    );
    if (probationaryCount >= 1) cap += 1;
    if (conditionalReferenceCount >= 1) cap += 1;
    if (rangeCandidateCount >= 3) cap += 1;
    if (prefilterPassCount >= 10) cap += 1;
    if (prefilterPassCount >= 16) cap += 1;

    return clamp(cap, baseCap, STRATEGY_CONFIG.MAX_SELECTED_CANDIDATES);
}

function selectionExpectedValueScore(candidate: ContinuousStrategyCandidate) {
    const entryPrice = Math.max(candidate.price, 0.000001);
    const takeProfit = Math.max(dynamicTakeProfitV2(candidate), entryPrice);
    const stopLoss = Math.max(0, dynamicStopLossV2(candidate));
    const rewardPct = Math.max(0, (takeProfit - entryPrice) / entryPrice);
    const riskPct = stopLoss > 0 && stopLoss < entryPrice
        ? Math.max(0.0005, (entryPrice - stopLoss) / entryPrice)
        : Math.max(0.0005, candidate.atrPct * 0.8);
    const edgeRatio = rewardPct / riskPct;
    const netEdgePct = rewardPct - (riskPct * 0.72);
    const oscillatorFit =
        (candidate.metrics.macd1h > 0 ? 5 : -1)
        + (candidate.metrics.macd6h > 0 ? 4 : -1)
        + (candidate.metrics.rsi1h >= 40 && candidate.metrics.rsi1h <= 70 ? 4 : -2)
        + (candidate.metrics.rsi6h >= 38 && candidate.metrics.rsi6h <= 68 ? 3 : -1);
    const regimeFit =
        candidate.regime === "Trend"
            ? (candidate.metrics.emaBull1h ? 5 : -3) + (candidate.metrics.emaBull4h ? 5 : -2) + (candidate.metrics.emaSlope1h > -0.0002 ? 4 : -2)
            : candidate.regime === "Range"
                ? (candidate.triggerFamily === "Range" ? 8 : 1) + (candidate.supportDistancePct <= 0.03 ? 4 : 0) + (candidate.resistanceStatus !== "Blocked" ? 3 : -4)
                : -8;
    const triggerFit =
        (candidate.triggerState === "Triggered" ? 14 : candidate.triggerState === "Armed" ? 9 : candidate.triggerState === "Ready" ? 4 : 0)
        + (candidate.triggerProgressRatio * 20)
        + (candidate.triggerPassedCount * 3)
        - ((candidate.triggerRuleCount - candidate.triggerPassedCount) * 1.5);
    const executionFit =
        candidate.executionStatus === "Pass"
            ? 9
            : candidate.conditionalReferencePass
                ? 5
                : candidate.executionSupported
                    ? 2
                    : -8;
    const sizeFit =
        candidate.positionSizeMultiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER
            ? 6
            : candidate.positionSizeMultiplier >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
                ? 3
                : 1;
    const referencePenalty = candidate.conditionalReferencePass ? -2 : 0;
    return (
        (candidate.eventPriority * 6)
        + (candidate.marketScore * 1.15)
        + (rewardPct * 180)
        + (netEdgePct * 220)
        + (edgeRatio * 12)
        + oscillatorFit
        + regimeFit
        + triggerFit
        + executionFit
        + sizeFit
        + referencePenalty
    );
}

function compareBySelectionPriority(left: ContinuousStrategyCandidate, right: ContinuousStrategyCandidate) {
    return selectionExpectedValueScore(right) - selectionExpectedValueScore(left)
        || right.eventPriority - left.eventPriority
        || right.marketScore - left.marketScore
        || right.triggerProgressRatio - left.triggerProgressRatio;
}

function buildAgentScenarios(plan: SymbolPlanDraft[], block: CycleBlock, settlementSymbol?: string): AgentScenarioDraft[] {
    const focus = plan.slice(0, 3);
    const basketLabel = focus.map((item) => item.displaySymbol || item.symbol).join(" / ");
    const best = focus[0];
    const technicalNote = best?.indicatorNotes?.find((note) => note.startsWith("Trend")) || best?.indicatorNotes?.[0] || "Trend / momentum alignment is the primary filter.";
    const volumeNote = best?.indicatorNotes?.find((note) => note.startsWith("Volume")) || "Volume ratio and relative strength stay in the first gate.";
    const srNote = best?.indicatorNotes?.find((note) => note.startsWith("Structure")) || "Structure and resistance room decide whether a signal is tradable.";
    const atrNote = best?.indicatorNotes?.find((note) => note.startsWith("Risk")) || "ATR and spread keep position sizing conservative.";
    return [
        { agentId: "technical", title: "Tech", summary: `${block} focuses on ${basketLabel || "no active basket"}. ${technicalNote}` },
        { agentId: "sentiment", title: "Sent", summary: `${block} prefers assets with sustained participation. ${volumeNote} Settlement fallback stays ${settlementSymbol || "USDT"}.` },
        { agentId: "security", title: "Sec", summary: `VETO guards thin books, overhead resistance, and correlation overlap. ${srNote} ${atrNote}` },
        { agentId: "fundamental", title: "Fund", summary: `${block} keeps the daily basket fixed unless material news changes the setup quality.` },
    ];
}

function buildScoreShortfallReason(candidate: CandidateAnalysis, thresholdScore: number) {
    const weakest = (Object.keys(CANDIDATE_SCORE_MAX) as (keyof typeof CANDIDATE_SCORE_MAX)[])
        .map((key) => ({ key, label: SCORE_LABELS[key], ratio: candidate.scoreBreakdown[key] / CANDIDATE_SCORE_MAX[key] }))
        .sort((left, right) => left.ratio - right.ratio)
        .slice(0, 2)
        .map((item) => item.label);
    const gap = Math.max(0, Math.round(thresholdScore - candidate.score));
    return weakest.length > 0 ? `Threshold short by ${gap}; ${weakest.join(" / ")} weak` : `Threshold short by ${gap}`;
}

function describeAutoTradeExcludedReason(reason?: string) {
    if (!reason) return undefined;
    return reason;
}

function buildExecutionRejectReason(candidate: Pick<CandidateAnalysis, "executionStatus" | "vetoReasons" | "autoTradeExcludedReason">) {
    if (candidate.executionStatus === "Data Missing") return "データ不足";
    if (candidate.executionStatus === "Route Missing") return "実行ルートなし";
    if (candidate.executionStatus === "VETO NG") return candidate.vetoReasons[0] || "VETO NG";
    if (candidate.executionStatus === "Seed Fallback") return "参考データのみ";
    if (candidate.autoTradeExcludedReason) return candidate.autoTradeExcludedReason;
    return undefined;
}

function buildHalfSizeRejectReason(candidate: Pick<CandidateAnalysis,
    | "executionStatus"
    | "autoTradeExcludedReason"
    | "seedFallback"
    | "relativeStrengthPercentile"
    | "volumeConfirmed"
    | "rrCheck"
    | "halfSizeMinRr"
    | "metrics"
    | "vetoReasons"
>) {
    const executionReason = buildExecutionRejectReason(candidate);
    if (executionReason) return executionReason;

    const reasons: string[] = [];
    if (candidate.seedFallback) reasons.push("参考データのみ");
    if (candidate.relativeStrengthPercentile < STRATEGY_CONFIG.HALF_SIZE_RS_PERCENTILE) reasons.push("RS上位30%未達");
    if (!candidate.rrCheck) reasons.push(`RR不足 (${candidate.metrics.rr.toFixed(2)} < ${candidate.halfSizeMinRr.toFixed(2)})`);
    return reasons[0];
}

function buildInitialSelectionRejectReason(candidate: CandidateAnalysis, thresholdScore: number) {
    const executionReason = buildExecutionRejectReason(candidate);
    if (executionReason) return executionReason;
    if (candidate.fullSizeEligible || candidate.halfSizeEligible) return undefined;
    if (candidate.rank === "B") {
        return buildHalfSizeRejectReason(candidate) || "B半ロット条件未達";
    }
    return buildScoreShortfallReason(candidate, thresholdScore);
}

function describeAutoTradeExcludedReasonV2(reason?: string) {
    if (!reason) return undefined;
    return reason;
}

function buildExecutionRejectReasonV2(candidate: Pick<CandidateAnalysis, "executionStatus" | "vetoReasons" | "autoTradeExcludedReason">) {
    if (candidate.executionStatus === "Data Missing") return "データ不足";
    if (candidate.executionStatus === "Route Missing") return "実行ルートなし";
    if (candidate.executionStatus === "VETO NG") return candidate.vetoReasons[0] || "VETO NG";
    if (candidate.executionStatus === "Seed Fallback") return "参考データのみ";
    if (candidate.autoTradeExcludedReason) return candidate.autoTradeExcludedReason;
    return undefined;
}

function buildHalfSizeRejectReasonV2(candidate: Pick<CandidateAnalysis,
    | "executionStatus"
    | "autoTradeExcludedReason"
    | "seedFallback"
    | "relativeStrengthPercentile"
    | "volumeConfirmed"
    | "rrCheck"
    | "halfSizeMinRr"
    | "metrics"
    | "vetoReasons"
>) {
    const executionReason = buildExecutionRejectReasonV2(candidate);
    if (executionReason) return executionReason;

    const reasons: string[] = [];
    if (candidate.seedFallback) reasons.push("参考データのみ");
    if (candidate.relativeStrengthPercentile < STRATEGY_CONFIG.HALF_SIZE_RS_PERCENTILE) reasons.push("RS上位30%未達");
    if (!candidate.rrCheck) reasons.push(`RR不足 (${candidate.metrics.rr.toFixed(2)} < ${candidate.halfSizeMinRr.toFixed(2)})`);
    return reasons[0];
}

function buildInitialSelectionRejectReasonV2(candidate: CandidateAnalysis, thresholdScore: number) {
    const executionReason = buildExecutionRejectReasonV2(candidate);
    if (executionReason) return executionReason;
    if (candidate.fullSizeEligible || candidate.aHalfSizeEligible || candidate.bHalfSizeEligible || candidate.halfSizeEligible) return undefined;
    if (candidate.rank === "A") {
        if (candidate.seedFallback) return "参考データのみのためA採用見送り";
        if (candidate.rrStatus === "Weak") return "RRや上値余地がやや弱く半ロット止まり";
        if (candidate.rrStatus === "NG") return `RR不足 (${candidate.metrics.rr.toFixed(2)})`;
        if (candidate.resistanceStatus === "Tight") return "上値余地が近く通常採用を見送り";
    }
    if (candidate.rank === "B") {
        return buildHalfSizeRejectReasonV2(candidate) || "B半ロット条件未達";
    }
    return buildScoreShortfallReason(candidate, thresholdScore);
}

function rrStatusFromValue(rr: number, fullSizeMinRr: number, halfSizeMinRr: number): CandidateRrStatus {
    if (rr >= fullSizeMinRr) return "OK";
    if (rr >= halfSizeMinRr) return "Weak";
    return "NG";
}

function resistanceStatusFromValue(resistanceDistancePct: number, atrPct: number, rr: number): CandidateResistanceStatus {
    const blockedThreshold = Math.max(
        STRATEGY_CONFIG.VETO_MIN_RESISTANCE_PCT,
        atrPct * STRATEGY_CONFIG.VETO_RESISTANCE_ATR_MULTIPLIER,
    );
    if (resistanceDistancePct <= blockedThreshold && rr < STRATEGY_CONFIG.VETO_RESISTANCE_RR_FLOOR) return "Blocked";
    const tightThreshold = Math.max(
        STRATEGY_CONFIG.TIGHT_RESISTANCE_MIN_PCT,
        atrPct * STRATEGY_CONFIG.TIGHT_RESISTANCE_ATR_MULTIPLIER,
    );
    return resistanceDistancePct <= tightThreshold ? "Tight" : "Open";
}

function scoreUniverseCandidate(asset: UniverseAsset) {
    const routeTxns1h = resolveCandidateRouteTxns(asset);
    const txnsScore = scaleScore(routeTxns1h, 1, 120, 0, 100);
    const spreadScore = scaleScore(asset.spreadBps, STRATEGY_CONFIG.PREFILTER_MAX_SPREAD_BPS * 2.3, 6, 0, 100);
    const priceDataScore = clamp(asset.dataCompleteness * 75 + asset.priceDataScore * 0.25, 0, 100);
    const ageScore = scaleScore(asset.tokenAgeDays, STRATEGY_CONFIG.PREFILTER_MIN_TOKEN_AGE_DAYS, 2_400, 0, 100);
    const marketCapScore = scaleLogScore(asset.marketCap, 300_000_000, 1_500_000_000_000);
    const stabilityScore = clamp(asset.stabilityScore, 0, 100);
    const executionScore = asset.executionSupported ? 100 : 42;

    return Number(clamp((
        txnsScore * 0.22
        + spreadScore * 0.20
        + priceDataScore * 0.18
        + ageScore * 0.12
        + marketCapScore * 0.10
        + stabilityScore * 0.08
        + executionScore * 0.10
    ), 0, 100).toFixed(2));
}

function assignTier(index: number): StrategyTier {
    if (index < STRATEGY_CONFIG.CORE_TIER_SIZE) return "core";
    if (index < STRATEGY_CONFIG.CORE_TIER_SIZE + STRATEGY_CONFIG.SECONDARY_TIER_SIZE) return "secondary";
    return "experimental";
}

function getRawUniverseCandidates(input: StrategyEngineInput, cycleContext: CycleComputationContext): UniverseAsset[] {
    const referenceTs = cycleContext.anchorTs;
    return STRATEGY_UNIVERSE_SEEDS.map((seed) => {
        const snapshot = input.marketSnapshots[seed.symbol];
        const samples = input.priceHistory[seed.symbol] || [];
        const livePrice = Number(snapshot?.price || 0);
        const price = latestPriceAtOrBefore(samples, referenceTs, livePrice);
        const price24hAgo = latestPriceAtOrBefore(samples, referenceTs - 24 * 60 * 60_000, 0);
        const cycleStartPrice = latestPriceAtOrBefore(samples, cycleContext.cycleStartTs, price);
        const recent6hPrice = latestPriceAtOrBefore(samples, referenceTs - 6 * 60 * 60_000, price);
        const change24h = price24hAgo > 0
            ? Number((pctChange(price, price24hAgo) * 100).toFixed(2))
            : Number(snapshot?.change24h || 0);
        const cycleReturnPct = pctChange(price, cycleStartPrice) * 100;
        const recent6hReturnPct = pctChange(price, recent6hPrice) * 100;
        const cycleSamples = samplesBetween(samples, cycleContext.cycleStartTs, referenceTs);
        const cycleHours = Math.max(1, (referenceTs - cycleContext.cycleStartTs) / (60 * 60_000));
        const sampleDensity = clamp(cycleSamples.length / Math.max(4, cycleHours * 4), 0.15, 1.4);
        const actualHistoryBars = bucketSeries(samples, 60 * 60_000, 48 * 60 * 60 * 1000, referenceTs).length;
        const qualityFloorBase = seed.priceDataScore / 100 * (snapshot?.source === "dex" ? 0.84 : 0.76);
        const qualityFloor = price > 0
            ? clamp(qualityFloorBase * scaleScore(sampleDensity, 0.15, 1.2, 0.72, 1.05), 0, 0.9)
            : 0;
        const dataCompleteness = price > 0 ? clamp(Math.max(actualHistoryBars / STRATEGY_CONFIG.PREFILTER_MIN_HISTORY_BARS, qualityFloor), 0, 1) : 0;
        const historyBars = price > 0 ? Math.max(actualHistoryBars, Math.round(dataCompleteness * STRATEGY_CONFIG.PREFILTER_MIN_HISTORY_BARS)) : actualHistoryBars;
        const activityMultiplier = clamp(
            0.72
            + Math.min(Math.abs(change24h) / 18, 0.42)
            + Math.min(Math.abs(recent6hReturnPct) / 12, 0.26)
            + sampleDensity * 0.18,
            0.42,
            1.9,
        );
        const liveVolume = Number(snapshot?.volume || seed.volume24hUsd);
        const liveLiquidity = Number(snapshot?.liquidity || seed.liquidityUsd);
        const liveSpread = Number(snapshot?.spreadBps || seed.spreadBps);
        const liveMarketCap = Number(snapshot?.marketCap || seed.marketCapUsd);
        const executionVolume24hUsd = Math.max(0, Number(snapshot?.executionVolume24hUsd || 0));
        const executionLiquidityUsd = Math.max(0, Number(snapshot?.executionLiquidityUsd || 0));
        const executionTxns1h = Math.max(0, Number(snapshot?.executionTxns1h || 0));
        const executionBackedRoute = Boolean(snapshot?.executionSupported);
        const volumeBase = executionBackedRoute ? Math.max(liveVolume, executionVolume24hUsd) : liveVolume;
        const liquidityBase = executionBackedRoute ? Math.max(liveLiquidity, executionLiquidityUsd) : liveLiquidity;
        const txns1h = executionBackedRoute
            ? Math.max(0, Number(snapshot?.txns1h || 0), executionTxns1h)
            : Math.max(0, Number(snapshot?.txns1h || 0));
        const dexPairFound = Boolean(snapshot?.dexPairFound) || (snapshot?.executionRouteKind === "proxy" && Boolean(snapshot?.executionPairUrl));
        const basePriceForCap = livePrice > 0 ? livePrice : seed.marketCapUsd > 0 ? price : 0;
        const volume24h = Math.max(0, Number((volumeBase * activityMultiplier).toFixed(2)));
        const liquidity = Number((liquidityBase * clamp(0.84 + sampleDensity * 0.14 + Math.abs(cycleReturnPct) / 90, 0.62, 1.32)).toFixed(2));
        const spreadBps = Number((liveSpread * clamp(1.16 - Math.abs(recent6hReturnPct) / 24 + (sampleDensity < 0.5 ? 0.12 : 0), 0.74, 1.58)).toFixed(2));
        const marketCap = Number((
            basePriceForCap > 0
                ? liveMarketCap * clamp(price / basePriceForCap, 0.58, 1.55)
                : liveMarketCap
        ).toFixed(2));
        const tokenAgeDays = Math.max(1, Number(snapshot?.tokenAgeDays || seed.tokenAgeDays));

        return {
            symbol: seed.symbol,
            displaySymbol: seed.displaySymbol,
            chain: seed.chain,
            providerId: seed.providerId,
            price,
            change24h,
            liquidity: Number(liquidity.toFixed(2)),
            volume24h: Number(volume24h.toFixed(2)),
            spreadBps: Number(spreadBps.toFixed(2)),
            marketCap: Number(marketCap.toFixed(2)),
            tokenAgeDays,
            txns1h,
            dexPairFound,
            historyBars,
            dataCompleteness: Number(dataCompleteness.toFixed(3)),
            stabilityScore: seed.stabilityScore,
            priceDataScore: seed.priceDataScore,
            universeRankScore: 0,
            executionSupported: snapshot?.executionSupported,
            contractAddress: snapshot?.contractAddress,
            dexPairUrl: snapshot?.dexPairUrl,
            executionChain: snapshot?.executionChain,
            executionChainId: snapshot?.executionChainId,
            executionAddress: snapshot?.executionAddress,
            executionDecimals: snapshot?.executionDecimals,
            executionRouteKind: snapshot?.executionRouteKind,
            executionSource: snapshot?.executionSource,
            executionPairUrl: snapshot?.executionPairUrl,
            executionLiquidityUsd,
            executionVolume24hUsd,
            executionTxns1h,
            marketSource: snapshot?.source,
            tags: seed.tags || [],
            excludedFromUniverse: seed.excludeFromUniverse,
            universeExclusionReason: seed.universeExclusionReason,
        };
    });
}

function applyUniverseExclusions(rawAssets: UniverseAsset[], seedMap: Map<string, StrategyUniverseSeed>) {
    const eligible: UniverseAsset[] = [];
    const excluded: UniverseAsset[] = [];
    const softExcluded: UniverseAsset[] = [];

    rawAssets.forEach((asset) => {
        const seed = seedMap.get(asset.symbol);
        let reason = asset.universeExclusionReason;
        const effectivePairFound = asset.dexPairFound || (asset.executionRouteKind === "proxy" && Boolean(asset.executionPairUrl));
        const effectiveTxns1h = asset.executionRouteKind === "proxy"
            ? Math.max(asset.txns1h, asset.executionTxns1h || 0)
            : asset.txns1h;

        if (!reason && STRATEGY_CONFIG.EXCLUDE_STABLECOINS && (TRADE_CONFIG.STABLECOINS.includes(asset.symbol) || asset.tags.includes("stablecoin"))) {
            reason = "Stablecoin excluded from directional universe";
        }
        if (!reason && STRATEGY_CONFIG.EXCLUDE_WRAPPED_DUPLICATES && asset.tags.includes("wrapped-duplicate")) {
            reason = "Wrapped duplicate excluded from primary universe";
        }
        if (!reason && (seed?.excludeFromUniverse || false)) {
            reason = seed?.universeExclusionReason || "Seed excluded";
        }
        if (!reason && !effectivePairFound) reason = "DexScreener pair missing";
        if (!reason && effectiveTxns1h < STRATEGY_CONFIG.UNIVERSE_MIN_TXNS_1H && !asset.executionSupported) reason = "1h trades below minimum";
        if (!reason && asset.price <= 0) reason = "Price data missing";
        if (!reason && asset.dataCompleteness < STRATEGY_CONFIG.UNIVERSE_EXCLUSION_MIN_DATA_COMPLETENESS) reason = "Data completeness too low";
        if (!reason && asset.tokenAgeDays < STRATEGY_CONFIG.UNIVERSE_EXCLUSION_MIN_TOKEN_AGE_DAYS) reason = "Token age too short";
        if (!reason && asset.spreadBps > STRATEGY_CONFIG.PREFILTER_MAX_SPREAD_BPS * STRATEGY_CONFIG.UNIVERSE_EXCLUSION_MAX_SPREAD_MULTIPLIER) reason = "Spread too wide";

        const scoredAsset = { ...asset, universeRankScore: scoreUniverseCandidate(asset) };
        if (reason) {
            const rescueCandidate = reason !== "Price data missing"
                && reason !== "DexScreener pair missing"
                && reason !== "1h trades below minimum"
                && reason !== "Stablecoin excluded from directional universe"
                && reason !== "Wrapped duplicate excluded from primary universe"
                && reason !== "Seed excluded"
                && scoredAsset.price > 0;
            if (rescueCandidate) {
                softExcluded.push({ ...scoredAsset, excludedFromUniverse: true, universeExclusionReason: reason });
            } else {
                excluded.push({ ...scoredAsset, excludedFromUniverse: true, universeExclusionReason: reason });
            }
            return;
        }

        eligible.push(scoredAsset);
    });

    if (eligible.length < STRATEGY_CONFIG.MONITORED_UNIVERSE_MIN_COVERAGE) {
        const needed = STRATEGY_CONFIG.MONITORED_UNIVERSE_MIN_COVERAGE - eligible.length;
        const rescued = softExcluded
            .sort((left, right) => right.universeRankScore - left.universeRankScore)
            .slice(0, needed)
            .map((asset) => ({
                ...asset,
                excludedFromUniverse: false,
                universeExclusionReason: undefined,
            }));
        eligible.push(...rescued);
        const rescuedSymbols = new Set(rescued.map((asset) => asset.symbol));
        excluded.push(...softExcluded.filter((asset) => !rescuedSymbols.has(asset.symbol)));
    } else {
        excluded.push(...softExcluded);
    }

    return { eligible, excluded };
}

function buildMonitoredUniverse(eligibleAssets: UniverseAsset[]) {
    const sorted = [...eligibleAssets].sort((left, right) => right.universeRankScore - left.universeRankScore);
    const chainFloor = Math.min(STRATEGY_CONFIG.MONITORED_CHAIN_MIN_COVERAGE, Math.ceil(STRATEGY_CONFIG.UNIVERSE_MAX_SIZE / 3));
    const chainBuckets = new Map<StrategyUniverseChain, UniverseAsset[]>();

    sorted.forEach((asset) => {
        const bucket = chainBuckets.get(asset.chain) || [];
        bucket.push(asset);
        chainBuckets.set(asset.chain, bucket);
    });

    const prioritized: UniverseAsset[] = [];
    const picked = new Set<string>();

    chainBuckets.forEach((bucket) => {
        bucket.slice(0, chainFloor).forEach((asset) => {
            if (picked.has(asset.symbol)) return;
            picked.add(asset.symbol);
            prioritized.push(asset);
        });
    });

    sorted.forEach((asset) => {
        if (picked.has(asset.symbol)) return;
        if (prioritized.length >= STRATEGY_CONFIG.UNIVERSE_MAX_SIZE) return;
        picked.add(asset.symbol);
        prioritized.push(asset);
    });

    return prioritized
        .slice(0, STRATEGY_CONFIG.UNIVERSE_MAX_SIZE)
        .map((asset, index) => ({ ...asset, tier: assignTier(index) }));
}

function derivePrefilterMode(monitoredUniverse: UniverseAsset[]): PrefilterMode {
    const ranked = [...monitoredUniverse]
        .sort((left, right) => right.universeRankScore - left.universeRankScore)
        .slice(0, 18);
    if (!ranked.length) return "Trend";

    const avgAbsMove = average(ranked.map((asset) => Math.abs(asset.change24h)));
    const directionalBias = Math.abs(average(ranked.map((asset) => asset.change24h)));
    const strongMoveCount = ranked.filter((asset) => Math.abs(asset.change24h) >= 5.8).length;
    const directionalCount = ranked.filter((asset) => Math.abs(asset.change24h) >= 4.2 && Math.sign(asset.change24h) === Math.sign(average(ranked.map((item) => item.change24h)) || 1)).length;

    return strongMoveCount >= 5 || (avgAbsMove >= 5.6 && directionalBias >= 2.1) || directionalCount >= 6
        ? "Trend"
        : "Range";
}

function getPrefilterProfile(cycleContext: CycleComputationContext, mode: PrefilterMode, monitoredCount: number) {
    const rangeTargetMin = clamp(Math.ceil(monitoredCount * 0.34), 12, 24);
    const liveTrendTargetMin = clamp(Math.ceil(monitoredCount * 0.26), 10, 20);

    if (cycleContext.anchorSource === "completed") {
        const base = {
            floorBuffer: STRATEGY_CONFIG.PREFILTER_COMPLETED_BUFFER,
            spreadMultiplier: STRATEGY_CONFIG.PREFILTER_COMPLETED_MAX_SPREAD_MULTIPLIER,
            targetMin: STRATEGY_CONFIG.PREFILTER_COMPLETED_TARGET_MIN,
            referenceIncludeMin: STRATEGY_CONFIG.PREFILTER_REFERENCE_INCLUDE_MIN,
        };
        if (mode === "Range") {
            return {
                floorBuffer: Math.min(base.floorBuffer, 0.52),
                spreadMultiplier: Math.max(base.spreadMultiplier, 2.1),
                targetMin: rangeTargetMin,
                referenceIncludeMin: rangeTargetMin,
            };
        }
        return base;
    }
    if (cycleContext.anchorSource === "previous-day") {
        const base = {
            floorBuffer: Math.min(0.72, STRATEGY_CONFIG.PREFILTER_COMPLETED_BUFFER + 0.08),
            spreadMultiplier: Math.max(
                STRATEGY_CONFIG.PREFILTER_RELAXED_MAX_SPREAD_MULTIPLIER,
                STRATEGY_CONFIG.PREFILTER_COMPLETED_MAX_SPREAD_MULTIPLIER - 0.05,
            ),
            targetMin: Math.max(STRATEGY_CONFIG.PREFILTER_REFERENCE_INCLUDE_MIN, STRATEGY_CONFIG.PREFILTER_COMPLETED_TARGET_MIN - 2),
            referenceIncludeMin: STRATEGY_CONFIG.PREFILTER_REFERENCE_INCLUDE_MIN,
        };
        if (mode === "Range") {
            return {
                floorBuffer: Math.min(base.floorBuffer, 0.56),
                spreadMultiplier: Math.max(base.spreadMultiplier, 1.95),
                targetMin: rangeTargetMin,
                referenceIncludeMin: rangeTargetMin,
            };
        }
        return base;
    }
    if (mode === "Range") {
        return {
            floorBuffer: 0.68,
            spreadMultiplier: 1.55,
            targetMin: rangeTargetMin,
            referenceIncludeMin: rangeTargetMin,
        };
    }
    return {
        floorBuffer: cycleContext.anchorSource === "live" ? 0.78 : 1,
        spreadMultiplier: cycleContext.anchorSource === "live" ? 1.3 : 1,
        targetMin: cycleContext.anchorSource === "live" ? liveTrendTargetMin : STRATEGY_CONFIG.PREFILTER_TARGET_MIN,
        referenceIncludeMin: cycleContext.anchorSource === "live"
            ? liveTrendTargetMin
            : STRATEGY_CONFIG.PREFILTER_REFERENCE_INCLUDE_MIN,
    };
}

function evaluatePrefilter(
    asset: UniverseAsset,
    relaxed = false,
    profile?: { floorBuffer: number; spreadMultiplier: number },
) {
    const floorBuffer = profile?.floorBuffer ?? 1;
    const spreadBuffer = profile?.spreadMultiplier ?? 1;
    const proxyFloorMultiplier = asset.executionRouteKind === "proxy" ? STRATEGY_CONFIG.PREFILTER_PROXY_FLOOR_MULTIPLIER : 1;
    const volumeFloor = STRATEGY_CONFIG.PREFILTER_MIN_VOLUME_24H * (relaxed ? STRATEGY_CONFIG.PREFILTER_RELAXED_BUFFER : 1) * floorBuffer * proxyFloorMultiplier;
    const liquidityFloor = STRATEGY_CONFIG.PREFILTER_MIN_LIQUIDITY * (relaxed ? STRATEGY_CONFIG.PREFILTER_RELAXED_BUFFER : 1) * floorBuffer * proxyFloorMultiplier;
    const maxSpread = STRATEGY_CONFIG.PREFILTER_MAX_SPREAD_BPS * (relaxed ? STRATEGY_CONFIG.PREFILTER_RELAXED_MAX_SPREAD_MULTIPLIER : 1) * spreadBuffer;
    const minBars = Math.round(STRATEGY_CONFIG.PREFILTER_MIN_HISTORY_BARS * (relaxed ? STRATEGY_CONFIG.PREFILTER_RELAXED_BUFFER : 1) * floorBuffer);
    const minCompleteness = STRATEGY_CONFIG.PREFILTER_MIN_DATA_COMPLETENESS * (relaxed ? STRATEGY_CONFIG.PREFILTER_RELAXED_BUFFER : 1) * floorBuffer;
    const minAgeDays = Math.round(STRATEGY_CONFIG.PREFILTER_MIN_TOKEN_AGE_DAYS * (relaxed ? STRATEGY_CONFIG.PREFILTER_RELAXED_BUFFER : 1) * Math.max(floorBuffer, 0.8));

    const reasons: string[] = [];
    if (asset.spreadBps > maxSpread) reasons.push("Spread above max");
    if (asset.historyBars < minBars) reasons.push("History bars below minimum");
    if (asset.dataCompleteness < minCompleteness) reasons.push("Data completeness below minimum");
    if (asset.tokenAgeDays < minAgeDays) reasons.push("Token age below minimum");

    return { pass: reasons.length === 0, reason: reasons[0] || (relaxed ? "Relaxed prefilter include" : "Prefilter pass") };
}

function passesRangeRescueFloor(asset: UniverseAsset) {
    const spreadMax = STRATEGY_CONFIG.PREFILTER_MAX_SPREAD_BPS * 2.05;
    const minBars = Math.round(STRATEGY_CONFIG.PREFILTER_MIN_HISTORY_BARS * 0.5);
    const minCompleteness = STRATEGY_CONFIG.PREFILTER_MIN_DATA_COMPLETENESS * 0.5;
    const minAgeDays = Math.round(STRATEGY_CONFIG.PREFILTER_MIN_TOKEN_AGE_DAYS * 0.45);

    return asset.price > 0
        && asset.spreadBps <= spreadMax
        && asset.historyBars >= minBars
        && asset.dataCompleteness >= minCompleteness
        && asset.tokenAgeDays >= minAgeDays;
}

function passesLiveRangeReferenceFloor(asset: UniverseAsset) {
    const spreadMax = STRATEGY_CONFIG.PREFILTER_MAX_SPREAD_BPS * STRATEGY_CONFIG.PREFILTER_LIVE_RANGE_REFERENCE_MAX_SPREAD_MULTIPLIER;
    const minBars = Math.round(STRATEGY_CONFIG.PREFILTER_MIN_HISTORY_BARS * 0.4);
    const minCompleteness = Math.max(0.12, STRATEGY_CONFIG.PREFILTER_REFERENCE_MIN_DATA_COMPLETENESS - 0.02);
    const minAgeDays = Math.round(STRATEGY_CONFIG.PREFILTER_MIN_TOKEN_AGE_DAYS * 0.25);
    return asset.price > 0
        && (asset.executionSupported || asset.dexPairFound)
        && asset.spreadBps <= spreadMax
        && asset.historyBars >= minBars
        && asset.dataCompleteness >= minCompleteness
        && asset.tokenAgeDays >= minAgeDays;
}

function passesLiveTrendReferenceFloor(asset: UniverseAsset) {
    const spreadMax = STRATEGY_CONFIG.PREFILTER_MAX_SPREAD_BPS * STRATEGY_CONFIG.PREFILTER_LIVE_TREND_REFERENCE_MAX_SPREAD_MULTIPLIER;
    const minBars = Math.round(STRATEGY_CONFIG.PREFILTER_MIN_HISTORY_BARS * 0.38);
    const minCompleteness = Math.max(0.12, STRATEGY_CONFIG.PREFILTER_REFERENCE_MIN_DATA_COMPLETENESS - 0.01);
    const minAgeDays = Math.round(STRATEGY_CONFIG.PREFILTER_MIN_TOKEN_AGE_DAYS * 0.22);
    return asset.price > 0
        && (asset.executionSupported || asset.dexPairFound)
        && asset.spreadBps <= spreadMax
        && asset.historyBars >= minBars
        && asset.dataCompleteness >= minCompleteness
        && asset.tokenAgeDays >= minAgeDays;
}

function passesLiveBreadthRescueFloor(asset: UniverseAsset) {
    return asset.price > 0
        && (asset.executionSupported || asset.dexPairFound)
        && asset.dataCompleteness >= 0.02
        && asset.historyBars >= Math.round(STRATEGY_CONFIG.PREFILTER_MIN_HISTORY_BARS * 0.14)
        && asset.tokenAgeDays >= Math.round(STRATEGY_CONFIG.PREFILTER_MIN_TOKEN_AGE_DAYS * 0.06);
}

function applyPrefilter(monitoredUniverse: UniverseAsset[], cycleContext: CycleComputationContext) {
    const strictPassed: UniverseAsset[] = [];
    const relaxedCandidates: UniverseAsset[] = [];
    const strictExcluded: UniverseAsset[] = [];
    const liveBlockFloorMultiplier = cycleContext.anchorSource === "live" ? 0.96 : 1;
    const mode = derivePrefilterMode(monitoredUniverse);
    const profile = getPrefilterProfile(cycleContext, mode, monitoredUniverse.length);

    monitoredUniverse.forEach((asset) => {
        const strict = evaluatePrefilter({
            ...asset,
            volume24h: asset.volume24h * liveBlockFloorMultiplier,
            liquidity: asset.liquidity * liveBlockFloorMultiplier,
        }, false, profile);
        if (strict.pass) {
            strictPassed.push({ ...asset, prefilterPass: true, prefilterReason: "Prefilter pass" });
            return;
        }

        const relaxed = evaluatePrefilter({
            ...asset,
            volume24h: asset.volume24h * liveBlockFloorMultiplier,
            liquidity: asset.liquidity * liveBlockFloorMultiplier,
        }, true, profile);
        if (relaxed.pass) {
            relaxedCandidates.push({ ...asset, prefilterPass: false, prefilterReason: "Relaxed prefilter candidate" });
            return;
        }

        strictExcluded.push({ ...asset, prefilterPass: false, prefilterReason: strict.reason });
    });

    let passed = [...strictPassed];
    const targetMin = Math.min(STRATEGY_CONFIG.PREFILTER_TARGET_MAX, profile.targetMin);
    let rescuedCount = 0;
    if (passed.length < targetMin) {
        const needed = targetMin - passed.length;
        const relaxedAdds = relaxedCandidates
            .sort((left, right) => right.universeRankScore - left.universeRankScore)
            .slice(0, needed)
            .map((asset) => ({ ...asset, prefilterPass: true, prefilterReason: "Relaxed include to preserve evaluation breadth" }));
        passed = [
            ...passed,
            ...relaxedAdds,
        ];
        rescuedCount += relaxedAdds.length;
    }

    if (mode === "Range" && passed.length < targetMin) {
        const passedSymbols = new Set(passed.map((asset) => asset.symbol));
        const needed = targetMin - passed.length;
        const rangeAdds = monitoredUniverse
            .filter((asset) => !passedSymbols.has(asset.symbol) && passesRangeRescueFloor(asset))
            .sort((left, right) => right.universeRankScore - left.universeRankScore)
            .slice(0, needed)
            .map((asset) => ({
                ...asset,
                prefilterPass: true,
                prefilterReason: "Range rank rescue include",
            }));
        passed = [...passed, ...rangeAdds];
        rescuedCount += rangeAdds.length;
    }

    if (passed.length < targetMin && cycleContext.anchorSource !== "live") {
        const passedSymbols = new Set(passed.map((asset) => asset.symbol));
        const needed = Math.max(profile.referenceIncludeMin, targetMin - passed.length);
        const referenceAdds = monitoredUniverse
            .filter((asset) => !passedSymbols.has(asset.symbol) && asset.price > 0 && asset.dataCompleteness >= STRATEGY_CONFIG.PREFILTER_REFERENCE_MIN_DATA_COMPLETENESS)
            .sort((left, right) => right.universeRankScore - left.universeRankScore)
            .slice(0, needed)
            .map((asset) => ({
                ...asset,
                prefilterPass: true,
                prefilterReason: cycleContext.anchorSource === "completed"
                    ? mode === "Range" ? "Historical range reference include" : "Historical reference include"
                    : mode === "Range" ? "Previous-day range reference include" : "Previous-day proxy include",
            }));
        passed = [...passed, ...referenceAdds];
        rescuedCount += referenceAdds.length;
    }

    if (mode === "Range" && passed.length < targetMin && cycleContext.anchorSource === "live") {
        const passedSymbols = new Set(passed.map((asset) => asset.symbol));
        const needed = targetMin - passed.length;
        const liveReferenceAdds = monitoredUniverse
            .filter((asset) => !passedSymbols.has(asset.symbol) && passesLiveRangeReferenceFloor(asset))
            .sort((left, right) => right.universeRankScore - left.universeRankScore)
            .slice(0, needed)
            .map((asset) => ({
                ...asset,
                prefilterPass: true,
                prefilterReason: "Live range reference include",
            }));
        passed = [...passed, ...liveReferenceAdds];
        rescuedCount += liveReferenceAdds.length;
    }

    if (mode === "Trend" && passed.length < targetMin && cycleContext.anchorSource === "live") {
        const passedSymbols = new Set(passed.map((asset) => asset.symbol));
        const needed = targetMin - passed.length;
        const liveReferenceAdds = monitoredUniverse
            .filter((asset) => !passedSymbols.has(asset.symbol) && passesLiveTrendReferenceFloor(asset))
            .sort((left, right) => right.universeRankScore - left.universeRankScore)
            .slice(0, needed)
            .map((asset) => ({
                ...asset,
                prefilterPass: true,
                prefilterReason: "Live trend reference include",
            }));
        passed = [...passed, ...liveReferenceAdds];
        rescuedCount += liveReferenceAdds.length;
    }

    if (mode === "Range" && passed.length < targetMin && cycleContext.anchorSource === "live") {
        const passedSymbols = new Set(passed.map((asset) => asset.symbol));
        const needed = targetMin - passed.length;
        const executionBackedAdds = monitoredUniverse
            .filter((asset) => {
                if (passedSymbols.has(asset.symbol)) return false;
                return asset.price > 0
                    && asset.dataCompleteness >= 0.1
                    && asset.historyBars >= Math.round(STRATEGY_CONFIG.PREFILTER_MIN_HISTORY_BARS * 0.35)
                    && asset.tokenAgeDays >= Math.round(STRATEGY_CONFIG.PREFILTER_MIN_TOKEN_AGE_DAYS * 0.2)
                    && (asset.executionSupported || asset.dexPairFound);
            })
            .sort((left, right) => right.universeRankScore - left.universeRankScore)
            .slice(0, needed)
            .map((asset) => ({
                ...asset,
                prefilterPass: true,
                prefilterReason: "Live execution-backed include",
            }));
        passed = [...passed, ...executionBackedAdds];
        rescuedCount += executionBackedAdds.length;
    }

    if (passed.length < targetMin && cycleContext.anchorSource === "live") {
        const passedSymbols = new Set(passed.map((asset) => asset.symbol));
        const needed = targetMin - passed.length;
        const breadthRescueAdds = monitoredUniverse
            .filter((asset) => !passedSymbols.has(asset.symbol) && passesLiveBreadthRescueFloor(asset))
            .sort((left, right) => {
                    const leftTxns = Math.max(Number(left.executionTxns1h || 0), Number(left.txns1h || 0));
                    const rightTxns = Math.max(Number(right.executionTxns1h || 0), Number(right.txns1h || 0));
                    if (right.universeRankScore !== left.universeRankScore) return right.universeRankScore - left.universeRankScore;
                    if (rightTxns !== leftTxns) return rightTxns - leftTxns;
                    return right.stabilityScore - left.stabilityScore;
                })
            .slice(0, needed)
            .map((asset) => ({
                ...asset,
                prefilterPass: true,
                prefilterReason: "Live breadth rescue include",
            }));
        passed = [...passed, ...breadthRescueAdds];
        rescuedCount += breadthRescueAdds.length;
    }

    if (mode === "Trend" && passed.length < targetMin && cycleContext.anchorSource === "live") {
        const passedSymbols = new Set(passed.map((asset) => asset.symbol));
        const needed = targetMin - passed.length;
        const executionBackedAdds = monitoredUniverse
            .filter((asset) => {
                if (passedSymbols.has(asset.symbol)) return false;
                return asset.price > 0
                    && asset.dataCompleteness >= 0.12
                    && asset.historyBars >= Math.round(STRATEGY_CONFIG.PREFILTER_MIN_HISTORY_BARS * 0.35)
                    && asset.tokenAgeDays >= Math.round(STRATEGY_CONFIG.PREFILTER_MIN_TOKEN_AGE_DAYS * 0.18)
                    && (asset.executionSupported || asset.dexPairFound);
            })
            .sort((left, right) => right.universeRankScore - left.universeRankScore)
            .slice(0, needed)
            .map((asset) => ({
                ...asset,
                prefilterPass: true,
                prefilterReason: "Live trend execution-backed include",
            }));
        passed = [...passed, ...executionBackedAdds];
        rescuedCount += executionBackedAdds.length;
    }

    if (passed.length < targetMin && cycleContext.anchorSource === "live") {
        const passedSymbols = new Set(passed.map((asset) => asset.symbol));
        const needed = Math.max(3, targetMin - passed.length);
        const emergencyAdds = monitoredUniverse
            .filter((asset) => {
                if (passedSymbols.has(asset.symbol)) return false;
                const routeTxns1h = Math.max(Number(asset.executionTxns1h || 0), Number(asset.txns1h || 0));
                return asset.price > 0
                    && (asset.executionSupported || asset.dexPairFound)
                    && asset.dataCompleteness >= 0.01
                    && asset.historyBars >= Math.round(STRATEGY_CONFIG.PREFILTER_MIN_HISTORY_BARS * 0.08)
                    && asset.tokenAgeDays >= Math.max(1, Math.round(STRATEGY_CONFIG.PREFILTER_MIN_TOKEN_AGE_DAYS * 0.04))
                    && routeTxns1h >= 0;
            })
            .sort((left, right) => {
                const leftRouteLiquidity = Math.max(Number(left.executionLiquidityUsd || 0), Number(left.liquidity || 0));
                const rightRouteLiquidity = Math.max(Number(right.executionLiquidityUsd || 0), Number(right.liquidity || 0));
                const leftTxns = Math.max(Number(left.executionTxns1h || 0), Number(left.txns1h || 0));
                const rightTxns = Math.max(Number(right.executionTxns1h || 0), Number(right.txns1h || 0));
                if (right.universeRankScore !== left.universeRankScore) return right.universeRankScore - left.universeRankScore;
                if (rightTxns !== leftTxns) return rightTxns - leftTxns;
                return rightRouteLiquidity - leftRouteLiquidity;
            })
            .slice(0, needed)
            .map((asset) => ({
                ...asset,
                prefilterPass: true,
                prefilterReason: "Live emergency breadth include",
            }));
        passed = [...passed, ...emergencyAdds];
        rescuedCount += emergencyAdds.length;
    }

    passed = passed.sort((left, right) => right.universeRankScore - left.universeRankScore).slice(0, STRATEGY_CONFIG.PREFILTER_TARGET_MAX);
    const passedSymbols = new Set(passed.map((asset) => asset.symbol));
    const excluded = [
        ...strictExcluded,
        ...relaxedCandidates.filter((asset) => !passedSymbols.has(asset.symbol)).map((asset) => ({ ...asset, prefilterPass: false, prefilterReason: "Prefilter capacity cap" })),
        ...strictPassed.filter((asset) => !passedSymbols.has(asset.symbol)).map((asset) => ({ ...asset, prefilterPass: false, prefilterReason: "Prefilter capacity cap" })),
    ];

    return { passed, excluded, mode, rescuedCount, targetMin };
}

function buildReasonTags(scoreBreakdown: Record<string, number>) {
    return (Object.keys(CANDIDATE_SCORE_MAX) as (keyof typeof CANDIDATE_SCORE_MAX)[])
        .map((key) => ({ key, label: SCORE_LABELS[key], ratio: scoreBreakdown[key] / CANDIDATE_SCORE_MAX[key] }))
        .filter((item) => item.ratio >= 0.62)
        .sort((left, right) => right.ratio - left.ratio)
        .slice(0, 3)
        .map((item) => item.label);
}

function buildCandidateDraft(
    asset: UniverseAsset,
    input: StrategyEngineInput,
    referenceTs: number,
    volumeMedian: number,
    bnbChange24h: number,
) {
    const samples = input.priceHistory[asset.symbol] || [];
    const volatilityHint = clamp(asset.spreadBps / 1000 + Math.abs(asset.change24h) / 300, 0.008, 0.06);
    const s1m = bucketSeriesWithFallback(asset.symbol, samples, 60_000, 4 * 60 * 60 * 1000, referenceTs, asset.price, asset.change24h, 180, volatilityHint);
    const s5m = bucketSeriesWithFallback(asset.symbol, samples, 5 * 60_000, 18 * 60 * 60 * 1000, referenceTs, asset.price, asset.change24h, 96, volatilityHint);
    const s15m = bucketSeriesWithFallback(asset.symbol, samples, 15 * 60_000, 24 * 60 * 60 * 1000, referenceTs, asset.price, asset.change24h, 64, volatilityHint);
    const s1h = bucketSeriesWithFallback(asset.symbol, samples, 60 * 60_000, 30 * 60 * 60 * 1000, referenceTs, asset.price, asset.change24h, 48, volatilityHint);
    const s4h = bucketSeriesWithFallback(asset.symbol, samples, 4 * 60 * 60_000, 48 * 60 * 60 * 1000, referenceTs, asset.price, asset.change24h, 24, volatilityHint);
    const s6h = bucketSeriesWithFallback(asset.symbol, samples, 6 * 60 * 60_000, 72 * 60 * 60 * 1000, referenceTs, asset.price, asset.change24h, 16, volatilityHint);
    const priceSeries = s1m.length ? s1m : [asset.price];
    const r1 = pctFromSeries(priceSeries, 1);
    const r5 = pctFromSeries(s5m, 1);
    const r15 = pctFromSeries(s15m, 1);
    const r60 = pctFromSeries(s1h, 1);
    const r360 = s6h.length >= 2 ? pctFromSeries(s6h, 1) : r60 * 4;
    const r1440 = asset.change24h / 100;
    const rsi1d = s1h.length >= 15 ? rsi(s1h.slice(-25), 14) : 50 + clamp(asset.change24h, -10, 10);
    const rsi6h = s15m.length >= 15 ? rsi(s15m.slice(-25), 14) : 50 + clamp(r360 * 200, -15, 15);
    const rsi1h = s5m.length >= 15 ? rsi(s5m.slice(-25), 14) : 50 + clamp(r60 * 300, -15, 15);
    const macd1d = s1h.length >= 35 ? macdHistogram(s1h) / asset.price : r1440;
    const macd6h = s15m.length >= 35 ? macdHistogram(s15m) / asset.price : r360;
    const macd1h = s5m.length >= 35 ? macdHistogram(s5m) / asset.price : r60;
    const vwap1h = vwapProxyDeltaPct(s1h.slice(-8), asset.price);
    const vwap15m = vwapProxyDeltaPct(s15m.slice(-12), asset.price);
    const dmi1h = dmiAdxProxy(s1h.slice(-20));
    const ema20_1h = ema(s1h, 20);
    const ema50_1h = ema(s1h, 50);
    const ema200_1h = ema(s1h, 200);
    const ema20_4h = ema(s4h, 20);
    const ema50_4h = ema(s4h, 50);
    const emaBull1h = asset.price > ema20_1h && ema20_1h >= ema50_1h && ema50_1h >= ema200_1h;
    const emaBull4h = ema20_4h >= ema50_4h;
    const emaSlope1h = emaSlopePct(s1h, 20, 2);
    const emaSlope4h = emaSlopePct(s4h, 20, 1);
    const bandWidth1h = bollingerWidthPct(s1h, 20);
    const chop1h = choppiness(s1h, 14);
    const chop15m = choppiness(s15m, 14);
    const sr1h = supportResistancePct(s1h.slice(-24), asset.price);
    const atr1h = atrPct(s1h, 14);
    const atr15m = atrPct(s15m, 14);
    const atr5m = atrPct(s5m, 14);
    const effectiveAtr = atr1h || atr15m || atr5m;
    const volumeRatio = volumeMedian > 0 ? asset.volume24h / volumeMedian : 1;
    const relativeStrengthRaw = ((r360 - bnbChange24h / 100) * 100) + ((asset.change24h - bnbChange24h) * 0.35);
    const trendModeBias = (emaBull1h ? 1.5 : -0.4) + (emaBull4h ? 1.1 : -0.2) + scaleScore(emaSlope1h, -0.012, 0.02, -0.3, 1.2) + (dmi1h.plusDi > dmi1h.minusDi ? 0.8 : -0.5);
    const meanReversionBias = (rsi1h <= 42 ? 1.1 : 0) + (sr1h.supportPct <= Math.max(0.012, effectiveAtr * 1.05) ? 0.9 : 0) + (chop1h >= 56 ? 0.8 : 0) + (dmi1h.adx <= 18 ? 0.8 : -0.4);
    const mode: TradeMode = trendModeBias >= meanReversionBias ? "TREND" : "MEAN_REVERSION";

    const routeLiquidityUsd = resolveCandidateRouteLiquidity(asset);
    const routeVolume24hUsd = resolveCandidateRouteVolume(asset);
    const routeTxns1h = resolveCandidateRouteTxns(asset);
    const liquidityBackedVolumePass = true;
    const volumeConfirmed = true;
    const trendScore = clamp(
        (emaBull1h ? 12.5 : asset.change24h > 0 ? 8 : 4.5)
        + (emaBull4h ? 6.8 : r360 > 0 ? 4.8 : 2.2)
        + scaleScore(emaSlope1h, -0.012, 0.02, 1.5, 4.6)
        + scaleScore(emaSlope4h, -0.01, 0.018, 1.0, 3.1)
        + scaleScore(dmi1h.plusDi - dmi1h.minusDi, -18, 24, 0.8, 2.1)
        + scaleScore(dmi1h.adx, 8, 36, 0.6, 1.4)
        + (r60 > 0 ? 1.2 : 0.2)
        + (r360 > 0 ? 1.2 : 0.2),
        0,
        CANDIDATE_SCORE_MAX.trend,
    );
    const momentumScore = clamp(
        scaleScore(macd1h, -0.018, 0.025, 2.8, 8.0)
        + scaleScore(macd6h, -0.025, 0.035, 2.0, 4.6)
        + scaleScore(r60, -0.04, 0.08, 1.7, 3.8)
        + scaleScore(r360, -0.08, 0.16, 1.5, 2.9)
        + scaleScore(rsi1h, 35, 75, 1.1, 2.1)
        + scaleScore(rsi6h, 38, 75, 1.1, 2.0)
        + (r15 > 0 ? 1.5 : 0.3),
        0,
        CANDIDATE_SCORE_MAX.momentum,
    );
    const volumeScore = Number((CANDIDATE_SCORE_MAX.volume * 0.55).toFixed(2));
    const structureScore = clamp(
        scaleScore(vwap1h, -0.01, 0.035, 2.1, 3.8)
        + scaleScore(vwap15m, -0.008, 0.02, 1.4, 2.4)
        + scaleScore(sr1h.resistancePct, 0.004, 0.08, 1.2, 2.8)
        + scaleScore(sr1h.supportPct, 0.002, 0.05, 1.2, 2.3),
        0,
        CANDIDATE_SCORE_MAX.structure,
    );
    const rr = sr1h.resistancePct / Math.max(effectiveAtr, 0.0025);
    const riskFitScore = clamp(
        scaleScore(rr, 0.75, 3.4, 1.5, 3.1)
        + scaleScore(effectiveAtr, 0.12, 0.012, 0.9, 1.6)
        + scaleScore(asset.spreadBps, STRATEGY_CONFIG.PREFILTER_MAX_SPREAD_BPS * 1.5, 8, 0.6, 1.0),
        0,
        CANDIDATE_SCORE_MAX.riskFit,
    );

    const vetoReasons: string[] = [];
    if (asset.spreadBps > STRATEGY_CONFIG.PREFILTER_MAX_SPREAD_BPS * 1.12) vetoReasons.push("Spread too wide for execution");

    const indicatorNotes = [
        `Trend: 1H EMA ${emaBull1h ? "aligned" : "broken"} / 4H ${emaBull4h ? "supportive" : "soft"} / slope ${(emaSlope1h * 100).toFixed(2)}%`,
        `Momentum: RSI 1D ${rsi1d.toFixed(0)} / 6H ${rsi6h.toFixed(0)} / 1H ${rsi1h.toFixed(0)} | MACD 1H ${(macd1h * 100).toFixed(2)}bp`,
        `Route: route vol $${Math.round(routeVolume24hUsd / 1_000_000)}m / route liq $${Math.round(routeLiquidityUsd / 1_000_000)}m / txns1h ${routeTxns1h}`,
        `Structure: support ${(sr1h.supportPct * 100).toFixed(2)}% / resistance ${(sr1h.resistancePct * 100).toFixed(2)}% / VWAP ${(vwap1h * 100).toFixed(2)}%`,
        `Relative Strength: 6H ${(r360 * 100).toFixed(2)}% / 24H ${asset.change24h.toFixed(2)}% / vs BNB ${relativeStrengthRaw.toFixed(2)}`,
        `Risk: ATR ${(effectiveAtr * 100).toFixed(2)}% / spread ${asset.spreadBps.toFixed(0)} bps / RR ${rr.toFixed(2)}`,
    ];

    return {
        asset,
        mode,
        vetoReasons,
        baseBreakdown: {
            trend: Number(trendScore.toFixed(2)),
            momentum: Number(momentumScore.toFixed(2)),
            volume: Number(volumeScore.toFixed(2)),
            structure: Number(structureScore.toFixed(2)),
            relativeStrength: 0,
            riskFit: Number(riskFitScore.toFixed(2)),
            bonus: 0,
        },
        indicatorNotes,
        volumeRatio,
        volumeConfirmed,
        relativeStrengthRaw,
        metrics: {
            r1,
            r5,
            r15,
            r60,
            r360,
            r1440,
            rsi1d,
            rsi6h,
            rsi1h,
            macd1d,
            macd6h,
            macd1h,
            vwap1h,
            vwap15m,
            adx1h: dmi1h.adx,
            plusDi1h: dmi1h.plusDi,
            minusDi1h: dmi1h.minusDi,
            emaBull1h,
            emaBull4h,
            emaSlope1h,
            emaSlope4h,
            bandWidth1h,
            chop1h,
            chop15m,
            rr,
        },
        supportDistancePct: sr1h.supportPct,
        resistanceDistancePct: sr1h.resistancePct,
        atrPct: effectiveAtr,
    };
}

function scoreCandidates(prefilteredAssets: UniverseAsset[], input: StrategyEngineInput, cycleContext: CycleComputationContext) {
    if (prefilteredAssets.length === 0) return [];

    const referenceTs = cycleContext.anchorTs;
    const volumeMedian = average(prefilteredAssets.map((asset) => asset.volume24h).filter((value) => value > 0));
    const bnbChange24h = prefilteredAssets.find((asset) => asset.symbol === "BNB")?.change24h || 0;
    const drafts = prefilteredAssets.map((asset) => buildCandidateDraft(asset, input, referenceTs, volumeMedian, bnbChange24h));
    const rsSorted = [...drafts].sort((left, right) => right.relativeStrengthRaw - left.relativeStrengthRaw);
    const return6hSorted = [...drafts].sort((left, right) => right.metrics.r360 - left.metrics.r360);
    const return24hSorted = [...drafts].sort((left, right) => right.metrics.r1440 - left.metrics.r1440);
    const rsRankMap = new Map(rsSorted.map((draft, index) => [draft.asset.symbol, index]));
    const return6hRankMap = new Map(return6hSorted.map((draft, index) => [draft.asset.symbol, index]));
    const return24hRankMap = new Map(return24hSorted.map((draft, index) => [draft.asset.symbol, index]));

    return drafts.map((draft) => {
        const rsRank = rsRankMap.get(draft.asset.symbol) ?? drafts.length - 1;
        const return6hRank = return6hRankMap.get(draft.asset.symbol) ?? drafts.length - 1;
        const return24hRank = return24hRankMap.get(draft.asset.symbol) ?? drafts.length - 1;
        const percentile = drafts.length > 1 ? 1 - (rsRank / (drafts.length - 1)) : 1;
        const return6hPercentile = drafts.length > 1 ? 1 - (return6hRank / (drafts.length - 1)) : 1;
        const return24hPercentile = drafts.length > 1 ? 1 - (return24hRank / (drafts.length - 1)) : 1;
        const relativeStrengthScore = clamp(
            scaleScore(draft.relativeStrengthRaw, -12, 45, 3.8, 7.4)
            + percentile * 5.3
            + return6hPercentile * 2.7
            + return24hPercentile * 1.9
            + (percentile >= 0.9 ? 1.8 : percentile >= STRATEGY_CONFIG.HALF_SIZE_RS_PERCENTILE ? 1.2 : 0.5),
            0,
            CANDIDATE_SCORE_MAX.relativeStrength,
        );
        const bonusScore = clamp(
            (return6hPercentile >= 0.8 ? 4.5 : return6hPercentile >= 0.6 ? 3 : return6hPercentile >= 0.4 ? 1.5 : 0.5)
            + (return24hPercentile >= 0.8 ? 4.5 : return24hPercentile >= 0.6 ? 3 : return24hPercentile >= 0.4 ? 1.5 : 0.5)
            + (percentile >= 0.9 ? 4.5 : percentile >= 0.75 ? 3 : percentile >= 0.55 ? 1.5 : 0.5)
            + (draft.volumeConfirmed ? 3.5 : 0.5),
            0,
            CANDIDATE_SCORE_MAX.bonus,
        );
        const scoreBreakdown = {
            ...draft.baseBreakdown,
            relativeStrength: Number(relativeStrengthScore.toFixed(2)),
            bonus: Number(bonusScore.toFixed(2)),
        };
        const weightedScore = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
        const normalized = normalizeCandidateScore(weightedScore);
        const reasonTags = buildReasonTags(scoreBreakdown);
        const vetoPass = draft.vetoReasons.length === 0;
        const marketScore = normalized.normalizedScore;
        const executionStatus = resolveExecutionStatus({
            price: draft.asset.price,
            dataCompleteness: draft.asset.dataCompleteness,
            executionSupported: draft.asset.executionSupported,
            marketSource: draft.asset.marketSource,
            vetoReasons: draft.vetoReasons,
        });
        const autoTradeExcludedReason = resolveExecutionBlockReason({
            executionRouteKind: draft.asset.executionRouteKind,
            executionChain: draft.asset.executionChain,
        });
        const fullSizeMinRr = cycleContext.anchorSource === "live"
            ? STRATEGY_CONFIG.FULL_SIZE_MIN_RR
            : Math.max(1.02, STRATEGY_CONFIG.FULL_SIZE_MIN_RR - STRATEGY_CONFIG.HALF_SIZE_MIN_RR_HISTORICAL_RELIEF);
        const aHalfSizeMinRr = cycleContext.anchorSource === "live"
            ? STRATEGY_CONFIG.A_HALF_SIZE_MIN_RR
            : Math.max(0.84, STRATEGY_CONFIG.A_HALF_SIZE_MIN_RR - STRATEGY_CONFIG.HALF_SIZE_MIN_RR_HISTORICAL_RELIEF);
        const halfSizeMinRr = cycleContext.anchorSource === "live"
            ? STRATEGY_CONFIG.HALF_SIZE_MIN_RR
            : Math.max(0.98, STRATEGY_CONFIG.HALF_SIZE_MIN_RR - STRATEGY_CONFIG.HALF_SIZE_MIN_RR_HISTORICAL_RELIEF);
        const routeMissing = executionStatus === "Route Missing";
        const seedFallback = executionStatus === "Seed Fallback" || draft.asset.marketSource === "seed";
        const rrStatus = rrStatusFromValue(draft.metrics.rr, fullSizeMinRr, aHalfSizeMinRr);
        const resistanceStatus = resistanceStatusFromValue(draft.resistanceDistancePct, draft.atrPct, draft.metrics.rr);
        const rrCheck = draft.metrics.rr >= halfSizeMinRr;
        const seedProxyHalfSizeEligible = isSeedRouteReviewCandidate({
            executionSupported: draft.asset.executionSupported,
            routeMissing,
            seedFallback,
            autoTradeExcludedReason,
            marketScore,
            rrStatus,
            resistanceStatus,
            executionLiquidityUsd: draft.asset.executionLiquidityUsd,
            liquidity: draft.asset.liquidity,
            executionTxns1h: draft.asset.executionTxns1h,
            txns1h: draft.asset.txns1h,
        });
        const conditionalReferencePass = isConditionalReferencePassCandidate({
            executionSupported: draft.asset.executionSupported,
            routeMissing,
            seedFallback,
            autoTradeExcludedReason,
            tier: draft.asset.tier,
            marketScore,
            universeRankScore: draft.asset.universeRankScore,
            rr: draft.metrics.rr,
            resistanceStatus,
            volumeRatio: draft.volumeRatio,
            volumeConfirmed: draft.volumeConfirmed,
            relativeStrengthPercentile: percentile,
            executionLiquidityUsd: draft.asset.executionLiquidityUsd,
            liquidity: draft.asset.liquidity,
            executionTxns1h: draft.asset.executionTxns1h,
            txns1h: draft.asset.txns1h,
        });
        const fullSizeEligible = executionStatus === "Pass"
            && !autoTradeExcludedReason
            && !seedFallback
            && marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_A
            && rrStatus === "OK"
            && resistanceStatus === "Open";
        const aHalfSizeEligible = executionStatus === "Pass"
            && !autoTradeExcludedReason
            && !seedFallback
            && marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_A
            && (
                (rrStatus === "OK" && resistanceStatus === "Tight")
                || (rrStatus === "Weak" && resistanceStatus !== "Blocked")
            );
        const bHalfSizeEligible = !autoTradeExcludedReason
            && executionStatus === "Pass"
            && !seedFallback
            && marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_B
            && marketScore < STRATEGY_CONFIG.SCORE_THRESHOLD_A
            && percentile >= STRATEGY_CONFIG.HALF_SIZE_RS_PERCENTILE
            && draft.volumeConfirmed
            && rrCheck
            && resistanceStatus !== "Blocked";
        const halfSizeEligible = aHalfSizeEligible || bHalfSizeEligible || seedProxyHalfSizeEligible || conditionalReferencePass;
        const selectionEligible = fullSizeEligible || halfSizeEligible;

        return {
            symbol: draft.asset.symbol,
            displaySymbol: draft.asset.displaySymbol,
            chain: draft.asset.chain,
            tier: draft.asset.tier,
            price: draft.asset.price,
            change24h: draft.asset.change24h,
            volume: draft.asset.volume24h,
            liquidity: draft.asset.liquidity,
            spreadBps: draft.asset.spreadBps,
            txns1h: draft.asset.txns1h,
            dexPairFound: draft.asset.dexPairFound,
            historyBars: draft.asset.historyBars,
            dataCompleteness: draft.asset.dataCompleteness,
            universeRankScore: draft.asset.universeRankScore,
            executionSupported: draft.asset.executionSupported,
            contractAddress: draft.asset.contractAddress,
            dexPairUrl: draft.asset.dexPairUrl,
            executionChain: draft.asset.executionChain,
            executionChainId: draft.asset.executionChainId,
            executionAddress: draft.asset.executionAddress,
            executionDecimals: draft.asset.executionDecimals,
            executionRouteKind: draft.asset.executionRouteKind,
            executionSource: draft.asset.executionSource,
            executionPairUrl: draft.asset.executionPairUrl,
            executionLiquidityUsd: draft.asset.executionLiquidityUsd,
            executionVolume24hUsd: draft.asset.executionVolume24hUsd,
            executionTxns1h: draft.asset.executionTxns1h,
            marketSource: draft.asset.marketSource,
            mode: draft.mode,
            rank: normalizedScoreToRank(marketScore),
            status: marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_B ? "Watchlist" : "Below Threshold",
            executionStatus,
            tradeDecision: autoTradeExcludedReason
                ? "Blocked"
                : fullSizeEligible
                  ? "Selected"
                  : halfSizeEligible
                    ? "Half-size Eligible"
                    : marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_B
                      ? "Watchlist"
                      : "Blocked",
            marketScore,
            score: marketScore,
            rawScore: normalized.rawScore,
            weightedScore: normalized.weightedScore,
            maxPossibleScore: normalized.maxPossibleScore,
            confidence: confidenceFromNormalizedScore(marketScore, draft.asset.dataCompleteness),
            veto: !vetoPass,
            vetoPass,
            vetoReasons: draft.vetoReasons,
            mainReason: describeAutoTradeExcludedReasonV2(autoTradeExcludedReason)
                || (conditionalReferencePass ? "Conditional reference pass" : undefined)
                || draft.vetoReasons[0]
                || reasonTags[0]
                || "Signals mixed",
            autoTradeExcludedReason,
            positionSizeMultiplier: autoTradeExcludedReason
                ? 0
                : fullSizeEligible
                ? STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER
                : halfSizeEligible
                  ? STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
                  : 0,
            positionSizeLabel: autoTradeExcludedReason
                ? positionSizeLabel(0)
                : fullSizeEligible
                ? positionSizeLabel(STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER)
                : halfSizeEligible
                  ? positionSizeLabel(STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER)
                  : positionSizeLabel(0),
            halfSizeEligible,
            fullSizeEligible,
            aHalfSizeEligible,
            bHalfSizeEligible,
            seedProxyHalfSizeEligible,
            conditionalReferencePass,
            probationaryEligible: false,
            selectionEligible,
            relativeStrengthPercentile: Number(percentile.toFixed(3)),
            volumeConfirmed: draft.volumeConfirmed,
            routeMissing,
            seedFallback,
            rrCheck,
            rrStatus,
            resistanceStatus,
            halfSizeMinRr,
            correlationRejected: false,
            finalSelectedEligible: false,
            finalRejectReason: undefined,
            reasonTags,
            indicatorNotes: draft.indicatorNotes,
            scoreBreakdown,
            supportDistancePct: draft.supportDistancePct,
            resistanceDistancePct: draft.resistanceDistancePct,
            atrPct: draft.atrPct,
            volumeRatio: draft.volumeRatio,
            relativeStrengthScore: draft.relativeStrengthRaw,
            correlationGroup: buildCorrelationGroup(draft.asset.symbol),
            prefilterPass: draft.asset.prefilterPass,
            prefilterReason: draft.asset.prefilterReason,
            metrics: draft.metrics,
        } satisfies CandidateAnalysis;
    }).sort((left, right) => right.marketScore - left.marketScore);
}

function blockPriority(block: CycleBlock, candidate: CandidateAnalysis) {
    const { metrics } = candidate;
    switch (block) {
        case "0:00-6:00":
            return metrics.r360 * 140 + metrics.r60 * 60 + (candidate.mode === "MEAN_REVERSION" ? 0.4 : 0.05);
        case "6:00-12:00":
            return metrics.r60 * 75 + metrics.vwap15m * 44 + metrics.bandWidth1h * 20;
        case "12:00-18:00":
            return metrics.r60 * 56 + metrics.r15 * 48 + metrics.adx1h * 0.08;
        case "18:00-24:00":
            return metrics.r1440 * 18 + metrics.r360 * 64 + metrics.r60 * 42 + (candidate.mode === "TREND" ? 0.5 : 0);
        default:
            return 0;
    }
}

function buildCandidateStatus(candidate: CandidateAnalysis, selectedCandidates: Map<string, CandidateAnalysis>, thresholdScore: number) {
    const thresholdGap = candidate.marketScore - thresholdScore;
    const marketContext = candidate.reasonTags?.slice(0, 2).join(" / ");
    const blockedPosition = {
        positionSizeMultiplier: 0,
        positionSizeLabel: positionSizeLabel(0),
    };
    const blockedState = {
        correlationRejected: false,
        finalSelectedEligible: false,
    };
    const preSelectedCandidate = selectedCandidates.get(candidate.symbol);

    if (preSelectedCandidate) {
        const halfSizeSelected = preSelectedCandidate.positionSizeMultiplier <= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER;
        return {
            status: "Selected" as const,
            tradeDecision: halfSizeSelected ? "Half-size Eligible" as const : "Selected" as const,
            selectionStage: "SELECTED" as const,
            exclusionReason: "Selected",
            mainReason: halfSizeSelected
                ? candidate.reasonTags[0] || "Half-size conditions satisfied"
                : candidate.reasonTags[0] || "Selected",
            thresholdGap,
            positionSizeMultiplier: preSelectedCandidate.positionSizeMultiplier,
            positionSizeLabel: preSelectedCandidate.positionSizeLabel,
            correlationRejected: false,
            finalSelectedEligible: true,
            finalRejectReason: undefined,
        };
    }

    if (candidate.executionStatus === "Data Missing") {
        const reason = "データ不足";
        return {
            status: "Data Missing" as const,
            tradeDecision: "Blocked" as const,
            selectionStage: "SCORE" as const,
            exclusionReason: reason,
            mainReason: marketContext ? `${marketContext}, ただし ${reason}` : reason,
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            ...blockedState,
        };
    }
    if (candidate.executionStatus === "Route Missing") {
        const reason = "実行ルートなし";
        return {
            status: "VETO Rejected" as const,
            tradeDecision: "Blocked" as const,
            selectionStage: "VETO" as const,
            exclusionReason: reason,
            mainReason: marketContext ? `${marketContext}, ただし ${reason}` : reason,
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            ...blockedState,
        };
    }
    if (candidate.executionStatus === "VETO NG") {
        const vetoReason = candidate.vetoReasons[0] || "VETO NG";
        return {
            status: "VETO Rejected" as const,
            tradeDecision: "Blocked" as const,
            selectionStage: "VETO" as const,
            exclusionReason: vetoReason,
            mainReason: marketContext ? `${marketContext}, ただし ${vetoReason}` : vetoReason,
            finalRejectReason: vetoReason,
            thresholdGap,
            ...blockedPosition,
            ...blockedState,
        };
    }
    if (candidate.executionStatus === "Seed Fallback") {
        if (candidate.seedProxyHalfSizeEligible || candidate.conditionalReferencePass) {
            const reason = candidate.conditionalReferencePass
                ? "Conditional reference pass: route-backed candidate stays reviewable at 0.5x"
                : "Seed fallback but route-backed execution remains reviewable at 0.5x";
            return {
                status: "Watchlist" as const,
                tradeDecision: "Half-size Eligible" as const,
                selectionStage: "RESERVE" as const,
                exclusionReason: reason,
                mainReason: marketContext ? `${marketContext}, ${reason}` : reason,
                finalRejectReason: undefined,
                thresholdGap,
                positionSizeMultiplier: STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER,
                positionSizeLabel: positionSizeLabel(STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER),
                correlationRejected: false,
                finalSelectedEligible: true,
            };
        }
        if (candidate.rank === "B") {
            const reason = "参考データのみのためB半ロット採用は見送り";
            return {
                status: "Watchlist" as const,
                tradeDecision: "Watchlist" as const,
                selectionStage: "RESERVE" as const,
                exclusionReason: reason,
                mainReason: marketContext ? `${marketContext}, ${reason}` : reason,
                finalRejectReason: reason,
                thresholdGap,
                ...blockedPosition,
                ...blockedState,
            };
        }
        const reason = "参考データのみ";
        return {
            status: "VETO Rejected" as const,
            tradeDecision: "Blocked" as const,
            selectionStage: "VETO" as const,
            exclusionReason: reason,
            mainReason: marketContext ? `${marketContext}, ただし ${reason}` : reason,
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            ...blockedState,
        };
    }
    if (candidate.autoTradeExcludedReason) {
        const reason = describeAutoTradeExcludedReason(candidate.autoTradeExcludedReason) || candidate.autoTradeExcludedReason;
        return {
            status: candidate.marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_B ? "Watchlist" as const : "Below Threshold" as const,
            tradeDecision: "Blocked" as const,
            selectionStage: "RESERVE" as const,
            exclusionReason: reason,
            mainReason: reason,
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            ...blockedState,
        };
    }
    const selectedCandidate = selectedCandidates.get(candidate.symbol);
    if (selectedCandidate) {
        const halfSizeSelected = selectedCandidate.positionSizeMultiplier <= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER;
        return {
            status: "Selected" as const,
            tradeDecision: halfSizeSelected ? "Half-size Eligible" as const : "Selected" as const,
            selectionStage: "SELECTED" as const,
            exclusionReason: "Selected",
            mainReason: halfSizeSelected
                ? candidate.reasonTags[0] || "Half-size conditions satisfied"
                : candidate.reasonTags[0] || "Selected",
            thresholdGap,
            positionSizeMultiplier: selectedCandidate.positionSizeMultiplier,
            positionSizeLabel: selectedCandidate.positionSizeLabel,
            correlationRejected: false,
            finalSelectedEligible: true,
            finalRejectReason: undefined,
        };
    }
    if (candidate.selectionEligible) {
        const reason = `Correlation / basket-cap filter (${candidate.correlationGroup})`;
        return {
            status: "Correlation Rejected" as const,
            tradeDecision: "Blocked" as const,
            selectionStage: "CORRELATION" as const,
            exclusionReason: reason,
            mainReason: marketContext ? `${marketContext}, but correlation blocked` : reason,
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            correlationRejected: true,
            finalSelectedEligible: false,
        };
    }
    if (candidate.marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_B) {
        const reason = buildInitialSelectionRejectReason(candidate, thresholdScore) || "B半ロット条件未達";
        return {
            status: "Watchlist" as const,
            tradeDecision: "Watchlist" as const,
            selectionStage: "RESERVE" as const,
            exclusionReason: reason,
            mainReason: reason,
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            ...blockedState,
        };
    }
    const reason = buildInitialSelectionRejectReason(candidate, thresholdScore) || buildScoreShortfallReason(candidate, thresholdScore);
    return {
        status: "Below Threshold" as const,
        tradeDecision: "Blocked" as const,
        selectionStage: "SCORE" as const,
        exclusionReason: reason,
        mainReason: reason,
        finalRejectReason: reason,
        thresholdGap,
        ...blockedPosition,
        ...blockedState,
    };
}

function buildCandidateStatusV2(candidate: CandidateAnalysis, selectedCandidates: Map<string, CandidateAnalysis>, thresholdScore: number) {
    const thresholdGap = candidate.marketScore - thresholdScore;
    const marketContext = candidate.reasonTags?.slice(0, 2).join(" / ");
    const blockedPosition = {
        positionSizeMultiplier: 0,
        positionSizeLabel: positionSizeLabel(0),
    };
    const blockedState = {
        correlationRejected: false,
        finalSelectedEligible: false,
    };
    const withContext = (reason: string) => (marketContext ? `${marketContext}, ${reason}` : reason);
    const preSelectedCandidate = selectedCandidates.get(candidate.symbol);

    if (preSelectedCandidate) {
        const halfSizeSelected = preSelectedCandidate.positionSizeMultiplier < STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER;
        const reason = halfSizeSelected
            ? candidate.rank === "A"
                ? "AランクだがRR/抵抗を考慮して半ロット採用"
                : "B条件達成のため半ロット採用"
            : "A条件達成のため通常ロット採用";
        return {
            status: "Selected" as const,
            tradeDecision: halfSizeSelected ? "Half-size Eligible" as const : "Selected" as const,
            selectionStage: "SELECTED" as const,
            exclusionReason: "Selected",
            mainReason: withContext(reason),
            thresholdGap,
            positionSizeMultiplier: preSelectedCandidate.positionSizeMultiplier,
            positionSizeLabel: preSelectedCandidate.positionSizeLabel,
            correlationRejected: false,
            finalSelectedEligible: true,
            finalRejectReason: undefined,
        };
    }

    if (candidate.executionStatus === "Data Missing") {
        const reason = "データ不足";
        return {
            status: "Data Missing" as const,
            tradeDecision: "Blocked" as const,
            selectionStage: "SCORE" as const,
            exclusionReason: reason,
            mainReason: withContext(reason),
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            ...blockedState,
        };
    }
    if (candidate.executionStatus === "Route Missing") {
        const reason = "実行ルートなし";
        return {
            status: "VETO Rejected" as const,
            tradeDecision: "Blocked" as const,
            selectionStage: "VETO" as const,
            exclusionReason: reason,
            mainReason: withContext(reason),
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            ...blockedState,
        };
    }
    if (candidate.executionStatus === "VETO NG") {
        const reason = candidate.vetoReasons[0] || "VETO NG";
        return {
            status: "VETO Rejected" as const,
            tradeDecision: "Blocked" as const,
            selectionStage: "VETO" as const,
            exclusionReason: reason,
            mainReason: withContext(reason),
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            ...blockedState,
        };
    }
    if (candidate.autoTradeExcludedReason) {
        const reason = describeAutoTradeExcludedReasonV2(candidate.autoTradeExcludedReason) || candidate.autoTradeExcludedReason;
        return {
            status: candidate.marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_B ? "Watchlist" as const : "Below Threshold" as const,
            tradeDecision: "Blocked" as const,
            selectionStage: "RESERVE" as const,
            exclusionReason: reason,
            mainReason: reason,
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            ...blockedState,
        };
    }
    if (candidate.executionStatus === "Seed Fallback") {
        if (candidate.seedProxyHalfSizeEligible || candidate.conditionalReferencePass) {
            const reason = candidate.conditionalReferencePass
                ? "Conditional reference pass: route-backed candidate stays reviewable at 0.5x"
                : "Seed fallback but route-backed execution remains reviewable at 0.5x";
            return {
                status: "Watchlist" as const,
                tradeDecision: "Half-size Eligible" as const,
                selectionStage: "RESERVE" as const,
                exclusionReason: reason,
                mainReason: withContext(reason),
                finalRejectReason: undefined,
                thresholdGap,
                positionSizeMultiplier: STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER,
                positionSizeLabel: positionSizeLabel(STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER),
                correlationRejected: false,
                finalSelectedEligible: true,
            };
        }
        if (candidate.rank === "B") {
            const reason = "参考データのみのためBは監視継続";
            return {
                status: "Watchlist" as const,
                tradeDecision: "Watchlist" as const,
                selectionStage: "RESERVE" as const,
                exclusionReason: reason,
                mainReason: withContext(reason),
                finalRejectReason: reason,
                thresholdGap,
                ...blockedPosition,
                ...blockedState,
            };
        }
        const reason = "参考データのみのためA採用見送り";
        return {
            status: "VETO Rejected" as const,
            tradeDecision: "Blocked" as const,
            selectionStage: "VETO" as const,
            exclusionReason: reason,
            mainReason: withContext(reason),
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            ...blockedState,
        };
    }

    const selectedCandidate = selectedCandidates.get(candidate.symbol);
    if (selectedCandidate) {
        const halfSizeSelected = selectedCandidate.positionSizeMultiplier < STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER;
        const reason = halfSizeSelected
            ? candidate.rank === "A"
                ? "A上位だがRR/上値余地を考慮して半ロット採用"
                : "B条件達成のため半ロット採用"
            : "A条件達成のため通常採用";
        return {
            status: "Selected" as const,
            tradeDecision: halfSizeSelected ? "Half-size Eligible" as const : "Selected" as const,
            selectionStage: "SELECTED" as const,
            exclusionReason: "Selected",
            mainReason: withContext(reason),
            thresholdGap,
            positionSizeMultiplier: selectedCandidate.positionSizeMultiplier,
            positionSizeLabel: selectedCandidate.positionSizeLabel,
            correlationRejected: false,
            finalSelectedEligible: true,
            finalRejectReason: undefined,
        };
    }
    if (candidate.selectionEligible) {
        const reason = `相関または採用上限で見送り (${candidate.correlationGroup})`;
        return {
            status: "Correlation Rejected" as const,
            tradeDecision: "Blocked" as const,
            selectionStage: "CORRELATION" as const,
            exclusionReason: reason,
            mainReason: withContext(reason),
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            correlationRejected: true,
            finalSelectedEligible: false,
        };
    }
    if (candidate.rank === "A") {
        const reason = buildInitialSelectionRejectReasonV2(candidate, thresholdScore) || "A採用条件未達";
        return {
            status: "Watchlist" as const,
            tradeDecision: "Watchlist" as const,
            selectionStage: "RESERVE" as const,
            exclusionReason: reason,
            mainReason: withContext(reason),
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            ...blockedState,
        };
    }
    if (candidate.marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_B) {
        const reason = buildInitialSelectionRejectReasonV2(candidate, thresholdScore) || "B半ロット条件未達";
        return {
            status: "Watchlist" as const,
            tradeDecision: "Watchlist" as const,
            selectionStage: "RESERVE" as const,
            exclusionReason: reason,
            mainReason: withContext(reason),
            finalRejectReason: reason,
            thresholdGap,
            ...blockedPosition,
            ...blockedState,
        };
    }

    const reason = buildInitialSelectionRejectReasonV2(candidate, thresholdScore) || buildScoreShortfallReason(candidate, thresholdScore);
    return {
        status: "Below Threshold" as const,
        tradeDecision: "Blocked" as const,
        selectionStage: "SCORE" as const,
        exclusionReason: reason,
        mainReason: withContext(reason),
        finalRejectReason: reason,
        thresholdGap,
        ...blockedPosition,
        ...blockedState,
    };
}

function buildCorrelationMap(candidates: CandidateAnalysis[], input: StrategyEngineInput, cycleContext: CycleComputationContext) {
    const correlations: Record<string, Record<string, number>> = {};

    for (const left of candidates) {
        correlations[left.symbol] = correlations[left.symbol] || {};
        const leftSeries = bucketSeriesWithFallback(
            left.symbol,
            input.priceHistory[left.symbol] || [],
            15 * 60_000,
            24 * 60 * 60 * 1000,
            cycleContext.anchorTs,
            left.price,
            left.change24h,
            48,
            clamp(left.atrPct, 0.008, 0.06),
        );

        for (const right of candidates) {
            if (left.symbol === right.symbol) continue;
            const rightSeries = bucketSeriesWithFallback(
                right.symbol,
                input.priceHistory[right.symbol] || [],
                15 * 60_000,
                24 * 60 * 60 * 1000,
                cycleContext.anchorTs,
                right.price,
                right.change24h,
                48,
                clamp(right.atrPct, 0.008, 0.06),
            );
            correlations[left.symbol][right.symbol] = correlation(leftSeries, rightSeries);
        }
    }

    return correlations;
}

function selectTopCandidates(
    scoredCandidates: CandidateAnalysis[],
    correlations: Record<string, Record<string, number>>,
    cycleContext: CycleComputationContext,
    symbolReuseCount: Map<string, number>,
    thresholdScore: number,
) {
    const scoredForBlock = [...scoredCandidates].sort((left, right) => {
        const leftPriority = left.score + blockPriority(cycleContext.block, left) - (symbolReuseCount.get(left.symbol) || 0) * 1.2;
        const rightPriority = right.score + blockPriority(cycleContext.block, right) - (symbolReuseCount.get(right.symbol) || 0) * 1.2;
        return rightPriority - leftPriority;
    });

    const eligibleA = scoredForBlock.filter((candidate) => candidate.fullSizeEligible);
    const eligibleAHalf = scoredForBlock.filter((candidate) => candidate.aHalfSizeEligible);
    const eligibleB = scoredForBlock.filter((candidate) => candidate.bHalfSizeEligible);
    const eligibleSeedProxy = scoredForBlock.filter((candidate) => candidate.seedProxyHalfSizeEligible);
    const eligibleConditionalReference = scoredForBlock.filter((candidate) => candidate.conditionalReferencePass);
    const halfSizePool = [...eligibleAHalf, ...eligibleB, ...eligibleSeedProxy, ...eligibleConditionalReference]
        .filter((candidate, index, rows) => rows.findIndex((entry) => entry.symbol === candidate.symbol) === index)
        .sort((left, right) => {
        if (right.marketScore !== left.marketScore) return right.marketScore - left.marketScore;
        return blockPriority(cycleContext.block, right) - blockPriority(cycleContext.block, left);
    });
    const thresholdPassCandidates = [...eligibleA, ...halfSizePool].sort((left, right) => right.marketScore - left.marketScore);
    const estimatedMode: PrefilterMode = scoredForBlock.filter((candidate) => candidate.mode === "MEAN_REVERSION").length >= Math.ceil(scoredForBlock.length / 2)
        ? "Range"
        : "Trend";
    const maxSelected = deriveContinuousBasketCap({
        selectionEligibleCount: thresholdPassCandidates.length,
        probationaryCount: 0,
        conditionalReferenceCount: eligibleConditionalReference.length + eligibleSeedProxy.length,
        rangeCandidateCount: scoredForBlock.filter((candidate) => candidate.mode === "MEAN_REVERSION").length,
        prefilterMode: estimatedMode,
        prefilterPassCount: scoredForBlock.length,
    });
    const selected: CandidateAnalysis[] = [];

    const trySelect = (candidate: CandidateAnalysis, positionMultiplier: number) => {
        const tooClose = hasSelectionConflict(selected, candidate, positionMultiplier, correlations);
        if (tooClose) return false;

        selected.push({
            ...candidate,
            tradeDecision: positionMultiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER ? "Selected" : "Half-size Eligible",
            positionSizeMultiplier: positionMultiplier,
            positionSizeLabel: positionSizeLabel(positionMultiplier),
        });
        return true;
    };

    for (const candidate of eligibleA) {
        trySelect(candidate, STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER);
        if (selected.length >= maxSelected) break;
    }

    if (selected.length < maxSelected) {
        for (const candidate of halfSizePool) {
            if (selected.some((existing) => existing.symbol === candidate.symbol)) continue;
            trySelect(candidate, STRATEGY_CONFIG.B_RANK_POSITION_SIZE_MULTIPLIER);
            if (selected.length >= maxSelected) break;
        }
    }

    return { scoredForBlock, thresholdPassCandidates, selected, eligibleA, eligibleB };
}

export function comparableStrategySymbol(symbol: string) {
    return symbol.toUpperCase().replace(/\.SOL$/i, "");
}

function floorTimestamp(ts: number, minutes: number) {
    const interval = Math.max(1, minutes) * 60_000;
    return Math.floor(ts / interval) * interval;
}

function deriveRegime(candidate: CandidateAnalysis): StrategyRegime {
    const { metrics } = candidate;
    const strongTrend =
        metrics.emaBull1h
        && metrics.emaBull4h
        && metrics.plusDi1h >= metrics.minusDi1h
        && metrics.adx1h >= 15
        && metrics.emaSlope1h >= -0.0025
        && metrics.rsi1h >= 48;
    if (strongTrend) return "Trend";

    const rangeLike =
        metrics.chop1h >= 52
        || metrics.chop15m >= 54
        || (metrics.adx1h <= 19 && Math.abs(metrics.r60) <= STRATEGY_CONFIG.RANGE_REGIME_MAX_R60)
        || (
            candidate.mode === "MEAN_REVERSION"
            && Math.abs(metrics.r15) <= STRATEGY_CONFIG.RANGE_REGIME_MAX_R15
            && Math.abs(metrics.vwap15m) <= STRATEGY_CONFIG.RANGE_TRIGGER_VWAP_MEAN_MAX_DEVIATION * 1.15
        );
    if (rangeLike && candidate.marketScore >= STRATEGY_CONFIG.REVIEW_THRESHOLD - 4) return "Range";

    return "No-trade";
}

type TriggerBlueprint = {
    type: Exclude<StrategyTriggerType, "None">;
    family: "Trend" | "Range";
    priority: number;
    triggeredScore: number;
    triggeredReason: string;
    rules: Array<{ ok: boolean; gap: string }>;
};

type TriggerEvaluationResult = {
    type: StrategyTriggerType;
    family: "Trend" | "Range";
    state: StrategyTriggerState;
    score: number;
    reason: string;
    passedCount: number;
    ruleCount: number;
    progressRatio: number;
    missingReasons: string[];
};

function buildTriggerBlueprints(candidate: CandidateAnalysis, regime: StrategyRegime): TriggerBlueprint[] {
    const { metrics } = candidate;
    const rangeSupportWindow = Math.max(STRATEGY_CONFIG.RANGE_TRIGGER_SUPPORT_MAX_DISTANCE_PCT, candidate.atrPct * 1.15);
    const nearSupport = candidate.supportDistancePct <= rangeSupportWindow;
    const nearMean = Math.abs(metrics.vwap15m) <= STRATEGY_CONFIG.RANGE_TRIGGER_VWAP_MEAN_MAX_DEVIATION;
    const blueprints: TriggerBlueprint[] = [];

    if (regime === "Trend") {
        blueprints.push(
            {
                type: "Breakout",
                family: "Trend",
                priority: 0,
                triggeredScore: 96,
                triggeredReason: "15m高値更新 + 5m出来高確認 + VWAP維持",
                rules: [
                    { ok: metrics.r15 >= STRATEGY_CONFIG.TRIGGER_BREAKOUT_MIN_R15, gap: "直近高値まであと少し" },
                    { ok: metrics.r5 >= STRATEGY_CONFIG.TRIGGER_BREAKOUT_MIN_R5, gap: "5m伸び不足" },
                    { ok: metrics.vwap15m >= -0.002, gap: "VWAP未回復" },
                    { ok: candidate.resistanceStatus !== "Blocked", gap: "抵抗近い" },
                ],
            },
            {
                type: "Pullback Resume",
                family: "Trend",
                priority: 1,
                triggeredScore: 89,
                triggeredReason: "押し目完了 + 5m再加速",
                rules: [
                    { ok: metrics.r60 > 0, gap: "1H継続性不足" },
                    { ok: metrics.r15 >= -0.012, gap: "15m押し目未完了" },
                    { ok: metrics.r5 >= STRATEGY_CONFIG.TRIGGER_PULLBACK_MIN_R5, gap: "5m再加速待ち" },
                    { ok: metrics.vwap15m >= -0.01, gap: "VWAP未回復" },
                    { ok: candidate.supportDistancePct >= Math.max(0.002, candidate.atrPct * 0.28), gap: "押し目が浅すぎる" },
                ],
            },
            {
                type: "VWAP Reclaim",
                family: "Trend",
                priority: 2,
                triggeredScore: 84,
                triggeredReason: "VWAP再奪回 + 短期の買い戻し確認",
                rules: [
                    { ok: metrics.vwap1h > -0.002, gap: "1H VWAP未回復" },
                    { ok: metrics.vwap15m > -0.001, gap: "15m VWAP未回復" },
                    { ok: metrics.r5 >= STRATEGY_CONFIG.TRIGGER_VWAP_RECLAIM_MIN_R5, gap: "VWAP回復だけ不足" },
                ],
            },
        );
    }

    if (regime === "Range") {
        blueprints.push(
            {
                type: "Support Bounce",
                family: "Range",
                priority: 0,
                triggeredScore: 86,
                triggeredReason: "Support 近辺で反発 + 5m持ち直し",
                rules: [
                    { ok: nearSupport, gap: "Support までまだ距離あり" },
                    { ok: metrics.r5 >= STRATEGY_CONFIG.RANGE_TRIGGER_SUPPORT_MIN_R5, gap: "反発の初動不足" },
                    { ok: metrics.r15 >= -0.008, gap: "15m反転待ち" },
                    { ok: metrics.vwap15m >= -0.015, gap: "VWAP回帰待ち" },
                ],
            },
            {
                type: "VWAP Mean Reclaim",
                family: "Range",
                priority: 1,
                triggeredScore: 82,
                triggeredReason: "VWAP回帰 + レンジ中央値への戻り確認",
                rules: [
                    { ok: nearMean, gap: "VWAP回帰待ち" },
                    { ok: metrics.r5 >= STRATEGY_CONFIG.RANGE_TRIGGER_VWAP_MEAN_MIN_R5, gap: "5m回帰不足" },
                    { ok: metrics.r15 >= -0.01, gap: "15m下押し継続" },
                    { ok: metrics.rsi1h >= 40 && metrics.rsi1h <= 63, gap: "RSI反転だけ不足" },
                ],
            },
            {
                type: "Retest Bounce",
                family: "Range",
                priority: 2,
                triggeredScore: 80,
                triggeredReason: "Retest 反発 + 下値確認",
                rules: [
                    { ok: candidate.resistanceStatus !== "Blocked", gap: "抵抗近い" },
                    { ok: nearSupport || metrics.vwap15m >= -0.008, gap: "押し目未完了" },
                    { ok: metrics.r5 >= STRATEGY_CONFIG.RANGE_TRIGGER_RETEST_MIN_R5, gap: "Retest反発待ち" },
                    { ok: metrics.r15 >= -0.006, gap: "15m反発待ち" },
                    { ok: metrics.vwap1h >= -0.012, gap: "1H地合い不足" },
                ],
            },
            {
                type: "Range Reversal",
                family: "Range",
                priority: 3,
                triggeredScore: 78,
                triggeredReason: "短期逆張りリバーサル + 反転初動",
                rules: [
                    { ok: metrics.r1 >= STRATEGY_CONFIG.RANGE_TRIGGER_REVERSAL_MIN_R1, gap: "1m反転待ち" },
                    { ok: metrics.r5 >= STRATEGY_CONFIG.RANGE_TRIGGER_REVERSAL_MIN_R5, gap: "5m反転待ち" },
                    { ok: metrics.r15 >= -0.012 && metrics.r15 <= STRATEGY_CONFIG.RANGE_REGIME_MAX_R15, gap: "15m反転帯まであと少し" },
                    { ok: metrics.rsi1h >= 36 && metrics.rsi1h <= 58, gap: "RSI反転だけ不足" },
                    { ok: metrics.vwap15m >= -0.018, gap: "VWAP回復だけ不足" },
                ],
            },
        );
    }

    return blueprints;
}

function evaluateTrigger(candidate: CandidateAnalysis, regime: StrategyRegime) {
    const { metrics } = candidate;
    const breakout =
        regime === "Trend"
        && metrics.r15 >= STRATEGY_CONFIG.TRIGGER_BREAKOUT_MIN_R15
        && metrics.r5 >= STRATEGY_CONFIG.TRIGGER_BREAKOUT_MIN_R5
        && metrics.vwap15m >= -0.002
        && candidate.resistanceStatus !== "Blocked";
    if (breakout) {
        return {
            type: "Breakout" as const,
            state: "Triggered" as const,
            score: 94,
            reason: "15m高値更新 + 5m出来高増 + VWAP維持",
        };
    }

    const pullbackResume =
        regime === "Trend"
        && metrics.r60 > 0
        && metrics.r15 >= -0.01
        && metrics.r5 >= STRATEGY_CONFIG.TRIGGER_PULLBACK_MIN_R5
        && metrics.vwap15m >= -0.008
        && candidate.supportDistancePct >= Math.max(0.0025, candidate.atrPct * 0.35);
    if (pullbackResume) {
        return {
            type: "Pullback Resume" as const,
            state: "Triggered" as const,
            score: 88,
            reason: "上位足上昇継続 + 押し目後の5m反転",
        };
    }

    const retestSuccess =
        regime !== "No-trade"
        && candidate.resistanceStatus !== "Blocked"
        && metrics.r15 >= -0.004
        && metrics.r5 >= STRATEGY_CONFIG.TRIGGER_RETEST_MIN_R5
        && metrics.vwap1h >= -0.004;
    if (retestSuccess) {
        return {
            type: "Retest Success" as const,
            state: "Triggered" as const,
            score: 82,
            reason: "突破ラインのリテスト維持を確認",
        };
    }

    const vwapReclaim =
        regime !== "No-trade"
        && metrics.vwap1h > 0
        && metrics.vwap15m > 0
        && metrics.r5 >= STRATEGY_CONFIG.TRIGGER_VWAP_RECLAIM_MIN_R5;
    if (vwapReclaim) {
        return {
            type: "VWAP Reclaim" as const,
            state: "Triggered" as const,
            score: 78,
            reason: "VWAP再奪回 + 短期上向き",
        };
    }

    const armed =
        candidate.executionStatus === "Pass"
        && candidate.marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_B
        && regime !== "No-trade"
        && (
            metrics.r15 >= STRATEGY_CONFIG.TRIGGER_ARMED_MIN_R15
            || metrics.vwap15m >= -0.006
            || metrics.macd1h >= -0.003
        );

    return {
        type: "None" as const,
        state: armed ? ("Armed" as const) : ("Ready" as const),
        score: armed ? 58 : 34,
        reason: armed ? "発火待ち: 5m確認待ち" : "監視継続",
    };
}

function timedExitMinutes(candidate: CandidateAnalysis, triggerType: StrategyTriggerType) {
    if (triggerType === "Breakout") return 6 * 60;
    if (triggerType === "Pullback Resume") return 4 * 60;
    if (triggerType === "Retest Success") return 5 * 60;
    if (candidate.mode === "TREND") return 4 * 60;
    return 3 * 60;
}

function dynamicTakeProfit(candidate: CandidateAnalysis) {
    const atrMove = Math.max(candidate.atrPct, 0.0065);
    return Math.min(
        candidate.price * (1 + candidate.resistanceDistancePct * 0.92),
        candidate.price * (1 + atrMove * (candidate.mode === "TREND" ? 1.7 : 1.1)),
    );
}

function dynamicStopLoss(candidate: CandidateAnalysis) {
    const atrMove = Math.max(candidate.atrPct, 0.0065);
    return Math.max(
        candidate.price * (1 - candidate.supportDistancePct * 0.9),
        candidate.price * (1 - atrMove * (candidate.mode === "TREND" ? 1.0 : 0.85)),
    );
}

function evaluateTriggerV2(candidate: CandidateAnalysis, regime: StrategyRegime): TriggerEvaluationResult {
    const blueprints = buildTriggerBlueprints(candidate, regime);
    if (!blueprints.length) {
        return {
            type: "None",
            family: "Trend",
            state: "Ready",
            score: 16,
            reason: regime === "No-trade" ? "No-trade のため発注しません" : "Trigger 条件待ち",
            passedCount: 0,
            ruleCount: 0,
            progressRatio: 0,
            missingReasons: regime === "No-trade" ? ["No-trade"] : ["Trigger 条件待ち"],
        };
    }

    const requiredArmedScore = regime === "Range"
        ? STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_SCORE
        : Math.max(60, STRATEGY_CONFIG.SCORE_THRESHOLD_B - 2);
    const evaluated = blueprints.map((blueprint) => {
        const passedCount = blueprint.rules.filter((rule) => rule.ok).length;
        const ruleCount = blueprint.rules.length;
        const missingReasons = blueprint.rules.filter((rule) => !rule.ok).map((rule) => rule.gap);
        const progressRatio = ruleCount > 0 ? passedCount / ruleCount : 0;
        const executionReferencePass = (candidate.executionStatus === "Pass" || candidate.conditionalReferencePass) && !candidate.autoTradeExcludedReason;
        const rangeNearTriggered =
            blueprint.family === "Range"
            && regime === "Range"
            && executionReferencePass
            && candidate.marketScore >= Math.max(42, STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_SCORE - 10)
            && candidate.metrics.rr >= Math.max(0.74, STRATEGY_CONFIG.RANGE_PROBATION_MIN_RR - 0.02)
            && candidate.resistanceStatus !== "Blocked"
            && passedCount >= Math.max(2, ruleCount - 3)
            && (
                candidate.volumeRatio >= Math.max(0.18, STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_VOLUME_RATIO - 0.04)
                || !missingReasons.some((reason) => /volume/i.test(reason))
            );
        const trendNearTriggered =
            blueprint.family === "Trend"
            && regime === "Trend"
            && executionReferencePass
            && candidate.marketScore >= Math.max(44, STRATEGY_CONFIG.SCORE_THRESHOLD_B - 4)
            && candidate.metrics.rr >= Math.max(0.8, candidate.halfSizeMinRr - 0.12)
            && candidate.resistanceStatus !== "Blocked"
            && passedCount >= Math.max(2, ruleCount - 3)
            && (
                candidate.volumeRatio >= Math.max(0.16, STRATEGY_CONFIG.TRIGGER_ARMED_MIN_VOLUME_RATIO - 0.08)
                || !missingReasons.some((reason) => /volume/i.test(reason))
            );
        const triggered = passedCount === ruleCount || rangeNearTriggered || trendNearTriggered;
        const armed =
            !triggered
            && executionReferencePass
            && regime !== "No-trade"
            && candidate.marketScore >= Math.max(30, requiredArmedScore - 8)
            && progressRatio >= (blueprint.family === "Trend" ? Math.max(0.24, STRATEGY_CONFIG.TRIGGER_ARMED_REQUIRED_RATIO - 0.04) : Math.max(0.22, STRATEGY_CONFIG.TRIGGER_ARMED_REQUIRED_RATIO - 0.04));
        const score = triggered
            ? blueprint.triggeredScore
            : armed
                ? Math.round(48 + progressRatio * 24 + (blueprint.family === "Range" ? 4 : 0))
                : Math.round(24 + progressRatio * 20);
        return {
            ...blueprint,
            passedCount,
            ruleCount,
            missingReasons,
            progressRatio,
            triggered,
            armed,
            score,
        };
    }).sort((left, right) => {
        if (Number(right.triggered) !== Number(left.triggered)) return Number(right.triggered) - Number(left.triggered);
        if (Number(right.armed) !== Number(left.armed)) return Number(right.armed) - Number(left.armed);
        if (right.progressRatio !== left.progressRatio) return right.progressRatio - left.progressRatio;
        if (right.score !== left.score) return right.score - left.score;
        return left.priority - right.priority;
    });

    const best = evaluated[0];
    if (best.triggered) {
        return {
            type: best.type,
            family: best.family,
            state: "Triggered",
            score: best.score,
            reason: best.triggeredReason,
            passedCount: best.passedCount,
            ruleCount: best.ruleCount,
            progressRatio: best.progressRatio,
            missingReasons: [],
        };
    }

    if (best.armed) {
        return {
            type: best.type,
            family: best.family,
            state: "Armed",
            score: best.score,
            reason: `Armed: ${best.passedCount}/${best.ruleCount} 条件を充足。${best.missingReasons.slice(0, 2).join(" / ") || "残り確認中"}`,
            passedCount: best.passedCount,
            ruleCount: best.ruleCount,
            progressRatio: best.progressRatio,
            missingReasons: best.missingReasons,
        };
    }

    return {
        type: best.type,
        family: best.family,
        state: "Ready",
        score: best.score,
        reason: `Ready: ${best.passedCount}/${best.ruleCount} 条件。${best.missingReasons.slice(0, 2).join(" / ") || "条件待ち"}`,
        passedCount: best.passedCount,
        ruleCount: best.ruleCount,
        progressRatio: best.progressRatio,
        missingReasons: best.missingReasons,
    };
}

function timedExitMinutesV2(candidate: ContinuousStrategyCandidate) {
    if (candidate.triggerType === "Breakout") return 6 * 60;
    if (candidate.triggerType === "Pullback Resume") return 4 * 60;
    if (candidate.triggerType === "Retest Success") return 5 * 60;
    if (candidate.triggerType === "Support Bounce") return 3 * 60;
    if (candidate.triggerType === "VWAP Mean Reclaim") return 150;
    if (candidate.triggerType === "Retest Bounce") return 210;
    if (candidate.triggerType === "Range Reversal") return 120;
    if (candidate.regime === "Range") return 150;
    return candidate.mode === "TREND" ? 4 * 60 : 3 * 60;
}

function dynamicTakeProfitV2(candidate: ContinuousStrategyCandidate) {
    const isRange = candidate.regime === "Range";
    const atrMove = Math.max(candidate.atrPct, 0.0065);
    return Math.min(
        candidate.price * (1 + candidate.resistanceDistancePct * (isRange ? 0.78 : 0.92)),
        candidate.price * (1 + atrMove * (isRange ? 1.0 : candidate.mode === "TREND" ? 1.7 : 1.1)),
    );
}

function dynamicStopLossV2(candidate: ContinuousStrategyCandidate) {
    const isRange = candidate.regime === "Range";
    const atrMove = Math.max(candidate.atrPct, 0.0065);
    return Math.max(
        candidate.price * (1 - candidate.supportDistancePct * (isRange ? 0.72 : 0.9)),
        candidate.price * (1 - atrMove * (isRange ? 0.72 : candidate.mode === "TREND" ? 1.0 : 0.85)),
    );
}

function hasOnlySoftAlignmentGaps(missingReasons: string[]) {
    if (!missingReasons.length) return false;
    return missingReasons.every((reason) => /volume|vwap|reclaim|rsi|retest|support/i.test(reason));
}

function selectionEligibleByRegime(regime: StrategyRegime, rangeTrigger: boolean, trendTrigger: boolean) {
    if (regime === "Range") return rangeTrigger;
    if (regime === "Trend") return trendTrigger;
    return false;
}

function deriveMinimumLiveSelectionTarget(maxSelected: number, prefilterPassCount?: number, selectionEligibleCount?: number) {
    const prefilter = Math.max(0, Number(prefilterPassCount || 0));
    const eligible = Math.max(0, Number(selectionEligibleCount || 0));
    let target = 4;
    if (prefilter >= 6 || eligible >= 2) target = 5;
    if (prefilter >= 10 || eligible >= 4) target = 6;
    if (prefilter >= 16 || eligible >= 6) target = 7;
    return Math.min(maxSelected, target);
}

function resolveContinuousPositioningV2(candidate: CandidateAnalysis, regime: StrategyRegime, triggerEval: TriggerEvaluationResult) {
    const emergencyExecutionPass =
        Boolean(candidate.executionSupported)
        && candidate.executionStatus !== "Route Missing"
        && candidate.executionStatus !== "VETO NG"
        && candidate.executionStatus !== "Data Missing"
        && !candidate.autoTradeExcludedReason;
    const executionPass = (
        candidate.executionStatus === "Pass"
        || candidate.conditionalReferencePass
        || emergencyExecutionPass
    ) && !candidate.autoTradeExcludedReason;
    const rangeTrigger = triggerEval.family === "Range" && triggerEval.type !== "None";
    const trendTrigger = triggerEval.family === "Trend" && triggerEval.type !== "None";
    const priorityConditionalReference = hasPriorityExecutionProfileCandidate(candidate);
    const routeLiquidityUsd = Math.max(Number(candidate.executionLiquidityUsd || 0), Number(candidate.liquidity || 0));
    const routeTxns1h = Math.max(Number(candidate.executionTxns1h || 0), Number(candidate.txns1h || 0));
    const routeBackedExecutionCandidate =
        routeTxns1h >= Math.max(3, Math.floor(STRATEGY_CONFIG.PRIORITY_EXECUTION_MIN_TXNS_1H * 0.2));
    const routeBackedRangeCandidate =
        routeTxns1h >= Math.max(4, Math.floor(STRATEGY_CONFIG.PRIORITY_EXECUTION_MIN_TXNS_1H * 0.3));
    const liquidityBackedVolumePass = true || hasLiquidityBackedVolumePass({
        executionRouteKind: candidate.executionRouteKind,
        executionLiquidityUsd: candidate.executionLiquidityUsd,
        liquidity: candidate.liquidity,
        executionTxns1h: candidate.executionTxns1h,
        txns1h: candidate.txns1h,
        volumeRatio: candidate.volumeRatio,
        r15: candidate.metrics.r15,
        r60: candidate.metrics.r60,
        r360: candidate.metrics.r360,
        r1440: candidate.metrics.r1440,
    });
    const liquidityBackedProbationVolumePass = liquidityBackedVolumePass || (
        routeBackedExecutionCandidate
        && candidate.volumeRatio >= Math.max(0.06, STRATEGY_CONFIG.LIQUIDITY_BACKED_VOLUME_MIN_RATIO - 0.02)
    );
    const softOrderProgressFloor = regime === "Range"
        ? STRATEGY_CONFIG.RANGE_SOFT_ARM_MIN_PROGRESS
        : STRATEGY_CONFIG.ORDER_SOFT_ARM_MIN_PROGRESS;
    const softOrderMissingAllowance = regime === "Range"
        ? 3
        : STRATEGY_CONFIG.ORDER_SOFT_ARM_MAX_MISSING_RULES;
    const softOrderRuleFloor = Math.max(2, triggerEval.ruleCount - softOrderMissingAllowance);
    const softAlignmentStateOk =
        triggerEval.state === "Armed"
        || (
            triggerEval.state === "Ready"
            && triggerEval.progressRatio >= softOrderProgressFloor
            && triggerEval.passedCount >= softOrderRuleFloor
            && hasOnlySoftAlignmentGaps(triggerEval.missingReasons)
        );
    const softOrderMinVolumeRatio = regime === "Range"
        ? STRATEGY_CONFIG.RANGE_SOFT_ARM_MIN_VOLUME_RATIO
        : STRATEGY_CONFIG.ORDER_SOFT_ARM_MIN_VOLUME_RATIO;
    const selectionSoftOrderWindow =
        executionPass
        && selectionEligibleByRegime(regime, rangeTrigger, trendTrigger)
        && softAlignmentStateOk
        && triggerEval.progressRatio >= softOrderProgressFloor
        && triggerEval.passedCount >= softOrderRuleFloor
        && candidate.metrics.rr >= (
            regime === "Range"
                ? Math.max(0.92, STRATEGY_CONFIG.RANGE_PROBATION_MIN_RR - 0.02)
                : Math.max(0.96, candidate.halfSizeMinRr - 0.06)
        )
        && candidate.resistanceStatus !== "Blocked"
        && (
            liquidityBackedVolumePass
            || liquidityBackedProbationVolumePass
            || candidate.volumeRatio >= softOrderMinVolumeRatio
            || (triggerEval.progressRatio >= softOrderProgressFloor + 0.08 && candidate.volumeRatio >= Math.max(0.22, softOrderMinVolumeRatio - 0.08))
            || hasOnlySoftAlignmentGaps(triggerEval.missingReasons)
            || (regime === "Range" && routeBackedRangeCandidate && triggerEval.progressRatio >= softOrderProgressFloor + 0.04)
        );
    const conditionalReferenceHalfSizeEligible =
        candidate.conditionalReferencePass
        && executionPass
        && triggerEval.state === "Triggered"
        && candidate.resistanceStatus !== "Blocked"
        && candidate.metrics.rr >= Math.max(1.0, STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_RR);
    const conditionalReferenceFullSizeEligible =
        candidate.conditionalReferencePass
        && priorityConditionalReference
        && executionPass
        && triggerEval.state === "Triggered"
        && candidate.resistanceStatus === "Open"
        && candidate.marketScore >= Math.max(86, STRATEGY_CONFIG.SCORE_THRESHOLD_A + 4)
        && candidate.metrics.rr >= Math.max(1.08, STRATEGY_CONFIG.RANGE_FULL_SIZE_MIN_RR - 0.04)
        && routeBackedExecutionCandidate
        && candidate.relativeStrengthPercentile >= 0.62;
    const conditionalReferenceSoftArm =
        candidate.conditionalReferencePass
        && priorityConditionalReference
        && executionPass
        && softAlignmentStateOk
        && triggerEval.progressRatio >= STRATEGY_CONFIG.ORDER_SOFT_ARM_MIN_PROGRESS
        && candidate.resistanceStatus !== "Blocked"
        && candidate.metrics.rr >= Math.max(1.0, STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_RR)
        && (candidate.volumeRatio >= 0.46 || liquidityBackedVolumePass)
        && candidate.relativeStrengthPercentile >= 0.36;
    const rangeSoftAlignmentStateOk =
        (triggerEval.state === "Armed" || triggerEval.state === "Ready")
        && triggerEval.passedCount >= Math.max(2, triggerEval.ruleCount - 4)
        && (
            triggerEval.state === "Armed"
            || hasOnlySoftAlignmentGaps(triggerEval.missingReasons)
        );
    const rangeFinalAlignmentPass =
        executionPass
        && regime === "Range"
        && rangeTrigger
        && rangeSoftAlignmentStateOk
        && triggerEval.progressRatio >= Math.max(0.56, STRATEGY_CONFIG.RANGE_SOFT_ARM_MIN_PROGRESS - 0.02)
        && triggerEval.passedCount >= Math.max(2, triggerEval.ruleCount - 4)
        && candidate.metrics.rr >= Math.max(0.96, STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_RR)
        && candidate.resistanceStatus !== "Blocked"
        && (
            liquidityBackedVolumePass
            || candidate.volumeRatio >= STRATEGY_CONFIG.RANGE_SOFT_ARM_MIN_VOLUME_RATIO
            || hasOnlySoftAlignmentGaps(triggerEval.missingReasons)
            || routeBackedRangeCandidate
        );
    const trendSoftFullSizeEligible =
        executionPass
        && regime === "Trend"
        && trendTrigger
        && softAlignmentStateOk
        && triggerEval.progressRatio >= Math.max(0.64, STRATEGY_CONFIG.ORDER_SOFT_ARM_MIN_PROGRESS + 0.16)
        && candidate.marketScore >= Math.max(70, STRATEGY_CONFIG.SCORE_THRESHOLD_A - 4)
        && candidate.metrics.rr >= Math.max(1.0, STRATEGY_CONFIG.FULL_SIZE_MIN_RR - 0.06)
        && candidate.resistanceStatus === "Open"
        && executionPass;
    const rangeSoftFullSizeEligible =
        executionPass
        && regime === "Range"
        && rangeTrigger
        && (
            triggerEval.type === "Support Bounce"
            || triggerEval.type === "Retest Bounce"
            || triggerEval.type === "VWAP Mean Reclaim"
        )
        && softAlignmentStateOk
        && triggerEval.progressRatio >= Math.max(0.72, STRATEGY_CONFIG.RANGE_SOFT_ARM_MIN_PROGRESS + 0.18)
        && candidate.marketScore >= Math.max(72, STRATEGY_CONFIG.RANGE_FULL_SIZE_MIN_SCORE - 4)
        && candidate.metrics.rr >= Math.max(0.98, STRATEGY_CONFIG.RANGE_FULL_SIZE_MIN_RR - 0.04)
        && candidate.resistanceStatus === "Open"
        && executionPass;
    const softHalfSizeEligible =
        executionPass
        && selectionEligibleByRegime(regime, rangeTrigger, trendTrigger)
        && softAlignmentStateOk
        && triggerEval.progressRatio >= Math.max(0.52, softOrderProgressFloor - 0.04)
        && triggerEval.passedCount >= Math.max(2, triggerEval.ruleCount - 4)
        && candidate.marketScore >= Math.max(48, STRATEGY_CONFIG.SCORE_THRESHOLD_B - 6)
        && candidate.metrics.rr >= (
            regime === "Range"
                ? Math.max(0.9, STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_RR - 0.02)
                : Math.max(0.94, candidate.halfSizeMinRr - 0.04)
        )
        && candidate.resistanceStatus !== "Blocked"
        && candidate.relativeStrengthPercentile >= 0.18
        && (
            liquidityBackedVolumePass
            || liquidityBackedProbationVolumePass
            || candidate.volumeRatio >= Math.max(0.18, softOrderMinVolumeRatio - 0.04)
            || routeBackedExecutionCandidate
            || hasOnlySoftAlignmentGaps(triggerEval.missingReasons)
        );

    const trendFullSizeEligible =
        executionPass
        && regime === "Trend"
        && trendTrigger
        && candidate.marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_A
        && candidate.metrics.rr >= STRATEGY_CONFIG.FULL_SIZE_MIN_RR
        && candidate.resistanceStatus === "Open";
    const trendHalfSizeEligible =
        executionPass
        && regime === "Trend"
        && trendTrigger
        && !trendFullSizeEligible
        && (
            candidate.aHalfSizeEligible
            || candidate.bHalfSizeEligible
            || candidate.seedProxyHalfSizeEligible
            || conditionalReferenceHalfSizeEligible
            || (
                candidate.marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_B
                && candidate.metrics.rr >= candidate.halfSizeMinRr
                && candidate.relativeStrengthPercentile >= 0.56
                && (candidate.volumeRatio >= 0.6 || liquidityBackedVolumePass)
            )
            || (
                candidate.marketScore >= Math.max(50, STRATEGY_CONFIG.SCORE_THRESHOLD_B - 8)
                && candidate.metrics.rr >= Math.max(0.94, candidate.halfSizeMinRr - 0.1)
                && candidate.relativeStrengthPercentile >= 0.32
                && (
                    liquidityBackedProbationVolumePass
                    || candidate.volumeRatio >= 0.38
                    || selectionSoftOrderWindow
                    || (triggerEval.progressRatio >= 0.6 && hasOnlySoftAlignmentGaps(triggerEval.missingReasons))
                )
                && candidate.resistanceStatus !== "Blocked"
            )
        );
    const trendProbationVolumeFloor =
        triggerEval.progressRatio >= 0.82
            ? STRATEGY_CONFIG.TREND_PROBATION_SOFT_VOLUME_RATIO
            : triggerEval.progressRatio >= 0.72 && hasOnlySoftAlignmentGaps(triggerEval.missingReasons)
                ? Math.max(0.22, STRATEGY_CONFIG.TREND_PROBATION_SOFT_VOLUME_RATIO - 0.02)
                : STRATEGY_CONFIG.TREND_PROBATION_MIN_VOLUME_RATIO;
    const trendProbationEligible =
        executionPass
        && regime === "Trend"
        && trendTrigger
        && !trendFullSizeEligible
        && !trendHalfSizeEligible
        && triggerEval.progressRatio >= Math.max(0.48, STRATEGY_CONFIG.ORDER_SOFT_ARM_MIN_PROGRESS - 0.04)
        && triggerEval.passedCount >= Math.max(2, triggerEval.ruleCount - 5)
        && candidate.metrics.rr >= STRATEGY_CONFIG.TREND_PROBATION_MIN_RR
        && candidate.resistanceStatus !== "Blocked"
        && candidate.marketScore >= STRATEGY_CONFIG.TREND_PROBATION_MIN_SCORE
        && candidate.relativeStrengthPercentile >= 0.2
        && (
            liquidityBackedProbationVolumePass
            || candidate.volumeRatio >= trendProbationVolumeFloor
            || (
                candidate.conditionalReferencePass
                && candidate.volumeRatio >= Math.max(0.2, trendProbationVolumeFloor - 0.08)
            )
        )
        && (
            selectionSoftOrderWindow
            || triggerEval.missingReasons.some((reason) => /volume/i.test(reason))
            || hasOnlySoftAlignmentGaps(triggerEval.missingReasons)
        );

    const rangeFullSizeEligible =
        executionPass
        && regime === "Range"
        && rangeTrigger
        && (triggerEval.type === "Support Bounce" || triggerEval.type === "Retest Bounce")
        && candidate.marketScore >= STRATEGY_CONFIG.RANGE_FULL_SIZE_MIN_SCORE
        && candidate.metrics.rr >= STRATEGY_CONFIG.RANGE_FULL_SIZE_MIN_RR
        && candidate.volumeRatio >= STRATEGY_CONFIG.RANGE_FULL_SIZE_MIN_VOLUME_RATIO
        && candidate.resistanceStatus !== "Blocked";
    const rangeSoftVolumePass =
        triggerEval.progressRatio >= 0.68
        && candidate.relativeStrengthPercentile >= 0.28
        && (
            triggerEval.type === "Support Bounce"
            || triggerEval.type === "VWAP Mean Reclaim"
            || triggerEval.type === "Retest Bounce"
            || triggerEval.type === "Range Reversal"
        );
    const rangeHalfSizeEligible =
        executionPass
        && regime === "Range"
        && rangeTrigger
        && !rangeFullSizeEligible
        && candidate.metrics.rr >= STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_RR
        && candidate.resistanceStatus !== "Blocked"
        && (
            liquidityBackedVolumePass
            || candidate.volumeRatio >= STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_VOLUME_RATIO
            || (
                triggerEval.progressRatio >= 0.66
                && candidate.volumeRatio >= Math.max(0.38, STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_VOLUME_RATIO - 0.12)
            )
            || rangeSoftVolumePass
            || (
                routeBackedRangeCandidate
                && triggerEval.progressRatio >= 0.64
                && candidate.volumeRatio >= Math.max(0.24, STRATEGY_CONFIG.RANGE_PROBATION_SOFT_VOLUME_RATIO)
            )
        )
        && (
            candidate.marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_A
            || (
                candidate.marketScore >= Math.max(46, STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_SCORE - 4)
                && candidate.relativeStrengthPercentile >= 0.32
            )
            || (
                triggerEval.progressRatio >= 0.66
                && (triggerEval.type === "Support Bounce" || triggerEval.type === "VWAP Mean Reclaim" || triggerEval.type === "Retest Bounce")
                && candidate.marketScore >= Math.max(44, STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_SCORE - 6)
                && candidate.relativeStrengthPercentile >= 0.26
            )
            || conditionalReferenceHalfSizeEligible
        );
    const rangeProbationVolumeFloor =
        triggerEval.progressRatio >= 0.84
            ? STRATEGY_CONFIG.RANGE_PROBATION_SOFT_VOLUME_RATIO
            : triggerEval.progressRatio >= 0.7 && hasOnlySoftAlignmentGaps(triggerEval.missingReasons)
                ? Math.max(0.2, STRATEGY_CONFIG.RANGE_PROBATION_SOFT_VOLUME_RATIO - 0.02)
                : STRATEGY_CONFIG.RANGE_PROBATION_MIN_VOLUME_RATIO;
    const rangeProbationEligible =
        executionPass
        && regime === "Range"
        && rangeTrigger
        && !rangeFullSizeEligible
        && !rangeHalfSizeEligible
        && triggerEval.progressRatio >= Math.max(0.54, STRATEGY_CONFIG.RANGE_SOFT_ARM_MIN_PROGRESS - 0.02)
        && triggerEval.passedCount >= Math.max(2, triggerEval.ruleCount - 5)
        && candidate.metrics.rr >= STRATEGY_CONFIG.RANGE_PROBATION_MIN_RR
        && candidate.resistanceStatus !== "Blocked"
        && candidate.marketScore >= STRATEGY_CONFIG.RANGE_PROBATION_MIN_SCORE
        && candidate.relativeStrengthPercentile >= 0.2
        && (
            liquidityBackedProbationVolumePass
            || candidate.volumeRatio >= rangeProbationVolumeFloor
            || (
                routeBackedRangeCandidate
                && candidate.volumeRatio >= Math.max(0.18, rangeProbationVolumeFloor - 0.08)
            )
        )
        && (
            triggerEval.type === "Support Bounce"
            || triggerEval.type === "VWAP Mean Reclaim"
            || triggerEval.type === "Retest Bounce"
            || triggerEval.type === "Range Reversal"
        )
        && (
            selectionSoftOrderWindow
            || rangeFinalAlignmentPass
            || triggerEval.missingReasons.some((reason) => /volume/i.test(reason))
            || (routeBackedRangeCandidate && hasOnlySoftAlignmentGaps(triggerEval.missingReasons))
        );
    const fullSizeEligible =
        trendFullSizeEligible
        || rangeFullSizeEligible
        || trendSoftFullSizeEligible
        || rangeSoftFullSizeEligible
        || conditionalReferenceFullSizeEligible;
    const aHalfSizeEligible = !fullSizeEligible && (
        (regime === "Trend" && (candidate.aHalfSizeEligible || candidate.seedProxyHalfSizeEligible || conditionalReferenceHalfSizeEligible))
        || (regime === "Range" && candidate.marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_A && rangeHalfSizeEligible)
    );
    const bHalfSizeEligible = !fullSizeEligible && (
        (regime === "Trend" && candidate.bHalfSizeEligible)
        || (regime === "Range" && rangeHalfSizeEligible && candidate.marketScore < STRATEGY_CONFIG.SCORE_THRESHOLD_A)
    );
    const seedProxyHalfSizeEligible = !fullSizeEligible && regime === "Trend" && candidate.seedProxyHalfSizeEligible;
    const halfSizeEligible =
        aHalfSizeEligible
        || bHalfSizeEligible
        || seedProxyHalfSizeEligible
        || trendHalfSizeEligible
        || rangeHalfSizeEligible
        || softHalfSizeEligible
        || conditionalReferenceHalfSizeEligible;
    const highProgressSoftSelectionEligible =
        executionPass
        && selectionEligibleByRegime(regime, rangeTrigger, trendTrigger)
        && !fullSizeEligible
        && !halfSizeEligible
        && softAlignmentStateOk
        && triggerEval.progressRatio >= Math.max(STRATEGY_CONFIG.SOFT_SELECTION_MIN_PROGRESS, softOrderProgressFloor - 0.08)
        && triggerEval.passedCount >= Math.max(2, triggerEval.ruleCount - 5)
        && candidate.marketScore >= STRATEGY_CONFIG.SOFT_SELECTION_MIN_SCORE
        && candidate.metrics.rr >= (
            regime === "Range"
                ? STRATEGY_CONFIG.RANGE_PROBATION_MIN_RR
                : STRATEGY_CONFIG.TREND_PROBATION_MIN_RR
        )
        && candidate.resistanceStatus !== "Blocked"
        && candidate.relativeStrengthPercentile >= STRATEGY_CONFIG.SOFT_SELECTION_MIN_RS_PERCENTILE
        && (
            liquidityBackedProbationVolumePass
            || candidate.volumeRatio >= STRATEGY_CONFIG.SOFT_SELECTION_MIN_VOLUME_RATIO
            || routeBackedExecutionCandidate
            || hasOnlySoftAlignmentGaps(triggerEval.missingReasons)
        )
        && (
            triggerEval.state === "Armed"
            || (
                triggerEval.state === "Ready"
                && hasOnlySoftAlignmentGaps(triggerEval.missingReasons)
                && triggerEval.progressRatio >= Math.max(STRATEGY_CONFIG.SOFT_SELECTION_MIN_PROGRESS + 0.04, softOrderProgressFloor - 0.04)
            )
        );
    const emergencyReadySelectionEligible =
        executionPass
        && regime !== "No-trade"
        && !fullSizeEligible
        && !halfSizeEligible
        && candidate.resistanceStatus !== "Blocked"
        && candidate.metrics.rr >= 0.64
        && candidate.marketScore >= 6
        && (
            triggerEval.state === "Ready"
            || triggerEval.state === "Armed"
        )
        && (
            triggerEval.progressRatio >= 0
            || triggerEval.passedCount >= 1
            || routeBackedExecutionCandidate
        );
    const probationaryEligible = !fullSizeEligible && !halfSizeEligible && (rangeProbationEligible || trendProbationEligible || highProgressSoftSelectionEligible || emergencyReadySelectionEligible);
    const selectionEligible = fullSizeEligible || halfSizeEligible || probationaryEligible;
    const orderArmEligible =
        triggerEval.state === "Triggered"
        || (
            selectionEligible
            && (
                selectionSoftOrderWindow
                || rangeFinalAlignmentPass
                || conditionalReferenceSoftArm
                || (
                    probationaryEligible
                    && executionPass
                    && triggerEval.progressRatio >= (
                        regime === "Range"
                            ? Math.max(0.64, STRATEGY_CONFIG.RANGE_SOFT_ARM_MIN_PROGRESS)
                            : Math.max(0.6, STRATEGY_CONFIG.ORDER_SOFT_ARM_MIN_PROGRESS)
                    )
                    && candidate.metrics.rr >= (
                        regime === "Range"
                            ? STRATEGY_CONFIG.RANGE_PROBATION_MIN_RR
                            : STRATEGY_CONFIG.TREND_PROBATION_MIN_RR
                    )
                    && candidate.resistanceStatus !== "Blocked"
                    && hasOnlySoftAlignmentGaps(triggerEval.missingReasons)
                )
                || emergencyReadySelectionEligible
            )
        );
    const positionSizeMultiplier = fullSizeEligible
        ? STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER
        : halfSizeEligible
            ? STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
            : probationaryEligible
                ? STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER
            : 0;
    const tradeDecision: CandidateTradeDecision = fullSizeEligible
        ? "Selected"
        : (halfSizeEligible || probationaryEligible)
            ? "Half-size Eligible"
            : candidate.marketScore >= Math.min(STRATEGY_CONFIG.SCORE_THRESHOLD_B, STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_SCORE)
                ? "Watchlist"
                : "Blocked";

    return {
        fullSizeEligible,
        aHalfSizeEligible,
        bHalfSizeEligible,
        seedProxyHalfSizeEligible,
        halfSizeEligible,
        probationaryEligible,
        selectionEligible,
        positionSizeMultiplier,
        positionSizeLabel: positionSizeLabel(positionSizeMultiplier),
        tradeDecision,
        orderArmEligible,
    };
}

export function selectContinuousCandidatesV2(
    candidates: ContinuousStrategyCandidate[],
    correlations: Record<string, Record<string, number>>,
    basketOptions?: { prefilterMode?: PrefilterMode; prefilterPassCount?: number },
) {
    const isActionableForSelection = (candidate: ContinuousStrategyCandidate) =>
        candidate.triggerState !== "Executed"
        && candidate.triggerState !== "Cooldown";
    const selected: ContinuousStrategyCandidate[] = [];
    const baseSelectableUniverse = candidates.filter((candidate) =>
        isActionableForSelection(candidate)
        && candidate.price > 0
        && candidate.regime !== "No-trade"
        && (
            candidate.executionStatus === "Pass"
            || candidate.conditionalReferencePass
            || (
                Boolean(candidate.executionSupported)
                && candidate.executionStatus !== "Route Missing"
                && candidate.executionStatus !== "VETO NG"
                && candidate.executionStatus !== "Data Missing"
            )
        )
        && !candidate.autoTradeExcludedReason,
    );
    const selectableCandidates = baseSelectableUniverse.filter((candidate) =>
        candidate.selectionEligible,
    );
    const rangeTriggeredHalfCount = selectableCandidates.filter((candidate) =>
        candidate.regime === "Range"
        && candidate.triggerState === "Triggered"
        && candidate.halfSizeEligible,
    ).length;
    const hasMajorConditionalReference = selectableCandidates.some((candidate) =>
        candidate.conditionalReferencePass
        && (candidate.triggerState === "Triggered" || candidate.orderArmEligible),
    );
    const probationaryCount = selectableCandidates.filter((candidate) =>
        candidate.probationaryEligible
        && candidate.orderArmEligible,
    ).length;
    const maxSelected = Math.min(STRATEGY_CONFIG.MAX_SELECTED_CANDIDATES, deriveContinuousBasketCap({
        selectionEligibleCount: selectableCandidates.length,
        probationaryCount,
        conditionalReferenceCount: selectableCandidates.filter((candidate) => candidate.conditionalReferencePass).length,
        rangeCandidateCount: selectableCandidates.filter((candidate) => candidate.regime === "Range").length,
        prefilterMode: basketOptions?.prefilterMode,
        prefilterPassCount: basketOptions?.prefilterPassCount,
    }) + ((rangeTriggeredHalfCount >= 2 || hasMajorConditionalReference) ? 1 : 0));
    const minimumTargetSelected = deriveMinimumLiveSelectionTarget(
        maxSelected,
        basketOptions?.prefilterPassCount,
        selectableCandidates.length,
    );
    const fullSizePool = selectableCandidates
        .filter((candidate) => candidate.fullSizeEligible)
        .sort(compareBySelectionPriority);
    const halfSizePool = selectableCandidates
        .filter((candidate) => !candidate.fullSizeEligible && (candidate.halfSizeEligible || candidate.probationaryEligible))
        .sort(compareBySelectionPriority);

    const trySelect = (candidate: ContinuousStrategyCandidate, sizeMultiplier: number) => {
        const conflict = hasSelectionConflict(selected, candidate, sizeMultiplier, correlations);
        if (conflict) return false;
        selected.push({
            ...candidate,
            tradeDecision: sizeMultiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER ? "Selected" : "Half-size Eligible",
            positionSizeMultiplier: sizeMultiplier,
            positionSizeLabel: positionSizeLabel(sizeMultiplier),
            autoTradeTarget: true,
            autoTradeLiveEligible: true,
        });
        return true;
    };

    const qualifySoftTopUpSize = (candidate: ContinuousStrategyCandidate, sizeMultiplier: number) => {
        if (candidate.resistanceStatus === "Blocked") return false;
        if ((candidate.triggerState !== "Armed" && candidate.triggerState !== "Triggered" && candidate.triggerState !== "Ready")) return false;
        if (candidate.metrics.rr < Math.max(0.72, (candidate.regime === "Range" ? STRATEGY_CONFIG.RANGE_PROBATION_MIN_RR : STRATEGY_CONFIG.TREND_PROBATION_MIN_RR) - 0.06)) return false;
        if (candidate.marketScore < Math.max(14, STRATEGY_CONFIG.SOFT_SELECTION_MIN_SCORE - 4)) return false;
        if (
            !candidate.orderArmEligible
            && candidate.triggerState !== "Triggered"
            && candidate.triggerProgressRatio < Math.max(0.05, STRATEGY_CONFIG.SOFT_SELECTION_MIN_PROGRESS - 0.04)
        ) {
            return false;
        }
        if (sizeMultiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER) {
            return candidate.marketScore >= Math.max(48, STRATEGY_CONFIG.SCORE_THRESHOLD_A - 16)
                && candidate.metrics.rr >= Math.max(0.84, STRATEGY_CONFIG.FULL_SIZE_MIN_RR - 0.2)
                && candidate.resistanceStatus === "Open"
                && (candidate.triggerState === "Triggered" || candidate.triggerProgressRatio >= 0.28);
        }
        if (sizeMultiplier >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER) {
            return candidate.marketScore >= Math.max(22, STRATEGY_CONFIG.SCORE_THRESHOLD_B - 12)
                && candidate.metrics.rr >= Math.max(0.74, candidate.halfSizeMinRr - 0.14)
                && candidate.triggerProgressRatio >= 0.1;
        }
        return candidate.metrics.rr >= Math.max(0.72, (candidate.regime === "Range" ? STRATEGY_CONFIG.RANGE_PROBATION_MIN_RR : STRATEGY_CONFIG.TREND_PROBATION_MIN_RR) - 0.06)
            && candidate.triggerProgressRatio >= Math.max(0.05, STRATEGY_CONFIG.SOFT_SELECTION_MIN_PROGRESS - 0.04);
    };

    const trySelectTopUp = (candidate: ContinuousStrategyCandidate, sizeMultiplier: number) => {
        const sameComparable = selected.some((existing) => baseTrackedSymbol(existing.symbol) === baseTrackedSymbol(candidate.symbol));
        if (sameComparable) return false;
        const conflict = hasSelectionConflict(selected, candidate, sizeMultiplier, correlations);
        const allowSoftConflict =
            selected.length < minimumTargetSelected
            && sizeMultiplier <= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
            && candidate.regime !== "No-trade";
        if (conflict && !allowSoftConflict) return false;
        selected.push({
            ...candidate,
            selectionEligible: true,
            probationaryEligible: sizeMultiplier <= STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER,
            halfSizeEligible: sizeMultiplier >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER && sizeMultiplier < STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER,
            fullSizeEligible: sizeMultiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER,
            tradeDecision: sizeMultiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER ? "Selected" : "Half-size Eligible",
            positionSizeMultiplier: sizeMultiplier,
            positionSizeLabel: positionSizeLabel(sizeMultiplier),
            autoTradeTarget: true,
            autoTradeLiveEligible: true,
            orderArmEligible:
                candidate.orderArmEligible
                || candidate.triggerState === "Triggered"
                || candidate.triggerState === "Armed"
                || (
                    candidate.triggerState === "Ready"
                    && candidate.triggerProgressRatio >= 0
                    && candidate.metrics.rr >= 0.64
                    && candidate.resistanceStatus !== "Blocked"
                    && (!candidate.triggerMissingReasons.length || hasOnlySoftAlignmentGaps(candidate.triggerMissingReasons))
                ),
            mainReason: candidate.mainReason || "Soft top-up selection",
        });
        return true;
    };

    for (const candidate of fullSizePool) {
        trySelect(candidate, STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER);
        if (selected.length >= maxSelected) break;
    }

    if (selected.length < maxSelected) {
        for (const candidate of halfSizePool) {
            if (selected.some((existing) => existing.symbol === candidate.symbol)) continue;
            const sizeMultiplier = candidate.probationaryEligible
                ? STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER
                : STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER;
            trySelect(candidate, sizeMultiplier);
            if (selected.length >= maxSelected) break;
        }
    }

    if (selected.length < minimumTargetSelected) {
        const fallbackPool = baseSelectableUniverse
            .filter((candidate) => !selected.some((existing) => existing.symbol === candidate.symbol))
            .filter((candidate) => !candidate.selectionEligible)
            .sort(compareBySelectionPriority);

        const requiredSizes = [
            STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER,
            STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER,
            STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER,
        ];

        for (const sizeMultiplier of requiredSizes) {
            if (selected.length >= maxSelected) break;
            const alreadyHasSize = selected.some((candidate) => candidate.positionSizeMultiplier === sizeMultiplier);
            if (alreadyHasSize) continue;
            const fallbackCandidate = fallbackPool.find((candidate) =>
                !selected.some((existing) => existing.symbol === candidate.symbol)
                && qualifySoftTopUpSize(candidate, sizeMultiplier),
            );
            if (fallbackCandidate) {
                trySelectTopUp(fallbackCandidate, sizeMultiplier);
            }
        }

        for (const candidate of fallbackPool) {
            if (selected.length >= minimumTargetSelected) break;
            if (selected.some((existing) => existing.symbol === candidate.symbol)) continue;
            const sizeMultiplier = qualifySoftTopUpSize(candidate, STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER)
                ? STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
                : STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER;
            if (!qualifySoftTopUpSize(candidate, sizeMultiplier)) continue;
            trySelectTopUp(candidate, sizeMultiplier);
        }
    }

    if (selected.length < minimumTargetSelected) {
        const armedFallbackPool = baseSelectableUniverse
            .filter((candidate) => !selected.some((existing) => existing.symbol === candidate.symbol))
            .filter((candidate) => candidate.triggerState === "Armed" || candidate.triggerState === "Ready" || candidate.orderArmEligible)
            .sort(compareBySelectionPriority);

        for (const candidate of armedFallbackPool) {
            if (selected.length >= minimumTargetSelected) break;
            const fallbackSize =
                qualifySoftTopUpSize(candidate, STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER)
                    ? STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER
                    : qualifySoftTopUpSize(candidate, STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER)
                        ? STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
                        : STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER;
            if (!qualifySoftTopUpSize(candidate, fallbackSize)) continue;
            trySelectTopUp(candidate, fallbackSize);
        }
    }

    if (selected.length < minimumTargetSelected) {
        const readyFallbackPool = baseSelectableUniverse
            .filter((candidate) => !selected.some((existing) => existing.symbol === candidate.symbol))
            .filter((candidate) =>
                candidate.triggerState === "Ready"
                && candidate.regime !== "No-trade"
                && candidate.resistanceStatus !== "Blocked"
                && candidate.metrics.rr >= 0.68
                && candidate.triggerProgressRatio >= 0.02,
            )
            .sort(compareBySelectionPriority);

        for (const candidate of readyFallbackPool) {
            if (selected.length >= minimumTargetSelected) break;
            const fallbackSize =
                qualifySoftTopUpSize(candidate, STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER)
                    ? STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
                    : STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER;
            if (!qualifySoftTopUpSize(candidate, fallbackSize)) continue;
            trySelectTopUp(candidate, fallbackSize);
        }
    }

    if (selected.length < minimumTargetSelected) {
        const breadthFallbackPool = baseSelectableUniverse
            .filter((candidate) => !selected.some((existing) => existing.symbol === candidate.symbol))
            .filter((candidate) =>
                candidate.regime !== "No-trade"
                && candidate.executionStatus !== "VETO NG"
                && candidate.resistanceStatus !== "Blocked"
                && candidate.metrics.rr >= 0.66
                && candidate.marketScore >= 8
                && candidate.triggerProgressRatio >= 0.01,
            )
            .sort(compareBySelectionPriority);

        for (const candidate of breadthFallbackPool) {
            if (selected.length >= minimumTargetSelected) break;
            const fallbackSize =
                qualifySoftTopUpSize(candidate, STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER)
                    ? STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER
                    : qualifySoftTopUpSize(candidate, STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER)
                        ? STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
                        : STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER;
            if (!qualifySoftTopUpSize(candidate, fallbackSize)) continue;
            trySelectTopUp(candidate, fallbackSize);
        }
    }

    if (selected.length < 3) {
        const emergencyTopScorePool = baseSelectableUniverse
            .filter((candidate) => !selected.some((existing) => existing.symbol === candidate.symbol))
            .filter((candidate) =>
                candidate.regime !== "No-trade"
                && candidate.executionStatus !== "VETO NG"
                && candidate.resistanceStatus !== "Blocked"
                && candidate.metrics.rr >= 0.64
                && candidate.marketScore >= 6,
            )
            .sort(compareBySelectionPriority);

        for (const candidate of emergencyTopScorePool) {
            if (selected.length >= 3) break;
            const fallbackSize =
                qualifySoftTopUpSize(candidate, STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER)
                    ? STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER
                    : qualifySoftTopUpSize(candidate, STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER)
                        ? STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
                        : STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER;
            if (!qualifySoftTopUpSize(candidate, fallbackSize)) {
                if (
                    fallbackSize <= STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER
                    && candidate.triggerState === "Ready"
                    && candidate.metrics.rr >= 0.64
                    && candidate.triggerProgressRatio >= 0
                ) {
                    trySelectTopUp(candidate, STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER);
                }
                continue;
            }
            trySelectTopUp(candidate, fallbackSize);
        }
    }

    const totalWeightBase = selected.reduce((sum, candidate) => {
        const riskFactor = 1 / Math.max(candidate.atrPct * 100, 0.8);
        const regimeFactor = candidate.regime === "Range" ? 0.82 : 1;
        const referenceFactor = candidate.conditionalReferencePass ? 0.72 : 1;
        return sum + rankFactor(candidate.rank) * riskFactor * regimeFactor * referenceFactor;
    }, 0);

    return selected.map((candidate) => {
        const riskFactor = 1 / Math.max(candidate.atrPct * 100, 0.8);
        const regimeFactor = candidate.regime === "Range" ? 0.82 : 1;
        const referenceFactor = candidate.conditionalReferencePass ? 0.72 : 1;
        const allocationWeight = totalWeightBase > 0
            ? (rankFactor(candidate.rank) * riskFactor * regimeFactor * referenceFactor) / totalWeightBase
            : 1 / Math.max(1, selected.length);
        return {
            ...candidate,
            allocationWeight,
            dynamicTakeProfit: dynamicTakeProfitV2(candidate),
            dynamicStopLoss: dynamicStopLossV2(candidate),
            timedExitMinutes: timedExitMinutesV2(candidate),
        };
    });
}

function recentTradeCooldown(
    candidate: CandidateAnalysis,
    referenceTs: number,
    runtimeState?: ContinuousMonitorRuntimeState,
    triggerType?: StrategyTriggerType,
) {
    const comparable = comparableStrategySymbol(candidate.symbol);
    const recent = (runtimeState?.recentTrades || [])
        .filter((trade) => comparableStrategySymbol(trade.symbol) === comparable)
        .sort((left, right) => right.timestamp - left.timestamp)[0];
    if (!recent) return undefined;

    const cooldownMinutes = recent.action === "SELL"
        ? STRATEGY_CONFIG.EXIT_COOLDOWN_MINUTES
        : STRATEGY_CONFIG.ENTRY_COOLDOWN_MINUTES;
    const cooldownUntil = recent.timestamp + cooldownMinutes * 60_000;
    if (referenceTs >= cooldownUntil) return undefined;

    const breakoutOverride =
        triggerType === "Breakout"
        && candidate.metrics.r15 >= STRATEGY_CONFIG.COOLDOWN_BREAKOUT_OVERRIDE_R15
        && candidate.volumeRatio >= STRATEGY_CONFIG.COOLDOWN_BREAKOUT_OVERRIDE_VOLUME_RATIO;
    if (breakoutOverride) return undefined;

    return cooldownUntil;
}

function selectContinuousCandidates(
    candidates: ContinuousStrategyCandidate[],
    correlations: Record<string, Record<string, number>>,
) {
    const selected: ContinuousStrategyCandidate[] = [];
    const maxSelected = deriveContinuousBasketCap({
        selectionEligibleCount: candidates.filter((candidate) =>
            candidate.fullSizeEligible
            || candidate.aHalfSizeEligible
            || candidate.bHalfSizeEligible
            || candidate.seedProxyHalfSizeEligible
        ).length,
        conditionalReferenceCount: candidates.filter((candidate) => candidate.conditionalReferencePass).length,
        rangeCandidateCount: candidates.filter((candidate) => candidate.regime === "Range").length,
        prefilterMode: candidates.filter((candidate) => candidate.regime === "Range").length >= Math.ceil(candidates.length / 2) ? "Range" : "Trend",
        prefilterPassCount: candidates.length,
    });
    const fullSizePool = candidates
        .filter((candidate) => candidate.fullSizeEligible)
        .sort(compareBySelectionPriority);
    const halfSizePool = candidates
        .filter((candidate) => !candidate.fullSizeEligible && (candidate.aHalfSizeEligible || candidate.bHalfSizeEligible || candidate.seedProxyHalfSizeEligible))
        .sort(compareBySelectionPriority);

    const trySelect = (candidate: ContinuousStrategyCandidate, sizeMultiplier: number) => {
        const conflict = hasSelectionConflict(selected, candidate, sizeMultiplier, correlations);
        if (conflict) return false;
        selected.push({
            ...candidate,
            tradeDecision: sizeMultiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER ? "Selected" : "Half-size Eligible",
            positionSizeMultiplier: sizeMultiplier,
            positionSizeLabel: positionSizeLabel(sizeMultiplier),
            autoTradeTarget: true,
            autoTradeLiveEligible: true,
        });
        return true;
    };

    for (const candidate of fullSizePool) {
        trySelect(candidate, STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER);
        if (selected.length >= maxSelected) break;
    }

    if (selected.length < maxSelected) {
        for (const candidate of halfSizePool) {
            if (selected.some((existing) => existing.symbol === candidate.symbol)) continue;
            trySelect(candidate, STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER);
            if (selected.length >= maxSelected) break;
        }
    }

    const totalWeightBase = selected.reduce((sum, candidate) => {
        const riskFactor = 1 / Math.max(candidate.atrPct * 100, 0.8);
        return sum + rankFactor(candidate.rank) * riskFactor;
    }, 0);

    return selected.map((candidate) => {
        const riskFactor = 1 / Math.max(candidate.atrPct * 100, 0.8);
        const allocationWeight = totalWeightBase > 0
            ? (rankFactor(candidate.rank) * riskFactor) / totalWeightBase
            : 1 / Math.max(1, selected.length);
        return {
            ...candidate,
            allocationWeight,
            dynamicTakeProfit: dynamicTakeProfit(candidate),
            dynamicStopLoss: dynamicStopLoss(candidate),
            timedExitMinutes: timedExitMinutes(candidate, candidate.triggerType),
        };
    });
}

export function buildContinuousStrategyMonitor(
    input: StrategyEngineInput,
    runtimeState?: ContinuousMonitorRuntimeState,
): ContinuousStrategyMonitor {
    const cycleInfo = getTokyoCycleInfo(input.referenceTs);
    const cycleContext = getCycleComputationContext(input.referenceTs, cycleInfo.block);
    const seedMap = new Map<string, StrategyUniverseSeed>(STRATEGY_UNIVERSE_SEEDS.map((seed) => [seed.symbol, seed]));
    const rawUniverse = getRawUniverseCandidates(input, cycleContext);
    const { eligible } = applyUniverseExclusions(rawUniverse, seedMap);
    const monitoredUniverse = buildMonitoredUniverse(eligible);
    const {
        passed: prefilteredUniverse,
        mode: prefilterMode,
        rescuedCount: prefilterRescuedCount,
        targetMin: prefilterTargetMin,
    } = applyPrefilter(monitoredUniverse, cycleContext);
    const effectivePrefilterUniverse = prefilteredUniverse.length > 0
        ? prefilteredUniverse
        : monitoredUniverse
            .filter((asset) =>
                asset.price > 0
                && (asset.executionSupported || asset.dexPairFound)
                && passesLiveBreadthRescueFloor(asset),
            )
            .sort((left, right) => right.universeRankScore - left.universeRankScore)
            .slice(0, Math.min(12, monitoredUniverse.length))
            .map((asset) => ({
                ...asset,
                prefilterPass: true,
                prefilterReason: "Emergency scored include",
            }));
    const scoredCandidates = scoreCandidates(effectivePrefilterUniverse, input, cycleContext);
    const correlations = buildCorrelationMap(scoredCandidates, input, cycleContext);

    const openSymbols = new Set((runtimeState?.openSymbols || []).map((symbol) => comparableStrategySymbol(symbol)));
    const pendingSymbols = new Set((runtimeState?.pendingSymbols || []).map((symbol) => comparableStrategySymbol(symbol)));

    const enriched = scoredCandidates.map((candidate) => {
        const regime = deriveRegime(candidate);
        const triggerEval = evaluateTriggerV2(candidate, regime);
        const liveSizing = resolveContinuousPositioningV2(candidate, regime, triggerEval);
        const comparable = comparableStrategySymbol(candidate.symbol);
        const cooldownUntil = recentTradeCooldown(candidate, input.referenceTs, runtimeState, triggerEval.type);

        let triggerState: StrategyTriggerState = triggerEval.state;
        if (openSymbols.has(comparable) || pendingSymbols.has(comparable)) {
            triggerState = "Executed";
        } else if (cooldownUntil && cooldownUntil > input.referenceTs) {
            triggerState = "Cooldown";
        }

        const liveEligible =
            (candidate.executionStatus === "Pass" || candidate.conditionalReferencePass)
            && !candidate.autoTradeExcludedReason
            && liveSizing.selectionEligible;
        const orderArmEligible =
            (triggerState === "Triggered" || triggerState === "Executed" || liveSizing.orderArmEligible)
            && liveEligible;
        const eventPriority =
            candidate.marketScore
            + triggerEval.score
            + (liveSizing.positionSizeMultiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER ? 10 : liveSizing.positionSizeMultiplier >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER ? 6 : liveSizing.positionSizeMultiplier >= STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER ? 4 : 2)
            + (triggerState === "Triggered" ? 12 : triggerState === "Armed" ? (liveSizing.orderArmEligible ? 11 : 7) : liveSizing.orderArmEligible ? 9 : 0)
            + (triggerEval.passedCount * 3)
            - (Math.max(0, triggerEval.ruleCount - triggerEval.passedCount) * 2)
            + (triggerEval.family === "Range" ? 3 : 5)
            + (candidate.conditionalReferencePass ? 4 : 0)
            + (liveSizing.probationaryEligible ? 2 : 0)
            + (regime === "Trend" ? 4 : regime === "Range" ? 3 : -8);

        return {
            ...candidate,
            regime,
            triggerType: triggerEval.type,
            triggerFamily: triggerEval.family,
            triggerState,
            triggerReason: triggerState === "Cooldown"
                ? "クールダウン中"
                : triggerState === "Executed"
                    ? "保有中 / 発注中"
                    : triggerEval.reason,
            triggerScore: triggerEval.score,
            triggerPassedCount: triggerEval.passedCount,
            triggerRuleCount: triggerEval.ruleCount,
            triggerProgressRatio: triggerEval.progressRatio,
            triggerMissingReasons: triggerEval.missingReasons,
            cooldownUntil,
            autoTradeLiveEligible: orderArmEligible,
            autoTradeTarget: false,
            allocationWeight: 0,
            timedExitMinutes: timedExitMinutesV2({
                ...candidate,
                regime,
                triggerType: triggerEval.type,
                triggerFamily: triggerEval.family,
                triggerState,
                triggerReason: triggerEval.reason,
                triggerScore: triggerEval.score,
                triggerPassedCount: triggerEval.passedCount,
                triggerRuleCount: triggerEval.ruleCount,
                triggerProgressRatio: triggerEval.progressRatio,
                triggerMissingReasons: triggerEval.missingReasons,
                cooldownUntil,
                autoTradeLiveEligible: orderArmEligible,
                autoTradeTarget: false,
                allocationWeight: 0,
                timedExitMinutes: 0,
                dynamicTakeProfit: 0,
                dynamicStopLoss: 0,
                eventPriority,
                ...liveSizing,
            }),
            dynamicTakeProfit: dynamicTakeProfitV2({
                ...candidate,
                regime,
                triggerType: triggerEval.type,
                triggerFamily: triggerEval.family,
                triggerState,
                triggerReason: triggerEval.reason,
                triggerScore: triggerEval.score,
                triggerPassedCount: triggerEval.passedCount,
                triggerRuleCount: triggerEval.ruleCount,
                triggerProgressRatio: triggerEval.progressRatio,
                triggerMissingReasons: triggerEval.missingReasons,
                cooldownUntil,
                autoTradeLiveEligible: orderArmEligible,
                autoTradeTarget: false,
                allocationWeight: 0,
                timedExitMinutes: 0,
                dynamicTakeProfit: 0,
                dynamicStopLoss: 0,
                eventPriority,
                ...liveSizing,
            }),
            dynamicStopLoss: dynamicStopLossV2({
                ...candidate,
                regime,
                triggerType: triggerEval.type,
                triggerFamily: triggerEval.family,
                triggerState,
                triggerReason: triggerEval.reason,
                triggerScore: triggerEval.score,
                triggerPassedCount: triggerEval.passedCount,
                triggerRuleCount: triggerEval.ruleCount,
                triggerProgressRatio: triggerEval.progressRatio,
                triggerMissingReasons: triggerEval.missingReasons,
                cooldownUntil,
                autoTradeLiveEligible: orderArmEligible,
                autoTradeTarget: false,
                allocationWeight: 0,
                timedExitMinutes: 0,
                dynamicTakeProfit: 0,
                dynamicStopLoss: 0,
                eventPriority,
                ...liveSizing,
            }),
            ...liveSizing,
            eventPriority,
            orderTriggeredAt: undefined,
        } satisfies ContinuousStrategyCandidate;
    });

    const selectedBasketCap = deriveContinuousBasketCap({
        selectionEligibleCount: enriched.filter((candidate) =>
            candidate.triggerState !== "Executed"
            && candidate.triggerState !== "Cooldown"
            && candidate.selectionEligible
            && (candidate.executionStatus === "Pass" || candidate.conditionalReferencePass)
            && !candidate.autoTradeExcludedReason,
        ).length,
        probationaryCount: enriched.filter((candidate) => candidate.probationaryEligible).length,
        conditionalReferenceCount: enriched.filter((candidate) => candidate.conditionalReferencePass).length,
        rangeCandidateCount: enriched.filter((candidate) => candidate.regime === "Range" && candidate.selectionEligible).length,
        prefilterMode,
        prefilterPassCount: effectivePrefilterUniverse.length,
    });
    let selected = selectContinuousCandidatesV2(
        enriched,
        correlations,
        { prefilterMode, prefilterPassCount: effectivePrefilterUniverse.length },
    );
    const minimumTargetSelected = deriveMinimumLiveSelectionTarget(
        selectedBasketCap,
        effectivePrefilterUniverse.length,
        enriched.filter((candidate) =>
            candidate.triggerState !== "Executed"
            && candidate.triggerState !== "Cooldown"
            && candidate.selectionEligible,
        ).length,
    );
    if (selected.length < minimumTargetSelected) {
        const emergencySizePlan = [
            STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER,
            STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER,
            STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER,
            STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER,
            STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER,
            STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER,
            STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER,
        ] as const;
        const emergencyPool = enriched
            .filter((candidate) => !selected.some((entry) => entry.symbol === candidate.symbol))
            .filter((candidate) =>
                candidate.triggerState !== "Executed"
                && candidate.triggerState !== "Cooldown"
                && candidate.price > 0
                && candidate.regime !== "No-trade"
                && candidate.executionStatus !== "Route Missing"
                && candidate.executionStatus !== "VETO NG"
                && candidate.executionStatus !== "Data Missing"
                && !candidate.autoTradeExcludedReason
                && candidate.resistanceStatus !== "Blocked"
                && candidate.metrics.rr >= 0.62,
            )
            .sort(compareBySelectionPriority);

        for (const candidate of emergencyPool) {
            if (selected.length >= minimumTargetSelected) break;
            const sizeMultiplier = emergencySizePlan[Math.min(selected.length, emergencySizePlan.length - 1)];
            if (selected.some((entry) => baseTrackedSymbol(entry.symbol) === baseTrackedSymbol(candidate.symbol))) continue;
            selected = [
                ...selected,
                {
                    ...candidate,
                    selectionEligible: true,
                    fullSizeEligible: sizeMultiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER,
                    halfSizeEligible: sizeMultiplier >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER && sizeMultiplier < STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER,
                    probationaryEligible: sizeMultiplier <= STRATEGY_CONFIG.PROBATION_POSITION_MULTIPLIER,
                    tradeDecision: sizeMultiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER ? "Selected" : "Half-size Eligible",
                    positionSizeMultiplier: sizeMultiplier,
                    positionSizeLabel: positionSizeLabel(sizeMultiplier),
                    autoTradeTarget: true,
                    autoTradeLiveEligible: true,
                    orderArmEligible: true,
                    mainReason: candidate.mainReason || "Top-score emergency selection",
                },
            ];
        }
    }
    const selectedSymbols = new Set(selected.map((candidate) => candidate.symbol));
    const finalizedCandidates = enriched.map((candidate) => {
        const selectedCandidate = selected.find((entry) => entry.symbol === candidate.symbol);
        if (selectedCandidate) {
            const selectedOrderArmed = selectedCandidate.triggerState === "Triggered" || selectedCandidate.orderArmEligible;
            return {
                ...selectedCandidate,
                orderTriggeredAt: selectedCandidate.orderTriggeredAt,
                orderGateStatus: selectedOrderArmed ? ("armed" as const) : ("blocked" as const),
                orderGateReason: selectedOrderArmed
                    ? selectedCandidate.triggerState === "Triggered"
                        ? "Selected basket / awaiting runtime order check"
                        : "Final trigger alignment pass"
                    : selectedCandidate.triggerReason || "Selected but trigger not ready",
                orderGateDetail: selectedOrderArmed
                    ? selectedCandidate.triggerState === "Triggered"
                        ? "Selected basket is armed. Runtime slot / exposure / entry zone still checked separately."
                        : "Selected candidate has enough trigger alignment to proceed into runtime order checks."
                    : selectedCandidate.triggerMissingReasons?.length
                        ? `Still missing: ${selectedCandidate.triggerMissingReasons.slice(0, 2).join(" / ")}`
                        : selectedCandidate.triggerReason || "Trigger not armed yet.",
            };
        }
        const waitingForSlot = candidate.selectionEligible && !selectedSymbols.has(candidate.symbol);
        return {
            ...candidate,
            autoTradeTarget: selectedSymbols.has(candidate.symbol),
            orderTriggeredAt: candidate.orderTriggeredAt,
            orderGateStatus: waitingForSlot ? ("slot" as const) : ("blocked" as const),
            orderGateReason: waitingForSlot
                ? candidate.correlationRejected
                    ? "Correlation blocked"
                    : "Waiting for slot"
                : candidate.selectionEligible
                    ? candidate.triggerState === "Armed"
                        ? "Final trigger alignment wait"
                        : candidate.triggerReason || "Trigger not ready"
                    : candidate.finalRejectReason || candidate.mainReason || "Selection blocked",
            orderGateDetail: waitingForSlot
                ? candidate.correlationRejected
                    ? "Selected-level candidate is blocked by correlation overlap."
                    : "Selected-level candidate is waiting for a free selected basket slot."
                : candidate.selectionEligible
                    ? candidate.orderArmEligible
                        ? "Selected-level candidate is eligible for runtime arming but is below the current selected basket priority."
                        : candidate.triggerMissingReasons?.length
                            ? `Selected-level candidate still needs: ${candidate.triggerMissingReasons.slice(0, 2).join(" / ")}`
                            : "Selected-level candidate still needs final trigger / execution alignment."
                    : candidate.finalRejectReason || candidate.mainReason || "Selection gate blocked",
        };
    }).sort(compareBySelectionPriority);
    const selectedOrderBlockedRows = finalizedCandidates.filter((candidate) =>
        candidate.autoTradeTarget && candidate.orderGateStatus !== "armed",
    );
    const finalAlignmentWaitCount = finalizedCandidates.filter((candidate) =>
        candidate.selectionEligible
        && candidate.orderGateStatus === "blocked"
        &&
        /final trigger alignment|trigger not ready|trigger not armed/i.test(`${candidate.orderGateReason || ""} ${candidate.orderGateDetail || ""}`),
    ).length;
    const volumeHeldCount = 0;
    const selectedOrderBlockedReasons = Array.from(
        selectedOrderBlockedRows.reduce((map, candidate) => {
            const key = candidate.orderGateReason || candidate.finalRejectReason || candidate.mainReason || "Selection blocked";
            map.set(key, (map.get(key) || 0) + 1);
            return map;
        }, new Map<string, number>()),
    )
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count }));

    return {
        dayKey: getJstDateKey(input.referenceTs),
        currentBlock: cycleInfo.block,
        monitoredAt: input.referenceTs,
        regimeUpdatedAt: floorTimestamp(input.referenceTs, STRATEGY_CONFIG.REGIME_REFRESH_MINUTES),
        candidateUpdatedAt: floorTimestamp(input.referenceTs, STRATEGY_CONFIG.CANDIDATE_REFRESH_MINUTES),
        triggerUpdatedAt: floorTimestamp(input.referenceTs, STRATEGY_CONFIG.TRIGGER_REFRESH_MINUTES),
        stats: {
            rawUniverseCount: rawUniverse.length,
            monitoredUniverseCount: monitoredUniverse.length,
            prefilterPassCount: effectivePrefilterUniverse.length,
            prefilterMode,
            prefilterRescuedCount,
            prefilterTargetMin,
            scoredCount: scoredCandidates.length,
            readyCount: finalizedCandidates.filter((candidate) => candidate.triggerState === "Ready").length,
            armedCount: finalizedCandidates.filter((candidate) => candidate.triggerState === "Armed").length,
            triggeredCount: finalizedCandidates.filter((candidate) => candidate.triggerState === "Triggered").length,
            executedCount: finalizedCandidates.filter((candidate) => candidate.triggerState === "Executed").length,
            cooldownCount: finalizedCandidates.filter((candidate) => candidate.triggerState === "Cooldown").length,
            selectedCount: selected.length,
            selectedBasketCap,
            selectionEligibleCount: Math.max(selected.length, finalizedCandidates.filter((candidate) =>
                candidate.triggerState !== "Executed"
                && candidate.triggerState !== "Cooldown"
                && candidate.selectionEligible,
            ).length),
            conditionalReferencePassCount: finalizedCandidates.filter((candidate) => candidate.conditionalReferencePass).length,
            probationaryCount: Math.max(
                selected.filter((candidate) => candidate.positionSizeLabel === "0.2x").length,
                finalizedCandidates.filter((candidate) => candidate.probationaryEligible).length,
            ),
            waitingForSlotCount: finalizedCandidates.filter((candidate) => candidate.orderGateStatus === "slot").length,
            orderArmedCount: finalizedCandidates.filter((candidate) => candidate.orderGateStatus === "armed").length,
            finalAlignmentWaitCount,
            volumeHeldCount,
            ordersTodayCount: finalizedCandidates.filter((candidate) => Number.isFinite(candidate.orderTriggeredAt) && Number(candidate.orderTriggeredAt) > 0).length,
            selectedOrderBlockedCount: selectedOrderBlockedRows.length,
            selectedOrderBlockedReasons,
        },
        candidates: finalizedCandidates,
        selected,
        fullSizeTargets: selected.filter((candidate) => candidate.positionSizeLabel === "0.5x"),
        halfSizeTargets: selected.filter((candidate) => candidate.positionSizeLabel === "0.3x"),
        armed: finalizedCandidates.filter((candidate) => candidate.triggerState === "Armed").slice(0, 8),
        triggered: finalizedCandidates.filter((candidate) => candidate.triggerState === "Triggered").slice(0, 8),
        executed: finalizedCandidates.filter((candidate) => candidate.triggerState === "Executed").slice(0, 8),
        cooldown: finalizedCandidates.filter((candidate) => candidate.triggerState === "Cooldown").slice(0, 8),
        watchlist: finalizedCandidates.filter((candidate) => candidate.tradeDecision === "Watchlist").slice(0, 12),
        blocked: finalizedCandidates.filter((candidate) => candidate.tradeDecision === "Blocked").slice(0, 12),
    };
}

export function buildDailyPlan(input: StrategyEngineInput): DailyPlanBuildResult {
    const referenceTs = input.referenceTs;
    const cycleInfo = getTokyoCycleInfo(referenceTs);
    const seedMap = new Map<string, StrategyUniverseSeed>(STRATEGY_UNIVERSE_SEEDS.map((seed) => [seed.symbol, seed]));
    const thresholdScore = STRATEGY_CONFIG.SCORE_THRESHOLD_A;
    const plans: CyclePlanDraft[] = [];
    const symbolReuseCount = new Map<string, number>();
    let previousMonitoredUniverse: UniverseAsset[] | undefined;
    let previousPrefilteredUniverse: UniverseAsset[] | undefined;
    let previousScoredPool: CandidateAnalysis[] | undefined;
    let previousReviewedCandidates: CandidateAnalysis[] | undefined;
    let previousMonitoredSymbols: string[] | undefined;
    let previousPrefilterSymbols: string[] | undefined;
    let previousScoredSymbols: string[] | undefined;
    let previousAnchorTime: number | undefined;

    for (const block of CYCLE_BLOCKS) {
        const cycleContext = getCycleComputationContext(referenceTs, block);
        const rawUniverse = getRawUniverseCandidates(input, cycleContext);
        const { eligible, excluded: universeExcluded } = applyUniverseExclusions(rawUniverse, seedMap);
        const monitoredUniverse = buildMonitoredUniverse(eligible);
        const {
            passed: prefilteredUniverse,
            excluded: prefilterExcluded,
            mode: prefilterMode,
            rescuedCount: prefilterRescuedCount,
            targetMin: prefilterTargetMin,
        } = applyPrefilter(monitoredUniverse, cycleContext);
        const candidates = scoreCandidates(prefilteredUniverse, input, cycleContext);
        const correlations = buildCorrelationMap(candidates, input, cycleContext);
        const topUniverseAssets = monitoredUniverse.slice(0, 8).map((asset) => ({
            symbol: asset.symbol,
            displaySymbol: asset.displaySymbol,
            chain: asset.chain,
            tier: asset.tier || "experimental",
            universeRankScore: asset.universeRankScore,
        }));
        const experimentalTierAssets = monitoredUniverse
            .filter((asset) => asset.tier === "experimental")
            .slice(0, 8)
            .map((asset) => ({
                symbol: asset.symbol,
                displaySymbol: asset.displaySymbol,
                chain: asset.chain,
                universeRankScore: asset.universeRankScore,
            }));
        const { scoredForBlock, thresholdPassCandidates, selected, eligibleA, eligibleB } = selectTopCandidates(
            candidates,
            correlations,
            cycleContext,
            symbolReuseCount,
            thresholdScore,
        );
        const selectedCandidateMap = new Map(selected.map((candidate) => [candidate.symbol, candidate]));
        selected.forEach((candidate) => {
            symbolReuseCount.set(candidate.symbol, (symbolReuseCount.get(candidate.symbol) || 0) + 1);
        });

        const totalWeightBase = selected.reduce((sum, candidate) => {
            const riskFactor = 1 / Math.max(candidate.atrPct * 100, 0.8);
            return sum + rankFactor(candidate.rank) * riskFactor;
        }, 0);

        const settlementSymbol = (() => {
            const nextBlock = CYCLE_BLOCKS[(CYCLE_BLOCKS.indexOf(block) + 1) % CYCLE_BLOCKS.length];
            return [...candidates]
                .sort((left, right) => (right.score + blockPriority(nextBlock, right)) - (left.score + blockPriority(nextBlock, left)))
                .find((candidate) => candidate.executionStatus === "Pass" && !candidate.autoTradeExcludedReason && candidate.marketScore >= STRATEGY_CONFIG.SCORE_THRESHOLD_B)
                ?.symbol;
        })();

        const reviewedCandidates = scoredForBlock.map((candidate) => {
            const decision = buildCandidateStatusV2(candidate, selectedCandidateMap, thresholdScore);
            return {
                ...candidate,
                status: decision.status,
                tradeDecision: decision.tradeDecision,
                selectionStage: decision.selectionStage,
                thresholdGap: decision.thresholdGap,
                exclusionReason: decision.exclusionReason,
                mainReason: decision.mainReason,
                positionSizeMultiplier: decision.positionSizeMultiplier,
                positionSizeLabel: decision.positionSizeLabel,
                correlationRejected: decision.correlationRejected,
                finalSelectedEligible: decision.finalSelectedEligible,
                finalRejectReason: decision.finalRejectReason,
            };
        });

        const monitoredSymbols = monitoredUniverse.map((asset) => asset.symbol);
        const prefilterSymbols = prefilteredUniverse.map((asset) => asset.symbol);
        const scoredSymbols = scoredForBlock.map((candidate) => candidate.symbol);
        const debug: CycleDebugInfo = {
            cycleLabel: block,
            anchorTime: cycleContext.anchorTs,
            cycleStart: cycleContext.cycleStartTs,
            cycleEnd: cycleContext.cycleEndTs,
            anchorSource: cycleContext.anchorSource,
            monitoredUniverseCount: monitoredUniverse.length,
            prefilterPassCount: prefilteredUniverse.length,
            prefilterMode,
            prefilterRescuedCount,
            prefilterTargetMin,
            scoredCount: scoredForBlock.length,
            selectedCount: selected.length,
            monitoredUniverseFirst5: monitoredSymbols.slice(0, 5),
            prefilterFirst5: prefilterSymbols.slice(0, 5),
            scoredFirst5: scoredSymbols.slice(0, 5),
            averageMarketScore: Number(average(reviewedCandidates.map((candidate) => candidate.marketScore)).toFixed(2)),
            rankingTop3: reviewedCandidates.slice(0, 3).map((candidate) => ({
                symbol: candidate.symbol,
                score: candidate.marketScore,
            })),
            monitoredUniverseSameRefAsPrev: previousMonitoredUniverse === monitoredUniverse,
            prefilterSameRefAsPrev: previousPrefilteredUniverse === prefilteredUniverse,
            scoredPoolSameRefAsPrev: previousScoredPool === candidates,
            reviewedCandidatesSameRefAsPrev: previousReviewedCandidates === reviewedCandidates,
            anchorTimeSameAsPrev: previousAnchorTime === cycleContext.anchorTs,
            monitoredUniverseSameSymbolsAsPrev: sameSymbolSlice(previousMonitoredSymbols || [], monitoredSymbols),
            prefilterSameSymbolsAsPrev: sameSymbolSlice(previousPrefilterSymbols || [], prefilterSymbols),
            scoredSameSymbolsAsPrev: sameSymbolSlice(previousScoredSymbols || [], scoredSymbols),
        };

        const selectionStats: CycleSelectionStats = {
            rawUniverseCount: rawUniverse.length,
            universeCount: monitoredUniverse.length,
            universeExcludedCount: universeExcluded.length,
            monitoredUniverseCount: monitoredUniverse.length,
            prefilterPassCount: prefilteredUniverse.length,
            prefilterExcludedCount: prefilterExcluded.length,
            prefilterMode,
            prefilterRescuedCount,
            prefilterTargetMin,
            marketDataPassCount: prefilteredUniverse.length,
            vetoCount: reviewedCandidates.filter((candidate) => candidate.executionStatus !== "Pass").length,
            vetoPassCount: reviewedCandidates.filter((candidate) => candidate.executionStatus === "Pass").length,
            scoreCalculatedCount: reviewedCandidates.length,
            thresholdScore,
            thresholdPassCount: thresholdPassCandidates.length,
            fullSizeEligibleCount: eligibleA.length,
            halfSizeEligibleCount: thresholdPassCandidates.filter((candidate) => candidate.aHalfSizeEligible || candidate.bHalfSizeEligible || candidate.seedProxyHalfSizeEligible || candidate.conditionalReferencePass).length,
            finalSelectionEligibleCount: thresholdPassCandidates.length,
            scoreRejectedCount: reviewedCandidates.filter((candidate) => candidate.executionStatus === "Pass" && candidate.marketScore < thresholdScore).length,
            correlationPassCount: selected.length,
            correlationRejectedCount: Math.max(0, thresholdPassCandidates.length - selected.length),
            finalSelectedCount: selected.length,
            topUniverseAssets,
            experimentalTierAssets,
            debug,
        };

        const symbolPlans = selected.map((candidate) => {
            const baseFactor = rankFactor(candidate.rank);
            const riskFactor = 1 / Math.max(candidate.atrPct * 100, 0.8);
            const weight = totalWeightBase > 0
                ? (baseFactor * riskFactor) / totalWeightBase
                : 1 / Math.max(1, selected.length);
            const hash = hashString(`${block}:${candidate.symbol}`);
            const entryLead = candidate.mode === "TREND" ? 12 : 24;
            const variability = hash % 38;
            const entryOffsetMin = clamp(entryLead + variability + (candidate.metrics.vwap15m > 0 ? -6 : 4) + (candidate.rank === "A" ? -4 : 6), 8, 235);
            const holdMinutes = clamp((candidate.mode === "TREND" ? 125 : 80) + (hash % 75) + (candidate.rank === "A" ? 18 : -5), 55, 250);
            const plannedEntryAt = cycleContext.cycleStartTs + entryOffsetMin * 60_000;
            const plannedExitAt = Math.min(cycleContext.cycleEndTs - 10 * 60_000, plannedEntryAt + holdMinutes * 60_000);
            const atrMove = Math.max(candidate.atrPct, 0.0065);
            const entryCenter = candidate.price * (candidate.mode === "TREND" ? 1 + clamp(candidate.metrics.vwap15m, -0.002, 0.002) : 1 - atrMove * 0.18);
            const entryMin = Math.max(candidate.price * 0.7, entryCenter * (1 - atrMove * 0.22));
            const entryMax = entryCenter * (1 + atrMove * 0.18);
            const tpAtr = candidate.mode === "TREND" ? 1.6 : 1.05;
            const slAtr = candidate.mode === "TREND" ? 1.0 : 0.85;
            const plannedTakeProfit = Math.min(candidate.price * (1 + candidate.resistanceDistancePct * 0.92), candidate.price * (1 + atrMove * tpAtr));
            const plannedStopLoss = Math.max(candidate.price * (1 - candidate.supportDistancePct * 0.92), candidate.price * (1 - atrMove * slAtr));
            return {
                symbol: candidate.symbol,
                displaySymbol: candidate.displaySymbol,
                chain: candidate.chain,
                executionChain: candidate.executionChain,
                executionChainId: candidate.executionChainId,
                executionAddress: candidate.executionAddress,
                executionDecimals: candidate.executionDecimals,
                executionRouteKind: candidate.executionRouteKind,
                executionSource: candidate.executionSource,
                executionPairUrl: candidate.executionPairUrl,
                weight,
                source: "current" as const,
                rank: candidate.rank,
                mode: candidate.mode,
                score: candidate.score,
                plannedEntryAt,
                plannedExitAt,
                entryMin,
                entryMax,
                plannedTakeProfit,
                plannedStopLoss,
                positionSizeMultiplier: candidate.positionSizeMultiplier,
                positionSizeLabel: candidate.positionSizeLabel,
                settlementSymbol,
                reasonTags: candidate.reasonTags,
                indicatorNotes: candidate.indicatorNotes,
            };
        });

        const blockMode = symbolPlans.length === 0
            ? "MIXED"
            : symbolPlans.every((plan) => plan.mode === "TREND")
              ? "TREND"
              : symbolPlans.every((plan) => plan.mode === "MEAN_REVERSION")
                ? "MEAN_REVERSION"
                : "MIXED";

        plans.push({
            block,
            mode: blockMode,
            rankSummary: rankSummaryOf(symbolPlans.map((plan) => plan.rank)),
            settlementSymbol,
            symbolPlans,
            topCandidates: reviewedCandidates,
            selectionStats,
            agentScenarios: buildAgentScenarios(symbolPlans, block, settlementSymbol),
        });

        previousMonitoredUniverse = monitoredUniverse;
        previousPrefilteredUniverse = prefilteredUniverse;
        previousScoredPool = candidates;
        previousReviewedCandidates = reviewedCandidates;
        previousMonitoredSymbols = monitoredSymbols;
        previousPrefilterSymbols = prefilterSymbols;
        previousScoredSymbols = scoredSymbols;
        previousAnchorTime = cycleContext.anchorTs;
    }

    const currentPlan = plans.find((plan) => plan.block === cycleInfo.block) || plans[0];

    return {
        dayKey: cycleInfo.dayKey,
        currentBlock: cycleInfo.block,
        plans,
        candidates: currentPlan?.topCandidates || [],
    };
}
