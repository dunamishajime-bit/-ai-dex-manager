import { createHash } from "node:crypto";
import type { AsterExchangeSymbol, AsterOrderResponse, AsterV3Client } from "@/lib/aster-v3-client";
import { PENGU_RECOVERY_V8 } from "@/config/penguRecoveryV8";
import { buildTradeFillNotificationEvent, enqueueTradeFillNotification, isConfirmedTradeFill } from "@/lib/trade-fill-notification";

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
    side?: "BUY" | "SELL";
    updatedAt?: number;
    venueNormalizedStopPrice?: number;
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

function decimalPlaces(value: string): number {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || normalized.includes("e")) {
        const numeric = Number(normalized);
        if (!Number.isFinite(numeric) || numeric <= 0) return 0;
        return Math.min(12, Math.max(0, (numeric.toString().split(".")[1] || "").length));
    }
    return Math.min(12, Math.max(0, (normalized.split(".")[1] || "").replace(/0+$/, "").length));
}

/**
 * Aster validates conditional-order values against symbol filters, not only
 * against pricePrecision/quantityPrecision. Keep this fail-closed and round
 * down to the venue increment so a protective stop is never rejected for an
 * extra decimal place.
 */
export function normalizeRecoveryV8OrderValue(value: number, incrementText: string, precision = 0): string {
    finitePositive(value, "order value");
    const increment = Number(incrementText);
    if (!Number.isFinite(increment) || increment <= 0) throw new Error("Recovery V8 venue increment is invalid.");
    const decimals = Math.min(12, Math.max(decimalPlaces(incrementText), Math.floor(Number(precision) || 0)));
    const scale = 10 ** decimals;
    const incrementUnits = Math.max(1, Math.round(increment * scale));
    const valueUnits = Math.floor((value * scale + Number.EPSILON * scale) / incrementUnits) * incrementUnits;
    if (!Number.isFinite(valueUnits) || valueUnits <= 0) throw new Error("Recovery V8 order value is below the venue increment.");
    return (valueUnits / scale).toFixed(decimals).replace(/\.?(0+)$/, "");
}

function recoveryV8VenueSymbol(info: { symbols?: AsterExchangeSymbol[] }, symbol: string): AsterExchangeSymbol {
    const row = (info.symbols || []).find((item) => item.symbol.toUpperCase() === symbol.toUpperCase());
    if (!row) throw new Error(`Recovery V8 venue symbol metadata is unavailable: ${symbol}`);
    return row;
}

async function normalizeRecoveryV8OrderInput(client: AsterV3Client, input: RecoveryV8StopOrderInput): Promise<RecoveryV8StopOrderInput> {
    const symbol = recoveryV8VenueSymbol(await client.getExchangeInfo(), input.symbol);
    const priceFilter = rowFilter(symbol, "PRICE_FILTER");
    const quantityFilter = rowFilter(symbol, "LOT_SIZE") || rowFilter(symbol, "MARKET_LOT_SIZE");
    if (!priceFilter?.tickSize || !quantityFilter?.stepSize) throw new Error(`Recovery V8 venue filters are incomplete: ${input.symbol}`);
    return {
        ...input,
        quantity: Number(normalizeRecoveryV8OrderValue(input.quantity, quantityFilter.stepSize, symbol.quantityPrecision ?? 0)),
        stopPrice: Number(normalizeRecoveryV8OrderValue(input.stopPrice, priceFilter.tickSize, symbol.pricePrecision ?? 0)),
    };
}

function rowFilter(symbol: AsterExchangeSymbol, filterType: string) {
    return symbol.filters?.find((filter) => filter.filterType === filterType);
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
    if (order.venueNormalizedStopPrice === undefined && Math.abs(order.stopPrice - expected.stopPrice) > Math.max(1e-9, expected.stopPrice * 1e-9)) throw new Error("Recovery V8 protective order trigger acknowledgement mismatch.");
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
        side: row.side,
        updatedAt: Number(row.updateTime || 0) || undefined,
    };
}

async function notifyRecoveryV8Fill(order: RecoveryV8ProtectiveOrder): Promise<void> {
    if (!order.side || !isConfirmedTradeFill({
        symbol: order.symbol,
        clientOrderId: order.clientOrderId,
        side: order.side,
        status: order.status,
        executedQuantity: order.executedQuantity,
    })) return;
    try {
        await enqueueTradeFillNotification(buildTradeFillNotificationEvent({
            requestId: order.clientOrderId,
            clientOrderId: order.clientOrderId,
            symbol: order.symbol,
            side: order.side,
            status: order.status,
            reduceOnly: true,
            executedQuantity: order.executedQuantity,
            averagePrice: order.averagePrice,
            quoteQuantity: order.averagePrice && order.executedQuantity ? order.averagePrice * order.executedQuantity : 0,
            orderId: order.orderId,
            updatedAt: order.updatedAt,
        }, {
            env: process.env,
            strategyId: "PENGU_DUAL_LS_V2_FINAL",
            eventType: "EXIT_FILL",
            reduceOnly: true,
            reason: "PENGU_RECOVERY_V8_PROTECTIVE_FILL_RECONCILED",
        }), process.env);
    } catch (error) {
        console.warn("[TradeFillNotification] PENGU Recovery V8 protection enqueue failed", error instanceof Error ? error.message : String(error));
    }
}

export class AsterRecoveryV8ProtectiveOrderGateway implements RecoveryV8ProtectiveOrderGateway {
    constructor(private readonly client: AsterV3Client) {}

    async placeStopMarket(input: RecoveryV8StopOrderInput) {
        const normalized = await normalizeRecoveryV8OrderInput(this.client, input);
        const acknowledged = fromAster(await this.client.placeStopMarketOrder({
            symbol: normalized.symbol,
            side: normalized.side,
            quantity: String(normalized.quantity),
            stopPrice: String(normalized.stopPrice),
            positionSide: "BOTH",
            reduceOnly: true,
            newClientOrderId: normalized.clientOrderId,
            newOrderRespType: "RESULT",
        }));
        if (Math.abs(acknowledged.quantity - normalized.quantity) > Math.max(1e-12, normalized.quantity * 1e-9)) {
            throw new Error("Recovery V8 venue acknowledged an unexpected protective quantity.");
        }
        if (Math.abs(acknowledged.stopPrice - normalized.stopPrice) > Math.max(1e-12, normalized.stopPrice * 1e-9)) {
            throw new Error("Recovery V8 venue acknowledged an unexpected protective trigger.");
        }
        // The public gateway contract is expressed in the venue-normalized
        // values so the caller's acknowledgement check does not reject a
        // valid tick-size truncation as an execution failure.
        const order = { ...acknowledged, quantity: normalized.quantity, stopPrice: normalized.stopPrice, venueNormalizedStopPrice: normalized.stopPrice };
        await notifyRecoveryV8Fill(order);
        return order;
    }

    async cancel(clientOrderId: string, symbol = PENGU_RECOVERY_V8.symbol) {
        await this.client.cancelOrder(symbol, clientOrderId);
    }

    async getOpenOrders(symbol = PENGU_RECOVERY_V8.symbol) {
        const orders = (await this.client.getOpenOrders(symbol)).map(fromAster);
        await Promise.all(orders.map((order) => notifyRecoveryV8Fill(order)));
        return orders;
    }

    async getOrder(symbol: string, clientOrderId: string) {
        const order = fromAster(await this.client.getOrder(symbol, clientOrderId));
        await notifyRecoveryV8Fill(order);
        return order;
    }
}
