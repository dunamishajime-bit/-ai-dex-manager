import { execFile as execFileCallback } from "node:child_process";
import { chmod, lstat, mkdir, readFile, readlink, realpath, rename, unlink, writeFile, rmdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Release-pinned, read-only runner health watchdog.
 *
 * It may restart one allow-listed systemd runner after a bounded health
 * failure. It never imports an exchange client and never submits, cancels,
 * modifies, or closes an order/position.
 */

const execFile = promisify(execFileCallback);
const SYSTEMCTL = "/usr/bin/systemctl";
const DEFAULT_ENV_FILE = "/etc/disdex/disdex-runner-watchdog-current.env";
const DEFAULT_HEALTH_ROOT = "/var/lib/disdex/runner-health";
const RELEASE_MARKER = ".disdex-release-sha";
const ATTEMPT_WINDOW_MS = 1_800_000;
const BACKOFF_MS = [15_000, 60_000, 300_000];
const MAX_ATTEMPTS = 3;
const SHARED_CRYPTO_RISK_UNIT_PATTERN = "disdex-shared-crypto-risk@*.service";
const MARGIN_GUARD_UNIT_PATTERN = "disdex-v12-v52-margin-guard@*.service";
const LEGACY_LIVE_UNITS = ["disdex-v96-v52-live.service"];
const RUNNERS = [
    {
        key: "V12_X1_ALL",
        expectedShaEnv: "DISDEX_WATCHDOG_V12_EXPECTED_SHA",
        releaseRootEnv: "DISDEX_WATCHDOG_V12_RELEASE_ROOT",
        heartbeatFile: "v12-x1-all.json",
        unitEnv: "DISDEX_WATCHDOG_V12_SERVICE_UNIT",
        expectedUnit: (sha) => `disdex-v12-x1-all@${sha}.service`,
        unitPattern: "disdex-v12-x1-all@*.service",
        unitPrefix: "disdex-v12-x1-all",
        script: "scripts/disdex-v12-x1-all-live-runner.ts",
        heartbeatTimeoutMs: 10_800_000,
        tickTimeoutMs: 5_400_000,
    },
    {
        key: "PENGU_V8",
        expectedShaEnv: "DISDEX_WATCHDOG_PENGU_EXPECTED_SHA",
        releaseRootEnv: "DISDEX_WATCHDOG_PENGU_RELEASE_ROOT",
        heartbeatFile: "pengu-v8.json",
        unitEnv: "DISDEX_WATCHDOG_PENGU_SERVICE_UNIT",
        expectedUnit: (sha) => `disdex-pengu-dual-ls-v2@${sha}.service`,
        unitPattern: "disdex-pengu-dual-ls-v2@*.service",
        unitPrefix: "disdex-pengu-dual-ls-v2",
        script: "scripts/disdex-pengu-dual-ls-v2-live-runner.ts",
        heartbeatTimeoutMs: 5_400_000,
        tickTimeoutMs: 5_400_000,
    },
    {
        key: "V52",
        expectedShaEnv: "DISDEX_WATCHDOG_V52_EXPECTED_SHA",
        releaseRootEnv: "DISDEX_WATCHDOG_V52_RELEASE_ROOT",
        heartbeatFile: "v52.json",
        unitEnv: "DISDEX_WATCHDOG_V52_SERVICE_UNIT",
        expectedUnit: (sha) => `disdex-v52-aster-only@${sha}.service`,
        unitPattern: "disdex-v52-aster-only@*.service",
        unitPrefix: "disdex-v52-aster-only",
        scripts: [
            "scripts/disdex_v52_aster_only_live_engine.py",
            "scripts/disdex_v52_aster_only_legacy_engine.py",
            "scripts/disdex_v12_v52_live_engine.py",
            "scripts/disdex_v12_v52_live_engine_retry.py",
        ],
        heartbeatTimeoutMs: 10_800_000,
        tickTimeoutMs: 900_000,
    },
    {
        key: "QUALITY102_CAUSAL_V1",
        expectedShaEnv: "DISDEX_WATCHDOG_Q102_EXPECTED_SHA",
        releaseRootEnv: "DISDEX_WATCHDOG_Q102_RELEASE_ROOT",
        heartbeatFile: "quality102-causal-v1.json",
        unitEnv: "DISDEX_WATCHDOG_Q102_SERVICE_UNIT",
        expectedUnit: (sha) => `disdex-quality102-causal-v1@${sha}.service`,
        unitPattern: "disdex-quality102-causal-v1@*.service",
        unitPrefix: "disdex-quality102-causal-v1",
        script: "scripts/disdex-quality102-causal-v1-live-runner.ts",
        heartbeatTimeoutMs: 5_400_000,
        tickTimeoutMs: 5_400_000,
    },
];

const ZERO_EFFECTS = { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 };

function safeReason(value) {
    return String(value || "unknown watchdog error")
        .replace(/(api[_ -]?key|private[_ -]?key|secret|token|password|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .slice(0, 512);
}

function parseEnv(raw) {
    const result = {};
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
        if (!match) continue;
        let value = match[2].trim();
        if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        result[match[1]] = value;
    }
    return result;
}

async function loadEnv(path) {
    return parseEnv(await readFile(path, "utf8"));
}

function exactSha(value) {
    return /^[0-9a-f]{40}$/.test(value) && !/^0{40}$/.test(value);
}

function isAbsoluteCanonicalPath(path) {
    return isAbsolute(path) && resolve(path) === path;
}

function pathWithin(root, candidate) {
    const rel = relative(resolve(root), resolve(candidate));
    return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${root.includes("\\") ? "\\" : "/"}`));
}

function serviceAllowed(runner, unit, sha) {
    if (typeof unit !== "string") return false;
    if (runner.key === "V12_X1_ALL") return /^disdex-v12-x1-all@[0-9a-f]{40}\.service$/.test(unit) && unit === runner.expectedUnit(sha);
    if (runner.key === "QUALITY102_CAUSAL_V1") return /^disdex-quality102-causal-v1@[0-9a-f]{40}\.service$/.test(unit) && unit === runner.expectedUnit(sha);
    if (runner.key === "PENGU_V8") return unit === runner.expectedUnit(sha);
    return unit === runner.expectedUnit(sha);
}

function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function parseNonInactiveServiceUnits(output, unitPrefix) {
    const units = [];
    const pattern = new RegExp(`\\b(${escapeRegex(unitPrefix)}@[0-9a-f]{40}\\.service)\\s+\\S+\\s+(\\S+)\\s+\\S+`);
    for (const line of String(output || "").split(/\r?\n/)) {
        const match = pattern.exec(line);
        if (match && match[2] !== "inactive") units.push(match[1]);
    }
    return units;
}

function assertReleasePinnedRunnerSingleton(activeUnits, expectedUnit, label = "RUNNER_LINEAGE", requireExpected = false) {
    const units = [...new Set(activeUnits)];
    const conflicting = units.filter((unit) => unit !== expectedUnit);
    if (conflicting.length > 0 || units.length > 1 || (requireExpected && units.length !== 1)) {
        throw new Error(`${label} singleton invariant failed: expected ${requireExpected ? "only" : "no conflicts with"} ${expectedUnit}, observed ${units.join(",") || "none"}`);
    }
}

function assertSharedCryptoRiskWriterSingleton(activeUnits, expectedSha) {
    assertReleasePinnedRunnerSingleton(activeUnits, `disdex-shared-crypto-risk@${expectedSha}.service`, "SHARED_CRYPTO_RISK", true);
}

const RUNNER_OWNED_HEARTBEAT_FIELDS = [
    "lastReconciliationAt",
    "lastDecision",
    "reason",
    "symbols",
    "caps",
    "restartAttempts",
    "updatedAt",
];

function validateRunnerOwnedHeartbeat(value, runnerKey) {
    const present = RUNNER_OWNED_HEARTBEAT_FIELDS.filter((key) => key in value);
    if (present.length === 0) return;
    if (present.length !== RUNNER_OWNED_HEARTBEAT_FIELDS.length) {
        throw new Error(`${runnerKey} heartbeat has partial runner-owned metadata`);
    }
    for (const key of RUNNER_OWNED_HEARTBEAT_FIELDS) {
        if (!(key in value)) throw new Error(`${runnerKey} heartbeat is missing runner-owned metadata`);
    }
    if (typeof value.reason !== "string" || value.reason.length === 0) throw new Error(`${runnerKey} heartbeat reason is invalid`);
    if (!Array.isArray(value.symbols) || value.symbols.length > 128) throw new Error(`${runnerKey} heartbeat symbols are invalid`);
    if (!value.caps || typeof value.caps !== "object" || Array.isArray(value.caps)) throw new Error(`${runnerKey} heartbeat caps are invalid`);
    if (!Number.isInteger(value.restartAttempts) || value.restartAttempts < 0) throw new Error(`${runnerKey} heartbeat restartAttempts is invalid`);
    if (!Number.isFinite(value.updatedAt) || value.updatedAt <= 0) throw new Error(`${runnerKey} heartbeat updatedAt is invalid`);
    if (value.lastReconciliationAt !== null && (!Number.isFinite(value.lastReconciliationAt) || value.lastReconciliationAt <= 0)) {
        throw new Error(`${runnerKey} heartbeat lastReconciliationAt is invalid`);
    }
    if (value.lastDecision !== null && typeof value.lastDecision !== "string") throw new Error(`${runnerKey} heartbeat lastDecision is invalid`);
}

function runnerPaths(config, runner) {
    return {
        heartbeat: join(config.healthRoot, "heartbeats", runner.heartbeatFile),
        stopMarker: runner.key === "V52" ? join(config.healthRoot, "v52.intentional-stop") : undefined,
    };
}

function heartbeatFreshness(value, runner, now) {
    const heartbeatFresh = now - value.heartbeatAt <= runner.heartbeatTimeoutMs;
    const runnerTickFresh = now - value.lastTickAt <= runner.tickTimeoutMs;
    return { heartbeatFresh, runnerTickFresh, fresh: heartbeatFresh && runnerTickFresh };
}

function buildConfig(env) {
    const healthRoot = env.DISDEX_WATCHDOG_HEALTH_ROOT || DEFAULT_HEALTH_ROOT;
    const releaseRoot = env.DISDEX_WATCHDOG_RELEASE_ROOT;
    const expectedSha = String(env.DISDEX_WATCHDOG_EXPECTED_SHA || "").trim().toLowerCase();
    const approvedSha = String(env.DISDEX_WATCHDOG_APPROVED_SHA || "").trim().toLowerCase();
    if (!isAbsoluteCanonicalPath(healthRoot) || !releaseRoot || !isAbsoluteCanonicalPath(releaseRoot) || !exactSha(expectedSha) || !exactSha(approvedSha)) {
        throw new Error("watchdog release pin or approval pin is incomplete or non-canonical");
    }
    if (approvedSha !== expectedSha) throw new Error("watchdog expected SHA is not explicitly approved");
    const runnerConfig = {};
    for (const runner of RUNNERS) {
        const runnerExpectedSha = String(env[runner.expectedShaEnv] || expectedSha).trim().toLowerCase();
        const runnerReleaseRoot = String(env[runner.releaseRootEnv] || (runnerExpectedSha === expectedSha ? releaseRoot : `/home/deploy/disdex-trading/releases/${runnerExpectedSha}`)).trim();
        if (!exactSha(runnerExpectedSha) || !isAbsoluteCanonicalPath(runnerReleaseRoot)) {
            throw new Error(`${runner.key} release pin is incomplete or non-canonical`);
        }
        const unit = String(env[runner.unitEnv] || "").trim();
        if (!serviceAllowed(runner, unit, runnerExpectedSha)) throw new Error(`${runner.key} service unit is not allow-listed for the pinned release`);
        runnerConfig[runner.key] = {
            ...runner,
            unit,
            expectedSha: runnerExpectedSha,
            expectedCwd: runnerReleaseRoot,
            ...runnerPaths({ healthRoot }, runner),
        };
    }
    const statePath = env.DISDEX_WATCHDOG_STATE_PATH || join(healthRoot, "private", "watchdog-current-state.json");
    const auditPath = env.DISDEX_WATCHDOG_AUDIT_PATH || join(healthRoot, "private", "watchdog-current-audit.json");
    const lockPath = env.DISDEX_WATCHDOG_LOCK_PATH || join(healthRoot, "private", "watchdog-current.lock");
    for (const path of [statePath, auditPath, lockPath]) {
        if (!pathWithin(healthRoot, path) || !isAbsoluteCanonicalPath(path)) throw new Error("watchdog private path escapes health root");
    }
    const sharedRiskExpectedSha = String(env.DISDEX_WATCHDOG_SHARED_RISK_EXPECTED_SHA || runnerConfig.V12_X1_ALL.expectedSha).trim().toLowerCase();
    if (!exactSha(sharedRiskExpectedSha)) throw new Error("shared crypto risk writer release pin is invalid");
    return { healthRoot, releaseRoot, expectedSha, approvedSha, sharedRiskExpectedSha, runnerConfig, statePath, auditPath, lockPath };
}

async function assertRelease(config) {
    const healthStats = await lstat(config.healthRoot);
    if (!healthStats.isDirectory() || healthStats.isSymbolicLink()) throw new Error("health root is not a real directory");
    const rootStats = await lstat(config.releaseRoot);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error("release root is not a real directory");
    if ((await realpath(config.releaseRoot)) !== config.releaseRoot) throw new Error("release root is not canonical");
    const marker = join(config.releaseRoot, RELEASE_MARKER);
    const markerStats = await lstat(marker);
    if (!markerStats.isFile() || markerStats.isSymbolicLink()) throw new Error("release marker is not a regular file");
    const contents = (await readFile(marker, "utf8")).trim();
    if (contents !== config.expectedSha) throw new Error("release marker does not match expected SHA");
    const heartbeatDir = join(config.healthRoot, "heartbeats");
    const heartbeatDirStats = await lstat(heartbeatDir);
    if (!heartbeatDirStats.isDirectory() || heartbeatDirStats.isSymbolicLink()) throw new Error("heartbeat directory is not a real directory");
    for (const runner of Object.values(config.runnerConfig)) {
        const stats = await lstat(runner.expectedCwd);
        if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`${runner.key} release root is not a real directory`);
        if ((await realpath(runner.expectedCwd)) !== runner.expectedCwd) throw new Error(`${runner.key} release root is not canonical`);
        const runnerMarker = join(runner.expectedCwd, RELEASE_MARKER);
        const runnerMarkerStats = await lstat(runnerMarker);
        if (!runnerMarkerStats.isFile() || runnerMarkerStats.isSymbolicLink()) throw new Error(`${runner.key} release marker is invalid`);
        if ((await readFile(runnerMarker, "utf8")).trim() !== runner.expectedSha) throw new Error(`${runner.key} release marker does not match expected SHA`);
    }
}

async function readHeartbeat(config, runner, now) {
    const path = runner.heartbeat;
    let raw;
    try {
        raw = await readFile(path, "utf8");
    } catch (error) {
        if (error?.code === "ENOENT") return { present: false };
        throw new Error(`${runner.key} heartbeat cannot be read`);
    }
    let value;
    try { value = JSON.parse(raw); } catch { throw new Error(`${runner.key} heartbeat JSON is malformed`); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${runner.key} heartbeat is not an object`);
    validateRunnerOwnedHeartbeat(value, runner.key);
    const required = ["schema", "runnerId", "serviceUnit", "runtimeSha", "expectedSha", "workingDirectory", "mode", "liveEnabled", "safetyState", "heartbeatAt", "lastTickAt"];
    for (const key of required) if (!(key in value)) throw new Error(`${runner.key} heartbeat.${key} is missing`);
    if (value.schema !== "disdex-runner-heartbeat/v1" || value.runnerId !== runner.key) throw new Error(`${runner.key} heartbeat identity is invalid`);
    if (!serviceAllowed(runner, value.serviceUnit, runner.expectedSha) || value.serviceUnit !== runner.unit) throw new Error(`${runner.key} heartbeat service unit is invalid`);
    if (value.runtimeSha !== runner.expectedSha || value.expectedSha !== runner.expectedSha) throw new Error(`${runner.key} heartbeat SHA does not match release`);
    if (value.workingDirectory !== runner.expectedCwd) throw new Error(`${runner.key} heartbeat cwd does not match release`);
    if (String(value.mode).toUpperCase() !== "LIVE" || value.liveEnabled !== true) throw new Error(`${runner.key} heartbeat is not live-enabled`);
    if (value.safetyState !== "HEALTHY") return { present: true, valid: true, value, safeState: false, reason: `safetyState=${safeReason(value.safetyState)}` };
    for (const key of ["heartbeatAt", "lastTickAt"]) {
        if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] <= 0 || value[key] > now + 60_000) throw new Error(`${runner.key} heartbeat timestamp is invalid`);
    }
    if (runner.key === "QUALITY102_CAUSAL_V1") {
        const q102 = value.quality102;
        if (!q102 || q102.selectorMode !== "CAUSAL_V4" || q102.historicalSelectorParity !== false || q102.brkLiveEnabled !== true) {
            throw new Error("QUALITY102_CAUSAL_V1 heartbeat selector contract is invalid");
        }
    }
    return { present: true, valid: true, value, safeState: true, ...heartbeatFreshness(value, runner, now) };
}

