import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
        assert.equal(first.manifestHash, second.manifestHash);
        assert.equal(first.costBps, 10);
        assert.equal(first.formalParity, false);
        assert.equal(first.economicBacktest, false);
    });
});
