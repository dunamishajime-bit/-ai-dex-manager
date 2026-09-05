import assert from "node:assert/strict";
import test from "node:test";

import { parseRuntimeStatusPayload, projectRuntimeStatusForDisplay, q102SymbolSafetyLabel, runtimeStateLabel } from "../hooks/useStrategyRuntimeStatus";
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
  const parsed = parseRuntimeStatusPayload(validPayload);
  assert.deepEqual(parsed.filter((item) => item.strategyId !== "QUALITY102_CAUSAL_V1"), validPayload.strategies.filter((item) => item.strategyId !== "QUALITY102_CAUSAL_V1"));
  const q102 = parsed.find((item) => item.strategyId === "QUALITY102_CAUSAL_V1")!;
  assert.equal(q102.state, "FAIL_CLOSED");
  assert.deepEqual(q102.gross, { strategyCap: 0.5, cryptoCap: 2, totalCap: 2.5 });
  assert.equal(q102.symbols[0].eligible, false);
  assert.equal(runtimeStateLabel("LIVE"), "LIVE");
  assert.equal(runtimeStateLabel("要確認"), "要確認");
});

test("normalizes adversarial Q102 LIVE and cap drift into a fixed non-executable card", () => {
  const payload = {
    strategies: validPayload.strategies.map((item) => item.strategyId === "QUALITY102_CAUSAL_V1"
      ? { ...item, state: "LIVE", gross: { strategyCap: 9, cryptoCap: 8, totalCap: 7 }, symbols: [{ symbol: "BTCUSDT", eligible: true, reason: "eligible" }] }
      : item),
  };
  const q102 = parseRuntimeStatusPayload(payload).find((item) => item.strategyId === "QUALITY102_CAUSAL_V1")!;
  assert.equal(q102.state, "FAIL_CLOSED");
  assert.equal(q102.lastDecision, "LIVE_BLOCKED_FAIL_CLOSED");
  assert.deepEqual(q102.gross, { strategyCap: 0.5, cryptoCap: 2, totalCap: 2.5 });
  assert.equal(q102.symbols[0].eligible, false);
});

test("labels every Q102 heartbeat symbol with fresh/fail-closed or stale safety state", () => {
  const q102 = parseRuntimeStatusPayload(validPayload).find((item) => item.strategyId === "QUALITY102_CAUSAL_V1")!;
  assert.equal(q102SymbolSafetyLabel(q102, false), "FRESH / FAIL_CLOSED / NON-EXECUTABLE");
  const stale = projectRuntimeStatusForDisplay([q102], true)[0];
  assert.equal(q102SymbolSafetyLabel(stale, true), "要確認 / FAIL_CLOSED / NON-EXECUTABLE");
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
