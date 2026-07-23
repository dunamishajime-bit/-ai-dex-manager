import { DISDEX_V96_ALLOCATION } from "@/config/disdexV96Runtime";
import type { DisDexV35Candle, DisDexV35CoreSymbol } from "@/lib/disdex-v35-signal-engine";

export type DisDexV96CoreWeightMap = Partial<Record<DisDexV35CoreSymbol, number>>;

interface Component {
    regimeDays: number;
    momentumDays: number;
    rebalanceDays: number;
    topK: 1 | 2;
}

const HOUR = 3_600_000;
const BAR_12H = 12 * HOUR;
const START_2023 = 1_672_531_200_000;
const BASE_ALLOCATION = 0.9;
const CORE_SYMBOLS: DisDexV35CoreSymbol[] = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"];
const ROTATION_SYMBOLS: DisDexV35CoreSymbol[] = ["ETHUSDT", "BNBUSDT", "SOLUSDT"];

const COMPONENTS: Component[] = [
    { regimeDays: 30, momentumDays: 10, rebalanceDays: 3.5, topK: 1 },
    { regimeDays: 30, momentumDays: 10, rebalanceDays: 5.5, topK: 1 },
    { regimeDays: 42, momentumDays: 10, rebalanceDays: 3.5, topK: 1 },
    { regimeDays: 30, momentumDays: 30, rebalanceDays: 3.5, topK: 2 },
    { regimeDays: 42, momentumDays: 30, rebalanceDays: 3.5, topK: 2 },
    { regimeDays: 30, momentumDays: 10, rebalanceDays: 3.5, topK: 2 },
    { regimeDays: 30, momentumDays: 10, rebalanceDays: 5.5, topK: 2 },
    { regimeDays: 30, momentumDays: 20, rebalanceDays: 3.5, topK: 2 },
    { regimeDays: 42, momentumDays: 10, rebalanceDays: 3.5, topK: 2 },
    { regimeDays: 42, momentumDays: 20, rebalanceDays: 3.5, topK: 2 },
];

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function cleanRows(rows: DisDexV35Candle[]) {
    return [...rows]
        .filter((row) => row.openTime > 0 && row.closeTime > row.openTime && row.open > 0 && row.close > 0)
        .sort((left, right) => left.openTime - right.openTime)
        .filter((row, index, source) => index === 0 || row.openTime !== source[index - 1].openTime);
}

