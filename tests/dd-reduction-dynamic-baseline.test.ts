import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
    parseDynamicRunnerArgs,
    runDynamicBaseline,
    runDynamicCli,
    type DynamicBaselineRun,
} from "../scripts/dd-reduction/run-dynamic";
import {
    compareDynamicBaseline,
    compareDynamicBaselineFiles,
    DEFAULT_BASELINE_ANCHORS,
} from "../scripts/dd-reduction/compare-dynamic-baseline";
import type { CandidateSourceRecord } from "../lib/backtest/dd-reduction/dynamic-types";
import { assertFixtureIdentity, FIXTURE_HASH } from "../lib/backtest/dd-reduction/fixture-identity";

const sourceSha = "a".repeat(64);
const fixturePath = "fixture://dynamic-baseline.jsonl";
const fixtureTimestamp = 1_750_000_000_000;

function fixtureRecord(): CandidateSourceRecord {
    return {
        kind: "STRATEGY_ADAPTER",
        path: fixturePath,
        sourceSha256: sourceSha,
        sourceBytes: 512,
        evidence: "CAUSALLY_REGENERATED",
        rows: [{
            candidate_id: "fixture-candidate-1",
            strategy_id: "V12",
            symbol: "BTCUSDT",
            side: "LONG",
            signal_ts_ms: fixtureTimestamp,
            decision_ts_ms: fixtureTimestamp,
            event_seq: 1,
            rank: 1,
            priority: 1,
            validity: "VALID",
            entry_valid_until_ms: fixtureTimestamp + 3_600_000,
            requested_gross: 1,
            worst_case_gross: 1,
            entry_price: 100,
            source_sha: sourceSha,
            candidate_status: "ACCEPTED",
        }],
    };
}

async function withOutput<T>(fn: (outputDir: string) => Promise<T>): Promise<T> {
    const outputDir = await mkdtemp(join(tmpdir(), "dd-dynamic-baseline-"));
    try {
        return await fn(outputDir);
    } finally {
        await rm(outputDir, { recursive: true, force: true });
    }
}

function baseOptions(outputDir: string) {
    return {
        caseName: "baseline" as const,
        costBps: 10 as const,
        outputDir,
        sourceRecords: [fixtureRecord()],
    };
}

test("dynamic baseline fixture identity is explicit", () => {
    assertFixtureIdentity({
        sourceHash: FIXTURE_HASH,
        productionSha: FIXTURE_HASH,
        configHash: FIXTURE_HASH,
        policyHash: FIXTURE_HASH,
        resultHash: FIXTURE_HASH,
    }, ["sourceHash", "productionSha", "configHash", "policyHash", "resultHash"], "dynamic-baseline-fixture");
});

test("identical dynamic baseline input produces identical replay and ledger hashes", async () => {
    await withOutput(async (firstOutput) => {
        const first = await runDynamicBaseline(baseOptions(firstOutput));
        await withOutput(async (secondOutput) => {
            const second = await runDynamicBaseline(baseOptions(secondOutput));
            assert.equal(first.hashes.result, second.hashes.result);
            assert.deepEqual(first.hashes.ledgers, second.hashes.ledgers);
            assert.equal(first.hashes.allocator, second.hashes.allocator);
            assert.equal(first.manifest.overlayPolicy, "NONE");
        });
    });
});

