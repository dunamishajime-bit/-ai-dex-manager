import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, readlink, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { isIntentionallyDisabledV52State } from "../../../lib/disdex-health-disabled-peer.mjs";

const execFile = promisify(execFileCallback);
const SYSTEMCTL = "/usr/bin/systemctl";
const DEFAULT_EXPECTED_SHA = String(process.env.DISDEX_HEALTH_SNAPSHOT_EXPECTED_SHA || "").trim().toLowerCase();
const DEFAULT_RELEASE_ROOT = String(process.env.DISDEX_HEALTH_SNAPSHOT_RELEASE_ROOT || "").trim();
const HEALTH_ROOT = String(process.env.DISDEX_HEALTH_SNAPSHOT_HEALTH_ROOT || "/var/lib/disdex/runner-health").trim();
const KILL_SWITCH_PATH = String(process.env.DISDEX_HEALTH_SNAPSHOT_KILL_SWITCH_PATH || "/var/lib/disdex/shared/kill-switch.json").trim();
const MARGIN_STATE_PATH = String(process.env.DISDEX_HEALTH_SNAPSHOT_MARGIN_STATE_PATH || "/var/lib/disdex/shared/margin-risk/guard-live.json").trim();
const SHARED_RISK_STATE_PATH = String(process.env.DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_STATE_PATH || "/var/lib/disdex/shared/crypto-daily-risk.json").trim();
const SHARED_RISK_UNIT = String(process.env.DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_SERVICE_UNIT || `disdex-shared-crypto-risk@${DEFAULT_EXPECTED_SHA}.service`).trim();
const SHARED_RISK_RELEASE_ROOT = String(process.env.DISDEX_HEALTH_SNAPSHOT_SHARED_RISK_RELEASE_ROOT || `/home/deploy/disdex-trading/releases/${DEFAULT_EXPECTED_SHA}`).trim();
const MARGIN_UNIT = String(process.env.DISDEX_HEALTH_SNAPSHOT_MARGIN_SERVICE_UNIT || `disdex-v12-v52-margin-guard@${DEFAULT_EXPECTED_SHA}.service`).trim();
const MARGIN_RELEASE_ROOT = String(process.env.DISDEX_HEALTH_SNAPSHOT_MARGIN_RELEASE_ROOT || `/home/deploy/disdex-trading/releases/${DEFAULT_EXPECTED_SHA}`).trim();
const MARGIN_FRESHNESS_GRACE_MS = 120_000;
const SHARED_RISK_FRESHNESS_GRACE_MS = 120_000;
const ASTER_RATE_BUDGET_PATH = configuredPath("DISDEX_HEALTH_SNAPSHOT_RATE_BUDGET_PATH", "/var/lib/disdex/shared/aster-rate-budget.json");
const RATE_BACKLOG_DEGRADED_MS = 10_000;
function classifySharedAsterRateBudget(raw, now) {
    if (!raw || raw.schema !== "disdex-aster-rate-budget/v1"
        || !Number.isFinite(raw.nextAllowedAt) || raw.nextAllowedAt < 0) {
        return { status: "UNKNOWN", backlogMs: null, warning: "ASTER_RATE_BUDGET_STATE_INVALID" };
    }
    const backlogMs = Math.max(0, Math.ceil(raw.nextAllowedAt - now));
    const status = backlogMs > RATE_BACKLOG_DEGRADED_MS ? "DEGRADED" : "HEALTHY";
    return {
        status,
        backlogMs,
        warning: status === "DEGRADED" ? "ASTER_SHARED_RATE_BUDGET_BACKLOG" : null,
        lastPriority: raw.lastPriority || null,
        lastRateLimitStatus: raw.lastRateLimitStatus || null,
    };
}
async function sharedAsterRateBudgetStatus(now) {
    try { return classifySharedAsterRateBudget(await json(ASTER_RATE_BUDGET_PATH), now); }
    catch { return { status: "UNKNOWN", backlogMs: null, warning: "ASTER_SHARED_RATE_BUDGET_UNAVAILABLE" }; }
}

const IDLE_PARITY_CERT_SCHEMA = "disdex-idle-priority-parity-cert/v3";
const IDLE_PARITY_REPLAY_MODEL = "FIXED_BASELINE_ACCEPTED_INTENTS_DYNAMIC_GROSS_V1";

function configuredPath(name, fallback) {
    return String(process.env[name] || fallback).trim();
}

function runnerPin(expectedShaEnv, releaseRootEnv) {
    return {
        expectedSha: String(process.env[expectedShaEnv] || DEFAULT_EXPECTED_SHA).trim().toLowerCase(),
        releaseRoot: String(process.env[releaseRootEnv] || DEFAULT_RELEASE_ROOT).trim(),
    };
}

