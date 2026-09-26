import test from "node:test";
import assert from "node:assert/strict";

import { assertHypeZecLiveGate, resolveHypeZecLongRuntime } from "../config/hypeZecLongRuntime";

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
