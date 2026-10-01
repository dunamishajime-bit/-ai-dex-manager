import "dotenv/config";

import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor } from "../lib/direct-trade-executor";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { createInterruptibleDelay } from "../lib/interruptible-delay";
import { nextAccountLockAwareWaitMs } from "../lib/disdex-account-lock-retry-scheduling";
import { IdlePriorityAsterMarketDataProvider } from "../lib/idle-priority-short-market-data";
import { IdlePriorityShortRunner, idleRunnerSelfTest } from "../lib/idle-priority-short-runner";
import { FileIdlePriorityShortStateStore } from "../lib/idle-priority-short-state";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import { resolveIdlePriorityShortRuntime } from "../config/idlePriorityShortRuntime";

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

async function main() {
    if (process.argv.includes("--self-test")) {
        process.env.DISDEX_RUNTIME_SHA ||= "0000000000000000000000000000000000000000";
        process.env.DISDEX_IDLE_PRIORITY_MODE ||= "SHADOW";
        process.env.DISDEX_IDLE_PRIORITY_ENABLED ||= "true";
    }
    const runtime = resolveIdlePriorityShortRuntime();
    if (process.argv.includes("--self-test")) {
        idleRunnerSelfTest();
        console.log(JSON.stringify({ event: "idle-priority-short-selftest", status: "PASS", mode: runtime.mode, enabled: runtime.enabled, liveOrders: 0, cancelOrders: 0, positionChanges: 0 }));
        return;
    }
    if (!runtime.enabled) {
        console.log(JSON.stringify({ event: "idle-priority-short-runtime", status: "disabled", mode: runtime.mode, runtimeSha: runtime.runtimeSha, liveOrders: 0, cancelOrders: 0, positionChanges: 0 }));
        return;
    }

    process.env.DISDEX_TRADE_FILL_STRATEGY_ID = "IDLE_PRIORITY_SHORT";
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5_000),
        userAgent: `DisDex-IdlePriorityShort/${runtime.runtimeSha.slice(0, 12)}`,
    });
    if (!client.hasTradingCredentials()) throw new Error("IDLE_PRIORITY_SHORT_REQUIRES_ASTER_CREDENTIALS");
    const executor = new AsterDirectTradeExecutor(client, {
        exchangeInfoTtlMs: numberEnv("ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1_500),
    });
    const adapter = new V12AsterLiveAdapter(client, {
        maxSlippageBps: runtime.maximumSlippageBps,
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1_500),
        readRequestSpacingMs: numberEnv("V12_X1_ALL_REQUEST_SPACING_MS", 100),
    });
    const runner = new IdlePriorityShortRunner({
        marketData: new IdlePriorityAsterMarketDataProvider(client, { limit: numberEnv("DISDEX_IDLE_PRIORITY_H1_LIMIT", 160) }),
        executor,
        adapter,
        client,
        stateStore: new FileIdlePriorityShortStateStore(runtime.statePath, runtime.runtimeSha),
        lock: new FileAccountOrderLock(runtime.lockPath, numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000), runtime.pendingExposurePath),
        runtime,
    });

    const daemon = process.argv.includes("--daemon");
    const delay = createInterruptibleDelay();
    let stopping = false;
    const stop = () => { stopping = true; delay.interrupt(); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    do {
        const result = await runner.tick();
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), event: "idle-priority-short-tick", strategyId: "IDLE_PRIORITY_SHORT", mode: runtime.mode, runtimeSha: runtime.runtimeSha, ...result }));
        if (!daemon || stopping || result.status === "manual-review") break;
        const normalWaitMs = Math.max(5_000, Math.min(15 * 60_000, runtime.pollMs));
        const lockRetryMs = numberEnv("DISDEX_IDLE_PRIORITY_LOCK_RETRY_MS", 8_000);
        await delay.wait(nextAccountLockAwareWaitMs(result.status, normalWaitMs, lockRetryMs));
    } while (!stopping);
}

main().catch((error) => {
    console.error(JSON.stringify({ level: "fatal", event: "idle-priority-short-runner", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    process.exitCode = 1;
});
