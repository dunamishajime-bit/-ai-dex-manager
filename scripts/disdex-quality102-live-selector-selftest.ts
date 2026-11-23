import assert from "node:assert/strict";
import { evaluateQuality102LiveSelector } from "../lib/disdex-quality102-live-selector";

const result = evaluateQuality102LiveSelector({ decisionTs: 1_800_000_000_000 });
assert.equal(result.status, "LIVE_BLOCKED_FAIL_CLOSED");
assert.equal(result.quality102LiveSelectorParity, false);
assert.equal(result.quality102LiveBlockedFailClosed, true);
assert.match(result.reason, /SELECTOR_MANIFEST_MISSING/);

const fixed = evaluateQuality102LiveSelector({
    decisionTs: 1_800_000_000_000,
    manifest: {
        sourceKind: "frozen-historical-csv",
        sourceRun: "33404708902",
        sourceSha: "aec066fefd761b12f07e6927b5f2a524f88ca08b",
        noLookahead: true,
        fixedHistoricalTimestamps: true,
        selectorParity: true,
        availableAtTs: 1_799_999_999_000,
    },
});
assert.equal(fixed.status, "LIVE_BLOCKED_FAIL_CLOSED");
assert.match(fixed.reason, /FIXED_HISTORICAL_SIGNAL_FORBIDDEN/);

const future = evaluateQuality102LiveSelector({
    decisionTs: 1_800_000_000_000,
    manifest: {
        sourceKind: "dynamic-selector",
        sourceRun: "33404708902",
        sourceSha: "aec066fefd761b12f07e6927b5f2a524f88ca08b",
        noLookahead: true,
        fixedHistoricalTimestamps: false,
        selectorParity: true,
        availableAtTs: 1_800_000_001_000,
    },
});
assert.equal(future.status, "LIVE_BLOCKED_FAIL_CLOSED");
assert.match(future.reason, /SELECTOR_DATA_NOT_AVAILABLE_AT_DECISION/);

const selfAttested = evaluateQuality102LiveSelector({
    decisionTs: 1_800_000_000_000,
    manifest: {
        sourceKind: "dynamic-selector",
        sourceRun: "33404708902",
        sourceSha: "aec066fefd761b12f07e6927b5f2a524f88ca08b",
        noLookahead: true,
        fixedHistoricalTimestamps: false,
        selectorParity: true,
        availableAtTs: 1_799_999_999_000,
    },
});
assert.equal(selfAttested.status, "LIVE_BLOCKED_FAIL_CLOSED");
assert.match(selfAttested.reason, /HIGH_VOL_525_TO_30_SELECTOR_PROOF_MISSING/);

console.log("QUALITY102_LIVE_SELECTOR_SELFTEST_PASS", JSON.stringify({
    quality102LiveSelectorParity: result.quality102LiveSelectorParity,
    quality102LiveBlockedFailClosed: result.quality102LiveBlockedFailClosed,
}));
