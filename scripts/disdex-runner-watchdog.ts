import { constants } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { access, chmod, mkdir, open, readFile, readlink, rename, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
    decideRecovery,
    readRunnerHeartbeat,
    type RecoveryDecision,
    type RunnerHeartbeat,
    type RunnerId,
} from "../lib/disdex-runner-health";

export interface RunnerWatchdogSystem {
    isActive(unit: string): Promise<boolean>;
    mainPid(unit: string): Promise<number>;
    processCwd(pid: number): Promise<string | undefined>;
    processCommand(pid: number): Promise<string | undefined>;
    restart(unit: string): Promise<void>;
}

export interface RunnerWatchdogRunnerConfig {
    runnerId: RunnerId;
    serviceUnit: string;
    heartbeatPath: string;
    expectedCwd: string;
    expectedSha: string;
    intentionalStopMarkerPath: string;
}

export interface RunnerWatchdogConfig {
    healthRoot: string;
    runners: Record<RunnerId, RunnerWatchdogRunnerConfig>;
    heartbeatTimeoutMs: number;
    attemptWindowMs: number;
    maxAttempts: number;
    backoffMs: readonly number[];
    auditPath: string;
    statePath: string;
}

export interface RunnerWatchdogRunnerResult {
    runnerId: RunnerId;
    serviceUnit: string;
    decision: RecoveryDecision;
    heartbeatPresent: boolean;
    restartPerformed: boolean;
    backoffMs: number | null;
    nextAllowedAt: number | null;
    error?: string;
}

export interface RunnerWatchdogResult {
    exitCode: 0 | 1;
    decisions: Record<RunnerId, RecoveryDecision>;
    runnerResults: Record<RunnerId, RunnerWatchdogRunnerResult>;
    restartCalls: string[];
    sharedUncertainty: boolean;
    auditWritten: boolean;
}

export const RUNNER_WATCHDOG_RUNNERS = ["V12", "PENGU_V8", "V52", "QUALITY102_CAUSAL_V1"] as const satisfies readonly RunnerId[];

export const RUNNER_WATCHDOG_HEARTBEATS: Record<RunnerId, string> = {
    V12: "v12.json",
    PENGU_V8: "pengu-v8.json",
    V52: "v52.json",
    QUALITY102_CAUSAL_V1: "quality102-causal-v1.json",
};

/** These expressions are the only service-unit names that the production adapter may receive. */
export const RUNNER_WATCHDOG_SERVICE_ALLOWLIST: Record<RunnerId, RegExp> = {
    V12: /^disdex-v12-x1-all@[0-9a-f]{40}\.service$/,
    PENGU_V8: /^(disdex-pengu-dual-ls-v2-v20|disdex-v96-v52-live)\.service$/,
    V52: /^(disdex-v52-aster-only@[0-9a-f]{40}|disdex-v96-v52-live)\.service$/,
    QUALITY102_CAUSAL_V1: /^disdex-quality102-causal-v1@[0-9a-f]{40}\.service$/,
};

const EXPECTED_COMMAND_FRAGMENTS: Record<RunnerId, readonly string[]> = {
    V12: ["disdex-v12-x1-all-live-runner.ts"],
    PENGU_V8: ["disdex-pengu-dual-ls-v2-live-runner.ts", "disdex-v96-v52-live.sh"],
    V52: ["disdex_v52_aster_only_live_engine.py", "disdex-v96-v52-live.sh"],
    QUALITY102_CAUSAL_V1: ["disdex-quality102-causal-v1-live-runner.ts"],
};

const DEFAULT_HEALTH_ROOT = "/var/lib/disdex/runner-health";
const DEFAULT_ENV_FILE = "/etc/disdex/disdex-runner-watchdog.env";
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_ATTEMPT_WINDOW_MS = 30 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = [15_000, 60_000, 300_000] as const;
const ZERO_EFFECTS = { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 } as const;
const ZERO_SHA = "0".repeat(40);
const SYSTEMCTL = "/usr/bin/systemctl";
const execFile = promisify(execFileCallback);

interface WatchdogAttempt {
    at: number;
    delayMs: number;
    serviceUnit: string;
}

interface WatchdogRunnerState {
    attempts: WatchdogAttempt[];
    exhaustedAt?: number;
}

interface WatchdogState {
    schema: "disdex-runner-watchdog-state/v1";
    runners: Partial<Record<RunnerId, WatchdogRunnerState>>;
}

interface LoadedHeartbeats {
    heartbeats: Partial<Record<RunnerId, RunnerHeartbeat>>;
    identityMismatches: Partial<Record<RunnerId, string>>;
}

