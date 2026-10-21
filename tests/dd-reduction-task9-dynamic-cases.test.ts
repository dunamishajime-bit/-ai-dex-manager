import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
    TASK9_DYNAMIC_CASES,
    TASK9_SOURCE_BACKED_CASE,
    parseTask9DynamicArgs,
    buildCaseReplayEvents,
    runTask9Dynamic,
} from "../scripts/dd-reduction/run-task9-dynamic";
import { buildTask9DynamicReport } from "../scripts/dd-reduction/build-task9-dynamic-report";
import type { CandidateSourceRecord } from "../lib/backtest/dd-reduction/dynamic-types";
import { assertFixtureIdentity, FIXTURE_HASH } from "../lib/backtest/dd-reduction/fixture-identity";

assertFixtureIdentity(
    { sourceHash: FIXTURE_HASH, productionSha: FIXTURE_HASH, configHash: FIXTURE_HASH, policyHash: FIXTURE_HASH, resultHash: FIXTURE_HASH },
    ["sourceHash", "productionSha", "configHash", "policyHash", "resultHash"],
    "task9.dynamic-cases",
);

const SOURCE_SHA = "b".repeat(64);
const START = 1_750_000_000_000;
const OOS_START = Date.parse("2026-01-15T00:00:00.000Z");
const HOLDOUT_START = Date.parse("2026-06-01T00:00:00.000Z");

function row(candidateId: string, overrides: Record<string, unknown> = {}) {
    return {
        candidate_id: candidateId,
        event_id: `${candidateId}:decision`,
        strategy_id: "V12",
        symbol: "BTCUSDT",
        side: "SHORT",
        signal_ts_ms: START,
        decision_ts_ms: START,
        event_seq: 1,
        rank: 1,
        priority: 1,
        validity: "VALID",
        entry_valid_until_ms: START + 86_400_000,
        requested_gross: 100,
        worst_case_gross: 100,
        entry_price: 100,
        quantity: 1,
        asset_class: "CRYPTO",
        source_sha: SOURCE_SHA,
        candidate_status: "ACCEPTED",
        planned_exit: {
            fill: { timestamp_ms: START + 1, price: 100, evidence_id: `${candidateId}:fill` },
            original_exit: { timestamp_ms: START + 3_600_000, price: 100, settlement_pnl: 10 },
            adverse_stop: { triggered: true, timestamp_ms: START + 7_200_000, price: 102, settlement_pnl: -2 },
        },
        ...overrides,
    };
}

function source(rows: readonly Record<string, unknown>[]): CandidateSourceRecord {
    return {
        kind: "STRATEGY_ADAPTER",
        path: "fixture://task9-dynamic-cases.jsonl",
        sourceSha256: SOURCE_SHA,
        sourceBytes: 4096,
        evidence: "CAUSALLY_REGENERATED",
        rows,
    };
}

async function withOutput<T>(fn: (outputDir: string) => Promise<T>): Promise<T> {
    const outputDir = await mkdtemp(join(tmpdir(), "dd-task9-dynamic-"));
    try {
        return await fn(outputDir);
    } finally {
        await rm(outputDir, { recursive: true, force: true });
    }
}

function completeFixture() {
    return source([
        row("accepted-filled", { event_seq: 1 }),
        row("rejected-candidate", { event_seq: 2, candidate_status: "REJECTED" }),
        row("unfilled-candidate", { event_seq: 3, planned_exit: null }),
    ]);
}

test("Task 9 V12 SHORT policies are unique and preserve the named candidates", () => {
    const names = TASK9_DYNAMIC_CASES.map((item) => item.name);
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual(names, ["BASELINE", "A", "B", "C", "A_PLUS_C", "B_PLUS_C", "A_PLUS_B", "BEST_QUALIFIED"]);
    assert.equal(TASK9_DYNAMIC_CASES.find((item) => item.name === "A")?.candidateId, "V12_SHORT_PCT2P0_12H_MFE1P0_R12");
    assert.equal(TASK9_DYNAMIC_CASES.find((item) => item.name === "B")?.candidateId, "V12_SHORT_PCT2P0_6H_MFE0P5_R6");
    assert.equal(TASK9_DYNAMIC_CASES.find((item) => item.name === "C")?.candidateId, "V12_SHORT_COMPOSITE_ATR1P5_6H_MFE0P5_STRUCTURE3_R12");
});

