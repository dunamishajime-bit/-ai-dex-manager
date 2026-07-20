import { config as loadDotenv } from "dotenv";
import { access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { ACTIVE_MAIN_STRATEGY_MODE, ACTIVE_MAIN_STRATEGY_REAL_TRADING_ENABLED } from "../config/mainStrategy";
import { DISDEX_PENGU_DUAL_ENGINE_V46, DISDEX_V46_RUNTIME } from "../config/disdexV46Runtime";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectOpenOrder, type DirectPosition } from "../lib/direct-trade-executor";
import { DisDexV46AsterMarketDataProvider } from "../lib/disdex-v46-market-data-provider";
import { assertMarketDataFreshness, calculateEquity, DISDEX_V46_MANAGED_SYMBOLS, isV46OwnedOrder, positionsMatch, snapshotPositions } from "../lib/disdex-v46-live-safety";
import { FileDisDexV46RunnerStateStore, type DisDexV46RunnerState } from "../lib/disdex-v46-runner-state";

const envFile = process.env.DISDEX_V46_ENV_FILE || "/home/deploy/ai-dex-manager/.env.local";
loadDotenv({ path: envFile, override: false });

function boolEnv(name: string, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(raw.trim());
}

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function oneWayMode(response: { dualSidePosition?: boolean | string }) {
    const value = response.dualSidePosition;
    return !(value === true || String(value).toLowerCase() === "true");
}

function managed(symbol: string) {
    return (DISDEX_V46_MANAGED_SYMBOLS as readonly string[]).includes(String(symbol).toUpperCase());
}

function positionDetails(positions: DirectPosition[]) {
    return positions
        .filter((position) => managed(position.symbol))
        .map((position) => ({
            symbol: position.symbol.toUpperCase(),
            positionSide: position.positionSide,
            quantity: position.quantity,
            notionalUsd: position.notionalUsd,
        }));
}

function orderDetails(orders: DirectOpenOrder[]) {
    return orders.map((order) => ({
        symbol: order.symbol.toUpperCase(),
        clientOrderId: order.clientOrderId ? "present" : "missing",
        quantity: order.quantity,
        executedQuantity: order.executedQuantity,
        status: order.status,
    }));
}

async function exists(path: string) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function commandOutput(command: string, args: string[]) {
    try {
        return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
        return "";
    }
}

function activeUnitNames() {
    return commandOutput("systemctl", ["list-units", "--type=service", "--state=active", "--no-legend"])
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/)[0])
        .filter(Boolean);
}

function validateFunding(payload: unknown) {
    if (!Array.isArray(payload) || payload.length === 0) throw new Error("Aster V3 Funding payload must be a non-empty array.");
    let previousTime = 0;
    for (const row of payload) {
        const symbol = String((row as { symbol?: unknown })?.symbol || "");
        const fundingTime = Number((row as { fundingTime?: unknown })?.fundingTime);
        const fundingRate = Number((row as { fundingRate?: unknown })?.fundingRate);
        if (symbol !== "PENGUUSDT") throw new Error(`Unexpected Funding symbol: ${symbol}`);
        if (!Number.isFinite(fundingTime) || fundingTime <= 0) throw new Error("Invalid Funding time.");
        if (!Number.isFinite(fundingRate)) throw new Error("Invalid Funding rate.");
        if (fundingTime < previousTime) throw new Error("Funding history is not ascending.");
        if (fundingTime > Date.now() + 300_000) throw new Error("Future Funding timestamp detected.");
        previousTime = fundingTime;
    }
    return { rows: payload.length, latestFundingTime: previousTime };
}

