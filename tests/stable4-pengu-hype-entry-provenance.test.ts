import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PenguDualLsV2PortfolioRunner,statePositionFromActual } from "../lib/pengu-dual-ls-v2-portfolio-runner";
import {createPenguRiskOverlayState} from "../lib/pengu-route-quarantine-dd-governor";
import { HypeZecLongRunner } from "../lib/hype-zec-long-runner";
import { FilePenguDualLsV2RunnerStateStore, validatePenguEntryOpportunity } from "../lib/pengu-dual-ls-v2-runner-state";
import { FileHypeZecLongRunnerStateStore, validateHypeEntryOpportunity } from "../lib/hype-zec-long-runner-state";
import type { Stable4EntryOpportunityRecord } from "../lib/stable4-entry-opportunity-book";

const SHA = "a".repeat(40), NOW = Date.now(), HOUR = 3600000;
function record(strategy: "PENGU" | "HYPE"): Stable4EntryOpportunityRecord {
  return { strategy, positionId: "native-entry", sourceSha: SHA, symbol: strategy === "HYPE" ? "HYPEUSDT" : "PENGUUSDT", side: "LONG", entryTs: NOW - HOUR, modelVersion: "STABLE4_CAUSAL_ENTRY_FEATURES_V1", score: .02, capturedAt: NOW - 500 };
}
const log = { info() {}, warn() {}, error() {} };
const pending: any = { idempotencyKey: "native-entry", clientOrderId: "cid", side: "BUY", reduceOnly: false, referenceTs: NOW - 2 * HOUR, createdAt: NOW - 500, quantity: 10, targetGross: 1, entryVersion: "LONG_V2_FINAL" };

