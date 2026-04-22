import path from "path";

import { RECLAIM_HYBRID_EXECUTION_PROFILE } from "../../config/reclaimHybridStrategy";
import { selectStrategyPreset } from "../../config/strategyMode";
import { loadHistoricalCandles } from "./binance-source";
import { buildIndicatorBars, latestIndicatorAtOrBefore, resampleTo12h, resampleTo1d, resampleToHours, sma } from "./indicators";
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
const BASE_EQUITY = 10_000;
const TRADE_SYMBOLS = ["ETH", "SOL", "AVAX"] as const;
const EXPANDED_TREND_SYMBOLS = ["ETH", "SOL", "AVAX", "BNB", "LINK"] as const;
const RANGE_SYMBOLS = ["ETH", "SOL"] as const;
const ALL_SYMBOLS = ["BTC", "ETH", "SOL", "AVAX", "TRX", "CAKE", "BNB", "LINK", "SFP", "NEAR", "LTC", "XRP", "ATOM", "AAVE", "UNI", "ADA", "INJ"] as const;
type TradeSymbol = typeof ALL_SYMBOLS[number];
const REBALANCE_BARS = 11;

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
    backtestStartTs?: number;
    backtestEndTs?: number;
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
    trendBreakoutLookbackBarsBySymbol?: Record<string, number>;
    trendBreakoutMinPctBySymbol?: Record<string, number>;
    trendMinVolumeRatioBySymbol?: Record<string, number>;
    trendMinMomAccelBySymbol?: Record<string, number>;
    trendMinEfficiencyRatioBySymbol?: Record<string, number>;
    trendWindowedOverridesBySymbol?: Record<string, {
        windows: readonly { startTs: number; endTs: number }[];
        breakoutLookbackBars?: number;
        breakoutMinPct?: number;
        minVolumeRatio?: number;
        minMomAccel?: number;
        minEfficiencyRatio?: number;
        scoreAdjustment?: number;
    }>;
    trendScoreAdjustmentBySymbol?: Record<string, number>;
    trendAllocBySymbol?: Record<string, number>;
    trendScoreEfficiencyBonusWeight?: number | null;
    trendScoreOverheatPenaltyWeight?: number | null;
    trendProfitTrailActivationPct?: number | null;
    trendProfitTrailRetracePct?: number | null;
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
    trendDecisionTimeframe?: "4h" | "6h" | "12h" | "1d";
    trendExitCheckTimeframe?: "4h" | "6h" | "12h";
    trendEntryAssistTimeframe?: "12h" | "1d";
    trendEntryAssistRequireMomentum?: boolean;
    trendEntryAssistRequireCloseAboveSma?: boolean;
    trendEntryAssistMaxMomAccelBelow?: number | null;
    expandedTrendSymbols?: readonly string[];
    strictExtraTrendSymbols?: readonly string[];
    strictExtraTrendAllowedWindows?: readonly { startTs: number; endTs: number }[];
    strictExtraTrendIdleOnly?: boolean;
    strictExtraTrendDecisionTimeframe?: "4h" | "6h" | "12h" | "1d";
    strictExtraTrendExitCheckTimeframe?: "4h" | "6h" | "12h";
    strictExtraTrendMinEfficiencyRatio?: number | null;
    strictExtraTrendMinEfficiencyRatioBySymbol?: Record<string, number>;
    strictExtraTrendMinVolumeRatio?: number | null;
    strictExtraTrendTrailActivationPct?: number | null;
    strictExtraTrendTrailRetracePct?: number | null;
    strictExtraTrendHardStopLossPct?: number | null;
    strictExtraTrendMaxHoldBars?: number | null;
    strictExtraTrendRotationWhileHolding?: boolean;
    strictExtraTrendRotationScoreGap?: number | null;
    strictExtraTrendRotationScoreGapBySymbol?: Record<string, number>;
    strictExtraTrendRotationCurrentMomAccelMax?: number | null;
    strictExtraTrendRotationCurrentMom20Max?: number | null;
    strictExtraTrendRotationRequireConsecutiveBars?: number;
    strictExtraTrendRotationRequireConsecutiveBarsBySymbol?: Record<string, number>;
    strictExtraTrendRotationMinHoldBars?: number;
    strictExtraTrendPriorityCurrentSymbols?: readonly string[];
    strictExtraTrendPriorityScoreGap?: number | null;
    strictExtraTrendPriorityRequireHigherMom20?: boolean;
    strictExtraTrendPriorityRequireHigherEfficiency?: boolean;
    idleBreakoutEntryWhileCash?: boolean;
    idleBreakoutEntryTimeframe?: "4h" | "6h" | "12h";
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
    idleBreakoutMaxHoldBars?: number | null;
    trendRotationWhileHolding?: boolean;
    trendRotationCurrentSymbols?: readonly string[];
    trendRotationScoreGap?: number | null;
    trendRotationAlternateScoreGap?: number | null;
    trendRotationCurrentMomAccelMax?: number | null;
    trendRotationCurrentMom20Max?: number | null;
    trendRotationRequireConsecutiveBars?: number;
    trendRotationAlternateRequireConsecutiveBars?: number;
    trendRotationMinHoldBars?: number;
    trendPrioritySymbols?: readonly string[];
    trendPriorityMaxScoreGap?: number | null;
    trendSymbolBlockWindows?: Record<string, readonly { startTs: number; endTs: number }[]>;
    symbolSpecificTrendWeakExitSymbols?: readonly string[];
    symbolSpecificTrendWeakExitMom20Below?: number | null;
    symbolSpecificTrendWeakExitMomAccelBelow?: number | null;
    idleCashTrendContext?: boolean;
    idleCashTrendAllowTrendGateOff?: boolean;
    idleCashTrendMinMom20?: number | null;
    idleCashTrendMinEfficiencyRatio?: number | null;
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
    momAccel: number;
    adx14: number;
    overheatPct: number;
    volumeRatio: number;
    efficiencyRatio: number;
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

