import assert from "node:assert/strict";
import {
    QUALITY102_EXPECTED_COUNTS,
    QUALITY102_HOUR_MS,
    buildQuality102Selection,
    computeQuality102HighVolFeatures,
    evaluateQuality102Parity,
    generateQuality102HighVolSignals,
    matchQuality102HighVolGrid,
    materializeQuality102HighVolCandidate,
    selectQuality102HighVolStageSubset,
    selectQuality102HighVolThirtySubset,
    selectQuality102HighVolMonthlyRule,
    simulateQuality102HighVolExit,
    type Quality102Candle,
    type Quality102HighVolMonthlyRuleStats,
    type Quality102HighVolRule,
    type Quality102RawCandidate,
} from "../lib/disdex-quality102-causal-pipeline";
import { evaluateS34QualityGate } from "../lib/disdex-quality102-causal-selector";

const HOUR = QUALITY102_HOUR_MS;

function candles(count: number): Quality102Candle[] {
    return Array.from({ length: count }, (_, index) => {
        const open = 100 + index * 0.05;
        const close = open + 0.25;
        return {
            timestampMs: index * HOUR,
            open,
            high: close + 1,
            low: open - 1,
            close,
            quoteVolume: 100,
        };
    });
}

const monthlyRule: Quality102HighVolRule = {
    longDrop: 0.1,
    longRsi: 35,
    shortRally: 0.05,
    shortRsi: 60,
    hardStop: 0.15,
};

const longSnapshot = {
    signalTs: 1,
    ret24: -0.12,
    ret14d: 0.08,
    rsi14: 30,
    atr14: 2,
    atrPct: 0.02,
    volumeRatio: 1,
    barUp: true,
    barDown: false,
};

const shortSnapshot = {
    signalTs: 1,
    ret24: 0.08,
    ret14d: -0.08,
    rsi14: 65,
    atr14: 2,
    atrPct: 0.02,
    volumeRatio: 1,
    barUp: false,
    barDown: true,
};

// Features are causal: adding or changing bars after the signal cannot change them.
const featureBars = candles(337);
const feature = computeQuality102HighVolFeatures(featureBars, 336);
const futureChanged = featureBars.concat(candles(8).map((bar, index) => ({
    ...bar,
    timestampMs: (337 + index) * HOUR,
    close: 10_000 + index,
    high: 10_001 + index,
    low: 9_999 + index,
})));
assert.deepEqual(computeQuality102HighVolFeatures(futureChanged, 336), feature);
assert.ok(Number.isFinite(feature.rsi14));
assert.ok(Number.isFinite(feature.atr14));

// The recovered HIGH_VOL trigger directions and parameter grid are explicit.
assert.ok(matchQuality102HighVolGrid(longSnapshot).some((rule) => rule.side === 1 && rule.threshold === 0.1 && rule.rsi === 35 && rule.hardStop === 0.15));
assert.ok(matchQuality102HighVolGrid(shortSnapshot).some((rule) => rule.side === -1 && rule.threshold === 0.05 && rule.rsi === 60 && rule.hardStop === 0.15));
assert.equal(matchQuality102HighVolGrid({ ...longSnapshot, ret14d: -0.01 }).length, 0);
assert.equal(matchQuality102HighVolGrid({ ...shortSnapshot, ret14d: 0.01 }).length, 0);

// Monthly selection uses only the exact preceding 180d window and deterministic ranking.
const monthStart = Date.UTC(2026, 0, 1);
const windowStart = monthStart - 180 * 24 * HOUR;
const windowEnd = monthStart - HOUR;
const ruleStats = (rule: Quality102HighVolRule, overrides: Partial<Quality102HighVolMonthlyRuleStats> = {}): Quality102HighVolMonthlyRuleStats => ({
    rule,
    trades: 10,
    wins: 7,
    totalReturn: 0.1,
    profitFactor: 1.8,
    expectancy: 0.01,
    maxDrawdown: -0.1,
    trainingStartTs: windowStart,
    trainingEndTs: windowEnd,
    availableAtTs: windowEnd,
    ...overrides,
});
const selected = selectQuality102HighVolMonthlyRule({
    monthStartTs: monthStart,
    evaluations: [
        ruleStats(monthlyRule),
        ruleStats({ ...monthlyRule, longDrop: 0.08 }, { totalReturn: 0.02, profitFactor: 1.2, expectancy: 0.002 }),
    ],
});
assert.equal(selected.selected?.rule.longDrop, 0.1);
assert.equal(selected.eligible.length, 2);
assert.equal(selectQuality102HighVolMonthlyRule({
    monthStartTs: monthStart,
    evaluations: [ruleStats(monthlyRule, { trainingEndTs: monthStart })],
}).selected, undefined);

