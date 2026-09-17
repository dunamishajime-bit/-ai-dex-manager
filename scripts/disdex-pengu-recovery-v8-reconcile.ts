import "dotenv/config";

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AsterV3Client } from "../lib/aster-v3-client";
import { PENGU_RECOVERY_V8 } from "../config/penguRecoveryV8";
import { assertSharedKillSwitchAllowsNewEntry } from "../lib/disdex-shared-kill-switch";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { FilePenguDualLsV2RunnerStateStore, type PenguDualLsV2RunnerState, type PenguDualLsV2RunnerStateStore } from "../lib/pengu-dual-ls-v2-runner-state";
import {
    AsterRecoveryV8ProtectiveOrderGateway,
    buildRecoveryV8HardStopPlan,
    normalizeRecoveryV8OrderValue,
    type RecoveryV8ProtectiveOrder,
} from "../lib/pengu-recovery-v8-protective-orders";

const SYMBOL = PENGU_RECOVERY_V8.symbol;
const DEFAULT_STATE_PATH = "/var/lib/disdex/pengu-dual-ls-v2/runner-live.json";

type RecoveryReconciliationResult = {
    status: "DRY_RUN_PASS" | "APPLIED_PASS";
    apply: boolean;
    symbol: string;
    positionQuantity: number;
    entryPrice: number;
    stopPrice: number;
    quantity: number;
    clientOrderId: string;
    backupPath?: string;
    ordersSent: number;
    cancelsSent: number;
    positionChangesSent: number;
};

function finite(value: unknown, label: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`PENGU_RECOVERY_V8_RECONCILE_INVALID_${label}`);
    return parsed;
}

function equalWithin(actual: number, expected: number, relative = 1e-9) {
    return Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * relative);
}

function statePathFromEnv() {
    return resolve(process.env.PENGU_RECOVERY_V8_RECONCILE_STATE_PATH || resolve(
        process.env.PENGU_DUAL_LS_V2_STATE_DIR || dirname(DEFAULT_STATE_PATH),
        "runner-live.json",
    ));
}

function backupPathFor(statePath: string, now = Date.now()) {
    return resolve(dirname(statePath), "recovery-v8-reconciliation-backups", `runner-live.${now}.json`);
}

function assertStateForRecovery(state: PenguDualLsV2RunnerState) {
    if (state.mode !== "LIVE") throw new Error(`PENGU_RECOVERY_V8_RECONCILE_MODE_MISMATCH:${state.mode}`);
    if (state.pending != null) throw new Error("PENGU_RECOVERY_V8_RECONCILE_PENDING_STATE_PRESENT");
    if (!state.position || state.position.entryVersion !== "RECOVERY_V8" || !state.position.recoveryV8) {
        throw new Error("PENGU_RECOVERY_V8_RECONCILE_RECOVERY_POSITION_MISSING");
    }
    if (state.position.recoveryV8.protectionLifecycle !== "MANUAL_REVIEW") {
        throw new Error(`PENGU_RECOVERY_V8_RECONCILE_UNEXPECTED_LIFECYCLE:${state.position.recoveryV8.protectionLifecycle}`);
    }
    const recovery = state.position.recoveryV8;
    if (state.position.side !== 1 || recovery.side !== 1) throw new Error("PENGU_RECOVERY_V8_RECONCILE_NOT_LONG");
    if (!equalWithin(state.position.quantity, recovery.quantity, 0.01)) throw new Error("PENGU_RECOVERY_V8_RECONCILE_STATE_QUANTITY_MISMATCH");
    if (!equalWithin(state.position.entryPrice, recovery.entryPrice, 1e-9)) throw new Error("PENGU_RECOVERY_V8_RECONCILE_STATE_ENTRY_PRICE_MISMATCH");
    return recovery;
}

