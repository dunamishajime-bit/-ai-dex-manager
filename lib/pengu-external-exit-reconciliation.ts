import type { PenguDualLsV2RunnerState } from "@/lib/pengu-dual-ls-v2-runner-state";
import { cooldownHoursForPenguExit } from "@/lib/pengu-dual-ls-v2";
import { recordPenguClosedTrade, recordPenguHardStop } from "@/lib/pengu-route-quarantine-dd-governor";

const SYMBOL = "PENGUUSDT";
const EPSILON = 1e-9;

export interface PenguExternalExitOrderEvidence {
    symbol: string;
    orderId?: number | string;
    clientOrderId: string;
    status?: string;
    type?: string;
    side?: string;
    origQty?: number;
    executedQty?: number;
    avgPrice?: number;
    reduceOnly?: boolean;
    stopPrice?: number;
    updateTime?: number;
}

export interface PenguExternalExitTradeEvidence {
    orderId?: number | string;
    symbol?: string;
    side?: string;
    quantity: number;
    price: number;
    time: number;
    realizedPnl?: number;
}

export interface PenguExternalExitReconciliationInput {
    state: PenguDualLsV2RunnerState;
    currentPosition?: { symbol?: string; quantity?: number };
    symbolOpenOrders: readonly { clientOrderId?: string }[];
    order?: PenguExternalExitOrderEvidence;
    trades: readonly PenguExternalExitTradeEvidence[];
    now: number;
}

export interface PenguExternalExitReconciliationExit {
    route: "RECOVERY_V8";
    orderId?: number | string;
    clientOrderId: string;
    executedQuantity: number;
    averagePrice: number;
    exitTs: number;
    realizedPnl: number;
}

export type PenguExternalExitReconciliationResult =
    | {
        ok: true;
        state: PenguDualLsV2RunnerState;
        exit: PenguExternalExitReconciliationExit;
        ordersSent: 0;
        cancelsSent: 0;
        positionChangesSent: 0;
    }
    | { ok: false; reason: string };

