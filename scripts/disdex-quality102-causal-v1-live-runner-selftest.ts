import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    assertQuality102CausalV1LiveActivation,
    buildQuality102RunnerHeartbeat,
    parseQuality102CausalV1Symbols,
    publishQuality102FatalHeartbeat,
    resolveQuality102CausalV1LiveConfig,
} from "./disdex-quality102-causal-v1-live-runner";
import { readRunnerHeartbeat } from "../lib/disdex-runner-health";

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
    DISDEX_EXPECTED_RUNTIME_SHA: SHA,
};

assert.deepEqual(parseQuality102CausalV1Symbols("OPUSDT, suiUSDT,OPUSDT"), ["OPUSDT", "SUIUSDT"]);
assert.throws(() => parseQuality102CausalV1Symbols("BTCUSDT"), /UNSAFE_BASE_OVERLAP/);
async function main() {
    const config = resolveQuality102CausalV1LiveConfig(baseEnv);
    assert.equal(config.expectedRuntimeCommitSha, SHA);
    assert.equal(config.maximumGross, 0.5);
    assert.equal(config.cryptoGrossCap, 2);
    assert.equal(config.totalGrossCap, 2.5);
    assert.doesNotThrow(() => assertQuality102CausalV1LiveActivation(config, baseEnv));
    assert.throws(() => assertQuality102CausalV1LiveActivation({ ...config, selectorMode: "HISTORICAL_FROZEN" }, baseEnv), /SELECTOR_MODE_ACK/);
    assert.throws(() => assertQuality102CausalV1LiveActivation({ ...config, runtimeCommitSha: "" }, baseEnv), /COMMIT_SHA_REQUIRED/);
    const buildHeartbeatWithState = buildQuality102RunnerHeartbeat as unknown as (...args: unknown[]) => { lastReconciliationAt: number | null };
    const reconciledAt = 1_757_000_000_123;
    assert.equal(
        buildHeartbeatWithState(
            { status: "held", message: "fixture" },
            config,
            reconciledAt,
            { lastReconciledAt: reconciledAt },
        ).lastReconciliationAt,
        reconciledAt,
    );
    const missingExpectedConfig = resolveQuality102CausalV1LiveConfig({
        ...baseEnv,
        DISDEX_EXPECTED_RUNTIME_SHA: undefined,
        DISDEX_EXPECTED_SHA: undefined,
    });
    assert.equal(missingExpectedConfig.runtimeCommitSha, SHA);
    assert.equal(missingExpectedConfig.expectedRuntimeCommitSha, "");

    const tempRoot = await mkdtemp(join(tmpdir(), "disdex-q102-fatal-selftest-"));
    const fatalHeartbeatPath = join(tempRoot, "quality102-causal-v1.json");
    try {
        const invalidConfigEnv = {
            ...baseEnv,
            QUALITY102_CAUSAL_V1_SYMBOLS: "BTCUSDT",
            DISDEX_RUNNER_HEARTBEAT_PATH: fatalHeartbeatPath,
        };
        await assert.doesNotReject(() => publishQuality102FatalHeartbeat(new Error("fatal fixture"), invalidConfigEnv));
        const heartbeat = await readRunnerHeartbeat(fatalHeartbeatPath);
        assert.equal(heartbeat?.runnerId, "QUALITY102_CAUSAL_V1");
        assert.equal(heartbeat?.safetyState, "UNKNOWN");
        assert.equal(heartbeat?.liveEnabled, false);
        assert.equal(heartbeat?.lastDecision, "fatal");
        assert.deepEqual(heartbeat?.symbols, []);
        assert.deepEqual(heartbeat?.caps, { strategy: 0.5, crypto: 2, total: 2.5 });
        assert.deepEqual(heartbeat?.quality102, {
            selectorMode: "DERIVED_HIGH_VOL_ONLY",
            historicalSelectorParity: false,
            brkLiveEnabled: false,
        });
        assert.equal(heartbeat?.reason, "QUALITY102_CAUSAL_V1_FATAL_FAIL_CLOSED");
    } finally {
        await rm(tempRoot, { recursive: true, force: true });
    }

    console.log("QUALITY102_CAUSAL_V1_LIVE_RUNNER_SELFTEST_PASS", JSON.stringify({ ordersSent: 0, syntheticOrders: 0, testOrders: 0 }));
}

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
