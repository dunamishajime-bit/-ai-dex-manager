import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
    buildCandidateSourceManifest,
    normalizeDynamicCandidates,
    type CandidateSourceRecord,
} from "../lib/backtest/dd-reduction/dynamic-source";
import {
    DYNAMIC_STRATEGY_IDS,
    EVIDENCE_LEVELS,
    type DynamicCandidateEvent,
} from "../lib/backtest/dd-reduction/dynamic-types";
import { classifyOrderingEvidence } from "../lib/backtest/dd-reduction/dynamic-ordering";
import { assertFixtureIdentity, FIXTURE_HASH } from "../lib/backtest/dd-reduction/fixture-identity";
import { buildCandidateCoverage } from "../scripts/dd-reduction/build-candidate-coverage";

const SOURCE_HASH = FIXTURE_HASH;
const TS = 1_700_000_000_000;

function assertDynamicFixtureIdentity(): void {
    assertFixtureIdentity(
        { sourceHash: FIXTURE_HASH, productionSha: FIXTURE_HASH, configHash: FIXTURE_HASH, policyHash: FIXTURE_HASH, resultHash: FIXTURE_HASH },
        ["sourceHash", "productionSha", "configHash", "policyHash", "resultHash"],
        "dynamic-source.fixture",
    );
}

function rawRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        candidateId: "candidate-1",
        strategy: "V12",
        ts: TS,
        symbol: "BTCUSDT",
        side: "LONG",
        price: 100,
        validity: "VALID",
        accepted: true,
        ...overrides,
    };
}

function rawRecord(rows: readonly Record<string, unknown>[], overrides: Partial<CandidateSourceRecord> = {}): CandidateSourceRecord {
    return {
        kind: "RAW_CANDIDATE_DECISIONS",
        path: "raw-candidate-decisions.jsonl",
        sourceSha256: SOURCE_HASH,
        sourceBytes: Buffer.byteLength(rows.map((row) => JSON.stringify(row)).join("\n"), "utf8"),
        evidence: "ORIGINAL_EVIDENCE",
        rows,
        ...overrides,
    };
}

test("exposes the eight dynamic strategies and exact evidence levels", () => {
    assertDynamicFixtureIdentity();
    assert.deepEqual(DYNAMIC_STRATEGY_IDS, ["V12", "Q102", "PENGU", "FET", "RESIDUAL", "IDLE", "V52", "HYPE_LONG"]);
    assert.deepEqual(EVIDENCE_LEVELS, ["ORIGINAL_EVIDENCE", "CAUSALLY_REGENERATED", "MISSING", "UNVERIFIABLE"]);
});

test("normalizes a raw candidate decision with original evidence", () => {
    const result = normalizeDynamicCandidates({ records: [rawRecord([rawRow()])] });
    assert.equal(result.events.length, 1);
    const event = result.events[0] as DynamicCandidateEvent;
    assert.equal(event.strategy, "V12");
    assert.equal(event.side, "LONG");
    assert.equal(event.price, 100);
    assert.equal(event.failClosed, false);
    assert.equal(event.evidence.level, "ORIGINAL_EVIDENCE");
    assert.equal(event.evidence.sourceKind, "RAW_CANDIDATE_DECISIONS");
});

