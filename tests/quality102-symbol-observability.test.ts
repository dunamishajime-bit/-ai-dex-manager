import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

import {
  loadQuality102SymbolObservability,
  type Quality102SymbolObservabilityOptions,
} from "../lib/server/quality102-symbol-observability";

const scopedSha = "a".repeat(40);
const unrelatedGlobalSha = "b".repeat(40);

function runtimeIdentity(overrides: Record<string, unknown> = {}) {
  return {
    status: "LIVE" as const,
    runtimeSha: scopedSha,
    expectedReleaseSha: scopedSha,
    releaseShaVerified: true,
    ...overrides,
  };
}

function snapshot(runtimeCommitSha = scopedSha) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    rankingModelVersion: "Q102_PROXIMITY_V1",
    rankingCapturedAt: now,
    observerCommitSha: unrelatedGlobalSha,
    strategyId: "QUALITY102_CAUSAL_V1",
    selectorMode: "CAUSAL_V4",
    runtimeCommitSha,
    capturedAt: now,
    referenceTs: Date.now(),
    selectedReason: "QUALITY102_CAUSAL_V4_NO_SIGNAL",
    items: [{
      symbol: "APTUSDT",
      eligible: false,
      side: "WAIT",
      requestedGross: 0,
      reason: "QUALITY102_CAUSAL_V4_NO_SIGNAL",
      selected: false,
      referenceTs: Date.now(),
      rankingScore: 12.34,
      rankingRank: 1,
    }],
  };
}

async function options(directory: string, runtime = runtimeIdentity()): Promise<Quality102SymbolObservabilityOptions> {
  const rankingPath = join(directory, "decision-ranking-snapshot.json");
  const decisionPath = join(directory, "decision-snapshot.json");
  await writeFile(rankingPath, JSON.stringify(snapshot(String(runtime.runtimeSha))), "utf8");
  await writeFile(decisionPath, JSON.stringify(snapshot(String(runtime.runtimeSha))), "utf8");
  return {
    rankingPath,
    decisionPath,
    loadRuntime: async () => runtime,
  };
}

test("Q102 symbol observability binds snapshots to the scoped Q102 runtime SHA", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-q102-symbol-observability-"));
  try {
    const result = await loadQuality102SymbolObservability(await options(directory));
    assert.equal(result.productionSha, scopedSha);
    assert.equal(result.snapshotSource, "ranking");
    assert.equal(result.rankingAvailable, true);
    assert.equal(result.items[0]?.rankingScore, 12.34);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Q102 symbol observability fails closed when the scoped runtime SHA is unverified", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-q102-symbol-observability-unverified-"));
  try {
    const runtime = runtimeIdentity({ releaseShaVerified: false });
    await assert.rejects(
      loadQuality102SymbolObservability(await options(directory, runtime)),
      /Q102_RUNTIME_SHA_UNVERIFIED/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
