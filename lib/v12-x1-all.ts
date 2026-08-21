import { V12_X1_ALL } from "@/config/v12X1AllRuntime";

export type V12Side = "LONG" | "SHORT";
export type V12Regime = "LONG" | "SHORT" | "NEUTRAL";

export interface V12H1Candle {
    ts: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closed?: boolean;
}

export interface V12Bar extends V12H1Candle {
    endTs: number;
    sourceCount: 2;
}

export interface V12Candidate {
    symbol: string;
    side: V12Side;
    momentum: number;
    volatility: number;
    atr: number;
    volumeRatio: number;
    score: number;
}

export interface V12Signal extends V12Candidate {
    referenceTs: number;
    entryTs: number;
    regime: V12Regime;
}

export interface V12CandidateGate {
    symbol: string;
    regime: V12Regime | null;
    available: boolean;
    passed: boolean;
    side?: V12Side;
    momentum?: number;
    volatility?: number;
    atr?: number;
    volumeRatio?: number;
    score?: number;
    gates: {
        history: boolean;
        indicators: boolean;
        volume: boolean;
        edge: boolean;
        momentum: boolean;
        regime: boolean;
    };
    reasons: string[];
}

export function buildV12Signals(universe: Record<string, V12Bar[]>, index: number, limit: number = V12_X1_ALL.maximumPositions): V12Signal[] {
    const btc = universe.BTC;
    if (!btc?.[index]) return [];
    const regime = computeV12Regime(btc, index);
    if (!regime) return [];
    const candidates = V12_X1_ALL.universe
        .map((symbol) => candidateFor(symbol, universe[symbol] || [], index, regime))
        .filter((candidate): candidate is V12Candidate => Boolean(candidate))
        .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
        .slice(0, Math.max(0, Math.floor(limit)));
    return candidates.map((candidate) => ({
        ...candidate,
        regime,
        referenceTs: universe[candidate.symbol][index].endTs,
        entryTs: universe[candidate.symbol][index + 1]?.ts || universe[candidate.symbol][index].endTs,
    }));
}

export interface V12PositionSizing {
    requestedNotional: number;
    requestedGross: number;
    stopDistance: number;
    riskCapital: number;
    entryPrice: number;
    quantity: number;
}

function finite(value: unknown, fallback = NaN) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function validCandle(c: V12H1Candle) {
    return [c.ts, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
        && c.ts > 0 && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0 && c.volume >= 0;
}

/** Resample only complete contiguous H1 pairs. Missing candles are rejected. */
export function resampleV12H1ToH2(input: V12H1Candle[]): V12Bar[] {
    const sorted = [...input].sort((a, b) => a.ts - b.ts);
    for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i].ts === sorted[i - 1].ts) return [];
    }
    const output: V12Bar[] = [];
    let startIndex = 0;
    while (startIndex < sorted.length && sorted[startIndex].ts % 7_200_000 !== 0) startIndex += 1;
    for (let i = startIndex; i < sorted.length; i += 2) {
        const first = sorted[i];
        const second = sorted[i + 1];
        if (!first || !second || !validCandle(first) || !validCandle(second)) continue;
        if (first.ts % 7_200_000 !== 0 || second.ts !== first.ts + 3_600_000) continue;
        if (first.closed === false || second.closed === false) continue;
        output.push({
            ts: first.ts,
            endTs: second.ts + 3_600_000,
            open: first.open,
            high: Math.max(first.high, second.high),
            low: Math.min(first.low, second.low),
            close: second.close,
            volume: first.volume + second.volume,
            sourceCount: 2,
        });
    }
    return output;
}

function sampleStd(values: number[]) {
    if (values.length < 2) return NaN;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(Math.max(0, variance));
}

function logReturns(bars: V12Bar[], endExclusive: number, lookback: number) {
    const result: number[] = [];
    const start = Math.max(1, endExclusive - lookback);
    for (let i = start; i < endExclusive; i += 1) {
        const previous = bars[i - 1]?.close;
        const current = bars[i]?.close;
        if (!(previous > 0 && current > 0)) return [];
        result.push(Math.log(current / previous));
    }
    return result;
}

