import "dotenv/config";

import { randomUUID } from "node:crypto";
import { AsterV3Client } from "../lib/aster-v3-client";
import { V12_X1_ALL, resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { classifyAsterSymbol } from "../lib/disdex-aster-portfolio-classifier";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { FileV12X1AllRunnerStateStore } from "../lib/v12-x1-all-runner-state";

function boolEnv(name: string) { return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim()); }
function numberEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isFinite(value) ? value : fallback; }

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
        userAgent: "DisDex-V12-LIVE-Readiness/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("V12_LIVE_REQUIRES_ASTER_CREDENTIALS");

    const stateStore = new FileV12X1AllRunnerStateStore(runtime.statePath, "LIVE");
    const [risk, state, _ping, positions, openOrders, exchangeInfo] = await Promise.all([
        readSharedCryptoDailyRisk(runtime.riskPath),
        stateStore.load(),
        client.ping(),
        client.getPositions(),
        client.getOpenOrders(),
        client.getExchangeInfo(),
    ]);
    void _ping;

    if (!risk.ok) throw new Error(`V12_SHARED_CRYPTO_RISK_NOT_READY:${risk.reason}`);
    if (state.killSwitch?.active || state.manualReview) throw new Error(`V12_STATE_MANUAL_REVIEW:${state.killSwitch?.reason || state.manualReview}`);
    if (state.pending) throw new Error(`V12_PENDING_STATE_PRESENT:${state.pending.clientOrderId}`);
    if (state.active) throw new Error(`V12_ACTIVE_STATE_PRESENT:${state.active.symbol}`);

    const nonzero = positions.filter((row) => Math.abs(Number(row.positionAmt) || 0) > 1e-12);
    const unknownPositions = nonzero.filter((row) => !classifyAsterSymbol(row.symbol).tradable);
    if (unknownPositions.length) throw new Error(`ASTER_UNKNOWN_NONZERO_POSITION:${unknownPositions.map((row) => row.symbol).join(",")}`);
    const unknownOrders = openOrders.filter((row) => !classifyAsterSymbol(row.symbol).tradable);
    if (unknownOrders.length) throw new Error(`ASTER_UNKNOWN_OPEN_ORDER:${unknownOrders.map((row) => row.symbol).join(",")}`);

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
        killSwitchActive: false,
        pendingState: false,
        activeState: false,
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