const V12_PIN = runnerPin("DISDEX_HEALTH_SNAPSHOT_V12_EXPECTED_SHA", "DISDEX_HEALTH_SNAPSHOT_V12_RELEASE_ROOT");
const V12_MODE = String(process.env.DISDEX_HEALTH_SNAPSHOT_V12_MODE || "LEGACY").trim().toUpperCase();
if (!["LEGACY","V4","DISABLED"].includes(V12_MODE)) throw new Error("V12 health snapshot mode is invalid");
const PENGU_PIN = runnerPin("DISDEX_HEALTH_SNAPSHOT_PENGU_EXPECTED_SHA", "DISDEX_HEALTH_SNAPSHOT_PENGU_RELEASE_ROOT");
const V52_PIN = runnerPin("DISDEX_HEALTH_SNAPSHOT_V52_EXPECTED_SHA", "DISDEX_HEALTH_SNAPSHOT_V52_RELEASE_ROOT");
const Q102_PIN = runnerPin("DISDEX_HEALTH_SNAPSHOT_Q102_EXPECTED_SHA", "DISDEX_HEALTH_SNAPSHOT_Q102_RELEASE_ROOT");
const FET_PIN = runnerPin("DISDEX_HEALTH_SNAPSHOT_FET_EXPECTED_SHA", "DISDEX_HEALTH_SNAPSHOT_FET_RELEASE_ROOT");
const HYPE_PIN = runnerPin("DISDEX_HEALTH_SNAPSHOT_HYPE_EXPECTED_SHA", "DISDEX_HEALTH_SNAPSHOT_HYPE_RELEASE_ROOT");
const IDLE_PIN = runnerPin("DISDEX_HEALTH_SNAPSHOT_IDLE_EXPECTED_SHA", "DISDEX_HEALTH_SNAPSHOT_IDLE_RELEASE_ROOT");