async function fetchFunding() {
    const baseUrl = String(process.env.ASTER_PUBLIC_FUTURES_BASE_URL || "https://fapi.asterdex.com").replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/fapi/v3/fundingRate?symbol=PENGUUSDT&limit=5`, {
        method: "GET",
        headers: { "user-agent": "DisDex-PENGU-V46-LIVE-Preflight/1.0" },
        cache: "no-store",
    });
    if (!response.ok) throw new Error(`Aster V3 Funding HTTP ${response.status}.`);
    return validateFunding(await response.json() as unknown);
}

async function stateFilePresent(path: string) {
    return exists(path);
}

function assertRuntime() {
    if (ACTIVE_MAIN_STRATEGY_MODE !== "LIVE") throw new Error("Main strategy mode is not LIVE.");
    if (ACTIVE_MAIN_STRATEGY_REAL_TRADING_ENABLED !== true) throw new Error("Main strategy real-trading gate is not enabled.");
    if (DISDEX_V46_RUNTIME.mode !== "LIVE") throw new Error("V46 runtime mode is not LIVE.");
    if (DISDEX_V46_RUNTIME.liveTradingEnabled !== true) throw new Error("V46 runtime liveTradingEnabled is not true.");
    if (String(process.env.DISDEX_V46_RUNNER_MODE || "").toLowerCase() !== "live") throw new Error("DISDEX_V46_RUNNER_MODE must be live.");
    if (!boolEnv("DISDEX_V46_LIVE_EXECUTION_ENABLED")) throw new Error("DISDEX_V46_LIVE_EXECUTION_ENABLED must be true.");
    if (numberEnv("DISDEX_V46_MAX_GROSS", DISDEX_V46_RUNTIME.maximumGross) !== 2) throw new Error("LIVE maximum gross must be 2.");
    if (numberEnv("DISDEX_V46_CASH_RESERVE_PCT", DISDEX_V46_RUNTIME.cashReservePct) !== 2) throw new Error("LIVE cash reserve must be 2%.");
    if (boolEnv("DISDEX_V46_CLOSE_UNMANAGED_POSITIONS", DISDEX_V46_RUNTIME.closeUnmanagedPositions)) throw new Error("closeUnmanagedPositions must be false.");
    if (DISDEX_V46_RUNTIME.closeUnmanagedPositions !== false) throw new Error("Runtime closeUnmanagedPositions must be false.");
    if (DISDEX_PENGU_DUAL_ENGINE_V46.longGross !== 0.15 || DISDEX_PENGU_DUAL_ENGINE_V46.shortGross !== 0.15) throw new Error("PENGU Long/Short Gross must remain 0.15.");
    if (DISDEX_PENGU_DUAL_ENGINE_V46.fundingCap !== 0.0003) throw new Error("PENGU Funding cap changed.");
    if (DISDEX_PENGU_DUAL_ENGINE_V46.evidence.pristineForwardEvidence !== false) throw new Error("PENGU pristineForwardEvidence must remain false.");
    if (DISDEX_V46_RUNTIME.livePromotionBasis !== "MANUAL_OPERATOR_OVERRIDE") throw new Error("LIVE promotion basis must be manual operator override.");
}

function assertProcessSafety() {
    const activeUnits = activeUnitNames();
    const paperUnits = activeUnits.filter((unit) => /disdex-(?:v35|v46-paper)/i.test(unit));
    if (paperUnits.length) throw new Error(`Paper Dis-Dex service is active: ${paperUnits.join(",")}`);
    const otherLiveUnits = activeUnits.filter((unit) => /disdex/i.test(unit) && /live/i.test(unit) && unit !== "disdex-v46-live.service");
    if (otherLiveUnits.length) throw new Error(`Another Dis-Dex LIVE service is active: ${otherLiveUnits.join(",")}`);
    const processes = commandOutput("ps", ["-eo", "pid=,args="]);
    const otherRunner = processes
        .split(/\r?\n/)
        .filter((line) => /(?:disdex-v35|disdex-v46)[^\r\n]*runner/i.test(line))
        .filter((line) => !/preflight|selftest|install-disdex/i.test(line));
    if (otherRunner.length) throw new Error("Another Dis-Dex runner process is active.");
    return { paperDaemonActive: false, otherLiveRunnerActive: false };
}

async function main() {
    assertRuntime();
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-PENGU-V46-LIVE-Preflight/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("Aster authentication credentials are missing.");
    const executor = new AsterDirectTradeExecutor(client, {
        exchangeInfoTtlMs: numberEnv("ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
        reconciliationAttempts: 1,
        reconciliationDelayMs: 250,
    });
    const stateRoot = resolve(process.env.DISDEX_V46_STATE_DIR || ".runtime-state/disdex-v46-live");
    const statePath = resolve(stateRoot, "runner-live.json");
    const statePresent = await stateFilePresent(statePath);
    const stateStore = new FileDisDexV46RunnerStateStore(statePath, "live");
    const state = await stateStore.load();

    const [account, positions, openOrders, positionMode, funding, history] = await Promise.all([
        executor.getAccountSnapshot(),
        executor.getPositions(),
        executor.getOpenOrders(),
        client.getPositionMode(),
        fetchFunding(),
        new DisDexV46AsterMarketDataProvider(client, {
            coreLimit: numberEnv("DISDEX_V46_CORE_12H_LIMIT", 400),
            hourlyLimit: numberEnv("DISDEX_V46_HOURLY_LIMIT", 1000),
            fundingLimit: 100,
            fundingBaseUrl: process.env.ASTER_PUBLIC_FUTURES_BASE_URL || "https://fapi.asterdex.com",
        }).load(true),
    ]);
    if (!oneWayMode(positionMode)) throw new Error("Aster account is in Hedge Mode; LIVE preflight requires One-way Mode.");
    if (positions.some((position) => position.positionSide !== "BOTH")) throw new Error("Aster position response is not One-way/BOTH.");
    const dataFreshness = assertMarketDataFreshness(history, Date.now(), {
        core12hMs: numberEnv("DISDEX_V46_CORE_MAX_MARKET_DATA_AGE_MS", 13 * 60 * 60_000),
        hourlyMs: numberEnv("DISDEX_V46_HOURLY_MAX_MARKET_DATA_AGE_MS", 2 * 60 * 60_000),
    });
    const equity = calculateEquity(account, positions);
    const processSafety = assertProcessSafety();
    const unknownPending = Boolean(state.pending && (state.pending.phase === "manual_review" || /unknown/i.test(String(state.pending.lastError || ""))));
    if (unknownPending) throw new Error("Unresolved UNKNOWN pending state exists.");

    let recoveryOnly = false;
    if (!statePresent || state.bootstrapRequired) {
        if (state.pending) throw new Error("Initial Bootstrap requires no pending state.");
        const managedPositions = positions.filter((position) => managed(position.symbol));
        if (managedPositions.length) throw new Error(`Initial Bootstrap requires managed symbols to be flat: ${JSON.stringify(positionDetails(managedPositions))}`);
        if (openOrders.length) throw new Error(`Initial Bootstrap requires zero Open Orders: ${JSON.stringify(orderDetails(openOrders))}`);
    } else {
        if (!positionsMatch(state.positionsSnapshot, positions)) throw new Error(`Saved positions do not match Aster positions: ${JSON.stringify(positionDetails(positions))}`);
        if (state.pending) {
            const match = openOrders.some((order) => order.clientOrderId === state.pending?.clientOrderId);
            if (!match) throw new Error("Saved pending clientOrderId does not match an Aster Open Order.");
            recoveryOnly = true;
        } else {
            const conflicts = openOrders.filter((order) => isV46OwnedOrder(order) || managed(order.symbol));
            if (conflicts.length) throw new Error(`Managed or V46-owned Open Order requires manual review: ${JSON.stringify(orderDetails(conflicts))}`);
        }
    }

    console.log(JSON.stringify({
        status: "LIVE_PREFLIGHT_OK",
        envFileReferenced: true,
        orderMutationApiCalls: 0,
        mode: DISDEX_V46_RUNTIME.mode,
        liveTradingEnabled: DISDEX_V46_RUNTIME.liveTradingEnabled,
        liveExecutionEnabled: boolEnv("DISDEX_V46_LIVE_EXECUTION_ENABLED"),
        maximumGross: DISDEX_V46_RUNTIME.maximumGross,
        cashReservePct: DISDEX_V46_RUNTIME.cashReservePct,
        closeUnmanagedPositions: DISDEX_V46_RUNTIME.closeUnmanagedPositions,
        managedSymbols: DISDEX_V46_MANAGED_SYMBOLS,
        accountEquity: equity.equity,
        managedPositionCount: positions.filter((position) => managed(position.symbol)).length,
        openOrderCount: openOrders.length,
        oneWayMode: true,
        funding,
        dataFreshness,
        stateFilePresent: statePresent,
        recoveryOnly,
        pendingUnknown: false,
        ...processSafety,
        goldCatTouched: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({ status: "LIVE_PREFLIGHT_FAILED", message: error instanceof Error ? error.message : String(error), orderMutationApiCalls: 0 }));
    process.exitCode = 1;
});
