import { QUALITY102_CAUSAL_V1 } from "../config/disdexQuality102CausalV1Runtime";
import {
    QUALITY102_DAY_MS,
    QUALITY102_HIGH_VOL_GRID,
    QUALITY102_HOUR_MS,
    QUALITY102_RESEARCH_COSTS,
    computeQuality102HighVolFeatures,
    matchQuality102HighVolGrid,
    monthStartUtc,
    selectQuality102HighVolMonthlyRule,
    type Quality102Candle,
    type Quality102HighVolFeatures,
    type Quality102HighVolMonthlyRuleStats,
    type Quality102HighVolRule,
    type Quality102Side,
} from "./disdex-quality102-causal-pipeline";
import { routeQuality102OneSlot } from "./disdex-quality102-causal-selector";

const MINIMUM_HISTORY_HOURS = 181 * 24;
const FEATURE_WARMUP_HOURS = 336;
const MAXIMUM_HOLD_HOURS = 72;
const CORRELATION_HOURS = 30 * 24;
const MINIMUM_CORRELATION_HOURS = 10 * 24;

export interface Quality102CausalV1History {
    candlesBySymbol: Readonly<Record<string, readonly Quality102Candle[]>>;
}

export interface Quality102CausalV1SleeveOccupancy {
    activePosition: boolean;
    unresolvedPendingEntry: boolean;
}

export interface Quality102CausalV1SignalInput {
    history: Quality102CausalV1History;
    decisionTs: number;
    sleeveOccupancy: Quality102CausalV1SleeveOccupancy;
}

export interface Quality102CausalV1Signal {
    strategyId: "QUALITY102_CAUSAL_V1";
    referenceTs: number;
    side: -1 | 0 | 1;
    symbol?: string;
    family?: "HIGH_VOL" | "PB" | "MR" | "REV";
    requestedGross: number;
    reason: string;
    dataCutoffTs: number;
    brkEnabled: false;
}

interface TrainingMetrics {
    trades: number;
    wins: number;
    totalReturn: number;
    winRate: number;
    profitFactor: number;
    expectancy: number;
    maxDrawdown: number;
}

interface MonthlySelection {
    rule: Quality102HighVolRule;
    metrics: TrainingMetrics;
}

interface Candidate {
    id: string;
    symbol: string;
    side: Quality102Side;
    score: number;
}

function finite(value: number): boolean {
    return Number.isFinite(value);
}

function assertClosedCausalHistory(rows: readonly Quality102Candle[], decisionTs: number): void {
    if (rows.length < MINIMUM_HISTORY_HOURS) throw new Error("QUALITY102_INSUFFICIENT_WALK_FORWARD_HISTORY");
    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (row.timestampMs >= decisionTs) throw new Error("QUALITY102_FUTURE_CANDLE");
        if (![row.timestampMs, row.open, row.high, row.low, row.close, row.quoteVolume].every(finite)
            || row.timestampMs <= 0 || row.open <= 0 || row.high <= 0 || row.low <= 0 || row.close <= 0 || row.quoteVolume < 0
            || row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close) || row.high < row.low) {
            throw new Error("QUALITY102_INVALID_CANDLE");
        }
        if (index > 0 && row.timestampMs - rows[index - 1].timestampMs !== QUALITY102_HOUR_MS) {
            throw new Error("QUALITY102_NONCONTIGUOUS_1H");
        }
    }
    if (decisionTs - rows.at(-1)!.timestampMs > 2 * QUALITY102_HOUR_MS) throw new Error("QUALITY102_STALE_CANDLE");
}

function ruleGrid(symbol: string): Quality102HighVolRule[] {
    const pengu = symbol === "PENGUUSDT";
    const longDrops = pengu ? QUALITY102_HIGH_VOL_GRID.longDrops : [0.08, 0.10, 0.12] as const;
    const longRsis = pengu ? QUALITY102_HIGH_VOL_GRID.longRsis : [35, 40] as const;
    const shortRallies = pengu ? QUALITY102_HIGH_VOL_GRID.shortRallies : [0.05, 0.08, 0.10] as const;
    const shortRsis = pengu ? QUALITY102_HIGH_VOL_GRID.shortRsis : [60, 65] as const;
    const rules: Quality102HighVolRule[] = [];
    for (const longDrop of longDrops) for (const longRsi of longRsis) {
        for (const shortRally of shortRallies) for (const shortRsi of shortRsis) {
            for (const hardStop of QUALITY102_HIGH_VOL_GRID.hardStops) rules.push({ longDrop, longRsi, shortRally, shortRsi, hardStop });
        }
    }
    return rules;
}

