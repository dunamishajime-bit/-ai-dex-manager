import fs from "fs/promises";
import path from "path";

import { RECLAIM_HYBRID_EXECUTION_PROFILE } from "@/config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "@/lib/backtest/binance-source";
import { buildIndicatorBars, resampleTo12h } from "@/lib/backtest/indicators";
import type { Candle1h, Candle12h, EquityPoint, IndicatorBar, PeriodReturnRow, TradeEventRow, TradePairRow } from "@/lib/backtest/types";

type TradeSymbol = "BTC" | "ETH" | "SOL" | "AVAX" | "BNB" | "LINK";
type VariantName = "no_gpt" | "gpt_proxy";

type ShortMomentumSignal = {
    r1: number;
    r5: number;
    r15: number;
    r60: number;
    score: number;
    confidence: number;
};

type HourlyIndicatorBar = Candle1h & {
    ema12: number;
    ema26: number;
    ema50: number;
    ema200: number;
    rsi14: number;
    macdLine: number;
    macdSignal: number;
    macdHist: number;
    atrPct: number;
};

type VariantResult = {
    name: VariantName;
    label: string;
    trade_events: TradeEventRow[];
    trade_pairs: TradePairRow[];
    equity_curve: EquityPoint[];
    annual_returns: PeriodReturnRow[];
    monthly_returns: PeriodReturnRow[];
    summary: {
        name: VariantName;
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

const BASE_EQUITY = 10_000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_HOLD_HOURS = 12;
const STOP_LOSS_PCT = 5;
const TAKE_PROFIT_PCT = 8;
const LOOKBACK_SYMBOLS: TradeSymbol[] = ["ETH", "SOL", "AVAX", "BNB", "LINK"];
const ALL_SYMBOLS: TradeSymbol[] = ["BTC", "ETH", "SOL", "AVAX", "BNB", "LINK"];

const LOCAL_ZIP_PATHS: Record<TradeSymbol, string | null> = {
    BTC: path.join("C:\\Users\\dis\\Desktop", "2022BTC.zip"),
    ETH: path.join("C:\\Users\\dis\\Desktop", "2022ETH.zip"),
    SOL: path.join("C:\\Users\\dis\\Desktop", "2022SOL.zip"),
    AVAX: null,
    BNB: null,
    LINK: null,
};

const REPORT_DIR = path.join(process.cwd(), "reports", "live-1h-gpt-compare");

function average(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sum(values: number[]) {
    return values.reduce((total, value) => total + value, 0);
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function formatIso(ts: number) {
    return new Date(ts).toISOString();
}

function stepRound(value: number, stepSize: number) {
    return Math.floor(value / stepSize) * stepSize;
}

function emaSeries(values: number[], period: number) {
    if (!values.length) return [] as number[];
    if (period <= 1) return [...values];
    const out: number[] = [];
    const multiplier = 2 / (period + 1);
    let current = average(values.slice(0, Math.min(period, values.length)));
    for (let index = 0; index < values.length; index += 1) {
        if (index < period - 1) {
            out.push(current);
            continue;
        }
        if (index === period - 1) {
            out.push(current);
            continue;
        }
        current = (values[index] - current) * multiplier + current;
        out.push(current);
    }
    while (out.length < values.length) out.push(current);
    return out;
}

function rsiSeries(values: number[], period = 14) {
    const out = Array.from({ length: values.length }, () => 50);
    if (values.length <= period) return out;

    let gains = 0;
    let losses = 0;
    for (let index = 1; index <= period; index += 1) {
        const diff = values[index] - values[index - 1];
        if (diff >= 0) gains += diff;
        else losses += Math.abs(diff);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    const firstIndex = period;
    out[firstIndex] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
    for (let index = firstIndex + 1; index < values.length; index += 1) {
        const diff = values[index] - values[index - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;
        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;
        out[index] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
    }
    return out;
}

function macdSeries(values: number[]) {
    const ema12 = emaSeries(values, 12);
    const ema26 = emaSeries(values, 26);
    const line = values.map((_, index) => (ema12[index] || 0) - (ema26[index] || 0));
    const signal = emaSeries(line, 9);
    return {
        line,
        signal,
        histogram: line.map((value, index) => value - (signal[index] || 0)),
    };
}

function atrProxyPctSeries(values: number[], period = 14) {
    const out = Array.from({ length: values.length }, () => 0);
    const ranges: number[] = [];
    for (let index = 1; index < values.length; index += 1) {
        const prev = values[index - 1];
        const current = values[index];
        if (prev > 0) ranges.push(Math.abs(current - prev) / prev);
        if (ranges.length >= period) {
            out[index] = average(ranges.slice(-period));
        }
    }
    return out;
}

function shortMomentumSeries(values: number[]) {
    const out = Array.from({ length: values.length }, (): ShortMomentumSignal => ({
        r1: 0,
        r5: 0,
        r15: 0,
        r60: 0,
        score: 0,
        confidence: 0,
    }));

    for (let index = 0; index < values.length; index += 1) {
        const lookup = (barsAgo: number) => {
            const target = index - barsAgo;
            if (target < 0) return values[0] || values[index] || 0;
            return values[target] || values[index] || 0;
        };

        const p1 = lookup(1);
        const p5 = lookup(5);
        const p15 = lookup(15);
        const p60 = lookup(60);
        const current = values[index] || 0;
        const r1 = p1 > 0 ? (current - p1) / p1 : 0;
        const r5 = p5 > 0 ? (current - p5) / p5 : 0;
        const r15 = p15 > 0 ? (current - p15) / p15 : 0;
        const r60 = p60 > 0 ? (current - p60) / p60 : 0;
        const score = r1 * 0.2 + r5 * 0.25 + r15 * 0.25 + r60 * 0.3;
        const sampleCoverage = Math.min(1, index / 30);
        const moveStrength = Math.min(1, (Math.abs(r1) + Math.abs(r5) + Math.abs(r15) + Math.abs(r60)) * 90);
        const confidence = Number((sampleCoverage * moveStrength).toFixed(3));
        out[index] = { r1, r5, r15, r60, score, confidence };
    }

    return out;
}

function buildHourlyIndicators(rawBars: Candle1h[]) {
    const closes = rawBars.map((bar) => bar.close);
    const ema12 = emaSeries(closes, 12);
    const ema26 = emaSeries(closes, 26);
    const ema50 = emaSeries(closes, 50);
    const ema200 = emaSeries(closes, 200);
    const rsi14 = rsiSeries(closes, 14);
    const macd = macdSeries(closes);
    const atrPct = atrProxyPctSeries(closes, 14);

    return rawBars.map((bar, index) => ({
        ...bar,
        ema12: ema12[index] || 0,
        ema26: ema26[index] || 0,
        ema50: ema50[index] || 0,
        ema200: ema200[index] || 0,
        rsi14: rsi14[index] || 0,
        macdLine: macd.line[index] || 0,
        macdSignal: macd.signal[index] || 0,
        macdHist: macd.histogram[index] || 0,
        atrPct: atrPct[index] || 0,
    })) satisfies HourlyIndicatorBar[];
}

function build12hTimeline(rawBars: Candle1h[]) {
    const bars12h = resampleTo12h(rawBars);
    const indicators12h = buildIndicatorBars(bars12h);
    return { bars12h, indicators12h };
}

function is12hBoundary(index: number) {
    return (index + 1) % 12 === 0;
}

function buildEquityPoint(
    ts: number,
    equity: number,
    cash: number,
    positionSymbol: string,
    positionSide: "trend" | "cash",
    positionQty: number,
    positionEntryPrice: number,
) {
    return {
        ts,
        iso_time: formatIso(ts),
        equity,
        cash,
        position_symbol: positionSymbol,
        position_side: positionSide,
        position_qty: positionQty,
        position_entry_price: positionEntryPrice,
    } satisfies EquityPoint;
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

function calcCagrPct(startEquity: number, endEquity: number, startTs: number, endTs: number) {
    const periodDays = Math.max(1, (endTs - startTs) / (24 * HOUR_MS));
    return (Math.pow(endEquity / startEquity, 365 / periodDays) - 1) * 100;
}

async function loadSeries() {
    const startTs = Date.UTC(2022, 0, 1, 0, 0, 0);
    const endTs = Date.UTC(2026, 0, 1, 0, 0, 0) - 1;
    const cacheRoot = path.join(process.cwd(), ".cache", "live-1h-gpt-compare");
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

    const hourlyIndicators = {} as Record<TradeSymbol, HourlyIndicatorBar[]>;
    const shortSignals = {} as Record<TradeSymbol, ShortMomentumSignal[]>;
    const bars12h = {} as Record<TradeSymbol, Candle12h[]>;
    const indicators12h = {} as Record<TradeSymbol, IndicatorBar[]>;

    for (const symbol of ALL_SYMBOLS) {
        hourlyIndicators[symbol] = buildHourlyIndicators(bySymbol[symbol]);
        shortSignals[symbol] = shortMomentumSeries(bySymbol[symbol].map((bar) => bar.close));
        const resampled = build12hTimeline(bySymbol[symbol]);
        bars12h[symbol] = resampled.bars12h;
        indicators12h[symbol] = resampled.indicators12h;
    }

    const timeline = bySymbol.BTC.map((bar) => bar.ts);
    return { bySymbol, hourlyIndicators, shortSignals, bars12h, indicators12h, timeline };
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

function latestIndicatorIndexAtOrBefore(series: IndicatorBar[], ts: number) {
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

function buildShortSignal(values: number[], index: number): ShortMomentumSignal {
    const lookup = (barsAgo: number) => {
        const target = index - barsAgo;
        if (target < 0) return values[0] || values[index] || 0;
        return values[target] || values[index] || 0;
    };
    const current = values[index] || 0;
    const p1 = lookup(1);
    const p5 = lookup(5);
    const p15 = lookup(15);
    const p60 = lookup(60);
    const r1 = p1 > 0 ? (current - p1) / p1 : 0;
    const r5 = p5 > 0 ? (current - p5) / p5 : 0;
    const r15 = p15 > 0 ? (current - p15) / p15 : 0;
    const r60 = p60 > 0 ? (current - p60) / p60 : 0;
    const score = r1 * 0.2 + r5 * 0.25 + r15 * 0.25 + r60 * 0.3;
    const sampleCoverage = Math.min(1, index / 30);
    const moveStrength = Math.min(1, (Math.abs(r1) + Math.abs(r5) + Math.abs(r15) + Math.abs(r60)) * 90);
    const confidence = Number((sampleCoverage * moveStrength).toFixed(3));
    return { r1, r5, r15, r60, score, confidence };
}

function scoreEntryCandidate(input: {
    symbol: TradeSymbol;
    price: number;
    shortSignal: ShortMomentumSignal;
    bar: HourlyIndicatorBar;
    btcBar: HourlyIndicatorBar;
}) {
    const { shortSignal, bar, btcBar } = input;
    const trendOk = btcBar.close > btcBar.ema200 && btcBar.macdHist > 0;
    const momentumOk = bar.close > bar.ema50 && bar.ema12 > bar.ema26 && bar.macdHist > 0;
    const rsiOk = bar.rsi14 >= 40 && bar.rsi14 <= 72;
    const strengthScore =
        (shortSignal.score * 1_000)
        + (shortSignal.confidence * 30)
        + (momentumOk ? 22 : -16)
        + (rsiOk ? 12 : -12)
        + (trendOk ? 15 : -25)
        + (bar.atrPct <= 0.03 ? 4 : 0);

    return {
        symbol: input.symbol,
        price: input.price,
        shortSignal,
        bar,
        btcBar,
        trendOk,
        momentumOk,
        rsiOk,
        score: strengthScore,
        eligible: trendOk && momentumOk && rsiOk && shortSignal.score > 0,
    };
}

function reviewCandidateProxy(candidate: ReturnType<typeof scoreEntryCandidate>, peerScores: number[]) {
    const bestPeer = peerScores[0] ?? -Infinity;
    const scoreGap = candidate.score - bestPeer;
    const reviewOk =
        candidate.eligible
        && candidate.shortSignal.confidence >= 0.15
        && candidate.score >= 35
        && scoreGap >= -3
        && candidate.shortSignal.r15 > -0.002
        && candidate.shortSignal.r60 > -0.004;

    return {
        approve: reviewOk,
        priorityScore: clamp(candidate.score / 2, 0, 100),
        reason: reviewOk ? "GPT許可(プロキシ)" : "GPT見送り(プロキシ)",
        detail: reviewOk
            ? `score=${candidate.score.toFixed(2)} gap=${scoreGap.toFixed(2)} conf=${candidate.shortSignal.confidence.toFixed(3)}`
            : `score=${candidate.score.toFixed(2)} gap=${scoreGap.toFixed(2)} conf=${candidate.shortSignal.confidence.toFixed(3)}`,
    };
}

function buildExitReasonFrom12h(bar: IndicatorBar) {
    if (bar.close <= bar.sma45 && bar.sma45 > 0) return "sma-break";
    if (bar.mom20 < 0) return "momentum-off";
    if (bar.adx14 > 0 && bar.adx14 < 12 && bar.close < bar.sma90) return "weak-structure";
    return null;
}

async function runVariant(
    variant: VariantName,
    input: {
        bySymbol: Record<TradeSymbol, Candle1h[]>;
        hourlyIndicators: Record<TradeSymbol, HourlyIndicatorBar[]>;
        shortSignals: Record<TradeSymbol, ShortMomentumSignal[]>;
        indicators12h: Record<TradeSymbol, IndicatorBar[]>;
        timeline: number[];
    },
) {
    const tradeEvents: TradeEventRow[] = [];
    const tradePairs: TradePairRow[] = [];
    const equityCurve: EquityPoint[] = [];
    const position = {
        side: null as "trend" | null,
        symbol: null as TradeSymbol | null,
        qty: 0,
        entryPrice: 0,
        entryTs: 0,
        entryIndex: -1,
        entryReason: "",
        lotId: "",
    };
    let cash = BASE_EQUITY;
    let tradeCount = 0;
    let highWaterMark = BASE_EQUITY;

    const openPosition = (symbol: TradeSymbol, entryPrice: number, entryTs: number, entryIndex: number, entryReason: string) => {
        const alloc = 0.5;
        const notional = cash * alloc;
        const rules = {
            BTC: { stepSize: 0.0001, minQty: 0.0001, minNotional: 10 },
            ETH: { stepSize: 0.001, minQty: 0.001, minNotional: 10 },
            SOL: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
            AVAX: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
            BNB: { stepSize: 0.001, minQty: 0.001, minNotional: 10 },
            LINK: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
        }[symbol];
        const qty = stepRound(notional / entryPrice, rules.stepSize);
        const entryNotional = qty * entryPrice;
        if (!Number.isFinite(qty) || qty <= 0 || qty < rules.minQty || entryNotional < rules.minNotional) {
            return false;
        }
        cash -= entryNotional * (1 + RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate);
        position.side = "trend";
        position.symbol = symbol;
        position.qty = qty;
        position.entryPrice = entryPrice;
        position.entryTs = entryTs;
        position.entryIndex = entryIndex;
        position.entryReason = entryReason;
        position.lotId = `${variant.toLowerCase()}-${String(++tradeCount).padStart(4, "0")}`;
        tradeEvents.push({
            time: formatIso(entryTs),
            symbol,
            action: "enter",
            strategy_type: "trend",
            sub_variant: variant,
            alloc,
            price: entryPrice,
            qty,
            reason: entryReason,
            trade_id: position.lotId,
        });
        return true;
    };

    const closePosition = (exitPrice: number, exitTs: number, exitIndex: number, exitReason: string) => {
        if (!position.side || !position.symbol || position.qty <= 0) return;
        const grossProceeds = position.qty * exitPrice;
        const grossPnl = grossProceeds - (position.qty * position.entryPrice);
        const fee = (position.qty * position.entryPrice * RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate) + (grossProceeds * RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate);
        const netPnl = grossPnl - fee;
        cash += grossProceeds * (1 - RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate);
        tradeEvents.push({
            time: formatIso(exitTs),
            symbol: position.symbol,
            action: "exit",
            strategy_type: "trend",
            sub_variant: variant,
            alloc: 0.5,
            price: exitPrice,
            qty: position.qty,
            reason: exitReason,
            trade_id: position.lotId,
        });
        tradePairs.push({
            trade_id: position.lotId,
            strategy_type: "trend",
            sub_variant: variant,
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
        position.entryReason = "";
        position.lotId = "";
    };

    const rawBySymbol = input.bySymbol;

    for (let index = 0; index < input.timeline.length; index += 1) {
        const ts = input.timeline[index];
        const btcBar = input.hourlyIndicators.BTC[index];
        if (!btcBar) continue;

        const currentPositionRaw = position.symbol ? getExecutionBar(rawBySymbol[position.symbol], ts) : null;
        const markPrice = position.symbol ? (currentPositionRaw?.close || position.entryPrice) : 0;
        const equity = position.symbol ? cash + (position.qty * markPrice * (1 - RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate)) : cash;
        highWaterMark = Math.max(highWaterMark, equity);
        equityCurve.push(buildEquityPoint(ts, equity, cash, position.symbol || "CASH", position.side || "cash", position.qty, position.entryPrice));

        if (position.side && position.symbol) {
            const rawBar = getExecutionBar(rawBySymbol[position.symbol], ts);
            if (rawBar && rawBar.low <= position.entryPrice * (1 - STOP_LOSS_PCT / 100)) {
                closePosition(position.entryPrice * (1 - STOP_LOSS_PCT / 100), ts, index, "SL");
                continue;
            }

            if (((ts - position.entryTs) / HOUR_MS) >= MIN_HOLD_HOURS && is12hBoundary(index)) {
                const indicatorIndex = latestIndicatorIndexAtOrBefore(input.indicators12h[position.symbol], ts);
                const exitBar = indicatorIndex >= 0 ? input.indicators12h[position.symbol][indicatorIndex] : null;
                const exitReason = exitBar ? buildExitReasonFrom12h(exitBar) : null;
                const closePrice = rawBar?.close || currentPositionRaw?.close || position.entryPrice;
                if (exitReason) {
                    closePosition(closePrice, ts, index, exitReason);
                    continue;
                }
                if (closePrice >= position.entryPrice * (1 + TAKE_PROFIT_PCT / 100)) {
                    closePosition(closePrice, ts, index, "TP");
                    continue;
                }
            }
        }

        if (position.side) continue;
        if (index < 240) continue;

        const candidates = LOOKBACK_SYMBOLS.map((symbol) => {
            const bar = input.hourlyIndicators[symbol][index];
            if (!bar) return null;
            const shortSignal = input.shortSignals[symbol][index] || buildShortSignal(rawBySymbol[symbol].slice(0, index + 1).map((item) => item.close), index);
            return scoreEntryCandidate({
                symbol,
                price: bar.close,
                shortSignal,
                bar,
                btcBar,
            });
        }).filter((item): item is NonNullable<typeof item> => item !== null);

        const ranked = candidates
            .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
        const top = ranked[0];
        if (!top || !top.eligible) continue;

        const gptApproved = variant === "no_gpt" ? true : reviewCandidateProxy(top, ranked.slice(1).map((item) => item.score)).approve;
        if (!gptApproved) continue;

        openPosition(
            top.symbol,
            top.price,
            ts,
            index,
            variant === "no_gpt" ? "1h-entry-no-gpt" : "1h-entry-gpt-proxy",
        );
    }

    if (position.side && position.symbol) {
        const lastTs = input.timeline.at(-1) || Date.now();
        const lastRaw = getExecutionBar(rawBySymbol[position.symbol], lastTs);
        closePosition(lastRaw?.close || position.entryPrice, lastTs, input.timeline.length - 1, "end-of-test");
    }

    const annualReturns = periodReturns(equityCurve, (point) => new Date(point.ts).getUTCFullYear().toString());
    const monthlyReturns = periodReturns(equityCurve, (point) => `${new Date(point.ts).getUTCFullYear()}-${String(new Date(point.ts).getUTCMonth() + 1).padStart(2, "0")}`);
    const wins = tradePairs.filter((trade) => trade.net_pnl > 0).length;
    const grossWins = sum(tradePairs.map((trade) => Math.max(0, trade.net_pnl)));
    const grossLosses = Math.abs(sum(tradePairs.map((trade) => Math.min(0, trade.net_pnl))));
    const symbolContribution = tradePairs.reduce<Record<string, number>>((acc, trade) => {
        acc[trade.symbol] = (acc[trade.symbol] || 0) + trade.net_pnl;
        return acc;
    }, {});

    return {
        name: variant,
        label: variant === "no_gpt" ? "1H entry, no GPT gate" : "1H entry, GPT proxy gate",
        trade_events: tradeEvents,
        trade_pairs: tradePairs,
        equity_curve: equityCurve,
        annual_returns: annualReturns,
        monthly_returns: monthlyReturns,
        summary: {
            name: variant,
            start_equity: BASE_EQUITY,
            end_equity: equityCurve.at(-1)?.equity || BASE_EQUITY,
            cagr_pct: calcCagrPct(BASE_EQUITY, equityCurve.at(-1)?.equity || BASE_EQUITY, equityCurve[0]?.ts || Date.now(), equityCurve.at(-1)?.ts || Date.now()),
            max_drawdown_pct: calcMaxDrawdownPct(equityCurve),
            win_rate_pct: tradePairs.length ? (wins / tradePairs.length) * 100 : 0,
            profit_factor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0,
            trade_count: tradePairs.length,
            exposure_pct: equityCurve.length ? (equityCurve.filter((point) => point.position_side !== "cash").length / equityCurve.length) * 100 : 0,
            annual_returns: annualReturns,
            monthly_returns: monthlyReturns,
            symbol_contribution: symbolContribution,
        },
    } satisfies VariantResult;
}

function toCsv(rows: Record<string, unknown>[]) {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    const escape = (value: unknown) => {
        const text = String(value ?? "");
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [
        headers.join(","),
        ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
    ].join("\n");
}

async function main() {
    const input = await loadSeries();
    const noGpt = await runVariant("no_gpt", input);
    const gptProxy = await runVariant("gpt_proxy", input);

    await fs.mkdir(REPORT_DIR, { recursive: true });
    await Promise.all([
        fs.writeFile(path.join(REPORT_DIR, "no_gpt-trade_events.csv"), toCsv(noGpt.trade_events as unknown as Record<string, unknown>[]), "utf8"),
        fs.writeFile(path.join(REPORT_DIR, "no_gpt-trade_pairs.csv"), toCsv(noGpt.trade_pairs as unknown as Record<string, unknown>[]), "utf8"),
        fs.writeFile(path.join(REPORT_DIR, "no_gpt-equity_curve.csv"), toCsv(noGpt.equity_curve as unknown as Record<string, unknown>[]), "utf8"),
        fs.writeFile(path.join(REPORT_DIR, "no_gpt-summary.json"), JSON.stringify(noGpt.summary, null, 2), "utf8"),
        fs.writeFile(path.join(REPORT_DIR, "gpt_proxy-trade_events.csv"), toCsv(gptProxy.trade_events as unknown as Record<string, unknown>[]), "utf8"),
        fs.writeFile(path.join(REPORT_DIR, "gpt_proxy-trade_pairs.csv"), toCsv(gptProxy.trade_pairs as unknown as Record<string, unknown>[]), "utf8"),
        fs.writeFile(path.join(REPORT_DIR, "gpt_proxy-equity_curve.csv"), toCsv(gptProxy.equity_curve as unknown as Record<string, unknown>[]), "utf8"),
        fs.writeFile(path.join(REPORT_DIR, "gpt_proxy-summary.json"), JSON.stringify(gptProxy.summary, null, 2), "utf8"),
        fs.writeFile(path.join(REPORT_DIR, "comparison.json"), JSON.stringify({
            no_gpt: noGpt.summary,
            gpt_proxy: gptProxy.summary,
        }, null, 2), "utf8"),
        fs.writeFile(path.join(REPORT_DIR, "comparison.md"), [
            "# 1H GPT Gate Comparison",
            "",
            "| Variant | End Equity | CAGR | MaxDD | Win Rate | PF | Trades | Exposure |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            `| no_gpt | ${noGpt.summary.end_equity.toFixed(2)} | ${noGpt.summary.cagr_pct.toFixed(2)}% | ${noGpt.summary.max_drawdown_pct.toFixed(2)}% | ${noGpt.summary.win_rate_pct.toFixed(2)}% | ${noGpt.summary.profit_factor.toFixed(2)} | ${noGpt.summary.trade_count} | ${noGpt.summary.exposure_pct.toFixed(2)}% |`,
            `| gpt_proxy | ${gptProxy.summary.end_equity.toFixed(2)} | ${gptProxy.summary.cagr_pct.toFixed(2)}% | ${gptProxy.summary.max_drawdown_pct.toFixed(2)}% | ${gptProxy.summary.win_rate_pct.toFixed(2)}% | ${gptProxy.summary.profit_factor.toFixed(2)} | ${gptProxy.summary.trade_count} | ${gptProxy.summary.exposure_pct.toFixed(2)}% |`,
            "",
            "## Notes",
            "",
            "- Entry is evaluated on 1H bars.",
            "- Exit is only allowed at 12H boundaries after a 12H minimum hold, except stop loss.",
            "- `gpt_proxy` is a deterministic local proxy because no OpenAI key is configured in this workspace.",
        ].join("\n"), "utf8"),
    ]);

    console.log(JSON.stringify({
        reportDir: REPORT_DIR,
        no_gpt: noGpt.summary,
        gpt_proxy: gptProxy.summary,
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