test("shared V12 SHORT 2.5% rule is opt-in and uses the same canonical policy as the source-backed 5m engine", () => {
    assert.equal(TASK9_SOURCE_BACKED_CASE.name, "SOURCE_BACKED_V12_SHORT_2P5");
    assert.equal(TASK9_SOURCE_BACKED_CASE.candidateId, "V12_SHORT_PCT2P5_12H_MFE1P0_R12");
    assert.deepEqual(TASK9_SOURCE_BACKED_CASE.overlayRules, [{
        candidateId: "V12_SHORT_PCT2P5_12H_MFE1P0_R12",
        stopPct: 0.025,
        armHours: 12,
        mfeGatePct: 0.01,
        reentryHours: 12,
    }]);
    const args = parseTask9DynamicArgs([
        "--source", "some-source.jsonl", "--source-kind", "RAW_CANDIDATE_DECISIONS",
        "--case", "SOURCE_BACKED_V12_SHORT_2P5", "--cost-bps", "10",
    ]);
    assert.deepEqual(args.cases, ["SOURCE_BACKED_V12_SHORT_2P5"]);
    assert.deepEqual(args.costs, [10]);
    assert.equal(TASK9_DYNAMIC_CASES.some((item) => item.name === TASK9_SOURCE_BACKED_CASE.name), false);
});

test("overlay event construction is causal and cannot target rejected or unfilled candidates", () => {
    const events = buildCaseReplayEvents(completeFixture().rows, TASK9_DYNAMIC_CASES.find((item) => item.name === "A")!, 10);
    const stopEvents = events.filter((event) => event.kind === "PROTECTION_STOP");
    assert.equal(stopEvents.length, 1);
    assert.equal(stopEvents[0]?.reservation_id, "reservation:accepted-filled:1750000000000");
    assert.equal(new Set(events.filter((event) => event.kind === "PROTECTION_STOP").map((event) => event.reservation_id)).size, 1);
    assert.equal(events.some((event) => event.event_id.includes("rejected-candidate") && event.kind === "PROTECTION_STOP"), false);
    assert.equal(events.some((event) => event.event_id.includes("unfilled-candidate") && event.kind === "PROTECTION_STOP"), false);
});

test("quantity and asset class must be source-backed before reaching the allocator", () => {
    const policy = TASK9_DYNAMIC_CASES.find((item) => item.name === "BASELINE")!;
    assert.equal(buildCaseReplayEvents([row("missing-quantity", { quantity: null })], policy, 10).length, 0);
    assert.equal(buildCaseReplayEvents([row("missing-class", { asset_class: null })], policy, 10).length, 0);
    assert.equal(buildCaseReplayEvents([row("bad-quantity", { quantity: Number.NaN })], policy, 10).length, 0);
    assert.ok(buildCaseReplayEvents([row("ready")], policy, 10).length > 0);
});

test("dynamic cases classify original winner, loser, and unknown STOP outcomes without double STOP", async () => {
    await withOutput(async (outputDir) => {
        const result = await runTask9Dynamic({ outputDir, sourceRecords: [source([
            row("winner", { event_seq: 1 }),
            row("loser", { event_seq: 2, symbol: "ETHUSDT", planned_exit: { fill: { timestamp_ms: START + 1, price: 100, evidence_id: "loser:fill" }, original_exit: { timestamp_ms: START + 3_600_000, price: 100, settlement_pnl: -10 }, adverse_stop: { triggered: true, timestamp_ms: START + 7_200_000, price: 102, settlement_pnl: -2 } } }),
            row("unknown", { event_seq: 3, symbol: "SOLUSDT", planned_exit: { fill: { timestamp_ms: START + 1, price: 100, evidence_id: "unknown:fill" }, original_exit: { timestamp_ms: START + 3_600_000, price: 100, settlement_pnl: null }, adverse_stop: { triggered: true, timestamp_ms: START + 7_200_000, price: 102, settlement_pnl: -2 } } }),
        ])], cases: ["A"], costs: [10], marketData: [
            { timestamp_ms: START + 7_200_000, symbol: "BTCUSDT", price: 102, fx_rate: 1, timeframe: "H1" },
            { timestamp_ms: START + 7_200_000, symbol: "ETHUSDT", price: 102, fx_rate: 1, timeframe: "H1" },
            { timestamp_ms: START + 7_200_000, symbol: "SOLUSDT", price: 102, fx_rate: 1, timeframe: "H1" },
        ] });
        const caseResult = result.cases[0]!;
        assert.deepEqual(caseResult.stopEvents.map((event) => event.originalOutcome), ["WINNER", "LOSER", "UNKNOWN"]);
        assert.equal(caseResult.stopEvents.length, 3);
        // A three-row V12-only fixture is diagnostic, never a formal eight-strategy economic BT.
        assert.equal(caseResult.classification, "BLOCKED_INCOMPLETE_SOURCE_COVERAGE");
        assert.equal(caseResult.economicMetrics, null);
        assert.equal(caseResult.economicAcceptanceEligible, false);
    });
});