interface PreparedRunner {
    runnerId: RunnerId;
    config: RunnerWatchdogRunnerConfig;
    heartbeat?: RunnerHeartbeat;
    decision: RecoveryDecision;
    intentionalStop: boolean;
    heartbeatPresent: boolean;
    effectiveAttempts: number;
    recentAttempts: WatchdogAttempt[];
    backoffMs: number | null;
    nextAllowedAt: number | null;
    error?: string;
}

export class RunnerWatchdogSafetyError extends Error {
    readonly code = "RUNNER_WATCHDOG_SAFETY_UNVERIFIED";

    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "RunnerWatchdogSafetyError";
    }
}

function zeroEffects() {
    return { ...ZERO_EFFECTS };
}

function makeDecision(
    action: RecoveryDecision["action"],
    reason: string,
    affectsOtherRunners: boolean,
    nextAttempt?: number,
): RecoveryDecision {
    return {
        action,
        reason,
        affectsOtherRunners,
        restartAuthorized: action === "RESTART",
        tradingEffects: zeroEffects(),
        ...(nextAttempt === undefined ? {} : { nextAttempt }),
    };
}

function holdDecision(reason: string, affectsOtherRunners = false): RecoveryDecision {
    return makeDecision("HOLD_FAIL_CLOSED", reason, affectsOtherRunners);
}

function sharedUncertaintyDecision(reason: string, now: number, expectedCwd: string): RecoveryDecision {
    return decideRecovery({
        now,
        heartbeat: undefined,
        serviceActive: false,
        mainPid: 0,
        processCwd: undefined,
        expectedCwd,
        restartAttempts: 0,
        sharedUncertainty: true,
    });
}

function runnerIdList(): RunnerId[] {
    return [...RUNNER_WATCHDOG_RUNNERS];
}

function isExactSha(value: string): boolean {
    return /^[0-9a-f]{40}$/.test(value) && value !== ZERO_SHA;
}

function isAllowlistedForRunner(runnerId: RunnerId, unit: string): boolean {
    return typeof unit === "string" && RUNNER_WATCHDOG_SERVICE_ALLOWLIST[runnerId].test(unit);
}

export function isAllowlistedServiceUnit(unit: string): boolean {
    return runnerIdList().some((runnerId) => isAllowlistedForRunner(runnerId, unit));
}

