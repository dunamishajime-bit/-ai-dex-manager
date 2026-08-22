import "dotenv/config";

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { DISDEX_V96_RUNTIME } from "../config/disdexV96Runtime";
import { resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { classifyAsterSymbol } from "../lib/disdex-aster-portfolio-classifier";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { FileDisDexV96RunnerStateStore } from "../lib/disdex-v96-runner-state";
import { FileV12X1AllRunnerStateStore, type V12ActivePositionState } from "../lib/v12-x1-all-runner-state";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import { reconcileV12Protection } from "../lib/v12-resident-stop-lifecycle";

const V96_CORE_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"]);
const EPS = 1e-12;

function boolEnv(name: string) { return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim()); }
function numberEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isFinite(value) ? value : fallback; }
function actualSide(position: { quantity: number; positionSide: string }) {
    if (position.positionSide === "LONG") return "LONG" as const;
    if (position.positionSide === "SHORT") return "SHORT" as const;
    return position.quantity < 0 ? "SHORT" as const : "LONG" as const;
}

function activePositionsOf(state: { activePositions?: V12ActivePositionState[]; active?: V12ActivePositionState }) {
    if (Array.isArray(state.activePositions) && state.activePositions.length) return [...state.activePositions];
    return state.active ? [state.active] : [];
}

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
        userAgent: "DisDex-V96-to-V12-Migration-Preflight/1.1",
    });
    if (!client.hasTradingCredentials()) throw new Error("MIGRATION_PREFLIGHT_REQUIRES_ASTER_CREDENTIALS");

    const v96StateDir = resolve(process.env.DISDEX_V96_STATE_DIR || DISDEX_V96_RUNTIME.stateDirectory);
    const [v96State, v12State, risk, sharedKillSwitch] = await Promise.all([
        new FileDisDexV96RunnerStateStore(resolve(v96StateDir, "runner-live.json"), "live").load(),
        new FileV12X1AllRunnerStateStore(v12.statePath, "LIVE").load(),
        readSharedCryptoDailyRisk(v12.riskPath),
        readSharedKillSwitch(),
    ]);
    if (!risk.ok) throw new Error(`SHARED_CRYPTO_RISK_NOT_READY:${risk.reason}`);
    if (sharedKillSwitch.active) throw new Error(`MIGRATION_BLOCKED_SHARED_KILL_SWITCH:${sharedKillSwitch.reason || "UNSPECIFIED"}`);

    if (v96State.bootstrapRequired) throw new Error("MIGRATION_BLOCKED_V96_STATE_BOOTSTRAP_REQUIRED");
    if (v96State.pending) throw new Error(`MIGRATION_BLOCKED_V96_PENDING:${v96State.pending.clientOrderId}`);
    if (v96State.manualReviewReason) throw new Error(`MIGRATION_BLOCKED_V96_MANUAL_REVIEW:${v96State.manualReviewReason}`);
    if (v96State.killSwitch?.active) throw new Error(`MIGRATION_BLOCKED_V96_KILL_SWITCH:${v96State.killSwitch.reason}`);
    if (v12State.pending) throw new Error(`MIGRATION_BLOCKED_V12_PENDING:${v12State.pending.clientOrderId}`);
    if (v12State.killSwitch?.active || v12State.manualReview) throw new Error(`MIGRATION_BLOCKED_V12_MANUAL_REVIEW:${v12State.killSwitch?.reason || v12State.manualReview}`);

    const [_ping, positions, openOrders] = await Promise.all([client.ping(), client.getPositions(), client.getOpenOrders()]);
    void _ping;
    const nonzero = positions.filter((row) => Math.abs(Number(row.positionAmt) || 0) > EPS);
    const unknownPositions = nonzero.filter((row) => !classifyAsterSymbol(row.symbol).tradable);
    if (unknownPositions.length) throw new Error(`MIGRATION_BLOCKED_UNKNOWN_NONZERO_POSITION:${unknownPositions.map((row) => row.symbol).join(",")}`);
    const unknownOrders = openOrders.filter((row) => !classifyAsterSymbol(row.symbol).tradable);
    if (unknownOrders.length) throw new Error(`MIGRATION_BLOCKED_UNKNOWN_OPEN_ORDER:${unknownOrders.map((row) => row.symbol).join(",")}`);

    // A partially completed activation may already have reconciled a V12
    // position on a symbol that was also part of the legacy V96 universe
    // (currently SOLUSDT).  That position is not a V96 residual and must not
    // make the migration fail closed as "V96 not flat".  It is exempted only
    // when the V12 state below is active and will pass the exact
    // state/side/quantity/protection reconciliation; any other V96-core
    // position remains a hard blocker.
    const v12Actives = activePositionsOf(v12State);
    const reconciledV12Symbols = new Set(v12Actives.map((active) => String(active.symbol).toUpperCase()));
    const v96Positions = nonzero.filter((row) => {
        const symbol = String(row.symbol).toUpperCase();
        return V96_CORE_SYMBOLS.has(symbol) && !reconciledV12Symbols.has(symbol);
    });
    if (v96Positions.length) throw new Error(`MIGRATION_BLOCKED_V96_NOT_FLAT:${v96Positions.map((row) => `${row.symbol}:${row.positionAmt}`).join(",")}`);

    const v12ProtectionIds = new Set(v12Actives.flatMap((active) => [active.protection.stopClientOrderId, active.protection.takeProfitClientOrderId].filter(Boolean)));
    const v96OpenOrders = openOrders.filter((row) => {
        const symbol = String(row.symbol).toUpperCase();
        const clientOrderId = String(row.clientOrderId || "");
        return V96_CORE_SYMBOLS.has(symbol) && !v12ProtectionIds.has(clientOrderId);
    });
    if (v96OpenOrders.length) throw new Error(`MIGRATION_BLOCKED_V96_OPEN_ORDERS:${v96OpenOrders.map((row) => `${row.symbol}:${row.clientOrderId || row.orderId || "unknown"}`).join(",")}`);
    const v96ResidentProtection = v96OpenOrders.filter((row) => ["STOP_MARKET", "TAKE_PROFIT_MARKET"].includes(String(row.type || "").toUpperCase()) || row.reduceOnly === true || row.closePosition === true);
    if (v96ResidentProtection.length) throw new Error(`MIGRATION_BLOCKED_V96_RESIDENT_PROTECTION:${v96ResidentProtection.length}`);

    // A partially completed V12 activation may already own a live position.
    // Preserve it only after a read-only, exact state/position/protection
    // reconciliation.  This never places, cancels, or changes an order.
    const adapter = new V12AsterLiveAdapter(client, {
        maxSlippageBps: numberEnv("V12_X1_ALL_MAX_SLIPPAGE_BPS", 20),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const actualPositions = await adapter.getPositions();
    const activeV12Orders = (await adapter.listV12Orders()).filter((row) => ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(String(row.status || "").toUpperCase()));
    let v12ActiveStateReconciled = false;
    if (v12Actives.length) {
        const actualV12 = actualPositions.filter((row) => Math.abs(row.quantity) > EPS && V12_X1_ALL.universe.some((base) => `${base}USDT` === row.symbol.toUpperCase()));
        if (actualV12.length !== v12Actives.length) throw new Error(`MIGRATION_BLOCKED_V12_ACTIVE_POSITION_COUNT_MISMATCH:expected=${v12Actives.length}:actual=${actualV12.length}`);
        for (const expected of v12Actives) {
            const actual = actualV12.find((row) => row.symbol.toUpperCase() === expected.symbol.toUpperCase());
            if (!actual) throw new Error(`MIGRATION_BLOCKED_V12_ACTIVE_POSITION_SYMBOL_MISMATCH:${expected.symbol}`);
            if (actualSide(actual) !== expected.side) throw new Error(`MIGRATION_BLOCKED_V12_ACTIVE_POSITION_SIDE_MISMATCH:${expected.symbol}`);
            if (Math.abs(Math.abs(actual.quantity) - expected.quantity) > Math.max(1e-8, expected.quantity * 0.01)) throw new Error(`MIGRATION_BLOCKED_V12_ACTIVE_POSITION_QTY_MISMATCH:${expected.symbol}`);
            const protection = await reconcileV12Protection(adapter, expected.protection);
            if (protection.manualReview) throw new Error(`MIGRATION_BLOCKED_${protection.manualReview}`);
        }
        const allowed = new Set(v12Actives.flatMap((active) => [active.protection.stopClientOrderId, active.protection.takeProfitClientOrderId].filter(Boolean)));
        const unknown = activeV12Orders.filter((row) => !allowed.has(row.clientOrderId));
        if (unknown.length) throw new Error(`MIGRATION_BLOCKED_V12_UNKNOWN_ACTIVE_ORDER:${unknown.map((row) => row.clientOrderId).join(",")}`);
        v12ActiveStateReconciled = true;
    } else {
        const actualV12 = actualPositions.filter((row) => Math.abs(row.quantity) > EPS && V12_X1_ALL.universe.some((base) => `${base}USDT` === row.symbol.toUpperCase()));
        if (actualV12.length) throw new Error(`MIGRATION_BLOCKED_V12_POSITION_ONLY_MISMATCH:${actualV12.map((row) => row.symbol).join(",")}`);
        if (activeV12Orders.length) throw new Error(`MIGRATION_BLOCKED_V12_ORDER_ONLY_MISMATCH:${activeV12Orders.map((row) => row.clientOrderId).join(",")}`);
    }

    const lock = new FileAccountOrderLock(v12.lockPath || ".runtime-state/shared/account-order.lock", numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000));
    const handle = await lock.acquire(`V96_TO_V12_PREFLIGHT:${process.pid}:${randomUUID()}`);
    if (!handle) throw new Error("MIGRATION_BLOCKED_SHARED_ACCOUNT_LOCK");
    await handle.release();

    console.log(JSON.stringify({
        status: "V96_TO_V12_MIGRATION_PREFLIGHT_PASS",
        v96StateBootstrapRequired: false,
        v96ManagedPositions: 0,
        v96OpenOrders: 0,
        v96ResidentProtection: 0,
        v96Pending: 0,
        v12Pending: 0,
        v12ActivePosition: v12Actives.length,
        v12ActiveStateReconciled,
        sharedKillSwitchActive: false,
        sharedRiskFresh: true,
        sharedRiskLossPct: risk.state?.lossPct,
        sharedAccountLockAvailable: true,
        preservedNonV96PositionCount: nonzero.length,
        ordersSent: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({ status: "V96_TO_V12_MIGRATION_PREFLIGHT_FAILED", message: error instanceof Error ? error.message : String(error), ordersSent: false }));
    process.exitCode = 1;
});
