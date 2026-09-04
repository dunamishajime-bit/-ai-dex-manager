import assert from "node:assert/strict";

import {
    assertQuality102CausalV1LiveActivation,
    parseQuality102CausalV1Symbols,
    resolveQuality102CausalV1LiveConfig,
} from "./disdex-quality102-causal-v1-live-runner";

const SHA = "a".repeat(40);

const baseEnv: NodeJS.ProcessEnv = {
    QUALITY102_CAUSAL_V1_MODE: "LIVE",
    QUALITY102_CAUSAL_V1_ENABLED: "true",
    QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED: "true",
    QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED: "true",
    QUALITY102_CAUSAL_V1_OPERATOR_ARMED: "true",
    QUALITY102_CAUSAL_V1_SELECTOR_MODE: "DERIVED_HIGH_VOL_ONLY",
    QUALITY102_CAUSAL_V1_LIVE_ACK: SHA,
    QUALITY102_CAUSAL_V1_SYMBOLS: "SUIUSDT,OPUSDT,SEIUSDT",
    DISDEX_RUNTIME_COMMIT_SHA: SHA,
};

assert.deepEqual(parseQuality102CausalV1Symbols("OPUSDT, suiUSDT,OPUSDT"), ["OPUSDT", "SUIUSDT"]);
assert.throws(() => parseQuality102CausalV1Symbols("BTCUSDT"), /UNSAFE_BASE_OVERLAP/);
const config = resolveQuality102CausalV1LiveConfig(baseEnv);
assert.equal(config.maximumGross, 0.5);
assert.equal(config.cryptoGrossCap, 2);
assert.equal(config.totalGrossCap, 2.5);
assert.doesNotThrow(() => assertQuality102CausalV1LiveActivation(config, baseEnv));
assert.throws(() => assertQuality102CausalV1LiveActivation({ ...config, selectorMode: "HISTORICAL_FROZEN" }, baseEnv), /SELECTOR_MODE_ACK/);
assert.throws(() => assertQuality102CausalV1LiveActivation({ ...config, runtimeCommitSha: "" }, baseEnv), /COMMIT_SHA_REQUIRED/);
console.log("QUALITY102_CAUSAL_V1_LIVE_RUNNER_SELFTEST_PASS", JSON.stringify({ ordersSent: 0, syntheticOrders: 0, testOrders: 0 }));
