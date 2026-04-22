import * as fs from "fs/promises";
import * as path from "path";

import { selectStrategyPreset } from "@/config/strategyMode";
import { loadHistoricalCandles } from "@/lib/backtest/binance-source";
import { buildIndicatorBars, latestIndicatorAtOrBefore, resampleTo12h } from "@/lib/backtest/indicators";
import type {
    Candle1h,
    EquityPoint,
    IndicatorBar,
    PeriodReturnRow,
    PositionState,
    RegimeSnapshot,
    TradeEventRow,
    TradePairRow,
} from "@/lib/backtest/types";

type TradeSymbol = "BTC" | "ETH" | "SOL" | "AVAX" | "BNB" | "LINK";
type Side = "trend" | "range";
type Signal = {
    side: Side;
    symbol: Exclude<TradeSymbol, "BTC">;
    subVariant: string;
    reason: string[];
};

type StrategyResult = {
    name: string;
    label: string;
    trade_events: TradeEventRow[];
    trade_pairs: TradePairRow[];
    equity_curve: EquityPoint[];
    annual_returns: PeriodReturnRow[];
    monthly_returns: PeriodReturnRow[];
    summary: {
        name: string;
        start_equity: number;
        end_equity: number;
        cagr_pct: number;
        max_drawdown_pct: number;
        win_rate_pct: number;
        profit_factor: number;
        trade_count: number;
        exposure_pct: number;
        annual_returns: PeriodReturnRow[];
        monthly_returns: PeriodReturnRow[];
        symbol_contribution: Record<string, number>;
    };
};

type StrategyContext = {
    ts: number;
    index: number;
    snapshot: RegimeSnapshot;
    indicators: Record<TradeSymbol, IndicatorBar[]>;
    currentBars: Record<TradeSymbol, IndicatorBar>;
    execRaw: Record<TradeSymbol, Candle1h | null>;
    position: PositionState;
    priorWeak2022Regime: boolean;
    trendCandidate: ReturnType<typeof topTrendCandidate>;
};

type StrategyLogic = {
    name: string;
    label: string;
    selectSignal: (ctx: StrategyContext) => Signal | null;
    selectExitReason: (ctx: StrategyContext) => string | null;
};

const BASE_EQUITY = 10_000;
const REBALANCE_BARS = 11;
const ALL_SYMBOLS: TradeSymbol[] = ["BTC", "ETH", "SOL", "AVAX", "BNB", "LINK"];
const TRADE_SYMBOLS: Exclude<TradeSymbol, "BTC">[] = ["ETH", "SOL", "AVAX", "BNB", "LINK"];
const ETH_ONLY: Exclude<TradeSymbol, "BTC">[] = ["ETH"];
const ETH_SOL: Exclude<TradeSymbol, "BTC">[] = ["ETH", "SOL"];
const ETH_BNB: Exclude<TradeSymbol, "BTC">[] = ["ETH", "BNB"];
const ETH_BNB_LINK: Exclude<TradeSymbol, "BTC">[] = ["ETH", "BNB", "LINK"];
const NO_BNB_SYMBOLS: Exclude<TradeSymbol, "BTC">[] = ["ETH", "SOL", "AVAX", "LINK"];
const ETH_LINK: Exclude<TradeSymbol, "BTC">[] = ["ETH", "LINK"];
const LEGACY_BASELINE_SYMBOLS: Exclude<TradeSymbol, "BTC">[] = ["ETH", "SOL", "AVAX"];

const LOCAL_ZIP_PATHS: Record<TradeSymbol, string | null> = {
    BTC: path.join("C:\\Users\\dis\\Desktop", "2022BTC.zip"),
    ETH: path.join("C:\\Users\\dis\\Desktop", "2022ETH.zip"),
    SOL: path.join("C:\\Users\\dis\\Desktop", "2022SOL.zip"),
    AVAX: null,
    BNB: null,
    LINK: null,
};