// HIGH_VOL exits: hard stop priority, trailing after +12%, and 72 bars.
const stopExit = simulateQuality102HighVolExit({
    side: 1,
    entryPrice: 100,
    hardStop: 0.1,
    bars: [{ timestampMs: HOUR, open: 100, high: 101, low: 89, close: 90, quoteVolume: 1 }],
});
assert.equal(stopExit.exitTs, HOUR);
assert.equal(stopExit.exitPrice, 90);
assert.ok(Math.abs(stopExit.grossReturn + 0.1) < 1e-12);
assert.equal(stopExit.holdHours, 1);
assert.equal(stopExit.exitReason, "hard_stop");
const shortStopExit = simulateQuality102HighVolExit({
    side: -1,
    entryPrice: 100,
    hardStop: 0.1,
    bars: [{ timestampMs: HOUR, open: 100, high: 111, low: 99, close: 105, quoteVolume: 1 }],
});
assert.ok(Math.abs(shortStopExit.exitPrice - 110) < 1e-12);
assert.ok(Math.abs(shortStopExit.grossReturn + 0.1) < 1e-12);
assert.equal(shortStopExit.exitReason, "hard_stop");
const trailExit = simulateQuality102HighVolExit({
    side: 1,
    entryPrice: 100,
    hardStop: 0.1,
    bars: [{ timestampMs: HOUR, open: 100, high: 113, low: 99, close: 110, quoteVolume: 1 }],
});
assert.equal(trailExit.exitReason, "trail_5pct_after_12pct");
assert.equal(trailExit.exitPrice, 107.35);
const timeBars = Array.from({ length: 72 }, (_, index) => ({
    timestampMs: (index + 1) * HOUR,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    quoteVolume: 1,
}));
assert.equal(simulateQuality102HighVolExit({ side: 1, entryPrice: 100, hardStop: 0.1, bars: timeBars }).exitReason, "72h_time");

// Recovered S34 post-generation gates are explicit, including the upstream
// BRK strength requirement. No BRK strength is synthesized here.
assert.equal(evaluateS34QualityGate({ family: "PB", variant: "PB168_0.1_P24_0.04_H12", side: 1, strength: 1, ret14: 0 }).accepted, false);
assert.equal(evaluateS34QualityGate({ family: "PB", variant: "PB168_0.1_P24_0.08_H12", side: 1, strength: 1, ret14: 0 }).accepted, true);
assert.equal(evaluateS34QualityGate({ family: "MR", variant: "MR", side: 1, strength: 1, ret14: -0.026 }).accepted, false);
assert.equal(evaluateS34QualityGate({ family: "MR", variant: "MR", side: -1, strength: 1, ret14: -1 }).accepted, true);
assert.equal(evaluateS34QualityGate({ family: "BRK", variant: "BRK", side: 1, strength: 0.029, ret14: 0 }).accepted, false);
assert.equal(evaluateS34QualityGate({ family: "BRK", variant: "BRK", side: 1, strength: 0.03, ret14: -0.05 }).accepted, true);
assert.equal(evaluateS34QualityGate({ family: "BRK", variant: "BRK", side: -1, strength: 0.03, ret14: 0.0500001 }).accepted, false);
assert.equal(evaluateS34QualityGate({ family: "REV", variant: "REV", side: 1, strength: 0, ret14: -1 }).accepted, true);