function finite(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function equalWithin(actual: number | undefined, expected: number, relative = 0.01): boolean {
    return actual !== undefined && Math.abs(actual - expected) <= Math.max(EPSILON, Math.abs(expected) * relative);
}

function reject(reason: string): PenguExternalExitReconciliationResult {
    return { ok: false, reason };
}

/**
 * Proves that a Recovery V8 position disappeared because its own reduce-only
 * hard-stop order filled. This is deliberately read-only: it never calls an
 * order or cancellation endpoint. Without the exact venue proof the caller
 * must keep the existing manual-review fail-closed state.
 */
export function reconcileExternallyClosedRecoveryV8Position(
    input: PenguExternalExitReconciliationInput,
): PenguExternalExitReconciliationResult {
    const position = input.state.position;
    if (!position) return reject("PENGU_EXTERNAL_EXIT_NO_DURABLE_POSITION");
    if (input.state.pending) return reject("PENGU_EXTERNAL_EXIT_PENDING_STATE_PRESENT");
    if (position.entryVersion !== "RECOVERY_V8" || !position.recoveryV8) return reject("PENGU_EXTERNAL_EXIT_UNSUPPORTED_POSITION_ROUTE");
    if (position.recoveryV8.protectionLifecycle !== "FULL_HARD_STOP") return reject("PENGU_EXTERNAL_EXIT_PROTECTION_LIFECYCLE_NOT_FULL_HARD_STOP");
    if (input.currentPosition) return reject("PENGU_EXTERNAL_EXIT_POSITION_STILL_PRESENT");
    if (input.symbolOpenOrders.length > 0) return reject("PENGU_EXTERNAL_EXIT_OPEN_ORDER_PRESENT");
    const expectedClientOrderId = position.recoveryV8.fullHardStopClientOrderId;
    if (!expectedClientOrderId) return reject("PENGU_EXTERNAL_EXIT_HARD_STOP_CLIENT_ORDER_MISSING");
    const order = input.order;
    if (!order) return reject("PENGU_EXTERNAL_EXIT_ORDER_PROOF_MISSING");
    if (String(order.symbol || "").toUpperCase() !== SYMBOL) return reject("PENGU_EXTERNAL_EXIT_ORDER_SYMBOL_MISMATCH");
    if (order.clientOrderId !== expectedClientOrderId) return reject("PENGU_EXTERNAL_EXIT_ORDER_CLIENT_ID_MISMATCH");
    if (String(order.status || "").toUpperCase() !== "FILLED") return reject("PENGU_EXTERNAL_EXIT_ORDER_NOT_FILLED");
    if (order.reduceOnly !== true) return reject("PENGU_EXTERNAL_EXIT_ORDER_NOT_REDUCE_ONLY");
    if (String(order.side || "").toUpperCase() !== "SELL") return reject("PENGU_EXTERNAL_EXIT_ORDER_SIDE_MISMATCH");
    if (!["MARKET", "STOP_MARKET", "TAKE_PROFIT_MARKET"].includes(String(order.type || "").toUpperCase())) return reject("PENGU_EXTERNAL_EXIT_ORDER_TYPE_INVALID");
    const executedQuantity = finite(order.executedQty);
    const averagePrice = finite(order.avgPrice);
    const orderUpdateTs = finite(order.updateTime);
    if (executedQuantity === undefined || !equalWithin(executedQuantity, position.quantity) || !equalWithin(finite(order.origQty), position.quantity)) return reject("PENGU_EXTERNAL_EXIT_ORDER_QUANTITY_MISMATCH");
    if (averagePrice === undefined || !(averagePrice > 0)) return reject("PENGU_EXTERNAL_EXIT_ORDER_AVERAGE_PRICE_INVALID");
    if (orderUpdateTs === undefined || !(orderUpdateTs >= position.entryTs)) return reject("PENGU_EXTERNAL_EXIT_ORDER_TIME_INVALID");
    if (!(finite(order.stopPrice) && Number(order.stopPrice) > 0)) return reject("PENGU_EXTERNAL_EXIT_STOP_PRICE_PROOF_MISSING");

    const orderId = order.orderId === undefined ? undefined : String(order.orderId);
    const matchingTrades = input.trades.filter((trade) => {
        const tradeOrderId = trade.orderId === undefined ? undefined : String(trade.orderId);
        return tradeOrderId !== undefined && orderId !== undefined
            && tradeOrderId === orderId
            && String(trade.symbol || "").toUpperCase() === SYMBOL
            && String(trade.side || "").toUpperCase() === "SELL"
            && Number.isFinite(trade.time)
            && trade.time >= position.entryTs;
    });
    if (!matchingTrades.length) return reject("PENGU_EXTERNAL_EXIT_OFFICIAL_TRADE_PROOF_MISSING");
    const tradedQuantity = matchingTrades.reduce((sum, trade) => sum + (finite(trade.quantity) || 0), 0);
    if (!equalWithin(tradedQuantity, executedQuantity)) return reject("PENGU_EXTERNAL_EXIT_TRADE_QUANTITY_MISMATCH");
    if (matchingTrades.some((trade) => !(finite(trade.price) && Number(trade.price) > 0))) return reject("PENGU_EXTERNAL_EXIT_TRADE_PRICE_INVALID");
    const weightedExitPrice = matchingTrades.reduce((sum, trade) => sum + Number(trade.price) * Number(trade.quantity), 0) / tradedQuantity;
    if (!equalWithin(weightedExitPrice, averagePrice, 1e-5)) return reject("PENGU_EXTERNAL_EXIT_TRADE_PRICE_MISMATCH");
    const realizedPnl = matchingTrades.reduce((sum, trade) => sum + (finite(trade.realizedPnl) || 0), 0);
    const exitTs = Math.max(orderUpdateTs, ...matchingTrades.map((trade) => trade.time));

    const route = "RECOVERY_V8" as const;
    const directionalReturn = averagePrice / position.entryPrice - 1;
    const accountReturn = position.gross * (directionalReturn - 2 * 0.0006);
    const nextState: PenguDualLsV2RunnerState = structuredClone(input.state);
    nextState.riskOverlay = recordPenguClosedTrade(nextState.riskOverlay, route, accountReturn, exitTs);
    nextState.riskOverlay = recordPenguHardStop(nextState.riskOverlay, route, exitTs);
    nextState.position = undefined;
    nextState.cooldownUntilTs = Math.max(nextState.cooldownUntilTs || 0, exitTs + cooldownHoursForPenguExit("RECOVERY_V8_HARD_STOP") * 3_600_000);
    nextState.updatedAt = input.now;
    nextState.lastExternalExitReconciliation = {
        source: "aster-official-order-and-userTrades",
        route,
        reconciledAt: input.now,
        exitTs,
        orderId: order.orderId,
        clientOrderId: order.clientOrderId,
        executedQuantity,
        averagePrice,
        realizedPnl,
    };
    return {
        ok: true,
        state: nextState,
        exit: { route, orderId: order.orderId, clientOrderId: order.clientOrderId, executedQuantity, averagePrice, exitTs, realizedPnl },
        ordersSent: 0,
        cancelsSent: 0,
        positionChangesSent: 0,
    };
}
