import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, readlink, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SYSTEMCTL = "/usr/bin/systemctl";
const EXPECTED_SHA = String(process.env.DISDEX_HEALTH_SNAPSHOT_EXPECTED_SHA || "").trim().toLowerCase();
const RELEASE_ROOT = String(process.env.DISDEX_HEALTH_SNAPSHOT_RELEASE_ROOT || "").trim();
const HEALTH_ROOT = String(process.env.DISDEX_HEALTH_SNAPSHOT_HEALTH_ROOT || "/var/lib/disdex/runner-health").trim();
const KILL_SWITCH_PATH = String(process.env.DISDEX_HEALTH_SNAPSHOT_KILL_SWITCH_PATH || "/var/lib/disdex/shared/kill-switch.json").trim();

function configuredPath(name, fallback) {
    return String(process.env[name] || fallback).trim();
}

const RUNNERS = [
    {
        key: "V12_X1_ALL",
        runnerId: "V12_X1_ALL",
        unit: `disdex-v12-x1-all@${EXPECTED_SHA}.service`,
        script: "scripts/disdex-v12-x1-all-live-runner.ts",
        statePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_V12_STATE_PATH", "/var/lib/disdex/v12-x1-all/runner.json"),
        heartbeatFile: "v12-x1-all.json",
        maxStateAgeMs: 3 * 60 * 60_000,
    },
    {
        key: "PENGU_V8",
        runnerId: "PENGU_V8",
        unit: `disdex-pengu-dual-ls-v2@${EXPECTED_SHA}.service`,
        script: "scripts/disdex-pengu-dual-ls-v2-live-runner.ts",
        statePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_PENGU_STATE_PATH", "/var/lib/disdex/pengu-dual-ls-v2/runner-live.json"),
        heartbeatFile: "pengu-v8.json",
        maxStateAgeMs: 3 * 60 * 60_000,
    },
    {
        key: "V52",
        runnerId: "V52",
        unit: `disdex-v52-aster-only@${EXPECTED_SHA}.service`,
        script: "scripts/disdex_v52_aster_only_live_engine.py",
        statePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_V52_STATE_PATH", "/var/lib/disdex/v52-aster-only/runner-live.json"),
        heartbeatFile: "v52.json",
        maxStateAgeMs: 6 * 60 * 60_000,
    },
    {
        key: "QUALITY102_CAUSAL_V1",
        runnerId: "QUALITY102_CAUSAL_V1",
        unit: `disdex-quality102-causal-v1@${EXPECTED_SHA}.service`,
        script: "scripts/disdex-quality102-causal-v1-live-runner.ts",
        statePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_Q102_STATE_PATH", "/var/lib/disdex/quality102-causal-v1/state.json"),
        heartbeatFile: "quality102-causal-v1.json",
        maxStateAgeMs: 3 * 60 * 60_000,
    },
];

function json(path) {
    return readFile(path, "utf8").then((raw) => JSON.parse(raw));
}

async function serviceSnapshot(unit) {
    const { stdout } = await execFile(SYSTEMCTL, [
        "show", unit, "-p", "ActiveState", "-p", "MainPID", "-p", "WorkingDirectory", "-p", "ExecStart", "--no-pager",
    ], { encoding: "utf8" });
    const values = {};
    for (const line of stdout.split(/\r?\n/)) {
        const separator = line.indexOf("=");
        if (separator > 0) values[line.slice(0, separator)] = line.slice(separator + 1);
    }
    const pid = Number(values.MainPID || 0);
    let cwd = "";
    let command = "";
    if (pid > 0) {
        cwd = await readlink(`/proc/${pid}/cwd`);
        command = (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " ").trim();
    }
    return {
        active: values.ActiveState === "active",
        pid,
        cwd,
        command,
        execStart: values.ExecStart || "",
    };
}

async function sharedKillSwitch() {
    try {
        const value = await json(KILL_SWITCH_PATH);
        return value && value.active === true ? String(value.reason || "shared kill switch active") : "";
    } catch (error) {
        if (error?.code === "ENOENT") return "";
        return "shared kill switch could not be read";
    }
}

async function atomicJson(path, value) {
    await mkdir(dirname(path), { recursive: true, mode: 0o750 });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o640 });
    try {
        await rename(temporary, path);
    } catch (error) {
        await writeFile(temporary, "", { encoding: "utf8" }).catch(() => undefined);
        throw error;
    }
}

