import "dotenv/config";

import { randomUUID } from "node:crypto";
import { AsterV3Client } from "../lib/aster-v3-client";
import { V12_X1_ALL, resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { classifyAsterSymbol } from "../lib/disdex-aster-portfolio-classifier";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import { reconcileV12Protection } from "../lib/v12-resident-stop-lifecycle";
import { FileV12X1AllRunnerStateStore } from "../lib/v12-x1-all-runner-state";

const EPS = 1e-12;
function boolEnv(name: string) { return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim()); }
function numberEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isFinite(value) ? value : fallback; }
function actualSide(position: { quantity: number; positionSide: string }) {
    if (position.positionSide === "LONG") return "LONG" as const;
    if (position.positionSide === "SHORT") return "SHORT" as const;
    return position.quantity < 0 ? "SHORT" as const : "LONG" as const;
}

async function main() {
    const runtime = resolveV12X1AllRuntime();
    if (runtime.mode !== "LIVE" || !runtime.enabled || !runtime.liveTradingEnabled || !runtime.liveExecutionEnabled || !boolEnv("DISDEX_V12_LIVE_ALLOW_REAL_ORDERS")) {
        throw new Error("V12_LIVE_GATES_NOT_ALL_ENABLED");
    }

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V12-LIVE-Readiness/1.1",
    });
    if (!client.hasTradingCredentials()) throw new Error("V12_LIVE_REQUIRES_ASTER_CREDENTIALS");

    const stateStore = new FileV12X1AllRunnerStateStore(runtime.statePath, "LIVE");
    const [risk, sharedKillSwitch, state, _ping, positions, openOrders, exchangeInfo] = await Promise.all([
        readSharedCryptoDailyRisk(runtime.riskPath),
        readSharedKillSwitch(),
        stateStore.load(),
        client.ping(),
        client.getPositions(),
        client.getOpenOrders(),
        client.getExchangeInfo(),
    ]);
    void _ping;

    if (!risk.ok) throw new Error(`V12_SHARED_CRYPTO_RISK_NOT_READY:${risk.reason}`);
    if (sharedKillSwitch.active) throw new Error(`V12_SHARED_KILL_SWITCH_ACTIVE:${sharedKillSwitch.reason || "UNSPECIFIED"}`);
    if (state.killSwitch?.active || state.manualReview) throw new Error(`V12_STATE_MANUAL_REVIEW:${state.killSwitch?.reason || state.manualReview}`);
    if (state.pending) throw new Error(`V12_PENDING_STATE_PRESENT:${state.pending.clientOrderId}`);

    const nonzero = positions.filter((row) => Math.abs(Number(row.positionAmt) || 0) > 1e-12);
    const unknownPositions = nonzero.filter((row) => !classifyAsterSymbol(row.symbol).tradable);
    if (unknownPositions.length) throw new Error(`ASTER_UNKNOWN_NONZERO_POSITION:${unknownPositions.map((row) => row.symbol).join(",")}`);
    const unknownOrders = openOrders.filter((row) => !classifyAsterSymbol(row.symbol).tradable);
    if (unknownOrders.length) throw new Error(`ASTER_UNKNOWN_OPEN_ORDER:${unknownOrders.map((row) => row.symbol).join(",")}`);

    const adapter = new V12AsterLiveAdapter(client, {
        maxSlippageBps: numberEnv("V12_X1_ALL_MAX_SLIPPAGE_BPS", 20),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const actualPositions = await adapter.getPositions();
    const activeV12Orders = (await adapter.listV12Orders()).filter((row) => ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(String(row.status || "").toUpperCase()));
    const statePositions = state.activePositions?.length ? state.activePositions : state.active ? [state.active] : [];
    let activeStateReconciled = false;
    let residentProtectionVerified = false;
    if (statePositions.length) {
        const actualV12 = actualPositions.filter((row) => Math.abs(row.quantity) > EPS && V12_X1_ALL.universe.some((base) => `${base}USDT` === row.symbol.toUpperCase()));
        if (actualV12.length !== statePositions.length) throw new Error(`V12_ACTIVE_POSITION_COUNT_MISMATCH:expected=${statePositions.length}:actual=${actualV12.length}`);
        const allowed = new Set<string>();
        for (const expected of statePositions) {
            const actual = actualV12.find((row) => row.symbol.toUpperCase() === expected.symbol.toUpperCase());
            if (!actual) throw new Error(`V12_ACTIVE_POSITION_SYMBOL_MISMATCH:${expected.symbol}`);
            if (actualSide(actual) !== expected.side) throw new Error(`V12_ACTIVE_POSITION_SIDE_MISMATCH:${expected.symbol}`);
            if (Math.abs(Math.abs(actual.quantity) - expected.quantity) > Math.max(1e-8, expected.quantity * 0.01)) throw new Error(`V12_ACTIVE_POSITION_QTY_MISMATCH:${expected.symbol}`);
            const reconciledProtection = await reconcileV12Protection(adapter, expected.protection);
            if (reconciledProtection.manualReview) throw new Error(reconciledProtection.manualReview);
            allowed.add(expected.protection.stopClientOrderId);
            allowed.add(expected.protection.takeProfitClientOrderId);
        }
        const unknown = activeV12Orders.filter((row) => !allowed.has(row.clientOrderId));
        if (unknown.length) throw new Error(`V12_UNKNOWN_ACTIVE_ORDER:${unknown.map((row) => row.clientOrderId).join(",")}`);
        activeStateReconciled = true;
        residentProtectionVerified = true;
    } else {
        const actualV12 = actualPositions.filter((row) => Math.abs(row.quantity) > EPS && V12_X1_ALL.universe.some((base) => `${base}USDT` === row.symbol.toUpperCase()));
        if (actualV12.length) throw new Error(`V12_POSITION_ONLY_MISMATCH:${actualV12.map((row) => row.symbol).join(",")}`);
        if (activeV12Orders.length) throw new Error(`V12_ORDER_ONLY_MISMATCH:${activeV12Orders.map((row) => row.clientOrderId).join(",")}`);
    }

    const bySymbol = new Map(exchangeInfo.symbols.map((row) => [String(row.symbol).toUpperCase(), row]));
    for (const base of V12_X1_ALL.universe) {
        const symbol = `${base}USDT`;
        const row = bySymbol.get(symbol);
        if (!row || row.status !== "TRADING") throw new Error(`V12_SYMBOL_NOT_TRADING:${symbol}`);
        const filters = row.filters || [];
        if (!filters.some((filter) => filter.filterType === "MARKET_LOT_SIZE" || filter.filterType === "LOT_SIZE")) throw new Error(`V12_QUANTITY_FILTER_MISSING:${symbol}`);
        if (!filters.some((filter) => filter.filterType === "MIN_NOTIONAL")) throw new Error(`V12_MIN_NOTIONAL_FILTER_MISSING:${symbol}`);
        const orderTypes = new Set((row.orderTypes || []).map((value) => String(value).toUpperCase()));
        if (!orderTypes.has("MARKET") || !orderTypes.has("STOP_MARKET")) throw new Error(`V12_REQUIRED_ORDER_TYPE_MISSING:${symbol}`);
    }

    const lock = new FileAccountOrderLock(runtime.lockPath || ".runtime-state/shared/account-order.lock", numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000));
    const handle = await lock.acquire(`V12_READINESS:${process.pid}:${randomUUID()}`);
    if (!handle) throw new Error("V12_SHARED_ACCOUNT_LOCK_NOT_AVAILABLE");
    await handle.release();

    const v12Symbols = new Set(V12_X1_ALL.universe.map((base) => `${base}USDT`));
    const v12UniversePositionCount = nonzero.filter((row) => v12Symbols.has(String(row.symbol).toUpperCase())).length;
    const v12UniverseOpenOrderCount = openOrders.filter((row) => v12Symbols.has(String(row.symbol).toUpperCase())).length;

    console.log(JSON.stringify({
        status: "V12_LIVE_READINESS_PASS",
        strategyId: V12_X1_ALL.strategyId,
        sourceSha: V12_X1_ALL.sourceSha,
        riskStateFresh: true,
        riskLossPct: risk.state?.lossPct,
        sharedKillSwitchActive: false,
        sharedKillSwitchPath: sharedKillSwitch.sourcePath,
        v12KillSwitchActive: false,
        pendingState: false,
        activeState: activeStateReconciled,
        residentProtectionVerified,
        sharedAccountLockAvailable: true,
        allV12SymbolsTrading: true,
        requiredOrderTypesPresent: true,
        v12UniversePositionCount,
        v12UniverseOpenOrderCount,
        ordersSent: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({ status: "V12_LIVE_READINESS_FAILED", message: error instanceof Error ? error.message : String(error), ordersSent: false }));
    process.exitCode = 1;
});