async function systemctl(args, tolerateInactive = false) {
    try {
        return (await execFile(SYSTEMCTL, args, { encoding: "utf8", windowsHide: true })).stdout.trim();
    } catch (error) {
        if (tolerateInactive && error?.code === 3) return String(error.stdout || "").trim();
        throw new Error(`systemd observation failed: ${safeReason(error?.message)}`);
    }
}

async function inspectService(unit) {
    const activeState = await systemctl(["show", unit, "--property=ActiveState", "--value", "--no-pager"]);
    const mainPidText = await systemctl(["show", unit, "--property=MainPID", "--value", "--no-pager"]);
    const mainPid = Number(mainPidText);
    if (!Number.isInteger(mainPid) || mainPid < 0) throw new Error("systemd MainPID is invalid");
    return { active: activeState === "active", mainPid };
}

async function processInfo(pid) {
    if (pid <= 0) return { cwd: undefined, command: undefined };
    let cwd;
    try { cwd = await readlink(`/proc/${pid}/cwd`); } catch { throw new Error("runner process cwd is unavailable"); }
    let command;
    try { command = (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " ").trim(); } catch { throw new Error("runner process command is unavailable"); }
    return { cwd, command };
}

function samePath(left, right) {
    const normalize = (value) => resolve(value).replaceAll("\\", "/").replace(/\/$/, "");
    return normalize(left) === normalize(right);
}

