import assert from "node:assert/strict";
import { resolveQuality102CausalV1Runtime } from "../config/disdexQuality102CausalV1Runtime";

const inert = resolveQuality102CausalV1Runtime({});
assert.equal(inert.mode, "SHADOW");
assert.equal(inert.enabled, false);
assert.equal(inert.liveTradingEnabled, false);
assert.equal(inert.liveExecutionEnabled, false);
assert.equal(inert.operatorArmed, false);
assert.equal(inert.historicalSelectorParity, false);

const live = resolveQuality102CausalV1Runtime({
  QUALITY102_CAUSAL_V1_MODE: "LIVE",
  QUALITY102_CAUSAL_V1_ENABLED: "true",
  QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED: "true",
  QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED: "true",
  QUALITY102_CAUSAL_V1_OPERATOR_ARMED: "true",
  QUALITY102_CAUSAL_V1_MAX_GROSS: "9",
});
assert.equal(live.maximumGross, 0.5);
assert.equal(live.historicalSelectorParity, false);
console.log("QUALITY102_CAUSAL_V1_RUNTIME_SELFTEST_PASS");
