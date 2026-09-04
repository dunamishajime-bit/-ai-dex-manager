import assert from "node:assert/strict";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileQuality102CausalV1StateStore,
  MemoryQuality102CausalV1StateStore,
  createQuality102CausalV1State,
  type Quality102CausalV1State,
} from "../lib/disdex-quality102-causal-v1-state";

const RUNTIME_SHA = "5b243d3c5258cece3d60440fbdc69d207c06cbc9";
const OTHER_SHA = "f".repeat(40);

function pendingState(phase: "submitted" | "manual_review"): Quality102CausalV1State {
  return {
    version: 1,
    strategyId: "QUALITY102_CAUSAL_V1",
    mode: "LIVE",
    runtimeCommitSha: RUNTIME_SHA,
    updatedAt: 1_788_451_200_000,
    lastProcessedReferenceTs: 1_788_447_600_000,
    position: {
      symbol: "BTCUSDT",
      side: 1,
      quantity: 0.002,
      entryPrice: 100_000,
      entryTs: 1_788_444_000_000,
    },
    pending: {
      idempotencyKey: "quality102-pending-1",
      clientOrderId: "q102v1-quality102-pending-1",
      phase,
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: 0.001,
      reduceOnly: true,
      referenceTs: 1_788_447_600_000,
      createdAt: 1_788_451_100_000,
      updatedAt: 1_788_451_200_000,
      ...(phase === "manual_review" ? { lastError: "order status unknown" } : {}),
    },
    lastReconciledAt: 1_788_451_150_000,
    failures: [],
  };
}

async function main() {
  assert.equal(createQuality102CausalV1State("PAPER").strategyId, "QUALITY102_CAUSAL_V1");

  const root = join(tmpdir(), `quality102-causal-v1-state-${process.pid}-${Date.now()}`);
  await mkdir(root, { recursive: true });
  try {
    const malformedPath = join(root, "malformed.json");
    await writeFile(malformedPath, "{not-json", "utf8");
    const malformedStore = new FileQuality102CausalV1StateStore(malformedPath, "PAPER", RUNTIME_SHA);
    await assert.rejects(() => malformedStore.load(), /QUALITY102_STATE_MALFORMED/);

    const legacyPath = join(root, "legacy.json");
    await writeFile(legacyPath, JSON.stringify({ ...pendingState("submitted"), strategyId: "QUALITY102" }), "utf8");
    const legacyStore = new FileQuality102CausalV1StateStore(legacyPath, "LIVE", RUNTIME_SHA);
    await assert.rejects(() => legacyStore.load(), /QUALITY102_STATE_MALFORMED.*strategyId/);

    const wrongShaPath = join(root, "wrong-sha.json");
    await writeFile(wrongShaPath, JSON.stringify({ ...pendingState("submitted"), runtimeCommitSha: OTHER_SHA }), "utf8");
    const wrongShaStore = new FileQuality102CausalV1StateStore(wrongShaPath, "LIVE", RUNTIME_SHA);
    await assert.rejects(() => wrongShaStore.load(), /QUALITY102_STATE_MALFORMED.*runtimeCommitSha/);

    const malformedCases: Array<[string, unknown]> = [
      ["unknown pending phase", { ...pendingState("submitted"), pending: { ...pendingState("submitted").pending, phase: "retrying" } }],
      ["non-finite pending quantity", { ...pendingState("submitted"), pending: { ...pendingState("submitted").pending, quantity: Number.POSITIVE_INFINITY } }],
      ["non-finite position price", { ...pendingState("submitted"), position: { ...pendingState("submitted").position, entryPrice: Number.NaN } }],
      ["non-finite timestamp", { ...pendingState("submitted"), updatedAt: Number.NaN }],
      ["more than one position", { ...pendingState("submitted"), position: [pendingState("submitted").position, pendingState("submitted").position] }],
    ];
    for (const [name, value] of malformedCases) {
      const memoryStore = new MemoryQuality102CausalV1StateStore(value as Quality102CausalV1State, "LIVE", RUNTIME_SHA);
      await assert.rejects(() => memoryStore.load(), /QUALITY102_STATE_MALFORMED/, name);
    }

    const statePath = join(root, "runner-live.json");
    const stateWithPending = pendingState("submitted");
    const store = new FileQuality102CausalV1StateStore(statePath, "LIVE", RUNTIME_SHA);
    await store.save(stateWithPending);
    const restartedStore = new FileQuality102CausalV1StateStore(statePath, "LIVE", RUNTIME_SHA);
    assert.deepEqual(await restartedStore.load(), stateWithPending);
    assert.equal((await restartedStore.load()).pending?.phase, "submitted");

    const manualReviewState = pendingState("manual_review");
    await restartedStore.save(manualReviewState);
    assert.deepEqual(
      await new FileQuality102CausalV1StateStore(statePath, "LIVE", RUNTIME_SHA).load(),
      manualReviewState,
    );

    assert.equal((await readdir(root)).some((name) => name.endsWith(".tmp")), false);
    if (process.platform !== "win32") {
      assert.equal((await stat(statePath)).mode & 0o777, 0o600);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log("QUALITY102_CAUSAL_V1_STATE_SELFTEST_PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