test("cooldown and released gross are reported from the reducer lifecycle", async () => {
    await withOutput(async (outputDir) => {
        const later = row("later-entry", { event_seq: 2, decision_ts_ms: START + 7_201_000, signal_ts_ms: START + 7_201_000, entry_valid_until_ms: START + 86_401_000, planned_exit: null });
        const result = await runTask9Dynamic({ outputDir, sourceRecords: [source([row("first", { event_seq: 1 }), later])], cases: ["A"], costs: [10] });
        const item = result.cases[0]!;
        assert.equal(item.lifecycleAudit.cooldownExclusions, 1);
        assert.equal(item.lifecycleAudit.grossReadmissions, 0);
        assert.equal(item.lifecycleAudit.dynamicLotObservations >= 1, true);
    });
});

test("OOS and Holdout metrics are independent and do not feed candidate selection state across splits", async () => {
    await withOutput(async (outputDir) => {
        const result = await runTask9Dynamic({ outputDir, sourceRecords: [source([
            row("is-candidate", { event_seq: 1, data_split: "IS" }),
            row("oos-candidate", { event_seq: 2, data_split: "OOS", decision_ts_ms: OOS_START, signal_ts_ms: OOS_START, entry_valid_until_ms: OOS_START + 86_400_000, planned_exit: null }),
            row("holdout-candidate", { event_seq: 3, data_split: "HOLDOUT", decision_ts_ms: HOLDOUT_START, signal_ts_ms: HOLDOUT_START, entry_valid_until_ms: HOLDOUT_START + 86_400_000, planned_exit: null }),
        ])], cases: ["BASELINE"], costs: [10] });
        const caseResult = result.cases[0]!;
        assert.equal(caseResult.splits.OOS.selectionStateLeaked, false);
        assert.equal(caseResult.splits.HOLDOUT.selectionStateLeaked, false);
        assert.equal(caseResult.splits.OOS.eventCount > 0, true);
        assert.equal(caseResult.splits.HOLDOUT.eventCount > 0, true);
    });
});

test("zero replayable rows fail closed for every case and never become economic BT metrics", async () => {
    await withOutput(async (outputDir) => {
        const incomplete = source([{ candidate_id: "missing-canonical-fields", strategy_id: "V12", symbol: "BTCUSDT", decision_ts_ms: START, candidate_status: "ACCEPTED" }]);
        const result = await runTask9Dynamic({ outputDir, sourceRecords: [incomplete], costs: [10, 30] });
        assert.equal(result.cases.length, 16);
        for (const item of result.cases) {
            assert.equal(item.classification, "BLOCKED_INCOMPLETE_SOURCE_COVERAGE");
            assert.equal(item.economicAcceptanceEligible, false);
            assert.equal(item.economicMetrics, null);
            assert.equal(item.diagnosticMetrics.finalEquityJpy, 10_000);
            assert.equal(item.diagnosticMetrics.tradeCount, 0);
        }
    });
});