test("PENGU captures optional baseline evidence under the actual lock without changing entry permission", async () => {
  const lock = { document: async () => ({}) }; let received: any;
  const runner: any = new PenguDualLsV2PortfolioRunner({ config: { mode: "LIVE", stable4Mode: "LIVE", runtimeCommitSha: SHA }, logger: log, now: () => NOW,
    entryOpportunityBuilder: async (value: any) => { received = value; return record("PENGU"); } } as any);
  const p = { ...pending };
  await runner.captureEntryOpportunity(p, { referenceTs: p.referenceTs }, {}, lock);
  assert.equal(received.lock, lock); assert.ok(Object.isFrozen(received.pending)); assert.equal(p.entryOpportunity.score, .02);
  assert.equal(p.entryOpportunity.entryTs, p.referenceTs + HOUR);
  runner.dependencies.entryOpportunityBuilder = async () => { throw Error("uninitialized book"); };
  const missing = { ...pending }; await runner.captureEntryOpportunity(missing, {}, {}, lock); assert.equal(missing.entryOpportunity, undefined);
  runner.dependencies.config.stable4Mode = "OFF"; received = undefined;
  runner.dependencies.entryOpportunityBuilder = async () => { received = true; throw Error("must not run"); };
  await runner.captureEntryOpportunity({ ...pending }, {}, {}, lock); assert.equal(received, undefined);
});
test("HYPE H48 capture binds native signal timestamp and source while failures stay evidence-only", async () => {
  const lock = { document: async () => ({}) }; let calls = 0;
  const runner: any = new HypeZecLongRunner({ runtime: { mode: "LIVE", stable4Mode: "LIVE", signalMode: "STABLE4", runtimeSha: SHA }, logger: log, now: () => NOW,
    entryOpportunityBuilder: async (value: any) => { calls++; assert.equal(value.lock, lock); return record("HYPE"); } } as any);
  const p: any = { ...pending, action: "ENTRY", symbol: "HYPEUSDT", strategy: "HYPE_LONG", signalTs: NOW - HOUR };
  await runner.captureEntryOpportunity(p, { signalTs: NOW - HOUR }, {}, lock, 1); assert.equal(p.entryOpportunity.entryTs, NOW - HOUR);
  runner.dependencies.entryOpportunityBuilder = async () => ({ ...record("HYPE"), sourceSha: "b".repeat(40) });
  const bad: any = { ...p, entryOpportunity: undefined }; await runner.captureEntryOpportunity(bad, { signalTs: NOW - HOUR }, {}, lock, 1); assert.equal(bad.entryOpportunity, undefined);
  runner.dependencies.runtime.stable4Mode = "OFF"; await runner.captureEntryOpportunity(bad, {}, {}, lock, 1); assert.equal(calls, 1);
});
test("optional score records reject borrowed identity and are immutable validated snapshots", () => {
  const p = validatePenguEntryOpportunity(record("PENGU"), { positionId: "native-entry", side: "LONG", logicalEntryTs: NOW - HOUR });
  assert.ok(Object.isFrozen(p));
  assert.throws(() => validatePenguEntryOpportunity({ ...record("PENGU"), positionId: "borrowed" }, { positionId: "native-entry", side: "LONG", logicalEntryTs: NOW - HOUR }));
  assert.throws(() => validateHypeEntryOpportunity({ ...record("HYPE"), side: "SHORT" }, { positionId: "native-entry", logicalEntryTs: NOW - HOUR }));
});
test("PENGU fill and restart retain the exact prepared entry score", async () => {
  const entry = record("PENGU"); const state: any = { riskOverlay: createPenguRiskOverlayState(), failures: [], pending: { ...pending, entryOpportunity: entry } };
  const actual = { symbol: "PENGUUSDT", quantity: 10, entryPrice: 1 };
  const runner: any = new PenguDualLsV2PortfolioRunner({ executor: { getPositions: async () => [actual] }, config: { residentStopRequired: false }, stateStore: { save: async () => {} }, logger: log, now: () => NOW } as any);
  await runner.applyResult(state, state.pending, { symbol: "PENGUUSDT", side: "BUY", clientOrderId: "cid", status: "FILLED", executedQuantity: 10, averagePrice: 1, executionUnknown: false });
  assert.deepEqual(state.position.entryOpportunity, entry);
  assert.deepEqual(statePositionFromActual({...actual,markPrice:1,updatedAt:NOW} as any,state.position).entryOpportunity,entry);
  const root = await mkdtemp(join(tmpdir(), "stable4-pengu-provenance-"));
  try { const store = new FilePenguDualLsV2RunnerStateStore(join(root, "state.json"), "LIVE"); await store.save(state); assert.deepEqual((await store.load()).position?.entryOpportunity, entry); }
  finally { await rm(root, { recursive: true, force: true }); }
});
test("HYPE pending and protected positions retain provenance across restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "stable4-hype-provenance-"));
  try {
    const entry = record("HYPE"), store = new FileHypeZecLongRunnerStateStore(join(root, "state.json"), SHA, "LIVE");
    const state: any = { schema: "disdex-hype-zec-long/v1", runtimeCommitSha: SHA, mode: "LIVE", updatedAt: NOW, failures: [],
      pending: { ...pending, action: "ENTRY", symbol: "HYPEUSDT", strategy: "HYPE_LONG", signalTs: NOW - HOUR, entryOpportunity: entry },
      positions: [{ strategy: "HYPE_LONG", symbol: "HYPEUSDT", side: "LONG", positionId: "native-entry", signalTs: NOW - HOUR, entryTs: NOW - 100, entryOpportunity: entry }] };
    await store.save(state); const read = await store.load(); assert.deepEqual(read.pending?.entryOpportunity, entry); assert.deepEqual(read.positions?.[0].entryOpportunity, entry);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("HYPE unknown scores stay unknown and borrowed persisted provenance cannot become an active baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "stable4-unknown-provenance-"));
  try {
    const store = new FileHypeZecLongRunnerStateStore(join(root, "state.json"), SHA, "LIVE");
    const state: any = { schema: "disdex-hype-zec-long/v1", runtimeCommitSha: SHA, mode: "LIVE", updatedAt: NOW, failures: [], positions: [{ strategy: "HYPE_LONG", symbol: "HYPEUSDT", side: "LONG", positionId: "native-entry", signalTs: NOW-HOUR, entryOpportunity: {...record("HYPE"),score:null} }] };
    await store.save(state); assert.equal((await store.load()).positions?.[0].entryOpportunity?.score,null);
    state.positions[0].entryOpportunity.positionId="borrowed";
    await store.save(state); assert.equal((await store.load()).positions?.[0].entryOpportunity,undefined);
    assert.equal((await store.load()).positions?.[0].positionId,"native-entry");
  } finally { await rm(root,{recursive:true,force:true}); }
});
test("Stable4 PENGU cannot preempt HYPE while OFF preserves the old preemption branch", async () => {
  const previous = process.env.DISDEX_HYPE_ZEC_PREEMPTION_ENABLED; process.env.DISDEX_HYPE_ZEC_PREEMPTION_ENABLED = "true";
  try {
    const runner: any = new PenguDualLsV2PortfolioRunner({ config: { stable4Mode: "LIVE" }, logger: log } as any);
    assert.equal(await runner.releaseHypeZecForPriorityEntry({ lock: {} }), undefined);
    runner.dependencies.config.stable4Mode = "OFF";
    assert.equal((await runner.releaseHypeZecForPriorityEntry({ lock: {} })).status, "blocked");
  } finally { if (previous === undefined) delete process.env.DISDEX_HYPE_ZEC_PREEMPTION_ENABLED; else process.env.DISDEX_HYPE_ZEC_PREEMPTION_ENABLED = previous; }
});
