import assert from "node:assert/strict";

import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";
import {
    advancePenguShortV20,
    calculatePenguShortV20NetReturn,
    createPenguShortV20State,
    type PenguShortV20Action,
} from "../lib/pengu-short-v20";
import type {
    PenguDualLsV2Features,
    PenguDualLsV2ShortV20State,
} from "../lib/pengu-dual-ls-v2";

const HOUR = 3_600_000;
const BASE_FEE_PER_SIDE = 0.0006;

function features(overrides: Partial<PenguDualLsV2Features> = {}): PenguDualLsV2Features {
    return {
        referenceTs: 100 * HOUR,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        previousLow: 99,
        priorHigh18h: 101,
        penguReturn24h: -0.07,
        penguReturn72h: -0.01,
        btcReturn24h: -0.01,
        relativeReturn24h: -0.03,
        ema72: 100,
        ema168: 101,
        btcEma168Distance: 0.01,
        volumeRatio6OverPrior36: 1,
        atr24Ratio: 0.03,
        rsi14: 35,
        ...overrides,
    };
}

/**
 * Independent oracle copied from transformShort in
 * scripts/research_pengu_short_v20_vol_target_failure_exit.py. Keep this
 * function separate from production so a shared implementation cannot make
 * the parity test vacuous.
 */
function researchReferenceAdvance(
    position: { entryPrice: number; entryTs: number; shortV20: PenguDualLsV2ShortV20State },
    input: PenguDualLsV2Features,
): { state: PenguDualLsV2ShortV20State; action?: PenguShortV20Action } {
    const state = { ...position.shortV20 };
    if (!state.counterwind || state.phase === "RESUMED") return { state };

    if (state.phase === "PROBATION") {
        if (state.sizingState === "VOL_TARGET" && state.failureConfirmedTs !== undefined && input.referenceTs > state.failureConfirmedTs) {
            return { state, action: { kind: "VOL_TARGET_FAILURE_EXIT", referenceTs: input.referenceTs, exitPrice: input.open } };
        }
        const deadlineTs = position.entryTs + (PENGU_DUAL_LS_V2.short.maxHoldHours / 4) * HOUR;
        if (input.referenceTs >= deadlineTs) {
            return { state, action: { kind: "DEADLINE_EXIT", referenceTs: input.referenceTs, exitPrice: input.open } };
        }
        if (input.close < state.lowWater && input.close < input.ema72 && input.btcReturn24h >= 0) {
            state.phase = "RESUMED";
            state.thesisResumedTs = input.referenceTs;
            return { state, action: { kind: "THESIS_RESUMED", referenceTs: input.referenceTs } };
        }
        return { state };
    }

    state.lowWater = Math.min(state.lowWater, input.low);
    const unit = Math.min(state.entryAtr24Ratio, PENGU_DUAL_LS_V2.short.hardStopPct / 2);
    const arm = unit;
    const goal = Math.min(2 * unit, PENGU_DUAL_LS_V2.short.hardStopPct);
    const failLevel = unit / 2;
    const mfe = 1 - state.lowWater / position.entryPrice;
    if (!state.armed && !state.progressed && mfe >= arm) state.armed = true;
    if (state.armed && mfe >= goal) {
        state.progressed = true;
        state.armed = false;
    }
    if (state.armed && !state.progressed && (1 - input.close / position.entryPrice) <= failLevel) {
        state.phase = "PROBATION";
        state.failureConfirmedTs = input.referenceTs;
    }
    return { state };
}

function compareSequence(seed: PenguDualLsV2ShortV20State, rows: PenguDualLsV2Features[]) {
    let research = seed;
    let production = seed;
    const position = { entryPrice: 100, entryTs: 100 * HOUR };
    for (const row of rows) {
        const expected = researchReferenceAdvance({ ...position, shortV20: research }, row);
        const actual = advancePenguShortV20({ ...position, shortV20: production }, row);
        assert.deepEqual(actual.state, expected.state, `state mismatch at ${row.referenceTs}`);
        assert.deepEqual(actual.action, expected.action, `action mismatch at ${row.referenceTs}`);
        research = expected.state;
        production = actual.state;
    }
    return { research, production };
}

const volTargetSeed = createPenguShortV20State({
    entryPrice: 100,
    requestedGross: 0.70,
    entryAtr24Ratio: 0.03,
    btcEma168Distance: 0.01,
    btcReturn24h: -0.01,
});
const volTargetRows = [
    features({ referenceTs: 101 * HOUR, low: 97, close: 99, high: 100 }),
    features({ referenceTs: 102 * HOUR, open: 98.25, low: 98, close: 98.5, high: 99 }),
];
const volTargetResult = compareSequence(volTargetSeed, volTargetRows);
assert.equal(volTargetResult.production.phase, "PROBATION");

const capSeed = createPenguShortV20State({
    entryPrice: 100,
    requestedGross: 0.75,
    entryAtr24Ratio: 0.03,
    btcEma168Distance: 0.01,
    btcReturn24h: 0,
});
const capResult = compareSequence(capSeed, [
    features({ referenceTs: 101 * HOUR, low: 97, close: 99, high: 100, btcReturn24h: 0 }),
    features({ referenceTs: 102 * HOUR, close: 96, low: 95, high: 98, ema72: 99, btcReturn24h: 0 }),
]);
assert.equal(capResult.production.phase, "RESUMED");

const floorSeed = createPenguShortV20State({
    entryPrice: 100,
    requestedGross: 0.60,
    entryAtr24Ratio: 0.03,
    btcEma168Distance: 0.01,
    btcReturn24h: -0.01,
});
const floorResult = compareSequence(floorSeed, [
    features({ referenceTs: 101 * HOUR, low: 97, close: 99, high: 100 }),
    features({ referenceTs: 118 * HOUR, open: 99, low: 98, close: 99, high: 100 }),
]);
assert.equal(floorResult.production.phase, "PROBATION");
const floorDeadline = advancePenguShortV20(
    { entryPrice: 100, entryTs: 100 * HOUR, shortV20: floorResult.production },
    features({ referenceTs: 118 * HOUR, open: 99, low: 98, close: 99, high: 100 }),
);
assert.equal(floorDeadline.action?.kind, "DEADLINE_EXIT");

const returnInput = { entryPrice: 100, exitPrice: 98.25, requestedGross: 0.70, fundingReturn: 0.0012, costPerSide: BASE_FEE_PER_SIDE };
const productionReturn = calculatePenguShortV20NetReturn(returnInput);
const expectedRaw = returnInput.entryPrice / returnInput.exitPrice - 1;
const expectedNet = expectedRaw + returnInput.fundingReturn - 2 * returnInput.costPerSide;
assert.equal(productionReturn.raw, expectedRaw);
assert.equal(productionReturn.netUnitReturn, expectedNet);
assert.equal(productionReturn.accountReturn, returnInput.requestedGross * expectedNet);

console.log("PENGU_SHORT_V20_PRODUCTION_PARITY_PASS");
console.log(JSON.stringify({
    candidate: "COUNTERWIND_VOL_TARGET_FAILURE_EXIT",
    preRegistrationSha: "ad7cedb3cafaf9f9680e390112f72375d84b50ac",
    fixtures: { volTarget: volTargetRows.length, cap: 2, floor: 2 },
    ordersSent: 0,
    cancelSent: 0,
    positionChangesSent: 0,
}));
