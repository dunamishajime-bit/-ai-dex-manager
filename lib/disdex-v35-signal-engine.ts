import {
    DISDEX_RESILIENT_PROFIT_MAIN_V35,
    resolveDisDexV35Allocation,
    type DisDexV35AllocationPlan,
    type DisDexV35Regime,
} from "@/lib/disdex-resilient-profit-main-v35";

export type DisDexV35Symbol = "BTCUSDT" | "ETHUSDT" | "BNBUSDT" | "SOLUSDT" | "PENGUUSDT";
export type DisDexV35CoreSymbol = Exclude<DisDexV35Symbol, "PENGUUSDT">;

export interface DisDexV35Candle {
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface DisDexV35MarketHistory {
    core12h: Record<DisDexV35CoreSymbol, DisDexV35Candle[]>;
    btc1h: DisDexV35Candle[];
    pengu1h: DisDexV35Candle[];
}

export type DisDexPenguFamily = "TREND" | "BREAKOUT" | "DUAL_MOM" | "REVERSAL";
export type DisDexPenguBtcFilter = "NONE" | "DIRECTION" | "RISK";

export interface DisDexPenguRule {
    id: string;
    family: DisDexPenguFamily;
    fast: number;
    slow: number;
    threshold: number;
    volumeFloor: number;
    btcFilter: DisDexPenguBtcFilter;
    decisionHours: number;
    holdHours: number;
    enabled: boolean;
}

export interface DisDexV35SignalResult {
    strategyId: typeof DISDEX_RESILIENT_PROFIT_MAIN_V35.id;
    referenceTs: number;
    regime: DisDexV35Regime;
    coreTargetBeforeV35: Partial<Record<DisDexV35CoreSymbol, number>>;
    coreGrossBeforeV35: number;
    penguSide: -1 | 0 | 1;
    penguEntryTs?: number;
    penguExitTs?: number;
    allocation: DisDexV35AllocationPlan;
    targetWeights: Partial<Record<DisDexV35Symbol, number>>;
    diagnostics: {
        btcCloseAboveSma20d: boolean;
        btcMomentum20dPct: number;
        btcMomentum3dPct: number;
        btcShock1dPct: number;
        coreDownsideVolatilitySkew: number;
        bearConfirmationBars: number;
        penguRuleId: string;
    };
}

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

function sma(rows: DisDexV35Candle[], end: number, length: number): number | undefined {
    if (length <= 0 || end - length + 1 < 0) return undefined;
    let sum = 0;
    for (let index = end - length + 1; index <= end; index += 1) sum += rows[index].close;
    return sum / length;
}

function momentum(rows: DisDexV35Candle[], end: number, length: number): number | undefined {
    const prior = end - length;
    if (prior < 0 || rows[prior].close <= 0) return undefined;
    return (rows[end].close / rows[prior].close - 1) * 100;
}

function mean(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]) {
    if (values.length < 2) return 0;
    const average = mean(values);
    return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
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

function gross(weights: Partial<Record<DisDexV35Symbol, number>>) {
    return Object.values(weights).reduce((sum, value) => sum + Math.abs(finite(value)), 0);
}

function componentTarget(
    component: Component,
    ts: number,
    bars: Record<DisDexV35CoreSymbol, DisDexV35Candle[]>,
    indexes: Record<DisDexV35CoreSymbol, Map<number, number>>,
): Partial<Record<DisDexV35CoreSymbol, number>> {
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
            if (volume >= 0.7) {
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

function averageWeights(members: Array<Partial<Record<DisDexV35CoreSymbol, number>>>) {
    const result: Partial<Record<DisDexV35CoreSymbol, number>> = {};
    for (const symbol of CORE_SYMBOLS) {
        const value = mean(members.map((weights) => finite(weights[symbol])));
        if (Math.abs(value) > 1e-12) result[symbol] = value;
    }
    return result;
}

function overlayTarget(
    ts: number,
    members: Array<Partial<Record<DisDexV35CoreSymbol, number>>>,
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
    ) as Partial<Record<DisDexV35CoreSymbol, number>>;
}

function rankTiltVwm25(
    target: Partial<Record<DisDexV35CoreSymbol, number>>,
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
    const ordered = selected.filter((symbol) => scores.has(symbol)).sort((left, right) => finite(scores.get(right)) - finite(scores.get(left)));
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
    target: Partial<Record<DisDexV35CoreSymbol, number>>,
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
    ) as Partial<Record<DisDexV35CoreSymbol, number>>;
}

function rawBearTarget(
    ts: number,
    bars: Record<DisDexV35CoreSymbol, DisDexV35Candle[]>,
    indexes: Record<DisDexV35CoreSymbol, Map<number, number>>,
) {
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

function buildCoreSeries(history: DisDexV35MarketHistory) {
    const bars = Object.fromEntries(
        CORE_SYMBOLS.map((symbol) => [symbol, cleanRows(history.core12h[symbol])]),
    ) as Record<DisDexV35CoreSymbol, DisDexV35Candle[]>;
    const indexes = Object.fromEntries(
        CORE_SYMBOLS.map((symbol) => [symbol, new Map(bars[symbol].map((row, index) => [row.openTime, index]))]),
    ) as Record<DisDexV35CoreSymbol, Map<number, number>>;
    const times = bars.BTCUSDT.map((row) => row.openTime).filter((ts) => CORE_SYMBOLS.every((symbol) => indexes[symbol].has(ts)));
    if (times.length < 140) throw new Error(`V35 core history is insufficient: ${times.length} common 12h bars.`);

    let current = COMPONENTS.map(() => ({} as Partial<Record<DisDexV35CoreSymbol, number>>));
    let pending = COMPONENTS.map(() => undefined as Partial<Record<DisDexV35CoreSymbol, number>> | undefined);
    let bearCount = 0;
    let lastTarget: Partial<Record<DisDexV35CoreSymbol, number>> = {};
    let lastBase: Partial<Record<DisDexV35CoreSymbol, number>> = {};
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
        const base = applyVolatilitySkew125(rankTiltVwm25(overlayTarget(ts, projected, bars, indexes), ts, bars, indexes), ts, bars, indexes);
        const bear = rawBearTarget(ts, bars, indexes);
        bearCount = gross(bear) > 0 ? bearCount + 1 : 0;
        const confirmedBear = bearCount >= 4 ? bear : {};
        lastBase = base;
        lastTarget = gross(base) > 0.05 ? base : confirmedBear;
    }
    return { bars, indexes, times, target: lastTarget, base: lastBase, bearCount };
}

function rsi(rows: DisDexV35Candle[], end: number, length = 14): number | undefined {
    if (end - length < 0) return undefined;
    let gains = 0;
    let losses = 0;
    for (let index = end - length + 1; index <= end; index += 1) {
        const change = rows[index].close - rows[index - 1].close;
        gains += Math.max(change, 0);
        losses += Math.max(-change, 0);
    }
    if (losses <= 0) return gains > 0 ? 100 : 50;
    const relative = gains / losses;
    return 100 - 100 / (1 + relative);
}

function penguBtcGate(direction: -1 | 1, mode: DisDexPenguBtcFilter, btc: DisDexV35Candle[], index: number) {
    if (mode === "NONE") return true;
    const average = sma(btc, index, 168);
    const mom = momentum(btc, index, 72);
    if (average === undefined || mom === undefined) return false;
    const close = btc[index].close;
    if (mode === "DIRECTION") return direction > 0 ? close > average && mom > 0 : close < average && mom < 0;
    return !((direction > 0 && close < average && mom < -2) || (direction < 0 && close > average && mom > 4));
}

function penguSignal(rule: DisDexPenguRule, pengu: DisDexV35Candle[], pIndex: number, btc: DisDexV35Candle[], bIndex: number): -1 | 0 | 1 {
    if (!rule.enabled || pIndex < Math.max(rule.slow, 80) || bIndex < 168) return 0;
    const volume = volumeRatio(pengu, pIndex, 12, 72);
    if (rule.volumeFloor > 0 && (volume === undefined || volume < rule.volumeFloor)) return 0;
    const close = pengu[pIndex].close;
    let direction: -1 | 0 | 1 = 0;
    if (rule.family === "TREND") {
        const average = sma(pengu, pIndex, rule.slow);
        const mom = momentum(pengu, pIndex, rule.fast);
        if (average !== undefined && mom !== undefined) {
            if (close > average && mom > rule.threshold) direction = 1;
            else if (close < average && mom < -rule.threshold) direction = -1;
        }
    } else if (rule.family === "BREAKOUT") {
        if (pIndex - rule.slow >= 0) {
            const prior = pengu.slice(pIndex - rule.slow, pIndex);
            const confirm = momentum(pengu, pIndex, rule.fast);
            const high = Math.max(...prior.map((row) => row.high));
            const low = Math.min(...prior.map((row) => row.low));
            if (confirm !== undefined && close > high && confirm > rule.threshold) direction = 1;
            else if (confirm !== undefined && close < low && confirm < -rule.threshold) direction = -1;
        }
    } else if (rule.family === "DUAL_MOM") {
        const fast = momentum(pengu, pIndex, rule.fast);
        const slow = momentum(pengu, pIndex, rule.slow);
        if (fast !== undefined && slow !== undefined) {
            const score = fast + slow * 0.5;
            if (fast > 0 && slow > 0 && score > rule.threshold) direction = 1;
            else if (fast < 0 && slow < 0 && score < -rule.threshold) direction = -1;
        }
    } else {
        const value = rsi(pengu, pIndex, rule.fast);
        const average = sma(pengu, pIndex, rule.slow);
        if (value !== undefined && average !== undefined) {
            const distance = (close / average - 1) * 100;
            if (value <= rule.threshold && distance > -12) direction = 1;
            else if (value >= 100 - rule.threshold && distance < 12) direction = -1;
        }
    }
    return direction && penguBtcGate(direction, rule.btcFilter, btc, bIndex) ? direction : 0;
}

function activePenguTrade(history: DisDexV35MarketHistory, rule: DisDexPenguRule, now: number) {
    if (!rule.enabled) return { side: 0 as const };
    const pengu = cleanRows(history.pengu1h);
    const btc = cleanRows(history.btc1h);
    const penguIndex = new Map(pengu.map((row, index) => [row.openTime, index]));
    const btcIndex = new Map(btc.map((row, index) => [row.openTime, index]));
    const common = [...penguIndex.keys()].filter((ts) => btcIndex.has(ts)).sort((left, right) => left - right);
    let nextFree = 0;
    let active: { side: -1 | 1; entryTs: number; exitTs: number } | undefined;
    for (const ts of common) {
        if (ts < nextFree || Math.floor(ts / HOUR) % rule.decisionHours !== 0) continue;
        const pIndex = penguIndex.get(ts);
        const bIndex = btcIndex.get(ts);
        if (pIndex === undefined || bIndex === undefined) continue;
        const side = penguSignal(rule, pengu, pIndex, btc, bIndex);
        if (!side) continue;
        const entry = pengu[pIndex + 1];
        const exit = pengu[pIndex + 1 + rule.holdHours];
        if (!entry || !exit || exit.openTime - entry.openTime !== rule.holdHours * HOUR) continue;
        nextFree = exit.openTime;
        if (entry.openTime <= now && now < exit.openTime) active = { side, entryTs: entry.openTime, exitTs: exit.openTime };
        if (entry.openTime > now) break;
    }
    return active ? { side: active.side, entryTs: active.entryTs, exitTs: active.exitTs } : { side: 0 as const };
}

export function buildDisDexV35Signal(history: DisDexV35MarketHistory, penguRule: DisDexPenguRule, now = Date.now()): DisDexV35SignalResult {
    const core = buildCoreSeries(history);
    const referenceTs = core.times.at(-1) || 0;
    const btcIndex = core.indexes.BTCUSDT.get(referenceTs);
    if (btcIndex === undefined) throw new Error("V35 BTC reference bar is missing.");
    const btc = core.bars.BTCUSDT;
    const sma20d = sma(btc, btcIndex, 40);
    const momentum20d = momentum(btc, btcIndex, 40);
    const momentum3d = momentum(btc, btcIndex, 6);
    const shock1d = momentum(btc, btcIndex, 2);
    if (sma20d === undefined || momentum20d === undefined || momentum3d === undefined || shock1d === undefined) {
        throw new Error("V35 BTC feature history is insufficient.");
    }
    const skews = ROTATION_SYMBOLS.map((symbol) => {
        const index = core.indexes[symbol].get(referenceTs);
        return index === undefined ? undefined : downsideSkew(core.bars[symbol], index, 40);
    }).filter((value): value is number => value !== undefined);
    const maxSkew = skews.length ? Math.max(...skews) : 1;
    const coreTarget = core.target;
    const coreGross = gross(coreTarget);
    const regime: DisDexV35Regime = Object.values(coreTarget).some((weight) => finite(weight) > 0)
        ? "BULL"
        : Object.values(coreTarget).some((weight) => finite(weight) < 0)
            ? "BEAR"
            : "FLAT";
    const pengu = activePenguTrade(history, penguRule, now);
    const allocation = resolveDisDexV35Allocation({
        regime,
        coreGross,
        penguSignalActive: pengu.side !== 0,
        features: {
            btcCloseAboveSma20d: btc[btcIndex].close > sma20d,
            btcMomentum20dPct: momentum20d,
            btcMomentum3dPct: momentum3d,
            btcShock1dPct: shock1d,
            coreDownsideVolatilitySkew: maxSkew,
        },
    });
    const targetWeights: Partial<Record<DisDexV35Symbol, number>> = {};
    const coreScale = coreGross > 0 ? allocation.finalCoreGross / coreGross : 0;
    for (const [symbol, weight] of Object.entries(coreTarget)) {
        const value = finite(weight) * coreScale;
        if (Math.abs(value) > 1e-8) targetWeights[symbol as DisDexV35CoreSymbol] = value;
    }
    if (pengu.side) targetWeights.PENGUUSDT = pengu.side * allocation.finalPenguGross;
    return {
        strategyId: DISDEX_RESILIENT_PROFIT_MAIN_V35.id,
        referenceTs,
        regime,
        coreTargetBeforeV35: coreTarget,
        coreGrossBeforeV35: coreGross,
        penguSide: pengu.side,
        penguEntryTs: pengu.entryTs,
        penguExitTs: pengu.exitTs,
        allocation,
        targetWeights,
        diagnostics: {
            btcCloseAboveSma20d: btc[btcIndex].close > sma20d,
            btcMomentum20dPct: momentum20d,
            btcMomentum3dPct: momentum3d,
            btcShock1dPct: shock1d,
            coreDownsideVolatilitySkew: maxSkew,
            bearConfirmationBars: core.bearCount,
            penguRuleId: penguRule.id,
        },
    };
}
