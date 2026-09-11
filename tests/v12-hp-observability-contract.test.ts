import assert from "node:assert/strict";
import test from "node:test";

import { v12ItemsFromSnapshot } from "../lib/server/disdex-decision-status";
import { sanitizeV12RunnerState } from "../lib/server/v12-decision-observability";

test("a valid empty V12 snapshot is candidate-none, not unavailable", () => {
  const items = v12ItemsFromSnapshot({
    schema: "v12-decision-snapshot/v1",
    strategyId: "V12_X1.00_ALL",
    referenceTs: Date.now(),
    candidates: [],
  }, new Date().toISOString());
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.status === "条件不足"));
  assert.ok(items.every((item) => item.reason.includes("この確定2時間足では候補なし")));
});

test("runner observability keeps both Top2 active positions", () => {
  const activePositions = [
    { symbol: "ETHUSDT", side: "LONG", quantity: 1, gross: 1, entryPrice: 100, entrySignalTs: 1, holdingBars: 2 },
    { symbol: "SOLUSDT", side: "SHORT", quantity: 2, gross: 0.5, entryPrice: 50, entrySignalTs: 2, holdingBars: 1 },
  ];
  const state = sanitizeV12RunnerState({ strategyId: "V12_X1.00_ALL", mode: "LIVE", updatedAt: Date.now(), activePositions, active: activePositions[0] });
  assert.equal(state?.activePositions.length, 2);
  assert.deepEqual(state?.activePositions.map((row) => row.symbol), ["ETHUSDT", "SOLUSDT"]);
});