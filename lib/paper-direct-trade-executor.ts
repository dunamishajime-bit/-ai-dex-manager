import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
    type DirectAccountSnapshot,
    type DirectMarketQuote,
    type DirectOpenOrder,
    type DirectPosition,
    type DirectTradeCommand,
    type DirectTradeExecutor,
    type DirectTradeResult,
    type NormalizedOrderQuantity,
} from "@/lib/direct-trade-executor";

interface PaperPositionRow {
    symbol: string;
    quantity: number;
    entryPrice: number;
    updatedAt: number;
}

interface PaperOrderRow extends DirectTradeResult {
    createdAt: number;
}

interface PaperPortfolioState {
    version: 1;
    initialBalanceUsd: number;
    cashUsd: number;
    positions: Record<string, PaperPositionRow>;
    orders: Record<string, PaperOrderRow>;
    updatedAt: number;
}

export interface PaperDirectTradeExecutorOptions {
    statePath: string;
    initialBalanceUsd?: number;
    feeBpsPerSide?: number;
}

function defaultState(initialBalanceUsd: number): PaperPortfolioState {
    return {
        version: 1,
        initialBalanceUsd,
        cashUsd: initialBalanceUsd,
        positions: {},
        orders: {},
        updatedAt: Date.now(),
    };
}

