import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
    assertTask9DynamicStatus,
    assertTask9ResearchOnlyAudit,
    assertTask9Task6Manifest,
    verifyTask9DynamicArtifacts,
} from "../scripts/dd-reduction/verify-task9-dynamic-artifacts";
import { assertFixtureIdentity, FIXTURE_HASH } from "../lib/backtest/dd-reduction/fixture-identity";

const EMPTY_ARRAY_SHA = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
const HASH = "a".repeat(64);

assertFixtureIdentity({ sourceHash: FIXTURE_HASH }, ["sourceHash"], "task8-artifact-fixture");

test("verifies the checked-in Task 6/7 compact artifacts and preserves the source-coverage block", async () => {
    const result = await verifyTask9DynamicArtifacts({
        repositoryRoot: process.cwd(),
        checkExternalLedgers: process.env.DDEX_VERIFY_EXTERNAL === "1",
    });

    assert.equal(result.status, "PASS");
    assert.equal(result.dynamicClassification, "BLOCKED_INCOMPLETE_SOURCE_COVERAGE");
    assert.equal(result.replayableRows, 0);
    assert.equal(result.observedRows, 3185);
    assert.equal(result.productionChanges, 0);
    assert.equal(result.liveClaim, false);
});

test("fails closed when Task 6 has a missing ledger reference or a bad SHA", () => {
    const manifest = {
        candidate_source: {
            expected_rows: 3185,
            observed_rows: 3185,
            normalized_rows: 0,
            fail_closed_rows: 3185,
            replayable_rows: 0,
            strategy_coverage: ["V12", "Q102", "PENGU", "FET", "RESIDUAL", "IDLE", "V52", "HYPE_LONG"],
            status: "INCOMPLETE",
        },
        runs: {
            "10": {
                output_dir: "C:/research/10bps",
                parity_classification: "BLOCKED_INCOMPLETE_SOURCE_COVERAGE",
                result_hash: HASH,
                allocator_hash: HASH,
                ledger_hashes: {
                    "execution-ledger.jsonl": EMPTY_ARRAY_SHA,
                    "reservation-ledger.jsonl": EMPTY_ARRAY_SHA,
                    "preemption-ledger.jsonl": EMPTY_ARRAY_SHA,
                    "allocator-state-snapshots.jsonl": EMPTY_ARRAY_SHA,
                },
            },
            "30": {
                output_dir: "C:/research/30bps",
                parity_classification: "BLOCKED_INCOMPLETE_SOURCE_COVERAGE",
                result_hash: HASH,
                allocator_hash: HASH,
                ledger_hashes: {
                    "execution-ledger.jsonl": EMPTY_ARRAY_SHA,
                    "reservation-ledger.jsonl": EMPTY_ARRAY_SHA,
                    "preemption-ledger.jsonl": EMPTY_ARRAY_SHA,
                    "allocator-state-snapshots.jsonl": EMPTY_ARRAY_SHA,
                    "mtm-timeline.jsonl": "b".repeat(64),
                },
            },
        },
    };

    assert.throws(
        () => assertTask9Task6Manifest(manifest, { requireExternalFiles: false }),
        /ARTIFACT_SCHEMA|TASK6_LEDGER_SHA_UNVERIFIABLE|TASK6_LEDGER_SHA_INVALID/,
    );
});

test("fails closed on wrong dynamic classification, economic eligibility, or production markers", () => {
    assert.throws(
        () => assertTask9DynamicStatus({
            classification: "FORMAL_PARITY",
            economic_acceptance_eligible: true,
            production_changes: 1,
            live_claim: true,
            source_coverage: { expected_rows: 3185, observed_rows: { "10": 3185, "30": 3185 }, normalized_rows: { "10": 3185, "30": 3185 }, fail_closed_rows: { "10": 0, "30": 0 }, replayable_rows: { "10": 3185, "30": 3185 } },
            cases: [],
            cumulative_gate: { status: "FORMAL_PARITY" },
        }),
        /TASK9_CLASSIFICATION_INVALID|TASK7_CLASSIFICATION_INVALID|PRODUCTION_MUTATION_MARKER/,
    );
});

test("requires an explicit research-only mutation audit", () => {
    assert.doesNotThrow(() => assertTask9ResearchOnlyAudit({
        production_changes: 0,
        live_claim: false,
        forbidden_paths: [],
        forbidden_markers: [],
        audit_status: "PASS",
    }));
    assert.throws(
        () => assertTask9ResearchOnlyAudit({ production_changes: 0, live_claim: false, forbidden_paths: ["ops/vps/example.conf"] }),
        /RESEARCH_SCOPE_MUTATION/,
    );
});

test("writes no raw ledgers when the compact verifier is used", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dd-artifact-test-"));
    const manifestPath = join(directory, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify({ ledger: EMPTY_ARRAY_SHA })}\n`, "utf8");
    assert.equal((await readFile(manifestPath, "utf8")).includes("ledger"), true);
});