function assertAsterPosition(state: PenguDualLsV2RunnerState, rows: Array<Record<string, unknown>>) {
    const recovery = assertStateForRecovery(state);
    const active = rows.filter((row) => Math.abs(Number(row.positionAmt || 0)) > 1e-12);
    if (active.length !== 1) throw new Error(`PENGU_RECOVERY_V8_RECONCILE_POSITION_COUNT:${active.length}`);
    const row = active[0];
    if (String(row.symbol || "").toUpperCase() !== SYMBOL) throw new Error("PENGU_RECOVERY_V8_RECONCILE_SYMBOL_MISMATCH");
    if (String(row.positionSide || "BOTH").toUpperCase() !== "BOTH") throw new Error("PENGU_RECOVERY_V8_RECONCILE_POSITION_SIDE_MISMATCH");
    if (!equalWithin(finite(row.positionAmt, "POSITION_QUANTITY"), recovery.quantity, 0.01)) throw new Error("PENGU_RECOVERY_V8_RECONCILE_POSITION_QUANTITY_MISMATCH");
    if (!equalWithin(finite(row.entryPrice, "POSITION_ENTRY_PRICE"), recovery.entryPrice, 1e-6)) throw new Error("PENGU_RECOVERY_V8_RECONCILE_POSITION_ENTRY_PRICE_MISMATCH");
    if (finite(row.markPrice, "POSITION_MARK_PRICE") <= 0) throw new Error("PENGU_RECOVERY_V8_RECONCILE_MARK_PRICE_INVALID");
    if (finite(row.leverage, "POSITION_LEVERAGE") !== 5) throw new Error("PENGU_RECOVERY_V8_RECONCILE_LEVERAGE_MISMATCH");
    const marginType = String(row.marginType || "").toLowerCase();
    if (marginType !== "cross" && marginType !== "crossed") throw new Error("PENGU_RECOVERY_V8_RECONCILE_MARGIN_TYPE_MISMATCH");
    if (finite(row.markPrice, "POSITION_MARK_PRICE") <= recovery.entryPrice * (1 - PENGU_RECOVERY_V8.exit.hardStopPct)) {
        throw new Error("PENGU_RECOVERY_V8_RECONCILE_MARK_AT_OR_BELOW_HARD_STOP");
    }
}

async function buildNormalizedPlan(client: AsterV3Client, state: PenguDualLsV2RunnerState) {
    const recovery = assertStateForRecovery(state);
    const exchangeInfo = await client.getExchangeInfo();
    const symbol = exchangeInfo.symbols.find((row) => row.symbol.toUpperCase() === SYMBOL);
    if (!symbol) throw new Error("PENGU_RECOVERY_V8_RECONCILE_VENUE_SYMBOL_MISSING");
    const priceFilter = symbol.filters?.find((row) => row.filterType === "PRICE_FILTER");
    const quantityFilter = symbol.filters?.find((row) => row.filterType === "LOT_SIZE") || symbol.filters?.find((row) => row.filterType === "MARKET_LOT_SIZE");
    if (!priceFilter?.tickSize || !quantityFilter?.stepSize) throw new Error("PENGU_RECOVERY_V8_RECONCILE_VENUE_FILTERS_MISSING");
    const rawPlan = buildRecoveryV8HardStopPlan({ symbol: SYMBOL, entryTs: recovery.entryTs, entryPrice: recovery.entryPrice, quantity: recovery.quantity });
    const quantity = Number(normalizeRecoveryV8OrderValue(rawPlan.quantity, quantityFilter.stepSize, symbol.quantityPrecision ?? 0));
    const stopPrice = Number(normalizeRecoveryV8OrderValue(rawPlan.stopPrice, priceFilter.tickSize, symbol.pricePrecision ?? 0));
    if (!equalWithin(quantity, recovery.quantity, 1e-9)) throw new Error("PENGU_RECOVERY_V8_RECONCILE_NORMALIZED_QUANTITY_MISMATCH");
    if (!(stopPrice > 0 && stopPrice < recovery.entryPrice)) throw new Error("PENGU_RECOVERY_V8_RECONCILE_STOP_PRICE_INVALID");
    return { rawPlan, quantity, stopPrice };
}

function matchingProtection(orders: RecoveryV8ProtectiveOrder[], clientOrderId: string, quantity: number, stopPrice: number) {
    const matches = orders.filter((order) => order.clientOrderId === clientOrderId);
    if (matches.length !== 1) throw new Error(`PENGU_RECOVERY_V8_RECONCILE_READBACK_COUNT:${matches.length}`);
    const order = matches[0];
    if (order.reduceOnly !== true) throw new Error("PENGU_RECOVERY_V8_RECONCILE_READBACK_NOT_REDUCE_ONLY");
    if (!/^(NEW|PARTIALLY_FILLED)$/i.test(order.status)) throw new Error(`PENGU_RECOVERY_V8_RECONCILE_READBACK_STATUS:${order.status}`);
    if (!equalWithin(order.quantity, quantity, 1e-9)) throw new Error("PENGU_RECOVERY_V8_RECONCILE_READBACK_QUANTITY_MISMATCH");
    if (!equalWithin(order.stopPrice, stopPrice, 1e-9)) throw new Error("PENGU_RECOVERY_V8_RECONCILE_READBACK_STOP_MISMATCH");
    return order;
}

