import assert from "node:assert/strict";
import { STRICT_BT33404708902 } from "../config/disdexStrictBt33404708902Runtime";
import {
    QUALITY102_CAUSAL_CAPABILITIES,
    evaluateQuality102CausalReadiness,
    evaluateQuality102CausalV4FeatureGate,
    evaluateQuality102CausalV4ImprovementGate,
    evaluateS34QualityGate,
    getS1S2RawGeneratorStatus,
    getS34RawGeneratorStatus,
    routeQuality102OneSlot,
    type Quality102CausalManifest,
} from "../lib/disdex-quality102-causal-selector";

const DECISION_TS = 1_800_000_000_000;

function manifest(overrides: Partial<Quality102CausalManifest> = {}): Quality102CausalManifest {
    return {
        sourceKind: "dynamic-selector",
        sourceRun: STRICT_BT33404708902.sourceRun,
        sourceSha: STRICT_BT33404708902.sourceSha,
        noLookahead: true,
        fixedHistoricalTimestamps: false,
        selectorParity: true,
        availableAtTs: DECISION_TS - 1_000,
        ...overrides,
    };
}

// Provenance / causality / freshness fail-closed contracts.
assert.equal(
    evaluateQuality102CausalReadiness({ decisionTs: DECISION_TS }).reason,
    "CAUSAL_MANIFEST_MISSING",
);
assert.equal(
    evaluateQuality102CausalReadiness({
        decisionTs: DECISION_TS,
        manifest: manifest({ sourceKind: "frozen-historical-csv", fixedHistoricalTimestamps: true }),
    }).reason,
    "FIXED_HISTORICAL_SIGNAL_FORBIDDEN",
);
assert.equal(
    evaluateQuality102CausalReadiness({
        decisionTs: DECISION_TS,
        manifest: manifest({ availableAtTs: DECISION_TS + 1 }),
    }).reason,
    "SELECTOR_DATA_NOT_AVAILABLE_AT_DECISION",
);
assert.equal(
    evaluateQuality102CausalReadiness({
        decisionTs: DECISION_TS,
        maxDataAgeMs: 60_000,
        manifest: manifest({ availableAtTs: DECISION_TS - 60_001 }),
    }).reason,
    "SELECTOR_DATA_STALE",
);
assert.equal(
    evaluateQuality102CausalReadiness({
        decisionTs: DECISION_TS,
        manifest: manifest({ noLookahead: false }),
    }).reason,
    "LOOKAHEAD_PROOF_MISSING",
);
assert.equal(
    evaluateQuality102CausalReadiness({
        decisionTs: DECISION_TS,
        manifest: manifest({ selectorParity: false }),
    }).reason,
    "SELECTOR_PARITY_PROOF_MISSING",
);
assert.equal(
    evaluateQuality102CausalReadiness({
        decisionTs: DECISION_TS,
        manifest: manifest({ sourceSha: "not-the-strict-source" }),
    }).reason,
    "SELECTOR_SOURCE_IDENTITY_MISMATCH",
);

// Aggregate producer statuses stay fail-closed until every unresolved causal link is proven.
assert.deepEqual(getS1S2RawGeneratorStatus(), {
    status: "UNAVAILABLE_FAIL_CLOSED",
    reason: "QUALITY102_S1S2_RAW_GENERATOR_NOT_AVAILABLE",
    proven: false,
});
assert.deepEqual(getS34RawGeneratorStatus(), {
    status: "UNAVAILABLE_FAIL_CLOSED",
    reason: "QUALITY102_S34_RAW_GENERATOR_NOT_AVAILABLE",
    proven: false,
});
assert.deepEqual(QUALITY102_CAUSAL_CAPABILITIES, {
    s1s2RawGeneratorProven: false,
    s34RawGeneratorProven: false,
    selectorImplemented: false,
});
assert.equal(
    evaluateQuality102CausalReadiness({ decisionTs: DECISION_TS, manifest: manifest() }).reason,
    "HIGH_VOL_525_TO_30_SELECTOR_PROOF_MISSING",
);
// Operator arming is an independent input and cannot self-attest missing implementation/provenance.
assert.equal(
    evaluateQuality102CausalReadiness({ decisionTs: DECISION_TS, manifest: manifest(), liveArmed: true }).reason,
    "HIGH_VOL_525_TO_30_SELECTOR_PROOF_MISSING",
);

