import test from "node:test";
import assert from "node:assert/strict";
import {
  createQuality102CausalV1State,
  MemoryQuality102CausalV1StateStore,
} from "../lib/disdex-quality102-causal-v1-state";

test("adopted Q102 exit progress survives a state round trip", async () => {
  const initial = createQuality102CausalV1State("PAPER", "test-runtime");
  initial.position = {
    symbol: "APTUSDT",
    side: 1,
    quantity: 1,
    entryPrice: 100,
    entryTs: 1_000,
    hardStop: 0.1,
    bestPrice: 100.4,
    trailActive: false,
    profitFloorArmed: true,
    profitFloorStopPrice: 99.5,
    profitFloorBestGainPct: 0.03,
    profitFloorLastConfirmed5mTs: 900_000,
    profitFloorStage: 2,
    initialAdverseBestGainPct: 0.004,
    h1LossConsecutive: 1,
    h1LastConfirmedCloseTs: 3_600_000,
    family: "HIGH_VOL",
    acceptedEntryGross: 1,
  };
  const store = new MemoryQuality102CausalV1StateStore(initial, "PAPER", "test-runtime");
  const restored = await store.load();
  assert.equal(restored.position?.profitFloorStage, 2);
  assert.equal(restored.position?.initialAdverseBestGainPct, 0.004);
  assert.equal(restored.position?.h1LossConsecutive, 1);
  assert.equal(restored.position?.h1LastConfirmedCloseTs, 3_600_000);
});
