import fs from "fs/promises";
import path from "path";

import { loadHistoricalCandles } from "@/lib/backtest/binance-source";
import { BNB_ROTATION_SYMBOLS, STRATEGY_PRESETS, type BnbRotationPreset, type StrategyMode } from "@/config/strategyMode";

const HOUR_MS = 60 * 60 * 1000;
const H12_MS = 12 * HOUR_MS;
const BASE_EQUITY = 10_000;
const SYMBOL_ORDER = ["BTC", "ETH", "SOL", "AVAX"] as const;
const LONG_HISTORY_START = Date.UTC(2022, 0, 1, 0, 0, 0);
const LONG_HISTORY_END = Date.UTC(2026, 0, 1, 0, 0, 0) - 1;
const LOCAL_ZIP_PATHS: Record<RotationSymbol, string | null> = {
    BTC: path.join("C:\\Users\\dis\\Desktop", "2022BTC.zip"),
    ETH: path.join("C:\\Users\\dis\\Desktop", "2022ETH.zip"),
    SOL: path.join("C:\\Users\\dis\\Desktop", "2022SOL.zip"),
    AVAX: null,
};
const BINANCE_SYMBOL_MAP: Record<RotationSymbol, string> = {
    BTC: "BTCUSDT",
    ETH: "ETHUSDT",
    SOL: "SOLUSDT",
    AVAX: "AVAXUSDT",
};

export type RotationSymbol = (typeof SYMBOL_ORDER)[number];

