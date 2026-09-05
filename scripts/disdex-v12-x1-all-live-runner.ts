import "dotenv/config";

import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";
import { AsterV3Client } from "../lib/aster-v3-client";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { createInterruptibleDelay } from "../lib/interruptible-delay";
import { V12AsterMarketDataProvider } from "../lib/v12-aster-market-data-provider";
import { V12LiveExecutionEngine } from "../lib/v12-live-execution-engine";
import { FileV12X1AllRunnerStateStore, type V12X1AllRunnerState } from "../lib/v12-x1-all-runner-state";
import { assertV12StrictLiveConfiguration, V12StrictAsterLiveAdapter } from "../lib/v12-strict-live-adapter";
import { classifyRunnerSafetyState, writeRunnerHeartbeat, type RunnerHeartbeat } from "../lib/disdex-runner-health";

const TWO_HOURS_MS = 2 * 60 * 60_000;
const ZERO_SHA = "0".repeat(40);

function safetyState(status: string, reason: string, liveEnabled: boolean): RunnerHeartbeat["safetyState"] {
    return classifyRunnerSafetyState(status, reason, liveEnabled);
}

function heartbeatPath(runnerId: string) {
    return process.env.DISDEX_RUNNER_HEARTBEAT_PATH || `${process.env.DISDEX_RUNNER_HEALTH_ROOT || "/var/lib/disdex/runner-health"}/${runnerId.toLowerCase()}.json`;
}

export function buildV12RunnerHeartbeat(result: { status: string; reason: string }, now = Date.now(), options: { mode: string; liveTradingEnabled: boolean; liveExecutionEnabled: boolean }) : RunnerHeartbeat {
    const liveEnabled = options.mode === "LIVE" && options.liveTradingEnabled && options.liveExecutionEnabled;
    const sha = String(process.env.DISDEX_RUNTIME_COMMIT_SHA || process.env.DISDEX_RELEASE_SHA || process.env.V12_LIVE_COMMIT_SHA || ZERO_SHA).trim().toLowerCase();
    const expectedSha = String(process.env.DISDEX_EXPECTED_RUNTIME_SHA || process.env.DISDEX_EXPECTED_SHA || "").trim().toLowerCase();
    const shaAvailable = /^[0-9a-f]{40}$/.test(sha) && sha !== ZERO_SHA && /^[0-9a-f]{40}$/.test(expectedSha) && expectedSha !== ZERO_SHA;
    const restartAttempts = Math.max(0, Number.parseInt(process.env.DISDEX_RUNNER_RESTART_ATTEMPTS || "0", 10) || 0);
    return {
        schema: "disdex-runner-heartbeat/v1", runnerId: "V12", serviceUnit: process.env.DISDEX_RUNNER_SERVICE_UNIT || "disdex-v12-x1-all.service",
        runtimeSha: /^[0-9a-f]{40}$/.test(sha) ? sha : ZERO_SHA, expectedSha: /^[0-9a-f]{40}$/.test(expectedSha) ? expectedSha : ZERO_SHA,
        workingDirectory: process.cwd(), mode: options.mode, liveEnabled, safetyState: shaAvailable ? safetyState(result.status, result.reason, liveEnabled) : "UNKNOWN",
        heartbeatAt: now, lastTickAt: now, lastReconciliationAt: null, lastDecision: result.status, reason: shaAvailable ? (result.reason || result.status) : "runtime or expected SHA unavailable",
        symbols: [], caps: { strategy: 1.5, crypto: 2, total: 2.5 }, restartAttempts, updatedAt: now,
    };
}

async function publishV12Heartbeat(result: { status: string; reason: string }, now = Date.now(), options?: { mode: string; liveTradingEnabled: boolean; liveExecutionEnabled: boolean }) {
    const runtime = options || resolveV12X1AllRuntime();
    try { await writeRunnerHeartbeat(heartbeatPath("v12"), buildV12RunnerHeartbeat(result, now, runtime)); } catch (error) { console.error(JSON.stringify({ level: "warn", event: "runner-heartbeat-write-failed", runnerId: "V12", reason: error instanceof Error ? error.message : String(error) })); }
}

function numberEnv(name: string, fallback: number) {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name: string) {
    return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

function assertExactReleaseAck() {
    const releaseSha = String(process.env.DISDEX_RELEASE_SHA || process.env.V12_LIVE_COMMIT_SHA || "").trim().toLowerCase();
    const ack = String(process.env.V12_LIVE_ACK || "").trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error("V12_LIVE_RELEASE_SHA_REQUIRED");
    if (ack !== releaseSha) throw new Error("V12_LIVE_ACK_MUST_MATCH_EXACT_RELEASE_SHA");
    return releaseSha;
}

export function v12AccountPriority(state: V12X1AllRunnerState) {
    if (state.active || (state.pending && state.pending.action !== "ENTRY")) return 1;
    return 4;
}

export async function assertV12ExactReleasePreflight(options: { cwd?: string; expectedSha?: string } = {}) {
    const cwd = options.cwd || process.cwd();
    const expectedSha = String(options.expectedSha || process.env.DISDEX_RELEASE_SHA || process.env.V12_LIVE_COMMIT_SHA || process.env.DISDEX_EXPECTED_RUNTIME_SHA || process.env.DISDEX_EXPECTED_SHA || "").trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(expectedSha) || expectedSha === ZERO_SHA) throw new Error("V12_LIVE_EXPECTED_RELEASE_SHA_REQUIRED");
    const markerPath = join(cwd, ".disdex-release-sha");
    const stats = await lstat(markerPath);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("V12_LIVE_RELEASE_MARKER_NOT_REGULAR_FILE");
    const marker = (await readFile(markerPath, "utf8")).toLowerCase();
    if (marker !== `${expectedSha}\n` && marker !== expectedSha) throw new Error("V12_LIVE_RELEASE_MARKER_SHA_MISMATCH");
    return { cwd, expectedSha } as const;
}

