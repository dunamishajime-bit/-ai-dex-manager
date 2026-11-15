import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureStable4EntryOpportunityCandidate, prepareStable4EntryOpportunityRecord, publishPreparedStable4EntryOpportunityRecord, publishStable4EntryOpportunity, type Stable4EntryOpportunityCaptureInput } from "../lib/stable4-entry-opportunity-publisher";
import { Stable4EntryOpportunityStore } from "../lib/stable4-entry-opportunity-store";
import { ACCOUNT_LOCK_SCHEMA } from "../lib/disdex-account-order-lock";
import { STABLE4_OPPORTUNITY_MODEL_VERSION } from "../lib/stable4-opportunity-corpus";
import type { Stable4OpportunityLabel } from "../lib/stable4-opportunity-model";

const RAW = readFileSync("config/stable4/opportunity-corpus-seed-20261115.json");
const NOW = 1_800_000_000_000;
function input(overrides: Partial<Stable4EntryOpportunityCaptureInput> = {}): Stable4EntryOpportunityCaptureInput {
  return { sourceGitSha: "a".repeat(40), nativePositionId: "UNI-native-1", strategy: "Q102", symbol: "UNIUSDT", side: "SHORT", route: "UNI|MR72_Z1.5_H24", logicalEntryTs: 1_772_485_200_000, gross: 0.75, plannedHoldHours: 24,
    entrySnapshot: { ret14: 0.10960067969413756, strength: 1.6296431198044614, margin: 1.0864287465363076 }, capturedAt: NOW, ...overrides };
}
function prepare(value = input(), continuation?: readonly Stable4OpportunityLabel[]) { return prepareStable4EntryOpportunityRecord(captureStable4EntryOpportunityCandidate(value), RAW, continuation); }
async function fixture(run: (store: Stable4EntryOpportunityStore, lease: ReturnType<typeof ownedLease>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "stable4-publisher-"));
  try { const path = join(root, "entry-scores.json"); await writeFile(path, JSON.stringify({ schemaVersion: 1, records: [] })); await run(new Stable4EntryOpportunityStore(path, () => NOW), ownedLease()); }
  finally { await rm(root, { recursive: true, force: true }); }
}
function ownedLease() { return { document: async () => ({ schema: ACCOUNT_LOCK_SCHEMA, accountScope: "ASTER_FUTURES", ownerId: "publisher-test", leaseId: "lease-1", acquiredAt: NOW - 1000, expiresAt: NOW + 120_000, reservations: [] }) }; }

