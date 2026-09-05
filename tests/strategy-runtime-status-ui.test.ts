import assert from "node:assert/strict";
import test from "node:test";

import { parseRuntimeStatusPayload, runtimeStateLabel } from "../hooks/useStrategyRuntimeStatus";

test("parses the API envelope without deriving status from unrelated UI state", () => {
  const payload = {
    strategies: [{ strategyId: "QUALITY102_CAUSAL_V1", state: "FAIL_CLOSED" }],
  };

  assert.deepEqual(parseRuntimeStatusPayload(payload), payload.strategies);
  assert.equal(runtimeStateLabel("LIVE"), "LIVE");
  assert.equal(runtimeStateLabel("要確認"), "要確認");
});

test("rejects an unavailable or malformed runtime-status payload", () => {
  assert.equal(parseRuntimeStatusPayload(null), null);
  assert.equal(parseRuntimeStatusPayload({ ok: false }), null);
  assert.equal(parseRuntimeStatusPayload({ strategies: "not-an-array" }), null);
});