function pathToken(token, root, relativePath) {
    return token === relativePath || samePath(token, join(root, relativePath));
}

function commandMatches(config, runner, command) {
    if (!command) return false;
    const tokens = command.split(/\s+/);
    const scripts = runner.script ? [runner.script] : runner.scripts;
    const scriptFound = scripts.some((script) => pathToken(tokens[tokens.indexOf(script)] || "", runner.expectedCwd, script) || tokens.some((token) => token === join(runner.expectedCwd, script)));
    const runnerLoaderFound = tokens.some((token) => samePath(token, join(runner.expectedCwd, "node_modules/tsx/dist/cli.mjs")) || samePath(token, join(runner.expectedCwd, "node_modules/.bin/tsx")));
    const daemon = tokens.includes("--daemon") || tokens.includes("--once");
    const v52Python = runner.key === "V52" && (
        tokens[0] === "/usr/bin/python3" || tokens[0] === "python3" || tokens[0] === "python"
        || samePath(tokens[0], join(runner.expectedCwd, ".venv2/bin/python"))
    );
    return scriptFound && daemon && (runnerLoaderFound || v52Python);
}

async function markerExists(path) {
    try {
        const stats = await lstat(path);
        if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("stop marker is not a regular file");
        return true;
    } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
    }
}

async function loadState(path) {
    try {
        const value = JSON.parse(await readFile(path, "utf8"));
        if (!value || value.schema !== "disdex-runner-watchdog/current-state-v1" || typeof value.runners !== "object") throw new Error("invalid watchdog state");
        return value;
    } catch (error) {
        if (error?.code === "ENOENT") return { schema: "disdex-runner-watchdog/current-state-v1", runners: {} };
        throw new Error("watchdog state is malformed");
    }
}