function safeNumber(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export class PaperDirectTradeExecutor implements DirectTradeExecutor {
    private readonly statePath: string;
    private readonly initialBalanceUsd: number;
    private readonly feeBpsPerSide: number;

    constructor(
        private readonly marketExecutor: Pick<DirectTradeExecutor, "getMarketQuote" | "normalizeMarketQuantity">,
        options: PaperDirectTradeExecutorOptions,
    ) {
        this.statePath = resolve(options.statePath);
        this.initialBalanceUsd = Math.max(1, options.initialBalanceUsd ?? 1000);
        this.feeBpsPerSide = Math.max(0, options.feeBpsPerSide ?? 6);
    }

    private async loadState(): Promise<PaperPortfolioState> {
        try {
            const raw = JSON.parse(await readFile(this.statePath, "utf8")) as Partial<PaperPortfolioState>;
            return {
                version: 1,
                initialBalanceUsd: safeNumber(raw.initialBalanceUsd, this.initialBalanceUsd),
                cashUsd: safeNumber(raw.cashUsd, this.initialBalanceUsd),
                positions: raw.positions && typeof raw.positions === "object" ? raw.positions : {},
                orders: raw.orders && typeof raw.orders === "object" ? raw.orders : {},
                updatedAt: safeNumber(raw.updatedAt, Date.now()),
            };
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error
                ? String((error as { code?: unknown }).code)
                : "";
            if (code === "ENOENT") return defaultState(this.initialBalanceUsd);
            throw error;
        }
    }

    private async saveState(state: PaperPortfolioState) {
        await mkdir(dirname(this.statePath), { recursive: true });
        state.updatedAt = Date.now();
        const tempPath = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(tempPath, this.statePath);
    }

    async getAccountSnapshot(): Promise<DirectAccountSnapshot> {
        const state = await this.loadState();
        return {
            availableBalance: state.cashUsd,
            walletBalance: state.cashUsd,
            asset: "USDT",
            updatedAt: state.updatedAt,
        };
    }

    async getPositions(): Promise<DirectPosition[]> {
        const state = await this.loadState();
        const rows = Object.values(state.positions).filter((position) => position.quantity > 1e-12);
        const positions: DirectPosition[] = [];
        for (const row of rows) {
            const quote = await this.getMarketQuote(row.symbol);
            const markPrice = quote.midPrice;
            const unrealizedPnl = (markPrice - row.entryPrice) * row.quantity;
            const entryNotional = row.entryPrice * row.quantity;
            positions.push({
                symbol: row.symbol,
                quantity: row.quantity,
                entryPrice: row.entryPrice,
                markPrice,
                unrealizedPnl,
                pnlPct: entryNotional > 0 ? (unrealizedPnl / entryNotional) * 100 : 0,
                notionalUsd: row.quantity * markPrice,
                positionSide: "BOTH",
                leverage: 1,
                updatedAt: row.updatedAt,
            });
        }
        return positions;
    }

    async getOpenOrders(): Promise<DirectOpenOrder[]> {
        return [];
    }

    getMarketQuote(symbol: string): Promise<DirectMarketQuote> {
        return this.marketExecutor.getMarketQuote(symbol);
    }

    normalizeMarketQuantity(symbol: string, requestedQuantity: number, referencePrice: number): Promise<NormalizedOrderQuantity> {
        return this.marketExecutor.normalizeMarketQuantity(symbol, requestedQuantity, referencePrice);
    }

    async executeMarket(command: DirectTradeCommand): Promise<DirectTradeResult> {
        const existing = await this.reconcileOrder(command.symbol, command.clientOrderId);
        if (existing.status !== "UNKNOWN") return existing;
        const quote = await this.getMarketQuote(command.symbol);
        const fillPrice = command.side === "BUY" ? quote.askPrice : quote.bidPrice;
        const normalized = await this.normalizeMarketQuantity(command.symbol, command.quantity, fillPrice);
        const state = await this.loadState();
        const symbol = command.symbol.toUpperCase();
        const current = state.positions[symbol];
        const grossQuote = normalized.quantity * fillPrice;
        const fee = grossQuote * (this.feeBpsPerSide / 10_000);

        if (command.side === "BUY") {
            const required = grossQuote + fee;
            if (required > state.cashUsd + 1e-9) {
                throw new Error(`Paper cash insufficient: required ${required.toFixed(4)}, available ${state.cashUsd.toFixed(4)}.`);
            }
            const oldQuantity = current?.quantity || 0;
            const newQuantity = oldQuantity + normalized.quantity;
            const weightedEntry = newQuantity > 0
                ? (((current?.entryPrice || 0) * oldQuantity) + (fillPrice * normalized.quantity)) / newQuantity
                : fillPrice;
            state.positions[symbol] = {
                symbol,
                quantity: newQuantity,
                entryPrice: weightedEntry,
                updatedAt: Date.now(),
            };
            state.cashUsd -= required;
        } else {
            if (!current || current.quantity + 1e-9 < normalized.quantity) {
                throw new Error(`Paper position insufficient for ${symbol} SELL ${normalized.quantity}.`);
            }
            const remaining = Math.max(0, current.quantity - normalized.quantity);
            if (remaining <= 1e-12) delete state.positions[symbol];
            else state.positions[symbol] = { ...current, quantity: remaining, updatedAt: Date.now() };
            state.cashUsd += grossQuote - fee;
        }

        const result: DirectTradeResult = {
            requestId: command.requestId,
            clientOrderId: command.clientOrderId,
            symbol,
            side: command.side,
            status: "FILLED",
            requestedQuantity: command.quantity,
            submittedQuantity: normalized.quantity,
            executedQuantity: normalized.quantity,
            averagePrice: fillPrice,
            quoteQuantity: grossQuote,
            executionUnknown: false,
            reconciled: false,
        };
        state.orders[command.clientOrderId] = { ...result, createdAt: Date.now() };
        await this.saveState(state);
        return result;
    }

    async reconcileOrder(symbol: string, clientOrderId: string): Promise<DirectTradeResult> {
        const state = await this.loadState();
        const row = state.orders[clientOrderId];
        if (row) return { ...row, reconciled: true };
        return {
            requestId: clientOrderId,
            clientOrderId,
            symbol: symbol.toUpperCase(),
            side: "BUY",
            status: "UNKNOWN",
            requestedQuantity: 0,
            submittedQuantity: 0,
            executedQuantity: 0,
            averagePrice: 0,
            quoteQuantity: 0,
            executionUnknown: true,
            reconciled: true,
            error: "Paper order not found.",
        };
    }
}