// Exact recovered S34 post-generation quality gates.
assert.deepEqual(
    evaluateS34QualityGate({ family: "PB", variant: "PB168_0.1_P24_0.04_H12", side: 1, strength: 0, ret14: 0 }),
    { accepted: false, reason: "PB_WEAK_VARIANT_REMOVED" },
);
assert.deepEqual(
    evaluateS34QualityGate({ family: "PB", variant: "PB_OTHER", side: -1, strength: 0, ret14: -0.9 }),
    { accepted: true, reason: "PB_WEAK_VARIANT_REMOVED" },
);
assert.deepEqual(
    evaluateS34QualityGate({ family: "MR", variant: "MR_ANY", side: -1, strength: 0, ret14: -0.9 }),
    { accepted: true, reason: "MR_REGIME_GATE" },
);
assert.deepEqual(
    evaluateS34QualityGate({ family: "MR", variant: "MR_ANY", side: 1, strength: 0, ret14: -0.025 }),
    { accepted: true, reason: "MR_REGIME_GATE" },
);
assert.deepEqual(
    evaluateS34QualityGate({ family: "MR", variant: "MR_ANY", side: 1, strength: 0, ret14: -0.0250001 }),
    { accepted: false, reason: "MR_REGIME_GATE" },
);
assert.deepEqual(
    evaluateS34QualityGate({ family: "BRK", variant: "BRK_ANY", side: 1, strength: 0.03, ret14: -0.05 }),
    { accepted: true, reason: "BRK_QUALITY_GATE" },
);
assert.deepEqual(
    evaluateS34QualityGate({ family: "BRK", variant: "BRK_ANY", side: -1, strength: 0.03, ret14: 0.05 }),
    { accepted: true, reason: "BRK_QUALITY_GATE" },
);
assert.deepEqual(
    evaluateS34QualityGate({ family: "BRK", variant: "BRK_ANY", side: 1, strength: 0.029999, ret14: 0 }),
    { accepted: false, reason: "BRK_QUALITY_GATE" },
);
assert.deepEqual(
    evaluateS34QualityGate({ family: "REV", variant: "REV_ANY", side: 1, strength: 0, ret14: -0.9 }),
    { accepted: true, reason: "UNCHANGED" },
);
assert.deepEqual(
    evaluateS34QualityGate({ family: "UNKNOWN", variant: "x", side: 1, strength: 0, ret14: 0 }),
    { accepted: false, reason: "UNKNOWN_S34_FAMILY" },
);
assert.deepEqual(
    evaluateS34QualityGate({ family: "BRK", variant: "x", side: 0, strength: 0.1, ret14: 0 }),
    { accepted: false, reason: "INVALID_S34_SIDE" },
);
assert.deepEqual(
    evaluateS34QualityGate({ family: "BRK", variant: "x", side: 1, strength: Number.NaN, ret14: 0 }),
    { accepted: false, reason: "INVALID_S34_NUMERIC_INPUT" },
);

// Causal V4 feature gate is frozen from the train-only feature search.
assert.deepEqual(
    evaluateQuality102CausalV4FeatureGate({ family: "MR", symbol: "XRP", variant: "MR48_Z2.5_H24", side: -1, ret14: 0.10, margin: 1.05, developmentN: 20, developmentSpf: 0, developmentAvg: 0 }),
    { accepted: true, reason: "V4_FEATURE_GATE_PASS" },
);
assert.deepEqual(
    evaluateQuality102CausalV4FeatureGate({ family: "MR", symbol: "XRP", variant: "MR48_Z2.5_H24", side: -1, ret14: 0.10, margin: 1.05, developmentN: 19, developmentSpf: 0, developmentAvg: 0 }),
    { accepted: false, reason: "V4_DEVELOPMENT_GATE_REJECT" },
);
assert.deepEqual(
    evaluateQuality102CausalV4FeatureGate({ family: "PB", symbol: "FET", variant: "PB168_0.1_P24_0.02_H12", side: 1, ret14: 0.10, margin: 1.7, developmentN: 20, developmentSpf: 1, developmentAvg: 0.01 }),
    { accepted: false, reason: "V4_MARGIN_GATE_REJECT" },
);
assert.deepEqual(
    evaluateQuality102CausalV4FeatureGate({ family: "REV", symbol: "AAVE", variant: "REV24_T0.05_H24", side: 1, ret14: 0.25, margin: 1.5, developmentN: 20, developmentSpf: 1, developmentAvg: 0.01 }),
    { accepted: true, reason: "V4_FEATURE_GATE_PASS" },
);
assert.deepEqual(
    evaluateQuality102CausalV4FeatureGate({ family: "BRK", symbol: "FET", variant: "BRK24_H48_V1.2", side: 1, ret14: 0.15, margin: Number.NaN, developmentN: Number.NaN, developmentSpf: Number.NaN, developmentAvg: Number.NaN }),
    { accepted: true, reason: "V4_FEATURE_GATE_PASS" },
);
assert.deepEqual(
    evaluateQuality102CausalV4FeatureGate({ family: "BRK", symbol: "SOL", variant: "BRK24_H48_V1.2", side: 1, ret14: 0.15, margin: Number.NaN, developmentN: Number.NaN, developmentSpf: Number.NaN, developmentAvg: Number.NaN }),
    { accepted: false, reason: "V4_BRK_VARIANT_WINDOW_REJECT" },
);