function average(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sum(values: number[]) {
    return values.reduce((total, value) => total + value, 0);
}

function formatIso(ts: number) {
    return new Date(ts).toISOString();
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

function findSeriesIndex(series: IndicatorBar[], ts: number) {
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

function feeRate() {
    return selectStrategyPreset("A_BALANCE").feeRate;
}

async function loadSeries() {
    const startTs = Date.UTC(2022, 0, 1, 0, 0, 0);
    const endTs = Date.UTC(2026, 0, 1, 0, 0, 0) - 1;
    const cacheRoot = path.join(process.cwd(), ".cache", "strategy-suite");
    const bySymbol = {} as Record<TradeSymbol, Candle1h[]>;
    for (const symbol of ALL_SYMBOLS) {
        const candles = await loadHistoricalCandles({
            symbol: `${symbol}USDT`,
            localZipPath: LOCAL_ZIP_PATHS[symbol] || undefined,
            cacheRoot,
            startMs: startTs,
            endMs: endTs,
        });
        bySymbol[symbol] = candles;
    }
    const indicators = {} as Record<TradeSymbol, IndicatorBar[]>;
    for (const symbol of ALL_SYMBOLS) {
        indicators[symbol] = buildIndicatorBars(resampleTo12h(bySymbol[symbol]));
    }
    const timeline = indicators.BTC.filter((bar) => bar.ready).map((bar) => bar.ts);
    return { bySymbol, indicators, timeline };
}

function buildRegimeSnapshot(ts: number, indicators: Record<TradeSymbol, IndicatorBar[]>) {
    const btc = latestIndicatorAtOrBefore(indicators.BTC, ts);
    const eth = latestIndicatorAtOrBefore(indicators.ETH, ts);
    const sol = latestIndicatorAtOrBefore(indicators.SOL, ts);
    const avax = latestIndicatorAtOrBefore(indicators.AVAX, ts);
    const bnb = latestIndicatorAtOrBefore(indicators.BNB, ts);
    const link = latestIndicatorAtOrBefore(indicators.LINK, ts);
    if (!btc || !eth || !sol || !avax || !bnb || !link || !btc.ready || !eth.ready || !sol.ready || !avax.ready || !bnb.ready || !link.ready) return null;

    const tradeBars = [eth, sol, avax, bnb, link];
    const breadth40 = tradeBars.filter((bar) => bar.close > bar.sma40).length;
    const breadth45 = tradeBars.filter((bar) => bar.close > bar.sma45).length;
    const core2_45 = [eth, sol].filter((bar) => bar.close > bar.sma45).length;
    const core3_45 = [eth, bnb, link].filter((bar) => bar.close > bar.sma45).length;
    const best = [...tradeBars].sort((left, right) => right.mom20 - left.mom20 || right.close - left.close)[0];
    const bestMom20 = best?.mom20 || 0;
    const bestMomAccel = best?.momAccel || 0;
    const avgMom20EthSol = (eth.mom20 + sol.mom20) / 2;
    const avgMom20Core3 = (eth.mom20 + bnb.mom20 + link.mom20) / 3;
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
    };
}

function nextTradeId(name: string, counter: number) {
    return `${name.toLowerCase()}-${String(counter + 1).padStart(4, "0")}`;
}

function tradeAllocForSide(side: NonNullable<PositionState["side"]>) {
    return side === "range" ? 0.5 : 1.0;
}

function enterPosition(
    position: PositionState,
    side: NonNullable<PositionState["side"]>,
    symbol: Exclude<TradeSymbol, "BTC">,
    entryPrice: number,
    entryTs: number,
    entryIndex: number,
    entryReason: string,
    tradeEvents: TradeEventRow[],
    tradeId: string,
    cash: number,
    feeRateValue: number,
) {
    const alloc = tradeAllocForSide(side);
    const notional = cash * alloc;
    const targetQty = notional / entryPrice;
    const rule = {
        ETH: { stepSize: 0.001, minQty: 0.001, minNotional: 10 },
        SOL: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
        AVAX: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
        BNB: { stepSize: 0.001, minQty: 0.001, minNotional: 10 },
        LINK: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
    }[symbol];
    const qty = stepRound(targetQty, rule.stepSize);
    const entryNotional = qty * entryPrice;
    if (!Number.isFinite(qty) || qty <= 0 || entryNotional < rule.minNotional || qty < rule.minQty) {
        return { cash, opened: false };
    }
    cash -= entryNotional * (1 + feeRateValue);
    position.side = side;
    position.symbol = symbol;
    position.qty = qty;
    position.entryPrice = entryPrice;
    position.entryTs = entryTs;
    position.entryIndex = entryIndex;
    position.entryStrategy = side;
    position.entryReason = entryReason;
    position.lotId = tradeId;
    tradeEvents.push({
        time: formatIso(entryTs),
        symbol,
        action: "enter",
        strategy_type: side,
        sub_variant: side === "trend" ? "trend" : "range",
        alloc,
        price: entryPrice,
        qty,
        reason: entryReason,
        trade_id: tradeId,
    });
    return { cash, opened: true };
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
    feeRateValue: number,
) {
    if (!position.side || !position.symbol || position.qty <= 0) return cash;
    const grossProceeds = position.qty * exitPrice;
    const grossPnl = grossProceeds - (position.qty * position.entryPrice);
    const fee = (position.qty * position.entryPrice * feeRateValue) + (grossProceeds * feeRateValue);
    const netPnl = grossPnl - fee;
    cash += grossProceeds * (1 - feeRateValue);
    tradeEvents.push({
        time: formatIso(exitTs),
        symbol: position.symbol,
        action: "exit",
        strategy_type: position.side,
        sub_variant: position.entryStrategy || "trend",
        alloc: tradeAllocForSide(position.side),
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
    return cash;
}

function topTrendCandidate(snapshot: RegimeSnapshot, indicators: Record<TradeSymbol, IndicatorBar[]>) {
    return topTrendCandidateFromSymbols(snapshot, indicators, TRADE_SYMBOLS);
}

function topTrendCandidateLegacyBaseline(
    snapshot: RegimeSnapshot,
    indicators: Record<TradeSymbol, IndicatorBar[]>,
) {
    const bars = LEGACY_BASELINE_SYMBOLS.map((symbol) => {
        const bar = latestIndicatorAtOrBefore(indicators[symbol], snapshot.ts);
        if (!bar || !bar.ready) return null;
        const baseEligible = bar.close > bar.sma40 && bar.mom20 > 0;
        const solOk = symbol !== "SOL" || bar.overheatPct <= 0.35;
        const avaxOk = symbol !== "AVAX" || (bar.mom20 > 0.25 && bar.volume > bar.volAvg20);
        const eligible = snapshot.trendAllowed && baseEligible && solOk && avaxOk;
        const score = (bar.mom20 * 100) + ((bar.close / Math.max(1, bar.sma40)) - 1) * 100 + (bar.adx14 / 5);
        const reasons = [
            baseEligible ? "close>sma40" : "close<=sma40",
            bar.mom20 > 0 ? "mom20-ok" : "mom20-low",
        ];
        if (symbol === "SOL") reasons.push(solOk ? "sol-ok" : "sol-overheat");
        if (symbol === "AVAX") {
            reasons.push(bar.mom20 > 0.25 ? "avax-mom-ok" : "avax-mom-low");
            reasons.push(bar.volume > bar.volAvg20 ? "avax-vol-ok" : "avax-vol-low");
        }
        return { symbol, bar, eligible, score, reasons };
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    const top = bars
        .filter((item) => item.eligible)
        .sort((left, right) => right.score - left.score || right.bar.mom20 - left.bar.mom20 || left.symbol.localeCompare(right.symbol))[0];
    if (!top) return null;

    return {
        symbol: top.symbol,
        bar: top.bar,
        eligible: true,
        score: top.score,
        reasons: [...top.reasons, "legacy-baseline"],
    };
}

function topTrendCandidateFromSymbols(
    snapshot: RegimeSnapshot,
    indicators: Record<TradeSymbol, IndicatorBar[]>,
    symbols: readonly Exclude<TradeSymbol, "BTC">[],
) {
    const bars = symbols.map((symbol) => {
        const bar = latestIndicatorAtOrBefore(indicators[symbol], snapshot.ts);
        if (!bar || !bar.ready) return null;
        const baseEligible = bar.close > bar.sma40 && bar.mom20 > 0;
        const solOk = symbol !== "SOL" || bar.overheatPct <= 0.35;
        const avaxOk = symbol !== "AVAX" || (bar.mom20 > 0.25 && bar.volume > bar.volAvg20);
        const bnbOk = symbol !== "BNB" || (bar.mom20 > 0.02 && bar.close > bar.sma45);
        const linkOk = symbol !== "LINK" || (bar.mom20 > 0.01 && bar.close > bar.sma45 && bar.volume > bar.volAvg20 * 0.85);
        const eligible = snapshot.trendAllowed && baseEligible && solOk && avaxOk && bnbOk && linkOk;
        const score = (bar.mom20 * 100) + ((bar.close / Math.max(1, bar.sma40)) - 1) * 100 + (bar.adx14 / 5);
        const reasons = [
            baseEligible ? "close>sma40" : "close<=sma40",
            bar.mom20 > 0 ? "mom20-ok" : "mom20-low",
        ];
        if (symbol === "SOL") reasons.push(solOk ? "sol-ok" : "sol-overheat");
        if (symbol === "AVAX") {
            reasons.push(bar.mom20 > 0.25 ? "avax-mom-ok" : "avax-mom-low");
            reasons.push(bar.volume > bar.volAvg20 ? "avax-vol-ok" : "avax-vol-low");
        }
        if (symbol === "BNB") {
            reasons.push(bar.mom20 > 0.02 ? "bnb-mom-ok" : "bnb-mom-low");
            reasons.push(bar.close > bar.sma45 ? "bnb-trend-ok" : "bnb-trend-low");
        }
        if (symbol === "LINK") {
            reasons.push(bar.mom20 > 0.01 ? "link-mom-ok" : "link-mom-low");
            reasons.push(bar.close > bar.sma45 ? "link-trend-ok" : "link-trend-low");
            reasons.push(bar.volume > bar.volAvg20 * 0.85 ? "link-vol-ok" : "link-vol-low");
        }
        return { symbol, bar, eligible, score, reasons };
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    const eligible = bars
        .filter((item) => item.eligible)
        .sort((left, right) => right.score - left.score || right.bar.mom20 - left.bar.mom20 || left.symbol.localeCompare(right.symbol));
    const top = eligible[0];
    if (!top) return null;

    const weakGateOk = snapshot.regimeLabel !== "trend_weak" || (
        snapshot.core2_45 === 2 &&
        snapshot.avgMom20EthSol >= 0.08 &&
        snapshot.bestMomAccel >= -0.02
    );

    return {
        symbol: top.symbol,
        bar: top.bar,
        eligible: top.eligible && weakGateOk,
        score: top.score,
        reasons: [
            ...top.reasons,
            snapshot.weak2022Regime ? (weakGateOk ? "retq22-pass" : "retq22-block") : "retq22-off",
        ],
    };
}

function pickRangeCandidate(
    snapshot: RegimeSnapshot,
    indicators: Record<TradeSymbol, IndicatorBar[]>,
    symbols: readonly Exclude<TradeSymbol, "BTC">[],
    momentumExitThreshold: number,
) {
    const bars = symbols.map((symbol) => {
        const bar = latestIndicatorAtOrBefore(indicators[symbol], snapshot.ts);
        if (!bar || !bar.ready) return null;
        const meanReversionOk = bar.close < bar.sma45 && bar.mom20 <= 0;
        const overheatOk = bar.overheatPct <= -0.015;
        const eligible = snapshot.rangeAllowed && meanReversionOk && overheatOk;
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
                `momExit<=${momentumExitThreshold.toFixed(2)}`,
            ],
        };
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    const eligible = bars
        .filter((item) => item.eligible)
        .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
    const top = eligible[0];
    if (!top) return null;
    return { symbol: top.symbol, bar: top.bar, eligible: top.eligible, score: top.score, reasons: top.reasons };
}

type NoBnbAdaptiveParams = {
    id: string;
    avaxMomMin: number;
    avaxVolMult: number;
    linkMomMin: number;
    linkVolMult: number;
    solOverheatMax: number;
    weakCore2Min: number;
    weakAvgMomMin: number;
    weakAccelMin: number;
    rangeSymbols: readonly Exclude<TradeSymbol, "BTC">[];
    rangeMomMax: number;
    rangeAdxMax: number;
    rangeOverheatMax: number;
    rangeMomentumExit: number;
    rangeTimeBars: number;
};

function topTrendCandidateNoBnbAdaptive(
    snapshot: RegimeSnapshot,
    indicators: Record<TradeSymbol, IndicatorBar[]>,
    params: NoBnbAdaptiveParams,
) {
    const bars = NO_BNB_SYMBOLS.map((symbol) => {
        const bar = latestIndicatorAtOrBefore(indicators[symbol], snapshot.ts);
        if (!bar || !bar.ready) return null;
        const baseEligible = bar.close > bar.sma40 && bar.mom20 > 0;
        const solOk = symbol !== "SOL" || bar.overheatPct <= params.solOverheatMax;
        const avaxOk = symbol !== "AVAX" || (bar.mom20 > params.avaxMomMin && bar.volume > bar.volAvg20 * params.avaxVolMult);
        const linkOk = symbol !== "LINK" || (
            bar.mom20 > params.linkMomMin &&
            bar.close > bar.sma45 &&
            bar.volume > bar.volAvg20 * params.linkVolMult
        );
        const eligible = snapshot.trendAllowed && baseEligible && solOk && avaxOk && linkOk;
        const score =
            (bar.mom20 * 110) +
            (bar.momAccel * 70) +
            (((bar.close / Math.max(1, bar.sma40)) - 1) * 120) +
            (bar.adx14 / 4);
        return {
            symbol,
            bar,
            eligible,
            score,
            reasons: [
                baseEligible ? "close>sma40" : "close<=sma40",
                bar.mom20 > 0 ? "mom20-ok" : "mom20-low",
                symbol === "SOL" ? (solOk ? "sol-ok" : "sol-overheat") : "",
                symbol === "AVAX" ? (avaxOk ? "avax-ok" : "avax-filter") : "",
                symbol === "LINK" ? (linkOk ? "link-ok" : "link-filter") : "",
            ].filter(Boolean),
        };
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    const top = bars
        .filter((item) => item.eligible)
        .sort((left, right) => right.score - left.score || right.bar.mom20 - left.bar.mom20 || left.symbol.localeCompare(right.symbol))[0];
    if (!top) return null;

    const weakGateOk = snapshot.regimeLabel !== "trend_weak" || (
        snapshot.core2_45 >= params.weakCore2Min &&
        snapshot.avgMom20EthSol >= params.weakAvgMomMin &&
        snapshot.bestMomAccel >= params.weakAccelMin
    );

    return {
        symbol: top.symbol,
        bar: top.bar,
        eligible: top.eligible && weakGateOk,
        score: top.score,
        reasons: [
            ...top.reasons,
            snapshot.regimeLabel === "trend_weak"
                ? (weakGateOk ? "weak-gate-pass" : "weak-gate-block")
                : "weak-gate-off",
        ],
    };
}

function topTrendCandidateNoBnbLoose(
    snapshot: RegimeSnapshot,
    indicators: Record<TradeSymbol, IndicatorBar[]>,
) {
    const bars = NO_BNB_SYMBOLS.map((symbol) => {
        const bar = latestIndicatorAtOrBefore(indicators[symbol], snapshot.ts);
        if (!bar || !bar.ready) return null;
        const baseEligible = bar.close > bar.sma40 && bar.mom20 > 0;
        const solOk = symbol !== "SOL" || bar.overheatPct <= 0.35;
        const avaxOk = symbol !== "AVAX" || (bar.mom20 > 0.2 && bar.volume > bar.volAvg20 * 0.9);
        const linkOk = symbol !== "LINK" || (bar.mom20 > 0.005 && bar.close > bar.sma45 && bar.volume > bar.volAvg20 * 0.8);
        const eligible = snapshot.trendAllowed && baseEligible && solOk && avaxOk && linkOk;
        const score = (bar.mom20 * 100) + (((bar.close / Math.max(1, bar.sma40)) - 1) * 110) + (bar.adx14 / 5);
        return { symbol, bar, eligible, score };
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    const top = bars
        .filter((item) => item.eligible)
        .sort((left, right) => right.score - left.score || right.bar.mom20 - left.bar.mom20 || left.symbol.localeCompare(right.symbol))[0];
    if (!top) return null;
    return {
        symbol: top.symbol,
        bar: top.bar,
        eligible: true,
        score: top.score,
        reasons: ["no-bnb-loose"],
    };
}

type TrendSelectorMode =
    | "default"
    | "no_bnb"
    | "bnb_strong_only"
    | "strong_all_weak_no_bnb";

function selectTrendCandidateByMode(
    mode: TrendSelectorMode,
    snapshot: RegimeSnapshot,
    indicators: Record<TradeSymbol, IndicatorBar[]>,
) {
    const defaultCandidate = topTrendCandidate(snapshot, indicators);
    if (mode === "default") return defaultCandidate;
    if (mode === "no_bnb") {
        return topTrendCandidateFromSymbols(snapshot, indicators, NO_BNB_SYMBOLS);
    }

    const bnbBar = latestIndicatorAtOrBefore(indicators.BNB, snapshot.ts);
    const bnbStrictOk = !bnbBar
        ? false
        : bnbBar.close > bnbBar.sma45 &&
            bnbBar.mom20 > 0.05 &&
            bnbBar.volume > bnbBar.volAvg20 * 1.05;

    if (mode === "bnb_strong_only") {
        if (!defaultCandidate) return null;
        if (defaultCandidate.symbol !== "BNB") return defaultCandidate;
        return bnbStrictOk ? defaultCandidate : null;
    }

    if (!snapshot.trendAllowed) return null;
    if (snapshot.regimeLabel === "trend_weak") {
        return topTrendCandidateFromSymbols(snapshot, indicators, NO_BNB_SYMBOLS);
    }
    if (!defaultCandidate) return null;
    if (defaultCandidate.symbol !== "BNB") return defaultCandidate;
    return bnbStrictOk ? defaultCandidate : null;
}

function pickRangeCandidateAdaptive(
    snapshot: RegimeSnapshot,
    indicators: Record<TradeSymbol, IndicatorBar[]>,
    params: NoBnbAdaptiveParams,
) {
    const bars = params.rangeSymbols.map((symbol) => {
        const bar = latestIndicatorAtOrBefore(indicators[symbol], snapshot.ts);
        if (!bar || !bar.ready) return null;
        const meanReversionOk = bar.close < bar.sma45 && bar.mom20 <= 0;
        const overheatOk = bar.overheatPct <= params.rangeOverheatMax;
        const eligible = meanReversionOk && overheatOk;
        const score =
            (((bar.sma45 - bar.close) / Math.max(1, bar.sma45)) * 100) +
            (Math.max(0, -bar.mom20) * 100) +
            Math.max(0, 22 - bar.adx14);
        return {
            symbol,
            bar,
            eligible,
            score,
            reasons: [
                bar.close < bar.sma45 ? "close<sma45" : "close>=sma45",
                bar.mom20 <= 0 ? "mom20-ok" : "mom20-positive",
                overheatOk ? "pullback-ok" : "pullback-weak",
            ],
        };
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    const top = bars
        .filter((item) => item.eligible)
        .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))[0];
    return top
        ? {
            symbol: top.symbol,
            bar: top.bar,
            eligible: top.eligible,
            score: top.score,
            reasons: [...top.reasons, `momExit<=${params.rangeMomentumExit.toFixed(2)}`],
        }
        : null;
}

type FiveAssetRegimeLabel = "trend_strong" | "trend_weak" | "range_only" | "ambiguous";

function deriveFiveAssetRegime(snapshot: RegimeSnapshot, indicators: Record<TradeSymbol, IndicatorBar[]>) {
    const eth = latestIndicatorAtOrBefore(indicators.ETH, snapshot.ts);
    const sol = latestIndicatorAtOrBefore(indicators.SOL, snapshot.ts);
    const avax = latestIndicatorAtOrBefore(indicators.AVAX, snapshot.ts);
    const bnb = latestIndicatorAtOrBefore(indicators.BNB, snapshot.ts);
    const link = latestIndicatorAtOrBefore(indicators.LINK, snapshot.ts);
    if (!eth || !sol || !avax || !bnb || !link || !eth.ready || !sol.ready || !avax.ready || !bnb.ready || !link.ready) return null;

    const tradeBars = [eth, sol, avax, bnb, link];
    const breadth45 = tradeBars.filter((bar) => bar.close > bar.sma45).length;
    const breadth40 = tradeBars.filter((bar) => bar.close > bar.sma40).length;
    const best = [...tradeBars].sort((left, right) => right.mom20 - left.mom20 || right.momAccel - left.momAccel || right.close - left.close)[0];
    const bestMom20 = best?.mom20 || 0;
    const core3_45 = [eth, bnb, link].filter((bar) => bar.close > bar.sma45).length;
    const core3Mom20 = (eth.mom20 + bnb.mom20 + link.mom20) / 3;
    const trendStrong =
        snapshot.trendAllowed &&
        snapshot.btc.adx14 >= 20 &&
        breadth45 >= 3 &&
        breadth40 >= 3 &&
        bestMom20 > 0.04 &&
        core3_45 >= 2 &&
        core3Mom20 > 0.03;
    const trendWeak =
        snapshot.trendAllowed &&
        breadth45 >= 2 &&
        breadth45 <= 4 &&
        bestMom20 > -0.01 &&
        core3_45 >= 1;
    const rangeOnly =
        !snapshot.trendAllowed &&
        snapshot.btc.adx14 < 18 &&
        breadth45 <= 2 &&
        breadth40 <= 2 &&
        Math.abs((snapshot.btc.close / Math.max(1, snapshot.btc.sma85)) - 1) < 0.015;
    const label: FiveAssetRegimeLabel = trendStrong ? "trend_strong" : trendWeak ? "trend_weak" : rangeOnly ? "range_only" : "ambiguous";
    return {
        label,
        breadth45,
        breadth40,
        bestMom20,
        core3_45,
        core3Mom20,
        trendEligible: snapshot.trendAllowed && (trendStrong || trendWeak),
        rangeEligible: rangeOnly,
        symbols: label === "trend_strong"
            ? (["ETH", "SOL", "AVAX", "BNB", "LINK"] as const)
            : label === "trend_weak"
                ? (["ETH", "BNB", "LINK"] as const)
                : label === "range_only"
                    ? (["ETH", "BNB"] as const)
                    : ([] as const),
    };
}

function highestHigh(series: IndicatorBar[], endIndex: number, lookback: number) {
    const start = Math.max(0, endIndex - lookback);
    const window = series.slice(start, endIndex);
    return window.length ? Math.max(...window.map((bar) => bar.high)) : 0;
}

function buildStrategyResult(name: string, label: string, tradeEvents: TradeEventRow[], tradePairs: TradePairRow[], equityCurve: EquityPoint[]) {
    const annualReturns = periodReturns(equityCurve, (point) => new Date(point.ts).getUTCFullYear().toString());
    const monthlyReturns = periodReturns(equityCurve, (point) => `${new Date(point.ts).getUTCFullYear()}-${String(new Date(point.ts).getUTCMonth() + 1).padStart(2, "0")}`);
    const startEquity = equityCurve[0]?.equity || BASE_EQUITY;
    const endEquity = equityCurve.at(-1)?.equity || startEquity;
    const firstTs = equityCurve[0]?.ts || Date.now();
    const lastTs = equityCurve.at(-1)?.ts || firstTs;
    const years = Math.max(1 / 365, (lastTs - firstTs) / (365.25 * 24 * 60 * 60 * 1000));
    const cagr = Math.pow(endEquity / startEquity, 1 / years) - 1;
    const wins = tradePairs.filter((trade) => trade.net_pnl > 0).length;
    const grossWins = sum(tradePairs.map((trade) => Math.max(0, trade.net_pnl)));
    const grossLosses = Math.abs(sum(tradePairs.map((trade) => Math.min(0, trade.net_pnl))));
    const symbolContribution = tradePairs.reduce<Record<string, number>>((acc, trade) => {
        acc[trade.symbol] = (acc[trade.symbol] || 0) + trade.net_pnl;
        return acc;
    }, {});
    const exposureBars = equityCurve.filter((point) => point.position_side !== "cash").length;
    const exposurePct = equityCurve.length ? (exposureBars / equityCurve.length) * 100 : 0;
    return {
        name,
        label,
        trade_events: tradeEvents,
        trade_pairs: tradePairs,
        equity_curve: equityCurve,
        annual_returns: annualReturns,
        monthly_returns: monthlyReturns,
        summary: {
            name,
            start_equity: startEquity,
            end_equity: endEquity,
            cagr_pct: cagr * 100,
            max_drawdown_pct: calcMaxDrawdownPct(equityCurve),
            win_rate_pct: tradePairs.length ? (wins / tradePairs.length) * 100 : 0,
            profit_factor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0,
            trade_count: tradePairs.length,
            exposure_pct: exposurePct,
            annual_returns: annualReturns,
            monthly_returns: monthlyReturns,
            symbol_contribution: symbolContribution,
        },
    } satisfies StrategyResult;
}

function buildNoBnbAdaptiveStrategies(): StrategyLogic[] {
    const candidates: NoBnbAdaptiveParams[] = [];
    let idx = 1;
    for (const weakAvgMomMin of [0.03, 0.05, 0.07]) {
        for (const weakAccelMin of [-0.05, -0.03, -0.02]) {
            for (const rangeMomMax of [-0.015, -0.005]) {
                for (const rangeOverheatMax of [-0.02, -0.015]) {
                    candidates.push({
                        id: `nb_adapt_${String(idx).padStart(2, "0")}`,
                        avaxMomMin: 0.2,
                        avaxVolMult: 0.95,
                        linkMomMin: 0.005,
                        linkVolMult: 0.85,
                        solOverheatMax: 0.32,
                        weakCore2Min: 1,
                        weakAvgMomMin,
                        weakAccelMin,
                        rangeSymbols: rangeOverheatMax <= -0.02 ? ETH_ONLY : ETH_LINK,
                        rangeMomMax,
                        rangeAdxMax: 20,
                        rangeOverheatMax,
                        rangeMomentumExit: 0.025,
                        rangeTimeBars: 10,
                    });
                    idx += 1;
                }
            }
        }
    }

    return candidates.map((params) => ({
        name: params.id,
        label: `No-BNB adaptive ${params.id}`,
        selectSignal: ({ snapshot, indicators, priorWeak2022Regime }) => {
            const trend = topTrendCandidateNoBnbAdaptive(snapshot, indicators, params);
            if (trend?.eligible) {
                return {
                    side: "trend",
                    symbol: trend.symbol,
                    subVariant: "trend-no-bnb-adaptive",
                    reason: trend.reasons,
                } satisfies Signal;
            }

            const rangeAllowed =
                snapshot.regimeLabel === "range_only" &&
                priorWeak2022Regime &&
                snapshot.breadth40 <= 0 &&
                snapshot.bestMom20 < params.rangeMomMax &&
                snapshot.btc.adx14 < params.rangeAdxMax;
            if (!rangeAllowed) return null;

            const range = pickRangeCandidateAdaptive(snapshot, indicators, params);
            return range?.eligible
                ? ({
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "range-no-bnb-adaptive",
                    reason: range.reasons,
                } satisfies Signal)
                : null;
        },
        selectExitReason: ({ snapshot, currentBars, position, index, indicators }) => {
            const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
            if (!bar) return null;
            if (position.side === "trend") {
                if (!snapshot.trendAllowed) return "risk-off";
                if (bar.close <= bar.sma45) return "sma-break";
                const trend = topTrendCandidateNoBnbAdaptive(snapshot, indicators, params);
                if (trend && trend.symbol !== position.symbol && trend.score > 6) return "leader-switch";
            }
            if (position.side === "range") {
                if (bar.close >= bar.sma45) return "mean-revert";
                if (bar.mom20 > params.rangeMomentumExit) return "range-momentum";
                if (index - position.entryIndex >= params.rangeTimeBars) return "range-time";
            }
            return null;
        },
    }));
}

function buildTrendPriorityOptimizationStrategies(): StrategyLogic[] {
    const configs = [] as Array<{
        id: string;
        persistentWeak: boolean;
        rangeSymbols: readonly Exclude<TradeSymbol, "BTC">[];
        rangeMomentumExit: number;
        rangeTimeBars: number;
        trendExitSma: 40 | 45;
        requireRangeOnly: boolean;
    }>;
    let idx = 1;
    for (const persistentWeak of [true, false]) {
        for (const rangeSymbols of [ETH_ONLY, ETH_LINK]) {
            for (const rangeMomentumExit of [0.025, 0.03, 0.035]) {
                for (const rangeTimeBars of [8, 12, 16]) {
                    for (const trendExitSma of [40, 45] as const) {
                        for (const requireRangeOnly of [true, false]) {
                            configs.push({
                                id: `tp_opt_${String(idx).padStart(3, "0")}`,
                                persistentWeak,
                                rangeSymbols,
                                rangeMomentumExit,
                                rangeTimeBars,
                                trendExitSma,
                                requireRangeOnly,
                            });
                            idx += 1;
                        }
                    }
                }
            }
        }
    }

    return configs.map((cfg) => ({
        name: cfg.id,
        label: `Trend priority opt ${cfg.id}`,
        selectSignal: ({ snapshot, indicators, priorWeak2022Regime }) => {
            const trend = topTrendCandidate(snapshot, indicators);
            if (trend?.eligible) {
                return {
                    side: "trend",
                    symbol: trend.symbol,
                    subVariant: "trend-priority-opt",
                    reason: trend.reasons,
                } satisfies Signal;
            }

            const weakOk = !cfg.persistentWeak || (snapshot.weak2022Regime && priorWeak2022Regime);
            const regimeOk = cfg.requireRangeOnly
                ? snapshot.regimeLabel === "range_only"
                : snapshot.regimeLabel !== "trend_strong";
            const rangeAllowed = snapshot.rangeAllowed && weakOk && regimeOk;
            if (!rangeAllowed) return null;
            const range = pickRangeCandidate(snapshot, indicators, cfg.rangeSymbols, cfg.rangeMomentumExit);
            return range?.eligible
                ? ({
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "range-priority-opt",
                    reason: range.reasons,
                } satisfies Signal)
                : null;
        },
        selectExitReason: ({ snapshot, currentBars, position, index }) => {
            const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
            if (!bar) return null;
            if (position.side === "trend") {
                if (!snapshot.trendAllowed) return "risk-off";
                if (cfg.trendExitSma === 45 && bar.close <= bar.sma45) return "sma45-break";
                if (cfg.trendExitSma === 40 && bar.close <= bar.sma40) return "sma40-break";
            }
            if (position.side === "range") {
                if (bar.close >= bar.sma45) return "mean-revert";
                if (bar.mom20 > cfg.rangeMomentumExit) return "range-momentum";
                if (index - position.entryIndex >= cfg.rangeTimeBars) return "range-time";
            }
            return null;
        },
    }));
}

function buildTrendSelectorOptimizationStrategies(): StrategyLogic[] {
    const configs = [] as Array<{
        id: string;
        trendMode: TrendSelectorMode;
        rangeSymbols: readonly Exclude<TradeSymbol, "BTC">[];
        rangeMomentumExit: number;
        rangeTimeBars: number;
        trendExitSma: 40 | 45;
    }>;
    let idx = 1;
    for (const trendMode of ["default", "no_bnb", "bnb_strong_only", "strong_all_weak_no_bnb"] as const) {
        for (const rangeSymbols of [ETH_ONLY, ETH_LINK]) {
            for (const rangeMomentumExit of [0.02, 0.025, 0.03]) {
                for (const rangeTimeBars of [8, 10, 12]) {
                    for (const trendExitSma of [40, 45] as const) {
                        configs.push({
                            id: `tps_opt_${String(idx).padStart(3, "0")}`,
                            trendMode,
                            rangeSymbols,
                            rangeMomentumExit,
                            rangeTimeBars,
                            trendExitSma,
                        });
                        idx += 1;
                    }
                }
            }
        }
    }

    return configs.map((cfg) => ({
        name: cfg.id,
        label: `Trend selector opt ${cfg.id}`,
        selectSignal: ({ snapshot, indicators }) => {
            const trend = selectTrendCandidateByMode(cfg.trendMode, snapshot, indicators);
            if (trend?.eligible) {
                return {
                    side: "trend",
                    symbol: trend.symbol,
                    subVariant: `trend-${cfg.trendMode}`,
                    reason: trend.reasons,
                } satisfies Signal;
            }

            const rangeAllowed =
                snapshot.rangeAllowed &&
                snapshot.regimeLabel === "range_only";
            if (!rangeAllowed) return null;
            const range = pickRangeCandidate(snapshot, indicators, cfg.rangeSymbols, cfg.rangeMomentumExit);
            return range?.eligible
                ? ({
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "range-trend-selector-opt",
                    reason: range.reasons,
                } satisfies Signal)
                : null;
        },
        selectExitReason: ({ snapshot, currentBars, position, index }) => {
            const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
            if (!bar) return null;
            if (position.side === "trend") {
                if (!snapshot.trendAllowed) return "risk-off";
                if (cfg.trendExitSma === 45 && bar.close <= bar.sma45) return "sma45-break";
                if (cfg.trendExitSma === 40 && bar.close <= bar.sma40) return "sma40-break";
            }
            if (position.side === "range") {
                if (bar.close >= bar.sma45) return "mean-revert";
                if (bar.mom20 > cfg.rangeMomentumExit) return "range-momentum";
                if (index - position.entryIndex >= cfg.rangeTimeBars) return "range-time";
            }
            return null;
        },
    }));
}

type TrendRiskMode = "strict" | "confirm40" | "regime_only";

function buildTrendRiskOptimizationStrategies(): StrategyLogic[] {
    const configs = [] as Array<{
        id: string;
        riskMode: TrendRiskMode;
        requirePersistentWeak: boolean;
        rangeMomentumExit: number;
        rangeTimeBars: number;
        trendExitSma: 40 | 45;
    }>;
    let idx = 1;
    for (const riskMode of ["strict", "confirm40", "regime_only"] as const) {
        for (const requirePersistentWeak of [false, true]) {
            for (const rangeMomentumExit of [0.02, 0.025, 0.03]) {
                for (const rangeTimeBars of [8, 10, 12]) {
                    for (const trendExitSma of [40, 45] as const) {
                        configs.push({
                            id: `trisk_opt_${String(idx).padStart(3, "0")}`,
                            riskMode,
                            requirePersistentWeak,
                            rangeMomentumExit,
                            rangeTimeBars,
                            trendExitSma,
                        });
                        idx += 1;
                    }
                }
            }
        }
    }

    return configs.map((cfg) => ({
        name: cfg.id,
        label: `Trend risk opt ${cfg.id}`,
        selectSignal: ({ snapshot, indicators, priorWeak2022Regime }) => {
            const trend = topTrendCandidate(snapshot, indicators);
            if (trend?.eligible) {
                return {
                    side: "trend",
                    symbol: trend.symbol,
                    subVariant: `trend-risk-${cfg.riskMode}`,
                    reason: trend.reasons,
                } satisfies Signal;
            }

            const weakOk = !cfg.requirePersistentWeak || (snapshot.weak2022Regime && priorWeak2022Regime);
            const rangeAllowed = snapshot.rangeAllowed && snapshot.regimeLabel === "range_only" && weakOk;
            if (!rangeAllowed) return null;

            const range = pickRangeCandidate(snapshot, indicators, ETH_ONLY, cfg.rangeMomentumExit);
            return range?.eligible
                ? ({
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "range-trend-risk-opt",
                    reason: range.reasons,
                } satisfies Signal)
                : null;
        },
        selectExitReason: ({ snapshot, currentBars, position, index }) => {
            const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
            if (!bar) return null;
            if (position.side === "trend") {
                if (cfg.riskMode === "strict" && !snapshot.trendAllowed) return "risk-off";
                if (cfg.riskMode === "confirm40" && !snapshot.trendAllowed && bar.close <= bar.sma40) return "risk-off-confirm40";
                if (cfg.riskMode === "regime_only" && snapshot.regimeLabel === "range_only" && bar.close <= bar.sma45) return "risk-off-range-only";
                if (cfg.trendExitSma === 45 && bar.close <= bar.sma45) return "sma45-break";
                if (cfg.trendExitSma === 40 && bar.close <= bar.sma40) return "sma40-break";
            }
            if (position.side === "range") {
                if (bar.close >= bar.sma45) return "mean-revert";
                if (bar.mom20 > cfg.rangeMomentumExit) return "range-momentum";
                if (index - position.entryIndex >= cfg.rangeTimeBars) return "range-time";
            }
            return null;
        },
    }));
}

async function runStrategy(
    logic: StrategyLogic,
    bySymbol: Record<TradeSymbol, Candle1h[]>,
    indicators: Record<TradeSymbol, IndicatorBar[]>,
    timeline: number[],
    feeRateValue: number,
) {
    const tradeEvents: TradeEventRow[] = [];
    const tradePairs: TradePairRow[] = [];
    const equityCurve: EquityPoint[] = [];
    const position = createEmptyPosition();
    let cash = BASE_EQUITY;
    let tradeCount = 0;
    let highWaterMark = BASE_EQUITY;
    let priorWeak2022Regime = false;

    for (let index = 0; index < timeline.length; index += 1) {
        const ts = timeline[index];
        const snapshot = buildRegimeSnapshot(ts, indicators);
        if (!snapshot) continue;
        const currentBars = {
            BTC: latestIndicatorAtOrBefore(indicators.BTC, ts)!,
            ETH: latestIndicatorAtOrBefore(indicators.ETH, ts)!,
            SOL: latestIndicatorAtOrBefore(indicators.SOL, ts)!,
            AVAX: latestIndicatorAtOrBefore(indicators.AVAX, ts)!,
            BNB: latestIndicatorAtOrBefore(indicators.BNB, ts)!,
            LINK: latestIndicatorAtOrBefore(indicators.LINK, ts)!,
        };
        const execRaw = {
            BTC: getExecutionBar(bySymbol.BTC, ts),
            ETH: getExecutionBar(bySymbol.ETH, ts),
            SOL: getExecutionBar(bySymbol.SOL, ts),
            AVAX: getExecutionBar(bySymbol.AVAX, ts),
            BNB: getExecutionBar(bySymbol.BNB, ts),
            LINK: getExecutionBar(bySymbol.LINK, ts),
        };
        const executionIndex = index;
        const currentPositionRaw = position.symbol ? execRaw[position.symbol as TradeSymbol] : null;
        const markPrice = position.symbol ? (currentPositionRaw?.open || position.entryPrice) : 0;
        const equity = markToMarket(position.qty, markPrice, cash, feeRateValue);
        highWaterMark = Math.max(highWaterMark, equity);
        const drawdownPct = highWaterMark > 0 ? ((equity / highWaterMark) - 1) * 100 : 0;
        const tradeReady = snapshot.trendAllowed || snapshot.rangeAllowed;
        const rebalance = index % REBALANCE_BARS === 0;
        const trendCandidate = topTrendCandidate(snapshot, indicators);

        if (position.side) {
            const currentBar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
            if (currentBar) {
                const exitReason = logic.selectExitReason({ ts, index, snapshot, indicators, currentBars, execRaw, position, priorWeak2022Regime, trendCandidate });
                const ddExit = position.side === "trend" && snapshot.weak2022Regime && snapshot.regimeLabel === "trend_weak" && drawdownPct <= -22;
                if (exitReason || ddExit) {
                    const price = currentPositionRaw?.open || position.entryPrice;
                    cash = exitPosition(
                        position,
                        price,
                        ts,
                        executionIndex,
                        exitReason || "dd22-balanced",
                        cash,
                        tradeEvents,
                        tradePairs,
                        feeRateValue,
                    );
                }
            }
        }

        if (tradeReady && rebalance) {
            const signal = logic.selectSignal({ ts, index, snapshot, indicators, currentBars, execRaw, position, priorWeak2022Regime, trendCandidate });
            if (!position.side) {
                if (signal && execRaw[signal.symbol]) {
                    const tradeId = nextTradeId(logic.name, tradeCount);
                    const result = enterPosition(
                        position,
                        signal.side,
                        signal.symbol,
                        execRaw[signal.symbol]!.open,
                        ts,
                        executionIndex,
                        `${logic.name}-${signal.reason.join("|")}`,
                        tradeEvents,
                        tradeId,
                        cash,
                        feeRateValue,
                    );
                    cash = result.cash;
                    if (result.opened) tradeCount += 1;
                }
            } else if (signal && position.symbol && (position.side !== signal.side || position.symbol !== signal.symbol)) {
                cash = exitPosition(
                    position,
                    execRaw[position.symbol as TradeSymbol]?.open || position.entryPrice,
                    ts,
                    executionIndex,
                    `${logic.name}-switch`,
                    cash,
                    tradeEvents,
                    tradePairs,
                    feeRateValue,
                );
                if (execRaw[signal.symbol]) {
                    const tradeId = nextTradeId(logic.name, tradeCount);
                    const result = enterPosition(
                        position,
                        signal.side,
                        signal.symbol,
                        execRaw[signal.symbol]!.open,
                        ts,
                        executionIndex,
                        `${logic.name}-${signal.reason.join("|")}`,
                        tradeEvents,
                        tradeId,
                        cash,
                        feeRateValue,
                    );
                    cash = result.cash;
                    if (result.opened) tradeCount += 1;
                }
            }
        }

        const evalPrice = position.symbol ? (execRaw[position.symbol as TradeSymbol]?.close || position.entryPrice) : 0;
        equityCurve.push({
            ts,
            iso_time: formatIso(ts),
            equity: markToMarket(position.qty, evalPrice, cash, feeRateValue),
            cash,
            position_symbol: position.symbol || "cash",
            position_side: position.side || "cash",
            position_qty: position.qty,
            position_entry_price: position.entryPrice,
        });
        priorWeak2022Regime = snapshot.weak2022Regime;
    }

    if (position.side && position.symbol) {
        const finalRaw = bySymbol[position.symbol as TradeSymbol].at(-1);
        if (finalRaw) {
            cash = exitPosition(
                position,
                finalRaw.close,
                finalRaw.ts,
                timeline.length - 1,
                "final-close",
                cash,
                tradeEvents,
                tradePairs,
                feeRateValue,
            );
        }
    }

    return buildStrategyResult(logic.name, logic.label, tradeEvents, tradePairs, equityCurve);
}

function makeStrategies(): StrategyLogic[] {
    return [
        {
            name: "legacy_hybrid_baseline",
            label: "Legacy hybrid baseline",
            selectSignal: ({ snapshot, indicators }) => {
                const trend = topTrendCandidateLegacyBaseline(snapshot, indicators);
                return trend?.eligible ? {
                    side: "trend",
                    symbol: trend.symbol,
                    subVariant: "legacy-baseline",
                    reason: trend.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                return null;
            },
        },
        {
            name: "baseline_eth_range_guarded",
            label: "Baseline + ETH range guarded",
            selectSignal: ({ snapshot, indicators, priorWeak2022Regime }) => {
                const trend = topTrendCandidateLegacyBaseline(snapshot, indicators);
                if (trend?.eligible) {
                    return {
                        side: "trend",
                        symbol: trend.symbol,
                        subVariant: "legacy-trend",
                        reason: trend.reasons,
                    };
                }

                const persistentWeak = snapshot.weak2022Regime && priorWeak2022Regime;
                const allowRange =
                    snapshot.rangeAllowed &&
                    snapshot.regimeLabel === "range_only" &&
                    persistentWeak &&
                    snapshot.btc.adx14 < 18 &&
                    snapshot.bestMom20 < -0.04;
                if (!allowRange) return null;

                const range = pickRangeCandidate(snapshot, indicators, ETH_ONLY, 0.02);
                return range?.eligible ? {
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "eth-range-guarded",
                    reason: [...range.reasons, "persistent-weak"],
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                if (position.side === "range") {
                    if (bar.close >= bar.sma45) return "mean-revert";
                    if (bar.mom20 > 0.02) return "range-momentum";
                    if (index - position.entryIndex >= 8) return "range-time";
                }
                return null;
            },
        },
        {
            name: "baseline_eth_range_confirmed",
            label: "Baseline + ETH range confirmed",
            selectSignal: ({ snapshot, indicators, priorWeak2022Regime }) => {
                const trend = topTrendCandidateLegacyBaseline(snapshot, indicators);
                if (trend?.eligible) {
                    return {
                        side: "trend",
                        symbol: trend.symbol,
                        subVariant: "legacy-trend",
                        reason: trend.reasons,
                    };
                }

                const persistentWeak = snapshot.weak2022Regime && priorWeak2022Regime;
                const ethBar = latestIndicatorAtOrBefore(indicators.ETH, snapshot.ts);
                const allowRange =
                    !!ethBar &&
                    snapshot.rangeAllowed &&
                    snapshot.regimeLabel === "range_only" &&
                    persistentWeak &&
                    snapshot.btc.adx14 < 17 &&
                    snapshot.bestMom20 < -0.03 &&
                    ethBar.momAccel > -0.03;
                if (!allowRange) return null;

                const range = pickRangeCandidate(snapshot, indicators, ETH_ONLY, 0.025);
                return range?.eligible ? {
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "eth-range-confirmed",
                    reason: [...range.reasons, "eth-accel-ok"],
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                if (position.side === "range") {
                    if (bar.close >= bar.sma45) return "mean-revert";
                    if (bar.mom20 > 0.025) return "range-momentum";
                    if (index - position.entryIndex >= 10) return "range-time";
                }
                return null;
            },
        },
        {
            name: "baseline_trend_tighter_exit",
            label: "Baseline trend tighter exit",
            selectSignal: ({ snapshot, indicators }) => {
                const trend = topTrendCandidateLegacyBaseline(snapshot, indicators);
                return trend?.eligible ? {
                    side: "trend",
                    symbol: trend.symbol,
                    subVariant: "legacy-trend-tight",
                    reason: trend.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma40) return "sma40-break";
                    if (snapshot.weak2022Regime && snapshot.bestMom20 < 0.05 && snapshot.btc.adx14 < 18) return "weak-trend-off";
                }
                return null;
            },
        },
        {
            name: "baseline_sma40_only",
            label: "Baseline SMA40 only",
            selectSignal: ({ snapshot, indicators }) => {
                const trend = topTrendCandidateLegacyBaseline(snapshot, indicators);
                return trend?.eligible ? {
                    side: "trend",
                    symbol: trend.symbol,
                    subVariant: "legacy-trend-sma40",
                    reason: trend.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma40) return "sma40-break";
                }
                return null;
            },
        },
        {
            name: "baseline_weak_guard_only",
            label: "Baseline weak guard only",
            selectSignal: ({ snapshot, indicators }) => {
                const trend = topTrendCandidateLegacyBaseline(snapshot, indicators);
                return trend?.eligible ? {
                    side: "trend",
                    symbol: trend.symbol,
                    subVariant: "legacy-trend-weak-guard",
                    reason: trend.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                    if (snapshot.weak2022Regime && snapshot.bestMom20 < 0.05 && snapshot.btc.adx14 < 18) return "weak-trend-off";
                }
                return null;
            },
        },
        {
            name: "baseline_link_strong_regime",
            label: "Baseline + LINK in strong regime",
            selectSignal: ({ snapshot, indicators }) => {
                const legacy = topTrendCandidateLegacyBaseline(snapshot, indicators);
                if (snapshot.regimeLabel !== "trend_strong") {
                    return legacy?.eligible ? {
                        side: "trend",
                        symbol: legacy.symbol,
                        subVariant: "legacy-trend",
                        reason: legacy.reasons,
                    } : null;
                }

                const expanded = topTrendCandidateFromSymbols(snapshot, indicators, ["ETH", "SOL", "AVAX", "LINK"]);
                const linkBar = latestIndicatorAtOrBefore(indicators.LINK, snapshot.ts);
                const linkStrong =
                    !!linkBar &&
                    linkBar.close > linkBar.sma45 &&
                    linkBar.mom20 > 0.03 &&
                    linkBar.volume > linkBar.volAvg20;

                const picked =
                    expanded?.eligible &&
                    (expanded.symbol !== "LINK" || linkStrong)
                        ? expanded
                        : legacy;

                return picked?.eligible ? {
                    side: "trend",
                    symbol: picked.symbol,
                    subVariant: "link-strong-regime",
                    reason: picked.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                return null;
            },
        },
        {
            name: "baseline_bnb_link_strong_regime",
            label: "Baseline + BNB/LINK in strong regime",
            selectSignal: ({ snapshot, indicators }) => {
                const legacy = topTrendCandidateLegacyBaseline(snapshot, indicators);
                if (snapshot.regimeLabel !== "trend_strong") {
                    return legacy?.eligible ? {
                        side: "trend",
                        symbol: legacy.symbol,
                        subVariant: "legacy-trend",
                        reason: legacy.reasons,
                    } : null;
                }

                const expanded = topTrendCandidate(snapshot, indicators);
                const bnbBar = latestIndicatorAtOrBefore(indicators.BNB, snapshot.ts);
                const linkBar = latestIndicatorAtOrBefore(indicators.LINK, snapshot.ts);
                const altStrong =
                    expanded?.symbol === "BNB"
                        ? !!bnbBar && bnbBar.close > bnbBar.sma45 && bnbBar.mom20 > 0.05 && bnbBar.volume > bnbBar.volAvg20 * 1.05
                        : expanded?.symbol === "LINK"
                            ? !!linkBar && linkBar.close > linkBar.sma45 && linkBar.mom20 > 0.03 && linkBar.volume > linkBar.volAvg20
                            : true;

                const picked =
                    expanded?.eligible && altStrong
                        ? expanded
                        : legacy;

                return picked?.eligible ? {
                    side: "trend",
                    symbol: picked.symbol,
                    subVariant: "bnb-link-strong-regime",
                    reason: picked.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                return null;
            },
        },
        {
            name: "baseline_ethsol_range_guarded",
            label: "Baseline + ETH/SOL range guarded",
            selectSignal: ({ snapshot, indicators, priorWeak2022Regime }) => {
                const trend = topTrendCandidateLegacyBaseline(snapshot, indicators);
                if (trend?.eligible) {
                    return {
                        side: "trend",
                        symbol: trend.symbol,
                        subVariant: "legacy-trend",
                        reason: trend.reasons,
                    };
                }

                const persistentWeak = snapshot.weak2022Regime && priorWeak2022Regime;
                const allowRange =
                    snapshot.rangeAllowed &&
                    snapshot.regimeLabel === "range_only" &&
                    persistentWeak &&
                    snapshot.btc.adx14 < 17 &&
                    snapshot.bestMom20 < -0.05;
                if (!allowRange) return null;

                const range = pickRangeCandidate(snapshot, indicators, ETH_SOL, 0.02);
                return range?.eligible ? {
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "ethsol-range-guarded",
                    reason: [...range.reasons, "persistent-weak"],
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                if (position.side === "range") {
                    if (bar.close >= bar.sma45) return "mean-revert";
                    if (bar.mom20 > 0.02) return "range-momentum";
                    if (index - position.entryIndex >= 8) return "range-time";
                }
                return null;
            },
        },
        {
            name: "eth_range_strict",
            label: "ETH range strict",
            selectSignal: ({ snapshot, indicators }) => {
                const trend = topTrendCandidate(snapshot, indicators);
                if (trend?.eligible) {
                    return {
                        side: "trend",
                        symbol: trend.symbol,
                        subVariant: "trend",
                        reason: trend.reasons,
                    };
                }
                const range = pickRangeCandidate(snapshot, indicators, ETH_ONLY, 0.03);
                return range?.eligible ? {
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "range-strict",
                    reason: range.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                if (position.side === "range") {
                    if (bar.close >= bar.sma45) return "mean-revert";
                    if (bar.mom20 > 0.03) return "range-momentum";
                    if (index - position.entryIndex >= 16) return "range-time";
                }
                return null;
            },
        },
        {
            name: "eth_range_early_exit",
            label: "ETH range early exit",
            selectSignal: ({ snapshot, indicators }) => {
                const trend = topTrendCandidate(snapshot, indicators);
                if (trend?.eligible) {
                    return {
                        side: "trend",
                        symbol: trend.symbol,
                        subVariant: "trend",
                        reason: trend.reasons,
                    };
                }
                const range = pickRangeCandidate(snapshot, indicators, ETH_ONLY, 0.02);
                return range?.eligible ? {
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "range-early",
                    reason: range.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                if (position.side === "range") {
                    if (bar.close >= bar.sma45) return "mean-revert";
                    if (bar.mom20 > 0.02) return "range-momentum";
                    if (index - position.entryIndex >= 8) return "range-time";
                }
                return null;
            },
        },
        {
            name: "eth_range_trend_priority",
            label: "ETH range trend priority",
            selectSignal: ({ snapshot, indicators, priorWeak2022Regime }) => {
                const trend = topTrendCandidate(snapshot, indicators);
                if (trend?.eligible) {
                    return {
                        side: "trend",
                        symbol: trend.symbol,
                        subVariant: "trend",
                        reason: trend.reasons,
                    };
                }
                const persistentWeak2022Regime = snapshot.weak2022Regime && priorWeak2022Regime;
                const rangeAllowed = snapshot.rangeAllowed && snapshot.regimeLabel === "range_only" && persistentWeak2022Regime;
                if (!rangeAllowed) return null;
                const range = pickRangeCandidate(snapshot, indicators, ETH_ONLY, 0.03);
                return range?.eligible ? {
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "range-trend-priority",
                    reason: range.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                if (position.side === "range") {
                    if (bar.close >= bar.sma45) return "mean-revert";
                    if (bar.mom20 > 0.03) return "range-momentum";
                    if (index - position.entryIndex >= 12) return "range-time";
                }
                return null;
            },
        },
        {
            name: "hybrid_trend_priority_v2_best",
            label: "Hybrid trend priority v2 (best)",
            selectSignal: ({ snapshot, indicators }) => {
                const trend = topTrendCandidate(snapshot, indicators);
                if (trend?.eligible) {
                    return {
                        side: "trend",
                        symbol: trend.symbol,
                        subVariant: "trend-v2-best",
                        reason: trend.reasons,
                    };
                }
                const rangeAllowed = snapshot.rangeAllowed && snapshot.regimeLabel === "range_only";
                if (!rangeAllowed) return null;
                const range = pickRangeCandidate(snapshot, indicators, ETH_ONLY, 0.03);
                return range?.eligible ? {
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "range-v2-best",
                    reason: range.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma40) return "sma40-break";
                }
                if (position.side === "range") {
                    if (bar.close >= bar.sma45) return "mean-revert";
                    if (bar.mom20 > 0.03) return "range-momentum";
                    if (index - position.entryIndex >= 10) return "range-time";
                }
                return null;
            },
        },
        {
            name: "eth_range_trend_priority_no_bnb_entry",
            label: "ETH range trend priority no BNB entry",
            selectSignal: ({ snapshot, indicators, priorWeak2022Regime }) => {
                const trend = topTrendCandidateFromSymbols(snapshot, indicators, ["ETH", "SOL", "AVAX", "LINK"]);
                if (trend?.eligible) {
                    return {
                        side: "trend",
                        symbol: trend.symbol,
                        subVariant: "trend-no-bnb",
                        reason: trend.reasons,
                    };
                }
                const persistentWeak2022Regime = snapshot.weak2022Regime && priorWeak2022Regime;
                const rangeAllowed = snapshot.rangeAllowed && snapshot.regimeLabel === "range_only" && persistentWeak2022Regime;
                if (!rangeAllowed) return null;
                const range = pickRangeCandidate(snapshot, indicators, ETH_ONLY, 0.03);
                return range?.eligible ? {
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "range-trend-priority-no-bnb",
                    reason: range.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                if (position.side === "range") {
                    if (bar.close >= bar.sma45) return "mean-revert";
                    if (bar.mom20 > 0.03) return "range-momentum";
                    if (index - position.entryIndex >= 12) return "range-time";
                }
                return null;
            },
        },
        {
            name: "eth_range_trend_priority_bnb_strong_only",
            label: "ETH range trend priority BNB strong only",
            selectSignal: ({ snapshot, indicators, priorWeak2022Regime }) => {
                const strong = snapshot.trendAllowed && snapshot.regimeLabel === "trend_strong";
                const weak = snapshot.trendAllowed && snapshot.regimeLabel === "trend_weak";
                const trend = strong
                    ? topTrendCandidate(snapshot, indicators)
                    : weak
                        ? topTrendCandidateFromSymbols(snapshot, indicators, ["ETH", "SOL", "AVAX", "LINK"])
                        : null;
                if (trend?.eligible) {
                    const bnbBar = latestIndicatorAtOrBefore(indicators.BNB, snapshot.ts);
                    const bnbStrongOk = !bnbBar
                        ? false
                        : trend.symbol !== "BNB" || (bnbBar.close > bnbBar.sma45 && bnbBar.mom20 > 0.03 && bnbBar.volume > bnbBar.volAvg20);
                    if (bnbStrongOk) {
                        return {
                            side: "trend",
                            symbol: trend.symbol,
                            subVariant: "trend-bnb-strong",
                            reason: trend.reasons,
                        };
                    }
                }
                const persistentWeak2022Regime = snapshot.weak2022Regime && priorWeak2022Regime;
                const rangeAllowed = snapshot.rangeAllowed && snapshot.regimeLabel === "range_only" && persistentWeak2022Regime;
                if (!rangeAllowed) return null;
                const range = pickRangeCandidate(snapshot, indicators, ETH_ONLY, 0.03);
                return range?.eligible ? {
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "range-trend-priority-bnb-strong",
                    reason: range.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                if (position.side === "range") {
                    if (bar.close >= bar.sma45) return "mean-revert";
                    if (bar.mom20 > 0.03) return "range-momentum";
                    if (index - position.entryIndex >= 12) return "range-time";
                }
                return null;
            },
        },
        {
            name: "no_bnb_range_strict",
            label: "No-BNB range strict",
            selectSignal: ({ snapshot, indicators }) => {
                const trend = topTrendCandidateFromSymbols(snapshot, indicators, NO_BNB_SYMBOLS);
                if (trend?.eligible) {
                    return {
                        side: "trend",
                        symbol: trend.symbol,
                        subVariant: "trend-no-bnb",
                        reason: trend.reasons,
                    };
                }
                const range = pickRangeCandidate(snapshot, indicators, ETH_ONLY, 0.03);
                return range?.eligible ? {
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "range-no-bnb-strict",
                    reason: range.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                if (position.side === "range") {
                    if (bar.close >= bar.sma45) return "mean-revert";
                    if (bar.mom20 > 0.03) return "range-momentum";
                    if (index - position.entryIndex >= 16) return "range-time";
                }
                return null;
            },
        },
        {
            name: "no_bnb_range_early",
            label: "No-BNB range early",
            selectSignal: ({ snapshot, indicators }) => {
                const trend = topTrendCandidateFromSymbols(snapshot, indicators, NO_BNB_SYMBOLS);
                if (trend?.eligible) {
                    return {
                        side: "trend",
                        symbol: trend.symbol,
                        subVariant: "trend-no-bnb",
                        reason: trend.reasons,
                    };
                }
                const range = pickRangeCandidate(snapshot, indicators, ETH_ONLY, 0.02);
                return range?.eligible ? {
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "range-no-bnb-early",
                    reason: range.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                if (position.side === "range") {
                    if (bar.close >= bar.sma45) return "mean-revert";
                    if (bar.mom20 > 0.02) return "range-momentum";
                    if (index - position.entryIndex >= 8) return "range-time";
                }
                return null;
            },
        },
        {
            name: "no_bnb_trend_loose_range_priority",
            label: "No-BNB trend loose + range priority",
            selectSignal: ({ snapshot, indicators, priorWeak2022Regime }) => {
                const trend = topTrendCandidateNoBnbLoose(snapshot, indicators);
                if (trend?.eligible) {
                    return {
                        side: "trend",
                        symbol: trend.symbol,
                        subVariant: "trend-no-bnb-loose",
                        reason: trend.reasons,
                    };
                }
                const persistentWeak2022Regime = snapshot.weak2022Regime && priorWeak2022Regime;
                const rangeAllowed = snapshot.rangeAllowed && snapshot.regimeLabel === "range_only" && persistentWeak2022Regime;
                if (!rangeAllowed) return null;
                const range = pickRangeCandidate(snapshot, indicators, ETH_LINK, 0.025);
                return range?.eligible ? {
                    side: "range",
                    symbol: range.symbol,
                    subVariant: "range-no-bnb-loose",
                    reason: range.reasons,
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (position.side === "trend") {
                    if (!snapshot.trendAllowed) return "risk-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                }
                if (position.side === "range") {
                    if (bar.close >= bar.sma45) return "mean-revert";
                    if (bar.mom20 > 0.025) return "range-momentum";
                    if (index - position.entryIndex >= 12) return "range-time";
                }
                return null;
            },
        },
        {
            name: "vol_compression_breakout",
            label: "Volatility compression breakout",
            selectSignal: ({ snapshot, indicators }) => {
                if (!snapshot.trendAllowed) return null;
                const candidates = TRADE_SYMBOLS.map((symbol) => {
                    const bars = indicators[symbol];
                    const idx = findSeriesIndex(bars, snapshot.ts);
                    if (idx < 6) return null;
                    const bar = bars[idx];
                    if (!bar || !bar.ready) return null;
                    const prevHigh = highestHigh(bars, idx, 6);
                    const breakout = bar.close > prevHigh * 1.002;
                    const compressed = bar.adx14 <= 18 && Math.abs(bar.mom20) < 0.12 && bar.volume > bar.volAvg20 * 0.9;
                    if (!breakout || !compressed) return null;
                    const score = ((bar.close / Math.max(1, prevHigh)) - 1) * 100 + (bar.volume / Math.max(1, bar.volAvg20)) * 5 + (18 - bar.adx14);
                    return { symbol, bar, score };
                }).filter((item): item is NonNullable<typeof item> => item !== null);
                const top = candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))[0];
                return top ? {
                    side: "trend",
                    symbol: top.symbol,
                    subVariant: "breakout",
                    reason: ["breakout"],
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (!snapshot.trendAllowed) return "risk-off";
                if (bar.close <= bar.sma45) return "sma-break";
                if (index - position.entryIndex >= 12) return "time-exit";
                return null;
            },
        },
        {
            name: "relative_strength_rotation",
            label: "Relative strength rotation",
            selectSignal: ({ snapshot, indicators }) => {
                if (!snapshot.trendAllowed) return null;
                const btcMom = snapshot.btc.mom20;
                const candidates = TRADE_SYMBOLS.map((symbol) => {
                    const bar = latestIndicatorAtOrBefore(indicators[symbol], snapshot.ts);
                    if (!bar || !bar.ready) return null;
                    const score = (bar.mom20 - btcMom) * 120 + (bar.momAccel * 80) + ((bar.close / Math.max(1, bar.sma40)) - 1) * 100 + (bar.adx14 / 5);
                    return { symbol, bar, score };
                }).filter((item): item is NonNullable<typeof item> => item !== null);
                const top = candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))[0];
                return top && top.score > 0 ? {
                    side: "trend",
                    symbol: top.symbol,
                    subVariant: "rotation",
                    reason: ["relative-strength"],
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (!snapshot.trendAllowed) return "risk-off";
                if (bar.close <= bar.sma45) return "sma-break";
                return null;
            },
        },
        {
            name: "relative_strength_rotation_strict",
            label: "Relative strength rotation strict",
            selectSignal: ({ snapshot, indicators }) => {
                if (!snapshot.trendAllowed) return null;
                if (snapshot.regimeLabel !== "trend_strong") return null;
                const btcMom = snapshot.btc.mom20;
                const candidates = TRADE_SYMBOLS.map((symbol) => {
                    const bar = latestIndicatorAtOrBefore(indicators[symbol], snapshot.ts);
                    if (!bar || !bar.ready) return null;
                    const relativeMom = bar.mom20 - btcMom;
                    const score = (relativeMom * 140) + (bar.momAccel * 75) + (((bar.close / Math.max(1, bar.sma40)) - 1) * 100) + (bar.adx14 / 4) + (bar.volume / Math.max(1, bar.volAvg20) - 1) * 10;
                    return { symbol, bar, score };
                }).filter((item): item is NonNullable<typeof item> => item !== null);
                const sorted = candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
                const top = sorted[0];
                const runnerUp = sorted[1];
                const spread = top && runnerUp ? top.score - runnerUp.score : top?.score || 0;
                return top && top.score > 25 && spread >= 18 && top.bar.mom20 > 0.08 && top.bar.adx14 >= 20 ? {
                    side: "trend",
                    symbol: top.symbol,
                    subVariant: "rotation-strict",
                    reason: ["relative-strength", "trend-strong"],
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index, trendCandidate }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (!snapshot.trendAllowed) return "risk-off";
                if (snapshot.regimeLabel !== "trend_strong" && trendCandidate?.symbol !== position.symbol) return "trend-weak";
                if (bar.close <= bar.sma45) return "sma-break";
                if (bar.mom20 < 0.02 && bar.adx14 < 18) return "momentum-off";
                if (index - position.entryIndex >= 16) return "time-exit";
                return null;
            },
        },
        {
            name: "relative_strength_rotation_persistent",
            label: "Relative strength rotation persistent",
            selectSignal: ({ snapshot, indicators }) => {
                if (!snapshot.trendAllowed) return null;
                const btcMom = snapshot.btc.mom20;
                const candidates = TRADE_SYMBOLS.map((symbol) => {
                    const bars = indicators[symbol];
                    const idx = findSeriesIndex(bars, snapshot.ts);
                    if (idx < 1) return null;
                    const bar = bars[idx];
                    const prev = bars[idx - 1];
                    if (!bar || !bar.ready || !prev || !prev.ready) return null;
                    const score = (bar.mom20 - btcMom) * 120 + (bar.momAccel * 60) + ((bar.close / Math.max(1, bar.sma40) - 1) * 100) + (bar.adx14 / 5);
                    const prevScore = (prev.mom20 - btcMom) * 120 + (prev.momAccel * 60) + ((prev.close / Math.max(1, prev.sma40) - 1) * 100) + (prev.adx14 / 5);
                    return { symbol, bar, score, prevScore };
                }).filter((item): item is NonNullable<typeof item> => item !== null);
                const sorted = candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
                const top = sorted[0];
                const runnerUp = sorted[1];
                const spread = top && runnerUp ? top.score - runnerUp.score : top?.score || 0;
                return top && top.score > 12 && top.prevScore > 8 && top.bar.mom20 > 0.04 && spread >= 10 ? {
                    side: "trend",
                    symbol: top.symbol,
                    subVariant: "rotation-persistent",
                    reason: ["relative-strength", "persistence"],
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index, trendCandidate }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (!snapshot.trendAllowed) return "risk-off";
                if (bar.close <= bar.sma45) return "sma-break";
                if (trendCandidate && trendCandidate.symbol !== position.symbol && trendCandidate.score > 12) return "rotation-switch";
                if (bar.mom20 < 0.02 && bar.adx14 < 18) return "momentum-off";
                if (index - position.entryIndex >= 18) return "time-exit";
                return null;
            },
        },
        {
            name: "trend_priority_rotation_boost",
            label: "Trend priority rotation boost",
            selectSignal: ({ snapshot, indicators }) => {
                const trend = topTrendCandidate(snapshot, indicators);
                if (trend?.eligible) {
                    return {
                        side: "trend",
                        symbol: trend.symbol,
                        subVariant: "trend",
                        reason: trend.reasons,
                    };
                }
                if (!snapshot.trendAllowed || snapshot.regimeLabel !== "trend_strong") return null;
                const btcMom = snapshot.btc.mom20;
                const candidates = TRADE_SYMBOLS.map((symbol) => {
                    const bar = latestIndicatorAtOrBefore(indicators[symbol], snapshot.ts);
                    if (!bar || !bar.ready) return null;
                    const score = (bar.mom20 - btcMom) * 130 + (bar.momAccel * 90) + ((bar.close / Math.max(1, bar.sma40) - 1) * 100) + (bar.adx14 / 4);
                    return { symbol, bar, score };
                }).filter((item): item is NonNullable<typeof item> => item !== null);
                const top = candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))[0];
                return top && top.score > 25 ? {
                    side: "trend",
                    symbol: top.symbol,
                    subVariant: "rotation-boost",
                    reason: ["relative-strength", "trend-priority"],
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index, trendCandidate }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (!snapshot.trendAllowed) return "risk-off";
                if (bar.close <= bar.sma45) return "sma-break";
                if (trendCandidate && trendCandidate.symbol !== position.symbol && trendCandidate.score > 12) return "trend-switch";
                if (bar.mom20 < 0.03 && bar.adx14 < 18) return "momentum-off";
                if (index - position.entryIndex >= 16) return "time-exit";
                return null;
            },
        },
        {
            name: "regime_gated_rotation",
            label: "Regime gated rotation",
            selectSignal: ({ snapshot, indicators }) => {
                if (!snapshot.trendAllowed) return null;
                if (snapshot.regimeLabel === "range_only" || snapshot.regimeLabel === "ambiguous") return null;
                const allowedSymbols = snapshot.regimeLabel === "trend_strong" ? TRADE_SYMBOLS : ETH_SOL;
                const btcMom = snapshot.btc.mom20;
                const candidates = allowedSymbols.map((symbol) => {
                    const bar = latestIndicatorAtOrBefore(indicators[symbol], snapshot.ts);
                    if (!bar || !bar.ready) return null;
                    const score = (bar.mom20 - btcMom) * 120 + (bar.momAccel * 70) + ((bar.close / Math.max(1, bar.sma40) - 1) * 90) + (bar.adx14 / 5);
                    return { symbol, bar, score };
                }).filter((item): item is NonNullable<typeof item> => item !== null);
                const top = candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))[0];
                return top && top.score > 18 ? {
                    side: "trend",
                    symbol: top.symbol,
                    subVariant: "regime-gated",
                    reason: ["relative-strength", snapshot.regimeLabel],
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (!snapshot.trendAllowed) return "risk-off";
                if (snapshot.regimeLabel === "range_only" || snapshot.regimeLabel === "ambiguous") return "regime-off";
                if (bar.close <= bar.sma45) return "sma-break";
                if (bar.mom20 < 0.02) return "momentum-off";
                if (index - position.entryIndex >= 20) return "time-exit";
                return null;
            },
        },
        {
            name: "five_asset_regime_rotation",
            label: "Five asset regime rotation",
            selectSignal: ({ snapshot, indicators }) => {
                const regime = deriveFiveAssetRegime(snapshot, indicators);
                if (!regime || regime.label === "ambiguous") return null;
                if (regime.label === "range_only") {
                    const range = pickRangeCandidate(snapshot, indicators, ETH_BNB, 0.02);
                    return range?.eligible ? {
                        side: "range",
                        symbol: range.symbol,
                        subVariant: "five-range",
                        reason: ["five-regime", "range-only", ...range.reasons],
                    } : null;
                }

                const btcMom = snapshot.btc.mom20;
                const bars = regime.symbols.map((symbol) => {
                    const bar = latestIndicatorAtOrBefore(indicators[symbol], snapshot.ts);
                    if (!bar || !bar.ready) return null;
                    const baseEligible = bar.close > bar.sma40 && bar.mom20 > 0;
                    const avaxOk = symbol !== "AVAX" || (regime.label === "trend_strong" && bar.mom20 > 0.25 && bar.volume > bar.volAvg20);
                    const solOk = symbol !== "SOL" || bar.overheatPct <= (regime.label === "trend_strong" ? 0.35 : 0.25);
                    const bnbOk = symbol !== "BNB" || (bar.mom20 > 0.02 && bar.close > bar.sma45);
                    const linkOk = symbol !== "LINK" || (bar.mom20 > 0.01 && bar.close > bar.sma45 && bar.volume > bar.volAvg20 * 0.85);
                    const eligible = snapshot.trendAllowed && baseEligible && avaxOk && solOk && bnbOk && linkOk;
                    const score = (bar.mom20 - btcMom) * 130 + (bar.momAccel * 80) + ((bar.close / Math.max(1, bar.sma40)) - 1) * 100 + (bar.adx14 / 5);
                    return { symbol, bar, eligible, score, reasons: [`${symbol.toLowerCase()}-five`, "regime-" + regime.label] };
                }).filter((item): item is NonNullable<typeof item> => item !== null);
                const eligible = bars.filter((item) => item.eligible).sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
                const top = eligible[0];
                if (!top) return null;
                const threshold = regime.label === "trend_strong" ? 18 : 12;
                return top.score > threshold ? {
                    side: "trend",
                    symbol: top.symbol,
                    subVariant: "five-regime",
                    reason: [...top.reasons, `score>${threshold}`],
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index, indicators }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                const regime = deriveFiveAssetRegime(snapshot, indicators);
                if (!regime) return null;
                if (position.side === "trend") {
                    if (!regime.trendEligible) return "regime-off";
                    if (bar.close <= bar.sma45) return "sma-break";
                    if (regime.label === "trend_weak" && bar.mom20 < 0.02 && bar.adx14 < 18) return "momentum-off";
                    if (index - position.entryIndex >= 18) return "time-exit";
                }
                if (position.side === "range") {
                    if (!regime.rangeEligible) return "range-off";
                    if (bar.close >= bar.sma45) return "mean-revert";
                    if (bar.mom20 > 0.02) return "range-momentum";
                    if (index - position.entryIndex >= 10) return "range-time";
                }
                return null;
            },
        },
        ...buildTrendPriorityOptimizationStrategies(),
        ...buildTrendSelectorOptimizationStrategies(),
        ...buildTrendRiskOptimizationStrategies(),
        ...buildNoBnbAdaptiveStrategies(),
        {
            name: "pullback_only",
            label: "Pullback only",
            selectSignal: ({ snapshot, indicators }) => {
                if (!snapshot.trendAllowed) return null;
                const candidates = TRADE_SYMBOLS.map((symbol) => {
                    const bar = latestIndicatorAtOrBefore(indicators[symbol], snapshot.ts);
                    if (!bar || !bar.ready) return null;
                    const bullish = bar.close > bar.sma90 && bar.mom20 > 0;
                    const pullback = bar.close < bar.sma45 && bar.close > bar.sma90 && bar.overheatPct < 0.12;
                    if (!bullish || !pullback) return null;
                    const score = (bar.mom20 * 100) + ((bar.close / Math.max(1, bar.sma45)) - 1) * 100 + (bar.adx14 / 10);
                    return { symbol, bar, score };
                }).filter((item): item is NonNullable<typeof item> => item !== null);
                const top = candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))[0];
                return top ? {
                    side: "trend",
                    symbol: top.symbol,
                    subVariant: "pullback",
                    reason: ["trend-pullback"],
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (!snapshot.trendAllowed) return "risk-off";
                if (bar.close <= bar.sma45) return "sma-break";
                if (bar.mom20 < 0) return "momentum-off";
                return null;
            },
        },
        {
            name: "breakout_plus_rotation",
            label: "Breakout + rotation",
            selectSignal: ({ snapshot, indicators }) => {
                if (!snapshot.trendAllowed) return null;
                const btcMom = snapshot.btc.mom20;
                const candidates = TRADE_SYMBOLS.map((symbol) => {
                    const bars = indicators[symbol];
                    const idx = findSeriesIndex(bars, snapshot.ts);
                    if (idx < 6) return null;
                    const bar = bars[idx];
                    if (!bar || !bar.ready) return null;
                    const prevHigh = highestHigh(bars, idx, 6);
                    const breakout = bar.close > prevHigh * 1.002;
                    const compressed = bar.adx14 <= 18 && Math.abs(bar.mom20) < 0.12 && bar.volume > bar.volAvg20 * 0.9;
                    if (!breakout || !compressed) return null;
                    const score = (bar.mom20 - btcMom) * 120 + (bar.momAccel * 80) + ((bar.close / Math.max(1, prevHigh)) - 1) * 100;
                    return { symbol, bar, score };
                }).filter((item): item is NonNullable<typeof item> => item !== null);
                const top = candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))[0];
                return top ? {
                    side: "trend",
                    symbol: top.symbol,
                    subVariant: "breakout-rotation",
                    reason: ["breakout", "relative-strength"],
                } : null;
            },
            selectExitReason: ({ snapshot, currentBars, position, index }) => {
                const bar = position.symbol ? currentBars[position.symbol as Exclude<TradeSymbol, "BTC">] : null;
                if (!bar) return null;
                if (!snapshot.trendAllowed) return "risk-off";
                if (bar.close <= bar.sma45) return "sma-break";
                if (index - position.entryIndex >= 12) return "time-exit";
                return null;
            },
        },
    ];
}

async function main() {
    const { bySymbol, indicators, timeline } = await loadSeries();
    const rate = feeRate();
    const strategies = makeStrategies();
    const results = [] as StrategyResult[];

    for (const strategy of strategies) {
        // eslint-disable-next-line no-await-in-loop
        const result = await runStrategy(strategy, bySymbol, indicators, timeline, rate);
        results.push(result);
    }

    const reportDir = path.join(process.cwd(), "reports", "strategy-suite");
    await fs.mkdir(reportDir, { recursive: true });
    const summaryPath = path.join(reportDir, "summary.json");
    const comparisonPath = path.join(reportDir, "comparison.md");
    await fs.writeFile(summaryPath, JSON.stringify(results.map((result) => result.summary), null, 2), "utf8");

    const mdLines = [
        "# Strategy suite comparison",
        "",
        "| Strategy | End Equity | CAGR | MaxDD | PF | Trades |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
        ...results.map((result) => `| ${result.name} | ${result.summary.end_equity.toFixed(2)} | ${result.summary.cagr_pct.toFixed(2)}% | ${result.summary.max_drawdown_pct.toFixed(2)}% | ${result.summary.profit_factor.toFixed(2)} | ${result.summary.trade_count} |`),
        "",
        "## Annual Returns",
        ...results.flatMap((result) => [
            `### ${result.name}`,
            ...result.annual_returns.map((row) => `- ${row.period}: ${row.return_pct.toFixed(2)}%`),
            "",
        ]),
    ].join("\n");
    await fs.writeFile(comparisonPath, mdLines, "utf8");

    console.log(JSON.stringify({
        results: results.map((result) => result.summary),
        files: {
            summaryPath,
            comparisonPath,
        },
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

