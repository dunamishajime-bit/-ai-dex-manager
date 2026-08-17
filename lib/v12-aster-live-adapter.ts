import { createHash } from "node:crypto";

import {
    AsterApiError,
    AsterV3Client,
    type AsterOrderResponse,
    type AsterOrderSide,
} from "@/lib/aster-v3-client";
import {
    AsterDirectTradeExecutor,
    type DirectOpenOrder,
    type DirectPosition,
    type DirectTradeResult,
} from "@/lib/direct-trade-executor";
import type { ResidentStopAdapter } from "@/lib/v12-resident-stop-lifecycle";

export const V12_CLIENT_ORDER_PREFIX = "v12-" as const;

export interface V12AsterOrderView {
    symbol: string;
    clientOrderId: string;
    orderId?: number;
    status: string;
    side?: AsterOrderSide;
    type?: string;
    reduceOnly?: boolean;
    quantity: number;
    executedQuantity: number;
    stopPrice?: number;
}

export interface V12AsterLiveAdapterOptions {
    maxSlippageBps?: number;
    reconciliationAttempts?: number;
    reconciliationDelayMs?: number;
}

type InternalRequest = <T>(input: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    params?: Record<string, unknown>;
    signed?: boolean;
    orderMutation?: boolean;
}) => Promise<T>;