// Causal V4 improvement gate: reject weak-regime REV longs using entry-time ret14 only.
assert.deepEqual(
    evaluateQuality102CausalV4ImprovementGate({ family: "REV", side: 1, ret14: 0.239999 }),
    { accepted: false, reason: "REV_LONG_RET14_BELOW_24PCT" },
);
assert.deepEqual(
    evaluateQuality102CausalV4ImprovementGate({ family: "REV", side: 1, ret14: 0.24 }),
    { accepted: true, reason: "V4_IMPROVEMENT_GATE_PASS" },
);
assert.deepEqual(
    evaluateQuality102CausalV4ImprovementGate({ family: "REV", side: -1, ret14: -0.9 }),
    { accepted: true, reason: "V4_IMPROVEMENT_GATE_PASS" },
);
assert.deepEqual(
    evaluateQuality102CausalV4ImprovementGate({ family: "MR", side: 1, ret14: -0.9 }),
    { accepted: true, reason: "V4_IMPROVEMENT_GATE_PASS" },
);

// One-slot routing is deterministic and respects S1 > S2 > S3 > S4 at equal entry time.
const routed = routeQuality102OneSlot([
    { id: "s4", entryTs: 100, exitTs: 130, layer: "S4" },
    { id: "s2", entryTs: 100, exitTs: 120, layer: "S2" },
    { id: "s3", entryTs: 100, exitTs: 125, layer: "S3" },
    { id: "s1", entryTs: 100, exitTs: 110, layer: "S1" },
    { id: "occupied", entryTs: 105, exitTs: 115, layer: "S1" },
    { id: "next", entryTs: 110, exitTs: 140, layer: "S4" },
]);
assert.deepEqual(routed.accepted.map((x) => x.id), ["s1", "next"]);
assert.deepEqual(routed.blocked.map((x) => x.id), ["s2", "s3", "s4", "occupied"]);
assert.ok(routed.blocked.every((x) => x.blockedReason === "ONE_SLOT_OCCUPIED"));

// Strict risk contract must not drift while adding causal selector plumbing.
assert.equal(STRICT_BT33404708902.quality102PositionCap, 0.5);
assert.equal(STRICT_BT33404708902.cryptoGrossCap, 2);
assert.equal(STRICT_BT33404708902.totalGrossCap, 2.5);
assert.equal(STRICT_BT33404708902.quality102LiveSelectorParity, false);
assert.equal(STRICT_BT33404708902.quality102LiveBlockedFailClosed, true);

console.log("QUALITY102_CAUSAL_SELECTOR_SELFTEST_PASS", JSON.stringify({
    s1s2RawGeneratorProven: getS1S2RawGeneratorStatus().proven,
    s34RawGeneratorProven: getS34RawGeneratorStatus().proven,
    selectorImplemented: QUALITY102_CAUSAL_CAPABILITIES.selectorImplemented,
    quality102LiveArmed: false,
    quality102PositionCap: STRICT_BT33404708902.quality102PositionCap,
    cryptoGrossCap: STRICT_BT33404708902.cryptoGrossCap,
    totalGrossCap: STRICT_BT33404708902.totalGrossCap,
}));
