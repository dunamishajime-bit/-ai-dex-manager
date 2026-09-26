import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildV12DecisionObservation,
  summarizeV12GateDiagnostics,
  type V12ObservedCandidate,
  type V12Bar,
} from "@/lib/v12-x1-all";
import { FileV12DecisionObservationStore } from "@/lib/v12-decision-observation";
import { V12_X1_ALL } from "@/config/v12X1AllRuntime";

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

function candidate(overrides: Partial<V12ObservedCandidate>): V12ObservedCandidate {
  return {
    symbol: "BTC",
    side: "LONG",
    momentum: 0.02,
    volatility: 0.01,
    atr: 1,
    volumeRatio: 1,
    score: 1,
    rank: 1,
    baseEligible: true,
    signalEligible: true,
    signalReason: "SIGNAL_ELIGIBLE",
    ...overrides,
  };
}

test("summarizes standard and HC175 decisions separately", () => {
  const diagnostics = summarizeV12GateDiagnostics([
    candidate({ entryGateReason: "ALLOW_STANDARD", highConfidence: false }),
    candidate({ symbol: "ETH", entryGateReason: "ALLOW_HC175", highConfidence: true }),
    candidate({ symbol: "SOL", signalEligible: false, signalReason: "BLOCK_FALSE_BURST80", entryGateReason: "BLOCK_FALSE_BURST80" }),
    candidate({ symbol: "XRP", baseEligible: false, signalEligible: false, signalReason: "VOLUME_RATIO_BELOW_MINIMUM" }),
  ], 2, START, START + 1_000);

  assert.equal(diagnostics.candidateCount, 4);
  assert.equal(diagnostics.baseEligibleCount, 3);
  assert.equal(diagnostics.gateEvaluatedCount, 3);
  assert.equal(diagnostics.standardAcceptedCount, 1);
  assert.equal(diagnostics.hc175AcceptedCount, 1);
  assert.equal(diagnostics.finalSignalCount, 2);
  assert.equal(diagnostics.rejectedCount, 2);
  assert.deepEqual(diagnostics.rejectionReasons, {
    BLOCK_FALSE_BURST80: 1,
    VOLUME_RATIO_BELOW_MINIMUM: 1,
  });
  assert.equal(diagnostics.freshness, "fresh");
});

test("persists latest snapshot and rotates diagnostics by UTC day", async () => {
  const data = flatUniverse();
  const snapshot = buildV12DecisionObservation(data, data.BTC.length - 1, Date.parse("2026-09-01T01:00:00Z"));
  assert.ok(snapshot);
  assert.ok(snapshot.gateDiagnostics);

  const root = await mkdtemp(join(tmpdir(), "v12-gate-diagnostics-"));
  try {
    const latestPath = join(root, "decision-snapshot.json");
    const historyPath = join(root, "v12-gate-diagnostics.jsonl");
    const store = new FileV12DecisionObservationStore(latestPath, historyPath);
    await store.save(snapshot);
    await store.save({
      ...snapshot,
      observedAt: "2026-09-02T01:00:00.000Z",
    });

    const files = (await readdir(root)).sort();
    assert.deepEqual(files, [
      "decision-snapshot.json",
      "v12-gate-diagnostics-2026-09-01.jsonl",
      "v12-gate-diagnostics-2026-09-02.jsonl",
    ]);
    const firstHistory = await readFile(join(root, "v12-gate-diagnostics-2026-09-01.jsonl"), "utf8");
    const secondHistory = await readFile(join(root, "v12-gate-diagnostics-2026-09-02.jsonl"), "utf8");
    assert.equal(firstHistory.trim().split("\n").length, 1);
    assert.equal(secondHistory.trim().split("\n").length, 1);
    assert.equal(JSON.parse(secondHistory).observedAt, "2026-09-02T01:00:00.000Z");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