function finite(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function sleep(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

export function deterministicV12ClientOrderId(input: {
    action: "ENTRY" | "EXIT" | "STOP" | "TP" | "TRAIL" | "FAILSAFE_CLOSE";
    signalTs: number;
    symbol: string;
    side: string;
    version?: string | number;
}) {
    const seed = ["V12_X1.00_ALL", input.action, input.signalTs, input.symbol.toUpperCase(), input.side.toUpperCase(), input.version ?? 0].join("|");
    const digest = createHash("sha256").update(seed).digest("hex").slice(0, 22);
    return `${V12_CLIENT_ORDER_PREFIX}${input.action.toLowerCase().slice(0, 5)}-${digest}`.slice(0, 36);
}

function normalizeOrder(raw: AsterOrderResponse & { stopPrice?: string | number }): V12AsterOrderView {
    return {
        symbol: String(raw.symbol || "").toUpperCase(),
        clientOrderId: String(raw.clientOrderId || ""),
        orderId: raw.orderId,
        status: String(raw.status || "UNKNOWN").toUpperCase(),
        side: raw.side,
        type: raw.type,
        reduceOnly: raw.reduceOnly,
        quantity: finite(raw.origQty),
        executedQuantity: finite(raw.executedQty),
        stopPrice: finite(raw.stopPrice) || undefined,
    };
}

function activeStatus(status: string) {
    return ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(status.toUpperCase());
}

/**
 * V12-specific execution adapter. Entry/exit MARKET orders reuse the existing
 * AsterDirectTradeExecutor, including quantity filters, minimum notional,
 * slippage guard and UNKNOWN reconciliation. Conditional protection uses the
 * same authenticated Aster client and never resubmits an uncertain mutation.
 */
export class V12AsterLiveAdapter implements ResidentStopAdapter {
    readonly executor: AsterDirectTradeExecutor;
    private readonly maxSlippageBps: number;
    private readonly reconciliationAttempts: number;
    private readonly reconciliationDelayMs: number;

    constructor(readonly client: AsterV3Client, options: V12AsterLiveAdapterOptions = {}) {
        this.maxSlippageBps = Math.max(0, options.maxSlippageBps ?? 20);
        this.reconciliationAttempts = Math.max(1, options.reconciliationAttempts ?? 6);
        this.reconciliationDelayMs = Math.max(100, options.reconciliationDelayMs ?? 1000);
        this.executor = new AsterDirectTradeExecutor(client, {
            reconciliationAttempts: this.reconciliationAttempts,
            reconciliationDelayMs: this.reconciliationDelayMs,
        });
    }

    private internalRequest<T>(input: Parameters<InternalRequest>[0]) {
        // AsterV3Client's signed request primitive is intentionally not public.
        // This narrow bridge keeps V12 on the exact same signer/nonce/recvWindow
        // implementation without introducing a second signing implementation.
        const request = (this.client as unknown as { request: InternalRequest }).request.bind(this.client);
        return request<T>(input);
    }

    async credentialsReady() {
        if (!this.client.hasTradingCredentials()) return false;
        await Promise.all([this.client.ping(), this.client.getBalances(), this.client.getPositions(), this.client.getOpenOrders()]);
        return true;
    }

    getPositions(): Promise<DirectPosition[]> { return this.executor.getPositions(); }
    getOpenOrders(): Promise<DirectOpenOrder[]> { return this.executor.getOpenOrders(); }
    getAccountSnapshot() { return this.executor.getAccountSnapshot(); }

    async normalizeStopPrice(symbol: string, requested: number) {
        if (!(requested > 0)) throw new Error("V12_STOP_PRICE_INVALID");
        const info = await this.client.getExchangeInfo();
        const row = info.symbols.find((item) => item.symbol === symbol.toUpperCase());
        if (!row || row.status !== "TRADING") throw new Error(`V12_SYMBOL_NOT_TRADING:${symbol}`);
        const filter = row.filters?.find((item) => item.filterType === "PRICE_FILTER");
        const tick = finite(filter?.tickSize);
        if (!(tick > 0)) throw new Error(`V12_PRICE_FILTER_MISSING:${symbol}`);
        const precision = Math.min(12, String(filter?.tickSize || "").split(".")[1]?.replace(/0+$/, "").length || 0);
        const ticks = Math.round(requested / tick);
        const price = ticks * tick;
        if (!(price > 0)) throw new Error("V12_STOP_PRICE_NORMALIZATION_FAILED");
        return { price, text: price.toFixed(precision) };
    }

    async executeEntry(input: {
        signalTs: number;
        symbol: string;
        side: "LONG" | "SHORT";
        quantity: number;
        expectedPrice: number;
        clientOrderId?: string;
    }): Promise<DirectTradeResult> {
        const clientOrderId = input.clientOrderId || deterministicV12ClientOrderId({ action: "ENTRY", signalTs: input.signalTs, symbol: input.symbol, side: input.side });
        return this.executor.executeMarket({
            requestId: clientOrderId,
            clientOrderId,
            symbol: input.symbol,
            side: input.side === "LONG" ? "BUY" : "SELL",
            quantity: input.quantity,
            expectedPrice: input.expectedPrice,
            maxSlippageBps: this.maxSlippageBps,
            reason: "V12_X1.00_ALL_ENTRY",
        });
    }

    async executeExit(input: {
        signalTs: number;
        symbol: string;
        positionSide: "LONG" | "SHORT";
        quantity: number;
        expectedPrice: number;
        clientOrderId?: string;
        failsafe?: boolean;
    }): Promise<DirectTradeResult> {
        const action = input.failsafe ? "FAILSAFE_CLOSE" : "EXIT";
        const clientOrderId = input.clientOrderId || deterministicV12ClientOrderId({ action, signalTs: input.signalTs, symbol: input.symbol, side: input.positionSide });
        return this.executor.executeMarket({
            requestId: clientOrderId,
            clientOrderId,
            symbol: input.symbol,
            side: input.positionSide === "LONG" ? "SELL" : "BUY",
            quantity: input.quantity,
            reduceOnly: true,
            expectedPrice: input.expectedPrice,
            maxSlippageBps: this.maxSlippageBps,
            reason: input.failsafe ? "V12_PROTECTION_FAILSAFE_CLOSE" : "V12_X1.00_ALL_EXIT",
        });
    }

    async reconcileOrder(symbol: string, clientOrderId: string) {
        return this.executor.reconcileOrder(symbol, clientOrderId);
    }

    private async placeConditional(input: {
        symbol: string;
        side: "BUY" | "SELL";
        quantity: number;
        stopPrice: number;
        clientOrderId: string;
        type: "STOP_MARKET" | "TAKE_PROFIT_MARKET";
    }) {
        const symbol = input.symbol.toUpperCase();
        const quote = await this.executor.getMarketQuote(symbol);
        const normalizedQty = await this.executor.normalizeMarketQuantity(symbol, input.quantity, quote.midPrice, { allowBelowMinNotional: true });
        const normalizedStop = await this.normalizeStopPrice(symbol, input.stopPrice);
        try {
            const raw = await this.internalRequest<AsterOrderResponse & { stopPrice?: string }>({
                method: "POST",
                path: "/fapi/v3/order",
                params: {
                    symbol,
                    side: input.side,
                    type: input.type,
                    quantity: normalizedQty.quantityText,
                    stopPrice: normalizedStop.text,
                    positionSide: "BOTH",
                    reduceOnly: "true",
                    newClientOrderId: input.clientOrderId,
                    newOrderRespType: "RESULT",
                    workingType: "MARK_PRICE",
                },
                signed: true,
                orderMutation: true,
            });
            const view = normalizeOrder(raw);
            if (view.clientOrderId !== input.clientOrderId || view.symbol !== symbol || view.side !== input.side || String(view.type || "").toUpperCase() !== input.type) {
                throw new Error("V12_PROTECTION_ACK_MISMATCH");
            }
            return view;
        } catch (error) {
            if (!(error instanceof AsterApiError) || !error.executionUnknown) throw error;
            const reconciled = await this.queryOrderSameId(symbol, input.clientOrderId);
            if (!reconciled) throw new Error(`V12_PROTECTION_UNKNOWN_UNRESOLVED:${input.clientOrderId}`);
            return reconciled;
        }
    }

    async queryOrderSameId(symbol: string, clientOrderId: string): Promise<V12AsterOrderView | null> {
        for (let attempt = 0; attempt < this.reconciliationAttempts; attempt += 1) {
            if (attempt) await sleep(this.reconciliationDelayMs * attempt);
            try {
                return normalizeOrder(await this.client.getOrder(symbol.toUpperCase(), clientOrderId) as AsterOrderResponse & { stopPrice?: string });
            } catch (error) {
                if (error instanceof AsterApiError && (error.status === 418 || error.status === 429)) continue;
                if (attempt + 1 >= this.reconciliationAttempts) return null;
            }
        }
        return null;
    }

    async placeStopMarket(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; stopPrice: number; clientOrderId: string; reduceOnly: true }) {
        const order = await this.placeConditional({ ...input, type: "STOP_MARKET" });
        const acknowledged = order.reduceOnly === true && (activeStatus(order.status) || order.status === "FILLED") && Math.abs((order.stopPrice || input.stopPrice) - (await this.normalizeStopPrice(input.symbol, input.stopPrice)).price) < 1e-9;
        return { acknowledged, orderId: order.orderId != null ? String(order.orderId) : undefined };
    }

    async placeTakeProfit(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; stopPrice: number; clientOrderId: string; reduceOnly: true }) {
        const order = await this.placeConditional({ ...input, type: "TAKE_PROFIT_MARKET" });
        return { acknowledged: order.reduceOnly === true && (activeStatus(order.status) || order.status === "FILLED"), orderId: order.orderId != null ? String(order.orderId) : undefined };
    }

    async cancel(clientOrderId: string) {
        const open = await this.executor.getOpenOrders();
        const row = open.find((item) => item.clientOrderId === clientOrderId);
        if (!row) return;
        try {
            await this.internalRequest<AsterOrderResponse>({
                method: "DELETE",
                path: "/fapi/v3/order",
                params: { symbol: row.symbol, origClientOrderId: clientOrderId },
                signed: true,
                orderMutation: true,
            });
        } catch (error) {
            if (!(error instanceof AsterApiError) || !error.executionUnknown) throw error;
        }
        const check = await this.queryOrderSameId(row.symbol, clientOrderId);
        if (check && activeStatus(check.status)) throw new Error(`V12_CANCEL_NOT_CONFIRMED:${clientOrderId}`);
    }

    async flattenReduceOnly(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; clientOrderId: string }) {
        const quote = await this.executor.getMarketQuote(input.symbol);
        const result = await this.executor.executeMarket({
            requestId: input.clientOrderId,
            clientOrderId: input.clientOrderId,
            symbol: input.symbol,
            side: input.side,
            quantity: input.quantity,
            reduceOnly: true,
            expectedPrice: input.side === "BUY" ? quote.askPrice : quote.bidPrice,
            maxSlippageBps: this.maxSlippageBps,
            reason: "V12_PROTECTION_FAILSAFE_CLOSE",
        });
        if (result.status === "UNKNOWN") throw new Error(`V12_FAILSAFE_CLOSE_UNKNOWN:${input.clientOrderId}`);
        const positions = await this.executor.getPositions();
        if (positions.some((position) => position.symbol === input.symbol.toUpperCase() && Math.abs(position.quantity) > 1e-12)) {
            throw new Error(`V12_FAILSAFE_CLOSE_POSITION_REMAINS:${input.symbol}`);
        }
    }

    async openOrders(symbol: string) {
        const orders = await this.client.getOpenOrders(symbol.toUpperCase());
        return orders.map((order) => ({
            clientOrderId: String(order.clientOrderId || ""),
            stopPrice: finite((order as AsterOrderResponse & { stopPrice?: string }).stopPrice) || undefined,
            status: order.status,
        }));
    }

    async listV12Orders(symbol?: string) {
        const rows = await this.client.getOpenOrders(symbol?.toUpperCase());
        return rows.map((row) => normalizeOrder(row as AsterOrderResponse & { stopPrice?: string })).filter((row) => row.clientOrderId.startsWith(V12_CLIENT_ORDER_PREFIX));
    }
}
