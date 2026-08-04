import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
    AsterApiError,
    AsterV3Client,
    type AsterBookTicker,
    type AsterExchangeInfo,
    type AsterExchangeSymbol,
    type AsterOrderResponse,
    type AsterOrderSide,
    type AsterPositionRiskRow,
    type AsterPositionSide,
} from "@/lib/aster-v3-client";

const execFileAsync = promisify(execFile);

export type DirectTradeStatus = "FILLED" | "PARTIALLY_FILLED" | "NEW" | "REJECTED" | "CANCELED" | "EXPIRED" | "UNKNOWN";

export interface DirectTradeCommand {
    requestId: string;
    clientOrderId: string;
    symbol: string;
    side: AsterOrderSide;
    quantity: number;
    positionSide?: AsterPositionSide;
    reduceOnly?: boolean;
    expectedPrice: number;
    maxSlippageBps: number;
    reason: string;
}

export interface DirectTradeResult {
    requestId: string;
    clientOrderId: string;
    symbol: string;
    side: AsterOrderSide;
    status: DirectTradeStatus;
    requestedQuantity: number;
    submittedQuantity: number;
    executedQuantity: number;
    averagePrice: number;
    quoteQuantity: number;
    orderId?: number;
    executionUnknown: boolean;
    reconciled: boolean;
    raw?: AsterOrderResponse;
    error?: string;
}

export interface DirectAccountSnapshot {
    availableBalance: number;
    walletBalance: number;
    asset: string;
    updatedAt: number;
}

export interface DirectPosition {
    symbol: string;
    quantity: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnl: number;
    pnlPct: number;
    notionalUsd: number;
    positionSide: AsterPositionSide;
    leverage: number;
    updatedAt: number;
}

export interface DirectOpenOrder {
    symbol: string;
    clientOrderId: string;
    side?: AsterOrderSide;
    status?: string;
    reduceOnly?: boolean;
    quantity: number;
    executedQuantity: number;
}

export interface DirectMarketQuote {
    symbol: string;
    bidPrice: number;
    askPrice: number;
    bidQuantity: number;
    askQuantity: number;
    midPrice: number;
    spreadBps: number;
    updatedAt: number;
}

export interface NormalizedOrderQuantity {
    symbol: string;
    quantity: number;
    quantityText: string;
    minQuantity: number;
    maxQuantity: number;
    stepSize: number;
    minNotional: number;
    notional: number;
}

export interface DirectTradeExecutor {
    getAccountSnapshot(): Promise<DirectAccountSnapshot>;
    getPositions(): Promise<DirectPosition[]>;
    getOpenOrders(): Promise<DirectOpenOrder[]>;
    getMarketQuote(symbol: string): Promise<DirectMarketQuote>;
    normalizeMarketQuantity(symbol: string, requestedQuantity: number, referencePrice: number, options?: { allowBelowMinNotional?: boolean }): Promise<NormalizedOrderQuantity>;
    executeMarket(command: DirectTradeCommand): Promise<DirectTradeResult>;
    reconcileOrder(symbol: string, clientOrderId: string): Promise<DirectTradeResult>;
}

export interface AsterDirectTradeExecutorOptions {
    quoteAsset?: string;
    exchangeInfoTtlMs?: number;
    reconciliationAttempts?: number;
    reconciliationDelayMs?: number;
}