async function atomicJson(path, value) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try { await rename(tmp, path); } catch (error) { await unlink(tmp).catch(() => undefined); throw error; }
}

async function acquireLock(path) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await chmod(dirname(path), 0o700);
    try {
        await mkdir(path, { recursive: false, mode: 0o700 });
    } catch { throw new Error("watchdog cycle lock is already held"); }
    return async () => { await rmdir(path).catch((error) => { if (error?.code !== "ENOENT") throw error; }); };
}

function recentAttempts(state, key, now) {
    const attempts = Array.isArray(state.runners?.[key]?.attempts) ? state.runners[key].attempts : [];
    return attempts.filter((item) => Number.isInteger(item?.at) && now - item.at <= ATTEMPT_WINDOW_MS);
}

function decision(action, reason, runner, extra = {}) {
    return { runner: runner.key, unit: runner.unit, action, reason: safeReason(reason), tradingEffects: { ...ZERO_EFFECTS }, ...extra };
}

async function evaluateRunner(config, runner, state, now) {
    const paths = runnerPaths(config, runner);
    const attempts = recentAttempts(state, runner.key, now);
    if (runner.key === "V52" && await markerExists(paths.stopMarker)) {
        return { result: decision("NOOP", "V52 intentional stop marker is present", runner), attempts, clearAttempts: true };
    }
    const heartbeat = await readHeartbeat(config, runner, now);
    if (!heartbeat.present) return { result: decision("RESTART", "heartbeat is missing", runner), attempts };
    if (!heartbeat.valid || heartbeat.safeState === false) return { result: decision("HOLD_FAIL_CLOSED", heartbeat.reason || "heartbeat safety state is not healthy", runner), attempts, clearAttempts: false };
    const service = await inspectService(runner.unit);
    const process = await processInfo(service.mainPid);
    const identityHealthy = service.active && service.mainPid > 0 && process.cwd === runner.expectedCwd && commandMatches(config, runner, process.command);
    const healthy = heartbeat.fresh && identityHealthy;
    if (healthy) return { result: decision("NOOP", "heartbeat, service, cwd, and process command are consistent", runner), attempts, clearAttempts: true };
    if (!heartbeat.fresh && identityHealthy) {
        const reason = heartbeat.heartbeatFresh
            ? "runner-owned lastTickAt is older than the runner cadence; active process identity is retained without restart"
            : "heartbeat is older than the runner cadence; active process identity is retained without restart";
        return { result: decision("HOLD_FAIL_CLOSED", reason, runner), attempts, clearAttempts: false };
    }
    const reason = !service.active || service.mainPid <= 0 ? "service is not active" : process.cwd !== runner.expectedCwd ? "process cwd is not pinned to release" : "process command is not pinned to runner";
    return { result: decision("RESTART", reason, runner), attempts };
}