function matchedSide(features: Quality102HighVolFeatures, rule: Quality102HighVolRule): Quality102Side | undefined {
    const match = matchQuality102HighVolGrid(features).find((candidate) => candidate.hardStop === rule.hardStop && (
        candidate.side === 1
            ? candidate.threshold === rule.longDrop && candidate.rsi === rule.longRsi
            : candidate.threshold === rule.shortRally && candidate.rsi === rule.shortRsi
    ));
    return match?.side;
}

function summarizeReturns(returns: readonly number[]): TrainingMetrics {
    if (!returns.length) return { trades: 0, wins: 0, totalReturn: 0, winRate: 0, profitFactor: 0, expectancy: 0, maxDrawdown: 0 };
    let equity = 1;
    let peak: number | undefined;
    let maxDrawdown = 0;
    let gains = 0;
    let losses = 0;
    let wins = 0;
    for (const value of returns) {
        equity *= 1 + value;
        peak = peak === undefined ? equity : Math.max(peak, equity);
        maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
        if (value > 0) {
            wins += 1;
            gains += value;
        } else {
            losses += value;
        }
    }
    return {
        trades: returns.length,
        wins,
        totalReturn: equity - 1,
        winRate: wins / returns.length,
        profitFactor: losses < 0 ? gains / -losses : 999,
        expectancy: returns.reduce((sum, value) => sum + value, 0) / returns.length,
        maxDrawdown,
    };
}

function trainRule(
    rows: readonly Quality102Candle[],
    features: ReadonlyMap<number, Quality102HighVolFeatures>,
    rule: Quality102HighVolRule,
    firstSignalIndex: number,
    trainingEndIndex: number,
): TrainingMetrics {
    const returns: number[] = [];
    let signalIndex = firstSignalIndex;
    while (signalIndex < trainingEndIndex - MAXIMUM_HOLD_HOURS) {
        const side = matchedSide(features.get(signalIndex)!, rule);
        if (side === undefined) {
            signalIndex += 1;
            continue;
        }
        const entryIndex = signalIndex + 1;
        const entryPrice = rows[entryIndex].open;
        const stopPrice = side === 1 ? entryPrice * (1 - rule.hardStop) : entryPrice * (1 + rule.hardStop);
        let exitIndex = signalIndex + MAXIMUM_HOLD_HOURS;
        let exitPrice = rows[exitIndex].close;
        for (let index = entryIndex; index <= exitIndex; index += 1) {
            if ((side === 1 && rows[index].low <= stopPrice) || (side === -1 && rows[index].high >= stopPrice)) {
                exitIndex = index;
                exitPrice = stopPrice;
                break;
            }
        }
        const holdHours = exitIndex - entryIndex + 1;
        const grossReturn = side * (exitPrice / entryPrice - 1);
        const costs = QUALITY102_RESEARCH_COSTS.normal;
        returns.push(grossReturn - 2 * costs.perSide - costs.fundingPerDay * holdHours / 24);
        signalIndex = exitIndex + 1;
    }
    return summarizeReturns(returns);
}

function monthlySelection(symbol: string, rows: readonly Quality102Candle[], dataCutoffTs: number): MonthlySelection | undefined {
    const monthStartTs = monthStartUtc(dataCutoffTs);
    const trainingStartTs = monthStartTs - 180 * QUALITY102_DAY_MS;
    const trainingEndTs = monthStartTs - QUALITY102_HOUR_MS;
    const firstTs = rows[0].timestampMs;
    if (firstTs > trainingStartTs - FEATURE_WARMUP_HOURS * QUALITY102_HOUR_MS || rows.at(-1)!.timestampMs < trainingEndTs) return undefined;
    const firstSignalIndex = (trainingStartTs - firstTs) / QUALITY102_HOUR_MS;
    const trainingEndIndex = (trainingEndTs - firstTs) / QUALITY102_HOUR_MS;
    if (!Number.isInteger(firstSignalIndex) || !Number.isInteger(trainingEndIndex)) return undefined;

    const features = new Map<number, Quality102HighVolFeatures>();
    for (let index = firstSignalIndex; index < trainingEndIndex - MAXIMUM_HOLD_HOURS; index += 1) {
        features.set(index, computeQuality102HighVolFeatures(rows, index));
    }
    const evaluations: Quality102HighVolMonthlyRuleStats[] = ruleGrid(symbol).map((rule) => {
        const metrics = trainRule(rows, features, rule, firstSignalIndex, trainingEndIndex);
        return { rule, ...metrics, trainingStartTs, trainingEndTs, availableAtTs: trainingEndTs };
    });
    const selected = selectQuality102HighVolMonthlyRule({ monthStartTs, evaluations }).selected;
    if (!selected) return undefined;
    return {
        rule: selected.rule,
        metrics: {
            trades: selected.trades,
            wins: selected.wins,
            totalReturn: selected.totalReturn,
            winRate: selected.winRate,
            profitFactor: selected.profitFactor,
            expectancy: selected.expectancy,
            maxDrawdown: selected.maxDrawdown,
        },
    };
}

