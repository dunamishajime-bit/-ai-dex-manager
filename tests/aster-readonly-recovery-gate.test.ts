import { strict as assert } from "node:assert";
import test from "node:test";

import { runAsterReadOnlyRecoveryGate } from "../lib/aster-readonly-recovery-gate";

type Position = { symbol: string; positionAmt: string };

function healthyClient(overrides: Partial<Record<"ping" | "getBalances" | "getPositions" | "getOpenOrders", () => Promise<unknown>>> = {}) {
    const calls: string[] = [];
    const client = {
        async ping() { calls.push("ping"); return {}; },
        async getBalances() { calls.push("balances"); return []; },
        async getPositions() { calls.push("positions"); return [{ symbol: "BTCUSDT", positionAmt: "0" }] as Position[]; },
        async getOpenOrders() { calls.push("openOrders"); return []; },
        ...Object.fromEntries(Object.entries(overrides).map(([name, fn]) => [name, async () => { calls.push(name); return fn!(); }])),
    };
    return { client, calls };
}

test("requires three serial authenticated read-only successes before recovery passes", async () => {
    const { client, calls } = healthyClient();
    const sleeps: number[] = [];
    const result = await runAsterReadOnlyRecoveryGate(client, {
        requiredConsecutiveSuccesses: 3,
        requestSpacingMs: 10,
        roundSpacingMs: 50,
        sleep: async (ms) => { sleeps.push(ms); },
    });

    assert.equal(result.consecutiveSuccesses, 3);
    assert.equal(result.openPositionCount, 0);
    assert.equal(result.openOrderCount, 0);
    assert.equal(result.ordersSent, false);
    assert.equal(result.cancelSent, false);
    assert.equal(result.positionChangesSent, false);
    assert.deepEqual(calls, [
        "ping", "balances", "positions", "openOrders",
        "ping", "balances", "positions", "openOrders",
        "ping", "balances", "positions", "openOrders",
    ]);
    assert.deepEqual(sleeps, [10, 10, 10, 50, 10, 10, 10, 50, 10, 10, 10]);
});

test("a 429 in any round fails the streak immediately instead of counting earlier successes", async () => {
    let positionCalls = 0;
    const { client, calls } = healthyClient({
        getPositions: async () => {
            positionCalls += 1;
            if (positionCalls === 2) throw new Error("Aster HTTP 429 [ASTER_READ path=/fapi/v3/positionRisk]");
            return [{ symbol: "BTCUSDT", positionAmt: "0" }] as Position[];
        },
    });

    await assert.rejects(
        () => runAsterReadOnlyRecoveryGate(client, {
            requiredConsecutiveSuccesses: 3,
            requestSpacingMs: 0,
            roundSpacingMs: 0,
            sleep: async () => undefined,
        }),
        /ASTER_READONLY_RECOVERY_ROUND_FAILED:round=2:.*429/,
    );
    assert.deepEqual(calls, [
        "ping", "balances", "getPositions", "openOrders",
        "ping", "balances", "getPositions",
    ]);
});

test("flatness is part of the recovery proof", async () => {
    const { client } = healthyClient({
        getPositions: async () => [{ symbol: "ETHUSDT", positionAmt: "0.01" }] as Position[],
    });
    await assert.rejects(
        () => runAsterReadOnlyRecoveryGate(client, {
            requiredConsecutiveSuccesses: 3,
            requestSpacingMs: 0,
            roundSpacingMs: 0,
            sleep: async () => undefined,
        }),
        /ASTER_READONLY_RECOVERY_NOT_FLAT:round=1:positions=1:orders=0/,
    );
});
