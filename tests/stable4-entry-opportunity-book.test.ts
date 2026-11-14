import assert from "node:assert/strict";
import test from "node:test";
import { appendStable4EntryScore, compareStable4UniEntryScore, validateStable4EntryOpportunityBook, Stable4EntryScoreBookError, type Stable4EntryScoreRecord, type Stable4EntryScoreComparisonInput } from "../lib/stable4-entry-opportunity-book";

const NOW = 1_800_000_000_000;
function record(overrides: Partial<Stable4EntryScoreRecord> = {}): Stable4EntryScoreRecord {
  return { strategy: "V4", positionId: "native-1", sourceSha: "a".repeat(40), symbol: "BTCUSDT", side: "LONG", entryTs: NOW - 86_400_000, modelVersion: "entry-v1", score: 0.3, capturedAt: NOW - 86_400_000 + 1, ...overrides };
}
function input(): Stable4EntryScoreComparisonInput {
  return { now: NOW, book: { schemaVersion: 1, records: [record()] }, candidate: record({ strategy: "Q102", positionId: "uni-candidate", symbol: "UNIUSDT", side: "SHORT", entryTs: NOW - 1000, capturedAt: NOW - 500, score: 0.4 }),
    owners: { complete: true, observedAt: NOW, positions: [{ strategy: "V4", positionId: "native-1", symbol: "BTCUSDT", side: "LONG", entryTs: NOW - 86_400_000, quantity: 2 }] },
    signed: { complete: true, observedAt: NOW, positions: [{ symbol: "BTCUSDT", side: "LONG", quantity: 2 }] } };
}
test("actually held owner remains a competitor long after a hypothetical shadow exit", () => {
  const value = input(); value.book.records = [record({ score: 0.9 })];
  assert.deepEqual(compareStable4UniEntryScore(value), { allowed: false, reason: "CANDIDATE_NOT_STRICTLY_BETTER", activeCount: 1, maxActiveScore: 0.9 });
});
test("missing entry record and explicit unknown entry score block", () => {
  const value = input(); value.book.records = []; assert.equal(compareStable4UniEntryScore(value).reason, "ACTIVE_SCORE_MISSING");
  value.book.records = [record({ score: null })]; assert.equal(compareStable4UniEntryScore(value).reason, "ACTIVE_SCORE_UNKNOWN");
});
test("equality blocks and finite candidate may beat a negative active maximum", () => {
  const value = input(); value.candidate.score = 0.3; assert.equal(compareStable4UniEntryScore(value).reason, "CANDIDATE_NOT_STRICTLY_BETTER");
  value.book.records = [record({ score: -0.3 })]; value.candidate.score = -0.2;
  assert.deepEqual(compareStable4UniEntryScore(value), { allowed: true, reason: "STRICTLY_BETTER", activeCount: 1, maxActiveScore: -0.3 });
});
test("orphan closed records do not activate without authoritative owner membership", () => {
  const value = input(); value.book.records = [...value.book.records, record({ positionId: "closed", score: 999 })];
  assert.equal(compareStable4UniEntryScore(value).allowed, true);
  value.owners.positions = []; value.signed.positions = [];
  assert.deepEqual(compareStable4UniEntryScore(value), { allowed: true, reason: "VERIFIED_EMPTY", activeCount: 0, maxActiveScore: null });
});
test("an unverified or stale empty snapshot never means no active competitors", () => {
  const value = input(); value.owners.positions = []; value.signed.positions = [];
  value.owners.complete = false; assert.equal(compareStable4UniEntryScore(value).reason, "OWNERS_INCOMPLETE");
  value.owners.complete = true; value.signed.complete = false; assert.equal(compareStable4UniEntryScore(value).reason, "SIGNED_INCOMPLETE");
  value.signed.complete = true; value.owners.observedAt = NOW - 120_001; assert.equal(compareStable4UniEntryScore(value).reason, "OWNERS_STALE");
  value.owners.observedAt = NOW; value.signed.observedAt = NOW + 1; assert.equal(compareStable4UniEntryScore(value).reason, "SIGNED_STALE");
});
test("signed foreign exposure or mismatched quantity blocks", () => {
  const value = input(); value.signed.positions[0].quantity = 1.9; assert.equal(compareStable4UniEntryScore(value).reason, "ACCOUNT_OWNER_MISMATCH");
  value.signed.positions[0].quantity = 2; value.signed.positions.push({ symbol: "ETHUSDT", side: "SHORT", quantity: 1 });
  assert.equal(compareStable4UniEntryScore(value).reason, "ACCOUNT_OWNER_MISMATCH");
});
test("partial quantities and multiple same-side V4 legs aggregate exactly", () => {
  const value = input(); value.book.records = [...value.book.records, record({ positionId: "native-2", score: 0.35 })];
  value.owners.positions[0].quantity = 0.2;
  value.owners.positions.push({ ...value.owners.positions[0], positionId: "native-2", quantity: 0.1 });
  value.signed.positions[0].quantity = 0.3;
  assert.equal(compareStable4UniEntryScore(value).allowed, true);
  value.signed.positions[0].quantity = 0.30001; assert.equal(compareStable4UniEntryScore(value).reason, "ACCOUNT_OWNER_MISMATCH");
});
test("entry identity conflict, duplicate owner and opposite side do not reconcile", () => {
  const value = input(); value.owners.positions[0].entryTs++; assert.equal(compareStable4UniEntryScore(value).reason, "ACTIVE_RECORD_CONFLICT");
  value.owners.positions[0].entryTs--; value.owners.positions.push({ ...value.owners.positions[0] }); assert.equal(compareStable4UniEntryScore(value).reason, "INVALID_OWNERS");
  value.owners.positions.pop(); value.signed.positions[0].side = "SHORT"; assert.equal(compareStable4UniEntryScore(value).reason, "ACCOUNT_OWNER_MISMATCH");
});
test("immutable append copies/freezes data and makes exact retry idempotent while refusing rescoring", () => {
  const source = record(); const original = { schemaVersion: 1 as const, records: [] as Stable4EntryScoreRecord[] };
  const next = appendStable4EntryScore(original, source); source.score = 99;
  assert.equal(next.records[0].score, 0.3); assert.equal(original.records.length, 0); assert.ok(Object.isFrozen(next)); assert.ok(Object.isFrozen(next.records)); assert.ok(Object.isFrozen(next.records[0]));
  assert.deepEqual(appendStable4EntryScore(next, record()), next);
  assert.throws(() => appendStable4EntryScore(next, record({ score: 4 })), Stable4EntryScoreBookError);
});
test("unknown schema fields and duplicate persisted identities reject during validation", () => {
  assert.throws(() => validateStable4EntryOpportunityBook({ schemaVersion: 1, records: [], unknown: true }), Stable4EntryScoreBookError);
  assert.throws(() => validateStable4EntryOpportunityBook({ schemaVersion: 1, records: [record(), record()] }), Stable4EntryScoreBookError);
});
test("sparse persisted records and unknown comparison fields fail closed", () => {
  assert.throws(() => validateStable4EntryOpportunityBook({ schemaVersion: 1, records: new Array(1) }), Stable4EntryScoreBookError);
  const value = Object.assign(input(), { shadowExitTs: NOW - 1 });
  assert.equal(compareStable4UniEntryScore(value).reason, "INVALID_INPUT");
});
test("unknown fields, unknown strategy, bad SHA, coercions and duplicate record books reject", () => {
  for (const bad of [{ ...record(), exitTs: NOW }, record({ strategy: "UNKNOWN" as never }), record({ sourceSha: "not-sha" }), record({ score: "0.4" as never }), record({ capturedAt: NOW - 100_000_000 })]) {
    assert.throws(() => appendStable4EntryScore({ schemaVersion: 1, records: [] }, bad), Stable4EntryScoreBookError);
  }
  const value = input(); value.book.records = [record(), record()]; assert.equal(compareStable4UniEntryScore(value).reason, "INVALID_BOOK");
});
test("unknown candidate score/model version and non-UNI candidates cannot pass", () => {
  const value = input(); value.candidate.score = null; assert.equal(compareStable4UniEntryScore(value).reason, "CANDIDATE_SCORE_UNKNOWN");
  value.candidate.score = 0.4; value.candidate.modelVersion = "entry-v2"; assert.equal(compareStable4UniEntryScore(value).reason, "MODEL_VERSION_MISMATCH");
  value.candidate.modelVersion = "entry-v1"; value.candidate.symbol = "AVAXUSDT"; assert.equal(compareStable4UniEntryScore(value).reason, "INVALID_CANDIDATE");
});
test("only recovered UNI short qualifies and source lineage requires a Git SHA", () => {
  const value = input(); value.candidate.side = "LONG";
  assert.equal(compareStable4UniEntryScore(value).reason, "INVALID_CANDIDATE");
  assert.throws(() => appendStable4EntryScore({ schemaVersion: 1, records: [] }, record({ sourceSha: "a".repeat(64) })), Stable4EntryScoreBookError);
});
