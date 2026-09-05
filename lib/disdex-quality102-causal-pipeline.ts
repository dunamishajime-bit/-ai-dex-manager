import {
    evaluateQuality102CausalV4ImprovementGate,
    evaluateS34QualityGate,
    routeQuality102OneSlot,
    type Quality102Layer,
    type Quality102OneSlotCandidate,
    type Quality102S34Family,
} from "./disdex-quality102-causal-selector";

export const QUALITY102_HOUR_MS = 3_600_000;
export const QUALITY102_DAY_MS = 24 * QUALITY102_HOUR_MS;
export const QUALITY102_HIGH_VOL_MAX_HOLD_HOURS = 72;
export const QUALITY102_HIGH_VOL_TRAIL_TRIGGER = 0.12;
export const QUALITY102_HIGH_VOL_TRAIL_DISTANCE = 0.05;

export const QUALITY102_HIGH_VOL_GRID = Object.freeze({
    longDrops: Object.freeze([0.08, 0.10, 0.12, 0.15]),
    longRsis: Object.freeze([30, 35, 40]),
    shortRallies: Object.freeze([0.05, 0.08, 0.10, 0.12]),
    shortRsis: Object.freeze([55, 60, 65]),
    hardStops: Object.freeze([0.10, 0.15]),
});

export const QUALITY102_EXPECTED_COUNTS = Object.freeze({
    raw: 151,
    highVolRaw: 30,
    s34Raw: 121,
    s34Rejected: 27,
    quality124: 124,
    oneSlotBlocked: 22,
    quality102: 102,
    layers: Object.freeze({ S1: 8, S2: 10, S3: 69, S4: 15 }),
    families: Object.freeze({ HIGH_VOL: 18, PB: 10, MR: 22, BRK: 28, REV: 24 }),
    exitReasons: Object.freeze({ time: 77, "72h_time": 13, stop: 7, trail_5pct_after_12pct: 5 }),
});

export const QUALITY102_HIGH_VOL_STAGE_SUBSET_SIZE = 30;

export const QUALITY102_RESEARCH_COSTS = Object.freeze({
    normal: Object.freeze({ perSide: 0.0006, fundingPerDay: 0.0002 }),
    stress: Object.freeze({ perSide: 0.0010, fundingPerDay: 0.0005 }),
});

export type Quality102Side = -1 | 1;
export type Quality102HighVolStage = "S1" | "S2";
export type Quality102RawLayer = Quality102HighVolStage | "S34";
export type Quality102Family = "HIGH_VOL" | "PB" | "MR" | "BRK" | "REV";

export interface Quality102Candle {
    timestampMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    quoteVolume: number;
}

export interface Quality102HighVolFeatures {
    signalTs: number;
    ret24: number;
    ret14d: number;
    rsi14: number;
    atr14: number;
    atrPct: number;
    volumeRatio: number;
    barUp: boolean;
    barDown: boolean;
}

export interface Quality102HighVolRule {
    longDrop: number;
    longRsi: number;
    shortRally: number;
    shortRsi: number;
    hardStop: number;
}

export interface Quality102HighVolGridMatch {
    side: Quality102Side;
    threshold: number;
    rsi: number;
    hardStop: number;
}

export interface Quality102HighVolMonthlyRuleStats {
    rule: Quality102HighVolRule;
    trades: number;
    wins: number;
    totalReturn: number;
    profitFactor: number;
    expectancy: number;
    maxDrawdown: number;
    trainingStartTs: number;
    trainingEndTs: number;
    availableAtTs: number;
}

export interface Quality102ScoredHighVolRuleStats extends Quality102HighVolMonthlyRuleStats {
    winRate: number;
    score: number;
    ruleKey: string;
}

export interface Quality102MonthlyRuleSelection {
    selected?: Quality102ScoredHighVolRuleStats;
    eligible: Quality102ScoredHighVolRuleStats[];
    ineligible: Quality102HighVolMonthlyRuleStats[];
}

export interface Quality102HighVolExit {
    exitTs: number;
    exitPrice: number;
    grossReturn: number;
    holdHours: number;
    exitReason: "hard_stop" | "trail_5pct_after_12pct" | "72h_time";
}

export interface Quality102HighVolExitInput {
    side: Quality102Side;
    entryPrice: number;
    hardStop: number;
    /** Bars begin at the next-hour entry bar and must be contiguous 1H candles. */
    bars: readonly Quality102Candle[];
}

export interface Quality102HighVolSignalCandidate {
    id: string;
    symbol: string;
    stage: Quality102HighVolStage;
    signalTs: number;
    entryTs: number;
    entryPrice: number;
    side: Quality102Side;
    rule: Quality102HighVolRule;
    features: Quality102HighVolFeatures;
}

export interface Quality102HighVolSignalInput {
    symbol: string;
    stage: Quality102HighVolStage;
    bars: readonly Quality102Candle[];
    monthlyRules: ReadonlyMap<number, Quality102HighVolRule>;
}

