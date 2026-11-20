import assert from "node:assert/strict";
import test from "node:test";

import {
    assertQuality102CausalV1MonitorOnlyEnvironment,
    buildQuality102CausalV1MonitorHeartbeat,
} from "../scripts/disdex-quality102-causal-v1-monitor";

const SHA = "a".repeat(40);

test("Q102 monitor requires every live order gate to be disabled", () => {
    const env: NodeJS.ProcessEnv = {
        NODE_ENV: "production",
        QUALITY102_CAUSAL_V1_MODE: "LIVE",
        QUALITY102_CAUSAL_V1_MONITOR_ONLY: "true",
        QUALITY102_CAUSAL_V1_ENABLED: "false",
        QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED: "false",
        QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED: "false",
        QUALITY102_CAUSAL_V1_OPERATOR_ARMED: "false",
        DISDEX_RUNTIME_COMMIT_SHA: SHA,
    };
    assert.doesNotThrow(() => assertQuality102CausalV1MonitorOnlyEnvironment(env));
    assert.throws(
        () => assertQuality102CausalV1MonitorOnlyEnvironment({
            ...env,
            QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED: "true",
        }),
        /MONITOR_LIVE_EXECUTION_MUST_BE_DISABLED/,
    );
});

test("Q102 monitor heartbeat is explicitly non-authorizing and pinned", () => {
    const heartbeat = buildQuality102CausalV1MonitorHeartbeat({
        runtimeSha: SHA,
        pid: 1234,
        workingDirectory: `/home/deploy/disdex-trading/releases/${SHA}`,
        serviceUnit: `disdex-quality102-causal-v1@${SHA}.service`,
        status: "observing",
        outcome: "QUALITY102_CAUSAL_V1_READ_ONLY_PREFLIGHT_PASS",
        positionCount: 0,
        openOrderCount: 0,
        observedAt: "2026-11-21T00:00:00.000Z",
    });
    assert.equal(heartbeat.runnerId, "QUALITY102_CAUSAL_V1");
    assert.equal(heartbeat.mode, "MONITOR_ONLY");
    assert.equal(heartbeat.newOrdersAllowed, false);
    assert.equal(heartbeat.permissionEvaluation, "MONITOR_ONLY_NO_ORDER_PATH");
    assert.equal(heartbeat.runtimeSha, SHA);
    assert.equal(heartbeat.serviceUnit, `disdex-quality102-causal-v1@${SHA}.service`);
    assert.deepEqual(
        {
            ordersSent: heartbeat.ordersSent,
            cancelsSent: heartbeat.cancelsSent,
            positionChangesSent: heartbeat.positionChangesSent,
        },
        { ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 },
    );
});

test("Q102 monitor rejects a non-observing heartbeat as healthy", () => {
    assert.throws(
        () => buildQuality102CausalV1MonitorHeartbeat({
            runtimeSha: SHA,
            pid: 1234,
            workingDirectory: `/home/deploy/disdex-trading/releases/${SHA}`,
            serviceUnit: `disdex-quality102-causal-v1@${SHA}.service`,
            status: "blocked",
            outcome: "PREFLIGHT_FAILED",
            reason: "READ_ONLY_PREFLIGHT_FAILED",
            positionCount: 0,
            openOrderCount: 0,
            observedAt: "2026-11-21T00:00:00.000Z",
        }),
        /MONITOR_HEARTBEAT_STATUS_INVALID/,
    );
});