async function loadRawSeries(input?: { startTs?: number; endTs?: number }) {
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
        });
        bySymbol[symbol] = candles;
    }
    return { startTs, endTs, bySymbol };
}

async function loadRawSeriesForUniverse(
    symbols: readonly string[],
    input?: { startTs?: number; endTs?: number },
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
    timeframe: NonNullable<HybridVariantOptions["trendDecisionTimeframe"]> | NonNullable<HybridVariantOptions["trendExitCheckTimeframe"]> = "12h",
) {
    const out = {} as Record<typeof ALL_SYMBOLS[number], IndicatorBar[]>;
    for (const symbol of ALL_SYMBOLS) {
        const bars = timeframe === "1d"
            ? resampleTo1d(bySymbol[symbol])
            : timeframe === "6h"
                ? resampleToHours(bySymbol[symbol], 6)
                : timeframe === "4h"
                    ? resampleToHours(bySymbol[symbol], 4)
                    : resampleTo12h(bySymbol[symbol]);
        out[symbol] = buildIndicatorBars(bars);
    }
    return out;
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
    timeframe: NonNullable<HybridVariantOptions["trendDecisionTimeframe"]> | NonNullable<HybridVariantOptions["trendExitCheckTimeframe"]> = "12h",
) {
    const out: Record<string, IndicatorBar[]> = {};
    for (const [symbol, rawBars] of Object.entries(bySymbol)) {
        const bars = timeframe === "1d"
            ? resampleTo1d(rawBars)
            : timeframe === "6h"
                ? resampleToHours(rawBars, 6)
                : timeframe === "4h"
                    ? resampleToHours(rawBars, 4)
                    : resampleTo12h(rawBars);
        out[symbol] = buildIndicatorBars(bars);
    }
    return out;
}