test("emits the exact candidate event contract and keeps observed status separate from allocator acceptance", () => {
    const result = normalizeDynamicCandidates({
        records: [rawRecord([rawRow({
            event_id: "event-1",
            stage_id: "V12_SHORT",
            route: "short-entry",
            family: "V12_SHORT",
            signal_ts_ms: TS - 1_000,
            decision_ts_ms: TS,
            event_seq: 7,
            rank: 2,
            score: 0.8,
            priority: 9,
            status: "REJECTED",
            entry_valid_until_ms: TS + 60_000,
            requested_gross: 250,
            worst_case_gross: 275,
            entry_price: 100,
            entry_price_source: "SAVED_MARKET_DATA",
            planned_exit: { kind: "TIME_STOP", bars: 12 },
            source_sha: SOURCE_HASH,
            config_sha: "b".repeat(64),
            data_sha: "c".repeat(64),
            accepted: true,
        })])],
    });
    const event = result.events[0] as DynamicCandidateEvent;
    assert.equal(event.candidate_id, "candidate-1");
    assert.equal(event.event_id, "event-1");
    assert.equal(event.strategy_id, "V12");
    assert.equal(event.stage_id, "V12_SHORT");
    assert.equal(event.route, "short-entry");
    assert.equal(event.family, "V12_SHORT");
    assert.equal(event.signal_ts_ms, TS - 1_000);
    assert.equal(event.decision_ts_ms, TS);
    assert.equal(event.event_seq, 7);
    assert.equal(event.rank, 2);
    assert.equal(event.score, 0.8);
    assert.equal(event.priority, 9);
    assert.equal(event.candidate_status, "REJECTED");
    assert.equal(event.observed_status, "REJECTED");
    assert.equal(event.entry_valid_until_ms, TS + 60_000);
    assert.equal(event.requested_gross, 250);
    assert.equal(event.worst_case_gross, 275);
    assert.equal(event.entry_price, 100);
    assert.equal(event.entry_price_source, "SAVED_MARKET_DATA");
    assert.deepEqual(event.planned_exit, { kind: "TIME_STOP", bars: 12 });
    assert.equal(event.source_sha, SOURCE_HASH);
    assert.equal(event.config_sha, "b".repeat(64));
    assert.equal(event.data_sha, "c".repeat(64));
    assert.equal(event.evidence_level, "ORIGINAL_EVIDENCE");
    assert.equal(event.allocator_accepted, true);
    assert.equal(event.failClosed, false);
});

test("maps legacy snake_case and nested candidate fields without filling missing evidence", () => {
    const result = normalizeDynamicCandidates({
        records: [rawRecord([{
            candidate_id: "legacy-1",
            event_id: "legacy-event-1",
            strategy_id: "Q102",
            stage_id: "Q102_LONG",
            route: "legacy-route",
            family: "legacy-family",
            symbol: "ETHUSDT",
            side: "SHORT",
            timestamps: { signal_ts_ms: TS - 2_000, decision_ts_ms: TS, event_seq: 4 },
            ranking: { rank: 3, score: 0.4, priority: 6 },
            entry: { price: 200, price_source: "MARKET_CACHE" },
            gross: { requested_gross: 300, worst_case_gross: 330 },
            hashes: { source_sha: SOURCE_HASH, config_sha: "b".repeat(64), data_sha: "c".repeat(64) },
            validity: "VALID",
        }], { evidence: "CAUSALLY_REGENERATED" })],
    });
    const event = result.events[0] as DynamicCandidateEvent;
    assert.equal(event.candidateId, "legacy-1");
    assert.equal(event.strategy_id, "Q102");
    assert.equal(event.signal_ts_ms, TS - 2_000);
    assert.equal(event.decision_ts_ms, TS);
    assert.equal(event.event_seq, 4);
    assert.equal(event.entry_price, 200);
    assert.equal(event.requested_gross, 300);
    assert.equal(event.worst_case_gross, 330);
    assert.equal(event.source_sha, SOURCE_HASH);
    assert.equal(event.evidence_level, "CAUSALLY_REGENERATED");
    assert.equal(event.observed_status, "UNKNOWN");
    assert.equal(event.failClosed, false);
});

test("preserves MISSING evidence as explicit fail-closed provenance", () => {
    const result = normalizeDynamicCandidates({
        records: [rawRecord([rawRow({ candidateId: "missing-evidence" })], { evidence: "MISSING" })],
    });
    const event = result.events[0] as DynamicCandidateEvent;
    assert.equal(event.evidence_level, "MISSING");
    assert.equal(event.failClosed, true);
    assert.match(event.reason ?? "", /evidence level MISSING/i);
});