function releaseValid() {
    return /^[0-9a-f]{40}$/.test(EXPECTED_SHA) && resolve(RELEASE_ROOT) === RELEASE_ROOT;
}

function stateIdentityMatches(runner, state) {
    const strategyId = String(state?.strategyId || "");
    return strategyId === runner.runnerId
        || (runner.key === "V12_X1_ALL" && strategyId === "V12_X1.00_ALL")
        || (runner.key === "PENGU_V8" && strategyId === "PENGU_DUAL_LS_V2_FINAL")
        || (runner.key === "V52" && strategyId === "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96");
}

async function buildHeartbeat(runner, now, killReason) {
    let state;
    let stateError = "";
    try {
        state = await json(runner.statePath);
    } catch {
        stateError = `${runner.key} state unavailable`;
    }
    let service;
    let serviceError = "";
    try {
        service = await serviceSnapshot(runner.unit);
    } catch {
        serviceError = `${runner.key} service observation failed`;
    }
    const updatedAt = Math.max(
        Number(state?.updatedAt || 0),
        Number(state?.lastReconciledAt || 0),
        Number(state?.initialDaemonReconciliation?.completedAt || 0),
    );
    const stateFresh = updatedAt > 0 && now - updatedAt <= runner.maxStateAgeMs;
    const serviceActive = Boolean(service?.active);
    const processPresent = Boolean(service?.pid > 0);
    const cwdCurrent = Boolean(service?.cwd === RELEASE_ROOT);
    const commandCurrent = Boolean(service?.command.includes(runner.script) && service?.command.includes("--daemon"));
    const execCurrent = Boolean(service?.execStart.includes(RELEASE_ROOT));
    const identityOk = serviceActive && processPresent && cwdCurrent && commandCurrent && execCurrent;
    const blockedReason = killReason || stateError || serviceError || !releaseValid()
        ? (killReason || stateError || serviceError || "release pin is invalid")
        : !identityOk
            ? `${runner.key} service identity is not current`
            : !stateIdentityMatches(runner, state)
                ? `${runner.key} state identity is invalid`
                : !stateFresh
                    ? `${runner.key} state is stale`
                    : "";
    const heartbeat = {
        schema: "disdex-runner-heartbeat/v1",
        runnerId: runner.runnerId,
        serviceUnit: runner.unit,
        runtimeSha: EXPECTED_SHA,
        expectedSha: EXPECTED_SHA,
        workingDirectory: RELEASE_ROOT,
        mode: "LIVE",
        liveEnabled: serviceActive,
        safetyState: blockedReason ? "BLOCKED" : "HEALTHY",
        heartbeatAt: now,
        lastTickAt: updatedAt > 0 ? updatedAt : now,
    };
    if (runner.key === "QUALITY102_CAUSAL_V1") {
        heartbeat.quality102 = {
            selectorMode: "CAUSAL_V4",
            historicalSelectorParity: false,
            brkLiveEnabled: true,
        };
    }
    if (blockedReason) heartbeat.reason = blockedReason;
    return {
        heartbeat,
        diagnostics: { active: serviceActive, processPresent, cwdCurrent, commandCurrent, execCurrent, stateFresh, strategyOk: stateIdentityMatches(runner, state) },
    };
}

async function main() {
    const now = Date.now();
    const killReason = await sharedKillSwitch();
    const results = [];
    for (const runner of RUNNERS) {
        const { heartbeat, diagnostics } = await buildHeartbeat(runner, now, killReason);
        await atomicJson(`${HEALTH_ROOT}/heartbeats/${runner.heartbeatFile}`, heartbeat);
        results.push({ runner: runner.key, safetyState: heartbeat.safetyState, stateAt: heartbeat.lastTickAt, ...diagnostics });
    }
    console.log(JSON.stringify({
        status: "DISDEX_RUNNER_HEALTH_SNAPSHOT_PASS",
        readOnly: true,
        tradingEffects: { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 },
        ordersSent: 0,
        results,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "DISDEX_RUNNER_HEALTH_SNAPSHOT_FAIL_CLOSED",
        reason: String(error?.message || error).slice(0, 240),
        tradingEffects: { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 },
        ordersSent: 0,
    }));
    process.exitCode = 1;
});