function safeNumber(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function boolEnvironment(name: string, fallback = false) {
    const value = process.env[name];
    if (value === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(value.trim());
}

async function runFreshMarginGuardBeforeExposureOrder() {
    if (!boolEnvironment("DISDEX_V96_V52_PREORDER_MARGIN_GUARD_ENABLED", false)) return;
    const python = process.env.DISDEX_PYTHON_BIN || "python3";
    const script = process.env.DISDEX_V96_V52_MARGIN_GUARD_SCRIPT
        || "scripts/disdex_v96_v52_margin_guard.py";
    try {
        const result = await execFileAsync(
            python,
            [script, "--mode", "live", "--preorder-check"],
            {
                cwd: process.cwd(),
                env: process.env,
                timeout: 30_000,
                maxBuffer: 1024 * 1024,
            },
        );
        const output = `${result.stdout || ""}\n${result.stderr || ""}`;
        if (!/"stage":"HEALTHY"/.test(output) && !/"stage":\s*"HEALTHY"/.test(output)) {
            throw new Error("Margin Guard did not return a HEALTHY order-time result.");
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Fresh V96/V52 pre-order Margin Guard blocked exposure increase: ${message}`);
    }
}

function asArray<T>(value: T | T[]): T[] {
    return Array.isArray(value) ? value : [value];
}

function decimalPlaces(value: number) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    const text = value.toString().toLowerCase();
    if (text.includes("e-")) return Number(text.split("e-")[1] || 0);
    return text.includes(".") ? text.split(".")[1].length : 0;
}

function floorToStep(value: number, step: number) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (!Number.isFinite(step) || step <= 0) return value;
    const scale = 10 ** Math.min(12, decimalPlaces(step));
    const integerValue = Math.floor((value * scale) + 1e-9);
    const integerStep = Math.max(1, Math.round(step * scale));
    return Math.floor(integerValue / integerStep) * integerStep / scale;
}

function orderStatus(value?: string): DirectTradeStatus {
    switch (String(value || "").toUpperCase()) {
        case "FILLED": return "FILLED";
        case "PARTIALLY_FILLED": return "PARTIALLY_FILLED";
        case "NEW": return "NEW";
        case "REJECTED": return "REJECTED";
        case "CANCELED": return "CANCELED";
        case "EXPIRED": return "EXPIRED";
        default: return "UNKNOWN";
    }
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function sanitizeClientOrderId(value: string) {
    const sanitized = value.replace(/[^.A-Z:/a-z0-9_-]/g, "-").slice(0, 36);
    if (!sanitized) throw new Error("clientOrderId is empty after sanitization.");
    return sanitized;
}

export class AsterDirectTradeExecutor implements DirectTradeExecutor {
    private readonly quoteAsset: string;
    private readonly exchangeInfoTtlMs: number;
    private readonly reconciliationAttempts: number;
    private readonly reconciliationDelayMs: number;
    private exchangeInfoCache?: { value: AsterExchangeInfo; expiresAt: number };

    constructor(
        private readonly client: AsterV3Client,
        options: AsterDirectTradeExecutorOptions = {},
    ) {
        this.quoteAsset = String(options.quoteAsset || "USDT").toUpperCase();
        this.exchangeInfoTtlMs = Math.max(30_000, options.exchangeInfoTtlMs ?? 15 * 60_000);
        this.reconciliationAttempts = Math.max(1, options.reconciliationAttempts ?? 6);
        this.reconciliationDelayMs = Math.max(250, options.reconciliationDelayMs ?? 1500);
    }

    private async getExchangeInfoCached() {
        const now = Date.now();
        if (this.exchangeInfoCache && this.exchangeInfoCache.expiresAt > now) {
            return this.exchangeInfoCache.value;
        }
        const value = await this.client.getExchangeInfo();
        this.exchangeInfoCache = { value, expiresAt: now + this.exchangeInfoTtlMs };
        return value;
    }

    private async getSymbolInfo(symbol: string): Promise<AsterExchangeSymbol> {
        const normalized = symbol.toUpperCase();
        const exchangeInfo = await this.getExchangeInfoCached();
        const row = exchangeInfo.symbols.find((item) => item.symbol === normalized);
        if (!row) throw new Error(`Aster symbol not found: ${normalized}`);
        if (row.status !== "TRADING") throw new Error(`Aster symbol is not TRADING: ${normalized} (${row.status || "unknown"})`);
        return row;
    }

    async getAccountSnapshot(): Promise<DirectAccountSnapshot> {
        const rows = await this.client.getBalances();
        const row = rows.find((item) => item.asset?.toUpperCase() === this.quoteAsset);
        if (!row) throw new Error(`Aster ${this.quoteAsset} balance row was not returned.`);
        return {
            availableBalance: safeNumber(row.availableBalance),
            walletBalance: safeNumber(row.balance ?? row.crossWalletBalance),
            asset: this.quoteAsset,
            updatedAt: safeNumber(row.updateTime, Date.now()),
        };
    }

    async getPositions(): Promise<DirectPosition[]> {
        const rows = await this.client.getPositions();
        return rows
            .map((row: AsterPositionRiskRow): DirectPosition | null => {
                const rawQuantity = safeNumber(row.positionAmt);
                if (Math.abs(rawQuantity) <= 1e-12) return null;
                const markPrice = safeNumber(row.markPrice);
                const entryPrice = safeNumber(row.entryPrice);
                const quantity = rawQuantity;
                const notionalUsd = Math.abs(quantity) * markPrice;
                const unrealizedPnl = safeNumber(row.unRealizedProfit ?? row.unrealizedProfit);
                const initialValue = Math.abs(quantity) * entryPrice;
                const pnlPct = initialValue > 0 ? (unrealizedPnl / initialValue) * 100 : 0;
                return {
                    symbol: row.symbol.toUpperCase(),
                    quantity,
                    entryPrice,
                    markPrice,
                    unrealizedPnl,
                    pnlPct,
                    notionalUsd,
                    positionSide: row.positionSide || "BOTH",
                    leverage: safeNumber(row.leverage, 1),
                    updatedAt: safeNumber(row.updateTime, Date.now()),
                };
            })
            .filter((position): position is DirectPosition => position !== null);
    }

    async getOpenOrders(): Promise<DirectOpenOrder[]> {
        const rows = await this.client.getOpenOrders();
        return rows.map((row) => ({
            symbol: row.symbol.toUpperCase(),
            clientOrderId: String(row.clientOrderId || ""),
            side: row.side,
            status: row.status,
            reduceOnly: row.reduceOnly,
            quantity: safeNumber(row.origQty),
            executedQuantity: safeNumber(row.executedQty),
        }));
    }

    async getMarketQuote(symbol: string): Promise<DirectMarketQuote> {
        const normalized = symbol.toUpperCase();
        const payload = await this.client.getBookTickers(normalized);
        const row = asArray<AsterBookTicker>(payload).find((item) => item.symbol === normalized);
        if (!row) throw new Error(`Aster book ticker missing: ${normalized}`);
        const bidPrice = safeNumber(row.bidPrice);
        const askPrice = safeNumber(row.askPrice);
        if (bidPrice <= 0 || askPrice <= 0 || askPrice < bidPrice) {
            throw new Error(`Invalid Aster book ticker for ${normalized}.`);
        }
        const midPrice = (bidPrice + askPrice) / 2;
        return {
            symbol: normalized,
            bidPrice,
            askPrice,
            bidQuantity: safeNumber(row.bidQty),
            askQuantity: safeNumber(row.askQty),
            midPrice,
            spreadBps: midPrice > 0 ? ((askPrice - bidPrice) / midPrice) * 10_000 : Number.POSITIVE_INFINITY,
            updatedAt: safeNumber(row.time, Date.now()),
        };
    }

    async normalizeMarketQuantity(symbol: string, requestedQuantity: number, referencePrice: number, options: { allowBelowMinNotional?: boolean } = {}): Promise<NormalizedOrderQuantity> {
        const row = await this.getSymbolInfo(symbol);
        const marketLot = row.filters?.find((filter) => filter.filterType === "MARKET_LOT_SIZE")
            ?? row.filters?.find((filter) => filter.filterType === "LOT_SIZE");
        if (!marketLot) throw new Error(`Aster quantity filter missing for ${symbol}.`);
        const minQuantity = safeNumber(marketLot.minQty);
        const maxQuantity = safeNumber(marketLot.maxQty, Number.MAX_SAFE_INTEGER);
        const stepSize = safeNumber(marketLot.stepSize);
        const minNotional = safeNumber(row.filters?.find((filter) => filter.filterType === "MIN_NOTIONAL")?.notional);
        const bounded = Math.min(Math.max(requestedQuantity, 0), maxQuantity);
        const quantity = floorToStep(bounded, stepSize);
        const notional = quantity * referencePrice;
        if (quantity < minQuantity || quantity <= 0) {
            throw new Error(`Quantity ${quantity} is below Aster minQty ${minQuantity} for ${symbol}.`);
        }
        if (!options.allowBelowMinNotional && minNotional > 0 && notional + 1e-9 < minNotional) {
            throw new Error(`Notional ${notional.toFixed(4)} is below Aster minimum ${minNotional} for ${symbol}.`);
        }
        const precision = Math.min(12, Math.max(decimalPlaces(stepSize), row.quantityPrecision ?? 0));
        return {
            symbol: row.symbol,
            quantity,
            quantityText: quantity.toFixed(precision).replace(/\.?0+$/, ""),
            minQuantity,
            maxQuantity,
            stepSize,
            minNotional,
            notional,
        };
    }

    private normalizeResult(input: {
        requestId: string;
        clientOrderId: string;
        requestedQuantity: number;
        submittedQuantity: number;
        side: AsterOrderSide;
        raw?: AsterOrderResponse;
        executionUnknown?: boolean;
        reconciled?: boolean;
        error?: string;
    }): DirectTradeResult {
        const raw = input.raw;
        return {
            requestId: input.requestId,
            clientOrderId: input.clientOrderId,
            symbol: String(raw?.symbol || "").toUpperCase(),
            side: raw?.side || input.side,
            status: orderStatus(raw?.status),
            requestedQuantity: input.requestedQuantity,
            submittedQuantity: input.submittedQuantity,
            executedQuantity: safeNumber(raw?.executedQty),
            averagePrice: safeNumber(raw?.avgPrice),
            quoteQuantity: safeNumber(raw?.cumQuote),
            orderId: raw?.orderId,
            executionUnknown: input.executionUnknown === true,
            reconciled: input.reconciled === true,
            raw,
            error: input.error,
        };
    }

    async reconcileOrder(symbol: string, clientOrderId: string): Promise<DirectTradeResult> {
        const normalizedSymbol = symbol.toUpperCase();
        const normalizedClientOrderId = sanitizeClientOrderId(clientOrderId);
        let lastError = "Order status is still unknown.";
        for (let attempt = 0; attempt < this.reconciliationAttempts; attempt += 1) {
            if (attempt > 0) await sleep(this.reconciliationDelayMs * attempt);
            try {
                const raw = await this.client.getOrder(normalizedSymbol, normalizedClientOrderId);
                return this.normalizeResult({
                    requestId: normalizedClientOrderId,
                    clientOrderId: normalizedClientOrderId,
                    requestedQuantity: safeNumber(raw.origQty),
                    submittedQuantity: safeNumber(raw.origQty),
                    side: raw.side || "BUY",
                    raw,
                    executionUnknown: false,
                    reconciled: true,
                });
            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
                if (error instanceof AsterApiError && (error.status === 429 || error.status === 418)) {
                    await sleep(error.retryAfterMs ?? this.reconciliationDelayMs * (attempt + 1));
                }
            }
        }
        return {
            requestId: normalizedClientOrderId,
            clientOrderId: normalizedClientOrderId,
            symbol: normalizedSymbol,
            side: "BUY",
            status: "UNKNOWN",
            requestedQuantity: 0,
            submittedQuantity: 0,
            executedQuantity: 0,
            averagePrice: 0,
            quoteQuantity: 0,
            executionUnknown: true,
            reconciled: true,
            error: lastError,
        };
    }

    async executeMarket(command: DirectTradeCommand): Promise<DirectTradeResult> {
        const symbol = command.symbol.toUpperCase();
        const clientOrderId = sanitizeClientOrderId(command.clientOrderId);
        if (command.reduceOnly !== true) {
            await runFreshMarginGuardBeforeExposureOrder();
        }
        const quote = await this.getMarketQuote(symbol);
        const executablePrice = command.side === "BUY" ? quote.askPrice : quote.bidPrice;
        const adverseSlippageBps = command.expectedPrice > 0
            ? command.side === "BUY"
                ? Math.max(0, ((executablePrice - command.expectedPrice) / command.expectedPrice) * 10_000)
                : Math.max(0, ((command.expectedPrice - executablePrice) / command.expectedPrice) * 10_000)
            : 0;
        if (adverseSlippageBps > command.maxSlippageBps) {
            throw new Error(
                `Slippage guard blocked ${symbol}: ${adverseSlippageBps.toFixed(2)}bps > ${command.maxSlippageBps.toFixed(2)}bps.`,
            );
        }
        const normalized = await this.normalizeMarketQuantity(symbol, command.quantity, executablePrice, { allowBelowMinNotional: command.reduceOnly === true });
        try {
            const raw = await this.client.placeMarketOrder({
                symbol,
                side: command.side,
                quantity: normalized.quantityText,
                positionSide: command.positionSide || "BOTH",
                reduceOnly: command.reduceOnly,
                newClientOrderId: clientOrderId,
                newOrderRespType: "RESULT",
            });
            return this.normalizeResult({
                requestId: command.requestId,
                clientOrderId,
                requestedQuantity: command.quantity,
                submittedQuantity: normalized.quantity,
                side: command.side,
                raw,
            });
        } catch (error) {
            if (error instanceof AsterApiError && error.executionUnknown) {
                const reconciled = await this.reconcileOrder(symbol, clientOrderId);
                return {
                    ...reconciled,
                    requestId: command.requestId,
                    requestedQuantity: command.quantity,
                    submittedQuantity: normalized.quantity,
                    executionUnknown: reconciled.status === "UNKNOWN",
                    error: reconciled.status === "UNKNOWN" ? error.message : reconciled.error,
                };
            }
            throw error;
        }
    }
}
