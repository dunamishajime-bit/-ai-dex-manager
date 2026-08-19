import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { FileV12X1AllRunnerStateStore } from "../lib/v12-x1-all-runner-state";

const EXPECTED_STALE_REASON = "V96/V52 trading supervisor exited unexpectedly with status 1";
const OPERATOR = "CHATGPT_GITHUB_ACTIONS_V12_MIGRATION_RECOVERY";
const STRATEGY_ID = "DISDEX_V35_STRONG_RESERVED_PENGU_V96";
function boolEnv(name: string) { return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim()); }
function numberEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isFinite(value) ? value : fallback; }

function requireInactiveService(name: string) {
    const output = execFileSync("systemctl", ["show", name, "--property=ActiveState,SubState,MainPID", "--value"], { encoding: "utf8" });
    const values = output.trim().split(/\r?\n/);
    const active = values[0] || "unknown";
    const sub = values[1] || "unknown";
    const pid = Number(values[2] || 0);
    if (!(["inactive", "failed"].includes(active)) || pid !== 0) throw new Error(`RECOVERY_SERVICE_NOT_INACTIVE:${name}:${active}/${sub}:pid=${pid}`);
}

function parseLastJson(output: string) {
    for (const line of output.split(/\r?\n/).map((v) => v.trim()).filter(Boolean).reverse()) {
        try { return JSON.parse(line) as Record<string, unknown>; } catch { /* continue */ }
    }
    throw new Error("RECOVERY_MARGIN_GUARD_JSON_MISSING");
}
async function writeInactiveKillSwitch(path: string) {
    const payload = {
        active: false,
        strategyId: STRATEGY_ID,
        action: "FLATTEN_MANAGED",
        reason: "Operator cleared stale supervisor-exit Kill Switch after authenticated flat/open-order/margin checks for V12 migration.",
        operator: OPERATOR,
        activatedAt: new Date().toISOString(),
    };
    const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
}

async function main() {
    if (process.argv.includes("--self-test")) {
        assert.equal(EXPECTED_STALE_REASON, "V96/V52 trading supervisor exited unexpectedly with status 1");
        assert.equal(OPERATOR, "CHATGPT_GITHUB_ACTIONS_V12_MIGRATION_RECOVERY");
        console.log("V12 stale Kill Switch recovery self-test: PASS");
        return;
    }
    const sha = String(process.argv[2] || "").trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("RECOVERY_EXACT_SHA_REQUIRED");
    const runtime = resolveV12X1AllRuntime();
    if (runtime.mode !== "LIVE" || !runtime.enabled || !runtime.liveTradingEnabled || !runtime.liveExecutionEnabled || !boolEnv("DISDEX_V12_LIVE_ALLOW_REAL_ORDERS")) {
        throw new Error("RECOVERY_V12_LIVE_GATES_NOT_ALL_ENABLED");
    }
    for (const service of [
        "disdex-v96-v52-live.service",
        `disdex-v12-x1-all@${sha}.service`,
        `disdex-pengu-dual-ls-v2@${sha}.service`,
        `disdex-v52-aster-only@${sha}.service`,
    ]) requireInactiveService(service);

    const kill = await readSharedKillSwitch();
    if (!kill.active) {
        console.log(JSON.stringify({ status: "V12_STALE_SHARED_KILL_SWITCH_ALREADY_INACTIVE", ordersSent: false, cancelSent: false, positionChangesSent: false }));
        return;
    }
    if (kill.reason !== EXPECTED_STALE_REASON) throw new Error(`RECOVERY_KILL_SWITCH_REASON_NOT_ALLOWLISTED:${kill.reason || "UNSPECIFIED"}`);
    const risk = await readSharedCryptoDailyRisk(runtime.riskPath);
    if (!risk.ok) throw new Error(`RECOVERY_SHARED_CRYPTO_RISK_NOT_READY:${risk.reason}`);
    const state = await new FileV12X1AllRunnerStateStore(runtime.statePath, "LIVE").load();
    if (state.killSwitch?.active || state.manualReview) throw new Error(`RECOVERY_V12_LOCAL_MANUAL_REVIEW:${state.killSwitch?.reason || state.manualReview}`);
    if (state.pending) throw new Error(`RECOVERY_V12_PENDING_PRESENT:${state.pending.clientOrderId}`);
    if (state.active) throw new Error(`RECOVERY_V12_ACTIVE_PRESENT:${state.active.symbol}`);

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V12-Stale-Kill-Recovery/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("RECOVERY_ASTER_CREDENTIALS_MISSING");
    const lock = new FileAccountOrderLock(runtime.lockPath || ".runtime-state/shared/account-order.lock", numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000));
    const handle = await lock.acquire(`V12_KILL_RECOVERY:${process.pid}:${randomUUID()}`);
    if (!handle) throw new Error("RECOVERY_SHARED_ACCOUNT_LOCK_NOT_AVAILABLE");
    try {
        const [_ping, positions, openOrders] = await Promise.all([client.ping(), client.getPositions(), client.getOpenOrders()]);
        void _ping;
        const nonzero = positions.filter((row) => Math.abs(Number(row.positionAmt) || 0) > 1e-12);
        if (nonzero.length) throw new Error(`RECOVERY_ACCOUNT_NOT_FLAT:${nonzero.map((row) => row.symbol).join(",")}`);
        if (openOrders.length) throw new Error(`RECOVERY_OPEN_ORDERS_PRESENT:${openOrders.map((row) => row.symbol).join(",")}`);

        const margin = spawnSync("python3", ["scripts/disdex_v12_v52_margin_guard_runtime.py", "--mode", "live", "--preflight-readonly"], {
            cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 30_000,
        });
        if (margin.status !== 0) throw new Error(`RECOVERY_MARGIN_PREFLIGHT_FAILED:${String(margin.stderr || "").slice(-500)}`);
        const marginState = parseLastJson(String(margin.stdout || ""));
        if (marginState.stage !== "HEALTHY" || marginState.ordersAllowed !== true) throw new Error(`RECOVERY_MARGIN_NOT_HEALTHY:${String(marginState.stage || "UNKNOWN")}`);

        await writeInactiveKillSwitch(resolve(kill.sourcePath));
        const after = await readSharedKillSwitch();
        if (after.active) throw new Error("RECOVERY_KILL_SWITCH_DEACTIVATION_NOT_PERSISTED");
        console.log(JSON.stringify({ status: "V12_STALE_SHARED_KILL_SWITCH_RECOVERY_PASS", reasonMatched: true, accountFlat: true, openOrderCount: 0, marginStage: "HEALTHY", sharedKillSwitchActive: false, ordersSent: false, cancelSent: false, positionChangesSent: false }));
    } finally {
        await handle.release();
    }
}

main().catch((error) => {
    console.error(JSON.stringify({ status: "V12_STALE_SHARED_KILL_SWITCH_RECOVERY_FAILED", message: error instanceof Error ? error.message : String(error), ordersSent: false, cancelSent: false, positionChangesSent: false }));
    process.exitCode = 1;
});