function atr(bars: V12Bar[], endExclusive: number, lookback: number) {
    const start = Math.max(1, endExclusive - lookback);
    if (endExclusive - start < lookback) return NaN;
    const values: number[] = [];
    for (let i = start; i < endExclusive; i += 1) {
        const current = bars[i];
        const previous = bars[i - 1];
        if (!current || !previous) return NaN;
        values.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
    }
    return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeV12Regime(btcBars: V12Bar[], index: number): V12Regime | null {
    if (index < V12_X1_ALL.btcRegimeSmaBars || index < V12_X1_ALL.btcRegimeMomentumBars) return null;
    const current = btcBars[index]?.close;
    if (!(current > 0)) return null;
    const smaSlice = btcBars.slice(index - V12_X1_ALL.btcRegimeSmaBars + 1, index + 1).map((bar) => bar.close);
    if (smaSlice.length !== V12_X1_ALL.btcRegimeSmaBars || smaSlice.some((value) => !(value > 0))) return null;
    const sma = smaSlice.reduce((a, b) => a + b, 0) / smaSlice.length;
    const momentumBase = btcBars[index - V12_X1_ALL.btcRegimeMomentumBars]?.close;
    if (!(momentumBase > 0)) return null;
    const distance = current / sma - 1;
    const momentum = current / momentumBase - 1;
    if (distance >= V12_X1_ALL.regimeThresholdPct && momentum > 0) return "LONG";
    if (distance <= -V12_X1_ALL.regimeThresholdPct && momentum < 0) return "SHORT";
    return "NEUTRAL";
}

export function evaluateV12Candidate(symbol: string, bars: V12Bar[], index: number, regime: V12Regime | null): V12CandidateGate {
    const current = bars[index];
    const base = bars[index - V12_X1_ALL.momentumBars];
    const empty = { symbol, regime, available: false, passed: false, gates: { history: false, indicators: false, volume: false, edge: false, momentum: false, regime: false }, reasons: [] } as V12CandidateGate;
    if (!current || !base || !(current.close > 0 && base.close > 0) || index < V12_X1_ALL.atrBars) return empty;
    const momentum = current.close / base.close - 1;
    const returns = logReturns(bars, index + 1, V12_X1_ALL.volatilityLookbackBars);
    const volatility = sampleStd(returns);
    const currentAtr = atr(bars, index + 1, V12_X1_ALL.atrBars);
    const volumeWindow = bars.slice(Math.max(0, index - 20), index).map((bar) => bar.volume);
    const volumeMean = volumeWindow.length ? volumeWindow.reduce((a, b) => a + b, 0) / volumeWindow.length : NaN;
    const volumeRatio = volumeMean > 0 ? current.volume / volumeMean : NaN;
    if (![momentum, volatility, currentAtr, volumeRatio].every(Number.isFinite)) return { ...empty, available: true, reasons: ["INDICATORS_UNAVAILABLE"] };
    const scale = Math.max(0.0001, volatility * Math.sqrt(V12_X1_ALL.momentumBars));
    const raw = momentum / scale;
    const score = raw / (1 + V12_X1_ALL.volatilityPenalty * volatility * 100);
    const side: V12Side = momentum >= 0 ? "LONG" : "SHORT";
    const sideScore = side === "LONG" ? score : -score;
    const gates = {
        history: true,
        indicators: true,
        volume: volumeRatio >= V12_X1_ALL.minimumVolumeRatio,
        edge: Math.abs(momentum) >= V12_X1_ALL.minimumEdgeToCostRatio * (V12_X1_ALL.normalRoundTripCostBps / 10_000),
        momentum: side === "LONG" ? momentum >= V12_X1_ALL.minimumMomentumPct : momentum <= -V12_X1_ALL.minimumMomentumPct,
        regime: regime === "LONG" ? side === "LONG" : regime === "SHORT" ? side === "SHORT" : V12_X1_ALL.allowNeutralRegime && sideScore >= V12_X1_ALL.neutralScoreThreshold,
    };
    const reasons: string[] = [];
    if (!gates.volume) reasons.push("VOLUME_RATIO_BELOW_MIN");
    if (!gates.edge) reasons.push("EDGE_TO_COST_BELOW_MIN");
    if (!gates.momentum) reasons.push("MOMENTUM_BELOW_MIN");
    if (!gates.regime) reasons.push("BTC_REGIME_DIRECTION_BLOCKED");
    return { symbol, regime, available: true, passed: Object.values(gates).every(Boolean), side, momentum, volatility, atr: currentAtr, volumeRatio, score: sideScore, gates, reasons };
}

function candidateFor(symbol: string, bars: V12Bar[], index: number, regime: V12Regime): V12Candidate | null {
    const diagnosis = evaluateV12Candidate(symbol, bars, index, regime);
    if (!diagnosis.passed || !diagnosis.side || diagnosis.momentum === undefined || diagnosis.volatility === undefined || diagnosis.atr === undefined || diagnosis.volumeRatio === undefined || diagnosis.score === undefined) return null;
    return { symbol, side: diagnosis.side, momentum: diagnosis.momentum, volatility: diagnosis.volatility, atr: diagnosis.atr, volumeRatio: diagnosis.volumeRatio, score: diagnosis.score };
}

export function buildV12Signal(universe: Record<string, V12Bar[]>, index: number): V12Signal | null {
    return buildV12Signals(universe, index, 1)[0] || null;
}

export function sizeV12Position(equity: number, entryPrice: number, candidateAtr: number, side: V12Side): V12PositionSizing {
    if (!(equity > 0 && entryPrice > 0 && candidateAtr > 0)) throw new Error("V12 sizing inputs must be positive");
    const stopDistance = Math.max(candidateAtr * V12_X1_ALL.stopAtr, entryPrice * 0.005);
    const riskCapital = equity * V12_X1_ALL.riskPerTradePct / 100;
    const riskNotional = riskCapital / (stopDistance / entryPrice);
    const marginNotional = equity * V12_X1_ALL.leverage * V12_X1_ALL.maxMarginUsagePct / 100;
    const requestedNotional = Math.min(riskNotional, marginNotional) * V12_X1_ALL.multiplier;
    return { requestedNotional, requestedGross: requestedNotional / equity, stopDistance, riskCapital, entryPrice, quantity: requestedNotional / entryPrice };
}

export function protectiveLevels(entryPrice: number, atrAtEntry: number, side: V12Side) {
    const stopDistance = Math.max(atrAtEntry * V12_X1_ALL.stopAtr, entryPrice * 0.005);
    const takeProfitDistance = atrAtEntry * V12_X1_ALL.takeProfitAtr;
    const initialStop = side === "LONG" ? entryPrice - stopDistance : entryPrice + stopDistance;
    const takeProfit = side === "LONG" ? entryPrice + takeProfitDistance : entryPrice - takeProfitDistance;
    return { initialStop, takeProfit, trailingDistance: atrAtEntry * V12_X1_ALL.trailingAtr };
}

export function nextTrailingStop(side: V12Side, currentStop: number, peakOrTrough: number, trailingDistance: number) {
    const candidate = side === "LONG" ? peakOrTrough - trailingDistance : peakOrTrough + trailingDistance;
    return side === "LONG" ? Math.max(currentStop, candidate) : Math.min(currentStop, candidate);
}
