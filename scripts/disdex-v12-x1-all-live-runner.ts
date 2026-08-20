import "dotenv/config";

import { resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";
import { AsterV3Client } from "../lib/aster-v3-client";
import { DEFAULT_ACCOUNT_SCOPE, FileAccountOrderLock, type AccountLockHandle } from "../lib/disdex-account-order-lock";
import { createInterruptibleDelay } from "../lib/interruptible-delay";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import { V12AsterMarketDataProvider } from "../lib/v12-aster-market-data-provider";
import { V12LiveExecutionEngine } from "../lib/v12-live-execution-engine";
import { FileV12X1AllRunnerStateStore, type V12X1AllRunnerState } from "../lib/v12-x1-all-runner-state";

const TWO_HOURS_MS = 2 * 60 * 60_000;
function numberEnv(name: string, fallback: number) { const parsed = Number(process.env[name]); return Number.isFinite(parsed) ? parsed : fallback; }
function boolEnv(name: string) { return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim()); }

export function v12AccountPriority(state: V12X1AllRunnerState) {
    // Active-position work includes resident protection/trailing/reduce-only exit
    // and therefore receives P1. Recovery of EXIT/STOP_UPDATE/FAILSAFE_CLOSE is
    // also P1. A flat or pending ENTRY attempt is lowest-priority P4.
    if (state.active || (state.pending && state.pending.action !== "ENTRY")) return 1;
    return 4;
}

class V12PriorityAccountOrderLock extends FileAccountOrderLock {
    constructor(
        path: string,
        leaseMs: number,
        private readonly stateStore: FileV12X1AllRunnerStateStore,
        recovery: { ownerPrefix: string; strategyId: string; pendingStatePath: string },
    ) {
        super(path, leaseMs, recovery);
    }

    override async acquire(ownerId: string, accountScope = DEFAULT_ACCOUNT_SCOPE): Promise<AccountLockHandle | null> {
        const state = await this.stateStore.load();
        const priority = v12AccountPriority(state);
        const prioritizedOwner = ownerId.startsWith("V12_X1.00_ALL:")
            ? ownerId.replace("V12_X1.00_ALL:", `V12_X1.00_ALL:P${priority}:`)
            : `V12_X1.00_ALL:P${priority}:${process.pid}:${ownerId}`;
        return super.acquire(prioritizedOwner, accountScope);
    }
}

export async function buildV12LiveRuntime() {
    const runtime = resolveV12X1AllRuntime();
    if (!runtime.enabled) return { runtime, engine: undefined as V12LiveExecutionEngine | undefined, status: "disabled" as const };
    if (runtime.mode !== "LIVE") return { runtime, engine: undefined as V12LiveExecutionEngine | undefined, status: "non-live" as const };
    if (!runtime.liveTradingEnabled || !runtime.liveExecutionEnabled || !boolEnv("DISDEX_V12_LIVE_ALLOW_REAL_ORDERS")) {
        throw new Error("V12_LIVE_GATES_NOT_ALL_ENABLED");
    }
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V12-X1-All/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("V12_LIVE_REQUIRES_ASTER_CREDENTIALS");
    const adapter = new V12AsterLiveAdapter(client, {
        maxSlippageBps: numberEnv("V12_X1_ALL_MAX_SLIPPAGE_BPS", 20),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const stateStore = new FileV12X1AllRunnerStateStore(runtime.statePath, runtime.mode);
    const lock = new V12PriorityAccountOrderLock(
        runtime.lockPath || ".runtime-state/shared/account-order.lock",
        numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000),
        stateStore,
        {
            ownerPrefix: "V12_X1.00_ALL:",
            strategyId: "V12_X1.00_ALL",
            pendingStatePath: runtime.statePath,
        },
    );
    const marketData = new V12AsterMarketDataProvider(client, { hourlyLimit: numberEnv("V12_X1_ALL_HOURLY_LIMIT", 500) });
    return { runtime, status: "live" as const, engine: new V12LiveExecutionEngine({ adapter, marketData, stateStore, lock, riskPath: runtime.riskPath }) };
}

async function main() {
    if (process.argv.includes("--self-test")) {
        const disabled = resolveV12X1AllRuntime({ V12_X1_ALL_ENABLED: "false" });
        if (disabled.enabled || disabled.multiplier !== 1.5) throw new Error("V12_RUNNER_SELFTEST_FAILED");
        const base: V12X1AllRunnerState = { schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode: "LIVE", updatedAt: Date.now() };
        if (v12AccountPriority(base) !== 4) throw new Error("V12_ENTRY_PRIORITY_SELFTEST_FAILED");
        if (v12AccountPriority({ ...base, pending: { idempotencyKey: "x", action: "STOP_UPDATE", clientOrderId: "x", symbol: "ETHUSDT", side: "LONG", quantity: 1, signalTs: Date.now(), createdAt: Date.now() } }) !== 1) throw new Error("V12_RISK_REDUCTION_PRIORITY_SELFTEST_FAILED");
        console.log("V12_X1_ALL_RUNNER_SELFTEST_PASS"); return;
    }
    const built = await buildV12LiveRuntime();
    if (built.status === "disabled") { console.log(JSON.stringify({ strategyId: "V12_X1.00_ALL", status: "disabled" })); return; }
    if (built.status !== "live" || !built.engine) throw new Error("V12_X1_ALL production runner only accepts explicit LIVE activation; PAPER/SHADOW use research tooling.");
    const daemon = process.argv.includes("--daemon");
    const boundaryDelayMs = Math.min(30_000, Math.max(1_000, numberEnv("V12_X1_ALL_BOUNDARY_DELAY_MS", 5_000)));
    const lockRetryMs = Math.min(30_000, Math.max(1_000, numberEnv("V12_X1_ALL_LOCK_RETRY_MS", 5_000)));
    const delay = createInterruptibleDelay(); let stopping = false; const stop = () => { stopping = true; delay.interrupt(); };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    do {
        const result = await built.engine.tick();
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), strategyId: built.runtime.strategyId, mode: built.runtime.mode, ...result }));
        if (result.status === "manual-review") process.exitCode = 2;
        if (!daemon || stopping || result.status === "manual-review") break;
        if (result.status === "locked") {
            await delay.wait(lockRetryMs);
            continue;
        }
        const now = Date.now(); const wait = TWO_HOURS_MS - (now % TWO_HOURS_MS) + boundaryDelayMs; await delay.wait(wait);
    } while (!stopping);
}

main().catch((error) => { console.error(JSON.stringify({ level: "fatal", strategyId: "V12_X1.00_ALL", message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