function mean(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]) {
    if (values.length < 2) return 0;
    const average = mean(values);
    return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function sma(rows: DisDexV35Candle[], end: number, length: number): number | undefined {
    if (length <= 0 || end - length + 1 < 0) return undefined;
    return mean(rows.slice(end - length + 1, end + 1).map((row) => row.close));
}

function momentum(rows: DisDexV35Candle[], end: number, length: number): number | undefined {
    const prior = end - length;
    if (prior < 0 || rows[prior].close <= 0) return undefined;
    return (rows[end].close / rows[prior].close - 1) * 100;
}

function realizedAnnualVol(rows: DisDexV35Candle[], end: number, length = 40): number | undefined {
    if (end - length < 0) return undefined;
    const returns: number[] = [];
    for (let index = end - length + 1; index <= end; index += 1) {
        const previous = rows[index - 1].close;
        const close = rows[index].close;
        if (previous > 0 && close > 0) returns.push(Math.log(close / previous));
    }
    return standardDeviation(returns) * Math.sqrt(730) * 100;
}

function volumeRatio(rows: DisDexV35Candle[], end: number, recent = 20, base = 80): number | undefined {
    if (end - base + 1 < 0 || recent >= base) return undefined;
    const recentValues = rows.slice(end - recent + 1, end + 1).map((row) => row.volume);
    const baseValues = rows.slice(end - base + 1, end - recent + 1).map((row) => row.volume);
    const denominator = mean(baseValues);
    return denominator > 0 ? mean(recentValues) / denominator : undefined;
}

function downsideSkew(rows: DisDexV35Candle[], end: number, length = 40): number | undefined {
    if (end - length < 0) return undefined;
    const positive: number[] = [];
    const negative: number[] = [];
    for (let index = end - length + 1; index <= end; index += 1) {
        const previous = rows[index - 1].close;
        const close = rows[index].close;
        if (previous <= 0 || close <= 0) continue;
        const value = Math.log(close / previous);
        if (value >= 0) positive.push(value);
        else negative.push(Math.abs(value));
    }
    const up = standardDeviation(positive);
    const down = standardDeviation(negative);
    if (up <= 1e-12) return down > 0 ? 3 : 1;
    return Math.min(5, down / up);
}

function gross(weights: DisDexV96CoreWeightMap) {
    return Object.values(weights).reduce((sum, value) => sum + Math.abs(finite(value)), 0);
}

function componentTarget(
    component: Component,
    ts: number,
    bars: Record<DisDexV35CoreSymbol, DisDexV35Candle[]>,
    indexes: Record<DisDexV35CoreSymbol, Map<number, number>>,
): DisDexV96CoreWeightMap {
    const btcIndex = indexes.BTCUSDT.get(ts);
    if (btcIndex === undefined) return {};
    const btc = bars.BTCUSDT;
    const regimeBars = component.regimeDays * 2;
    const momentumBars = component.momentumDays * 2;
    const btcAverage = sma(btc, btcIndex, regimeBars);
    const btcMomentum = momentum(btc, btcIndex, momentumBars);
    if (btcAverage === undefined || btcMomentum === undefined) return {};
    if (!(btc[btcIndex].close > btcAverage && btcMomentum > 0)) return {};

    const candidates: Array<{ symbol: DisDexV35CoreSymbol; score: number }> = [];
    let breadth = 0;
    for (const symbol of ROTATION_SYMBOLS) {
        const index = indexes[symbol].get(ts);
        if (index === undefined) continue;
        const rows = bars[symbol];
        const average = sma(rows, index, 44);
        const symbolMomentum = momentum(rows, index, momentumBars);
        const volatility = realizedAnnualVol(rows, index, momentumBars);
        const volume = volumeRatio(rows, index);
        if (average === undefined || symbolMomentum === undefined || volatility === undefined || volume === undefined) continue;
        if (rows[index].close > average && symbolMomentum > 0) {
            breadth += 1;
            if (volume >= DISDEX_V96_ALLOCATION.corePolicy.componentVolumeFloor) {
                const relative = symbolMomentum - btcMomentum;
                const score = symbolMomentum + relative * 0.3 - (volatility / Math.sqrt(36.5)) * 0.18 + Math.min(2, volume);
                candidates.push({ symbol, score });
            }
        }
    }
    if (breadth < 1 || !candidates.length) return {};
    const selected = candidates.sort((left, right) => right.score - left.score).slice(0, component.topK);
    const each = BASE_ALLOCATION / selected.length;
    return Object.fromEntries(selected.map((item) => [item.symbol, each]));
}

function averageWeights(members: DisDexV96CoreWeightMap[]) {
    const result: DisDexV96CoreWeightMap = {};
    for (const symbol of CORE_SYMBOLS) {
        const value = mean(members.map((weights) => finite(weights[symbol])));
        if (Math.abs(value) > 1e-12) result[symbol] = value;
    }
    return result;
}

function overlayTarget(
    ts: number,
    members: DisDexV96CoreWeightMap[],
    bars: Record<DisDexV35CoreSymbol, DisDexV35Candle[]>,
    indexes: Record<DisDexV35CoreSymbol, Map<number, number>>,
) {
    if (members.filter((weights) => gross(weights) > 0).length / members.length < 0.5) return {};
    const target = averageWeights(members);
    const targetGross = gross(target);
    if (targetGross <= 0) return {};
    const btcIndex = indexes.BTCUSDT.get(ts);
    if (btcIndex === undefined) return {};
    const volatility = realizedAnnualVol(bars.BTCUSDT, btcIndex, 40);
    if (volatility === undefined || volatility <= 0) return {};
    const scale = Math.min(45 / volatility, 1.1 / targetGross);
    return Object.fromEntries(
        Object.entries(target)
            .map(([symbol, weight]) => [symbol, finite(weight) * scale])
            .filter(([, weight]) => Math.abs(finite(weight)) > 1e-12),
    ) as DisDexV96CoreWeightMap;
}

function rankTiltVwm25(
    target: DisDexV96CoreWeightMap,
    ts: number,
    bars: Record<DisDexV35CoreSymbol, DisDexV35Candle[]>,
    indexes: Record<DisDexV35CoreSymbol, Map<number, number>>,
) {
    const selected = ROTATION_SYMBOLS.filter((symbol) => finite(target[symbol]) > 0);
    if (selected.length < 2) return { ...target };
    const scores = new Map<DisDexV35CoreSymbol, number>();
    for (const symbol of selected) {
        const index = indexes[symbol].get(ts);
        if (index === undefined) continue;
        const mom = momentum(bars[symbol], index, 20);
        const volume = volumeRatio(bars[symbol], index, 20, 80);
        const volatility = realizedAnnualVol(bars[symbol], index, 40);
        if (mom !== undefined && volume !== undefined && volatility !== undefined && volatility > 0) {
            scores.set(symbol, mom * Math.min(2.5, Math.max(0.25, volume)) / volatility);
        }
    }
    if (scores.size < 2) return { ...target };
    const ordered = selected
        .filter((symbol) => scores.has(symbol))
        .sort((left, right) => finite(scores.get(right)) - finite(scores.get(left)));
    const middle = (ordered.length - 1) / 2;
    const originalGross = selected.reduce((sum, symbol) => sum + finite(target[symbol]), 0);
    const raw = new Map<DisDexV35CoreSymbol, number>();
    for (const [rank, symbol] of ordered.entries()) {
        const direction = (middle - rank) / Math.max(1, middle);
        raw.set(symbol, finite(target[symbol]) * Math.max(0.25, 1 + 0.25 * direction));
    }
    const rawGross = [...raw.values()].reduce((sum, value) => sum + value, 0);
    if (rawGross <= 0) return { ...target };
    const result = { ...target };
    for (const symbol of selected) {
        if (raw.has(symbol)) result[symbol] = finite(raw.get(symbol)) * originalGross / rawGross;
    }
    return result;
}

function applyVolatilitySkew125(
    target: DisDexV96CoreWeightMap,
    ts: number,
    bars: Record<DisDexV35CoreSymbol, DisDexV35Candle[]>,
    indexes: Record<DisDexV35CoreSymbol, Map<number, number>>,
) {
    const skews = ROTATION_SYMBOLS
        .filter((symbol) => finite(target[symbol]) > 0)
        .map((symbol) => {
            const index = indexes[symbol].get(ts);
            return index === undefined ? undefined : downsideSkew(bars[symbol], index, 40);
        })
        .filter((value): value is number => value !== undefined);
    const scale = (skews.length ? Math.max(...skews) : 1) > 1.25 ? 0.65 : 1;
    return Object.fromEntries(
        Object.entries(target).map(([symbol, weight]) => [symbol, finite(weight) * scale]),
    ) as DisDexV96CoreWeightMap;
}

function rawBearTarget(
    ts: number,
    bars: Record<DisDexV35CoreSymbol, DisDexV35Candle[]>,
    indexes: Record<DisDexV35CoreSymbol, Map<number, number>>,
): DisDexV96CoreWeightMap {
    const btcIndex = indexes.BTCUSDT.get(ts);
    if (btcIndex === undefined) return {};
    const slow = sma(bars.BTCUSDT, btcIndex, 120);
    const btcMomentum = momentum(bars.BTCUSDT, btcIndex, 60);
    if (slow === undefined || btcMomentum === undefined) return {};
    if (!(bars.BTCUSDT[btcIndex].close < slow && btcMomentum < -2)) return {};
    let bearish = 0;
    for (const symbol of ROTATION_SYMBOLS) {
        const index = indexes[symbol].get(ts);
        if (index === undefined) continue;
        const average = sma(bars[symbol], index, 44);
        const symbolMomentum = momentum(bars[symbol], index, 60);
        if (average !== undefined && symbolMomentum !== undefined && bars[symbol][index].close < average && symbolMomentum < 0) bearish += 1;
    }
    return bearish >= 2 ? { BTCUSDT: -0.4 } : {};
}

export function buildDisDexV96CoreTargetSeries(
    core12h: Record<DisDexV35CoreSymbol, DisDexV35Candle[]>,
) {
    const bars = Object.fromEntries(
        CORE_SYMBOLS.map((symbol) => [symbol, cleanRows(core12h[symbol])]),
    ) as Record<DisDexV35CoreSymbol, DisDexV35Candle[]>;
    const indexes = Object.fromEntries(
        CORE_SYMBOLS.map((symbol) => [symbol, new Map(bars[symbol].map((row, index) => [row.openTime, index]))]),
    ) as Record<DisDexV35CoreSymbol, Map<number, number>>;
    const times = bars.BTCUSDT
        .map((row) => row.openTime)
        .filter((ts) => CORE_SYMBOLS.every((symbol) => indexes[symbol].has(ts)))
        .sort((left, right) => left - right);
    if (times.length < 140) throw new Error(`V96 core history is insufficient: ${times.length} common 12h bars.`);

    let current = COMPONENTS.map(() => ({} as DisDexV96CoreWeightMap));
    let pending = COMPONENTS.map(() => undefined as DisDexV96CoreWeightMap | undefined);
    let bearCount = 0;
    const targets = new Map<number, DisDexV96CoreWeightMap>();
    for (const ts of times) {
        current = current.map((value, index) => pending[index] ?? value);
        pending = pending.map(() => undefined);
        const projected = COMPONENTS.map((component, index) => {
            const candidate = componentTarget(component, ts, bars, indexes);
            const rebalanceBars = Math.max(1, Math.round(component.rebalanceDays * 2));
            const scheduled = Math.round((ts - START_2023) / BAR_12H) % rebalanceBars === 0;
            const regimeExit = gross(current[index]) > 0 && gross(candidate) === 0;
            if (scheduled || regimeExit) {
                pending[index] = candidate;
                return candidate;
            }
            return current[index];
        });
        const base = applyVolatilitySkew125(
            rankTiltVwm25(overlayTarget(ts, projected, bars, indexes), ts, bars, indexes),
            ts,
            bars,
            indexes,
        );
        const bear = rawBearTarget(ts, bars, indexes);
        bearCount = gross(bear) > 0 ? bearCount + 1 : 0;
        const confirmedBear = bearCount >= 4 ? bear : {};
        targets.set(ts, gross(base) > 0.05 ? base : confirmedBear);
    }
    return { targets, times };
}
