import assert from "node:assert/strict";
import test from "node:test";

import * as observability from "../lib/server/realtime-ranking-observability";
import { currentRankRow, executionBlocked, type RankRow } from "../lib/realtime-ranking";

const now = Date.UTC(2026, 9, 21, 0, 0);
type V4RowBuilder = (candidate: Record<string, unknown>, fresh: boolean, checkedAt: number, fallbackReason: string) => RankRow;

function buildV4RankRow() {
  const builder = (observability as Record<string, unknown>).buildV4RankRow;
  assert.equal(typeof builder, "function", "V4 observability must expose its display-row mapping");
  return builder as V4RowBuilder;
}

test("V4 native observed score survives as a display score without changing gate state", () => {
  const row = buildV4RankRow()({
    symbol: "ETHUSDT",
    side: "LONG",
    score: 87.25,
    signalEligible: false,
    signalReason: "SIGNAL_BLOCKED",
  }, true, now, "V4 fallback reason");

  assert.equal(row.score, 87.25);
  assert.equal(row.scoreSource, "v4-native-display");
  assert.equal(row.gates.find((gate) => gate.key === "authoritative")?.state, "NO");
  assert.equal(row.gates.find((gate) => gate.key === "execution")?.state, "UNKNOWN");
  assert.equal(currentRankRow(row, now + 1_000).score, 87.25);
});

test("false V4 eligibility remains non-executable while its native score is observable", () => {
  const row = buildV4RankRow()({
    symbol: "BTCUSDT",
    side: "SHORT",
    score: 91,
    signalEligible: false,
    signalReason: "SIGNAL_BLOCKED",
  }, true, now, "V4 fallback reason");

  assert.equal(row.gates.find((gate) => gate.key === "authoritative")?.state, "NO");
  assert.equal(executionBlocked(row), false, "display score must not manufacture an execution blocker");
  assert.equal(row.score, 91);
});
