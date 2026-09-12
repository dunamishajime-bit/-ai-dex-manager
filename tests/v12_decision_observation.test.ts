import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { V12_X1_ALL } from "@/config/v12X1AllRuntime";
import * as v12 from "@/lib/v12-x1-all";
import type { V12Bar } from "@/lib/v12-x1-all";

const BAR_MS = 2 * 60 * 60_000;
const START = Date.parse("2026-09-01T00:00:00Z");

function flatUniverse(): Record<string, V12Bar[]> {
  return Object.fromEntries(V12_X1_ALL.universe.map((symbol) => [symbol, Array.from({ length: 100 }, (_, index) => ({
    ts: START + index * BAR_MS,
    endTs: START + (index + 1) * BAR_MS,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
    sourceCount: 2 as const,
    closed: true,
  }))]));
}

test("V12 emits current ranked observability even when no execution signal completes", async () => {
  const data = flatUniverse();
  const index = data.BTC.length - 1;
  assert.equal(v12.buildV12Signals(data, index).length, 0);
  const buildObservation = (v12 as typeof v12 & { buildV12DecisionObservation?: (data: Record<string, V12Bar[]>, index: number, observedAt: number) => any }).buildV12DecisionObservation;
  assert.equal(typeof buildObservation, "function");
  const snapshot = buildObservation!(data, index, START + 200 * BAR_MS);
  assert.ok(snapshot);
  assert.equal(snapshot.referenceTs, data.BTC[index].endTs);
  assert.equal(snapshot.reason, "NO_COMPLETED_BAR_SIGNAL");
  assert.equal(snapshot.btcRegime, "NEUTRAL");
  assert.equal(snapshot.symbol, undefined);
  assert.equal(snapshot.side, undefined);
  assert.equal(snapshot.candidates.length, V12_X1_ALL.universe.length);
  assert.deepEqual(snapshot.candidates.map((row: any) => row.rank), Array.from({ length: V12_X1_ALL.universe.length }, (_, i) => i + 1));
  assert.ok(snapshot.candidates.every((row: any) => row.signalEligible === false && typeof row.signalReason === "string"));

  const observationModule = await import("@/lib/v12-decision-observation").catch(() => null);
  assert.ok(observationModule, "observation store module must exist");
  assert.equal(typeof observationModule!.FileV12DecisionObservationStore, "function");
  const root = await mkdtemp(join(tmpdir(), "v12-decision-observation-"));
  try {
    const path = join(root, "decision-snapshot.json");
    const store = new observationModule!.FileV12DecisionObservationStore(path);
    await store.save(snapshot);
    const disk = JSON.parse(await readFile(path, "utf8"));
    assert.equal(disk.referenceTs, snapshot.referenceTs);
    assert.equal(disk.reason, "NO_COMPLETED_BAR_SIGNAL");
    assert.equal(disk.candidates.length, V12_X1_ALL.universe.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const runnerSource = await readFile(join(process.cwd(), "scripts", "disdex-v12-x1-all-live-runner.ts"), "utf8");
  assert.match(runnerSource, /FileV12DecisionObservationStore/);
  assert.match(runnerSource, /V12_DECISION_SNAPSHOT_PATH/);
  assert.match(runnerSource, /\/var\/lib\/disdex\/v12-x1-all\/decision-snapshot\.json/);
  assert.match(runnerSource, /decisionObserver/);
});