function scannerHealthPass(metrics: TrainingMetrics): boolean {
    return metrics.winRate >= 0.58 && metrics.profitFactor >= 1.30 && metrics.expectancy > 0
        && metrics.maxDrawdown >= -0.30 && metrics.trades >= 5;
}

function candidateFor(symbol: string, rows: readonly Quality102Candle[], dataCutoffTs: number): { candidate?: Candidate; selection?: MonthlySelection } {
    const selection = monthlySelection(symbol, rows, dataCutoffTs);
    if (!selection || (symbol !== "PENGUUSDT" && !scannerHealthPass(selection.metrics))) return { selection };
    const features = computeQuality102HighVolFeatures(rows, rows.length - 1);
    const side = matchedSide(features, selection.rule);
    if (side === undefined) return { selection };
    const metrics = selection.metrics;
    const score = 30 * metrics.winRate
        + 10 * Math.min(metrics.profitFactor, 3)
        + 200 * Math.max(-0.05, Math.min(0.10, metrics.expectancy))
        + 60 * Math.min(Math.abs(features.ret24), 0.25)
        + 30 * Math.min(features.atrPct, 0.08)
        + 2 * Math.min(features.volumeRatio, 3)
        + (symbol === "PENGUUSDT" ? 3 : 0);
    return { selection, candidate: { id: `HIGH_VOL:${symbol}:${features.signalTs}`, symbol, side, score } };
}

function trailingCorrelation(left: readonly Quality102Candle[], right: readonly Quality102Candle[], cutoffTs: number): number {
    const rightByTs = new Map(right.map((row, index) => [row.timestampMs, index > 0 ? row.close / right[index - 1].close - 1 : undefined]));
    const pairs: Array<[number, number]> = [];
    for (let index = 1; index < left.length; index += 1) {
        if (left[index].timestampMs > cutoffTs) break;
        const other = rightByTs.get(left[index].timestampMs);
        if (other !== undefined) pairs.push([left[index].close / left[index - 1].close - 1, other]);
    }
    const tail = pairs.slice(-CORRELATION_HOURS);
    if (tail.length < MINIMUM_CORRELATION_HOURS) return 0;
    const leftMean = tail.reduce((sum, pair) => sum + pair[0], 0) / tail.length;
    const rightMean = tail.reduce((sum, pair) => sum + pair[1], 0) / tail.length;
    let covariance = 0;
    let leftVariance = 0;
    let rightVariance = 0;
    for (const [leftValue, rightValue] of tail) {
        covariance += (leftValue - leftMean) * (rightValue - rightMean);
        leftVariance += (leftValue - leftMean) ** 2;
        rightVariance += (rightValue - rightMean) ** 2;
    }
    const denominator = Math.sqrt(leftVariance * rightVariance);
    return denominator > 0 ? covariance / denominator : 0;
}