export interface Quality102RawCandidate {
    id: string;
    entryTs: number;
    exitTs: number;
    symbol: string;
    layer: Quality102RawLayer;
    family: Quality102Family | Quality102S34Family;
    variant: string;
    side: number;
    grossReturn: number;
    holdHours: number;
    exitReason: string;
    normalNet: number;
    stressNet: number;
    /** Required for S34; omitted for HIGH_VOL rows. */
    ret14?: number;
    /** Required for S34, including BRK. Never synthesized by this module. */
    strength?: number;
}

export interface Quality102SelectedCandidate extends Omit<Quality102RawCandidate, "layer">, Quality102OneSlotCandidate {
    layer: Quality102Layer;
}

export interface Quality102S34Identity {
    entryTs: number;
    symbol: string;
    variant: string;
    side: number;
}

export interface Quality102RejectedS34Candidate {
    candidate: Quality102RawCandidate;
    reason:
        | ReturnType<typeof evaluateS34QualityGate>["reason"]
        | ReturnType<typeof evaluateQuality102CausalV4ImprovementGate>["reason"];
}

export interface Quality102SelectionInput {
    rawHighVol: readonly Quality102RawCandidate[];
    rawS34: readonly Quality102RawCandidate[];
    /** Membership supplied by the upstream raw producer; row order is not evidence. */
    coreIdentities: readonly Quality102S34Identity[];
    fillerIdentities: readonly Quality102S34Identity[];
    /** Apply the forward-causal V4 REV-long loss gate after recovered historical quality gates. */
    applyV4ImprovementGate?: boolean;
}

export interface Quality102SelectionStats {
    raw: number;
    highVolRaw: number;
    s34Raw: number;
    s34Rejected: number;
    quality124: number;
    oneSlotBlocked: number;
    quality102: number;
    layers: Record<Quality102Layer, number>;
    families: Record<Quality102Family, number>;
    exitReasons: Record<string, number>;
}

export interface Quality102SelectionResult {
    quality124: Quality102SelectedCandidate[];
    quality102: Quality102SelectedCandidate[];
    oneSlotBlocked: Array<Quality102SelectedCandidate & { blockedReason: "ONE_SLOT_OCCUPIED" | "INVALID_CANDIDATE" }>;
    rejectedS34: Quality102RejectedS34Candidate[];
    stats: Quality102SelectionStats;
}

export interface Quality102ParityResult {
    allPass: boolean;
    checks: {
        raw: boolean;
        highVolRaw: boolean;
        s34Raw: boolean;
        s34Rejected: boolean;
        quality124: boolean;
        oneSlotBlocked: boolean;
        quality102: boolean;
        layers: boolean;
        families: boolean;
        exitReasons: boolean;
    };
    observed: Quality102SelectionStats;
}

export interface Quality102HighVolStageSubsetRow {
    id: string;
    [key: string]: unknown;
}

export interface Quality102HighVolStageSubsetInput<T extends Quality102HighVolStageSubsetRow> {
    expanded: readonly T[];
    stage1Ids: readonly string[];
    stage2Ids: readonly string[];
    expectedTotal?: number;
}

export interface Quality102HighVolStageSubset<T extends Quality102HighVolStageSubsetRow> {
    stage1: T[];
    stage2: T[];
}

function finite(value: number, label: string): number {
    if (!Number.isFinite(value)) throw new Error(`QUALITY102_NONFINITE:${label}`);
    return value;
}

function positive(value: number, label: string): number {
    finite(value, label);
    if (value <= 0) throw new Error(`QUALITY102_NONPOSITIVE:${label}`);
    return value;
}

function assertSide(value: number): asserts value is Quality102Side {
    if (value !== -1 && value !== 1) throw new Error("QUALITY102_INVALID_SIDE");
}

function assertCandle(bar: Quality102Candle, index: number): void {
    finite(bar.timestampMs, `candle[${index}].timestampMs`);
    positive(bar.open, `candle[${index}].open`);
    positive(bar.high, `candle[${index}].high`);
    positive(bar.low, `candle[${index}].low`);
    positive(bar.close, `candle[${index}].close`);
    finite(bar.quoteVolume, `candle[${index}].quoteVolume`);
    if (bar.quoteVolume < 0) throw new Error(`QUALITY102_NEGATIVE_VOLUME:${index}`);
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) {
        throw new Error(`QUALITY102_INVALID_OHLC:${index}`);
    }
}

function assertContiguousHourly(bars: readonly Quality102Candle[], start: number, end: number): void {
    for (let index = start; index <= end; index += 1) {
        const bar = bars[index];
        if (!bar) throw new Error(`QUALITY102_MISSING_CANDLE:${index}`);
        assertCandle(bar, index);
        if (index > start && bar.timestampMs - bars[index - 1].timestampMs !== QUALITY102_HOUR_MS) {
            throw new Error(`QUALITY102_NONCONTIGUOUS_1H:${index}`);
        }
    }
}

function wilderRma(values: readonly number[], period: number): number {
    if (values.length < period) throw new Error("QUALITY102_INSUFFICIENT_RMA_INPUT");
    let average = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    for (const value of values.slice(period)) average = (average * (period - 1) + value) / period;
    return average;
}

