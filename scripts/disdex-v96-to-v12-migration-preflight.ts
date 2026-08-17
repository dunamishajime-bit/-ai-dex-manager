import "dotenv/config";

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { DISDEX_V96_RUNTIME } from "../config/disdexV96Runtime";
import { resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { FileDisDexV96RunnerStateStore } from "../lib/disdex-v96-runner-state";
import { FileV12X1AllRunnerStateStore } from "../lib/v12-x1-all-runner-state";

const V96_CORE_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"]);
const EPS = 1e-12;

function boolEnv(name: string) { return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim()); }
function numberEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isFinite(value) ? value : fallback; }

async function main() {
    const v12 = resolveV12X1AllRuntime();
    if (v12.mode !== "LIVE" || !v12.enabled || !v12.liveTradingEnabled || !v12.liveExecutionEnabled || !boolEnv("DISDEX_V12_LIVE_ALLOW_REAL_ORDERS")) {
        throw new Error("V12_LIVE_GATES_NOT_ALL_ENABLED");
    }

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V96-to-V12-Migration-Preflight/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("MIGRATION_PREFLIGHT_REQUIRES_ASTER_CREDENTIALS");

    const v96StateDir = resolve(process.env.DISDEX_V96_STATE_DIR || DISDEX_V96_RUNTIME.stateDirectory);
    const v96State = await new FileDisDexV96RunnerStateStore(resolve(v96StateDir, "runner-live.json"), "live").load();
    const v12State = await new FileV12X1AllRunnerStateStore(v12.statePath, "LIVE").load();
    const risk = await readSharedCryptoDailyRisk(v12.riskPath);
    if (!risk.ok) throw new Error(`SHARED_CRYPTO_RISK_NOT_READY:${risk.reason}`);

    if (v96State.pending) throw new Error(`MIGRATION_BLOCKED_V96_PENDING:${v96State.pending.clientOrderId}`);
    if (v96State.manualReviewReason) throw new Error(`MIGRATION_BLOCKED_V96_MANUAL_REVIEW:${v96State.manualReviewReason}`);
    if (v96State.killSwitch?.active) throw new Error(`MIGRATION_BLOCKED_V96_KILL_SWITCH:${v96State.killSwitch.reason}`);
    if (v12State.pending) throw new Error(`MIGRATION_BLOCKED_V12_PENDING:${v12State.pending.clientOrderId}`);
    if (v12State.active) throw new Error(`MIGRATION_BLOCKED_V12_ACTIVE:${v12State.active.symbol}`);
    if (v12State.killSwitch?.active || v12State.manualReview) throw new Error(`MIGRATION_BLOCKED_V12_MANUAL_REVIEW:${v12State.killSwitch?.reason || v12State.manualReview}`);

    const [_ping, positions, openOrders] = await Promise.all([client.ping(), client.getPositions(), client.getOpenOrders()]);
    void _ping;
    const v96Positions = positions.filter((row) => V96_CORE_SYMBOLS.has(String(row.symbol).toUpperCase()) && Math.abs(Number(row.positionAmt) || 0) > EPS);
    if (v96Positions.length) throw new Error(`MIGRATION_BLOCKED_V96_NOT_FLAT:${v96Positions.map((row) => `${row.symbol}:${row.positionAmt}`).join(",")}`);

    const v96OpenOrders = openOrders.filter((row) => V96_CORE_SYMBOLS.has(String(row.symbol).toUpperCase()));
    if (v96OpenOrders.length) throw new Error(`MIGRATION_BLOCKED_V96_OPEN_ORDERS:${v96OpenOrders.map((row) => `${row.symbol}:${row.clientOrderId || row.orderId || "unknown"}`).join(",")}`);
    const v96ResidentProtection = v96OpenOrders.filter((row) => ["STOP_MARKET", "TAKE_PROFIT_MARKET"].includes(String(row.type || "").toUpperCase()) || row.reduceOnly === true || row.closePosition === true);
    if (v96ResidentProtection.length) throw new Error(`MIGRATION_BLOCKED_V96_RESIDENT_PROTECTION:${v96ResidentProtection.length}`);

    const lock = new FileAccountOrderLock(v12.lockPath || ".runtime-state/shared/account-order.lock", numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000));
    const handle = await lock.acquire(`V96_TO_V12_PREFLIGHT:${process.pid}:${randomUUID()}`);
    if (!handle) throw new Error("MIGRATION_BLOCKED_SHARED_ACCOUNT_LOCK");
    await handle.release();

    console.log(JSON.stringify({
        status: "V96_TO_V12_MIGRATION_PREFLIGHT_PASS",
        v96ManagedPositions: 0,
        v96OpenOrders: 0,
        v96ResidentProtection: 0,
        v96Pending: 0,
        v12Pending: 0,
        v12ActivePosition: 0,
        sharedRiskFresh: true,
        sharedRiskLossPct: risk.state?.lossPct,
        sharedAccountLockAvailable: true,
        ordersSent: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({ status: "V96_TO_V12_MIGRATION_PREFLIGHT_FAILED", message: error instanceof Error ? error.message : String(error), ordersSent: false }));
    process.exitCode = 1;
});