export async function reconcileRecoveryV8Protection(input: {
    client: AsterV3Client;
    stateStore: PenguDualLsV2RunnerStateStore;
    statePath: string;
    apply: boolean;
    now?: number;
    backupPath?: string;
}): Promise<RecoveryReconciliationResult> {
    const state = await input.stateStore.load();
    await assertSharedKillSwitchAllowsNewEntry();
    const recovery = assertStateForRecovery(state);
    const positionRows = await input.client.getPositions(SYMBOL) as unknown as Array<Record<string, unknown>>;
    assertAsterPosition(state, positionRows);
    const openOrders = await input.client.getOpenOrders();
    if (openOrders.length !== 0) throw new Error(`PENGU_RECOVERY_V8_RECONCILE_OPEN_ORDERS_PRESENT:${openOrders.length}`);
    const plan = await buildNormalizedPlan(input.client, state);
    const clientOrderId = plan.rawPlan.clientOrderId;
    if (!input.apply) {
        return {
            status: "DRY_RUN_PASS",
            apply: false,
            symbol: SYMBOL,
            positionQuantity: recovery.quantity,
            entryPrice: recovery.entryPrice,
            stopPrice: plan.stopPrice,
            quantity: plan.quantity,
            clientOrderId,
            ordersSent: 0,
            cancelsSent: 0,
            positionChangesSent: 0,
        };
    }
    const backupPath = input.backupPath || backupPathFor(input.statePath, input.now);
    await mkdir(dirname(backupPath), { recursive: true });
    await copyFile(input.statePath, backupPath);
    const gateway = new AsterRecoveryV8ProtectiveOrderGateway(input.client);
    const placed = await gateway.placeStopMarket(plan.rawPlan);
    const readBack = await gateway.getOpenOrders(SYMBOL);
    matchingProtection(readBack, clientOrderId, plan.quantity, plan.stopPrice);
    state.position!.recoveryV8 = {
        ...state.position!.recoveryV8!,
        protectionLifecycle: "FULL_HARD_STOP",
        fullHardStopClientOrderId: clientOrderId,
    };
    await input.stateStore.save(state);
    return {
        status: "APPLIED_PASS",
        apply: true,
        symbol: SYMBOL,
        positionQuantity: recovery.quantity,
        entryPrice: recovery.entryPrice,
        stopPrice: plan.stopPrice,
        quantity: plan.quantity,
        clientOrderId: placed.clientOrderId,
        backupPath,
        ordersSent: 1,
        cancelsSent: 0,
        positionChangesSent: 0,
    };
}

async function main() {
    const statePath = statePathFromEnv();
    const apply = process.argv.includes("--apply");
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: Number(process.env.ASTER_REQUEST_TIMEOUT_MS || 10_000),
        recvWindowMs: Number(process.env.ASTER_RECV_WINDOW_MS || 5_000),
        readOnlyRateLimitMaxRetries: 0,
        userAgent: `DisDex-PENGU-Recovery-Reconcile/${String(process.env.DISDEX_RELEASE_SHA || "unknown").slice(0, 12)}`,
    });
    if (!client.hasTradingCredentials()) throw new Error("PENGU_RECOVERY_V8_RECONCILE_CREDENTIALS_MISSING");
    const lock = new FileAccountOrderLock(process.env.DISDEX_ACCOUNT_LOCK_PATH || "/var/lib/disdex/shared/account-order.lock", Number(process.env.DISDEX_ACCOUNT_LOCK_LEASE_MS || 120_000));
    const handle = await lock.acquire(`pengu-recovery-v8-reconcile-${process.pid}`);
    if (!handle) throw new Error("PENGU_RECOVERY_V8_RECONCILE_ACCOUNT_LOCK_UNAVAILABLE");
    try {
        const result = await reconcileRecoveryV8Protection({
            client,
            stateStore: new FilePenguDualLsV2RunnerStateStore(statePath, "LIVE"),
            statePath,
            apply,
        });
        console.log(JSON.stringify(result));
    } finally {
        await handle.release();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch((error) => {
        console.error(JSON.stringify({
            status: "PENGU_RECOVERY_V8_RECONCILE_FAIL_CLOSED",
            message: error instanceof Error ? error.message : String(error),
            ordersSent: 0,
            cancelsSent: 0,
            positionChangesSent: 0,
        }));
        process.exitCode = 1;
    });
}
