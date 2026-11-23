import assert from "node:assert/strict";
import {
    evaluateQuality102CausalReadiness,
    getQuality102RecoveryCapabilities,
    type Quality102CausalManifest,
} from "../lib/disdex-quality102-causal-selector";
import { STRICT_BT33404708902 } from "../config/disdexStrictBt33404708902Runtime";

const capabilities = getQuality102RecoveryCapabilities();

assert.deepEqual(capabilities, {
    highVolRawGeneratorImplemented: true,
    highVolHistoricalParity: {
        oldUniverseExact: { expected: 137, matched: 137 },
        expandedUniverseExact: { expected: 388, matched: 388 },
        combinedRawExpected: 525,
    },
    highVol525To30SelectorProven: false,
    recoveredHighVolSelectedShape: { stage1: 8, stage2: 22, total: 30 },
    pbMrRevPostGenerationRecovered: true,
    brkStrengthFormulaProven: false,
    quality124TransformRecovered: true,
    oneSlotRouterRecovered: true,
    selectorImplemented: false,
});

const decisionTs = 1_800_000_000_000;
const manifest: Quality102CausalManifest = {
    sourceKind: "dynamic-selector",
    sourceRun: STRICT_BT33404708902.sourceRun,
    sourceSha: STRICT_BT33404708902.sourceSha,
    noLookahead: true,
    fixedHistoricalTimestamps: false,
    selectorParity: true,
    availableAtTs: decisionTs - 1_000,
};

// Recovery bookkeeping must never turn unresolved provenance into LIVE readiness.
assert.equal(
    evaluateQuality102CausalReadiness({ decisionTs, manifest, liveArmed: true }).status,
    "LIVE_BLOCKED_FAIL_CLOSED",
);
assert.equal(
    evaluateQuality102CausalReadiness({ decisionTs, manifest, liveArmed: true }).reason,
    "HIGH_VOL_525_TO_30_SELECTOR_PROOF_MISSING",
);

console.log("QUALITY102_RECOVERY_CAPABILITIES_SELFTEST_PASS", JSON.stringify(capabilities));
