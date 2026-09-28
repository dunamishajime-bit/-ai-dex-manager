import test from "node:test";
import assert from "node:assert/strict";

import {
  assertFlatHypeZecLongStateForMigration,
  buildHypeZecLongStateMigration,
} from "../lib/hype-zec-long-state-migration";

const FROM = "a".repeat(40);
const TO = "b".repeat(40);

function state(overrides: Record<string, unknown> = {}) {
  return {
    schema: "disdex-hype-zec-long/v1",
    runtimeCommitSha: FROM,
    mode: "LIVE",
    updatedAt: 100,
    lastDecisionTs: 100,
    lastDecision: { strategy: "HYPE_LONG", signalTs: null, accepted: false, reason: "NO_SIGNAL" },
    failures: [{ message: "historical", occurredAt: 90 }],
    unknownAuditField: { preserved: true },
    ...overrides,
  };
}

test("flat HYPE/ZEC LIVE state migration changes only runtime lineage and timestamp", () => {
  const before = state();
  assert.doesNotThrow(() => assertFlatHypeZecLongStateForMigration(before, FROM));
  const after = buildHypeZecLongStateMigration(before, TO, 200);
  assert.equal(after.runtimeCommitSha, TO);
  assert.equal(after.updatedAt, 200);
  assert.deepEqual(after.lastDecision, before.lastDecision);
  assert.deepEqual(after.failures, before.failures);
  assert.deepEqual(after.unknownAuditField, { preserved: true });
});

test("HYPE/ZEC migration rejects any local exposure or unresolved review", () => {
  for (const overrides of [
    { positions: [{ strategy: "HYPE_LONG" }] },
    { pending: { action: "ENTRY" } },
    { manualReview: "HYPE_ZEC_RUNNER_FAIL_CLOSED:UNKNOWN" },
  ]) {
    assert.throws(() => assertFlatHypeZecLongStateForMigration(state(overrides), FROM), /HYPE_ZEC_STATE_MIGRATE/);
  }
});

test("HYPE/ZEC migration rejects stale SHA, non-LIVE mode, and malformed identity", () => {
  assert.throws(() => assertFlatHypeZecLongStateForMigration(state({ runtimeCommitSha: TO }), FROM), /SOURCE_SHA_MISMATCH/);
  assert.throws(() => assertFlatHypeZecLongStateForMigration(state({ mode: "SHADOW" }), FROM), /MODE/);
  assert.throws(() => assertFlatHypeZecLongStateForMigration(state({ schema: "other" }), FROM), /SCHEMA/);
});