// No implicit 30-row stage split: every expanded row must be assigned explicitly.
assert.throws(() => selectQuality102HighVolStageSubset({
    expanded: [{ id: "a" }, { id: "b" }],
    stage1Ids: ["a"],
    stage2Ids: [],
    expectedTotal: 2,
}), /HIGH_VOL_STAGE_SUBSET_INCOMPLETE/);
const stageSubset = selectQuality102HighVolStageSubset({
    expanded: [{ id: "a" }, { id: "b" }, { id: "c" }],
    stage1Ids: ["a", "c"],
    stage2Ids: ["b"],
});
assert.deepEqual(stageSubset.stage1.map((row) => row.id), ["a", "c"]);
assert.deepEqual(stageSubset.stage2.map((row) => row.id), ["b"]);
const thirtyExpanded = Array.from({ length: 30 }, (_, index) => ({ id: `expanded-${index}` }));
const thirtySubset = selectQuality102HighVolThirtySubset({
    expanded: thirtyExpanded,
    stage1Ids: thirtyExpanded.slice(0, 8).map((row) => row.id),
    stage2Ids: thirtyExpanded.slice(8).map((row) => row.id),
});
assert.equal(thirtySubset.stage1.length + thirtySubset.stage2.length, 30);
assert.equal(thirtySubset.stage1.length, 8);
assert.equal(thirtySubset.stage2.length, 22);

// Signal generation uses the selected month rule and the next bar's open.
const signalBars = candles(338);
signalBars[336] = { ...signalBars[336], open: 100, high: 101, low: 80, close: 90, quoteVolume: 100 };
signalBars[0] = { ...signalBars[0], close: 80, low: 79 };
const generatedSignals = generateQuality102HighVolSignals({
    symbol: "TEST",
    stage: "S1",
    bars: signalBars,
    monthlyRules: new Map([[Date.UTC(1970, 0, 1), monthlyRule]]),
});
assert.equal(generatedSignals.length, 0);
const shortSignalBars = Array.from({ length: 338 }, (_, index) => {
    let close: number;
    if (index === 0) close = 120;
    else if (index < 312) close = 92;
    else if (index === 312) close = 90;
    else if (index < 336) close = 90 + (index - 312) * 0.3;
    else if (index === 336) close = 96;
    else close = 95;
    const open = index === 336 ? 97 : index === 337 ? 77.7 : close;
    return {
        timestampMs: index * HOUR,
        open,
        high: Math.max(open, close) + 1.5,
        low: Math.min(open, close) - 1.5,
        close,
        quoteVolume: 100,
    } satisfies Quality102Candle;
});
const generatedShort = generateQuality102HighVolSignals({
    symbol: "TEST",
    stage: "S2",
    bars: shortSignalBars,
    monthlyRules: new Map([[Date.UTC(1970, 0, 1), monthlyRule]]),
});
assert.equal(generatedShort.length, 1);
assert.equal(generatedShort[0]?.side, -1);
assert.equal(generatedShort[0]?.signalTs, 336 * HOUR);
assert.equal(generatedShort[0]?.entryTs, 337 * HOUR);
assert.equal(generatedShort[0]?.entryPrice, 77.7);

// Synthetic exact-shape contract: raw 151 -> quality 124 -> one-slot final 102.
const baseTs = Date.UTC(2025, 0, 1);
function rawCandidate(input: Partial<Quality102RawCandidate> & Pick<Quality102RawCandidate, "id" | "entryTs" | "exitTs" | "layer" | "family" | "variant" | "side">): Quality102RawCandidate {
    return {
        symbol: "TEST",
        grossReturn: 0.02,
        holdHours: 1,
        exitReason: "time",
        normalNet: 0.0184,
        stressNet: 0.017,
        ret14: 0.1,
        strength: 0.1,
        ...input,
    };
}
const finalCandidates: Quality102RawCandidate[] = [];
for (let index = 0; index < 102; index += 1) {
    const layer = index < 8 ? "S1" : index < 18 ? "S2" : "S34";
    const entryTs = baseTs + index * 2 * HOUR;
    finalCandidates.push(rawCandidate({
        id: `final-${index}`,
        entryTs,
        exitTs: entryTs + HOUR,
        layer,
        family: layer !== "S34"
            ? "HIGH_VOL"
            : index - 18 < 10
                ? "PB"
                : index - 18 < 32
                    ? "MR"
                    : index - 18 < 60
                        ? "BRK"
                        : "REV",
        variant: `final-${index}`,
        side: 1,
        exitReason: index < 13 ? "72h_time" : index < 18 ? "trail_5pct_after_12pct" : index - 18 < 77 ? "time" : "stop",
    }));
}
const blockedHighVol = Array.from({ length: 12 }, (_, index) => {
    const entryTs = baseTs + (index * 2 + 0.5) * HOUR;
    return rawCandidate({ id: `blocked-hv-${index}`, entryTs, exitTs: entryTs + HOUR, layer: index % 2 === 0 ? "S1" : "S2", family: "HIGH_VOL", variant: `blocked-hv-${index}`, side: 1 });
});
const blockedS34 = Array.from({ length: 10 }, (_, index) => {
    const anchor = 20 + index;
    const entryTs = baseTs + (anchor * 2 + 0.5) * HOUR;
    return rawCandidate({ id: `blocked-s34-${index}`, entryTs, exitTs: entryTs + HOUR, layer: "S34", family: "REV", variant: `blocked-s34-${index}`, side: 1 });
});
const rejectedS34 = Array.from({ length: 27 }, (_, index) => {
    const entryTs = baseTs + (300 + index) * 2 * HOUR;
    return rawCandidate({ id: `rejected-${index}`, entryTs, exitTs: entryTs + HOUR, layer: "S34", family: "PB", variant: "PB168_0.1_P24_0.04_H12", side: 1 });
});
const finalS34 = finalCandidates.filter((row) => row.layer === "S34");
const coreIdentities = [...finalS34.slice(0, 69), ...blockedS34]
    .map((row) => ({ entryTs: row.entryTs, symbol: row.symbol, variant: row.variant, side: row.side }));
