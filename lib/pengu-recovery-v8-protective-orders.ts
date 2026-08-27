import { createHash } from "node:crypto";
import type { AsterOrderResponse, AsterV3Client } from "@/lib/aster-v3-client";
import { PENGU_RECOVERY_V8 } from "@/config/penguRecoveryV8";

export interface RecoveryV8StopOrderInput {
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    stopPrice: number;
    reduceOnly: true;
    clientOrderId: string;
    reason: "RECOVERY_V8_FULL_HARD_STOP" | "RECOVERY_V8_PARTIAL_DEFENSE" | "RECOVERY_V8_REMAINING_HARD_STOP";
}

export interface RecoveryV8ProtectiveOrder {
    symbol: string;
    clientOrderId: string;
    status: string;
    reduceOnly: boolean;
    quantity: number;
    stopPrice: number;
    executedQuantity?: number;
    averagePrice?: number;
    orderId?: number;
}

export interface RecoveryV8ProtectiveOrderGateway {
    placeStopMarket(input: RecoveryV8StopOrderInput): Promise<RecoveryV8ProtectiveOrder>;
    cancel(clientOrderId: string, symbol?: string): Promise<void>;
    getOpenOrders(symbol?: string): Promise<RecoveryV8ProtectiveOrder[]>;
    getOrder?(symbol: string, clientOrderId: string): Promise<RecoveryV8ProtectiveOrder>;
}

export interface RecoveryV8ProtectionPosition {
    symbol: string;
    entryTs: number;
    entryPrice: number;
    currentQuantity: number;
    oldHardStopClientOrderId?: string;
    nowTs: number;
}