const V12_RUNNER = V12_MODE === "DISABLED" ? {
    key: "V12_V4",
    runnerId: "V12_V4",
    disabled: true,
    disabledReason: String(process.env.DISDEX_HEALTH_SNAPSHOT_V12_DISABLED_REASON || "V12 V4 is intentionally disabled pending independent venue certification").trim(),
    unit: "",
    expectedSha: V12_PIN.expectedSha,
    releaseRoot: V12_PIN.releaseRoot,
    script: "scripts/v12-v4-production-runner.ts",
    statePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_V12_STATE_PATH", "/var/lib/disdex/v12-v4/heartbeat.json"),
    heartbeatFile: "v12-v4.json",
    maxStateAgeMs: 0,
} : V12_MODE === "V4" ? {
    key: "V12_V4",
    runnerId: "V12_V4",
    unit: `disdex-v12-v4@${V12_PIN.expectedSha}.service`,
    expectedSha: V12_PIN.expectedSha,
    releaseRoot: V12_PIN.releaseRoot,
    script: "scripts/v12-v4-production-runner.ts",
    statePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_V12_STATE_PATH", "/var/lib/disdex/v12-v4/heartbeat.json"),
    heartbeatFile: "v12-v4.json",
    maxStateAgeMs: 5 * 60_000,
} : {
    key: "V12_X1_ALL",
    runnerId: "V12_X1_ALL",
    unit: `disdex-v12-x1-all@${V12_PIN.expectedSha}.service`,
    expectedSha: V12_PIN.expectedSha,
    releaseRoot: V12_PIN.releaseRoot,
    script: "scripts/disdex-v12-x1-all-live-runner.ts",
    statePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_V12_STATE_PATH", "/var/lib/disdex/v12-x1-all/runner.json"),
    heartbeatFile: "v12-x1-all.json",
    maxStateAgeMs: 3 * 60 * 60_000,
};
const RUNNERS = [
    V12_RUNNER,
    {
        key: "PENGU_V8",
        runnerId: "PENGU_V8",
        unit: `disdex-pengu-dual-ls-v2@${PENGU_PIN.expectedSha}.service`,
        expectedSha: PENGU_PIN.expectedSha,
        releaseRoot: PENGU_PIN.releaseRoot,
        script: "scripts/disdex-pengu-dual-ls-v2-live-runner.ts",
        statePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_PENGU_STATE_PATH", "/var/lib/disdex/pengu-dual-ls-v2/runner-live.json"),
        heartbeatFile: "pengu-v8.json",
        maxStateAgeMs: 3 * 60 * 60_000,
    },
    {
        key: "V52",
        runnerId: "V52",
        unit: `disdex-v52-aster-only@${V52_PIN.expectedSha}.service`,
        expectedSha: V52_PIN.expectedSha,
        releaseRoot: V52_PIN.releaseRoot,
        script: "scripts/disdex_v52_aster_only_live_engine.py",
        statePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_V52_STATE_PATH", "/var/lib/disdex/v52-aster-only/runner-live.json"),
        heartbeatFile: "v52.json",
        maxStateAgeMs: 6 * 60 * 60_000,
    },
    {
        key: "QUALITY102_CAUSAL_V1",
        runnerId: "QUALITY102_CAUSAL_V1",
        unit: `disdex-quality102-causal-v1@${Q102_PIN.expectedSha}.service`,
        expectedSha: Q102_PIN.expectedSha,
        releaseRoot: Q102_PIN.releaseRoot,
        script: "scripts/disdex-quality102-causal-v1-live-runner.ts",
        statePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_Q102_STATE_PATH", "/var/lib/disdex/quality102-causal-v1/state.json"),
        heartbeatFile: "quality102-causal-v1.json",
        maxStateAgeMs: 3 * 60 * 60_000,
    },
    {
        key: "FET_BRK48_RESIDUAL",
        runnerId: "FET_BRK48_RESIDUAL",
        unit: `disdex-fet-brk48@${FET_PIN.expectedSha}.service`,
        expectedSha: FET_PIN.expectedSha,
        releaseRoot: FET_PIN.releaseRoot,
        script: "scripts/disdex-fet-brk48-live-runner.ts",
        statePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_FET_STATE_PATH", "/var/lib/disdex/fet-brk48-residual/state.json"),
        heartbeatFile: "fet-brk48-residual.json",
        maxStateAgeMs: 3 * 60 * 60_000,
    },
    {
        key: "HYPE_TREND_LONG",
        runnerId: "HYPE_TREND_LONG",
        unit: `disdex-hype-long@${HYPE_PIN.expectedSha}.service`,
        expectedSha: HYPE_PIN.expectedSha,
        releaseRoot: HYPE_PIN.releaseRoot,
        script: "scripts/disdex-hype-trend-live-runner.ts",
        statePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_HYPE_STATE_PATH", "/var/lib/disdex/hype-zec-long/runner.json"),
        heartbeatFile: "hype-trend-long.json",
        maxStateAgeMs: 3 * 60 * 60_000,
    },
    {
        key: "IDLE_PRIORITY_SHORT",
        runnerId: "IDLE_PRIORITY_SHORT",
        unit: `disdex-idle-priority-short@${IDLE_PIN.expectedSha}.service`,
        expectedSha: IDLE_PIN.expectedSha,
        releaseRoot: IDLE_PIN.releaseRoot,
        script: "scripts/disdex-idle-priority-short-live-runner.ts",
        statePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_IDLE_STATE_PATH", "/var/lib/disdex/idle-priority/state.json"),
        parityCertificatePath: configuredPath("DISDEX_HEALTH_SNAPSHOT_IDLE_PARITY_CERT_PATH", "/var/lib/disdex/shared/idle-priority-parity-cert.json"),
        heartbeatFile: "idle-priority-short.json",
        maxStateAgeMs: 20 * 60_000,
    },
];

function json(path) {
    return readFile(path, "utf8").then((raw) => JSON.parse(raw));
}

function near(actual, expected, tolerance) {
    const value = Number(actual);
    return Number.isFinite(value) && Math.abs(value - expected) <= tolerance;
}

