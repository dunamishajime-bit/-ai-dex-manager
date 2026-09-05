import assert from "node:assert/strict";
import test from "node:test";

import { parseRuntimeStatusPayload, projectRuntimeStatusForDisplay, runtimeStateLabel } from "../hooks/useStrategyRuntimeStatus";
import type { StrategyRuntimeStatus } from "../lib/disdex-runtime-status";

const strategyIds = [
  "V12_X1.00_ALL",
  "PENGU_DUAL_LS_V2_FINAL",
  "V52_ASTER_ONLY",
  "QUALITY102_CAUSAL_V1",
] as const;

function validStatus(strategyId: StrategyRuntimeStatus["strategyId"], index: number): StrategyRuntimeStatus {
  return {
    strategyId,
    displayName: `Strategy ${index}`,
    state: index === 0 ? "LIVE" : "WAITING",
    serviceActive: true,
    serviceActivity: "ACTIVE",
    heartbeatAt: 1_700_000_000_000,
    runtimeSha: "a".repeat(40),
    releaseShaMatch: true,
    safetyReason: "last known reason",
    lastDecision: "last known decision",
    recovery: { action: "NONE", attempts: 0 },
    gross: { strategyCap: 1, cryptoCap: 2, totalCap: 3 },
    symbols: [{ symbol: "BTCUSDT", eligible: true, reason: "eligible" }],
    ...(strategyId === "QUALITY102_CAUSAL_V1"
      ? { quality102: { selectorMode: "DERIVED_HIGH_VOL_ONLY", historicalSelectorParity: false, brkLiveEnabled: false } }
      : {}),
  };
}

const validPayload = { strategies: strategyIds.map(validStatus) };

test("parses the API envelope without deriving status from unrelated UI state", () => {
  assert.deepEqual(parseRuntimeStatusPayload(validPayload), validPayload.strategies);
  assert.equal(runtimeStateLabel("LIVE"), "LIVE");
  assert.equal(runtimeStateLabel("要確認"), "要確認");
});

test("turns unavailable or malformed runtime-status payloads into four safe cards", () => {
  for (const payload of [null, { ok: false }, { strategies: "not-an-array" }, { strategies: [{ ...validPayload.strategies[0], strategyId: "UNTRUSTED" }] }, { strategies: [...validPayload.strategies, validPayload.strategies[0]] }]) {
    const result = parseRuntimeStatusPayload(payload);
    assert.ok(result);
    assert.deepEqual(result.map((item) => item.strategyId), strategyIds);
    assert.ok(result.every((item) => item.state === "要確認"));
    assert.ok(result.every((item) => item.recovery.action === "HELD_FAIL_CLOSED"));
  }
});

test("stale retained cards are non-affirmative and mark symbols non-executable", () => {
  const result = projectRuntimeStatusForDisplay(validPayload.strategies, true);
  assert.equal(result[0].state, "要確認");
  assert.equal(result[0].serviceActive, false);
  assert.equal(result[0].releaseShaMatch, false);
  assert.equal(result[0].recovery.action, "HELD_FAIL_CLOSED");
  assert.equal(result[0].symbols[0].eligible, false);
  assert.match(result[0].safetyReason, /stale/i);
  assert.match(result[0].symbols[0].reason, /stale/i);
  assert.match(result[0].lastDecision ?? "", /last known decision/);
});