function finitePositive(value: number, label: string) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Recovery V8 ${label} must be finite and positive.`);
}

function deterministicClientOrderId(symbol: string, entryTs: number, role: string) {
    const digest = createHash("sha256").update(`PENGU_RECOVERY_V8|${symbol}|${entryTs}|${role}`).digest("hex");
    return `recv8-${digest}`.slice(0, 36);
}

function assertAcknowledged(order: RecoveryV8ProtectiveOrder, expected: RecoveryV8StopOrderInput) {
    if (order.symbol.toUpperCase() !== expected.symbol.toUpperCase()) throw new Error("Recovery V8 protective order symbol acknowledgement mismatch.");
    if (order.clientOrderId !== expected.clientOrderId) throw new Error("Recovery V8 protective order client ID acknowledgement mismatch.");
    if (order.reduceOnly !== true) throw new Error("Recovery V8 protective order is not reduce-only.");
    if (Math.abs(order.quantity - expected.quantity) > Math.max(1e-12, expected.quantity * 1e-9)) throw new Error("Recovery V8 protective order quantity acknowledgement mismatch.");
    if (Math.abs(order.stopPrice - expected.stopPrice) > Math.max(1e-9, expected.stopPrice * 1e-9)) throw new Error("Recovery V8 protective order trigger acknowledgement mismatch.");
    if (/^(CANCELED|REJECTED|EXPIRED)$/i.test(order.status)) throw new Error(`Recovery V8 protective order is not active: ${order.status}.`);
}

export function buildRecoveryV8HardStopPlan(input: { symbol: string; entryTs: number; entryPrice: number; quantity: number }): RecoveryV8StopOrderInput {
    finitePositive(input.entryPrice, "entry price");
    finitePositive(input.quantity, "quantity");
    if (!Number.isFinite(input.entryTs)) throw new Error("Recovery V8 entry timestamp must be finite.");
    return {
        symbol: input.symbol.toUpperCase(),
        side: "SELL",
        quantity: input.quantity,
        stopPrice: input.entryPrice * (1 - PENGU_RECOVERY_V8.exit.hardStopPct),
        reduceOnly: true,
        clientOrderId: deterministicClientOrderId(input.symbol.toUpperCase(), input.entryTs, "full-hard"),
        reason: "RECOVERY_V8_FULL_HARD_STOP",
    };
}

export function buildRecoveryV8PartialStopPlan(input: { symbol: string; entryTs: number; entryPrice: number; quantity: number }): RecoveryV8StopOrderInput {
    finitePositive(input.entryPrice, "entry price");
    finitePositive(input.quantity, "partial quantity");
    return {
        symbol: input.symbol.toUpperCase(),
        side: "SELL",
        quantity: input.quantity,
        stopPrice: input.entryPrice * (1 - PENGU_RECOVERY_V8.partial.stopPct),
        reduceOnly: true,
        clientOrderId: deterministicClientOrderId(input.symbol.toUpperCase(), input.entryTs, "partial-24h"),
        reason: "RECOVERY_V8_PARTIAL_DEFENSE",
    };
}

export function buildRecoveryV8RemainingHardStopPlan(input: { symbol: string; entryTs: number; entryPrice: number; quantity: number }): RecoveryV8StopOrderInput {
    const plan = buildRecoveryV8HardStopPlan(input);
    return { ...plan, clientOrderId: deterministicClientOrderId(input.symbol.toUpperCase(), input.entryTs, "remaining-hard"), reason: "RECOVERY_V8_REMAINING_HARD_STOP" };
}

export async function placeRecoveryV8EntryHardStop(gateway: RecoveryV8ProtectiveOrderGateway, input: { symbol: string; entryTs: number; entryPrice: number; quantity: number }) {
    const plan = buildRecoveryV8HardStopPlan(input);
    const order = await gateway.placeStopMarket(plan);
    assertAcknowledged(order, plan);
    return order;
}

export async function replaceRecoveryV8Stops(gateway: RecoveryV8ProtectiveOrderGateway, input: RecoveryV8ProtectionPosition) {
    finitePositive(input.currentQuantity, "current position quantity");
    finitePositive(input.entryPrice, "entry price");
    if (!Number.isFinite(input.entryTs) || input.nowTs < input.entryTs + PENGU_RECOVERY_V8.partial.afterHours * 3_600_000) {
        throw new Error("Recovery V8 partial protection cannot be armed before the 24-hour deadline.");
    }
    if (!input.oldHardStopClientOrderId) throw new Error("Recovery V8 full hard-stop client ID is required before replacement.");
    const partialQuantity = input.currentQuantity * (PENGU_RECOVERY_V8.partial.gross / PENGU_RECOVERY_V8.initialGross);
    const remainingQuantity = input.currentQuantity - partialQuantity;
    finitePositive(partialQuantity, "partial protection quantity");
    finitePositive(remainingQuantity, "remaining hard-stop quantity");
    const common = { symbol: input.symbol.toUpperCase(), entryTs: input.entryTs, entryPrice: input.entryPrice };
    const remainingPlan = buildRecoveryV8RemainingHardStopPlan({ ...common, quantity: remainingQuantity });
    const partialPlan = buildRecoveryV8PartialStopPlan({ ...common, quantity: partialQuantity });
    let remaining: RecoveryV8ProtectiveOrder | undefined;
    let partial: RecoveryV8ProtectiveOrder | undefined;
    try {
        remaining = await gateway.placeStopMarket(remainingPlan);
        assertAcknowledged(remaining, remainingPlan);
        partial = await gateway.placeStopMarket(partialPlan);
        assertAcknowledged(partial, partialPlan);
    } catch (error) {
        if (partial) await gateway.cancel(partial.clientOrderId, input.symbol).catch(() => undefined);
        if (remaining) await gateway.cancel(remaining.clientOrderId, input.symbol).catch(() => undefined);
        throw error;
    }
    try {
        // The old full stop is cancelled only after both replacement orders
        // have been acknowledged. This prevents an unprotected gap.
        await gateway.cancel(input.oldHardStopClientOrderId, input.symbol);
    } catch (error) {
        await gateway.cancel(partial.clientOrderId, input.symbol).catch(() => undefined);
        await gateway.cancel(remaining.clientOrderId, input.symbol).catch(() => undefined);
        throw new Error(`Recovery V8 protective replacement failed; old full hard stop was retained: ${error instanceof Error ? error.message : String(error)}`);
    }
    const openOrders = await gateway.getOpenOrders(input.symbol);
    const matching = openOrders.filter((order) => [partial!.clientOrderId, remaining!.clientOrderId].includes(order.clientOrderId));
    if (matching.length !== 2 || matching.some((order) => order.reduceOnly !== true || !/^(NEW|PARTIALLY_FILLED)$/i.test(order.status)) || Math.abs(matching.reduce((sum, order) => sum + order.quantity, 0) - input.currentQuantity) > Math.max(1e-12, input.currentQuantity * 1e-9)) {
        throw new Error("Recovery V8 protective replacement quantity reconciliation failed.");
    }
    return { partial, remainingHard: remaining, oldHardStopClientOrderId: input.oldHardStopClientOrderId, quantity: input.currentQuantity };
}

function fromAster(row: AsterOrderResponse): RecoveryV8ProtectiveOrder {
    const stopPrice = Number((row as AsterOrderResponse & { stopPrice?: string }).stopPrice);
    return {
        symbol: row.symbol.toUpperCase(),
        clientOrderId: String(row.clientOrderId || ""),
        status: String(row.status || "UNKNOWN"),
        reduceOnly: row.reduceOnly === true,
        quantity: Number(row.origQty || 0),
        stopPrice,
        executedQuantity: Number(row.executedQty || 0),
        averagePrice: Number(row.avgPrice || 0),
        orderId: row.orderId,
    };
}

export class AsterRecoveryV8ProtectiveOrderGateway implements RecoveryV8ProtectiveOrderGateway {
    constructor(private readonly client: AsterV3Client) {}

    async placeStopMarket(input: RecoveryV8StopOrderInput) {
        return fromAster(await this.client.placeStopMarketOrder({
            symbol: input.symbol,
            side: input.side,
            quantity: String(input.quantity),
            stopPrice: String(input.stopPrice),
            positionSide: "BOTH",
            reduceOnly: true,
            newClientOrderId: input.clientOrderId,
            newOrderRespType: "RESULT",
        }));
    }

    async cancel(clientOrderId: string, symbol = PENGU_RECOVERY_V8.symbol) {
        await this.client.cancelOrder(symbol, clientOrderId);
    }

    async getOpenOrders(symbol = PENGU_RECOVERY_V8.symbol) {
        return (await this.client.getOpenOrders(symbol)).map(fromAster);
    }

    async getOrder(symbol: string, clientOrderId: string) {
        return fromAster(await this.client.getOrder(symbol, clientOrderId));
    }
}