const fillerIdentities = finalS34.slice(69, 84)
    .map((row) => ({ entryTs: row.entryTs, symbol: row.symbol, variant: row.variant, side: row.side }));
const pipeline = buildQuality102Selection({
    rawHighVol: [...finalCandidates.slice(0, 18), ...blockedHighVol],
    rawS34: [...finalCandidates.slice(18), ...blockedS34, ...rejectedS34],
    coreIdentities,
    fillerIdentities,
});
assert.deepEqual(pipeline.stats, {
    raw: 151,
    highVolRaw: 30,
    s34Raw: 121,
    s34Rejected: 27,
    quality124: 124,
    oneSlotBlocked: 22,
    quality102: 102,
    layers: { S1: 8, S2: 10, S3: 69, S4: 15 },
    families: { HIGH_VOL: 18, PB: 10, MR: 22, BRK: 28, REV: 24 },
    exitReasons: { time: 77, "72h_time": 13, stop: 7, trail_5pct_after_12pct: 5 },
});
assert.equal(evaluateQuality102Parity(pipeline).allPass, true);
assert.equal(evaluateQuality102Parity({
    ...pipeline,
    stats: { ...pipeline.stats, exitReasons: { ...pipeline.stats.exitReasons, unexpected: 0 } },
}).allPass, false);
assert.deepEqual(QUALITY102_EXPECTED_COUNTS, {
    raw: 151,
    highVolRaw: 30,
    s34Raw: 121,
    s34Rejected: 27,
    quality124: 124,
    oneSlotBlocked: 22,
    quality102: 102,
    layers: { S1: 8, S2: 10, S3: 69, S4: 15 },
    families: { HIGH_VOL: 18, PB: 10, MR: 22, BRK: 28, REV: 24 },
    exitReasons: { time: 77, "72h_time": 13, stop: 7, trail_5pct_after_12pct: 5 },
});

// Materialization stays pure and preserves the selected rule/exit accounting.
const materialized = materializeQuality102HighVolCandidate({
    id: "materialized",
    symbol: "TEST",
    stage: "S1",
    signalTs: 0,
    entryTs: HOUR,
    entryPrice: 100,
    side: 1,
    rule: monthlyRule,
    features: longSnapshot,
}, trailExit);
assert.equal(materialized.layer, "S1");
assert.equal(materialized.family, "HIGH_VOL");
assert.equal(materialized.exitReason, "trail_5pct_after_12pct");

console.log("QUALITY102_CAUSAL_PIPELINE_SELFTEST_PASS", JSON.stringify({
    raw: pipeline.stats.raw,
    quality124: pipeline.stats.quality124,
    oneSlotBlocked: pipeline.stats.oneSlotBlocked,
    quality102: pipeline.stats.quality102,
    layers: pipeline.stats.layers,
}));
