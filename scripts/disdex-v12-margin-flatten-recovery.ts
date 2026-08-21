import "dotenv/config";

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { AsterV3Client } from "../lib/aster-v3-client";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";
import { FileV12X1AllRunnerStateStore } from "../lib/v12-x1-all-runner-state";

const MARGIN_GUARD_FLATTEN_REASON_PREFIX = "V52 margin-aware fatal tick error:";
const V12_POSITION_MISMATCH = "V12_POSITION_COUNT_MISMATCH";
const OPERATOR = "V12_MARGIN_FLATTEN_RECOVERY_V1";

function boolEnv(name: string) { return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim()); }
function numberEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isFinite(value) ? value : fallback; }
function parseLastJson(output: string) {
    for (const line of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).reverse()) {
        try { return JSON.parse(line) as Record<string, unknown>; } catch { /* continue */ }
    }
    throw new Error("V12_MARGIN_FLATTEN_RECOVERY_MARGIN_JSON_MISSING");
}

async function archiveAndResetState(statePath: string, requestId: string) {
    const bytes = await readFile(statePath);
    const archiveDir = resolve(dirname(statePath), "recovery-archive");
    await mkdir(archiveDir, { recursive: true, mode: 0o700 });
    const archivePath = resolve(archiveDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${requestId}.json`);
    await writeFile(archivePath, bytes, { flag: "wx", mode: 0o600 });
    const temporary = `${statePath}.recovery.${process.pid}.${randomUUID()}.tmp`;
    const fresh = { schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode: "LIVE", updatedAt: Date.now() };
    try {
        await writeFile(temporary, `${JSON.stringify(fresh, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, statePath);
    } catch (error) {
        await writeFile(statePath, bytes, { encoding: "utf8", mode: 0o600 }).catch(() => undefined);
        throw error;
    }
    return archivePath;
}

async function clearSharedKillSwitch(path: string, requestId: string) {
    const bytes = await readFile(path);
    const archivePath = `${path}.before-${requestId}.json`;
    await copyFile(path, archivePath);
    const temporary = `${path}.recovery.${process.pid}.${randomUUID()}.tmp`;
    const fresh = {
        active: false,
        action: "FLATTEN_MANAGED",
        reason: "Operator cleared V52 communication-failure flatten switch after authenticated flat-account and healthy-margin recovery checks.",
        operator: OPERATOR,
        recoveredAt: new Date().toISOString(),
        previousStateBytes: bytes.length,
    };
    try {
        await writeFile(temporary, `${JSON.stringify(fresh, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, path);
    } catch (error) {
        await writeFile(path, bytes, { encoding: "utf8", mode: 0o600 }).catch(() => undefined);
        throw error;
    }
    return archivePath;
}

async function main() {
    const sha = String(process.argv[2] || "").trim();
    const requestId = String(process.argv[3] || "").trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("V12_MARGIN_FLATTEN_RECOVERY_EXACT_SHA_REQUIRED");
    if (!/^v12-margin-flatten-[A-Za-z0-9_-]{8,96}$/.test(requestId)) throw new Error("V12_MARGIN_FLATTEN_RECOVERY_REQUEST_ID_INVALID");

    const runtime = resolveV12X1AllRuntime();
    if (runtime.mode !== "LIVE" || !runtime.enabled || !runtime.liveTradingEnabled || !runtime.liveExecutionEnabled || !boolEnv("DISDEX_V12_LIVE_ALLOW_REAL_ORDERS")) {
        throw new Error("V12_MARGIN_FLATTEN_RECOVERY_LIVE_GATES_NOT_ALL_ENABLED");
    }
    const kill = await readSharedKillSwitch();
    const statePath = resolve(runtime.statePath);
    const stateStore = new FileV12X1AllRunnerStateStore(statePath, "LIVE");
    const state = await stateStore.load();
    if (!kill.active && !state.killSwitch?.active && !state.manualReview) {
        console.log(JSON.stringify({ status: "V12_MARGIN_FLATTEN_RECOVERY_NOT_REQUIRED", sha, requestId, ordersSent: false, positionChangesSent: false }));
        return;
    }
    if (!kill.active) throw new Error(`V12_MARGIN_FLATTEN_RECOVERY_SHARED_KILL_SWITCH_NOT_ACTIVE:${kill.reason || "UNSPECIFIED"}`);
    if (!kill.reason?.startsWith(MARGIN_GUARD_FLATTEN_REASON_PREFIX)) throw new Error(`V12_MARGIN_FLATTEN_RECOVERY_REASON_NOT_ALLOWLISTED:${kill.reason || "UNSPECIFIED"}`);
    if (!state.active || state.pending || state.manualReview !== V12_POSITION_MISMATCH || state.killSwitch?.active !== true) {
        throw new Error(`V12_MARGIN_FLATTEN_RECOVERY_LOCAL_STATE_NOT_EXPECTED:${state.killSwitch?.reason || state.manualReview || "CLEAN"}`);
    }

    const risk = await readSharedCryptoDailyRisk(runtime.riskPath);
    if (!risk.ok) throw new Error(`V12_MARGIN_FLATTEN_RECOVERY_SHARED_RISK_NOT_READY:${risk.reason}`);
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V12-Margin-Flatten-Recovery/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("V12_MARGIN_FLATTEN_RECOVERY_ASTER_CREDENTIALS_MISSING");

    const lock = new FileAccountOrderLock(runtime.lockPath || ".runtime-state/shared/account-order.lock", numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000));
    const handle = await lock.acquire(`V12_X1.00_ALL:P1:RECOVERY:${requestId}`);
    if (!handle) throw new Error("V12_MARGIN_FLATTEN_RECOVERY_SHARED_LOCK_UNAVAILABLE");
    try {
        const [_ping, positions, openOrders] = await Promise.all([client.ping(), client.getPositions(), client.getOpenOrders()]);
        void _ping;
        const nonzero = positions.filter((row) => Math.abs(Number(row.positionAmt) || 0) > 1e-12);
        if (nonzero.length) throw new Error(`V12_MARGIN_FLATTEN_RECOVERY_ACCOUNT_NOT_FLAT:${nonzero.map((row) => row.symbol).join(",")}`);
        if (openOrders.length) throw new Error(`V12_MARGIN_FLATTEN_RECOVERY_OPEN_ORDERS_PRESENT:${openOrders.map((row) => row.symbol).join(",")}`);

        const marginPythonPath = process.env.DISDEX_MARGIN_GUARD_PYTHONPATH || "/home/deploy/dis-dex-manager/.venv-stock/lib/python3.12/site-packages";
        const margin = spawnSync("/usr/bin/python3", ["scripts/disdex_v12_v52_margin_guard_runtime.py", "--mode", "live", "--preflight-readonly"], {
            cwd: process.cwd(), env: { ...process.env, PYTHONPATH: `${resolve(process.cwd(), "scripts")}:${marginPythonPath}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""}` }, encoding: "utf8", timeout: 30_000,
        });
        if (margin.status !== 0) throw new Error(`V12_MARGIN_FLATTEN_RECOVERY_MARGIN_PREFLIGHT_FAILED:${String(margin.stderr || margin.stdout || "").slice(-700)}`);
        const marginState = parseLastJson(String(margin.stdout || ""));
        if (marginState.stage !== "HEALTHY" || marginState.ordersAllowed !== true) throw new Error(`V12_MARGIN_FLATTEN_RECOVERY_MARGIN_NOT_HEALTHY:${String(marginState.stage || "UNKNOWN")}`);

        const stateArchivePath = await archiveAndResetState(statePath, requestId);
        const afterState = await stateStore.load();
        if (afterState.active || afterState.pending || afterState.manualReview || afterState.killSwitch?.active) throw new Error("V12_MARGIN_FLATTEN_RECOVERY_STATE_RESET_VERIFY_FAILED");
        if (!kill.sourcePath) throw new Error("V12_MARGIN_FLATTEN_RECOVERY_KILL_SWITCH_PATH_MISSING");
        const killArchivePath = await clearSharedKillSwitch(kill.sourcePath, requestId);
        const afterKill = await readSharedKillSwitch();
        if (afterKill.active) throw new Error("V12_MARGIN_FLATTEN_RECOVERY_KILL_SWITCH_CLEAR_VERIFY_FAILED");
        console.log(JSON.stringify({
            status: "V12_MARGIN_FLATTEN_RECOVERY_PASS",
            sha,
            requestId,
            reason: kill.reason,
            stateArchivePath,
            killArchivePath,
            accountFlat: true,
            openOrderCount: 0,
            marginStage: marginState.stage,
            ordersSent: false,
            positionChangesSent: false,
        }));
    } finally {
        await handle.release();
    }
}

main().catch((error) => {
    console.error(JSON.stringify({ status: "V12_MARGIN_FLATTEN_RECOVERY_FAILED", message: error instanceof Error ? error.message : String(error), ordersSent: false, positionChangesSent: false }));
    process.exitCode = 1;
});