async function run(config) {
    const now = Date.now();
    await assertRelease(config);
    const releaseLock = await acquireLock(config.lockPath);
    try {
        const state = await loadState(config.statePath);
        const nextState = { schema: "disdex-runner-watchdog/current-state-v1", runners: {} };
        const decisions = {};
        const restartCalls = [];
        const errors = [];
        let compositionInvariantError;
        try {
            for (const legacyUnit of LEGACY_LIVE_UNITS) {
                const legacyOutput = await systemctl(["show", legacyUnit, "--property=LoadState", "--property=ActiveState", "--no-pager"], true);
                const props = Object.fromEntries(String(legacyOutput || "").split(/\r?\n/).filter(Boolean).map((line) => line.split("=", 2)));
                if (props.LoadState === "loaded" && !new Set(["inactive", "failed"]).has(props.ActiveState)) {
                    throw new Error(`LEGACY_LIVE_CONFLICT:${legacyUnit}:${props.ActiveState || "UNKNOWN"}`);
                }
            }
            for (const runner of Object.values(config.runnerConfig)) {
                const nonInactiveUnits = parseNonInactiveServiceUnits(await systemctl([
                    "list-units", "--all", "--type=service", "--no-legend", runner.unitPattern,
                ]), runner.unitPrefix);
                assertReleasePinnedRunnerSingleton(nonInactiveUnits, runner.unit, `RUNNER_LINEAGE:${runner.key}`);
            }
            const nonInactiveRiskUnits = parseNonInactiveServiceUnits(await systemctl([
                "list-units", "--all", "--type=service", "--no-legend", SHARED_CRYPTO_RISK_UNIT_PATTERN,
            ]), "disdex-shared-crypto-risk");
            assertSharedCryptoRiskWriterSingleton(nonInactiveRiskUnits, config.sharedRiskExpectedSha);
            const nonInactiveMarginUnits = parseNonInactiveServiceUnits(await systemctl([
                "list-units", "--all", "--type=service", "--no-legend", MARGIN_GUARD_UNIT_PATTERN,
            ]), "disdex-v12-v52-margin-guard");
            assertReleasePinnedRunnerSingleton(nonInactiveMarginUnits, `disdex-v12-v52-margin-guard@${config.expectedSha}.service`, "MARGIN_GUARD_LINEAGE", true);
        } catch (error) {
            compositionInvariantError = safeReason(error?.message);
            errors.push(`COMPOSITION_LINEAGE: ${compositionInvariantError}`);
        }
        for (const runner of Object.values(config.runnerConfig)) {
            try {
                if (compositionInvariantError) {
                    const result = decision("HOLD_FAIL_CLOSED", `composition lineage invariant failed: ${compositionInvariantError}`, runner, { safetyUnverified: true });
                    decisions[runner.key] = result;
                    nextState.runners[runner.key] = { attempts: [] };
                    continue;
                }
                const evaluated = await evaluateRunner(config, runner, state, now);
                const attempts = evaluated.attempts;
                let result = evaluated.result;
                if (result.action === "RESTART") {
                    if (attempts.length >= MAX_ATTEMPTS) {
                        result = decision("HOLD_FAIL_CLOSED", "restart budget exhausted", runner);
                    } else {
                        const last = attempts[attempts.length - 1];
                        const delay = BACKOFF_MS[Math.min(attempts.length, BACKOFF_MS.length - 1)];
                        if (last && now < last.at + delay) {
                            result = decision("HOLD_FAIL_CLOSED", `restart backoff active until ${last.at + delay}`, runner);
                        } else {
                            await systemctl(["restart", runner.unit]);
                            restartCalls.push(runner.unit);
                            const updated = [...attempts, { at: now, unit: runner.unit }].slice(-MAX_ATTEMPTS);
                            nextState.runners[runner.key] = { attempts: updated };
                        }
                    }
                }
                if (!nextState.runners[runner.key]) nextState.runners[runner.key] = { attempts: evaluated.clearAttempts ? [] : attempts };
                decisions[runner.key] = result;
            } catch (error) {
                const result = decision("HOLD_FAIL_CLOSED", safeReason(error?.message), runner, { safetyUnverified: true });
                decisions[runner.key] = result;
                nextState.runners[runner.key] = { attempts: [] };
                errors.push(`${runner.key}: ${safeReason(error?.message)}`);
            }
        }
        await atomicJson(config.statePath, nextState);
        const hasHardError = errors.length > 0;
        const audit = {
            schema: "disdex-runner-watchdog/current-audit-v1",
            observedAt: now,
            releaseSha: config.expectedSha,
            releaseRoot: config.releaseRoot,
            exitCode: hasHardError ? 1 : 0,
            restartCalls,
            decisions,
            errors,
            tradingEffects: { ...ZERO_EFFECTS },
        };
        await atomicJson(config.auditPath, audit);
        return { exitCode: hasHardError ? 1 : 0, restartCalls, decisions };
    } finally {
        await releaseLock();
    }
}

