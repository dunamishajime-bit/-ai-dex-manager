import assert from "node:assert/strict";
import test from "node:test";

import { assertFixtureIdentity, FIXTURE_HASH } from "../lib/backtest/dd-reduction/fixture-identity";
import {
    buildLegacyMappingReport,
    lifecycleFields,
    mapLegacyStrategy,
    normalizeLegacyProtectionEvidence,
    parseFiveMinuteCsv,
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

test("legacy lifecycle normalization rejects missing required fill fields", () => {
    assert.throws(
        () => lifecycleFields({ strategy_id: "V12", side: "SHORT", candidate_id: "missing-price", candidate_requested_gross: 1, accepted_gross: 1, entry_ts_ms: 1, quantity: 1, entry_fee: 0 }, "source", "config", "", true),
        /LEGACY_LIFECYCLE_FIELD_UNRESOLVED: entryPrice/,
    );
    assert.throws(
        () => lifecycleFields({ strategy_id: "V12", side: "UNKNOWN", candidate_id: "bad-side" }, "source", "config", "", false),
        /LEGACY_LIFECYCLE_FIELD_UNRESOLVED: side=/,
    );
    assert.throws(
        () => lifecycleFields({ strategy_id: "V12", side: "LONG", candidate_id: "missing-exit-fee", candidate_requested_gross: 1, accepted_gross: 1, entry_ts_ms: 1, entry_price: 100, quantity: 1, entry_fee: 0, exit_ts_ms: 2, exit_price: 101, total_pnl_jpy: 1 }, "source", "config", "", true, true),
        /LEGACY_LIFECYCLE_FIELD_UNRESOLVED: exitFee/,
    );
});

test("legacy accepted candidate omits an unproven exit instead of inventing fees or pnl", () => {
    const normalized = lifecycleFields({
        strategy_id: "V12", side: "LONG", candidate_id: "candidate-without-close-proof", candidate_requested_gross: 1, accepted_gross: 1,
        entry_ts_ms: 1, entry_price: 100, quantity: 1, modeled_entry_fee_settlement: 0.1,
        candidate_exit_ts_ms: 2, candidate_exit_price_usd: 101, candidate_exit_reason: "MODELED_EXIT",
    }, "source", "config", "", true);
    assert.equal(normalized.exit, null);
    assert.equal((normalized.reconstructionAssumptions as { exitLifecycle: string }).exitLifecycle, "UNAVAILABLE_EXIT_OMITTED");
    assert.equal(normalized.fee, 0.1);
});

test("legacy five-minute parser rejects duplicates and incomplete hours", () => {
    const duplicate = "1754784000000,1,1,1,1,1\n1754784000000,1,1,1,1,1\n";
    assert.throws(() => parseFiveMinuteCsv(duplicate, 1754784000000, 1754787600000), /duplicate legacy five-minute bar/);
    const incomplete = Array.from({ length: 11 }, (_, index) => `${1754784000000 + index * 300000},1,1,1,1,1`).join("\n");
    const parsed = parseFiveMinuteCsv(incomplete, 1754784000000, 1754787600000);
    assert.equal(parsed.rowsPerHour.get(1754784000000), 11);
});
