import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { DISDEX_V96_RUNTIME } from "../config/disdexV96Runtime";
import { AsterApiError, AsterV3Client, type AsterOrderResponse } from "../lib/aster-v3-client";
import { readDisDexV96KillSwitch } from "../lib/disdex-v96-live-risk-controls";
import { FileDisDexV96RunnerStateStore } from "../lib/disdex-v96-runner-state";

const MANAGED_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"]);
const APPLY_ACK = "RECONCILE_LEGACY_V96_FLAT_STATE" as const;
const TERMINAL_ORDER_STATUSES = new Set(["FILLED", "CANCELED", "CANCELLED", "EXPIRED", "REJECTED"]);

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function terminalStatus(order: AsterOrderResponse | undefined) {
    if (!order) return "NOT_FOUND";
    return String(order.status || "UNKNOWN").toUpperCase();
}

async function getOrderOrNotFound(client: AsterV3Client, symbol: string, clientOrderId: string) {
    try {
        return await client.getOrder(symbol, clientOrderId);
    } catch (error) {
        if (error instanceof AsterApiError && (error.code === -2013 || error.status === 404)) return undefined;
        throw error;
    }
}

async function main() {
    const apply = process.argv.includes("--apply");
    const stateRoot = resolve(process.env.DISDEX_V96_STATE_DIR || DISDEX_V96_RUNTIME.stateDirectory);
    const statePath = resolve(stateRoot, "runner-live.json");
    const killSwitchPath = process.env.DISDEX_V96_KILL_SWITCH_FILE;
    if (!killSwitchPath) throw new Error("LEGACY_RECONCILE_KILL_SWITCH_PATH_MISSING");
    const killSwitch = await readDisDexV96KillSwitch(killSwitchPath);
    if (!killSwitch?.active) throw new Error("LEGACY_RECONCILE_REQUIRES_ACTIVE_KILL_SWITCH");

    const store = new FileDisDexV96RunnerStateStore(statePath, "live");
    const state = await store.load();
    if (!state.pending) throw new Error("LEGACY_RECONCILE_NO_PENDING_STATE");
    if (state.pending.phase !== "manual_review") {
        throw new Error(`LEGACY_RECONCILE_PENDING_PHASE_NOT_MANUAL_REVIEW:${state.pending.phase}`);
    }

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-Legacy-V96-Reconciliation/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("LEGACY_RECONCILE_ASTER_CREDENTIALS_MISSING");

    const pending = structuredClone(state.pending);
    const bnbFill = [...state.completedExecutions].reverse().find((row) =>
        row.symbol.toUpperCase() === "BNBUSDT" && row.reduceOnly === true && String(row.status).toUpperCase() === "FILLED"
    );
    if (!bnbFill) throw new Error("LEGACY_RECONCILE_BNB_REDUCE_ONLY_FILL_EVIDENCE_MISSING");

    const [positions, openOrders, pendingOrder, bnbExchangeOrder] = await Promise.all([
        client.getPositions(),
        client.getOpenOrders(),
        getOrderOrNotFound(client, pending.symbol, pending.clientOrderId),
        getOrderOrNotFound(client, bnbFill.symbol, bnbFill.clientOrderId),
    ]);
    if (!Array.isArray(positions)) throw new Error("LEGACY_RECONCILE_POSITIONS_UNAVAILABLE");
    if (!Array.isArray(openOrders)) throw new Error("LEGACY_RECONCILE_OPEN_ORDERS_UNAVAILABLE");

    const activeManagedPositions = positions.filter((row) =>
        MANAGED_SYMBOLS.has(String(row.symbol).toUpperCase()) && Math.abs(Number(row.positionAmt) || 0) > 1e-12
    );
    if (activeManagedPositions.length > 0) {
        throw new Error(`LEGACY_RECONCILE_MANAGED_POSITIONS_NOT_FLAT:${activeManagedPositions.map((row) => `${row.symbol}=${row.positionAmt}`).join(",")}`);
    }
    if (openOrders.length > 0) {
        throw new Error(`LEGACY_RECONCILE_OPEN_ORDERS_PRESENT:${openOrders.length}`);
    }

    const pendingStatus = terminalStatus(pendingOrder);
    if (pendingOrder && !TERMINAL_ORDER_STATUSES.has(pendingStatus)) {
        throw new Error(`LEGACY_RECONCILE_PENDING_ORDER_NOT_TERMINAL:${pendingStatus}`);
    }
    const bnbStatus = terminalStatus(bnbExchangeOrder);
    if (bnbStatus !== "FILLED") {
        throw new Error(`LEGACY_RECONCILE_BNB_EXCHANGE_STATUS_NOT_FILLED:${bnbStatus}`);
    }
    if (bnbExchangeOrder?.reduceOnly !== true) {
        throw new Error("LEGACY_RECONCILE_BNB_EXCHANGE_ORDER_NOT_REDUCE_ONLY");
    }
    if (String(bnbExchangeOrder?.side || "").toUpperCase() !== "SELL") {
        throw new Error(`LEGACY_RECONCILE_BNB_EXCHANGE_SIDE_NOT_SELL:${String(bnbExchangeOrder?.side || "UNKNOWN")}`);
    }

    const reportBase = {
        reconciliationType: "LEGACY_V96_PENDING_AND_MARGIN_GUARD",
        strategyId: state.strategyId,
        verifiedAt: new Date().toISOString(),
        killSwitch: {
            active: true,
            reason: killSwitch.reason,
            operator: killSwitch.operator,
            activatedAt: killSwitch.activatedAt,
        },
        pendingState: pending,
        pendingExchangeOrder: pendingOrder ? {
            symbol: pendingOrder.symbol,
            clientOrderId: pendingOrder.clientOrderId,
            orderId: pendingOrder.orderId,
            status: pendingStatus,
            side: pendingOrder.side,
            reduceOnly: pendingOrder.reduceOnly,
            origQty: pendingOrder.origQty,
            executedQty: pendingOrder.executedQty,
        } : { symbol: pending.symbol, clientOrderId: pending.clientOrderId, status: "NOT_FOUND" },
        bnbReduceOnlyFill: {
            durableRecord: bnbFill,
            exchangeRecord: {
                symbol: bnbExchangeOrder?.symbol,
                clientOrderId: bnbExchangeOrder?.clientOrderId,
                orderId: bnbExchangeOrder?.orderId,
                status: bnbStatus,
                side: bnbExchangeOrder?.side,
                reduceOnly: bnbExchangeOrder?.reduceOnly,
                origQty: bnbExchangeOrder?.origQty,
                executedQty: bnbExchangeOrder?.executedQty,
                avgPrice: bnbExchangeOrder?.avgPrice,
            },
        },
        exchangeEvidence: {
            managedPositionCount: activeManagedPositions.length,
            openOrderCount: openOrders.length,
        },
        mutations: {
            ordersSent: false,
            cancelsSent: false,
            positionsChanged: false,
            approvalChanged: false,
        },
    } as const;

    if (!apply) {
        console.log(JSON.stringify({ status: "LEGACY_V96_RECONCILE_READY_TO_APPLY", ...reportBase }));
        return;
    }
    if (process.env.DISDEX_V96_RECONCILE_ACKNOWLEDGEMENT !== APPLY_ACK) {
        throw new Error(`LEGACY_RECONCILE_APPLY_REQUIRES_ACK:${APPLY_ACK}`);
    }

    const auditPath = resolve(stateRoot, "reconciliation", `legacy-v96-${Date.now()}.json`);
    await mkdir(dirname(auditPath), { recursive: true });
    await writeFile(auditPath, `${JSON.stringify({ status: "VERIFIED_APPLYING", ...reportBase }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });

    state.pending = undefined;
    state.manualReviewReason = undefined;
    state.bootstrapRequired = true;
    await store.save(state);

    const finalReport = {
        status: "LEGACY_V96_RECONCILE_APPLIED",
        appliedAt: new Date().toISOString(),
        statePath,
        auditPath,
        pendingStateCleared: true,
        bootstrapRequired: true,
        ...reportBase,
    };
    await writeFile(auditPath, `${JSON.stringify(finalReport, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify(finalReport));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "LEGACY_V96_RECONCILE_FAIL_CLOSED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: false,
        cancelsSent: false,
        positionsChanged: false,
    }));
    process.exitCode = 1;
});