test("preserves nested MISSING and UNVERIFIABLE evidence for source-specific containers", () => {
    const nested = (kind: CandidateSourceRecord["kind"], evidence: "MISSING" | "UNVERIFIABLE", candidateId: string): CandidateSourceRecord => ({
        kind,
        path: `${kind.toLowerCase()}.json`,
        sourceSha256: SOURCE_HASH,
        sourceBytes: 1,
        evidence: "CAUSALLY_REGENERATED",
        rows: kind === "SAVED_MARKET_DATA"
            ? [{ candidate: { candidate_id: candidateId, strategy_id: "IDLE", symbol: "BTCUSDT", side: "LONG", price: 100, ts: TS, evidence_level: evidence, validity: "VALID" } }]
            : [{ signal: { candidate_id: candidateId, strategy_id: "V52", symbol: "BTCUSDT", side: "SHORT", price: 101, ts: TS, evidence_level: evidence, validity: "VALID" } }],
    });
    const result = normalizeDynamicCandidates({ records: [nested("SAVED_MARKET_DATA", "MISSING", "nested-missing"), nested("STRATEGY_ADAPTER", "UNVERIFIABLE", "nested-unverifiable")] });
    assert.equal(result.events[0]?.evidence_level, "MISSING");
    assert.equal(result.events[0]?.failClosed, true);
    assert.equal(result.events[1]?.evidence_level, "UNVERIFIABLE");
    assert.equal(result.events[1]?.failClosed, true);
});

test("fails closed with a source-specific identity error for every adapter kind", () => {
    const rows = [{ strategy: "V12", symbol: "BTCUSDT", side: "LONG", price: 100, ts: TS, validity: "VALID" }];
    for (const kind of ["RAW_CANDIDATE_DECISIONS", "SAVED_MARKET_DATA", "STRATEGY_ADAPTER"] as const) {
        const record: CandidateSourceRecord = { kind, path: `${kind}.json`, sourceSha256: SOURCE_HASH, sourceBytes: 1, evidence: "ORIGINAL_EVIDENCE", rows };
        assert.throws(() => normalizeDynamicCandidates({ records: [record] }), new RegExp(`INVALID_${kind}`));
    }
});

test("rejects a row source hash that diverges from the verified record file hash", () => {
    assert.throws(
        () => normalizeDynamicCandidates({ records: [rawRecord([rawRow({ source_sha: "d".repeat(64) })])] }),
        /SOURCE_HASH_MISMATCH/,
    );
});

test("marks a supplied negative or fractional event_seq fail-closed with an explicit sequence reason", () => {
    for (const eventSeq of [-1, 1.5, "2"]) {
        const result = normalizeDynamicCandidates({ records: [rawRecord([rawRow({ candidateId: `bad-seq-${String(eventSeq)}`, event_seq: eventSeq })])] });
        const event = result.events[0] as DynamicCandidateEvent;
        assert.equal(event.event_seq, null);
        assert.equal(event.failClosed, true);
        assert.match(event.reason ?? "", /malformed event_seq/i);
    }
});

test("keeps normalized valid event_seq values and exposes same-timestamp collisions as noncanonical", () => {
    const result = normalizeDynamicCandidates({
        records: [rawRecord([
            rawRow({ candidateId: "collision-a", event_seq: 9 }),
            rawRow({ candidateId: "collision-b", event_seq: 9 }),
        ])],
    });

    assert.deepEqual(result.events.map((event) => event.event_seq), [9, 9]);
    const evidence = classifyOrderingEvidence(result.events);
    assert.ok(evidence.reasons.includes("DUPLICATE_EVENT_SEQUENCE"));
    assert.equal(evidence.formalParityEligible, false);
});