test("one valid candidate never launders an incomplete eight-strategy source into economic metrics", async () => {
    await withOutput(async (outputDir) => {
        const strategies = ["V12", "Q102", "PENGU", "FET", "RESIDUAL", "IDLE", "V52", "HYPE_LONG"];
        const rows = strategies.map((strategy, i) => row(`candidate-${i}`, {
            strategy_id: strategy, event_seq: i + 1, symbol: `ASSET${i}USDT`,
        }));
        rows.push(row("missing-price", { strategy_id: "V12", event_seq: 99, entry_price: null }));
        const result = await runTask9Dynamic({
            outputDir, sourceRecords: [source(rows)], costs: [10], cases: ["BASELINE"],
            marketData: [{ timestamp_ms: START, symbol: "BTCUSDT", price: 100, fx_rate: 1, timeframe: "H1" }],
        });
        const item = result.cases[0]!;
        assert.ok(item.sourceCoverage.replayableRows > 0);
        assert.equal(item.sourceCoverage.status, "INCOMPLETE");
        assert.ok(item.sourceCoverage.reasons.some((reason) => reason.includes("partial actionable replay coverage")));
        assert.equal(item.classification, "BLOCKED_INCOMPLETE_SOURCE_COVERAGE");
        assert.equal(item.economicMetrics, null);
        assert.equal(result.cumulativeGate.economicAcceptanceEligible, false);
    });
});

test("nonempty prices without MTM replay cannot be misreported as zero drawdown", async () => {
    await withOutput(async (outputDir) => {
        const strategies = ["V12", "Q102", "PENGU", "FET", "RESIDUAL", "IDLE", "V52", "HYPE_LONG"];
        const rows = strategies.flatMap((strategy, index) => [
            row(`is-${index}`, { strategy_id: strategy, event_seq: index + 1, planned_exit: null, data_split: "IS" }),
            row(`oos-${index}`, { strategy_id: strategy, event_seq: index + 1, planned_exit: null,
                data_split: "OOS", decision_ts_ms: OOS_START, signal_ts_ms: OOS_START, entry_valid_until_ms: OOS_START + 86_400_000 }),
            row(`holdout-${index}`, { strategy_id: strategy, event_seq: index + 1, planned_exit: null,
                data_split: "HOLDOUT", decision_ts_ms: HOLDOUT_START, signal_ts_ms: HOLDOUT_START, entry_valid_until_ms: HOLDOUT_START + 86_400_000 }),
        ]);
        const result = await runTask9Dynamic({
            outputDir, sourceRecords: [source(rows)], cases: ["BASELINE"], costs: [10],
            marketData: [{ timestamp_ms: START, symbol: "BTCUSDT", price: 100, fx_rate: 1, timeframe: "H1" }],
        });
        const item = result.cases[0]!;
        assert.equal(item.sourceCoverage.status, "COMPLETE");
        assert.equal(item.sourceCoverage.replayableRows, 24);
        assert.equal(item.classification, "BLOCKED_INCOMPLETE_SOURCE_COVERAGE");
        assert.equal(item.economicMetrics, null);
        assert.equal(item.economicAcceptanceEligible, false);
    });
});

test("source-backed preallocation exclusions are accounted separately from actionable rejected candidates", async () => {
    await withOutput(async (outputDir) => {
        const strategies = ["V12", "Q102", "PENGU", "FET", "RESIDUAL", "IDLE", "V52", "HYPE_LONG"];
        const ready = strategies.map((strategy, index) => row(`ready-${index}`, {
            strategy_id: strategy, event_seq: index + 1, symbol: `SYMBOL${index}USDT`,
            decision: "ACCEPTED_MODELED_ENTRY",
        }));
        const excluded = row("excluded-before-allocation", {
            strategy_id: "V52", event_seq: 100, decision: "EXCLUDED_PREALLOCATION",
            reason: "SINGLE_V50_SLOT_ALREADY_OPEN", candidate_status: "NOT_APPLICABLE",
            side: null, entry_price: null, quantity: null,
        });
        const result = await runTask9Dynamic({
            outputDir, sourceRecords: [source([...ready, excluded])],
            costs: [10], cases: ["BASELINE"],
        });
        assert.equal(result.sourceCoverage.observedRows, 9);
        assert.equal(result.sourceCoverage.replayableRows, 8);
        assert.equal(result.sourceCoverage.verifiedExcludedRows, 1);
        assert.equal(result.sourceCoverage.status, "COMPLETE");
        // The research scenario remains blocked because OOS/Holdout and MTM marks are unproven.
        assert.equal(result.cases[0]?.economicMetrics, null);
        const invalidExcluded = await runTask9Dynamic({
            outputDir: join(outputDir, "invalid-exclusion"),
            sourceRecords: [source([...ready, { ...excluded, reason: "" }])],
            costs: [10], cases: ["BASELINE"],
        });
        assert.equal(invalidExcluded.sourceCoverage.status, "INCOMPLETE");
        assert.equal(invalidExcluded.sourceCoverage.verifiedExcludedRows, 0);
        assert.equal(invalidExcluded.cases[0]?.economicMetrics, null);
        const rejected = await runTask9Dynamic({
            outputDir: join(outputDir, "rejected"),
            sourceRecords: [source([...ready, { ...excluded, decision: "REJECTED_PORTFOLIO", reason: "NO_GROSS_ROOM" }])],
            costs: [10], cases: ["BASELINE"],
        });
        assert.equal(rejected.sourceCoverage.status, "INCOMPLETE");
        assert.equal(rejected.sourceCoverage.verifiedExcludedRows, 0);
    });
});