function safeReason(value: unknown): string {
    const text = String(value || "watchdog safety uncertainty");
    return text
        .replace(/(api[_ -]?key|private[_ -]?key|secret|token|password|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
        .slice(0, 512);
}

function pathWithin(root: string, candidate: string): boolean {
    const rootResolved = resolve(root);
    const candidateResolved = resolve(candidate);
    const rel = relative(rootResolved, candidateResolved);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${candidateResolved.includes("\\") ? "\\" : "/"}`) && !isAbsolute(rel));
}

function assertConfig(config: RunnerWatchdogConfig): void {
    if (!isAbsolute(config.healthRoot)) throw new RunnerWatchdogSafetyError("watchdog health root must be absolute");
    if (!Number.isInteger(config.heartbeatTimeoutMs) || config.heartbeatTimeoutMs !== DEFAULT_HEARTBEAT_TIMEOUT_MS) {
        throw new RunnerWatchdogSafetyError("watchdog heartbeat timeout must be 300000ms");
    }
    if (!Number.isInteger(config.attemptWindowMs) || config.attemptWindowMs !== DEFAULT_ATTEMPT_WINDOW_MS) {
        throw new RunnerWatchdogSafetyError("watchdog attempt window must be 1800000ms");
    }
    if (config.maxAttempts !== DEFAULT_MAX_ATTEMPTS) {
        throw new RunnerWatchdogSafetyError("watchdog max attempts must be 3");
    }
    if (config.backoffMs.length !== DEFAULT_BACKOFF_MS.length || config.backoffMs.some((value, index) => value !== DEFAULT_BACKOFF_MS[index])) {
        throw new RunnerWatchdogSafetyError("watchdog backoff must be 15000,60000,300000ms");
    }
    if (!pathWithin(config.healthRoot, config.auditPath) || !pathWithin(config.healthRoot, config.statePath)) {
        throw new RunnerWatchdogSafetyError("watchdog audit and state paths must stay under the health root");
    }
    for (const runnerId of RUNNER_WATCHDOG_RUNNERS) {
        const runner = config.runners[runnerId];
        if (!runner || runner.runnerId !== runnerId) throw new RunnerWatchdogSafetyError(`missing watchdog configuration for ${runnerId}`);
        if (!isAllowlistedForRunner(runnerId, runner.serviceUnit)) {
            throw new RunnerWatchdogSafetyError(`configured service unit is not allowlisted for ${runnerId}`);
        }
        if (!isExactSha(runner.expectedSha)) throw new RunnerWatchdogSafetyError(`expected release SHA is unavailable for ${runnerId}`);
        if (!isAbsolute(runner.expectedCwd)) throw new RunnerWatchdogSafetyError(`expected release root is not absolute for ${runnerId}`);
        if (!pathWithin(config.healthRoot, runner.heartbeatPath) || !pathWithin(config.healthRoot, runner.intentionalStopMarkerPath)) {
            throw new RunnerWatchdogSafetyError(`watchdog paths must stay under the health root for ${runnerId}`);
        }
    }
}

function envValue(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = env[key];
        if (value !== undefined && value.trim() !== "") return value.trim();
    }
    return undefined;
}

function parseInteger(env: NodeJS.ProcessEnv, keys: string[], fallback: number): number {
    const raw = envValue(env, keys);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) throw new RunnerWatchdogSafetyError(`${keys[0]} is invalid`);
    return value;
}

function parseBackoff(env: NodeJS.ProcessEnv): number[] {
    const raw = envValue(env, ["DISDEX_RUNNER_WATCHDOG_BACKOFF_MS"]);
    if (raw === undefined) return [...DEFAULT_BACKOFF_MS];
    const values = raw.split(",").map((part) => Number(part.trim()));
    if (values.length !== DEFAULT_BACKOFF_MS.length || values.some((value, index) => !Number.isInteger(value) || value !== DEFAULT_BACKOFF_MS[index])) {
        throw new RunnerWatchdogSafetyError("DISDEX_RUNNER_WATCHDOG_BACKOFF_MS must be 15000,60000,300000");
    }
    return values;
}

function serviceKeys(runnerId: RunnerId): string[] {
    return [
        `DISDEX_RUNNER_${runnerId}_SERVICE_UNIT`,
        `DISDEX_${runnerId}_RUNNER_SERVICE_UNIT`,
        `DISDEX_${runnerId}_SERVICE_UNIT`,
    ];
}

function expectedShaKeys(runnerId: RunnerId): string[] {
    return [
        `DISDEX_RUNNER_${runnerId}_EXPECTED_SHA`,
        `DISDEX_RUNNER_${runnerId}_EXPECTED_RELEASE_SHA`,
        `DISDEX_${runnerId}_EXPECTED_RUNTIME_SHA`,
        "DISDEX_RUNNER_EXPECTED_SHA",
    ];
}

function expectedCwdKeys(runnerId: RunnerId): string[] {
    return [
        `DISDEX_RUNNER_${runnerId}_EXPECTED_CWD`,
        `DISDEX_RUNNER_${runnerId}_RELEASE_ROOT`,
        "DISDEX_RUNNER_EXPECTED_CWD",
        "DISDEX_RUNNER_RELEASE_ROOT",
    ];
}

function normalizeConfiguredSha(value: string | undefined, runnerId: RunnerId): string {
    const normalized = String(value || "").trim().toLowerCase();
    if (!isExactSha(normalized)) throw new RunnerWatchdogSafetyError(`expected release SHA is unavailable for ${runnerId}`);
    return normalized;
}

function normalizeConfiguredPath(value: string | undefined, runnerId: RunnerId): string {
    if (!value || !isAbsolute(value)) throw new RunnerWatchdogSafetyError(`expected release root is unavailable for ${runnerId}`);
    return resolve(value);
}

export function buildWatchdogConfig(env: NodeJS.ProcessEnv = process.env): RunnerWatchdogConfig {
    const healthRoot = resolve(envValue(env, ["DISDEX_RUNNER_HEALTH_ROOT"]) || DEFAULT_HEALTH_ROOT);
    const expectedGlobalSha = envValue(env, ["DISDEX_RUNNER_EXPECTED_SHA"]);
    const expectedGlobalCwd = envValue(env, ["DISDEX_RUNNER_EXPECTED_CWD", "DISDEX_RUNNER_RELEASE_ROOT"]);
    const runners = {} as Record<RunnerId, RunnerWatchdogRunnerConfig>;

    for (const runnerId of RUNNER_WATCHDOG_RUNNERS) {
        const heartbeatPath = join(healthRoot, RUNNER_WATCHDOG_HEARTBEATS[runnerId]);
        const markerPath = join(healthRoot, `${runnerId.toLowerCase()}.intentional-stop`);
        runners[runnerId] = {
            runnerId,
            serviceUnit: envValue(env, serviceKeys(runnerId)) || "",
            heartbeatPath,
            expectedCwd: normalizeConfiguredPath(envValue(env, expectedCwdKeys(runnerId)) || expectedGlobalCwd, runnerId),
            expectedSha: normalizeConfiguredSha(envValue(env, expectedShaKeys(runnerId)) || expectedGlobalSha, runnerId),
            intentionalStopMarkerPath: markerPath,
        };
    }

    const config: RunnerWatchdogConfig = {
        healthRoot,
        runners,
        heartbeatTimeoutMs: parseInteger(env, ["DISDEX_RUNNER_WATCHDOG_HEARTBEAT_TIMEOUT_MS"], DEFAULT_HEARTBEAT_TIMEOUT_MS),
        attemptWindowMs: parseInteger(env, ["DISDEX_RUNNER_WATCHDOG_ATTEMPT_WINDOW_MS"], DEFAULT_ATTEMPT_WINDOW_MS),
        maxAttempts: parseInteger(env, ["DISDEX_RUNNER_WATCHDOG_MAX_ATTEMPTS"], DEFAULT_MAX_ATTEMPTS),
        backoffMs: parseBackoff(env),
        auditPath: join(healthRoot, "watchdog-audit.json"),
        statePath: join(healthRoot, "watchdog-state.json"),
    };
    assertConfig(config);
    return config;
}

function parseEnvLine(line: string): [string, string] | undefined {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return undefined;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
    if (!match) return undefined;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    }
    return [match[1], value];
}

async function readEnvFile(path: string): Promise<NodeJS.ProcessEnv> {
    const raw = await readFile(path, "utf8");
    const parsed = {} as NodeJS.ProcessEnv;
    for (const line of raw.split(/\r?\n/)) {
        const item = parseEnvLine(line);
        if (item) parsed[item[0]] = item[1];
    }
    return parsed;
}

export async function loadWatchdogConfig(env: NodeJS.ProcessEnv = process.env): Promise<RunnerWatchdogConfig> {
    const envFile = envValue(env, ["DISDEX_RUNNER_WATCHDOG_ENV_FILE"]) || DEFAULT_ENV_FILE;
    let fileEnv: NodeJS.ProcessEnv;
    try {
        fileEnv = await readEnvFile(envFile);
    } catch (error) {
        throw new RunnerWatchdogSafetyError(`watchdog environment unavailable: ${envFile}`, { cause: error });
    }
    return buildWatchdogConfig({ ...fileEnv, ...env });
}

function emptyState(): WatchdogState {
    return { schema: "disdex-runner-watchdog-state/v1", runners: {} };
}

function validateAttempt(value: unknown): WatchdogAttempt {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new RunnerWatchdogSafetyError("watchdog attempt state is malformed");
    const row = value as Record<string, unknown>;
    if (typeof row.at !== "number" || !Number.isInteger(row.at) || row.at < 0) throw new RunnerWatchdogSafetyError("watchdog attempt timestamp is malformed");
    if (typeof row.delayMs !== "number" || !Number.isInteger(row.delayMs) || row.delayMs < 0) throw new RunnerWatchdogSafetyError("watchdog attempt delay is malformed");
    if (typeof row.serviceUnit !== "string" || !isAllowlistedServiceUnit(row.serviceUnit)) throw new RunnerWatchdogSafetyError("watchdog attempt unit is not allowlisted");
    return { at: row.at, delayMs: row.delayMs, serviceUnit: row.serviceUnit };
}

async function readWatchdogState(config: RunnerWatchdogConfig, now: number): Promise<WatchdogState> {
    let raw: string;
    try {
        raw = await readFile(config.statePath, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
        throw new RunnerWatchdogSafetyError("watchdog attempt state cannot be read", { cause: error });
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        const record = parsed as Record<string, unknown>;
        if (record.schema !== "disdex-runner-watchdog-state/v1" || record.runners === null || typeof record.runners !== "object" || Array.isArray(record.runners)) {
            throw new Error("unsupported state schema");
        }
        const runners: Partial<Record<RunnerId, WatchdogRunnerState>> = {};
        const stateRunners = record.runners as Record<string, unknown>;
        for (const [runnerId, value] of Object.entries(stateRunners)) {
            if (!(RUNNER_WATCHDOG_RUNNERS as readonly string[]).includes(runnerId)) throw new Error("unknown runner");
            if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("malformed runner state");
            const row = value as Record<string, unknown>;
            if (!Array.isArray(row.attempts)) throw new Error("malformed attempts");
            const attempts = row.attempts.map(validateAttempt).filter((attempt) => {
                if (attempt.at > now) throw new Error("future attempt");
                return now - attempt.at <= config.attemptWindowMs;
            });
            if (row.exhaustedAt !== undefined && (typeof row.exhaustedAt !== "number" || !Number.isInteger(row.exhaustedAt) || row.exhaustedAt < 0 || row.exhaustedAt > now)) {
                throw new Error("malformed exhaustion timestamp");
            }
            runners[runnerId as RunnerId] = {
                attempts,
                ...(row.exhaustedAt === undefined ? {} : { exhaustedAt: row.exhaustedAt }),
            };
        }
        return { schema: "disdex-runner-watchdog-state/v1", runners };
    } catch (error) {
        if (error instanceof RunnerWatchdogSafetyError) throw error;
        throw new RunnerWatchdogSafetyError("watchdog attempt state is malformed", { cause: error });
    }
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
        handle = await open(temporaryPath, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await chmod(temporaryPath, 0o600);
        await rename(temporaryPath, path);
    } finally {
        if (handle) await handle.close().catch(() => undefined);
        await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
}

async function markerExists(path: string): Promise<boolean> {
    try {
        await access(path, constants.F_OK);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw new RunnerWatchdogSafetyError("intentional-stop marker cannot be verified", { cause: error });
    }
}

function commandMatches(runnerId: RunnerId, command: string | undefined): boolean {
    if (!command) return false;
    return EXPECTED_COMMAND_FRAGMENTS[runnerId].some((fragment) => command.includes(fragment));
}

function currentAttempts(state: WatchdogState, runnerId: RunnerId, now: number, windowMs: number): WatchdogAttempt[] {
    const attempts = state.runners[runnerId]?.attempts || [];
    return attempts.filter((attempt) => now - attempt.at <= windowMs);
}

function backoffHold(
    attempts: number,
    recentAttempts: WatchdogAttempt[],
    config: RunnerWatchdogConfig,
    now: number,
): { decision: RecoveryDecision; backoffMs: number; nextAllowedAt: number } | undefined {
    if (recentAttempts.length === 0) return undefined;
    const backoffMs = config.backoffMs[Math.min(recentAttempts.length - 1, config.maxAttempts - 1)];
    const lastAttempt = recentAttempts[recentAttempts.length - 1];
    const nextAllowedAt = lastAttempt.at + backoffMs;
    if (now >= nextAllowedAt) return undefined;
    return {
        decision: makeDecision("HOLD_FAIL_CLOSED", `restart backoff active; next attempt at ${nextAllowedAt}`, false, attempts + 1),
        backoffMs,
        nextAllowedAt,
    };
}

function asRecord<T>(items: T[]): Record<RunnerId, T> {
    return Object.fromEntries(RUNNER_WATCHDOG_RUNNERS.map((runnerId) => [runnerId, items[RUNNER_WATCHDOG_RUNNERS.indexOf(runnerId)]])) as Record<RunnerId, T>;
}

function auditPayload(
    now: number,
    result: RunnerWatchdogResult,
): Record<string, unknown> {
    const decisions: Record<string, unknown> = {};
    for (const runnerId of RUNNER_WATCHDOG_RUNNERS) {
        const runner = result.runnerResults[runnerId];
        decisions[runnerId] = {
            serviceUnit: runner.serviceUnit,
            action: runner.decision.action,
            reason: safeReason(runner.decision.reason),
            affectsOtherRunners: runner.decision.affectsOtherRunners,
            restartAuthorized: runner.decision.restartAuthorized,
            tradingEffects: zeroEffects(),
            restartPerformed: runner.restartPerformed,
            ...(runner.error ? { error: safeReason(runner.error) } : {}),
        };
    }
    return {
        schema: "disdex-runner-watchdog-audit/v1",
        observedAt: now,
        exitCode: result.exitCode,
        sharedUncertainty: result.sharedUncertainty,
        restartCalls: result.restartCalls,
        decisions,
        tradingEffects: zeroEffects(),
    };
}

async function finishResult(config: RunnerWatchdogConfig, now: number, result: RunnerWatchdogResult): Promise<RunnerWatchdogResult> {
    try {
        await writeAtomicJson(config.auditPath, auditPayload(now, result));
        result.auditWritten = true;
    } catch (error) {
        result.auditWritten = false;
        result.exitCode = 1;
        for (const runnerId of RUNNER_WATCHDOG_RUNNERS) {
            const current = result.runnerResults[runnerId];
            if (!current.error) current.error = "watchdog audit unavailable";
        }
        void error;
    }
    return result;
}

function resultFromPrepared(prepared: PreparedRunner[], exitCode: 0 | 1, sharedUncertainty = false): RunnerWatchdogResult {
    const runnerResults = asRecord(prepared.map((item) => ({
        runnerId: item.runnerId,
        serviceUnit: item.config.serviceUnit,
        decision: item.decision,
        heartbeatPresent: item.heartbeatPresent,
        restartPerformed: false,
        backoffMs: item.backoffMs,
        nextAllowedAt: item.nextAllowedAt,
        ...(item.error ? { error: item.error } : {}),
    })));
    const decisions = asRecord(prepared.map((item) => item.decision));
    return {
        exitCode,
        decisions,
        runnerResults,
        restartCalls: [],
        sharedUncertainty,
        auditWritten: false,
    };
}

function makeSharedResult(config: RunnerWatchdogConfig, now: number, reason: string): RunnerWatchdogResult {
    const prepared = runnerIdList().map((runnerId) => ({
        runnerId,
        config: config.runners[runnerId],
        heartbeat: undefined,
        decision: sharedUncertaintyDecision(reason, now, config.runners[runnerId].expectedCwd),
        intentionalStop: false,
        heartbeatPresent: false,
        effectiveAttempts: 0,
        recentAttempts: [],
        backoffMs: null,
        nextAllowedAt: null,
        error: safeReason(reason),
    }));
    return resultFromPrepared(prepared, 1, true);
}

async function loadHeartbeats(config: RunnerWatchdogConfig): Promise<LoadedHeartbeats> {
    const heartbeats: Partial<Record<RunnerId, RunnerHeartbeat>> = {};
    const identityMismatches: Partial<Record<RunnerId, string>> = {};
    for (const runnerId of RUNNER_WATCHDOG_RUNNERS) {
        let heartbeat: RunnerHeartbeat | undefined;
        try {
            heartbeat = await readRunnerHeartbeat(config.runners[runnerId].heartbeatPath);
        } catch (error) {
            throw new RunnerWatchdogSafetyError(`heartbeat for ${runnerId} is malformed`, { cause: error });
        }
        if (!heartbeat) continue;
        if (heartbeat.runnerId !== runnerId) {
            throw new RunnerWatchdogSafetyError(`heartbeat runner identity mismatch for ${runnerId}`);
        }
        if (!isAllowlistedForRunner(runnerId, heartbeat.serviceUnit)) {
            throw new RunnerWatchdogSafetyError(`heartbeat service unit is not allowlisted for ${runnerId}`);
        }
        heartbeats[runnerId] = heartbeat;
        if (heartbeat.serviceUnit !== config.runners[runnerId].serviceUnit) {
            identityMismatches[runnerId] = "heartbeat service unit does not match configured unit";
        }
    }
    return { heartbeats, identityMismatches };
}

async function prepareRunner(
    runnerId: RunnerId,
    config: RunnerWatchdogConfig,
    system: RunnerWatchdogSystem,
    state: WatchdogState,
    loaded: LoadedHeartbeats,
    now: number,
): Promise<PreparedRunner> {
    const runnerConfig = config.runners[runnerId];
    const heartbeat = loaded.heartbeats[runnerId];
    const recentAttempts = currentAttempts(state, runnerId, now, config.attemptWindowMs);
    const effectiveAttempts = Math.max(heartbeat?.restartAttempts || 0, recentAttempts.length);
    const base: Omit<PreparedRunner, "decision"> = {
        runnerId,
        config: runnerConfig,
        heartbeat,
        intentionalStop: false,
        heartbeatPresent: heartbeat !== undefined,
        effectiveAttempts,
        recentAttempts,
        backoffMs: null,
        nextAllowedAt: null,
    };

    if (loaded.identityMismatches[runnerId]) {
        return { ...base, decision: holdDecision(loaded.identityMismatches[runnerId]!) };
    }
    if (heartbeat && ["KILL_SWITCH", "DAILY_LOSS_LATCH", "STALE_DATA", "RECONCILIATION_FAILED", "MANUAL_REVIEW", "UNKNOWN"].includes(heartbeat.safetyState)) {
        return {
            ...base,
            decision: decideRecovery({
                now,
                heartbeat,
                serviceActive: false,
                mainPid: 0,
                processCwd: undefined,
                expectedCwd: runnerConfig.expectedCwd,
                expectedSha: runnerConfig.expectedSha,
                restartAttempts: effectiveAttempts,
            }),
        };
    }
    if (await markerExists(runnerConfig.intentionalStopMarkerPath)) {
        return {
            ...base,
            intentionalStop: true,
            decision: decideRecovery({
                now,
                heartbeat,
                serviceActive: false,
                mainPid: 0,
                processCwd: undefined,
                expectedCwd: runnerConfig.expectedCwd,
                expectedSha: runnerConfig.expectedSha,
                restartAttempts: effectiveAttempts,
                intentionalStop: true,
            }),
        };
    }
    if (effectiveAttempts >= config.maxAttempts) {
        return {
            ...base,
            decision: decideRecovery({
                now,
                heartbeat,
                serviceActive: false,
                mainPid: 0,
                processCwd: undefined,
                expectedCwd: runnerConfig.expectedCwd,
                expectedSha: runnerConfig.expectedSha,
                restartAttempts: effectiveAttempts,
            }),
        };
    }

    let serviceActive: boolean;
    let mainPid: number;
    let processCwd: string | undefined;
    let processCommand: string | undefined;
    try {
        serviceActive = await system.isActive(runnerConfig.serviceUnit);
        mainPid = await system.mainPid(runnerConfig.serviceUnit);
        if (!Number.isInteger(mainPid) || mainPid < 0) throw new RunnerWatchdogSafetyError(`invalid MainPID for ${runnerId}`);
        if (mainPid > 0) {
            processCwd = await system.processCwd(mainPid);
            processCommand = await system.processCommand(mainPid);
        }
    } catch (error) {
        const message = safeReason(error instanceof Error ? error.message : "system observation unavailable");
        return { ...base, decision: holdDecision(message), error: message };
    }

    const commandVerified = mainPid === 0 || commandMatches(runnerId, processCommand);
    const cwdForDecision = mainPid > 0 ? (processCwd || "__watchdog_process_cwd_unverified__") : undefined;
    const decision = decideRecovery({
        now,
        heartbeat,
        serviceActive,
        mainPid,
        processCwd: commandVerified ? cwdForDecision : "__watchdog_process_command_unverified__",
        processCommand,
        expectedCwd: runnerConfig.expectedCwd,
        expectedSha: runnerConfig.expectedSha,
        restartAttempts: effectiveAttempts,
    });
    if (decision.action === "RESTART") {
        const delayed = backoffHold(effectiveAttempts, recentAttempts, config, now);
        if (delayed) {
            return { ...base, decision: delayed.decision, backoffMs: delayed.backoffMs, nextAllowedAt: delayed.nextAllowedAt };
        }
    }
    return { ...base, decision };
}

async function reserveRestartAttempts(
    config: RunnerWatchdogConfig,
    state: WatchdogState,
    prepared: PreparedRunner[],
    now: number,
): Promise<void> {
    const stateRunners = { ...state.runners };
    for (const item of prepared) {
        if (item.decision.action !== "RESTART") continue;
        const existing = stateRunners[item.runnerId] || { attempts: [] };
        const attempts = [...existing.attempts, {
            at: now,
            delayMs: config.backoffMs[Math.min(item.effectiveAttempts, config.maxAttempts - 1)],
            serviceUnit: item.config.serviceUnit,
        }];
        stateRunners[item.runnerId] = {
            attempts,
            ...(attempts.length >= config.maxAttempts ? { exhaustedAt: now } : {}),
        };
    }
    await writeAtomicJson(config.statePath, { schema: "disdex-runner-watchdog-state/v1", runners: stateRunners });
}

export async function runWatchdog(options: {
    config: RunnerWatchdogConfig;
    system: RunnerWatchdogSystem;
    now?: number;
}): Promise<RunnerWatchdogResult> {
    const now = options.now ?? Date.now();
    if (!Number.isInteger(now) || now < 0) throw new RunnerWatchdogSafetyError("watchdog clock is invalid");
    assertConfig(options.config);

    let state: WatchdogState;
    let loaded: LoadedHeartbeats;
    try {
        state = await readWatchdogState(options.config, now);
        loaded = await loadHeartbeats(options.config);
    } catch (error) {
        const result = makeSharedResult(options.config, now, safeReason(error instanceof Error ? error.message : "shared heartbeat uncertainty"));
        return finishResult(options.config, now, result);
    }

    const prepared: PreparedRunner[] = [];
    for (const runnerId of RUNNER_WATCHDOG_RUNNERS) {
        prepared.push(await prepareRunner(runnerId, options.config, options.system, state, loaded, now));
    }
    const blockedSharedUnits = new Set(
        prepared
            .filter((item) => item.intentionalStop || item.decision.action === "RECOVERY_EXHAUSTED")
            .map((item) => item.config.serviceUnit),
    );
    for (const item of prepared) {
        if (item.decision.action === "RESTART" && blockedSharedUnits.has(item.config.serviceUnit)) {
            item.decision = holdDecision(`shared service ${item.config.serviceUnit} is intentionally stopped or recovery-exhausted`);
        }
    }
    let result = resultFromPrepared(prepared, 0);
    const restartGroups = new Map<string, PreparedRunner[]>();
    for (const item of prepared) {
        if (item.decision.action !== "RESTART" || !item.decision.restartAuthorized) continue;
        const group = restartGroups.get(item.config.serviceUnit) || [];
        group.push(item);
        restartGroups.set(item.config.serviceUnit, group);
    }

    if (restartGroups.size > 0) {
        try {
            await reserveRestartAttempts(options.config, state, prepared, now);
        } catch (error) {
            const message = safeReason(error instanceof Error ? error.message : "restart state unavailable");
            for (const item of prepared) {
                if (item.decision.action !== "RESTART") continue;
                item.decision = holdDecision(`restart withheld: ${message}`);
                item.error = message;
            }
            result = resultFromPrepared(prepared, 1);
            return finishResult(options.config, now, result);
        }
        for (const [unit, group] of restartGroups) {
            result.restartCalls.push(unit);
            try {
                await options.system.restart(unit);
                for (const item of group) result.runnerResults[item.runnerId].restartPerformed = true;
            } catch (error) {
                const message = safeReason(error instanceof Error ? error.message : `restart failed for ${unit}`);
                result.exitCode = 1;
                for (const item of group) result.runnerResults[item.runnerId].error = message;
            }
        }
    }
    if (prepared.some((item) => item.decision.action === "RECOVERY_EXHAUSTED")) result.exitCode = 1;
    return finishResult(options.config, now, result);
}

export const runRunnerWatchdog = runWatchdog;

function assertSystemctlUnit(unit: string): void {
    if (!isAllowlistedServiceUnit(unit)) throw new RunnerWatchdogSafetyError("systemd unit is not in the static allowlist");
}

function exitCodeOf(error: unknown): number | undefined {
    const code = (error as { code?: unknown })?.code;
    return typeof code === "number" ? code : undefined;
}

export function createProductionWatchdogSystem(): RunnerWatchdogSystem {
    return {
        async isActive(unit: string): Promise<boolean> {
            assertSystemctlUnit(unit);
            try {
                const result = await execFile(SYSTEMCTL, ["is-active", unit], { encoding: "utf8", windowsHide: true });
                return result.stdout.trim() === "active";
            } catch (error) {
                if (exitCodeOf(error) === 3) return false;
                throw new RunnerWatchdogSafetyError("systemd active state unavailable", { cause: error });
            }
        },
        async mainPid(unit: string): Promise<number> {
            assertSystemctlUnit(unit);
            const result = await execFile(SYSTEMCTL, ["show", unit, "--property=MainPID", "--value", "--no-pager"], { encoding: "utf8", windowsHide: true });
            const value = Number(result.stdout.trim());
            if (!Number.isInteger(value) || value < 0) throw new RunnerWatchdogSafetyError("systemd MainPID is invalid");
            return value;
        },
        async processCwd(pid: number): Promise<string | undefined> {
            try {
                return await readlink(`/proc/${pid}/cwd`);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
                throw new RunnerWatchdogSafetyError("process cwd cannot be verified", { cause: error });
            }
        },
        async processCommand(pid: number): Promise<string | undefined> {
            try {
                const command = await readFile(`/proc/${pid}/cmdline`, "utf8");
                const normalized = command.replace(/\0/g, " ").trim();
                return normalized || undefined;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
                throw new RunnerWatchdogSafetyError("process command cannot be verified", { cause: error });
            }
        },
        async restart(unit: string): Promise<void> {
            assertSystemctlUnit(unit);
            await execFile(SYSTEMCTL, ["restart", unit], { encoding: "utf8", windowsHide: true });
        },
    };
}

async function main(): Promise<void> {
    try {
        const config = await loadWatchdogConfig();
        const result = await runWatchdog({ config, system: createProductionWatchdogSystem() });
        console.log(`DISDEX_RUNNER_WATCHDOG_RESULT exitCode=${result.exitCode} restarts=${result.restartCalls.length}`);
        process.exitCode = result.exitCode;
    } catch (error) {
        console.error(`DISDEX_RUNNER_WATCHDOG_FAIL_CLOSED ${safeReason(error instanceof Error ? error.message : "watchdog safety unavailable")}`);
        process.exitCode = 1;
    }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
    void main();
}
