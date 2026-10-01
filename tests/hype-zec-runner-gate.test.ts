import test from "node:test";
import assert from "node:assert/strict";

import { assertHypeZecLiveGate, resolveHypeZecLongRuntime } from "../config/hypeZecLongRuntime";
import { isRecoverableHypeZecMarketDataFailure } from "../lib/hype-zec-long-runner";
import { nextAccountLockAwareWaitMs } from "../lib/disdex-account-lock-retry-scheduling";

test("only the known malformed market row is a retryable HYPE data failure", () => {
  assert.equal(isRecoverableHypeZecMarketDataFailure("HYPE_ZEC_MARKET_DATA_ROW_INVALID"), true);
  assert.equal(isRecoverableHypeZecMarketDataFailure("HYPE_ZEC_MARKET_DATA_GAP:HYPEUSDT:1:2"), false);
  assert.equal(isRecoverableHypeZecMarketDataFailure("permission denied"), false);
});

test("HYPE/ZEC runtime defaults to fail-closed shadow mode", () => {
  const runtime = resolveHypeZecLongRuntime({ NODE_ENV: "test" });
  assert.equal(runtime.mode, "SHADOW");
  assert.equal(runtime.enabled, false);
  assert.equal(runtime.liveExecutionEnabled, false);
  assert.equal(runtime.operatorArmed, false);
});

test("HYPE/ZEC live gate rejects missing operator activation", () => {
  const runtime = resolveHypeZecLongRuntime({ NODE_ENV: "test",
    DISDEX_HYPE_ZEC_MODE: "LIVE",
    DISDEX_HYPE_ZEC_ENABLED: "true",
    DISDEX_HYPE_ZEC_LIVE_EXECUTION_ENABLED: "true",
    DISDEX_HYPE_ZEC_PRODUCTION_CONFIG_LIVE_ENABLED: "true",
    DISDEX_HYPE_ZEC_OPERATOR_ARMED: "false",
    DISDEX_HYPE_ZEC_RUNTIME_SHA: "a".repeat(40),
  });
  assert.throws(() => assertHypeZecLiveGate(runtime), /OPERATOR_LIVE_ACTIVATION_REQUIRED/);
});

test("HYPE/ZEC live gate requires an exact runtime SHA", () => {
  const runtime = resolveHypeZecLongRuntime({ NODE_ENV: "test",
    DISDEX_HYPE_ZEC_MODE: "LIVE",
    DISDEX_HYPE_ZEC_ENABLED: "true",
    DISDEX_HYPE_ZEC_LIVE_EXECUTION_ENABLED: "true",
    DISDEX_HYPE_ZEC_PRODUCTION_CONFIG_LIVE_ENABLED: "true",
    DISDEX_HYPE_ZEC_OPERATOR_ARMED: "true",
    DISDEX_HYPE_ZEC_RUNTIME_SHA: "not-a-sha",
  });
  assert.throws(() => assertHypeZecLiveGate(runtime), /RUNTIME_SHA/);
});


test("transient account lock collisions use a bounded short retry without changing normal cadence", () => {
  assert.equal(nextAccountLockAwareWaitMs("locked", 15 * 60_000, 5_000), 5_000);
  assert.equal(nextAccountLockAwareWaitMs("locked", 15 * 60_000, 500), 1_000);
  assert.equal(nextAccountLockAwareWaitMs("locked", 15 * 60_000, 90_000), 30_000);
  assert.equal(nextAccountLockAwareWaitMs("no-change", 15 * 60_000, 5_000), 15 * 60_000);
  assert.throws(() => nextAccountLockAwareWaitMs("locked", 999, 5_000), /NORMAL_WAIT_INVALID/);
});
