import "dotenv/config";

import { open, rename, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
    classifyQ102PreflightRateBudgetDeferral,
    runQuality102CausalV1ReadOnlyPreflight,
} from "./disdex-quality102-causal-v1-live-runner";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DEFAULT_HEARTBEAT_PATH = "/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json";
const DEFAULT_TICK_PATH = "/var/lib/disdex/runner-health/ticks/quality102-causal-v1.json";
const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MS = 5_000;
const SERVICE_PREFIX = "disdex-quality102-causal-v1@";

type MonitorStatus = "observing";

export interface Quality102CausalV1MonitorHeartbeat {
    schema: "disdex-runner-tick/v1";
    runnerId: "QUALITY102_CAUSAL_V1";
    runtimeSha: string;
    expectedSha: string;
    serviceUnit: string;
    mainPid: number;
    workingDirectory: string;
    tickStartedAt: number;
    tickCompletedAt: number;
    updatedAt: number;
    observedAt: number;
    status: MonitorStatus;
    outcome: string;
    reason: string;
    mode: "MONITOR_ONLY";
    newOrdersAllowed: false;
    permissionEvaluation: "MONITOR_ONLY_NO_ORDER_PATH";
    ordersSent: 0;
    cancelsSent: 0;
    positionChangesSent: 0;
    positionCount: number;
    openOrderCount: number;
    stateChanged: false;
}

export interface Quality102CausalV1MonitorHeartbeatInput {
    runtimeSha: string;
    pid: number;
    workingDirectory: string;
    serviceUnit: string;
    status: MonitorStatus | string;
    outcome: string;
    reason?: string;
    positionCount: number;
    openOrderCount: number;
    observedAt: number | string;
    tickStartedAt?: number;
    tickCompletedAt?: number;
}

function boolEnv(env: NodeJS.ProcessEnv, name: string): boolean {
    return /^(1|true|yes|on)$/i.test(String(env[name] || "").trim());
}

function requiredRuntimeSha(env: NodeJS.ProcessEnv): string {
    return String(env.DISDEX_RUNTIME_COMMIT_SHA || env.DISDEX_RELEASE_SHA || "").trim().toLowerCase();
}

function requireSha(value: string, name: string): string {
    const sha = String(value || "").trim().toLowerCase();
    if (!SHA_PATTERN.test(sha)) throw new Error(`${name}_INVALID`);
    return sha;
}

/**
 * This guard is deliberately stricter than the live runner's preflight guard.
 * A monitor process must never inherit an enabled live flag from an old
 * EnvironmentFile or accidentally become an order-capable runner after a
 * systemd drop-in is removed.
 */
export function assertQuality102CausalV1MonitorOnlyEnvironment(
    env: NodeJS.ProcessEnv = process.env,
): void {
    if (!boolEnv(env, "QUALITY102_CAUSAL_V1_MONITOR_ONLY")) {
        throw new Error("QUALITY102_MONITOR_ONLY_FLAG_REQUIRED");
    }
    if (String(env.QUALITY102_CAUSAL_V1_MODE || "").trim().toUpperCase() !== "LIVE") {
        throw new Error("QUALITY102_MONITOR_LIVE_MODE_REQUIRED");
    }
    const forbiddenFlags: Array<[string, string]> = [
        ["QUALITY102_CAUSAL_V1_ENABLED", "ENABLED"],
        ["QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED", "LIVE_TRADING"],
        ["QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED", "LIVE_EXECUTION"],
        ["QUALITY102_CAUSAL_V1_OPERATOR_ARMED", "OPERATOR_ARMED"],
    ];
    for (const [name, label] of forbiddenFlags) {
        if (boolEnv(env, name)) throw new Error(`QUALITY102_MONITOR_${label}_MUST_BE_DISABLED`);
    }
    requireSha(requiredRuntimeSha(env), "QUALITY102_MONITOR_RUNTIME_SHA");
}

function serviceUnitForSha(sha: string): string {
    return `${SERVICE_PREFIX}${sha}.service`;
}