test("Holdout outcomes do not enter the IS baseline accounting", async () => {
    await withOutput(async (outputDir) => {
        const holdout = row("holdout-winner", {
            symbol: "ETHUSDT", event_seq: 2,
            decision_ts_ms: HOLDOUT_START, signal_ts_ms: HOLDOUT_START,
            entry_valid_until_ms: HOLDOUT_START + 86_400_000,
            data_split: "HOLDOUT",
            planned_exit: {
                fill: { timestamp_ms: HOLDOUT_START + 1, price: 100, evidence_id: "holdout-fill" },
                original_exit: { timestamp_ms: HOLDOUT_START + 3_600_000, price: 120, settlement_pnl: 1000 },
            },
        });
        const isOnly = await runTask9Dynamic({
            outputDir: join(outputDir, "is-only"), sourceRecords: [source([row("is-one")])],
            cases: ["BASELINE"], costs: [10],
        });
        const mixed = await runTask9Dynamic({
            outputDir: join(outputDir, "with-holdout"), sourceRecords: [source([row("is-one"), holdout])],
            cases: ["BASELINE"], costs: [10],
        });
        assert.equal(mixed.cases[0]?.diagnosticMetrics.finalEquityJpy, isOnly.cases[0]?.diagnosticMetrics.finalEquityJpy);
        assert.equal(mixed.cases[0]?.diagnosticMetrics.tradeCount, isOnly.cases[0]?.diagnosticMetrics.tradeCount);
        assert.deepEqual(mixed.cases[0]?.ledgerHashes, isOnly.cases[0]?.ledgerHashes);
        assert.equal(mixed.cases[0]?.economicMetrics, null);
    });
});

test("repeated dynamic case runs are deterministic and carry the no-production marker", async () => {
    await withOutput(async (firstOutput) => {
        const first = await runTask9Dynamic({ outputDir: firstOutput, sourceRecords: [completeFixture()], verifyDeterminism: true });
        await withOutput(async (secondOutput) => {
            const second = await runTask9Dynamic({ outputDir: secondOutput, sourceRecords: [completeFixture()] });
            assert.deepEqual(first.hashes, second.hashes);
            assert.equal(first.productionChanges, 0);
            assert.equal(first.liveClaim, false);
        });
    });
});

test("reporter preserves blocked classifications and cumulative gate in compact output", async () => {
    await withOutput(async (outputDir) => {
        const run = await runTask9Dynamic({ outputDir, sourceRecords: [source([{ candidate_id: "missing", strategy_id: "V12", symbol: "BTCUSDT", decision_ts_ms: START }])] });
        const report = buildTask9DynamicReport(run);
        assert.equal(report.classification, "BLOCKED_INCOMPLETE_SOURCE_COVERAGE");
        assert.equal(report.economicAcceptanceEligible, false);
        assert.equal(report.cumulativeGate.status, "BLOCKED_INCOMPLETE_SOURCE_COVERAGE");
        assert.equal(report.cases.every((item) => item.classification === "BLOCKED_INCOMPLETE_SOURCE_COVERAGE"), true);
    });
});