export interface OhlcvBar {
    ts: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface IndicatorBar extends OhlcvBar {
    sma: number;
    mom20: number;
    volAvg20: number;
    overheatPct: number;
    ready: boolean;
}

export interface LoadedSymbolData {
    symbol: RotationSymbol;
    raw1h: OhlcvBar[];
    bars12h: OhlcvBar[];
    indicators12h: IndicatorBar[];
}

export interface LoadedDataset {
    preset: BnbRotationPreset;
    symbols: Record<RotationSymbol, LoadedSymbolData>;
    timeline12h: number[];
    sourceNote: string;
}

export interface CandidateSnapshot {
    symbol: RotationSymbol;
    close: number;
    mom20: number;
    volAvg20: number;
    overheatPct: number;
    eligible: boolean;
    reason: string[];
}

export interface SignalDecision {
    ts: number;
    rebalance: boolean;
    riskOn: boolean;
    selectedSymbol: RotationSymbol | "CASH";
    currentSymbol: RotationSymbol | "CASH";
    exitReason?: "risk-off" | "sma-break" | "rebalance-switch" | "rebalance-flat" | "entry-skip";
    candidateCount: number;
    candidates: CandidateSnapshot[];
}

export interface ExchangeRules {
    stepSize: number;
    minQty: number;
    minNotional: number;
}

export interface OrderQtyResult {
    symbol: RotationSymbol;
    qty: number;
    notional: number;
    valid: boolean;
    reason?: string;
}

export interface TradeLogEntry {
    entry_time: string;
    exit_time: string;
    symbol: RotationSymbol;
    entry_price: number;
    exit_price: number;
    qty: number;
    gross_pnl: number;
    net_pnl: number;
    fee: number;
    holding_bars: number;
    exit_reason: SignalDecision["exitReason"] | "end-of-test";
    strategy_mode: StrategyMode;
}

export interface EquityPoint {
    ts: number;
    iso_time: string;
    equity: number;
    cash: number;
    position_symbol: RotationSymbol | "CASH";
    position_qty: number;
    position_entry_price: number;
}

export interface MonthlyReturnRow {
    month: string;
    start_equity: number;
    end_equity: number;
    return_pct: number;
}

export interface BacktestSummary {
    strategy_mode: StrategyMode;
    preset: BnbRotationPreset;
    start_equity: number;
    end_equity: number;
    cagr_pct: number;
    max_drawdown_pct: number;
    win_rate_pct: number;
    profit_factor: number;
    trade_count: number;
    exposure_pct: number;
    symbol_contribution: Record<string, number>;
    monthly_returns: MonthlyReturnRow[];
}

export interface BacktestResult {
    strategy_mode: StrategyMode;
    preset: BnbRotationPreset;
    dataset: LoadedDataset;
    signals: SignalDecision[];
    trade_log: TradeLogEntry[];
    equity_curve: EquityPoint[];
    monthly_returns: MonthlyReturnRow[];
    summary: BacktestSummary;
}

const DEFAULT_EXCHANGE_RULES: Record<RotationSymbol, ExchangeRules> = {
    BTC: { stepSize: 0.0001, minQty: 0.0001, minNotional: 10 },
    ETH: { stepSize: 0.001, minQty: 0.001, minNotional: 10 },
    SOL: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
    AVAX: { stepSize: 0.01, minQty: 0.01, minNotional: 5 },
};

const SYMBOL_PROVIDER_IDS: Record<RotationSymbol, string> = {
    BTC: "bitcoin",
    ETH: "ethereum",
    SOL: "solana",
    AVAX: "avalanche-2",
};

const FALLBACK_BASE_PRICE: Record<RotationSymbol, number> = {
    BTC: 42_000,
    ETH: 2_300,
    SOL: 120,
    AVAX: 28,
};

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sum(values: number[]) {
    return values.reduce((total, value) => total + value, 0);
}

function formatIso(ts: number) {
    return new Date(ts).toISOString();
}

function floorTo12h(ts: number) {
    return Math.floor(ts / H12_MS) * H12_MS;
}

function sma(values: number[], period: number) {
    if (values.length < period || period <= 0) return 0;
    return average(values.slice(-period));
}

function normalizeSeries(data: unknown): Array<{ ts: number; price: number }> {
    if (!Array.isArray(data)) return [];
    return data
        .map((entry) => {
            if (Array.isArray(entry) && entry.length >= 2) {
                return { ts: Number(entry[0]), price: Number(entry[1]) };
            }
            if (entry && typeof entry === "object") {
                const row = entry as Record<string, unknown>;
                return {
                    ts: Number(row.time || row.ts || row.timestamp || 0),
                    price: Number(row.priceUsd || row.price || row.value || 0),
                };
            }
            return null;
        })
        .filter((item): item is { ts: number; price: number } => item !== null && Number.isFinite(item.ts) && Number.isFinite(item.price) && item.price > 0)
        .sort((left, right) => left.ts - right.ts)
        .filter((item, index, arr) => index === 0 || arr[index - 1].ts !== item.ts);
}

function latestIndexAtOrBefore<T extends { ts: number }>(series: T[], ts: number) {
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

function latestAtOrBefore<T extends { ts: number }>(series: T[], ts: number) {
    const index = latestIndexAtOrBefore(series, ts);
    return index >= 0 ? series[index] : null;
}

export function selectStrategyPreset(strategyMode?: string | null) {
    const normalized = String(strategyMode || "").trim().toUpperCase() as StrategyMode;
    if (normalized === "A_ATTACK" || normalized === "A_BALANCE") {
        return STRATEGY_PRESETS[normalized];
    }
    return STRATEGY_PRESETS.A_BALANCE;
}

export function resample_to_12h(raw1h: OhlcvBar[]) {
    const buckets = new Map<number, OhlcvBar[]>();
    raw1h.forEach((bar) => {
        const bucketTs = floorTo12h(bar.ts);
        const bucket = buckets.get(bucketTs) || [];
        bucket.push(bar);
        buckets.set(bucketTs, bucket);
    });

    return [...buckets.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([bucketTs, bucket]) => {
            const open = bucket[0]?.open || bucket[0]?.close || 0;
            const close = bucket[bucket.length - 1]?.close || open;
            const high = Math.max(...bucket.map((bar) => bar.high || bar.close || 0), open, close);
            const low = Math.min(...bucket.map((bar) => bar.low || bar.close || 0), open, close);
            const volume = sum(bucket.map((bar) => bar.volume || 0));
            return {
                ts: bucketTs + H12_MS,
                open,
                high,
                low,
                close,
                volume,
            } satisfies OhlcvBar;
        });
}

function buildSynthetic1hBars(priceSeries: Array<{ ts: number; price: number }>, estimatedDailyVolume: number) {
    const baseHourlyVolume = Math.max(1, estimatedDailyVolume / 24);
    return priceSeries.map((sample, index) => {
        const previous = priceSeries[index - 1]?.price || sample.price;
        const open = previous > 0 ? previous : sample.price;
        const close = sample.price;
        const high = Math.max(open, close);
        const low = Math.min(open, close);
        const movement = Math.abs(close - open) / Math.max(0.0000001, open);
        // CoinCap の履歴は close 系列のみなので、出来高は現在の 24h volume を基準にした proxy を使う。
        const volume = baseHourlyVolume * (0.7 + clamp(movement * 16, 0, 2.5));
        return {
            ts: sample.ts,
            open,
            high,
            low,
            close,
            volume,
        } satisfies OhlcvBar;
    });
}

function buildFallbackPriceSeries(symbol: RotationSymbol, hours = 180 * 24) {
    const basePrice = FALLBACK_BASE_PRICE[symbol];
    const seed = symbol.charCodeAt(0) * 0.07;
    const now = Date.now();
    return Array.from({ length: hours }, (_, index) => {
        const drift = 1 + (index / hours) * (symbol === "BTC" ? 0.32 : symbol === "ETH" ? 0.55 : symbol === "SOL" ? 0.75 : 0.9);
        const wave = 1 + Math.sin((index / 18) + seed) * (symbol === "BTC" ? 0.02 : 0.05) + Math.sin((index / 71) + seed) * 0.03;
        const pulse = 1 + Math.max(0, Math.sin((index / 29) + seed)) * (symbol === "AVAX" ? 0.12 : 0.05);
        const price = basePrice * drift * wave * pulse;
        return {
            ts: now - ((hours - index) * HOUR_MS),
            price,
        };
    });
}

function computeIndicatorSeries(bars12h: OhlcvBar[], smaPeriod: number) {
    return bars12h.map((bar, index) => {
        const closes = bars12h.slice(0, index + 1).map((item) => item.close);
        const volumes = bars12h.slice(0, index + 1).map((item) => item.volume);
        const mom20 = index >= 20 ? (bar.close / bars12h[index - 20].close) - 1 : 0;
        const volAvg20 = index >= 19 ? average(volumes.slice(-20)) : 0;
        const smaValue = sma(closes, smaPeriod);
        return {
            ...bar,
            sma: smaValue,
            mom20,
            volAvg20,
            overheatPct: smaValue > 0 ? (bar.close / smaValue) - 1 : 0,
            ready: index >= Math.max(20, smaPeriod),
        } satisfies IndicatorBar;
    });
}

export async function load_ohlcv(strategyMode: StrategyMode, _days = 180): Promise<LoadedDataset> {
    const preset = selectStrategyPreset(strategyMode);
    const symbols: RotationSymbol[] = [...SYMBOL_ORDER];

    const out = {} as Record<RotationSymbol, LoadedSymbolData>;

    for (const symbol of symbols) {
        const providerId = SYMBOL_PROVIDER_IDS[symbol];
        const remoteSymbol = BINANCE_SYMBOL_MAP[symbol];
        const localZipPath = LOCAL_ZIP_PATHS[symbol] || undefined;
        let raw1h = [] as OhlcvBar[];
        try {
            const candles = await loadHistoricalCandles({
                symbol: remoteSymbol,
                localZipPath,
                cacheRoot: path.join(process.cwd(), ".cache", "bnb-rotation"),
                startMs: LONG_HISTORY_START,
                endMs: LONG_HISTORY_END,
            });
            raw1h = candles
                .map((candle) => ({
                    ts: candle.ts,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                    volume: candle.volume,
                }))
                .filter((candle) => Number.isFinite(candle.ts) && candle.close > 0)
                .sort((left, right) => left.ts - right.ts);
        } catch {
            raw1h = [];
        }
        if (!raw1h.length) {
            const series = buildFallbackPriceSeries(symbol);
            raw1h = buildSynthetic1hBars(series, 1_000_000);
        }
        if (!raw1h.length) {
            throw new Error(`No price history for ${symbol}`);
        }

        const bars12h = resample_to_12h(raw1h);
        out[symbol] = {
            symbol,
            raw1h,
            bars12h,
            indicators12h: [],
        };
    }

    return {
        preset,
        symbols: out,
        timeline12h: out.BTC.bars12h.map((bar) => bar.ts),
        sourceNote: "Binance 1H OHLCV candles (local zip + remote cache) を元に 12H へ再集計しています。",
    };
}

export function compute_indicators(dataset: LoadedDataset) {
    const preset = dataset.preset;
    const nextSymbols = {} as Record<RotationSymbol, LoadedSymbolData>;

    for (const symbol of SYMBOL_ORDER) {
        const bars12h = dataset.symbols[symbol].bars12h;
        const indicators12h = computeIndicatorSeries(bars12h, symbol === "BTC" ? preset.btcSma : preset.candidateSma);
        nextSymbols[symbol] = {
            ...dataset.symbols[symbol],
            indicators12h,
        };
    }

    return {
        ...dataset,
        symbols: nextSymbols,
    } satisfies LoadedDataset;
}

export async function load_and_resample_data(strategyMode: StrategyMode, days = 180) {
    return load_ohlcv(strategyMode, days);
}

function decisionTimestampIndex(dataset: LoadedDataset) {
    const btc = dataset.symbols.BTC.indicators12h;
    return btc.findIndex((bar) => bar.ready);
}

function pickCandidatesAt(dataset: LoadedDataset, ts: number, preset: BnbRotationPreset) {
    const out: CandidateSnapshot[] = [];

    for (const symbol of ["ETH", "SOL", "AVAX"] as const) {
        const series = dataset.symbols[symbol].indicators12h;
        const bar = latestAtOrBefore(series, ts);
        if (!bar || !bar.ready) continue;

        const candidateBaseEligible = bar.close > bar.sma;
        const isSol = symbol === "SOL";
        const overheatOk = !isSol || bar.overheatPct <= preset.solOverheatLimit;
        const avaxOk = symbol !== "AVAX" || (bar.mom20 > preset.avaxMomThreshold && bar.volume > bar.volAvg20);
        const eligible = candidateBaseEligible && overheatOk && avaxOk;
        const reason = [candidateBaseEligible ? "close>sma" : "close<=sma"];

        if (isSol) {
            reason.push(overheatOk ? "sol-ok" : "sol-overheat");
        }
        if (symbol === "AVAX") {
            reason.push(bar.mom20 > preset.avaxMomThreshold ? "avax-mom-ok" : "avax-mom-low");
            reason.push(bar.volume > bar.volAvg20 ? "avax-vol-ok" : "avax-vol-low");
        }

        out.push({
            symbol,
            close: bar.close,
            mom20: bar.mom20,
            volAvg20: bar.volAvg20,
            overheatPct: bar.overheatPct,
            eligible,
            reason,
        });
    }

    return out.sort((left, right) => right.mom20 - left.mom20 || right.close - left.close || left.symbol.localeCompare(right.symbol));
}

export function generate_signals(dataset: LoadedDataset, preset: BnbRotationPreset) {
    const btcSeries = dataset.symbols.BTC.indicators12h;
    const startIndex = decisionTimestampIndex(dataset);
    const signals: SignalDecision[] = [];

    for (let index = Math.max(0, startIndex); index < btcSeries.length; index += 1) {
        const btcBar = btcSeries[index];
        if (!btcBar?.ready) continue;
        const rebalance = (index - startIndex) >= 0 && ((index - startIndex) % preset.rebalanceBars === 0);
        const riskOn = btcBar.close > btcBar.sma;
        const candidates = pickCandidatesAt(dataset, btcBar.ts, preset);
        const eligible = riskOn ? candidates.filter((candidate) => candidate.eligible) : [];
        const selectedSymbol = riskOn && eligible[0] ? eligible[0].symbol : "CASH";

        signals.push({
            ts: btcBar.ts,
            rebalance,
            riskOn,
            selectedSymbol,
            currentSymbol: "CASH",
            candidateCount: eligible.length,
            candidates,
        });
    }

    return signals;
}

function markToMarket(positionQty: number, closePrice: number, cash: number, feeRate: number) {
    if (positionQty <= 0) return cash;
    return cash + (positionQty * closePrice * (1 - feeRate));
}

function calcMaxDrawdownPct(points: EquityPoint[]) {
    let peak = points[0]?.equity || BASE_EQUITY;
    let maxDrawdown = 0;
    for (const point of points) {
        if (point.equity > peak) peak = point.equity;
        if (peak <= 0) continue;
        const dd = ((point.equity / peak) - 1) * 100;
        maxDrawdown = Math.min(maxDrawdown, dd);
    }
    return maxDrawdown;
}

export function calculate_order_qty(
    symbol: RotationSymbol,
    equity: number,
    price: number,
    exchangeRules: ExchangeRules = DEFAULT_EXCHANGE_RULES[symbol],
    targetAlloc: number,
): OrderQtyResult {
    if (!Number.isFinite(price) || price <= 0) {
        return { symbol, qty: 0, notional: 0, valid: false, reason: "invalid-price" };
    }

    const notional = Math.max(0, equity * targetAlloc);
    const rawQty = notional / price;
    const step = exchangeRules.stepSize > 0 ? exchangeRules.stepSize : 0.00000001;
    const qty = Math.floor(rawQty / step) * step;
    const valid = qty >= exchangeRules.minQty && (qty * price) >= exchangeRules.minNotional;

    if (!valid) {
        return {
            symbol,
            qty,
            notional: qty * price,
            valid: false,
            reason: qty < exchangeRules.minQty ? "minQty" : "minNotional",
        };
    }

    return {
        symbol,
        qty,
        notional: qty * price,
        valid: true,
    };
}

export function simulate_portfolio(dataset: LoadedDataset, signals: SignalDecision[], preset: BnbRotationPreset): BacktestResult {
    const feeRate = preset.feeRate;
    const tradeLog: TradeLogEntry[] = [];
    const equityCurve: EquityPoint[] = [];
    const monthlyBuckets = new Map<string, EquityPoint[]>();
    const timeline = dataset.timeline12h;
    let cash = BASE_EQUITY;
    let position: {
        symbol: RotationSymbol | null;
        qty: number;
        entryPrice: number;
        entryTs: number;
        entryIndex: number;
    } = { symbol: null, qty: 0, entryPrice: 0, entryTs: 0, entryIndex: -1 };
    const signalByTs = new Map<number, SignalDecision>(signals.map((signal) => [signal.ts, signal]));
    const btcIndicators = dataset.symbols.BTC.indicators12h;

    const getBar = (symbol: RotationSymbol, index: number) => dataset.symbols[symbol].bars12h[index] || dataset.symbols[symbol].bars12h.at(-1)!;
    const getIndicator = (symbol: RotationSymbol, index: number) => dataset.symbols[symbol].indicators12h[index] || dataset.symbols[symbol].indicators12h.at(-1)!;

    for (let index = 1; index < timeline.length; index += 1) {
        const prevIndex = index - 1;
        const executionTs = timeline[prevIndex];
        const closeTs = timeline[index];
        const btcBar = btcIndicators[prevIndex];
        if (!btcBar || !btcBar.ready) continue;

        const decision = signalByTs.get(executionTs);
        const currentBars = {
            BTC: getBar("BTC", index),
            ETH: getBar("ETH", index),
            SOL: getBar("SOL", index),
            AVAX: getBar("AVAX", index),
        } as const;

        const riskOn = btcBar.close > btcBar.sma;
        const heldSymbol = position.symbol;
        let exitReason: SignalDecision["exitReason"] | null = null;

        if (heldSymbol) {
            const heldIndicator = getIndicator(heldSymbol, prevIndex);
            if (!riskOn) {
                exitReason = "risk-off";
            } else if (heldIndicator && heldIndicator.close < heldIndicator.sma) {
                exitReason = "sma-break";
            }
        }

        if (heldSymbol && exitReason) {
            const exitBar = currentBars[heldSymbol];
            const exitPrice = exitBar?.open || position.entryPrice;
            const grossProceeds = position.qty * exitPrice;
            const grossPnl = grossProceeds - (position.qty * position.entryPrice);
            const fee = (position.qty * position.entryPrice * feeRate) + (grossProceeds * feeRate);
            const netPnl = grossPnl - fee;
            cash += grossProceeds * (1 - feeRate);
            tradeLog.push({
                entry_time: formatIso(position.entryTs),
                exit_time: formatIso(executionTs),
                symbol: heldSymbol,
                entry_price: position.entryPrice,
                exit_price: exitPrice,
                qty: position.qty,
                gross_pnl: grossPnl,
                net_pnl: netPnl,
                fee,
                holding_bars: Math.max(1, index - position.entryIndex),
                exit_reason: exitReason,
                strategy_mode: preset.mode,
            });
            position = { symbol: null, qty: 0, entryPrice: 0, entryTs: 0, entryIndex: -1 };
        }

        if (decision?.rebalance && riskOn) {
            const best = decision.candidates.find((candidate) => candidate.eligible);
            if (best) {
                if (position.symbol && position.symbol !== best.symbol) {
                    const exitSymbol = position.symbol;
                    const exitBar = currentBars[exitSymbol];
                    const exitPrice = exitBar?.open || position.entryPrice;
                    const grossProceeds = position.qty * exitPrice;
                    const grossPnl = grossProceeds - (position.qty * position.entryPrice);
                    const fee = (position.qty * position.entryPrice * feeRate) + (grossProceeds * feeRate);
                    const netPnl = grossPnl - fee;
                    cash += grossProceeds * (1 - feeRate);
                    tradeLog.push({
                        entry_time: formatIso(position.entryTs),
                        exit_time: formatIso(executionTs),
                        symbol: exitSymbol,
                        entry_price: position.entryPrice,
                        exit_price: exitPrice,
                        qty: position.qty,
                        gross_pnl: grossPnl,
                        net_pnl: netPnl,
                        fee,
                        holding_bars: Math.max(1, index - position.entryIndex),
                        exit_reason: "rebalance-switch",
                        strategy_mode: preset.mode,
                    });
                    position = { symbol: null, qty: 0, entryPrice: 0, entryTs: 0, entryIndex: -1 };
                }

                if (!position.symbol) {
                    const entryBar = currentBars[best.symbol];
                    const entryPrice = entryBar?.open || 0;
                    const qtyResult = calculate_order_qty(best.symbol, cash, entryPrice, DEFAULT_EXCHANGE_RULES[best.symbol], preset.targetAlloc);
                    if (qtyResult.valid && qtyResult.qty > 0) {
                        const entryCost = qtyResult.qty * entryPrice;
                        cash -= entryCost * (1 + feeRate);
                        position = {
                            symbol: best.symbol,
                            qty: qtyResult.qty,
                            entryPrice,
                            entryTs: executionTs,
                            entryIndex: index,
                        };
                    }
                }
            }
        }

        const markPrice = position.symbol ? (currentBars[position.symbol]?.close || position.entryPrice) : 0;
        const equity = markToMarket(position.qty, markPrice, cash, feeRate);
        const point = {
            ts: closeTs,
            iso_time: formatIso(closeTs),
            equity: position.symbol ? equity : cash,
            cash,
            position_symbol: position.symbol || "CASH",
            position_qty: position.qty,
            position_entry_price: position.entryPrice,
        } satisfies EquityPoint;
        equityCurve.push(point);

        const monthKey = point.iso_time.slice(0, 7);
        const monthly = monthlyBuckets.get(monthKey) || [];
        monthly.push(point);
        monthlyBuckets.set(monthKey, monthly);
    }

    if (position.symbol) {
        const lastTs = timeline.at(-1) || Date.now();
        const exitBar = getBar(position.symbol, timeline.length - 1);
        const exitPrice = exitBar?.close || position.entryPrice;
        const grossProceeds = position.qty * exitPrice;
        const grossPnl = grossProceeds - (position.qty * position.entryPrice);
        const fee = (position.qty * position.entryPrice * feeRate) + (grossProceeds * feeRate);
        const netPnl = grossPnl - fee;
        cash += grossProceeds * (1 - feeRate);
        tradeLog.push({
            entry_time: formatIso(position.entryTs),
            exit_time: formatIso(lastTs),
            symbol: position.symbol,
            entry_price: position.entryPrice,
            exit_price: exitPrice,
            qty: position.qty,
            gross_pnl: grossPnl,
            net_pnl: netPnl,
            fee,
            holding_bars: Math.max(1, timeline.length - position.entryIndex),
            exit_reason: "end-of-test",
            strategy_mode: preset.mode,
        });
        position = { symbol: null, qty: 0, entryPrice: 0, entryTs: 0, entryIndex: -1 };
    }

    const monthlyReturns = [...monthlyBuckets.entries()].map(([month, points]) => {
        const first = points[0]?.equity || BASE_EQUITY;
        const last = points.at(-1)?.equity || first;
        return {
            month,
            start_equity: first,
            end_equity: last,
            return_pct: first > 0 ? ((last / first) - 1) * 100 : 0,
        } satisfies MonthlyReturnRow;
    });

    const startEquity = equityCurve[0]?.equity || BASE_EQUITY;
    const endEquity = equityCurve.at(-1)?.equity || BASE_EQUITY;
    const firstTs = equityCurve[0]?.ts || Date.now();
    const lastTs = equityCurve.at(-1)?.ts || firstTs;
    const periodDays = Math.max(1, (lastTs - firstTs) / (24 * HOUR_MS));
    const cagrPct = (Math.pow(endEquity / startEquity, 365 / periodDays) - 1) * 100;
    const drawdownPct = calcMaxDrawdownPct(equityCurve);
    const wins = tradeLog.filter((trade) => trade.net_pnl > 0).length;
    const grossWins = tradeLog.filter((trade) => trade.net_pnl > 0).reduce((acc, trade) => acc + trade.net_pnl, 0);
    const grossLosses = Math.abs(tradeLog.filter((trade) => trade.net_pnl <= 0).reduce((acc, trade) => acc + trade.net_pnl, 0));
    const symbolContribution = tradeLog.reduce<Record<string, number>>((acc, trade) => {
        acc[trade.symbol] = (acc[trade.symbol] || 0) + trade.net_pnl;
        return acc;
    }, {});
    const exposureBars = equityCurve.filter((point) => point.position_symbol !== "CASH").length;
    const exposurePct = equityCurve.length ? (exposureBars / equityCurve.length) * 100 : 0;

    const summary: BacktestSummary = {
        strategy_mode: preset.mode,
        preset,
        start_equity: startEquity,
        end_equity: endEquity,
        cagr_pct: cagrPct,
        max_drawdown_pct: drawdownPct,
        win_rate_pct: tradeLog.length ? (wins / tradeLog.length) * 100 : 0,
        profit_factor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0,
        trade_count: tradeLog.length,
        exposure_pct: exposurePct,
        symbol_contribution: symbolContribution,
        monthly_returns: monthlyReturns,
    };

    return {
        strategy_mode: preset.mode,
        preset,
        dataset,
        signals,
        trade_log: tradeLog,
        equity_curve: equityCurve,
        monthly_returns: monthlyReturns,
        summary,
    };
}

export async function run_backtest(strategyMode: StrategyMode, data?: LoadedDataset, presetOverride?: Partial<BnbRotationPreset>) {
    const preset = { ...selectStrategyPreset(strategyMode), ...(presetOverride || {}) };
    const baseData = data || (await load_ohlcv(strategyMode));
    const dataset = compute_indicators({
        ...baseData,
        preset,
    });
    const signals = generate_signals(dataset, preset);
    return simulate_portfolio(dataset, signals, preset);
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

export async function export_trade_log(result: BacktestResult, outDir: string) {
    await fs.mkdir(outDir, { recursive: true });
    const filePath = path.join(outDir, `${result.strategy_mode.toLowerCase()}-trade_log.csv`);
    await fs.writeFile(filePath, toCsv(result.trade_log as unknown as Record<string, unknown>[]), "utf8");
    return filePath;
}

export async function export_equity_curve(result: BacktestResult, outDir: string) {
    await fs.mkdir(outDir, { recursive: true });
    const filePath = path.join(outDir, `${result.strategy_mode.toLowerCase()}-equity_curve.csv`);
    await fs.writeFile(filePath, toCsv(result.equity_curve as unknown as Record<string, unknown>[]), "utf8");
    return filePath;
}

export async function export_monthly_report(result: BacktestResult, outDir: string) {
    await fs.mkdir(outDir, { recursive: true });
    const filePath = path.join(outDir, `${result.strategy_mode.toLowerCase()}-monthly_returns.csv`);
    await fs.writeFile(filePath, toCsv(result.monthly_returns as unknown as Record<string, unknown>[]), "utf8");
    return filePath;
}

export async function export_summary_json(result: BacktestResult, outDir: string) {
    await fs.mkdir(outDir, { recursive: true });
    const filePath = path.join(outDir, `${result.strategy_mode.toLowerCase()}-performance_summary.json`);
    await fs.writeFile(filePath, JSON.stringify(result.summary, null, 2), "utf8");
    return filePath;
}

export function explain_strategy_mode(strategyMode: StrategyMode) {
    const preset = selectStrategyPreset(strategyMode);
    return {
        mode: preset.mode,
        btcSma: preset.btcSma,
        candidateSma: preset.candidateSma,
        rebalanceBars: preset.rebalanceBars,
        avaxMomThreshold: preset.avaxMomThreshold,
        solOverheatLimit: preset.solOverheatLimit,
        targetAlloc: preset.targetAlloc,
        feeRate: preset.feeRate,
        symbols: BNB_ROTATION_SYMBOLS,
    };
}