function assertNonNegativeInteger(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name}_INVALID`);
}

function asTimestamp(value: number | string | undefined, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === "string" && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

/**
 * Build the only healthy heartbeat shape this entrypoint can publish. A
 * blocked/failed read is intentionally not representable by this function;
 * callers publish a separate blocked record which the root cutover rejects.
 */
export function buildQuality102CausalV1MonitorHeartbeat(
    input: Quality102CausalV1MonitorHeartbeatInput,
): Quality102CausalV1MonitorHeartbeat {
    const runtimeSha = requireSha(input.runtimeSha, "QUALITY102_MONITOR_RUNTIME_SHA");
    const serviceUnit = String(input.serviceUnit || "").trim();
    if (serviceUnit !== serviceUnitForSha(runtimeSha)) throw new Error("QUALITY102_MONITOR_SERVICE_UNIT_MISMATCH");
    if (input.status !== "observing") throw new Error("MONITOR_HEARTBEAT_STATUS_INVALID");
    if (!Number.isInteger(input.pid) || input.pid <= 0) throw new Error("QUALITY102_MONITOR_PID_INVALID");
    assertNonNegativeInteger(input.positionCount, "QUALITY102_MONITOR_POSITION_COUNT");
    assertNonNegativeInteger(input.openOrderCount, "QUALITY102_MONITOR_OPEN_ORDER_COUNT");
    const completed = asTimestamp(input.tickCompletedAt, asTimestamp(input.observedAt, Date.now()));
    const started = asTimestamp(input.tickStartedAt, completed);
    const reason = String(input.reason || input.outcome || "QUALITY102_CAUSAL_V1_READ_ONLY_PREFLIGHT_PASS").slice(0, 240);
    return {
        schema: "disdex-runner-tick/v1",
        runnerId: "QUALITY102_CAUSAL_V1",
        runtimeSha,
        expectedSha: runtimeSha,
        serviceUnit,
        mainPid: input.pid,
        workingDirectory: resolve(String(input.workingDirectory || process.cwd())),
        tickStartedAt: started,
        tickCompletedAt: completed,
        updatedAt: completed,
        observedAt: asTimestamp(input.observedAt, completed),
        status: "observing",
        outcome: String(input.outcome || "QUALITY102_CAUSAL_V1_READ_ONLY_PREFLIGHT_PASS").slice(0, 160),
        reason,
        mode: "MONITOR_ONLY",
        newOrdersAllowed: false,
        permissionEvaluation: "MONITOR_ONLY_NO_ORDER_PATH",
        ordersSent: 0,
        cancelsSent: 0,
        positionChangesSent: 0,
        positionCount: input.positionCount,
        openOrderCount: input.openOrderCount,
        stateChanged: false,
    };
}

function buildBlockedHeartbeat(runtimeSha: string, reason: string, started: number, completed: number): Record<string, unknown> {
    const sha = SHA_PATTERN.test(runtimeSha) ? runtimeSha : "";
    return {
        schema: "disdex-runner-tick/v1",
        runnerId: "QUALITY102_CAUSAL_V1",
        runtimeSha: sha,
        expectedSha: sha,
        serviceUnit: sha ? serviceUnitForSha(sha) : "",
        mainPid: process.pid,
        workingDirectory: resolve(process.env.DISDEX_RELEASE_ROOT || process.cwd()),
        tickStartedAt: started,
        tickCompletedAt: completed,
        updatedAt: completed,
        observedAt: completed,
        status: "blocked",
        outcome: "QUALITY102_CAUSAL_V1_MONITOR_BLOCKED",
        reason: reason.replace(/\s+/g, " ").slice(0, 240),
        mode: "MONITOR_ONLY",
        newOrdersAllowed: false,
        permissionEvaluation: "MONITOR_ONLY_NO_ORDER_PATH",
        ordersSent: 0,
        cancelsSent: 0,
        positionChangesSent: 0,
        positionCount: 0,
        openOrderCount: 0,
        stateChanged: false,
    };
}

async function assertRegularDirectory(path: string): Promise<void> {
    const parent = await lstat(path);
    if (!parent.isDirectory()) throw new Error("QUALITY102_MONITOR_OUTPUT_PARENT_INVALID");
}

async function writeAtomicJson(path: string, value: object): Promise<void> {
    const absolute = resolve(path);
    const parent = dirname(absolute);
    await assertRegularDirectory(parent);
    const base = `${absolute}.tmp-${process.pid}-${Date.now()}`;
    const handle = await open(base, "wx", 0o640);
    try {
        await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
    await rename(base, absolute);
}

async function publish(heartbeat: object): Promise<void> {
    const heartbeatPath = process.env.QUALITY102_CAUSAL_V1_MONITOR_HEALTH_PATH || DEFAULT_HEARTBEAT_PATH;
    const tickPath = process.env.QUALITY102_CAUSAL_V1_MONITOR_TICK_PATH || DEFAULT_TICK_PATH;
    await writeAtomicJson(tickPath, heartbeat);
    await writeAtomicJson(heartbeatPath, heartbeat);
}

function safeReason(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    return raw
        .replace(/(token|secret|password|passwd|authorization|bearer|api[_-]?key|credential|signature)=[^\s]*/gi, "$1=<redacted>")
        .replace(/\s+/g, " ")
        .slice(0, 240);
}

async function runOnce(): Promise<boolean> {
    const started = Date.now();
    const runtimeSha = requiredRuntimeSha(process.env);
    try {
        assertQuality102CausalV1MonitorOnlyEnvironment(process.env);
        const result = await runQuality102CausalV1ReadOnlyPreflight(process.env);
        if (result.status !== "QUALITY102_CAUSAL_V1_READ_ONLY_PREFLIGHT_PASS") {
            throw new Error(`QUALITY102_MONITOR_PREFLIGHT_NOT_PASS:${String(result.status || "UNKNOWN")}`);
        }
        const completed = Date.now();
        const heartbeat = buildQuality102CausalV1MonitorHeartbeat({
            runtimeSha,
            pid: process.pid,
            workingDirectory: process.env.DISDEX_RELEASE_ROOT || process.cwd(),
            serviceUnit: process.env.QUALITY102_CAUSAL_V1_MONITOR_SERVICE_UNIT || serviceUnitForSha(runtimeSha),
            status: "observing",
            outcome: String(result.status),
            positionCount: Number(result.positionCount || 0),
            openOrderCount: Number(result.openOrderCount || 0),
            observedAt: completed,
            tickStartedAt: started,
            tickCompletedAt: completed,
        });
        await publish(heartbeat);
        console.log(JSON.stringify({ mode: "MONITOR_ONLY", status: "observing", runtimeSha, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
        return true;
    } catch (error) {
        const completed = Date.now();
        const deferred = classifyQ102PreflightRateBudgetDeferral(error);
        const reason = deferred
            ? `QUALITY102_MONITOR_PREFLIGHT_DEFERRED:${String(deferred.reason || "RATE_BUDGET")}`
            : `QUALITY102_MONITOR_READ_FAILED:${safeReason(error)}`;
        await publish(buildBlockedHeartbeat(runtimeSha, reason, started, completed));
        console.log(JSON.stringify({ mode: "MONITOR_ONLY", status: "blocked", runtimeSha, reason, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
        return false;
    }
}

async function main(): Promise<void> {
    const daemon = process.argv.includes("--daemon") && !process.argv.includes("--once");
    const interval = Math.max(MIN_INTERVAL_MS, Number(process.env.QUALITY102_CAUSAL_V1_MONITOR_INTERVAL_MS || DEFAULT_INTERVAL_MS));
    let stopping = false;
    const stop = () => { stopping = true; };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    do {
        const healthy = await runOnce();
        if (!daemon) {
            if (!healthy) process.exitCode = 2;
            return;
        }
        if (stopping) return;
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, interval));
    } while (!stopping);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(JSON.stringify({ level: "fatal", status: "QUALITY102_CAUSAL_V1_MONITOR_FAIL_CLOSED", reason: safeReason(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
        process.exitCode = 1;
    });
}