test("publisher reproduces reviewed causal NVDA and UNI historical entry scores", () => {
  const uni = prepare();
  assert.ok(Math.abs(uni.score! - 0.03762281565352898) < 1e-12);
  const nvda = prepare(input({ nativePositionId: "V52_00037", strategy: "V52", symbol: "NVDAUSDT", side: "LONG", route: "V50_POST_OPEN_BASIS", logicalEntryTs: 1_772_127_000_000, gross: 2, plannedHoldHours: 3,
    entrySnapshot: { capture_basis_bps: -99.82680573442981, entry_basis_bps: -86.63185257524408, exit_basis_bps: 82.8142919178343 } }));
  assert.ok(Math.abs(nvda.score! - 0.011289810650188917) < 1e-12);
  assert.equal(uni.modelVersion, STABLE4_OPPORTUNITY_MODEL_VERSION);
});
test("unknown entry score remains null and never becomes numeric zero", () => {
  const record = prepare(input({ logicalEntryTs: 1000, capturedAt: 2000 }));
  assert.equal(record.score, null);
});
test("future and exact-boundary continuation outcomes cannot affect an earlier entry score", () => {
  const baseline = prepare();
  const base: Stable4OpportunityLabel = { id: "future-label", strategy: "Q102", symbol: "UNIUSDT", side: "SHORT", route: "UNI|MR72_Z1.5_H24", entryTs: input().logicalEntryTs - 1000, exitTs: input().logicalEntryTs, net30: 100, features: { ret14: 0.1, strength: 1.6, margin: 1 } };
  assert.deepEqual(prepare(input(), [base, { ...base, id: "later-label", route: "continuation-next", entryTs: base.entryTs + 1000, exitTs: base.exitTs + 1000 }]), baseline);
});
test("explicit schema excludes outcome features and synchronously freezes native entry evidence", () => {
  const snapshot = { ret14: 0.1, strength: 1.6, margin: 1.08, exitTs: 9, realized: { ret14: 999 } };
  const value = input({ entrySnapshot: snapshot });
  const capture = captureStable4EntryOpportunityCandidate(value);
  snapshot.ret14 = 999; value.logicalEntryTs = 42; value.gross = 99;
  assert.equal(capture.candidate.entryTs, 1_772_485_200_000); assert.equal(capture.candidate.gross, 0.75);
  assert.deepEqual(capture.candidate.features, { ret14: 0.1, strength: 1.6, margin: 1.08 });
  assert.ok(Object.isFrozen(capture)); assert.ok(Object.isFrozen(capture.candidate)); assert.ok(Object.isFrozen(capture.candidate.features));
});
test("bad candidate identity, numeric coercions and malformed causal feature values reject", () => {
  for (const value of [input({ sourceGitSha: "bad" }), input({ route: "" }), input({ gross: "1" as never }), input({ plannedHoldHours: NaN }), input({ capturedAt: 1 }), input({ entrySnapshot: { ret14: NaN } }), Object.assign(input(), { exitTs: NOW })]) {
    assert.throws(() => captureStable4EntryOpportunityCandidate(value), /STABLE4_ENTRY_PUBLISHER_CAPTURE_INVALID/);
  }
});
test("pinned corpus and validated continuation reject altered seed and hindsight features", () => {
  assert.throws(() => prepareStable4EntryOpportunityRecord(captureStable4EntryOpportunityCandidate(input()), Buffer.concat([RAW, Buffer.from(" ")])), /STABLE4_ENTRY_PUBLISHER_CORPUS_INVALID/);
  const bad = { id: "bad", strategy: "Q102", symbol: "UNIUSDT", side: "SHORT", route: "r", entryTs: 1000, exitTs: 2000, net30: 0.1, features: { exit_basis_bps: 5 } } as Stable4OpportunityLabel;
  assert.throws(() => prepare(input(), [bad]), /STABLE4_ENTRY_PUBLISHER_CONTINUATION_INVALID/);
});
test("prepared record publication under owned lease persists before caller can submit and exact retry keeps score", async () => fixture(async (store, lease) => {
  const record = prepare();
  const published = await publishPreparedStable4EntryOpportunityRecord(record, { store, lease });
  assert.equal((await store.read()).records[0].score, record.score);
  assert.deepEqual(await publishPreparedStable4EntryOpportunityRecord(published, { store, lease }), published);
  await assert.rejects(publishPreparedStable4EntryOpportunityRecord({ ...record, score: 99 }, { store, lease }), /CONFLICT/);
}));
test("prepared retry rejects an unrelated model version and freezes mutable caller records before await", async () => fixture(async (store, lease) => {
  const record = prepare();
  await assert.rejects(publishPreparedStable4EntryOpportunityRecord({ ...record, modelVersion: "other-model" }, { store, lease }), /STABLE4_ENTRY_PUBLISHER_CAPTURE_INVALID/);
  assert.equal((await store.read()).records.length, 0);
  const mutable = { ...record };
  const pending = publishPreparedStable4EntryOpportunityRecord(mutable, { store, lease });
  mutable.score = 100; mutable.capturedAt = NOW + 1000;
  const persisted = await pending;
  assert.equal(persisted.score, record.score); assert.equal(persisted.capturedAt, NOW);
}));
test("convenience publication captures inputs before any lease await and has no mode bypass", async () => fixture(async (store, lease) => {
  const value = input();
  const pending = publishStable4EntryOpportunity(value, { store, lease, corpusBytes: RAW });
  value.gross = 999; value.logicalEntryTs = 5; (value.entrySnapshot as Record<string, unknown>).ret14 = 999;
  const published = await pending;
  assert.ok(Math.abs(published.score! - 0.03762281565352898) < 1e-12); assert.equal(published.entryTs, 1_772_485_200_000);
  await assert.rejects(publishPreparedStable4EntryOpportunityRecord({ ...published, positionId: "expired-lease" }, { store, lease: { document: async () => ({ ...await lease.document(), expiresAt: NOW }) } }), /LEASE/);
}));