test("rejects duplicate candidate IDs instead of silently merging observations", () => {
    assert.throws(
        () => normalizeDynamicCandidates({ records: [rawRecord([rawRow(), rawRow({ ts: TS + 1 })])] }),
        /DUPLICATE_CANDIDATE_ID/,
    );
});

test("keeps missing side, price, and validity fail-closed with reasons", () => {
    const result = normalizeDynamicCandidates({
        records: [rawRecord([rawRow({ candidateId: "missing-fields", side: undefined, price: undefined, validity: undefined })])],
    });
    const event = result.events[0] as DynamicCandidateEvent;
    assert.equal(event.side, null);
    assert.equal(event.price, null);
    assert.equal(event.validity, "UNKNOWN");
    assert.equal(event.failClosed, true);
    assert.deepEqual(event.missingFields, ["side", "price", "validity"]);
    assert.match(event.reason ?? "", /missing required fields/i);
});

test("rejects unsupported evidence levels", () => {
    assert.throws(
        () => normalizeDynamicCandidates({ records: [rawRecord([rawRow()], { evidence: "INFERRED" as never })] }),
        /UNSUPPORTED_EVIDENCE/,
    );
});

test("rejects unknown strategy IDs rather than normalizing them", () => {
    assert.throws(
        () => normalizeDynamicCandidates({ records: [rawRecord([rawRow({ strategy: "UNKNOWN" })])] }),
        /UNKNOWN_STRATEGY/,
    );
});

test("builds reproducible 10bps and 30bps coverage with source hashes and row counts", () => {
    const result = normalizeDynamicCandidates({
        records: [
            rawRecord([
                rawRow({ candidateId: "v12-1", strategy: "V12" }),
                rawRow({ candidateId: "q102-1", strategy: "Q102" }),
            ], { sourceBytes: 1234 }),
            {
                kind: "SAVED_MARKET_DATA",
                path: "market.json",
                sourceSha256: "b".repeat(64),
                sourceBytes: 5678,
                evidence: "CAUSALLY_REGENERATED",
                rows: [{ candidateId: "market-only", strategy: "IDLE", ts: TS + 1, symbol: "BTCUSDT", side: "SHORT", price: 99, validity: "VALID" }],
            },
        ],
        feeBps: [10, 30],
        slippageBps: [10, 30],
    });
    const manifest = buildCandidateSourceManifest(result);
    assert.equal(manifest.observedRowCount, 3);
    assert.equal(manifest.normalizedRowCount, 3);
    assert.equal(manifest.failClosedRowCount, 0);
    assert.deepEqual(manifest.costScenarios.map((scenario) => [scenario.feeBps, scenario.slippageBps]), [[10, 10], [30, 30]]);
    assert.equal(manifest.strategyCounts.V12, 1);
    assert.equal(manifest.strategyCounts.Q102, 1);
    assert.equal(manifest.strategyCounts.IDLE, 1);
    assert.equal(manifest.sourceHashes.length, 2);
    assert.equal(manifest.sha256Index.length, 2);
    assert.equal(manifest.sha256Index[0]?.sha256.length, 64);
    assert.equal(manifest.sha256Index.find((entry) => entry.path === "market.json")?.bytes, 5678);
    assert.equal(manifest.sha256Index.find((entry) => entry.path === "raw-candidate-decisions.jsonl")?.bytes, 1234);
});

test("counts only admitted events as normalized rows", () => {
    const result = normalizeDynamicCandidates({
        records: [rawRecord([
            rawRow({ candidateId: "admitted" }),
            rawRow({ candidateId: "fail-closed", side: undefined, price: undefined, validity: undefined }),
        ])],
    });
    const manifest = buildCandidateSourceManifest(result);
    assert.equal(manifest.observedRowCount, 2);
    assert.equal(manifest.failClosedRowCount, 1);
    assert.equal(manifest.normalizedRowCount, 1);
});