function idleParityCertificateReason(raw, expectedSha) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "IDLE_PARITY_CERT_MALFORMED";
    if (raw.schema !== IDLE_PARITY_CERT_SCHEMA) return "IDLE_PARITY_CERT_SCHEMA_MISMATCH";
    if (String(raw.runtimeSha || "").toLowerCase() !== expectedSha) return "IDLE_PARITY_CERT_RUNTIME_SHA_MISMATCH";
    if (raw.newBacktestVerified === false) return "IDLE_PARITY_CERT_NOT_VERIFIED";
    if (raw.candidateStreamSha256 !== "09e97db7a812728f5e54c1179c8e39ac30c6dba4fea241a9d415fa4810f8adbb") return "IDLE_PARITY_CERT_STREAM_SHA_MISMATCH";
    if (raw.genericCandidateSha256 !== "d32ed3a07a6338e8fae792ec6d9071ea27a1dee548eed6a3825dfbda3270019a") return "IDLE_PARITY_CERT_GENERIC_SHA_MISMATCH";
    if (raw.genericCandidateRows !== 393 || raw.genericSourceGapRows !== 2) return "IDLE_PARITY_CERT_GENERIC_COUNTS_MISMATCH";
    if (raw.genericLifecycleModel !== "BASELINE_CONTINUOUS_IDLE__BREAKOUT_RELATIVE_MOMENTUM__12H_PER_SYMBOL") return "IDLE_PARITY_CERT_GENERIC_MODEL_MISMATCH";
    if (raw.filteredSha256 !== "5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48") return "IDLE_PARITY_CERT_FILTERED_SHA_MISMATCH";
    if (raw.candidateRows !== 495 || raw.filteredRows !== 63 || raw.admittedRows !== 61 || raw.wins !== 48 || raw.losses !== 13) return "IDLE_PARITY_CERT_COUNTS_MISMATCH";
    if (raw.roundtripBps !== 10 || raw.replayModelVersion !== IDLE_PARITY_REPLAY_MODEL) return "IDLE_PARITY_CERT_REPLAY_CONTRACT_MISMATCH";
    if (raw.baselineTradeCount !== 1284 || raw.baselineRejectedRows !== 6 || raw.integratedTradeCount !== 1339) return "IDLE_PARITY_CERT_TRADE_COUNTS_MISMATCH";
    if (!near(raw.baselineJpy, 141845207.7243423, 1) || !near(raw.finalJpy, 214775230.26444945, 1)) return "IDLE_PARITY_CERT_EQUITY_MISMATCH";
    if (!near(raw.profitFactor, 2.046425970772986, 1e-9) || !near(raw.maxDrawdownPct, -0.22840597480157931, 1e-9) || !near(raw.idleProfitFactor, 6.582814623608791, 1e-9)) return "IDLE_PARITY_CERT_METRIC_MISMATCH";
    if (!Number.isFinite(Number(raw.generatedAt))) return "IDLE_PARITY_CERT_GENERATED_AT_INVALID";
    return "";
}

async function idleParityReason(runner) {
    if (runner.key !== "IDLE_PRIORITY_SHORT") return "";
    try {
        const certificate = await json(runner.parityCertificatePath);
        return idleParityCertificateReason(certificate, runner.expectedSha);
    } catch {
        return "IDLE_PARITY_CERT_UNAVAILABLE";
    }
}

