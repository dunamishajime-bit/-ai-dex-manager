import test from "node:test";
import assert from "node:assert/strict";

import { advancePenguShortV20TimedStops } from "../lib/pengu-short-v20-timed-stop";
import type { PenguDualLsV2ShortV20State } from "../lib/pengu-dual-ls-v2";

const BASE: PenguDualLsV2ShortV20State = {
    version: "SHORT_V20",
    preRegistrationSha: "ad7cedb3cafaf9f9680e390112f72375d84b50ac",
    requestedGross: 1,
    sizingState: "CAP",
    entryAtr24Ratio: 0.01,
    counterwind: true,
    armed: false,
    progressed: false,
    lowWater: 100,
    phase: "TRACKING",
};

const position = { entryTs: 1_700_000_100_000, entryPrice: 100 };
const bar = (close: number, confirmationTs: number) => ({
    timestampMs: confirmationTs - 5 * 60_000,
    open: close,
    high: close,
    low: close,
    close,
});

test("PENGU SHORT V20 evaluates the exact 3h close before the next bar", () => {
    const boundary = position.entryTs + 3 * 3_600_000;
    const result = advancePenguShortV20TimedStops({
        position,
        state: BASE,
        bars: [bar(102.5, boundary), bar(100, boundary + 5 * 60_000)],
    });
    assert.deepEqual(result.action, { kind: "TIMED_NEGATIVE_3H_EXIT", referenceTs: boundary, lossPct: 2.5 });
    assert.equal(result.state.timedStop3hCheckedAtTs, boundary);
    assert.equal(result.state.timedStop3hCheckedClose, 102.5);
});

test("PENGU SHORT V20 evaluates the exact 8h close before the next bar", () => {
    const boundary = position.entryTs + 8 * 3_600_000;
    const result = advancePenguShortV20TimedStops({
        position,
        state: { ...BASE, timedStop3hChecked: true, timedStop3hTriggered: false },
        bars: [bar(104, boundary), bar(100, boundary + 5 * 60_000)],
    });
    assert.deepEqual(result.action, { kind: "TIMED_NEGATIVE_8H_EXIT", referenceTs: boundary, lossPct: 4 });
    assert.equal(result.state.timedStop8hCheckedAtTs, boundary);
    assert.equal(result.state.timedStop8hCheckedClose, 104);
});

test("PENGU SHORT V20 triggers the 3h -2.5% price-loss check once", () => {
    const checkedAt = position.entryTs + 3 * 3_600_000;
    const first = advancePenguShortV20TimedStops({ position, state: BASE, bars: [bar(102.5, checkedAt + 5 * 60_000)] });
    assert.equal(first.action?.kind, "TIMED_NEGATIVE_3H_EXIT");
    assert.equal(first.action?.lossPct, 2.5);
    assert.equal(first.state.timedStop3hChecked, true);
    assert.equal(first.state.timedStop3hTriggered, true);

    const second = advancePenguShortV20TimedStops({ position, state: first.state, bars: [bar(103, checkedAt)] });
    assert.equal(second.action, undefined);
    assert.equal(second.state.timedStop3hChecked, true);
});

test("PENGU SHORT V20 does not replace a clear 3h boundary close with a later loss", () => {
    const threshold = position.entryTs + 3 * 3_600_000;
    const result = advancePenguShortV20TimedStops({
        position,
        state: BASE,
        bars: [bar(102.49, threshold), bar(102.5, threshold + 5 * 60_000)],
    });
    assert.equal(result.action, undefined);
    assert.equal(result.state.timedStop3hCheckedAtTs, threshold);
    assert.equal(result.state.timedStop3hCheckedClose, 102.49);
    assert.equal(result.state.timedStop3hTriggered, false);
});

test("PENGU SHORT V20 checks the 8h -4% stop only when 3h was clear", () => {
    const threeHour = position.entryTs + 3 * 3_600_000;
    const bars = Array.from({ length: 62 }, (_, index) => bar(index === 60 ? 104 : 102.4, threeHour + index * 5 * 60_000));
    const result = advancePenguShortV20TimedStops({
        position,
        state: BASE,
        bars,
    });
    assert.equal(result.action?.kind, "TIMED_NEGATIVE_8H_EXIT");
    assert.equal(result.state.timedStop3hChecked, true);
    assert.equal(result.state.timedStop3hTriggered, false);
    assert.equal(result.state.timedStop8hChecked, true);
});

test("PENGU timed stop rejects malformed or non-contiguous M5 evidence", () => {
    assert.throws(
        () => advancePenguShortV20TimedStops({ position, state: BASE, bars: [{ timestampMs: 1, open: 1, high: 1, low: 1, close: 0 }] }),
        /PENGU_SHORT_V20_TIMED_STOP_BAR_INVALID/,
    );
    assert.throws(
        () => advancePenguShortV20TimedStops({
            position,
            state: BASE,
            bars: [bar(100, position.entryTs + 3 * 3_600_000), bar(100, position.entryTs + 4 * 3_600_000)],
        }),
        /PENGU_SHORT_V20_TIMED_STOP_M5_GAP/,
    );
});