function wilderRsi(closes: readonly number[], period = 14): number {
    if (closes.length < period + 1) throw new Error("QUALITY102_INSUFFICIENT_RSI_INPUT");
    const gains: number[] = [];
    const losses: number[] = [];
    for (let index = 1; index < closes.length; index += 1) {
        const change = closes[index] - closes[index - 1];
        gains.push(Math.max(change, 0));
        losses.push(Math.max(-change, 0));
    }
    const averageGain = wilderRma(gains, period);
    const averageLoss = wilderRma(losses, period);
    if (averageLoss === 0) return averageGain > 0 ? 100 : 50;
    const relativeStrength = averageGain / averageLoss;
    return 100 - 100 / (1 + relativeStrength);
}

function wilderAtr(bars: readonly Quality102Candle[], period = 14): number {
    if (bars.length < period + 1) throw new Error("QUALITY102_INSUFFICIENT_ATR_INPUT");
    const trueRanges: number[] = [];
    for (let index = 1; index < bars.length; index += 1) {
        const previous = bars[index - 1];
        const current = bars[index];
        trueRanges.push(Math.max(
            current.high - current.low,
            Math.abs(current.high - previous.close),
            Math.abs(current.low - previous.close),
        ));
    }
    return wilderRma(trueRanges, period);
}