async function serviceSnapshot(unit) {
    const { stdout } = await execFile(SYSTEMCTL, [
        "show", unit, "-p", "ActiveState", "-p", "MainPID", "-p", "NRestarts", "-p", "Result", "-p", "WorkingDirectory", "-p", "ExecStart", "--no-pager",
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
        nRestarts: Number(values.NRestarts || 0),
        result: String(values.Result || ""),
        cwd,
        command,
        execStart: values.ExecStart || "",
    };
}

async function safetyServiceStatus(label, unit, releaseRoot, scriptToken) {
    try {
        const service = await serviceSnapshot(unit);
        const active = Boolean(service.active);
        const processPresent = Boolean(service.pid > 0);
        const cwdCurrent = Boolean(service.cwd === releaseRoot);
        const commandCurrent = Boolean(service.command.includes(scriptToken) && service.command.includes("--daemon"));
        const execCurrent = Boolean(
            service.execStart.includes(releaseRoot)
            || (cwdCurrent && service.execStart.includes(scriptToken))
        );
        const healthy = active && processPresent && cwdCurrent && commandCurrent && execCurrent;
        const reason = healthy ? "" : `${label} service identity is not current`;
        return {
            safetyState: reason ? "BLOCKED" : "HEALTHY",
            reason,
            unit,
            active,
            processPresent,
            cwdCurrent,
            commandCurrent,
            execCurrent,
        };
    } catch {
        return {
            safetyState: "BLOCKED",
            reason: `${label} service observation failed`,
            unit,
            active: false,
            processPresent: false,
            cwdCurrent: false,
            commandCurrent: false,
            execCurrent: false,
        };
    }
}

async function sharedRiskStatus(now) {
    try {
        const state = await json(SHARED_RISK_STATE_PATH);
        const updatedAt = Number(state?.updatedAt || 0);
        const expectedDay = new Date(now).toISOString().slice(0, 10);
        const identityOk = state?.schema === "disdex-shared-crypto-daily-risk/v1"
            && String(state?.accountScope || "") === "ASTER_FUTURES";
        const timestampOk = Number.isFinite(updatedAt) && updatedAt > 0 && updatedAt <= now + 60_000;
        const fresh = timestampOk && now <= updatedAt + SHARED_RISK_FRESHNESS_GRACE_MS;
        const dayOk = String(state?.utcDay || "") === expectedDay;
        const sourceComplete = state?.sourceComplete === true;
        const tripped = state?.tripped === true;
        let reason = "";
        if (!identityOk) reason = "Shared Risk state identity is invalid";
        else if (!timestampOk) reason = "Shared Risk timestamp is invalid";
        else if (!fresh) reason = "Shared Risk state is stale";
        else if (!dayOk) reason = "Shared Risk UTC day is stale";
        else if (!sourceComplete) reason = "Shared Risk source is incomplete";
        else if (tripped) reason = "Shared Risk daily-loss limit is tripped";
        return {
            safetyState: reason ? "BLOCKED" : "HEALTHY",
            reason,
            updatedAt,
            fresh,
            utcDay: String(state?.utcDay || ""),
            lossPct: Number(state?.lossPct || 0),
            maximumLossPct: Number(state?.maximumLossPct || 0),
            tripped,
            sourceComplete,
        };
    } catch {
        return {
            safetyState: "BLOCKED",
            reason: "Shared Risk state unavailable",
            updatedAt: 0,
            fresh: false,
            utcDay: "",
            lossPct: null,
            maximumLossPct: null,
            tripped: null,
            sourceComplete: false,
        };
    }
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
async function marginGuardStatus(now) {
    try {
        const state = await json(MARGIN_STATE_PATH);
        const stage = String(state?.stage || "");
        const checkedAt = Number(state?.checkedAt || 0);
        const nextCheckAt = Number(state?.nextCheckAt || 0);
        const ordersAllowed = state?.ordersAllowed === true;
        const identityOk = state?.strategyId === "DISDEX_V96_V52_SHARED_MARGIN_GUARD" && String(state?.mode || "").toUpperCase() === "LIVE";
        const timestampOk = Number.isFinite(checkedAt) && checkedAt > 0 && checkedAt <= now + 60_000
            && Number.isFinite(nextCheckAt) && nextCheckAt >= checkedAt;
        const fresh = timestampOk && now <= nextCheckAt + MARGIN_FRESHNESS_GRACE_MS;
        let reason = "";
        if (!identityOk) reason = "Margin Guard state identity is invalid";
        else if (!timestampOk) reason = "Margin Guard timestamps are invalid";
        else if (!fresh) reason = "Margin Guard state is stale";
        else if (stage === "DATA_UNAVAILABLE") reason = "Margin Guard data is unavailable";
        else if (!new Set(["HEALTHY", "WARNING", "REDUCE", "CRITICAL"]).has(stage)) reason = "Margin Guard stage is invalid";
        else if (stage !== "HEALTHY" || !ordersAllowed) reason = `Margin Guard stage ${stage}: ordersAllowed=${ordersAllowed}`;
        return { safetyState: reason ? "BLOCKED" : "HEALTHY", reason, stage, ordersAllowed, checkedAt, nextCheckAt, fresh, consecutiveFailures: Number(state?.consecutiveFailures || 0) };
    } catch {
        return { safetyState: "BLOCKED", reason: "Margin Guard state unavailable", stage: "UNKNOWN", ordersAllowed: false, checkedAt: 0, nextCheckAt: 0, fresh: false, consecutiveFailures: null };
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

function releaseValid(runner) {
    return /^[0-9a-f]{40}$/.test(runner.expectedSha)
        && resolve(runner.releaseRoot) === runner.releaseRoot
        && runner.releaseRoot.endsWith(`/${runner.expectedSha}`);
}

function stateIdentityMatches(runner, state) {
    const strategyId = String(state?.strategyId || "");
    if (runner.key === "V12_V4") {
        return state?.schema === "disdex-v12-v4-runner-heartbeat/v1"
            && strategyId === "V12_V4"
            && String(state?.releaseSha || state?.runtimeSha || "").toLowerCase() === runner.expectedSha
            && ["CERTIFIED", "CANARY"].includes(String(state?.operationMode || "").toUpperCase());
    }
    return strategyId === runner.runnerId
        || (runner.key === "V12_X1_ALL" && strategyId === "V12_X1.00_ALL")
        || (runner.key === "PENGU_V8" && strategyId === "PENGU_DUAL_LS_V2_FINAL")
        || (runner.key === "V52" && strategyId === "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96")
        || (runner.key === "HYPE_TREND_LONG" && state?.schema === "disdex-hype-zec-long/v1" && state?.mode === "LIVE" && String(state?.runtimeCommitSha || "").toLowerCase() === runner.expectedSha)
        || (runner.key === "IDLE_PRIORITY_SHORT" && state?.schema === "disdex-idle-priority-state/v2" && String(state?.runtimeSha || "").toLowerCase() === runner.expectedSha);
}

async function buildHeartbeat(runner, now, globalBlockReason) {
    if (runner.disabled) {
        const reason = runner.disabledReason || `${runner.key} is intentionally disabled`;
        const heartbeat = {
            schema: "disdex-runner-heartbeat/v1",
            runnerId: runner.runnerId,
            serviceUnit: null,
            runtimeSha: runner.expectedSha,
            expectedSha: runner.expectedSha,
            workingDirectory: runner.releaseRoot,
            mode: "DISABLED",
            liveEnabled: false,
            safetyState: "DISABLED",
            orderPermission: "DENIED_DISABLED",
            newOrdersAllowed: false,
            healthReason: reason,
            heartbeatAt: now,
            lastTickAt: now,
            mainPid: 0,
            nRestarts: 0,
            serviceResult: "disabled",
        };
        return {
            heartbeat,
            diagnostics: {
                active: false,
                disabled: true,
                processPresent: false,
                cwdCurrent: false,
                commandCurrent: false,
                execCurrent: false,
                stateFresh: true,
                strategyOk: false,
                orderPermission: "DENIED_DISABLED",
                mainPid: 0,
                nRestarts: 0,
                serviceResult: "disabled",
            },
        };
    }
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
    const v52IntentionallyDisabled = runner.key === "V52"
        && Boolean(service)
        && service.active === false
        && isIntentionallyDisabledV52State(state)
        && String(state?.runtimeCommitSha || "").toLowerCase() === runner.expectedSha;
    if (v52IntentionallyDisabled) {
        const updatedAt = Math.max(
            Number(state?.updatedAt || 0),
            Number(state?.lastReconciledAt || 0),
            Number(state?.initialDaemonReconciliation?.completedAt || 0),
        );
        return {
            heartbeat: {
                schema: "disdex-runner-heartbeat/v1",
                runnerId: runner.runnerId,
                serviceUnit: runner.unit,
                runtimeSha: runner.expectedSha,
                expectedSha: runner.expectedSha,
                workingDirectory: runner.releaseRoot,
                mode: "DISABLED",
                liveEnabled: false,
                safetyState: "DISABLED",
                orderPermission: "DENIED_DISABLED",
                newOrdersAllowed: false,
                healthReason: "V52 intentionally disabled for LIMITED_OVERLAY_LIVE; flat peer state verified",
                heartbeatAt: now,
                lastTickAt: updatedAt > 0 ? updatedAt : now,
                mainPid: 0,
                nRestarts: Number(service.nRestarts || 0),
                serviceResult: String(service.result || "disabled"),
            },
            diagnostics: {
                active: false,
                disabled: true,
                processPresent: false,
                cwdCurrent: false,
                commandCurrent: false,
                execCurrent: true,
                stateFresh: updatedAt > 0 && now - updatedAt <= runner.maxStateAgeMs,
                strategyOk: true,
                orderPermission: "DENIED_DISABLED",
                mainPid: 0,
                nRestarts: Number(service.nRestarts || 0),
                serviceResult: String(service.result || "disabled"),
            },
        };
    }
    const updatedAt = Math.max(
        Number(state?.updatedAt || 0),
        Number(state?.lastReconciledAt || 0),
        Number(state?.initialDaemonReconciliation?.completedAt || 0),
    );
    const stateFresh = updatedAt > 0 && now - updatedAt <= runner.maxStateAgeMs;
    const serviceActive = Boolean(service?.active);
    const processPresent = Boolean(service?.pid > 0);
    const cwdCurrent = Boolean(service?.cwd === runner.releaseRoot);
    const commandCurrent = Boolean(service?.command.includes(runner.script) && service?.command.includes("--daemon"));
    const execCurrent = Boolean(service?.execStart.includes(runner.releaseRoot));
    const identityOk = serviceActive && processPresent && cwdCurrent && commandCurrent && execCurrent;
    const parityReason = await idleParityReason(runner);
    const manualReviewReason = state?.manualReview ? `${runner.key} manual review is active` : "";
    const blockedReason = globalBlockReason || stateError || serviceError || parityReason || !releaseValid(runner)
        ? (globalBlockReason || stateError || serviceError || parityReason || "release pin is invalid")
        : manualReviewReason
            ? manualReviewReason
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
        runtimeSha: runner.expectedSha,
        expectedSha: runner.expectedSha,
        workingDirectory: runner.releaseRoot,
        mode: String(state?.operationMode || "LIVE").toUpperCase() === "CANARY" ? "CANARY" : "LIVE",
        liveEnabled: serviceActive,
        safetyState: blockedReason ? "BLOCKED" : "HEALTHY",
        formalCertification: String(state?.operationMode || "").toUpperCase() === "CERTIFIED",
        limitedLive: String(state?.operationMode || "").toUpperCase() === "CANARY",
        orderPermission: blockedReason ? "DENIED_BLOCKED" : "ALLOWED",
        newOrdersAllowed: !blockedReason,
        heartbeatAt: now,
        lastTickAt: updatedAt > 0 ? updatedAt : now,
        mainPid: Number(service?.pid || 0),
        nRestarts: Number(service?.nRestarts || 0),
        serviceResult: String(service?.result || ""),
    };
    if(runner.key === "FET_BRK48_RESIDUAL") {
        heartbeat.fet={minimumVolumeRatio:1.2,maximumVolumeRatio:10,minimumReturn72h:0.02,maximumReturn72h:0.15,postExitCooldownHours:24,maximumNewEntryGross:1,lastEvaluationReason:state?.lastEvaluationReason||null,cooldownUntilTs:state?.cooldownUntilTs||null,lastExitTs:state?.lastExitTs||null,cooldownActive:now<Number(state?.cooldownUntilTs||0)};
    }
    if(runner.key === "V12_X1_ALL") heartbeat.dd1296={sideLossLedger:state?.sideLossLedger||null,latestDecision:state?.latestDd1296Decision||null};
    if(runner.key === "V12_V4") heartbeat.v12v4={operationMode:String(state?.operationMode||""),status:String(state?.status||""),candidateCount:Number(state?.candidateCount||0)};
    if (runner.key === "QUALITY102_CAUSAL_V1") {
        heartbeat.quality102 = {
            selectorMode: "CAUSAL_V4",
            historicalSelectorParity: false,
            brkLiveEnabled: true,
        };
    }
    if (runner.key === "IDLE_PRIORITY_SHORT") {
        heartbeat.idle = {
            parityCertificatePath: runner.parityCertificatePath,
            parityVerified: !parityReason,
        };
    }
    if (blockedReason) heartbeat.healthReason = blockedReason;
    return {
        heartbeat,
        diagnostics: { active: serviceActive, disabled: false, processPresent, cwdCurrent, commandCurrent, execCurrent, stateFresh, strategyOk: stateIdentityMatches(runner, state), orderPermission: blockedReason ? "DENIED_BLOCKED" : "ALLOWED", mainPid: Number(service?.pid || 0), nRestarts: Number(service?.nRestarts || 0), serviceResult: String(service?.result || "") },
    };
}

function summarizeOverallSafety(globalReasons, results) {
    const reasons = [...globalReasons];
    for (const result of results) {
        if (result.safetyState === "BLOCKED") reasons.push(`${result.runner} is BLOCKED`);
    }
    const blockReasons = [...new Set(reasons.filter(Boolean))];
    const disabledRunners = results.filter((result) => result.safetyState === "DISABLED").map((result) => result.runner);
    const enabledRunnerBlocks = results.filter((result) => result.safetyState === "BLOCKED").map((result) => result.runner);
    return {
        blocked: blockReasons.length > 0,
        globalBlocked: globalReasons.length > 0,
        globalOrdersAllowed: globalReasons.length === 0,
        disabledRunners,
        enabledRunnerBlocks,
        blockReasons,
    };
}

async function main() {
    const now = Date.now();
    const killReason = await sharedKillSwitch();
    const sharedRisk = await sharedRiskStatus(now);
    const sharedRiskService = await safetyServiceStatus("Shared Risk", SHARED_RISK_UNIT, SHARED_RISK_RELEASE_ROOT, "scripts/disdex-shared-crypto-risk-writer.ts");
    const marginGuard = await marginGuardStatus(now);
    const marginGuardService = await safetyServiceStatus("Margin Guard", MARGIN_UNIT, MARGIN_RELEASE_ROOT, "scripts/disdex_v96_v52_margin_guard_runtime.py");
    const asterRateBudget = await sharedAsterRateBudgetStatus(now);
    const globalReasons = [killReason, sharedRisk.reason, sharedRiskService.reason, marginGuard.reason, marginGuardService.reason].filter(Boolean);
    const globalBlockReason = globalReasons.join("; ");
    const results = [];
    for (const runner of RUNNERS) {
        const { heartbeat, diagnostics } = await buildHeartbeat(runner, now, globalBlockReason);
        await atomicJson(`${HEALTH_ROOT}/heartbeats/${runner.heartbeatFile}`, heartbeat);
        results.push({ runner: runner.key, safetyState: heartbeat.safetyState, stateAt: heartbeat.lastTickAt, ...diagnostics });
    }
    const overall = summarizeOverallSafety(globalReasons, results);
    const runnerOrderPermissions = Object.fromEntries(results.map((result) => [
        result.runner,
        overall.globalOrdersAllowed && result.safetyState === "HEALTHY" ? "ALLOWED" : result.safetyState === "DISABLED" ? "DENIED_DISABLED" : "DENIED_BLOCKED",
    ]));
    const overallSafetyState = overall.globalBlocked
        ? "BLOCKED"
        : overall.enabledRunnerBlocks.length > 0
            ? "PARTIAL"
            : asterRateBudget.status !== "HEALTHY"
                ? "DEGRADED"
                : "HEALTHY";
    console.log(JSON.stringify({
        status: "DISDEX_RUNNER_HEALTH_SNAPSHOT_PASS",
        overallSafetyState,
        newOrdersAllowed: overall.globalOrdersAllowed,
        globalOrdersAllowed: overall.globalOrdersAllowed,
        runnerOrderPermissions,
        disabledRunners: overall.disabledRunners,
        enabledRunnerBlocks: overall.enabledRunnerBlocks,
        blockReasons: overall.blockReasons,
        sharedKillSwitchActive: Boolean(killReason),
        sharedRisk,
        sharedRiskService,
        marginGuard,
        marginGuardService,
        asterRateBudget,
        readOnly: true,
        tradingEffects: { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 },
        ordersSent: 0,
        results,
    }));
}

function selfTest() {
    const healthyBudget = classifySharedAsterRateBudget({ schema: "disdex-aster-rate-budget/v1", nextAllowedAt: 11_000 }, 10_000);
    const degradedBudget = classifySharedAsterRateBudget({ schema: "disdex-aster-rate-budget/v1", nextAllowedAt: 25_001 }, 10_000);
    const invalidBudget = classifySharedAsterRateBudget({ schema: "unexpected", nextAllowedAt: 10_000 }, 10_000);
    if (healthyBudget.status !== "HEALTHY" || degradedBudget.status !== "DEGRADED"
        || degradedBudget.backlogMs !== 15_001 || invalidBudget.status !== "UNKNOWN") {
        throw new Error("shared Aster rate-budget health self-test failed");
    }
    const blockedRunner = summarizeOverallSafety([], [{ runner: "V12_X1_ALL", safetyState: "BLOCKED" }]);
    if (!blockedRunner.blocked || blockedRunner.blockReasons.length !== 1) throw new Error("runner block did not block overall safety");
    const blockedDependency = summarizeOverallSafety(["Shared Risk service identity is not current"], [{ runner: "V12_X1_ALL", safetyState: "HEALTHY" }]);
    if (!blockedDependency.blocked) throw new Error("dependency block did not block overall safety");
    const healthy = summarizeOverallSafety([], [{ runner: "V12_X1_ALL", safetyState: "HEALTHY" }]);
    if (healthy.blocked || healthy.blockReasons.length !== 0) throw new Error("healthy snapshot was blocked");
    const disabledPeer = summarizeOverallSafety([], [
        { runner: "V12_V4", safetyState: "DISABLED" },
        { runner: "QUALITY102_CAUSAL_V1", safetyState: "HEALTHY" },
    ]);
    if (disabledPeer.blocked || disabledPeer.globalOrdersAllowed !== true || disabledPeer.disabledRunners[0] !== "V12_V4") throw new Error("disabled V12 blocked healthy peers");
    const blockedPeer = summarizeOverallSafety([], [
        { runner: "V12_V4", safetyState: "DISABLED" },
        { runner: "QUALITY102_CAUSAL_V1", safetyState: "BLOCKED" },
    ]);
    if (!blockedPeer.blocked || blockedPeer.globalOrdersAllowed !== true || blockedPeer.enabledRunnerBlocks[0] !== "QUALITY102_CAUSAL_V1") throw new Error("peer block was not scoped");
    console.log("DISDEX_RUNNER_HEALTH_SNAPSHOT_SELFTEST_PASS");
}

if (process.argv.includes("--self-test")) {
    selfTest();
} else {
    main().catch((error) => {
        console.error(JSON.stringify({
            status: "DISDEX_RUNNER_HEALTH_SNAPSHOT_FAIL_CLOSED",
            reason: String(error?.message || error).slice(0, 240),
            tradingEffects: { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 },
            ordersSent: 0,
        }));
        process.exitCode = 1;
    });
}
