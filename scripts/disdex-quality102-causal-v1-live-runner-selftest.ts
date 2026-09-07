import assert from "node:assert/strict";

import {
    assertQuality102CausalV1LiveActivation,
    assertQuality102CausalV1ReadOnlyPreflightConfiguration,
    parseQuality102CausalV1Symbols,
    resolveQuality102CausalV1LiveConfig,
    shouldRunQuality102CausalV1PreflightHistoryCheck,
} from "./disdex-quality102-causal-v1-live-runner";

const SHA = "a".repeat(40);

const baseEnv: NodeJS.ProcessEnv = {
    QUALITY102_CAUSAL_V1_MODE: "LIVE",
    QUALITY102_CAUSAL_V1_ENABLED: "true",
    QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED: "true",
    QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED: "true",
    QUALITY102_CAUSAL_V1_OPERATOR_ARMED: "true",
    QUALITY102_CAUSAL_V1_SELECTOR_MODE: "CAUSAL_V4",
    QUALITY102_CAUSAL_V1_LIVE_ACK: SHA,
    QUALITY102_CAUSAL_V1_SYMBOLS: "SUIUSDT,OPUSDT,SEIUSDT",
    DISDEX_RUNTIME_COMMIT_SHA: SHA,
};

assert.deepEqual(parseQuality102CausalV1Symbols("OPUSDT, suiUSDT,OPUSDT"), ["OPUSDT", "SUIUSDT"]);
assert.throws(() => parseQuality102CausalV1Symbols("BTCUSDT"), /UNSAFE_BASE_OVERLAP/);
const config = resolveQuality102CausalV1LiveConfig(baseEnv);
assert.deepEqual(config.highVolSymbols, ["OPUSDT", "SEIUSDT", "SUIUSDT"]);
assert.ok(config.symbols.includes("FETUSDT"));
assert.ok(config.symbols.includes("AVAXUSDT"));
assert.ok(config.symbols.includes("AAVEUSDT"));
assert.ok(config.symbols.length > config.highVolSymbols.length);
assert.equal(config.maximumGross, 1);
assert.equal(config.cryptoGrossCap, 2);
assert.equal(config.totalGrossCap, 2.5);
assert.doesNotThrow(() => assertQuality102CausalV1LiveActivation(config, baseEnv));
assert.equal(shouldRunQuality102CausalV1PreflightHistoryCheck(baseEnv), true);
assert.equal(shouldRunQuality102CausalV1PreflightHistoryCheck({ ...baseEnv, QUALITY102_CAUSAL_V1_PREFLIGHT_HISTORY_CHECK: "false" }), false);
assert.equal(shouldRunQuality102CausalV1PreflightHistoryCheck({ ...baseEnv, PREFLIGHT_HISTORY_CHECK: "false" }), false);
assert.throws(() => assertQuality102CausalV1LiveActivation({ ...config, selectorMode: "HISTORICAL_FROZEN" }, baseEnv), /SELECTOR_MODE_ACK/);
assert.throws(() => assertQuality102CausalV1LiveActivation({ ...config, runtimeCommitSha: "" }, baseEnv), /COMMIT_SHA_REQUIRED/);

const preflightEnv: NodeJS.ProcessEnv = {
    ...baseEnv,
    QUALITY102_CAUSAL_V1_ENABLED: "false",
    QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED: "false",
    QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED: "false",
    QUALITY102_CAUSAL_V1_OPERATOR_ARMED: "false",
};
const preflightConfig = resolveQuality102CausalV1LiveConfig(preflightEnv);
assert.doesNotThrow(() => assertQuality102CausalV1ReadOnlyPreflightConfiguration(preflightConfig, preflightEnv));
assert.throws(() => assertQuality102CausalV1LiveActivation(preflightConfig, preflightEnv), /LIVE_GATES_NOT_ALL_ENABLED/);

console.log("QUALITY102_CAUSAL_V1_LIVE_RUNNER_SELFTEST_PASS", JSON.stringify({ ordersSent: 0, syntheticOrders: 0, testOrders: 0 }));