test("baseline CLI parses the requested cost and writes a manifest/result summary", async () => {
    await withOutput(async (outputDir) => {
        const sourceDir = await mkdtemp(join(tmpdir(), "dd-dynamic-source-"));
        try {
            const sourcePath = join(sourceDir, "fixture.jsonl");
            const fileRow = { ...fixtureRecord().rows[0] };
            delete fileRow.source_sha;
            await writeFile(sourcePath, `${JSON.stringify(fileRow)}\n`, "utf8");
            const args = parseDynamicRunnerArgs([
                "--case", "baseline",
                "--cost-bps", "30",
                "--output", outputDir,
                "--source", sourcePath,
                "--source-kind", "STRATEGY_ADAPTER",
            ]);
            assert.equal(args.caseName, "baseline");
            assert.equal(args.costBps, 30);
            const result = await runDynamicCli([
                "--case", "baseline",
                "--cost-bps", "30",
                "--output", outputDir,
                "--source", sourcePath,
                "--source-kind", "STRATEGY_ADAPTER",
            ]);
            assert.equal(result.manifest.costBps, 30);
            assert.equal(result.writtenFiles.includes(resolve(outputDir, "manifest.json")), true);
            assert.equal(result.writtenFiles.includes(resolve(outputDir, "result-summary.json")), true);
            const fileComparison = await compareDynamicBaselineFiles({ runPath: resolve(outputDir, "manifest.json"), costBps: 30 });
            assert.equal(fileComparison.parityClassification, "REBUILT_BASELINE");
        } finally {
            await rm(sourceDir, { recursive: true, force: true });
        }
    });
});

test("missing or ambiguously classified candidate sources fail closed", async () => {
    await withOutput(async (outputDir) => {
        await assert.rejects(
            runDynamicBaseline({ ...baseOptions(outputDir), sourceRecords: undefined, sourceSpecs: [] }),
            (error: unknown) => error instanceof Error && error.message.includes("SOURCE_MISSING"),
        );
        assert.throws(
            () => parseDynamicRunnerArgs([
                "--case", "baseline",
                "--cost-bps", "10",
                "--output", outputDir,
                "--source", "a.jsonl",
            ]),
            /AMBIGUOUS_SOURCE_CLASSIFICATION/,
        );
    });
});

test("baseline is explicitly overlay-free and rejects adverse-stop policy injection", async () => {
    await withOutput(async (outputDir) => {
        const result = await runDynamicBaseline(baseOptions(outputDir));
        assert.equal(result.manifest.overlayPolicy, "NONE");
        assert.equal(result.manifest.adverseStopRulesApplied, false);
        await assert.rejects(
            runDynamicBaseline({ ...baseOptions(outputDir), adverseStopRules: [{ id: "task9-stop" }] }),
            (error: unknown) => error instanceof Error && error.message.includes("BASELINE_OVERLAY_FORBIDDEN"),
        );
    });
});

test("large raw ledgers cannot be written inside the Git worktree", async () => {
    const outputDir = resolve(process.cwd(), ".tmp", "dd-dynamic-baseline-test");
    await assert.rejects(
        runDynamicBaseline(baseOptions(outputDir)),
        (error: unknown) => error instanceof Error && error.message.includes("OUTPUT_IN_REPOSITORY"),
    );
});

test("first-divergence comparison preserves event context and anchor limitations", async () => {
    const run = {
        manifest: { costBps: 10 },
        result: {
            final_equity_jpy: 10_000,
            jpy_profit_factor: null,
            trades: 0,
            mtm_drawdown_pct: 0,
            execution_ledger: [{
                event_id: "fixture-event-1",
                timestamp_ms: fixtureTimestamp,
                candidate_id: "fixture-candidate-1",
                strategy_id: "V12",
                symbol: "BTCUSDT",
                allocator_state_before: { total_gross: 0 },
                allocator_state_after: { total_gross: 1 },
                wallet_before_jpy: 10_000,
                wallet_after_jpy: 10_000,
                gross: 1,
                reason: null,
            }],
        },
    } as unknown as DynamicBaselineRun;
    const report = compareDynamicBaseline(run, DEFAULT_BASELINE_ANCHORS[10]);
    assert.equal(report.parityClassification, "REBUILT_BASELINE");
    assert.equal(report.firstDivergence?.event_id, "fixture-event-1");
    assert.equal(report.firstDivergence?.timestamp_ms, fixtureTimestamp);
    assert.equal(report.firstDivergence?.candidate_id, "fixture-candidate-1");
    assert.deepEqual(report.firstDivergence?.allocator_state_before, { total_gross: 0 });
});
