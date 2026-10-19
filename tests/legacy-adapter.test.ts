import assert from "node:assert/strict";
import test from "node:test";

import { assertFixtureIdentity, FIXTURE_HASH } from "../lib/backtest/dd-reduction/fixture-identity";
import {
    buildLegacyMappingReport,
    mapLegacyStrategy,
    normalizeLegacyProtectionEvidence,
} from "../scripts/dd-reduction/legacy-adapter";

test("legacy strategy mapping preserves unsupported residual logic as unresolved", () => {
    assertFixtureIdentity({ sourceHash: FIXTURE_HASH }, ["sourceHash"], "legacy-adapter-fixture");
    assert.deepEqual(mapLegacyStrategy("V12"), { current: "V12_V4", status: "MAPPED_NON_CANONICAL" });
    assert.deepEqual(mapLegacyStrategy("RESIDUAL"), { current: null, status: "UNREPRESENTED_CURRENT_STRATEGY" });
    assert.deepEqual(mapLegacyStrategy("unknown"), { current: null, status: "UNKNOWN_LEGACY_STRATEGY" });
});

test("legacy protection evidence fails closed when current fields are not exact", () => {
    const evidence = normalizeLegacyProtectionEvidence({
        oldV12Hybrid: { profitArmBps: 250, givebackBps: 150, reversalThresholdBps: 200, btcOppositeThresholdBps: 100 },
        currentFields: {},
    });
    assert.equal(evidence.status, "PROTECTION_FIELDS_UNRESOLVED");
    assert.deepEqual(evidence.unresolvedFields, ["initialStopBps", "profitFloorBps", "trailingGivebackBps", "timeStopBars"]);
    assert.equal(evidence.knownLegacyFields.profitArmBps, 250);
});

test("legacy protection evidence treats null policy fields as unresolved", () => {
    const evidence = normalizeLegacyProtectionEvidence({
        oldV12Hybrid: {},
        currentFields: {
            initialStopBps: null,
            profitFloorBps: null,
            trailingGivebackBps: null,
            timeStopBars: null,
        },
    });
    assert.deepEqual(evidence.unresolvedFields, ["initialStopBps", "profitFloorBps", "trailingGivebackBps", "timeStopBars"]);
});

test("mapping report carries the explicit non-canonical classification", () => {
    const report = buildLegacyMappingReport({
        strategyIds: ["V12", "PENGU", "RESIDUAL"],
        sourceRuntimeSha: "legacy-runtime",
        scenarioId: "PRICE_MODEL_10BPS",
        modelStatus: "COMPLETE_H1_PRICE_MODEL_NOT_L2_VERIFIED",
    });
    assert.equal(report.classification, "LEGACY_NON_CANONICAL_RECONSTRUCTION");
    assert.equal(report.strategyMappings.RESIDUAL.status, "UNREPRESENTED_CURRENT_STRATEGY");
    assert.equal(report.protection.status, "PROTECTION_FIELDS_UNRESOLVED");
});
