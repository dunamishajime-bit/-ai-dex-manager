import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { rebuildNoncanonicalBaseline } from "../scripts/dd-reduction/rebuild-noncanonical-baseline";
import { assertFixtureIdentity, FIXTURE_HASH } from "../lib/backtest/dd-reduction/fixture-identity";

function assertSourceRecoveryFixtureIdentity(): void {
    assertFixtureIdentity({
        sourceHash: FIXTURE_HASH,
        productionSha: FIXTURE_HASH,
        configHash: FIXTURE_HASH,
        policyHash: FIXTURE_HASH,
        resultHash: FIXTURE_HASH,
    }, ["sourceHash", "productionSha", "configHash", "policyHash", "resultHash"], "source-recovery.fixture");
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "dd-source-recovery-"));
    try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("classifies preserved fields as original and allocator gaps as unverifiable", async () => {
    assertSourceRecoveryFixtureIdentity();
    await withTemp(async (dir) => {
        const source = join(dir, "candidate-decisions.jsonl");
        await writeFile(source, `${JSON.stringify({
            candidate_id: "C1",
            strategy_id: "V12",
            symbol: "BTCUSDT",
            side: "SHORT",
            decision: "ACCEPTED_MODELED_ENTRY",
            decision_ts_ms: 1_000,
            signal_ts_ms: 1_000,
            candidate_entry_price_usd: 100,
            requested_gross: 0.3,
            modeled_entry_quantity: 3,
            accepted_gross: 0.3,
            rank: 1,
        })}\n`, "utf8");
        const report = await rebuildNoncanonicalBaseline(source, join(dir, "out"), 10);
        assert.equal(report.observedRows, 1);
        assert.equal(report.replayReadyRows, 0);
        assert.equal(report.formalParity, false);
        const row = JSON.parse((await readFile(join(dir, "out", "reconstructed-candidate-ledger.jsonl"), "utf8")).trim()) as { fields: Record<string, { status: string }>; replayBlockers: string[] };
        assert.equal(row.fields.entryPrice?.status, "ORIGINAL_EVIDENCE");
        assert.equal(row.fields.quantity?.status, "ORIGINAL_EVIDENCE");
        assert.equal(row.fields.entryValidUntilMs?.status, "UNVERIFIABLE");
        assert.ok(row.replayBlockers.includes("entryValidUntilMs:UNVERIFIABLE"));
    });
});

test("does not manufacture rejected-row quantity or equity", async () => {
    await withTemp(async (dir) => {
        const source = join(dir, "candidate-decisions.jsonl");
        await writeFile(source, `${JSON.stringify({
            candidate_id: "C2",
            strategy_id: "Q102",
            symbol: "ETHUSDT",
            decision: "REJECTED_PORTFOLIO",
            decision_ts_ms: 2_000,
            requested_gross: 2.5,
            candidate_entry_price_usd: 2_000,
            reason: "NO_GROSS_ROOM",
        })}\n`, "utf8");
        const report = await rebuildNoncanonicalBaseline(source, join(dir, "out"), 30);
        assert.equal(report.replayReadyRows, 0);
        const row = JSON.parse((await readFile(join(dir, "out", "reconstructed-candidate-ledger.jsonl"), "utf8")).trim()) as { fields: Record<string, { status: string; value: unknown }>; };
        assert.equal(row.fields.quantity?.status, "UNVERIFIABLE");
        assert.equal(row.fields.quantity?.value, null);
        assert.equal(row.fields.entryEquitySettlement?.status, "MISSING");
        assert.equal(row.fields.side?.status, "MISSING");
    });
});

test("repeated reconstruction is deterministic and keeps cost scenario metadata separate", async () => {
    await withTemp(async (dir) => {
        const source = join(dir, "candidate-decisions.jsonl");
        await writeFile(source, `${JSON.stringify({ candidate_id: "C3", strategy_id: "IDLE", symbol: "DOTUSDT", side: "SHORT", decision_ts_ms: 3_000, requested_gross: 0.25, candidate_entry_price_usd: 1 })}\n`, "utf8");
        const first = await rebuildNoncanonicalBaseline(source, join(dir, "first"), 10);
        const second = await rebuildNoncanonicalBaseline(source, join(dir, "second"), 10);
        assert.equal(first.reportPayloadHash, second.reportPayloadHash);
        assert.equal(first.canonicalOutputSha256, second.canonicalOutputSha256);
        assert.equal(first.costBps, 10);
        assert.equal(first.formalParity, false);
        assert.equal(first.economicBacktest, false);
    });
});

function completeReplayCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        candidate_id: "READY-1",
        strategy_id: "V12",
        symbol: "BTCUSDT",
        side: "LONG",
        decision: "ACCEPTED_MODELED_ENTRY",
        decision_ts_ms: 1_000,
        candidate_entry_price_usd: 100,
        requested_gross: 0.3,
        modeled_entry_quantity: 3,
        validity: "VALID",
        entry_valid_until_ms: 2_000,
        priority: 1,
        asset_class: "CRYPTO",
        evidence_level: "ORIGINAL_EVIDENCE",
        evidence_source_kind: "RAW_CANDIDATE_DECISIONS",
        evidence_source_path: "candidate-decisions.jsonl",
        evidence_source_sha256: "a".repeat(64),
        evidence_row_number: 1,
        evidence_source_bytes: 100,
        source_sha: "a".repeat(64),
        ...overrides,
    };
}

test("requires allocator validity, usable provenance, and positive domains before replayReady", async () => {
    await withTemp(async (dir) => {
        const source = join(dir, "candidate-decisions.jsonl");
        await writeFile(source, `${JSON.stringify(completeReplayCandidate({ side: "SIDEWAYS", requested_gross: 0 }))}\n`, "utf8");
        const report = await rebuildNoncanonicalBaseline(source, join(dir, "out"), 10);
        assert.equal(report.replayReadyRows, 0);
        const row = JSON.parse((await readFile(join(dir, "out", "reconstructed-candidate-ledger.jsonl"), "utf8")).trim()) as { replayBlockers: string[] };
        assert.ok(row.replayBlockers.some((blocker) => blocker.includes("side:INVALID")));
        assert.ok(row.replayBlockers.some((blocker) => blocker.includes("requestedGross:INVALID")));
    });
});

test("fails closed for duplicate IDs, unknown decisions/strategies, and incomplete eight-strategy coverage", async () => {
    await withTemp(async (dir) => {
        const source = join(dir, "candidate-decisions.jsonl");
        await writeFile(source, [
            JSON.stringify(completeReplayCandidate()),
            JSON.stringify(completeReplayCandidate({ strategy_id: "UNKNOWN", decision: "UNKNOWN_DECISION" })),
            JSON.stringify(completeReplayCandidate()),
        ].join("\n") + "\n", "utf8");
        const report = await rebuildNoncanonicalBaseline(source, join(dir, "out"), 10);
        assert.equal(report.sourceValidation.valid, false);
        assert.equal(report.replayReadyRows, 0);
        assert.ok(report.sourceValidation.blockers.some((blocker) => blocker.startsWith("DUPLICATE_CANDIDATE_ID:")));
        assert.ok(report.sourceValidation.blockers.includes("UNKNOWN_DECISION:UNKNOWN_DECISION"));
        assert.ok(report.sourceValidation.blockers.includes("UNKNOWN_STRATEGY:UNKNOWN"));
        assert.ok(report.sourceValidation.blockers.some((blocker) => blocker.startsWith("MISSING_STRATEGY_COVERAGE:")));
    });
});

test("canonical hashes do not depend on the absolute source path", async () => {
    await withTemp(async (dir) => {
        const sourceBytes = `${JSON.stringify({ candidate_id: "C-PATH", strategy_id: "IDLE", symbol: "DOTUSDT", side: "SHORT", decision: "REJECTED_PORTFOLIO", decision_ts_ms: 3_000, requested_gross: 0.25, candidate_entry_price_usd: 1 })}\n`;
        const sourceA = join(dir, "a", "candidate-decisions.jsonl");
        const sourceB = join(dir, "b", "candidate-decisions.jsonl");
        await mkdir(join(dir, "a"), { recursive: true });
        await mkdir(join(dir, "b"), { recursive: true });
        await writeFile(sourceA, sourceBytes, "utf8");
        await writeFile(sourceB, sourceBytes, "utf8");
        const first = await rebuildNoncanonicalBaseline(sourceA, join(dir, "out-a"), 10);
        const second = await rebuildNoncanonicalBaseline(sourceB, join(dir, "out-b"), 10);
        assert.equal(first.reportPayloadHash, second.reportPayloadHash);
        assert.equal(first.canonicalOutputSha256, second.canonicalOutputSha256);
        assert.notEqual(first.displayOutputSha256, second.displayOutputSha256);
        assert.equal(first.manifestFileSha256, JSON.parse(await readFile(join(dir, "out-a", "source-recovery-integrity.json"), "utf8")).manifestFileSha256);
    });
});

test("workflow watches source-recovery artifact changes", async () => {
    const workflow = await readFile(join(process.cwd(), ".github", "workflows", "task9-dynamic-integrated-bt.yml"), "utf8");
    assert.match(workflow, /docs\/research\/results\/dd-reduction-source-recovery-noncanonical-20261021\/\*\*/);
});