export async function buildV12LiveRuntime() {
    const runtime = resolveV12X1AllRuntime();
    if (!runtime.enabled) return { runtime, engine: undefined as V12LiveExecutionEngine | undefined, status: "disabled" as const };
    if (runtime.mode !== "LIVE") return { runtime, engine: undefined as V12LiveExecutionEngine | undefined, status: "non-live" as const };
    if (!runtime.liveTradingEnabled || !runtime.liveExecutionEnabled || !boolEnv("DISDEX_V12_LIVE_ALLOW_REAL_ORDERS")) {
        throw new Error("V12_LIVE_GATES_NOT_ALL_ENABLED");
    }
    await assertV12ExactReleasePreflight();
    const releaseSha = assertExactReleaseAck();
    const strict = assertV12StrictLiveConfiguration();
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: `DisDex-V12-X1-All-Strict/${releaseSha.slice(0, 12)}`,
    });
    if (!client.hasTradingCredentials()) throw new Error("V12_LIVE_REQUIRES_ASTER_CREDENTIALS");
    const adapter = new V12StrictAsterLiveAdapter(client, {
        maxSlippageBps: numberEnv("V12_X1_ALL_MAX_SLIPPAGE_BPS", 20),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const stateStore = new FileV12X1AllRunnerStateStore(runtime.statePath, runtime.mode);
    const lock = new FileAccountOrderLock(runtime.lockPath || ".runtime-state/shared/account-order.lock", numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000));
    const marketData = new V12AsterMarketDataProvider(client, { hourlyLimit: numberEnv("V12_X1_ALL_HOURLY_LIMIT", 500) });
    const engine = new V12LiveExecutionEngine({ adapter, marketData, stateStore, lock, riskPath: runtime.riskPath });
    return { runtime, status: "live" as const, engine, strict, releaseSha };
}

async function main() {
    if (process.argv.includes("--self-test")) {
        const disabled = resolveV12X1AllRuntime({ V12_X1_ALL_ENABLED: "false" });
        if (disabled.enabled || disabled.multiplier !== 1) throw new Error("V12_RUNNER_SELFTEST_FAILED");
        const base: V12X1AllRunnerState = { schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode: "LIVE", updatedAt: Date.now() };
        if (v12AccountPriority(base) !== 4) throw new Error("V12_ENTRY_PRIORITY_SELFTEST_FAILED");
        if (v12AccountPriority({ ...base, pending: { idempotencyKey: "x", action: "STOP_UPDATE", clientOrderId: "x", symbol: "ETHUSDT", side: "LONG", quantity: 1, signalTs: Date.now(), createdAt: Date.now() } }) !== 1) throw new Error("V12_RISK_REDUCTION_PRIORITY_SELFTEST_FAILED");
        console.log("V12_X1_ALL_RUNNER_SELFTEST_PASS");
        return;
    }

    const built = await buildV12LiveRuntime();
    if (built.status === "disabled") {
        await publishV12Heartbeat({ status: "disabled", reason: "V12 runtime disabled by configuration" }, Date.now(), built.runtime);
        console.log(JSON.stringify({ strategyId: "V12_X1.00_ALL", status: "disabled" }));
        return;
    }
    if (built.status !== "live" || !built.engine) {
        await publishV12Heartbeat({ status: "non-live", reason: `V12 runtime mode ${built.runtime.mode} is not live` }, Date.now(), built.runtime);
        throw new Error("V12_X1_ALL_PRODUCTION_RUNNER_REQUIRES_EXPLICIT_LIVE_ACTIVATION");
    }

    console.log(JSON.stringify({
        strategyId: built.runtime.strategyId,
        status: "live-runtime-ready",
        releaseSha: built.releaseSha,
        strictPortfolioPlannerActive: true,
        cryptoGrossCap: built.strict.cryptoGrossCap,
        totalGrossCap: built.strict.totalGrossCap,
        quality102LiveSelectorParity: false,
        quality102LiveBlockedFailClosed: true,
    }));

    const daemon = process.argv.includes("--daemon");
    const boundaryDelayMs = Math.min(30_000, Math.max(1_000, numberEnv("V12_X1_ALL_BOUNDARY_DELAY_MS", 5_000)));
    const lockRetryMs = Math.min(30_000, Math.max(1_000, numberEnv("V12_X1_ALL_LOCK_RETRY_MS", 5_000)));
    const delay = createInterruptibleDelay();
    let stopping = false;
    const stop = () => { stopping = true; delay.interrupt(); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    do {
        const result = await built.engine.tick();
        await publishV12Heartbeat(result, Date.now(), built.runtime);
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), strategyId: built.runtime.strategyId, mode: built.runtime.mode, ...result }));
        if (result.status === "manual-review") process.exitCode = 2;
        if (!daemon || stopping || result.status === "manual-review") break;
        if (result.status === "locked") {
            await delay.wait(lockRetryMs);
            continue;
        }
        const now = Date.now();
        const wait = TWO_HOURS_MS - (now % TWO_HOURS_MS) + boundaryDelayMs;
        await delay.wait(wait);
    } while (!stopping);
}

if (process.argv[1]?.endsWith("disdex-v12-x1-all-live-runner.ts")) {
    main().catch((error) => {
        void publishV12Heartbeat({ status: "fatal", reason: error instanceof Error ? error.message : String(error) });
        console.error(JSON.stringify({ level: "fatal", strategyId: "V12_X1.00_ALL", message: error instanceof Error ? error.message : String(error) }));
        process.exitCode = 1;
    });
}
