import assert from "node:assert/strict";
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
import { assertFixtureIdentity, FIXTURE_HASH } from "../lib/backtest/dd-reduction/fixture-identity";

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
            ]),
            {
                kind: "SAVED_MARKET_DATA",
                path: "market.json",
                sourceSha256: "b".repeat(64),
                evidence: "CAUSALLY_REGENERATED",
                rows: [{ candidateId: "market-only", strategy: "IDLE", ts: TS + 1, symbol: "BTCUSDT", side: "SHORT", price: 99, validity: "VALID" }],
            },
        ],
        feeBps: [10, 30],
        slippageBps: [10, 30],
    });
    const manifest = buildCandidateSourceManifest(result);
    assert.equal(manifest.observedRowCount, 3);
    assert.equal(manifest.failClosedRowCount, 0);
    assert.deepEqual(manifest.costScenarios.map((scenario) => [scenario.feeBps, scenario.slippageBps]), [[10, 10], [30, 30]]);
    assert.equal(manifest.strategyCounts.V12, 1);
    assert.equal(manifest.strategyCounts.Q102, 1);
    assert.equal(manifest.strategyCounts.IDLE, 1);
    assert.equal(manifest.sourceHashes.length, 2);
    assert.equal(manifest.sha256Index.length, 2);
    assert.equal(manifest.sha256Index[0]?.sha256.length, 64);
});