function median(values: readonly number[]): number {
    if (!values.length) throw new Error("QUALITY102_EMPTY_MEDIAN");
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function monthStartUtc(timestampMs: number): number {
    finite(timestampMs, "month.timestampMs");
    const date = new Date(timestampMs);
    if (Number.isNaN(date.getTime())) throw new Error("QUALITY102_INVALID_TIMESTAMP");
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

/** Calculate features from the completed signal candle and its causal prefix only. */
export function computeQuality102HighVolFeatures(
    bars: readonly Quality102Candle[],
    signalIndex: number,
): Quality102HighVolFeatures {
    if (!Number.isInteger(signalIndex) || signalIndex < 336 || signalIndex >= bars.length) {
        throw new Error("QUALITY102_SIGNAL_INDEX_REQUIRES_337_COMPLETED_BARS");
    }
    const start = signalIndex - 336;
    assertContiguousHourly(bars, start, signalIndex);
    const current = bars[signalIndex];
    const ret24 = current.close / bars[signalIndex - 24].close - 1;
    const ret14d = current.close / bars[signalIndex - 336].close - 1;
    const causalBars = bars.slice(start, signalIndex + 1);
    const atr14 = wilderAtr(causalBars, 14);
    const volumeRatioDenominator = median(bars.slice(signalIndex - 23, signalIndex + 1).map((bar) => bar.quoteVolume));
    const volumeRatio = volumeRatioDenominator > 0
        ? current.quoteVolume / volumeRatioDenominator
        : current.quoteVolume > 0 ? Number.POSITIVE_INFINITY : 1;
    return {
        signalTs: current.timestampMs,
        ret24,
        ret14d,
        rsi14: wilderRsi(causalBars.map((bar) => bar.close), 14),
        atr14,
        atrPct: atr14 / current.close,
        volumeRatio,
        barUp: current.close > current.open,
        barDown: current.close < current.open,
    };
}

export function quality102HighVolMarketValid(features: Quality102HighVolFeatures): boolean {
    return Number.isFinite(features.ret14d) && features.atrPct >= 0.01 && features.volumeRatio >= 0.50;
}

/** Return every raw-grid threshold matched by a completed candle. */
export function matchQuality102HighVolGrid(features: Quality102HighVolFeatures): Quality102HighVolGridMatch[] {
    if (!quality102HighVolMarketValid(features)) return [];
    const matches: Quality102HighVolGridMatch[] = [];
    if (features.ret14d >= 0 && features.barUp) {
        for (const threshold of QUALITY102_HIGH_VOL_GRID.longDrops) {
            for (const rsi of QUALITY102_HIGH_VOL_GRID.longRsis) {
                if (features.ret24 <= -threshold && features.rsi14 <= rsi) {
                    for (const hardStop of QUALITY102_HIGH_VOL_GRID.hardStops) matches.push({ side: 1, threshold, rsi, hardStop });
                }
            }
        }
    } else if (features.ret14d < 0 && features.barDown) {
        for (const threshold of QUALITY102_HIGH_VOL_GRID.shortRallies) {
            for (const rsi of QUALITY102_HIGH_VOL_GRID.shortRsis) {
                if (features.ret24 >= threshold && features.rsi14 >= rsi) {
                    for (const hardStop of QUALITY102_HIGH_VOL_GRID.hardStops) matches.push({ side: -1, threshold, rsi, hardStop });
                }
            }
        }
    }
    return matches;
}

function isGridValue(values: readonly number[], value: number): boolean {
    return values.some((allowed) => allowed === value);
}

function assertHighVolRule(rule: Quality102HighVolRule): void {
    finite(rule.longDrop, "rule.longDrop");
    finite(rule.longRsi, "rule.longRsi");
    finite(rule.shortRally, "rule.shortRally");
    finite(rule.shortRsi, "rule.shortRsi");
    finite(rule.hardStop, "rule.hardStop");
    if (!isGridValue(QUALITY102_HIGH_VOL_GRID.longDrops, rule.longDrop)
        || !isGridValue(QUALITY102_HIGH_VOL_GRID.longRsis, rule.longRsi)
        || !isGridValue(QUALITY102_HIGH_VOL_GRID.shortRallies, rule.shortRally)
        || !isGridValue(QUALITY102_HIGH_VOL_GRID.shortRsis, rule.shortRsi)
        || !isGridValue(QUALITY102_HIGH_VOL_GRID.hardStops, rule.hardStop)) {
        throw new Error("QUALITY102_HIGH_VOL_RULE_OUTSIDE_GRID");
    }
}

export function quality102HighVolRuleKey(rule: Quality102HighVolRule): string {
    assertHighVolRule(rule);
    return JSON.stringify({
        long_drop: rule.longDrop,
        long_rsi: rule.longRsi,
        short_rally: rule.shortRally,
        short_rsi: rule.shortRsi,
        hard_stop: rule.hardStop,
    });
}

function selectedRuleSide(features: Quality102HighVolFeatures, rule: Quality102HighVolRule): Quality102Side | undefined {
    assertHighVolRule(rule);
    if (!quality102HighVolMarketValid(features)) return undefined;
    if (features.ret14d >= 0 && features.ret24 <= -rule.longDrop && features.rsi14 <= rule.longRsi && features.barUp) return 1;
    if (features.ret14d < 0 && features.ret24 >= rule.shortRally && features.rsi14 >= rule.shortRsi && features.barDown) return -1;
    return undefined;
}

/** Select the top eligible rule using only the exact preceding 180d window. */
export function selectQuality102HighVolMonthlyRule(input: {
    monthStartTs: number;
    evaluations: readonly Quality102HighVolMonthlyRuleStats[];
}): Quality102MonthlyRuleSelection {
    const monthStartTs = finite(input.monthStartTs, "monthStartTs");
    const monthStartDate = new Date(monthStartTs);
    if (monthStartTs <= 0
        || monthStartTs % QUALITY102_HOUR_MS !== 0
        || monthStartDate.getUTCDate() !== 1
        || monthStartDate.getUTCHours() !== 0
        || monthStartDate.getUTCMinutes() !== 0
        || monthStartDate.getUTCSeconds() !== 0
        || monthStartDate.getUTCMilliseconds() !== 0) {
        throw new Error("QUALITY102_INVALID_MONTH_START");
    }
    const expectedTrainingStart = monthStartTs - 180 * QUALITY102_DAY_MS;
    const expectedTrainingEnd = monthStartTs - QUALITY102_HOUR_MS;
    const eligible: Quality102ScoredHighVolRuleStats[] = [];
    const ineligible: Quality102HighVolMonthlyRuleStats[] = [];

    for (const evaluation of input.evaluations) {
        let valid = true;
        try {
            assertHighVolRule(evaluation.rule);
            valid = Number.isInteger(evaluation.trades)
                && evaluation.trades >= 5
                && Number.isInteger(evaluation.wins)
                && evaluation.wins >= 0
                && evaluation.wins <= evaluation.trades
                && Number.isFinite(evaluation.totalReturn)
                && evaluation.totalReturn > 0
                && !Number.isNaN(evaluation.profitFactor)
                && evaluation.profitFactor >= 1.15
                && Number.isFinite(evaluation.expectancy)
                && evaluation.expectancy > 0
                && Number.isFinite(evaluation.maxDrawdown)
                && evaluation.trainingStartTs === expectedTrainingStart
                && evaluation.trainingEndTs === expectedTrainingEnd
                && Number.isFinite(evaluation.availableAtTs)
                && evaluation.availableAtTs > 0
                && evaluation.availableAtTs <= monthStartTs
                && evaluation.availableAtTs <= expectedTrainingEnd;
            if (!valid) throw new Error("ineligible");
        } catch {
            ineligible.push(evaluation);
            continue;
        }
        const winRate = evaluation.wins / evaluation.trades;
        if (winRate < 0.52) {
            ineligible.push(evaluation);
            continue;
        }
        const score = wilsonLowerBound(evaluation.wins, evaluation.trades, 1)
            + Math.min(evaluation.profitFactor, 3) * 0.03
            + evaluation.expectancy * 2
            - Math.max(0, -evaluation.maxDrawdown - 0.25);
        eligible.push({ ...evaluation, winRate, score, ruleKey: quality102HighVolRuleKey(evaluation.rule) });
    }

    eligible.sort((left, right) => right.score - left.score || left.ruleKey.localeCompare(right.ruleKey));
    return { selected: eligible[0], eligible, ineligible };
}

export function wilsonLowerBound(wins: number, trades: number, z = 1): number {
    if (!Number.isInteger(wins) || !Number.isInteger(trades) || trades <= 0 || wins < 0 || wins > trades || !(z > 0 && Number.isFinite(z))) {
        throw new Error("QUALITY102_INVALID_WILSON_INPUT");
    }
    const p = wins / trades;
    const zSquared = z * z;
    const denominator = 1 + zSquared / trades;
    const center = p + zSquared / (2 * trades);
    const adjustment = z * Math.sqrt((p * (1 - p)) / trades + zSquared / (4 * trades * trades));
    return (center - adjustment) / denominator;
}

/** Generate raw HIGH_VOL entries from completed bars and a preselected monthly rule map. */
export function generateQuality102HighVolSignals(input: Quality102HighVolSignalInput): Quality102HighVolSignalCandidate[] {
    if (typeof input.symbol !== "string" || input.symbol.trim().length === 0) throw new Error("QUALITY102_SYMBOL_REQUIRED");
    const bars = input.bars;
    if (bars.length < 338) return [];
    const signals: Quality102HighVolSignalCandidate[] = [];
    for (let signalIndex = 336; signalIndex + 1 < bars.length; signalIndex += 1) {
        const features = computeQuality102HighVolFeatures(bars, signalIndex);
        const monthlyRule = input.monthlyRules.get(monthStartUtc(features.signalTs));
        if (!monthlyRule) continue;
        const side = selectedRuleSide(features, monthlyRule);
        if (side === undefined) continue;
        assertContiguousHourly(bars, signalIndex, signalIndex + 1);
        const entryBar = bars[signalIndex + 1];
        const ruleKey = quality102HighVolRuleKey(monthlyRule);
        signals.push({
            id: `HIGH_VOL:${input.stage}:${input.symbol}:${features.signalTs}:${ruleKey}`,
            symbol: input.symbol,
            stage: input.stage,
            signalTs: features.signalTs,
            entryTs: entryBar.timestampMs,
            entryPrice: positive(entryBar.open, "entry.open"),
            side,
            rule: monthlyRule,
            features,
        });
    }
    return signals;
}

/** Recover the stage subset only when the upstream source supplies explicit membership. */
export function selectQuality102HighVolStageSubset<T extends Quality102HighVolStageSubsetRow>(
    input: Quality102HighVolStageSubsetInput<T>,
): Quality102HighVolStageSubset<T> {
    const expandedIds = new Set<string>();
    for (const row of input.expanded) {
        if (typeof row.id !== "string" || row.id.length === 0 || expandedIds.has(row.id)) throw new Error("QUALITY102_HIGH_VOL_DUPLICATE_EXPANDED_ID");
        expandedIds.add(row.id);
    }
    const stage1 = new Set(input.stage1Ids);
    const stage2 = new Set(input.stage2Ids);
    if (stage1.size !== input.stage1Ids.length || stage2.size !== input.stage2Ids.length) throw new Error("QUALITY102_HIGH_VOL_DUPLICATE_STAGE_ID");
    if ([...stage1].some((id) => stage2.has(id))) throw new Error("QUALITY102_HIGH_VOL_STAGE_OVERLAP");
    for (const id of [...stage1, ...stage2]) {
        if (!expandedIds.has(id)) throw new Error("QUALITY102_HIGH_VOL_STAGE_ID_NOT_IN_EXPANDED");
    }
    const selectedTotal = stage1.size + stage2.size;
    if (input.expectedTotal !== undefined) {
        if (!Number.isInteger(input.expectedTotal) || input.expectedTotal < 0) throw new Error("QUALITY102_INVALID_STAGE_SUBSET_SIZE");
        if (selectedTotal !== input.expectedTotal) throw new Error("HIGH_VOL_STAGE_SUBSET_INCOMPLETE");
    }
    return {
        stage1: input.expanded.filter((row) => stage1.has(row.id)),
        stage2: input.expanded.filter((row) => stage2.has(row.id)),
    };
}

export function selectQuality102HighVolThirtySubset<T extends Quality102HighVolStageSubsetRow>(
    input: Omit<Quality102HighVolStageSubsetInput<T>, "expectedTotal">,
): Quality102HighVolStageSubset<T> {
    return selectQuality102HighVolStageSubset({ ...input, expectedTotal: QUALITY102_HIGH_VOL_STAGE_SUBSET_SIZE });
}

export function simulateQuality102HighVolExit(input: Quality102HighVolExitInput): Quality102HighVolExit {
    assertSide(input.side);
    positive(input.entryPrice, "entryPrice");
    finite(input.hardStop, "hardStop");
    if (!isGridValue(QUALITY102_HIGH_VOL_GRID.hardStops, input.hardStop)) throw new Error("QUALITY102_HV_HARD_STOP_OUTSIDE_GRID");
    if (!input.bars.length) throw new Error("QUALITY102_HV_EXIT_BARS_EMPTY");
    assertContiguousHourly(input.bars, 0, Math.min(input.bars.length, QUALITY102_HIGH_VOL_MAX_HOLD_HOURS) - 1);

    let trailActive = false;
    let best = input.entryPrice;
    const stopPrice = input.side === 1
        ? input.entryPrice * (1 - input.hardStop)
        : input.entryPrice * (1 + input.hardStop);
    const limit = Math.min(input.bars.length, QUALITY102_HIGH_VOL_MAX_HOLD_HOURS);
    for (let index = 0; index < limit; index += 1) {
        const bar = input.bars[index];
        const holdHours = index + 1;
        if (input.side === 1 && bar.low <= stopPrice) {
            return { exitTs: bar.timestampMs, exitPrice: stopPrice, grossReturn: stopPrice / input.entryPrice - 1, holdHours, exitReason: "hard_stop" };
        }
        if (input.side === -1 && bar.high >= stopPrice) {
            return { exitTs: bar.timestampMs, exitPrice: stopPrice, grossReturn: 1 - stopPrice / input.entryPrice, holdHours, exitReason: "hard_stop" };
        }

        if (input.side === 1) {
            best = Math.max(best, bar.high);
            if (!trailActive && best / input.entryPrice - 1 >= QUALITY102_HIGH_VOL_TRAIL_TRIGGER - 1e-15) trailActive = true;
            if (trailActive) {
                const trailPrice = best * (1 - QUALITY102_HIGH_VOL_TRAIL_DISTANCE);
                if (bar.low <= trailPrice) {
                    return { exitTs: bar.timestampMs, exitPrice: trailPrice, grossReturn: trailPrice / input.entryPrice - 1, holdHours, exitReason: "trail_5pct_after_12pct" };
                }
            }
        } else {
            best = Math.min(best, bar.low);
            if (!trailActive && 1 - best / input.entryPrice >= QUALITY102_HIGH_VOL_TRAIL_TRIGGER - 1e-15) trailActive = true;
            if (trailActive) {
                const trailPrice = best * (1 + QUALITY102_HIGH_VOL_TRAIL_DISTANCE);
                if (bar.high >= trailPrice) {
                    return { exitTs: bar.timestampMs, exitPrice: trailPrice, grossReturn: 1 - trailPrice / input.entryPrice, holdHours, exitReason: "trail_5pct_after_12pct" };
                }
            }
        }

        if (holdHours === QUALITY102_HIGH_VOL_MAX_HOLD_HOURS) {
            const grossReturn = input.side === 1 ? bar.close / input.entryPrice - 1 : 1 - bar.close / input.entryPrice;
            return { exitTs: bar.timestampMs, exitPrice: bar.close, grossReturn, holdHours, exitReason: "72h_time" };
        }
    }
    throw new Error("QUALITY102_HV_EXIT_BARS_INSUFFICIENT_FOR_72H");
}

export function quality102NetFromGross(
    grossReturn: number,
    holdHours: number,
    perSide: number,
    fundingPerDay: number,
): number {
    finite(grossReturn, "grossReturn");
    finite(holdHours, "holdHours");
    finite(perSide, "perSide");
    finite(fundingPerDay, "fundingPerDay");
    if (holdHours < 0 || perSide < 0 || fundingPerDay < 0) throw new Error("QUALITY102_INVALID_COST_INPUT");
    return grossReturn - 2 * perSide - (holdHours / 24) * fundingPerDay;
}

export function materializeQuality102HighVolCandidate(
    signal: Quality102HighVolSignalCandidate,
    exit: Quality102HighVolExit,
): Quality102RawCandidate {
    if (signal.stage !== "S1" && signal.stage !== "S2") throw new Error("QUALITY102_INVALID_HV_STAGE");
    if (exit.exitTs < signal.entryTs) throw new Error("QUALITY102_EXIT_BEFORE_ENTRY");
    return {
        id: signal.id,
        entryTs: signal.entryTs,
        exitTs: exit.exitTs,
        symbol: signal.symbol,
        layer: signal.stage,
        family: "HIGH_VOL",
        variant: quality102HighVolRuleKey(signal.rule),
        side: signal.side,
        grossReturn: exit.grossReturn,
        holdHours: exit.holdHours,
        exitReason: exit.exitReason,
        normalNet: quality102NetFromGross(exit.grossReturn, exit.holdHours, QUALITY102_RESEARCH_COSTS.normal.perSide, QUALITY102_RESEARCH_COSTS.normal.fundingPerDay),
        stressNet: quality102NetFromGross(exit.grossReturn, exit.holdHours, QUALITY102_RESEARCH_COSTS.stress.perSide, QUALITY102_RESEARCH_COSTS.stress.fundingPerDay),
    };
}

function identityKey(identity: Quality102S34Identity): string {
    finite(identity.entryTs, "identity.entryTs");
    if (identity.entryTs <= 0) throw new Error("QUALITY102_IDENTITY_TIME_INVALID");
    if (typeof identity.symbol !== "string" || identity.symbol.trim().length === 0) throw new Error("QUALITY102_IDENTITY_SYMBOL_REQUIRED");
    if (typeof identity.variant !== "string" || identity.variant.trim().length === 0) throw new Error("QUALITY102_IDENTITY_VARIANT_REQUIRED");
    assertSide(identity.side);
    return JSON.stringify([identity.entryTs, identity.symbol, identity.variant, identity.side]);
}

function validateCandidate(candidate: Quality102RawCandidate, expectedLayer: Quality102RawLayer): void {
    if (candidate.layer !== expectedLayer) throw new Error("QUALITY102_RAW_LAYER_MISMATCH");
    if (typeof candidate.id !== "string" || candidate.id.length === 0) throw new Error("QUALITY102_CANDIDATE_ID_REQUIRED");
    if (typeof candidate.symbol !== "string" || candidate.symbol.trim().length === 0) throw new Error("QUALITY102_CANDIDATE_SYMBOL_REQUIRED");
    if (typeof candidate.variant !== "string" || candidate.variant.trim().length === 0) throw new Error("QUALITY102_CANDIDATE_VARIANT_REQUIRED");
    finite(candidate.entryTs, "candidate.entryTs");
    finite(candidate.exitTs, "candidate.exitTs");
    if (candidate.entryTs <= 0 || candidate.exitTs < candidate.entryTs) throw new Error("QUALITY102_CANDIDATE_TIME_INVALID");
    assertSide(candidate.side);
    finite(candidate.grossReturn, "candidate.grossReturn");
    finite(candidate.holdHours, "candidate.holdHours");
    finite(candidate.normalNet, "candidate.normalNet");
    finite(candidate.stressNet, "candidate.stressNet");
    if (candidate.holdHours < 0) throw new Error("QUALITY102_CANDIDATE_HOLD_INVALID");
    if (expectedLayer === "S1" || expectedLayer === "S2") {
        if (candidate.family !== "HIGH_VOL") throw new Error("QUALITY102_HV_FAMILY_REQUIRED");
    } else {
        if (candidate.family === "HIGH_VOL") throw new Error("QUALITY102_S34_FAMILY_REQUIRED");
        finite(candidate.ret14 ?? Number.NaN, "candidate.ret14");
        finite(candidate.strength ?? Number.NaN, "candidate.strength");
    }
}

function classifyS34Layer(
    candidate: Quality102RawCandidate,
    coreIdentities: ReadonlySet<string>,
    fillerIdentities: ReadonlySet<string>,
): "S3" | "S4" {
    const identity = identityKey({ entryTs: candidate.entryTs, symbol: candidate.symbol, variant: candidate.variant, side: candidate.side });
    const inCore = coreIdentities.has(identity);
    const inFiller = fillerIdentities.has(identity);
    if (inCore && inFiller) throw new Error("QUALITY102_S34_LAYER_IDENTITY_AMBIGUOUS");
    if (inCore) return "S3";
    if (inFiller) return "S4";
    throw new Error("QUALITY102_S34_LAYER_IDENTITY_MISSING");
}

function asSelected(candidate: Quality102RawCandidate, layer: Quality102Layer): Quality102SelectedCandidate {
    return { ...candidate, layer } as Quality102SelectedCandidate;
}

function countLayers(candidates: readonly Quality102SelectedCandidate[]): Record<Quality102Layer, number> {
    const counts: Record<Quality102Layer, number> = { S1: 0, S2: 0, S3: 0, S4: 0 };
    for (const candidate of candidates) counts[candidate.layer] += 1;
    return counts;
}

function countFamilies(candidates: readonly Quality102SelectedCandidate[]): Record<Quality102Family, number> {
    const counts: Record<Quality102Family, number> = { HIGH_VOL: 0, PB: 0, MR: 0, BRK: 0, REV: 0 };
    for (const candidate of candidates) {
        if (!(candidate.family in counts)) throw new Error("QUALITY102_UNKNOWN_SELECTED_FAMILY");
        counts[candidate.family as Quality102Family] += 1;
    }
    return counts;
}

function countExitReasons(candidates: readonly Quality102SelectedCandidate[]): Record<string, number> {
    const counts: Record<string, number> = {
        time: 0,
        "72h_time": 0,
        stop: 0,
        trail_5pct_after_12pct: 0,
    };
    for (const candidate of candidates) {
        if (!(candidate.exitReason in counts)) counts[candidate.exitReason] = 0;
        counts[candidate.exitReason] += 1;
    }
    return counts;
}

/** Apply recovered Quality Gates and deterministic one-slot routing to raw candidates. */
export function buildQuality102Selection(input: Quality102SelectionInput): Quality102SelectionResult {
    const allCandidates = [...input.rawHighVol, ...input.rawS34];
    const ids = new Set<string>();
    for (const candidate of allCandidates) {
        if (ids.has(candidate.id)) throw new Error("QUALITY102_DUPLICATE_CANDIDATE_ID");
        ids.add(candidate.id);
    }
    for (const candidate of input.rawHighVol) validateCandidate(candidate, candidate.layer === "S1" || candidate.layer === "S2" ? candidate.layer : "S1");
    for (const candidate of input.rawS34) validateCandidate(candidate, "S34");

    const coreIdentities = new Set<string>();
    for (const identity of input.coreIdentities) {
        const key = identityKey(identity);
        if (coreIdentities.has(key)) throw new Error("QUALITY102_DUPLICATE_CORE_IDENTITY");
        coreIdentities.add(key);
    }
    const fillerIdentities = new Set<string>();
    for (const identity of input.fillerIdentities) {
        const key = identityKey(identity);
        if (fillerIdentities.has(key)) throw new Error("QUALITY102_DUPLICATE_FILLER_IDENTITY");
        if (coreIdentities.has(key)) throw new Error("QUALITY102_S34_LAYER_IDENTITY_AMBIGUOUS");
        fillerIdentities.add(key);
    }
    const stableIdentities = new Set<string>();
    for (const candidate of allCandidates) {
        const key = identityKey({
            entryTs: candidate.entryTs,
            symbol: candidate.symbol,
            variant: candidate.variant,
            side: candidate.side,
        });
        if (stableIdentities.has(key)) throw new Error("QUALITY102_DUPLICATE_STABLE_IDENTITY");
        stableIdentities.add(key);
    }

    const quality124: Quality102SelectedCandidate[] = input.rawHighVol.map((candidate) => asSelected(candidate, candidate.layer as Quality102HighVolStage));
    const rejectedS34: Quality102RejectedS34Candidate[] = [];
    for (const candidate of input.rawS34) {
        const gate = evaluateS34QualityGate({
            family: candidate.family,
            variant: candidate.variant,
            side: candidate.side,
            strength: candidate.strength as number,
            ret14: candidate.ret14 as number,
        });
        if (!gate.accepted) {
            rejectedS34.push({ candidate, reason: gate.reason });
            continue;
        }
        if (input.applyV4ImprovementGate) {
            const v4Gate = evaluateQuality102CausalV4ImprovementGate({
                family: candidate.family,
                side: candidate.side,
                ret14: candidate.ret14 as number,
            });
            if (!v4Gate.accepted) {
                rejectedS34.push({ candidate, reason: v4Gate.reason });
                continue;
            }
        }
        quality124.push(asSelected(candidate, classifyS34Layer(candidate, coreIdentities, fillerIdentities)));
    }

    const byId = new Map(quality124.map((candidate) => [candidate.id, candidate]));
    const routed = routeQuality102OneSlot(quality124.map(({ id, entryTs, exitTs, layer }) => ({ id, entryTs, exitTs, layer })));
    const quality102 = routed.accepted.map((candidate) => {
        const full = byId.get(candidate.id);
        if (!full) throw new Error("QUALITY102_ROUTER_ID_NOT_FOUND");
        return full;
    });
    const oneSlotBlocked = routed.blocked.map((candidate) => {
        const full = byId.get(candidate.id);
        if (!full) throw new Error("QUALITY102_ROUTER_BLOCKED_ID_NOT_FOUND");
        return { ...full, blockedReason: candidate.blockedReason };
    });
    return {
        quality124,
        quality102,
        oneSlotBlocked,
        rejectedS34,
        stats: {
            raw: allCandidates.length,
            highVolRaw: input.rawHighVol.length,
            s34Raw: input.rawS34.length,
            s34Rejected: rejectedS34.length,
            quality124: quality124.length,
            oneSlotBlocked: oneSlotBlocked.length,
            quality102: quality102.length,
            layers: countLayers(quality102),
            families: countFamilies(quality102),
            exitReasons: countExitReasons(quality102),
        },
    };
}

/** Build the causal V4 selection with the validated REV-long ret14 improvement gate enabled. */
export function buildQuality102CausalV4Selection(input: Quality102SelectionInput): Quality102SelectionResult {
    return buildQuality102Selection({ ...input, applyV4ImprovementGate: true });
}

export function evaluateQuality102Parity(
    result: Quality102SelectionResult,
    expected = QUALITY102_EXPECTED_COUNTS,
): Quality102ParityResult {
    const checks = {
        raw: result.stats.raw === expected.raw,
        highVolRaw: result.stats.highVolRaw === expected.highVolRaw,
        s34Raw: result.stats.s34Raw === expected.s34Raw,
        s34Rejected: result.stats.s34Rejected === expected.s34Rejected,
        quality124: result.stats.quality124 === expected.quality124,
        oneSlotBlocked: result.stats.oneSlotBlocked === expected.oneSlotBlocked,
        quality102: result.stats.quality102 === expected.quality102,
        layers: Object.keys(result.stats.layers).length === Object.keys(expected.layers).length
            && (Object.keys(expected.layers) as Quality102Layer[]).every((layer) => result.stats.layers[layer] === expected.layers[layer]),
        families: Object.keys(result.stats.families).length === Object.keys(expected.families).length
            && (Object.keys(expected.families) as Quality102Family[]).every((family) => result.stats.families[family] === expected.families[family]),
        exitReasons: Object.keys(result.stats.exitReasons).length === Object.keys(expected.exitReasons).length
            && (Object.keys(expected.exitReasons) as Array<keyof typeof expected.exitReasons>)
                .every((reason) => result.stats.exitReasons[reason] === expected.exitReasons[reason]),
    };
    return {
        allPass: Object.values(checks).every(Boolean),
        checks,
        observed: result.stats,
    };
}

export function assertQuality102Parity(result: Quality102SelectionResult): void {
    const parity = evaluateQuality102Parity(result);
    if (!parity.allPass) throw new Error(`QUALITY102_PARITY_MISMATCH:${JSON.stringify(parity)}`);
}