function selfTest() {
    const sha = "1094ebfec3314b355f8ebe9caf17b19e5871628c";
    const v12 = RUNNERS[0];
    const pengu = RUNNERS[1];
    const v52 = RUNNERS[2];
    const q102 = RUNNERS[3];
    if (!serviceAllowed(v12, v12.expectedUnit(sha), sha)) throw new Error("V12 allowlist self-test failed");
    if (!serviceAllowed(pengu, pengu.expectedUnit(sha), sha)) throw new Error("PENGU release-pinned allowlist self-test failed");
    if (serviceAllowed(pengu, "disdex-pengu-dual-ls-v2-v20.service", sha)) throw new Error("PENGU legacy unit fail-closed self-test failed");
    if (!serviceAllowed(v52, v52.expectedUnit(sha), sha)) throw new Error("V52 release-pinned allowlist self-test failed");
    if (serviceAllowed(v52, v52.expectedUnit("f59347fad11553b833e75f6f35a0c545464fdf5f"), sha)) throw new Error("V52 SHA mismatch fail-closed self-test failed");
    if (serviceAllowed(q102, "disdex-quality102-causal-v1@f59347fad11553b833e75f6f35a0c545464fdf5.service", sha)) throw new Error("39/40 SHA fail-closed self-test failed");
    const baseConfigEnv = {
        DISDEX_WATCHDOG_HEALTH_ROOT: join(process.cwd(), "self-test-health"),
        DISDEX_WATCHDOG_RELEASE_ROOT: join(process.cwd(), "self-test-releases", sha),
        DISDEX_WATCHDOG_EXPECTED_SHA: sha,
        DISDEX_WATCHDOG_V12_SERVICE_UNIT: v12.expectedUnit(sha),
        DISDEX_WATCHDOG_PENGU_SERVICE_UNIT: pengu.expectedUnit(sha),
        DISDEX_WATCHDOG_V52_SERVICE_UNIT: v52.expectedUnit(sha),
        DISDEX_WATCHDOG_Q102_SERVICE_UNIT: q102.expectedUnit(sha),
    };
    try {
        buildConfig(baseConfigEnv);
        throw new Error("approval gate self-test accepted a missing approval pin");
    } catch (error) {
        if (!String(error?.message || "").includes("approval pin")) throw error;
    }
    const approvedEnv = { ...baseConfigEnv, DISDEX_WATCHDOG_APPROVED_SHA: sha };
    const approvedConfig = buildConfig(approvedEnv);
    if (approvedConfig.approvedSha !== sha) throw new Error("approval gate self-test did not retain approved SHA");
    const mismatchedApprovalSha = "f".repeat(40);
    try {
        buildConfig({ ...baseConfigEnv, DISDEX_WATCHDOG_APPROVED_SHA: mismatchedApprovalSha });
        throw new Error("approval gate self-test accepted a mismatched approval pin");
    } catch (error) {
        if (!String(error?.message || "").includes("not explicitly approved")) throw error;
    }
    console.log("DISDEX_CURRENT_WATCHDOG_APPROVAL_GATE_SELFTEST_PASS");
    const expectedRiskUnit = `disdex-shared-crypto-risk@${sha}.service`;
    const conflictingRiskUnit = `disdex-shared-crypto-risk@${"a".repeat(40)}.service`;
    assertSharedCryptoRiskWriterSingleton([expectedRiskUnit], sha);
    try {
        assertSharedCryptoRiskWriterSingleton([expectedRiskUnit, conflictingRiskUnit], sha);
        throw new Error("shared risk singleton self-test accepted duplicate units");
    } catch (error) {
        if (!String(error?.message || "").includes("singleton invariant")) throw error;
    }
    try {
        assertSharedCryptoRiskWriterSingleton([conflictingRiskUnit], sha);
        throw new Error("shared risk singleton self-test accepted a mismatched release");
    } catch (error) {
        if (!String(error?.message || "").includes("singleton invariant")) throw error;
    }
    const parsedRiskUnits = parseNonInactiveServiceUnits(`  ${expectedRiskUnit} loaded active running\n  ${conflictingRiskUnit} loaded activating auto-restart\n  disdex-shared-crypto-risk@${"b".repeat(40)}.service loaded inactive dead\n  disdex-shared-crypto-risk@${"c".repeat(40)}.service loaded failed failed\n  unrelated.service loaded active running`, "disdex-shared-crypto-risk");
    if (parsedRiskUnits.length !== 3 || parsedRiskUnits[0] !== expectedRiskUnit || parsedRiskUnits[1] !== conflictingRiskUnit || parsedRiskUnits[2] !== `disdex-shared-crypto-risk@${"c".repeat(40)}.service`) throw new Error("shared risk unit parser self-test failed");
    console.log("DISDEX_CURRENT_WATCHDOG_SHARED_RISK_SINGLETON_SELFTEST_PASS");
    console.log("DISDEX_CURRENT_WATCHDOG_NONINACTIVE_RISK_SELFTEST_PASS");
    const expectedQ102Unit = q102.expectedUnit(sha);
    const conflictingQ102Unit = q102.expectedUnit("a".repeat(40));
    assertReleasePinnedRunnerSingleton([], expectedQ102Unit, "RUNNER_LINEAGE:Q102");
    assertReleasePinnedRunnerSingleton([expectedQ102Unit], expectedQ102Unit, "RUNNER_LINEAGE:Q102");
    try {
        assertReleasePinnedRunnerSingleton([expectedQ102Unit, conflictingQ102Unit], expectedQ102Unit, "RUNNER_LINEAGE:Q102");
        throw new Error("Q102 lineage singleton self-test accepted a conflicting release");
    } catch (error) {
        if (!String(error?.message || "").includes("singleton invariant")) throw error;
    }
    const expectedMarginUnit = `disdex-v12-v52-margin-guard@${sha}.service`;
    assertReleasePinnedRunnerSingleton([expectedMarginUnit], expectedMarginUnit, "MARGIN_GUARD_LINEAGE", true);
    try {
        assertReleasePinnedRunnerSingleton([], expectedMarginUnit, "MARGIN_GUARD_LINEAGE", true);
        throw new Error("margin lineage self-test accepted a missing current unit");
    } catch (error) {
        if (!String(error?.message || "").includes("singleton invariant")) throw error;
    }
    console.log("DISDEX_CURRENT_WATCHDOG_RUNNER_LINEAGE_SINGLETON_SELFTEST_PASS");
    const config = { releaseRoot: "/home/deploy/disdex-trading/releases/1094ebfec3314b355f8ebe9caf17b19e5871628c" };
    const q102Pinned = { ...q102, expectedCwd: config.releaseRoot };
    const command = `/usr/bin/node ${config.releaseRoot}/node_modules/tsx/dist/cli.mjs scripts/disdex-quality102-causal-v1-live-runner.ts --daemon`;
    if (!commandMatches(config, q102Pinned, command)) throw new Error("tsx command self-test failed");
    if (commandMatches(config, q102Pinned, "/usr/bin/node /tmp/tsx scripts/disdex-quality102-causal-v1-live-runner.ts --daemon")) throw new Error("un-pinned command self-test failed");
    const v52Pinned = { ...v52, expectedCwd: config.releaseRoot };
    const v52VenvCommand = `${config.releaseRoot}/.venv2/bin/python scripts/disdex_v52_aster_only_live_engine.py --mode live --daemon`;
    if (!commandMatches(config, v52Pinned, v52VenvCommand)) throw new Error("V52 release venv command self-test failed");
    if (commandMatches(config, v52Pinned, "/tmp/.venv2/bin/python scripts/disdex_v52_aster_only_live_engine.py --mode live --daemon")) throw new Error("V52 unpinned venv command self-test failed");
    const snapshotOnlyHeartbeat = {
        schema: "disdex-runner-heartbeat/v1",
        runnerId: "V12_X1_ALL",
        serviceUnit: v12.expectedUnit(sha),
        runtimeSha: sha,
        expectedSha: sha,
        workingDirectory: config.releaseRoot,
        mode: "LIVE",
        liveEnabled: true,
        safetyState: "HEALTHY",
        heartbeatAt: Date.now(),
        lastTickAt: Date.now(),
    };
    validateRunnerOwnedHeartbeat(snapshotOnlyHeartbeat, "V12_X1_ALL");
    console.log("DISDEX_CURRENT_WATCHDOG_HEARTBEAT_CONTRACT_SELFTEST_PASS");
    const now = Date.now();
    const freshHeartbeat = {
        ...snapshotOnlyHeartbeat,
        lastReconciliationAt: null,
        lastDecision: null,
        reason: "runner tick freshness self-test",
        symbols: [],
        caps: {},
        restartAttempts: 0,
        updatedAt: now,
        heartbeatAt: now,
        lastTickAt: now - v12.tickTimeoutMs - 1,
    };
    validateRunnerOwnedHeartbeat(freshHeartbeat, "V12_X1_ALL");
    const freshness = heartbeatFreshness(freshHeartbeat, v12, now);
    if (!freshness.heartbeatFresh || freshness.runnerTickFresh || freshness.fresh) {
        throw new Error("runner tick freshness self-test failed");
    }
    console.log("DISDEX_CURRENT_WATCHDOG_RUNNER_TICK_FRESHNESS_SELFTEST_PASS");
    console.log("DISDEX_CURRENT_WATCHDOG_V52_RELEASE_PIN_SELFTEST_PASS");
    const source = readFileSync(new URL(import.meta.url), "utf8");
    if (/(?:submitOrder|cancelOrder|closePosition|placeMarket|modifyPosition)\s*\(/.test(source)) throw new Error("forbidden operation self-test failed");
    console.log("DISDEX_CURRENT_WATCHDOG_SELFTEST_PASS");
}

if (process.argv.includes("--self-test")) {
    selfTest();
} else {
    const envFile = process.env.DISDEX_WATCHDOG_ENV_FILE || DEFAULT_ENV_FILE;
    try {
        const env = await loadEnv(envFile);
        const config = buildConfig({ ...env, ...process.env });
        const result = await run(config);
        console.log(`DISDEX_CURRENT_WATCHDOG_RESULT exitCode=${result.exitCode} restarts=${result.restartCalls.length}`);
        process.exitCode = result.exitCode;
    } catch (error) {
        console.error(`DISDEX_CURRENT_WATCHDOG_FAIL_CLOSED ${safeReason(error?.message)}`);
        process.exitCode = 1;
    }
}