function uniqueSymbols(symbols: readonly string[]) {
    return [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
}

function latestIndicatorIndexAtOrBefore(bars: IndicatorBar[], ts: number) {
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
    return best;
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
    const activeOverride = activeTrendWindowOverrideForSymbol(symbol, ts, options);
    if (activeOverride?.breakoutLookbackBars != null) return activeOverride.breakoutLookbackBars;
    return symbolOverrideNumber(options.trendBreakoutLookbackBarsBySymbol, symbol, options.trendBreakoutLookbackBars);
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
        const mom20Threshold = idleCashContext && options.idleCashTrendMinMom20 != null
            ? options.idleCashTrendMinMom20
            : 0;
        const baseEligible = bar.close > baseSma && bar.mom20 > mom20Threshold;
        const solOk = symbol !== "SOL" || bar.overheatPct <= 0.35;
        const avaxOk = symbol !== "AVAX" || (bar.mom20 > 0.25 && bar.volume > bar.volAvg20);
        const breakoutLookback = trendBreakoutLookbackForSymbol(symbol, snapshot.ts, options);
        const breakoutMinPct = trendBreakoutMinPctForSymbol(symbol, snapshot.ts, options) ?? 0;
        const breakoutOk = breakoutLookback == null || idx - breakoutLookback < 0
            ? true
            : bar.close > Math.max(...series.slice(idx - breakoutLookback, idx).map((item) => item.close)) * (1 + breakoutMinPct);
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
        const preWeakEligible = trendGateSatisfied && baseEligible && solOk && avaxOk && breakoutOk && volumeOk && accelOk && efficiencyOk;
        const eligible = preWeakEligible && weakGateOk;
        const distanceFromSmaPct = baseSma > 0 ? ((bar.close / baseSma) - 1) * 100 : 0;
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
            baseEligible ? "close>sma40" : "close<=sma40",
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
        reasons.push(snapshot.weak2022Regime ? (weakGateOk ? "retq22-pass" : "retq22-block") : "retq22-off");

        evaluations.push({
            symbol,
            eligible,
            score,
            reasons,
            close: bar.close,
            sma40: baseSma,
            mom20: bar.mom20,
            momAccel: bar.momAccel,
            adx14: bar.adx14,
            overheatPct: bar.overheatPct,
            volumeRatio,
            efficiencyRatio,
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
        const mom20Threshold = idleCashContext && options.idleCashTrendMinMom20 != null
            ? options.idleCashTrendMinMom20
            : 0;
        const baseEligible = bar.close > baseSma && bar.mom20 > mom20Threshold;
        const solOk = symbol !== "SOL" || bar.overheatPct <= 0.35;
        const avaxOk = symbol !== "AVAX" || (bar.mom20 > 0.25 && bar.volume > bar.volAvg20);
        const breakoutLookback = trendBreakoutLookbackForSymbol(symbol, snapshot.ts, options);
        const breakoutMinPct = trendBreakoutMinPctForSymbol(symbol, snapshot.ts, options) ?? 0;
        const breakoutOk = breakoutLookback == null || idx - breakoutLookback < 0
            ? true
            : bar.close > Math.max(...series.slice(idx - breakoutLookback, idx).map((item) => item.close)) * (1 + breakoutMinPct);
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
        const preWeakEligible = trendGateSatisfied && baseEligible && solOk && avaxOk && breakoutOk && volumeOk && accelOk && efficiencyOk;
        const eligible = preWeakEligible && weakGateOk;
        const distanceFromSmaPct = baseSma > 0 ? ((bar.close / baseSma) - 1) * 100 : 0;
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
            baseEligible ? "close>sma40" : "close<=sma40",
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
        reasons.push(snapshot.weak2022Regime ? (weakGateOk ? "retq22-pass" : "retq22-block") : "retq22-off");

        evaluations.push({
            symbol,
            eligible,
            score,
            reasons,
            close: bar.close,
            sma40: baseSma,
            mom20: bar.mom20,
            momAccel: bar.momAccel,
            adx14: bar.adx14,
            overheatPct: bar.overheatPct,
            volumeRatio,
            efficiencyRatio,
        });
    }

    return evaluations.sort((left, right) => right.score - left.score || right.mom20 - left.mom20 || left.symbol.localeCompare(right.symbol));
}

function isTrendSymbolBlocked(symbol: string | null, ts: number, options: HybridVariantOptions = {}) {
    if (!symbol) return false;
    const windows = options.trendSymbolBlockWindows?.[symbol.toUpperCase()];
    if (!windows?.length) return false;
    return windows.some((window) => ts >= window.startTs && ts <= window.endTs);
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
    return position.entryStrategy === "idle-breakout";
}

function shouldAllowStrictExtraRotation(
    position: PositionState,
    currentEval: HybridTrendSymbolDecision | null,
    extraCandidate: ReturnType<typeof pickStrictExtraTrendCandidate> | null,
    executionIndex: number,
    options: HybridVariantOptions = {},
) {
    if (!options.strictExtraTrendRotationWhileHolding) return false;
    if (position.side !== "trend" || !position.symbol || isStrictExtraTrendSymbol(position.symbol, options)) return false;
    if (!currentEval || !extraCandidate?.eligible || !extraCandidate.symbol) return false;
    if (extraCandidate.symbol === position.symbol) return false;

    const scoreGap = extraCandidate.score - currentEval.score;
    const requiredGap = strictExtraRotationScoreGapForSymbol(extraCandidate.symbol, options);
    if (scoreGap < requiredGap) return false;

    const currentMomAccelMax = options.strictExtraTrendRotationCurrentMomAccelMax ?? 0;
    if (currentEval.momAccel > currentMomAccelMax) return false;

    if (
        options.strictExtraTrendRotationCurrentMom20Max != null
        && currentEval.mom20 > options.strictExtraTrendRotationCurrentMom20Max
    ) {
        return false;
    }

    const minHoldBars = options.strictExtraTrendRotationMinHoldBars ?? 1;
    if (position.entryIndex >= 0 && executionIndex - position.entryIndex < minHoldBars) return false;

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
    executionIndex: number,
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
    if (position.entryIndex >= 0 && executionIndex - position.entryIndex < minHoldBars) return false;

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
    ).filter((item) => !isTrendSymbolBlocked(item.symbol, snapshot.ts, options));
    const prioritySymbols = options.trendPrioritySymbols ?? [];
    const priorityPick = prioritySymbols
        .map((symbol) => evaluations.find((item) => item.symbol === symbol && item.eligible))
        .find(Boolean);
    const top = evaluations.find((item) => item.eligible);
    const priorityGapOk = priorityPick && top
        ? options.trendPriorityMaxScoreGap == null || (top.score - priorityPick.score) <= options.trendPriorityMaxScoreGap
        : Boolean(priorityPick);
    if (priorityPick && priorityGapOk) {
        return {
            symbol: priorityPick.symbol,
            bar: latestIndicatorAtOrBefore(indicators[priorityPick.symbol], snapshot.ts)!,
            eligible: priorityPick.eligible,
            score: priorityPick.score,
            reasons: [...priorityPick.reasons, "priority-pick"],
        };
    }
    if (!top) return null;

    return {
        symbol: top.symbol,
        bar: latestIndicatorAtOrBefore(indicators[top.symbol], snapshot.ts)!,
        eligible: top.eligible,
        score: top.score,
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
    ).filter((item) => !isTrendSymbolBlocked(item.symbol, snapshot.ts, options));
    const top = evaluations.find((item) => item.eligible);
    if (!top) return null;

    return {
        symbol: top.symbol,
        bar: latestIndicatorAtOrBefore(indicators[top.symbol], snapshot.ts)!,
        eligible: top.eligible,
        score: top.score,
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
        .filter((item) => !isTrendSymbolBlocked(item.symbol, snapshot.ts, options))
        .find((item) => item.eligible);
    if (!top) return null;

    return {
        symbol: top.symbol,
        bar: latestIndicatorAtOrBefore(indicators[top.symbol], snapshot.ts)!,
        eligible: top.eligible,
        score: top.score,
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
        entryStrategy: null,
        entryReason: "",
        lotId: "",
        entryAlloc: 0,
        rangeExitMom20Above: null,
        rangeMaxHoldBars: null,
        peakPrice: 0,
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
    entryIndex = -1,
    currentIndex = -1,
    persistentWeak2022Regime = false,
    options: HybridVariantOptions = {},
) {
    if (side === "trend") {
        if (!snapshot.trendAllowed) return "risk-off";
        if (
            isSymbolSpecificWeakExitTarget(position.symbol, options)
            && options.symbolSpecificTrendWeakExitMom20Below != null
            && options.symbolSpecificTrendWeakExitMomAccelBelow != null
            && current.mom20 <= options.symbolSpecificTrendWeakExitMom20Below
            && current.momAccel <= options.symbolSpecificTrendWeakExitMomAccelBelow
        ) {
            return "symbol-weak-exit";
        }
        const trendExitSma = options.trendExitSma ?? 45;
        if (trendExitSma === 40 && current.close <= current.sma40) return "sma40-break";
        if (trendExitSma === 45 && current.close <= current.sma45) return "sma-break";

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
        if (entryIndex >= 0 && currentIndex >= 0 && currentIndex - entryIndex >= (position.rangeMaxHoldBars ?? options.rangeMaxHoldBars ?? 16)) return "range-time";
    }

    return null;
}

async function loadInstrumentFrames(input?: {
    startTs?: number;
    endTs?: number;
    timeframe?: NonNullable<HybridVariantOptions["trendDecisionTimeframe"]> | NonNullable<HybridVariantOptions["trendExitCheckTimeframe"]>;
    symbols?: readonly string[];
    extraSymbols?: readonly string[];
}) {
    if (input?.symbols?.length) {
        const symbols = uniqueSymbols(input.symbols);
        const { bySymbol } = await loadRawSeriesForUniverse(symbols, input);
        const indicators = buildIndicatorsForUniverseByTimeframe(bySymbol, input?.timeframe ?? "12h");
        const timeline = indicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts);
        return { bySymbol, indicators, timeline };
    }

    if (input?.extraSymbols?.length) {
        const symbols = uniqueSymbols([...ALL_SYMBOLS, ...input.extraSymbols]);
        const { bySymbol } = await loadRawSeriesForUniverse(symbols, input);
        const indicators = buildIndicatorsForUniverseByTimeframe(bySymbol, input?.timeframe ?? "12h");
        const timeline = indicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts);
        return { bySymbol, indicators, timeline };
    }

    const { bySymbol } = await loadRawSeries(input);
    const indicators = buildIndicatorsByTimeframe(bySymbol, input?.timeframe ?? "12h");
    const timeline = indicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts);
    return { bySymbol, indicators, timeline };
}