function activePenguSide(rows: readonly Quality102Candle[], rule: Quality102HighVolRule, dataCutoffTs: number): Quality102Side | undefined {
    const monthStartTs = monthStartUtc(dataCutoffTs);
    const firstIndex = Math.max(FEATURE_WARMUP_HOURS, Math.ceil((monthStartTs - rows[0].timestampMs) / QUALITY102_HOUR_MS));
    let signalIndex = firstIndex;
    while (signalIndex < rows.length) {
        const side = matchedSide(computeQuality102HighVolFeatures(rows, signalIndex), rule);
        if (side === undefined) {
            signalIndex += 1;
            continue;
        }
        const entryIndex = signalIndex + 1;
        if (entryIndex >= rows.length) return side;
        const entryPrice = rows[entryIndex].open;
        const stopPrice = side === 1 ? entryPrice * (1 - rule.hardStop) : entryPrice * (1 + rule.hardStop);
        const lastObservedIndex = Math.min(rows.length - 1, entryIndex + MAXIMUM_HOLD_HOURS - 1);
        let stopIndex: number | undefined;
        for (let index = entryIndex; index <= lastObservedIndex; index += 1) {
            if ((side === 1 && rows[index].low <= stopPrice) || (side === -1 && rows[index].high >= stopPrice)) {
                stopIndex = index;
                break;
            }
        }
        if (stopIndex !== undefined) {
            signalIndex = stopIndex + 1;
            continue;
        }
        if (lastObservedIndex < entryIndex + MAXIMUM_HOLD_HOURS - 1) return side;
        signalIndex = lastObservedIndex + 1;
    }
    return undefined;
}

export function buildQuality102CausalV1Signal(input: Quality102CausalV1SignalInput): Quality102CausalV1Signal {
    if (!finite(input.decisionTs) || input.decisionTs <= 0) throw new Error("QUALITY102_INVALID_DECISION_TIMESTAMP");
    if (typeof input.sleeveOccupancy?.activePosition !== "boolean"
        || typeof input.sleeveOccupancy.unresolvedPendingEntry !== "boolean") {
        throw new Error("QUALITY102_INVALID_SLEEVE_OCCUPANCY");
    }
    const entries = Object.entries(input.history.candlesBySymbol).sort(([left], [right]) => left.localeCompare(right));
    if (!entries.length) throw new Error("QUALITY102_EMPTY_SYMBOL_UNIVERSE");
    for (const [symbol, rows] of entries) {
        if (!symbol.trim()) throw new Error("QUALITY102_SYMBOL_REQUIRED");
        assertClosedCausalHistory(rows, input.decisionTs);
    }
    const dataCutoffTs = Math.min(...entries.map(([, rows]) => rows.at(-1)!.timestampMs));
    if (input.sleeveOccupancy.activePosition || input.sleeveOccupancy.unresolvedPendingEntry) {
        return {
            strategyId: "QUALITY102_CAUSAL_V1",
            referenceTs: dataCutoffTs,
            side: 0,
            requestedGross: 0,
            reason: "QUALITY102_CAUSAL_V1_SLOT_OCCUPIED",
            dataCutoffTs,
            brkEnabled: false,
        };
    }
    const normalized = entries.map(([symbol, rows]) => [symbol.trim().toUpperCase(), rows.filter((row) => row.timestampMs <= dataCutoffTs)] as const);
    const generated = normalized.filter(([symbol]) => symbol !== "BTCUSDT").map(([symbol, rows]) => ({ symbol, rows, ...candidateFor(symbol, rows, dataCutoffTs) }));
    const penguState = generated.find((item) => item.symbol === "PENGUUSDT");
    const penguRows = penguState?.rows;
    const activePengu = penguRows && penguState.selection ? activePenguSide(penguRows, penguState.selection.rule, dataCutoffTs) : undefined;
    const candidates = generated.flatMap((item) => item.candidate ? [{ ...item.candidate, rows: item.rows }] : [])
        .filter((item) => activePengu === undefined || item.symbol === "PENGUUSDT" || item.side !== activePengu || !penguRows
            || Math.abs(trailingCorrelation(item.rows, penguRows, dataCutoffTs)) < 0.80)
        .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol) || left.id.localeCompare(right.id));
    const routed = routeQuality102OneSlot(candidates.map((candidate) => ({
        id: candidate.id,
        entryTs: input.decisionTs,
        exitTs: input.decisionTs + (MAXIMUM_HOLD_HOURS - 1) * QUALITY102_HOUR_MS,
        layer: "S1",
    })));
    const selected = candidates.find((candidate) => candidate.id === routed.accepted[0]?.id);
    return {
        strategyId: "QUALITY102_CAUSAL_V1",
        referenceTs: dataCutoffTs,
        side: selected?.side ?? 0,
        symbol: selected?.symbol,
        family: selected ? "HIGH_VOL" : undefined,
        requestedGross: selected ? QUALITY102_CAUSAL_V1.maximumGross : 0,
        reason: selected ? "QUALITY102_CAUSAL_V1_HIGH_VOL_SIGNAL" : "QUALITY102_CAUSAL_V1_NO_SOURCE_COMPLETE_SIGNAL",
        dataCutoffTs,
        brkEnabled: false,
    };
}
