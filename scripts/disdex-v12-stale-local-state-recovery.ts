import "dotenv/config";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { V12_X1_ALL, resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";
import { AsterV3Client } from "../lib/aster-v3-client";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { classifyAsterSymbol } from "../lib/disdex-aster-portfolio-classifier";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { FileV12X1AllRunnerStateStore, type V12X1AllRunnerState } from "../lib/v12-x1-all-runner-state";

/**
 * This is a narrow, one-time recovery for the old odd-hour H1->H2 bug.
 * It never clears the shared Kill Switch and never mutates exchange state.
 * Any state/reconciliation mismatch remains fail-closed.
 */
const ALLOWLISTED_REASON = "V12 hourly history insufficient for BTC: 0";
const RECOVERY_REQUEST_PREFIX = "v12-h2-recovery-";
const EPS = 1e-12;
const V12_SYMBOLS = new Set(V12_X1_ALL.universe.map((base) => `${base}USDT`));

function boolEnv(name: string) {
    return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function assertRequestId(requestId: string) {
    if (!new RegExp(`^${RECOVERY_REQUEST_PREFIX}[A-Za-z0-9_-]{8,96}$`).test(requestId)) {
        throw new Error("V12_LOCAL_RECOVERY_REQUEST_ID_INVALID");
    }
}

function isLegacyOddHourState(state: V12X1AllRunnerState) {
    return state.mode === "LIVE"
        && state.manualReview === ALLOWLISTED_REASON
        && state.killSwitch?.active === true
        && state.killSwitch.reason === ALLOWLISTED_REASON
        && !state.active
        && !state.pending;
}

function nonzeroPositions(rows: Awaited<ReturnType<AsterV3Client["getPositions"]>>) {
    return rows.filter((row) => Math.abs(Number(row.positionAmt) || 0) > EPS);
}

async function assertRegularFile(path: string) {
    try {
        const info = await lstat(path);
        if (info.isSymbolicLink() || !info.isFile()) throw new Error(`V12_LOCAL_RECOVERY_STATE_PATH_INVALID:${path}`);
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code)
            : "";
        if (code === "ENOENT") return;
        throw error;
    }
}

async function archiveAndReset(statePath: string, stateBytes: Buffer, requestId: string, state: V12X1AllRunnerState) {
    const stateDir = dirname(statePath);
    const archiveDir = resolve(stateDir, "recovery-archive");
    await mkdir(archiveDir, { recursive: true, mode: 0o700 });
    const archivePath = resolve(archiveDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${requestId}.json`);
    await writeFile(archivePath, stateBytes, { flag: "wx", mode: 0o600 });

    const fresh: V12X1AllRunnerState = {
        schema: "v12-x1-all-runner-state/v1",
        strategyId: "V12_X1.00_ALL",
        mode: "LIVE",
        updatedAt: Date.now(),
    };
    const temporary = `${statePath}.recovery.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(fresh, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, statePath);
    } catch (error) {
        await writeFile(statePath, stateBytes, { encoding: "utf8", mode: 0o600 }).catch(() => undefined);
        throw error;
    }
    return { archivePath, previousUpdatedAt: state.updatedAt };
}

async function main() {
    if (process.argv.includes("--self-test")) {
        assert.equal(ALLOWLISTED_REASON, "V12 hourly history insufficient for BTC: 0");
        assert.equal(isLegacyOddHourState({
            schema: "v12-x1-all-runner-state/v1",
            strategyId: "V12_X1.00_ALL",
            mode: "LIVE",
            updatedAt: 1,
            manualReview: ALLOWLISTED_REASON,
            killSwitch: { active: true, reason: ALLOWLISTED_REASON, trippedAt: 1 },
        }), true);
        assertRequestId("v12-h2-recovery-20260820T000000Z-1234");
        console.log("V12 stale local state recovery self-test: PASS");
        return;
    }

    const candidateSha = String(process.argv[2] || "").trim();
    const requestId = String(process.argv[3] || "").trim();
    if (!/^[0-9a-f]{40}$/.test(candidateSha)) throw new Error("V12_LOCAL_RECOVERY_EXACT_SHA_REQUIRED");
    assertRequestId(requestId);

    const runtime = resolveV12X1AllRuntime();
    if (runtime.mode !== "LIVE" || !runtime.enabled || !runtime.liveTradingEnabled || !runtime.liveExecutionEnabled || !boolEnv("DISDEX_V12_LIVE_ALLOW_REAL_ORDERS")) {
        throw new Error("V12_LOCAL_RECOVERY_LIVE_GATES_NOT_ALL_ENABLED");
    }
    const statePath = resolve(runtime.statePath);
    await assertRegularFile(statePath);
    const stateStore = new FileV12X1AllRunnerStateStore(statePath, "LIVE");
    const state = await stateStore.load();
    if (!state.killSwitch?.active && !state.manualReview) {
        console.log(JSON.stringify({ status: "V12_LOCAL_STATE_ALREADY_CLEAN", candidateSha, requestId, ordersSent: false, positionChangesSent: false }));
        return;
    }
    if (!isLegacyOddHourState(state)) {
        throw new Error(`V12_LOCAL_RECOVERY_REASON_NOT_ALLOWLISTED:${state.killSwitch?.reason || state.manualReview || "UNSPECIFIED"}`);
    }

    const sharedKill = await readSharedKillSwitch();
    if (sharedKill.active) throw new Error(`V12_LOCAL_RECOVERY_SHARED_KILL_SWITCH_ACTIVE:${sharedKill.reason || "UNSPECIFIED"}`);
    const risk = await readSharedCryptoDailyRisk(runtime.riskPath);
    if (!risk.ok) throw new Error(`V12_LOCAL_RECOVERY_SHARED_CRYPTO_RISK_NOT_READY:${risk.reason}`);

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V12-Local-State-Recovery/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("V12_LOCAL_RECOVERY_ASTER_CREDENTIALS_MISSING");

    const lock = new FileAccountOrderLock(
        runtime.lockPath || ".runtime-state/shared/account-order.lock",
        numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000),
    );
    const handle = await lock.acquire(`V12_X1.00_ALL:P1:RECOVERY:${requestId}`);
    if (!handle) throw new Error("V12_LOCAL_RECOVERY_SHARED_ACCOUNT_LOCK_NOT_AVAILABLE");
    try {
        const [_ping, positions, openOrders] = await Promise.all([
            client.ping(),
            client.getPositions(),
            client.getOpenOrders(),
        ]);
        void _ping;

        const nonzero = nonzeroPositions(positions);
        const unknownPositions = nonzero.filter((row) => !classifyAsterSymbol(row.symbol).tradable);
        if (unknownPositions.length) throw new Error(`V12_LOCAL_RECOVERY_UNKNOWN_NONZERO_POSITION:${unknownPositions.map((row) => row.symbol).join(",")}`);
        const v12Positions = nonzero.filter((row) => V12_SYMBOLS.has(String(row.symbol).toUpperCase()));
        if (v12Positions.length) throw new Error(`V12_LOCAL_RECOVERY_V12_POSITION_PRESENT:${v12Positions.map((row) => row.symbol).join(",")}`);

        const unknownOrders = openOrders.filter((row) => !classifyAsterSymbol(row.symbol).tradable);
        if (unknownOrders.length) throw new Error(`V12_LOCAL_RECOVERY_UNKNOWN_OPEN_ORDER:${unknownOrders.map((row) => row.symbol).join(",")}`);
        const v12Orders = openOrders.filter((row) => V12_SYMBOLS.has(String(row.symbol).toUpperCase()));
        if (v12Orders.length) throw new Error(`V12_LOCAL_RECOVERY_V12_OPEN_ORDER:${v12Orders.map((row) => row.symbol).join(",")}`);

        const currentBytes = await readFile(statePath);
        const currentState = await stateStore.load();
        if (!isLegacyOddHourState(currentState)) throw new Error("V12_LOCAL_RECOVERY_STATE_CHANGED_DURING_RECONCILIATION");
        const archived = await archiveAndReset(statePath, currentBytes, requestId, currentState);
        const after = await stateStore.load();
        if (after.killSwitch?.active || after.manualReview || after.active || after.pending) {
            throw new Error("V12_LOCAL_RECOVERY_RESET_VERIFICATION_FAILED");
        }
        console.log(JSON.stringify({
            status: "V12_LOCAL_STATE_RECOVERY_PASS",
            candidateSha,
            requestId,
            reasonMatched: true,
            archivePath: archived.archivePath,
            previousUpdatedAt: archived.previousUpdatedAt,
            nonzeroKnownNonV12PositionCount: nonzero.length,
            openOrderCount: openOrders.length,
            sharedKillSwitchChanged: false,
            ordersSent: false,
            positionChangesSent: false,
        }));
    } finally {
        await handle.release();
    }
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "V12_LOCAL_STATE_RECOVERY_FAILED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: false,
        positionChangesSent: false,
    }));
    process.exitCode = 1;
});