function liveUniverseExtraSymbols(options: HybridVariantOptions = {}) {
    return uniqueSymbols([
        ...(options.expandedTrendSymbols ?? []),
        ...(options.strictExtraTrendSymbols ?? []),
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

function getExecutionBar(raw: Candle1h[], ts: number) {
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
    return best >= 0 ? raw[best] : null;
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
        holding_bars: Math.max(1, exitIndex - position.entryIndex),
        entry_reason: position.entryReason,
        exit_reason: exitReason,
    });
    position.side = null;
    position.symbol = null;
    position.qty = 0;
    position.entryPrice = 0;
    position.entryTs = 0;
    position.entryIndex = -1;
    position.entryStrategy = null;
    position.entryReason = "";
    position.lotId = "";
    position.entryAlloc = 0;
    position.rangeExitMom20Above = null;
    position.rangeMaxHoldBars = null;
    position.peakPrice = 0;
    return cash;
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
    },
) {
    const alloc = entryMeta?.alloc ?? (side === "trend" ? trendAllocForSymbol(symbol, options) : tradeAllocForSide(side, options));
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
    position.entryStrategy = (entryMeta?.subVariant as PositionState["entryStrategy"]) || side;
    position.entryReason = entryReason;
    position.lotId = tradeId;
    position.entryAlloc = alloc;
    position.rangeExitMom20Above = entryMeta?.rangeExitMom20Above ?? null;
    position.rangeMaxHoldBars = entryMeta?.rangeMaxHoldBars ?? null;
    position.peakPrice = entryPrice;
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

export async function evaluateHybridLiveDecision(
    mode: BacktestMode = "RETQ22",
    options: HybridVariantOptions = {},
): Promise<HybridLiveDecision | null> {
    const { indicators, timeline } = await loadInstrumentFrames({
        endTs: Date.now(),
        symbols: liveUniverseSymbols(options),
    });
    const ts = timeline.at(-1);
    if (!ts) return null;

    const previousTs = timeline.length > 1 ? timeline[timeline.length - 2] : null;
    const snapshot = buildRegimeSnapshot(ts, indicators);
    if (!snapshot) return null;

    const previousSnapshot = previousTs != null ? buildRegimeSnapshot(previousTs, indicators) : null;
    const effectiveSnapshot = applyVariantSnapshot(snapshot, Boolean(previousSnapshot?.weak2022Regime), mode, options);
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

export async function evaluateHybridLiveDecisionDetails(
    mode: BacktestMode = "RETQ22",
    options: HybridVariantOptions = {},
): Promise<HybridLiveDecisionDetails | null> {
    const { indicators, timeline } = await loadInstrumentFrames({
        endTs: Date.now(),
        symbols: liveUniverseSymbols(options),
    });
    const ts = timeline.at(-1);
    if (!ts) return null;

    const previousTs = timeline.length > 1 ? timeline[timeline.length - 2] : null;
    const snapshot = buildRegimeSnapshot(ts, indicators);
    if (!snapshot) return null;

    const previousSnapshot = previousTs != null ? buildRegimeSnapshot(previousTs, indicators) : null;
    const effectiveSnapshot = applyVariantSnapshot(snapshot, Boolean(previousSnapshot?.weak2022Regime), mode, options);
    const decision = await evaluateHybridLiveDecision(mode, options);
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
    const exitCheckTimeframe = options.trendExitCheckTimeframe ?? decisionTimeframe;
    const strictExtraTrendSymbols = uniqueSymbols(options.strictExtraTrendSymbols ?? []);
    const strictExtraDecisionTimeframe = options.strictExtraTrendDecisionTimeframe ?? decisionTimeframe;
    const strictExtraExitCheckTimeframe = options.strictExtraTrendExitCheckTimeframe ?? exitCheckTimeframe;
    const idleBreakoutTimeframe = options.idleBreakoutEntryTimeframe ?? "6h";
    const extraUniverseSymbols = uniqueSymbols([
        ...strictExtraTrendSymbols,
        ...(options.expandedTrendSymbols ?? []),
        ...(options.idleBreakoutSymbols ?? []),
    ]);
    const strictUniverseSymbols = extraUniverseSymbols.length
        ? uniqueSymbols([...ALL_SYMBOLS, ...extraUniverseSymbols])
        : null;
    const backtestStartTs = options.backtestStartTs;
    const backtestEndTs = options.backtestEndTs;
    const loaded = strictUniverseSymbols
        ? await loadRawSeriesForUniverse(strictUniverseSymbols, { startTs: backtestStartTs, endTs: backtestEndTs })
        : null;
    const bySymbol: Record<string, Candle1h[]> = loaded?.bySymbol
        ?? (await loadInstrumentFrames({ startTs: backtestStartTs, endTs: backtestEndTs, timeframe: decisionTimeframe })).bySymbol;
    const indicators: Record<string, IndicatorBar[]> = loaded
        ? buildIndicatorsForUniverseByTimeframe(bySymbol, decisionTimeframe)
        : buildIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, decisionTimeframe);
    const timeline = indicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts);
    const exitIndicators = exitCheckTimeframe === decisionTimeframe
        ? indicators
        : strictUniverseSymbols
            ? buildIndicatorsForUniverseByTimeframe(bySymbol, exitCheckTimeframe)
            : buildIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, exitCheckTimeframe);
    const strictExtraDecisionIndicators = strictExtraTrendSymbols.length && strictExtraDecisionTimeframe !== decisionTimeframe
        ? (strictUniverseSymbols
            ? buildIndicatorsForUniverseByTimeframe(bySymbol, strictExtraDecisionTimeframe)
            : buildIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, strictExtraDecisionTimeframe))
        : indicators;
    const strictExtraExitIndicators = strictExtraTrendSymbols.length && strictExtraExitCheckTimeframe !== exitCheckTimeframe
        ? (strictUniverseSymbols
            ? buildIndicatorsForUniverseByTimeframe(bySymbol, strictExtraExitCheckTimeframe)
            : buildIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, strictExtraExitCheckTimeframe))
        : exitIndicators;
    const exitTimeline = exitCheckTimeframe === decisionTimeframe
        ? timeline
        : exitIndicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts);
    const strictExtraDecisionTimeline = strictExtraTrendSymbols.length
        ? strictExtraDecisionIndicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts)
        : timeline;
    const strictExtraExitTimeline = strictExtraTrendSymbols.length
        ? strictExtraExitIndicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts)
        : exitTimeline;
    const idleBreakoutIndicators = options.idleBreakoutEntryWhileCash && idleBreakoutTimeframe !== decisionTimeframe
        ? (strictUniverseSymbols
            ? buildIndicatorsForUniverseByTimeframe(bySymbol, idleBreakoutTimeframe)
            : buildIndicatorsByTimeframe(bySymbol as Record<TradeSymbol, Candle1h[]>, idleBreakoutTimeframe))
        : indicators;
    const idleBreakoutTimeline = options.idleBreakoutEntryWhileCash
        ? idleBreakoutIndicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts)
        : [];
    const loopTimeline = [...new Set([...exitTimeline, ...strictExtraExitTimeline, ...strictExtraDecisionTimeline])]
        .sort((left, right) => left - right);
    const mergedLoopTimeline = options.idleBreakoutEntryWhileCash
        ? [...new Set([...loopTimeline, ...idleBreakoutTimeline])].sort((left, right) => left - right)
        : loopTimeline;
    const decisionIndexByTs = new Map(timeline.map((ts, index) => [ts, index]));
    const strictExtraDecisionSet = new Set(strictExtraDecisionTimeline);
    const strictExtraExitSet = new Set(strictExtraExitTimeline);
    const tradeEvents: TradeEventRow[] = [];
    const tradePairs: TradePairRow[] = [];
    const equityCurve: EquityPoint[] = [];
    const monthlyBuckets = new Map<string, EquityPoint[]>();
    const annualBuckets = new Map<string, EquityPoint[]>();
    const position = createEmptyPosition();
    let cash = BASE_EQUITY;
    let tradeCount = 0;
    let highWaterMark = BASE_EQUITY;
    let lastTrendCandidate: string | null = null;
    let trendLeadSymbol: string | null = null;
    let trendLeadCount = 0;
    let strictExtraLeadSymbol: string | null = null;
    let strictExtraLeadCount = 0;
    let priorWeak2022Regime = false;
    const activeYears = options.activeYears ? new Set(options.activeYears) : null;

    const idleBreakoutDecisionSet = new Set(idleBreakoutTimeline);

    for (let index = 0; index < mergedLoopTimeline.length; index += 1) {
        const ts = mergedLoopTimeline[index];
        if (activeYears && !activeYears.has(new Date(ts).getUTCFullYear())) {
            continue;
        }
        const snapshot = buildRegimeSnapshot(ts, indicators as Record<TradeSymbol, IndicatorBar[]>);
        if (!snapshot) continue;
        const persistentWeak2022Regime = snapshot.weak2022Regime && priorWeak2022Regime;
        const effectiveSnapshot = applyVariantSnapshot(snapshot, priorWeak2022Regime, mode, options);
        const rangeSymbols = options.rangeSymbols ?? RANGE_SYMBOLS;
        const isStrictExtraDecisionBar = strictExtraDecisionSet.has(ts);
        const isStrictExtraExitBar = strictExtraExitSet.has(ts);

        const currentBars = Object.fromEntries(
            Object.keys(exitIndicators).map((symbol) => [symbol, latestIndicatorAtOrBefore((exitIndicators as Record<string, IndicatorBar[]>)[symbol], ts)]),
        ) as Record<string, IndicatorBar | null>;
        const decisionIndex = decisionIndexByTs.get(ts);
        const isDecisionBar = decisionIndex != null;
        const isIdleBreakoutDecisionBar = idleBreakoutDecisionSet.has(ts);
        const rebalance = isDecisionBar && decisionIndex % REBALANCE_BARS === 0;
        const executionIndex = index;

        const execRaw = Object.fromEntries(
            Object.keys(bySymbol).map((symbol) => [symbol, currentPriceAt(bySymbol[symbol], ts)]),
        ) as Record<string, Candle1h | null>;
        const currentPositionRaw = position.symbol ? execRaw[position.symbol] : null;
        const markPrice = position.symbol ? (currentPositionRaw?.open || position.entryPrice) : 0;
        const equity = markToMarket(position.qty, markPrice, cash, baselinePreset.feeRate);
        highWaterMark = Math.max(highWaterMark, equity);
        const drawdownPct = highWaterMark > 0 ? ((equity / highWaterMark) - 1) * 100 : 0;
        if (position.side && position.symbol && currentPositionRaw) {
            position.peakPrice = Math.max(position.peakPrice || position.entryPrice, currentPositionRaw.high || currentPositionRaw.close || position.entryPrice);
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

        const tradeReady = mode === "BASELINE"
            ? effectiveSnapshot.trendAllowed
            : effectiveSnapshot.trendAllowed || effectiveSnapshot.rangeAllowed;

        if (position.side) {
            const currentBar = position.symbol
                ? (
                    isStrictExtraTrendSymbol(position.symbol, options) && isStrictExtraExitBar
                        ? latestIndicatorAtOrBefore((strictExtraExitIndicators as Record<string, IndicatorBar[]>)[position.symbol], ts)
                        : currentBars[position.symbol]
                )
                : null;
            if (currentBar) {
                const exitReason = buildExitReason(
                    effectiveSnapshot,
                    currentBar,
                    position,
                    mode,
                    position.side,
                    position.entryIndex,
                    executionIndex,
                    persistentWeak2022Regime,
                    options,
                );
                const strictExtraTrailActivationPct = options.strictExtraTrendTrailActivationPct ?? null;
                const strictExtraTrailRetracePct = options.strictExtraTrendTrailRetracePct ?? null;
                const trendTrailActivationPct = options.trendProfitTrailActivationPct ?? null;
                const trendTrailRetracePct = options.trendProfitTrailRetracePct ?? null;
                const idleBreakoutTrailActivationPct = options.idleBreakoutProfitTrailActivationPct ?? null;
                const idleBreakoutTrailRetracePct = options.idleBreakoutProfitTrailRetracePct ?? null;
                const idleBreakoutMaxHoldBars = options.idleBreakoutMaxHoldBars ?? null;
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
                    position.entryIndex >= 0 &&
                    executionIndex - position.entryIndex >= idleBreakoutMaxHoldBars;
                const strictExtraHardStopLossPct = options.strictExtraTrendHardStopLossPct ?? null;
                const strictExtraMaxHoldBars = options.strictExtraTrendMaxHoldBars ?? null;
                const trendTrailingExit =
                    position.symbol &&
                    !isStrictExtraTrendSymbol(position.symbol, options) &&
                    currentPositionRaw &&
                    trendTrailActivationPct != null &&
                    trendTrailRetracePct != null &&
                    position.peakPrice >= position.entryPrice * (1 + trendTrailActivationPct) &&
                    currentPositionRaw.close <= position.peakPrice * (1 - trendTrailRetracePct);
                const strictExtraTrailingExit =
                    position.symbol &&
                    isStrictExtraTrendSymbol(position.symbol, options) &&
                    currentPositionRaw &&
                    strictExtraTrailActivationPct != null &&
                    strictExtraTrailRetracePct != null &&
                    position.peakPrice >= position.entryPrice * (1 + strictExtraTrailActivationPct) &&
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
                    position.entryIndex >= 0 &&
                    executionIndex - position.entryIndex >= strictExtraMaxHoldBars;
                const ddExit = mode === "RETQ22" && position.side === "trend" && effectiveSnapshot.weak2022Regime && snapshot.regimeLabel === "trend_weak" && drawdownPct <= -22;
                if (exitReason || ddExit || idleBreakoutTrailingExit || idleBreakoutTimeExit || trendTrailingExit || strictExtraTrailingExit || strictExtraHardStopExit || strictExtraTimeExit) {
                    const price = currentPositionRaw?.open || position.entryPrice;
                    cash = exitPosition(
                        position,
                        price,
                        ts,
                        executionIndex,
                        idleBreakoutTrailingExit
                            ? "idle-breakout-trailing"
                            : idleBreakoutTimeExit
                                ? "idle-breakout-time"
                        : trendTrailingExit
                            ? "trend-profit-trailing"
                            : strictExtraTrailingExit
                            ? "strict-extra-trailing"
                            : strictExtraHardStopExit
                                ? "strict-extra-hard-stop"
                                : strictExtraTimeExit
                                    ? "strict-extra-time"
                                    : (exitReason || "dd22-balanced"),
                        cash,
                        tradeEvents,
                        tradePairs,
                        baselinePreset.feeRate,
                        options,
                    );
                }
            }
        }

        let trendCandidate = null as ReturnType<typeof pickTrendCandidate> | null;
        let rangeCandidate = null as ReturnType<typeof pickAnnotatedRangeCandidate> | null;
        let trendRotationCandidate = null as ReturnType<typeof pickTrendCandidate> | null;
        let strictExtraRotationCandidate = null as ReturnType<typeof pickStrictExtraTrendCandidate> | null;
        if (tradeReady && (isDecisionBar || isStrictExtraDecisionBar)) {
            const baseTrendOptions = options.strictExtraTrendIdleOnly
                ? { ...options, strictExtraTrendSymbols: undefined }
                : options;
            const trendEntryOptions = !position.side
                ? withIdleCashTrendOverrides(baseTrendOptions)
                : baseTrendOptions;
            trendCandidate = (options.disableTrend || !isDecisionBar) ? null : pickTrendCandidate(effectiveSnapshot, indicators, mode, trendEntryOptions);
            if (mode === "RETQ22" && isDecisionBar) {
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
                    trendBreakoutLookbackBars: options.idleBreakoutBreakoutLookbackBars ?? options.trendBreakoutLookbackBars,
                    trendBreakoutMinPct: options.idleBreakoutBreakoutMinPct ?? options.trendBreakoutMinPct,
                    trendMinVolumeRatio: options.idleBreakoutMinVolumeRatio ?? options.trendMinVolumeRatio,
                    trendMinMomAccel: options.idleBreakoutMinMomAccel ?? options.trendMinMomAccel,
                    trendMinEfficiencyRatio: options.idleBreakoutMinEfficiencyRatio ?? options.trendMinEfficiencyRatio,
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
                options.strictExtraTrendIdleOnly &&
                !trendCandidate?.eligible &&
                !rangeCandidate?.eligible &&
                !options.disableTrend &&
                isStrictExtraDecisionBar
            ) {
                trendCandidate = pickStrictExtraTrendCandidate(
                    effectiveSnapshot,
                    strictExtraDecisionIndicators as Record<string, IndicatorBar[]>,
                    strictExtraDecisionOptions(options),
                );
            }

            trendCandidate = maybePreferStrictExtraTrendCandidate(
                effectiveSnapshot,
                indicators,
                trendCandidate,
                options,
                strictExtraDecisionIndicators as Record<string, IndicatorBar[]>,
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
                        executionIndex,
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
                        executionIndex,
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

        let rotatedToTrend = false;
        if (
            trendRotationCandidate?.eligible &&
            position.side === "trend" &&
            position.symbol &&
            position.symbol !== trendRotationCandidate.symbol
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
            position.symbol !== strictExtraRotationCandidate.symbol
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

        if (rebalance) {
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
                if (!rotatedToTrend && !rotatedToStrictExtra && position.side === "trend" && trendCandidate?.eligible && position.symbol !== trendCandidate.symbol) {
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

                if (!position.side) {
                    const trendAllowed = trendCandidate?.eligible;
                    if (trendAllowed && trendCandidate) {
                        const isIdleBreakoutTrendEntry = trendCandidate.reasons.includes("idle-breakout-entry");
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
                                isIdleBreakoutTrendEntry
                                    ? {
                                        subVariant: "idle-breakout",
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
            isIdleBreakoutDecisionBar &&
            trendCandidate?.eligible &&
            trendCandidate.reasons.includes("idle-breakout-entry")
        ) {
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
                        subVariant: "idle-breakout",
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
                    position.entryIndex,
                    index,
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
        holding_bars: Math.max(1, exitIndex - lot.entryIndex),
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
                lot.entryIndex,
                index,
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
                    position.entryIndex,
                    current12hIndex,
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
                    position.entryIndex,
                    index,
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
                .filter((item) => !isTrendSymbolBlocked(item.symbol, ts, options))
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