test("rejects malformed timestamps, source hashes, and incompatible cost scenarios", () => {
    assert.throws(() => normalizeDynamicCandidates({ records: [rawRecord([rawRow({ ts: "not-a-timestamp" })])] }), /INVALID_TIMESTAMP/);
    assert.throws(() => normalizeDynamicCandidates({ records: [rawRecord([rawRow()], { sourceSha256: "invalid" })] }), /INVALID_SOURCE_HASH/);
    assert.throws(() => normalizeDynamicCandidates({ records: [rawRecord([rawRow()])], feeBps: [10, 30], slippageBps: [10, 20, 30] }), /INVALID_COST_SCENARIO/);
});

test("indexes the exact verified fixture hash and byte length", () => {
    const content = `${JSON.stringify(rawRow({ candidateId: "hashed-fixture" }))}\n`;
    const hash = createHash("sha256").update(content, "utf8").digest("hex");
    const result = normalizeDynamicCandidates({
        records: [{
            kind: "RAW_CANDIDATE_DECISIONS",
            path: "fixture.jsonl",
            sourceSha256: hash,
            sourceBytes: Buffer.byteLength(content, "utf8"),
            evidence: "ORIGINAL_EVIDENCE",
            rows: [JSON.parse(content) as Record<string, unknown>],
        }],
    });
    const entry = buildCandidateSourceManifest(result).sha256Index[0];
    assert.equal(entry?.sha256, hash);
    assert.equal(entry?.bytes, Buffer.byteLength(content, "utf8"));
});

test("CLI parses JSON, JSONL, and CSV source-specific inputs with explicit evidence and source bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "dd-dynamic-cli-fixture-"));
    const rawPath = join(root, "raw.json");
    const marketPath = join(root, "market.jsonl");
    const adapterPath = join(root, "adapter.csv");
    const outputDir = join(root, "output");
    const rawContent = JSON.stringify([rawRow({ candidateId: "cli-raw" })]);
    const marketContent = `${JSON.stringify({ candidate: { candidate_id: "cli-market", strategy_id: "IDLE", symbol: "BTCUSDT", side: "SHORT", price: 99, ts: TS + 1 }, validity: "VALID" })}\n`;
    const adapterContent = "candidate_id,strategy_id,symbol,side,ts,price,validity,evidence_level\ncli-adapter,HYPE_LONG,BTCUSDT,LONG,1700000000002,101,VALID,UNVERIFIABLE\n";
    await writeFile(rawPath, rawContent, "utf8");
    await writeFile(marketPath, marketContent, "utf8");
    await writeFile(adapterPath, adapterContent, "utf8");
    try {
        await buildCandidateCoverage([
            "--output-dir", outputDir,
            "--raw-ledger", rawPath,
            "--market-data", marketPath,
            "--strategy-adapter", adapterPath,
            "--raw-evidence", "MISSING",
        ]);
        const manifest = JSON.parse(await readFile(join(outputDir, "candidate-source-manifest.json"), "utf8")) as {
            observedRowCount: number;
            failClosedRowCount: number;
            sourceHashes: readonly { path: string; bytes: number }[];
        };
        assert.equal(manifest.observedRowCount, 3);
        assert.equal(manifest.failClosedRowCount, 2);
        assert.equal(manifest.sourceHashes.find((entry) => entry.path.endsWith("raw.json"))?.bytes, Buffer.byteLength(rawContent));
        assert.equal(manifest.sourceHashes.find((entry) => entry.path.endsWith("market.jsonl"))?.bytes, Buffer.byteLength(marketContent));
        assert.equal(manifest.sourceHashes.find((entry) => entry.path.endsWith("adapter.csv"))?.bytes, Buffer.byteLength(adapterContent));
        await readFile(join(outputDir, "candidate-source-coverage-matrix.json"), "utf8");
        await readFile(join(outputDir, "candidate-source-sha256-index.json"), "utf8");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
