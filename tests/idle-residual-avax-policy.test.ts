import test from "node:test";
import assert from "node:assert/strict";

import {
    advanceAvaxSoftWatch,
    advanceAvaxTrail,
    evaluateAvaxResidualEntryVeto,
} from "../lib/idle-residual-avax-policy";

const entryPrice = 100;
const bar = (close: number, timestampMs: number, high = close) => ({
    timestampMs,
    open: close,
    high,
    low: close,
    close,
});

test("AVAX residual entry veto implements the adopted dual causal gate", () => {
    assert.equal(evaluateAvaxResidualEntryVeto({ avax3hPct: -0.5, btc3hPct: -0.01, avax6hPct: 0, btc6hPct: 0 }), "CO_DECLINE");
    assert.equal(evaluateAvaxResidualEntryVeto({ avax3hPct: 0, btc3hPct: 0, avax6hPct: 2, btc6hPct: -0.01 }), "DIVERGENT_RALLY");
    assert.equal(evaluateAvaxResidualEntryVeto({ avax3hPct: -0.49, btc3hPct: -0.01, avax6hPct: 1.99, btc6hPct: -0.01 }), undefined);
});

test("AVAX soft -3.5% watch starts, cancels on recovery, and exits at the 2h deadline", () => {
    const started = advanceAvaxSoftWatch({ entryPrice, bidPrice: 96.5, now: 1_000, firstTouchAtTs: undefined, watchDeadlineTs: undefined });
    assert.equal(started.firstTouchAtTs, 1_000);
    assert.equal(started.watchDeadlineTs, 1_000 + 2 * 3_600_000);
    assert.equal(started.action, undefined);

    const recovered = advanceAvaxSoftWatch({ entryPrice, bidPrice: 99, now: 2_000, firstTouchAtTs: started.firstTouchAtTs, watchDeadlineTs: started.watchDeadlineTs });
    assert.equal(recovered.firstTouchAtTs, undefined);
    assert.equal(recovered.watchDeadlineTs, undefined);

    const matured = advanceAvaxSoftWatch({ entryPrice, bidPrice: 96, now: started.watchDeadlineTs!, firstTouchAtTs: started.firstTouchAtTs, watchDeadlineTs: started.watchDeadlineTs });
    assert.equal(matured.action, "SOFT_MINUS3P5_WATCH2H");
});

test("AVAX confirmed M5 trailing protection arms at +3% and exits after 1.5pp giveback", () => {
    const armed = advanceAvaxTrail({ entryPrice, armed: false, bestClosePct: undefined, lastConfirmed5mTs: undefined, bars: [bar(103, 1)] });
    assert.equal(armed.state.armed, true);
    assert.equal(armed.state.bestClosePct, 3);
    assert.equal(armed.action, undefined);

    const higher = advanceAvaxTrail({ entryPrice, ...armed.state, bars: [bar(104, 2)] });
    assert.equal(higher.state.bestClosePct, 4);
    assert.equal(higher.action, undefined);

    const giveback = advanceAvaxTrail({ entryPrice, ...higher.state, bars: [bar(102.5, 3)] });
    assert.equal(giveback.action, "AVAX_TRAIL_ARM3_GIVE1P5");
});

test("AVAX trailing logic never reuses an already processed M5 bar", () => {
    const result = advanceAvaxTrail({ entryPrice, armed: true, bestClosePct: 4, lastConfirmed5mTs: 3, bars: [bar(102, 3), bar(103, 2)] });
    assert.equal(result.action, undefined);
    assert.equal(result.state.lastConfirmed5mTs, 3);
});
