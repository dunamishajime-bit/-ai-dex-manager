import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
    DirectAccountSnapshot,
    DirectMarketQuote,
    DirectOpenOrder,
    DirectPosition,
    DirectTradeCommand,
    DirectTradeExecutor,
    DirectTradeResult,
    NormalizedOrderQuantity,
} from "@/lib/direct-trade-executor";

interface SignedPaperPosition {
    symbol: string;
    quantity: number;
    entryPrice: number;
    updatedAt: number;
}

interface SignedPaperOrder extends DirectTradeResult {
    createdAt: number;
}

interface SignedPaperState {
    version: 1;
    initialBalanceUsd: number;
    walletBalanceUsd: number;
    positions: Record<string, SignedPaperPosition>;
    orders: Record<string, SignedPaperOrder>;
    updatedAt: number;
}

export interface SignedPaperDirectTradeExecutorOptions {
    statePath: string;
    initialBalanceUsd?: number;
    feeBpsPerSide?: number;
    maxGross?: number;
}

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function defaultState(initialBalanceUsd: number): SignedPaperState {
    return {
        version: 1,
        initialBalanceUsd,
        walletBalanceUsd: initialBalanceUsd,
        positions: {},
        orders: {},
        updatedAt: Date.now(),
    };
}

export class SignedPaperDirectTradeExecutor implements DirectTradeExecutor {
    private readonly statePath: string;
    private readonly initialBalanceUsd: number;
    private readonly feeBpsPerSide: number;
    private readonly maxGross: number;

    constructor(
        private readonly marketExecutor: Pick<DirectTradeExecutor, "getMarketQuote" | "normalizeMarketQuantity">,
        options: SignedPaperDirectTradeExecutorOptions,
    ) {
        this.statePath = resolve(options.statePath);
        this.initialBalanceUsd = Math.max(1, options.initialBalanceUsd ?? 1000);
        this.feeBpsPerSide = Math.max(0, options.feeBpsPerSide ?? 6);
        this.maxGross = Math.max(1, options.maxGross ?? 2.05);
    }

    private async loadState(): Promise<SignedPaperState> {
        try {
            const raw = JSON.parse(await readFile(this.statePath, "utf8")) as Partial<SignedPaperState>;
            return {
                version: 1,
                initialBalanceUsd: finite(raw.initialBalanceUsd, this.initialBalanceUsd),
                walletBalanceUsd: finite(raw.walletBalanceUsd, this.initialBalanceUsd),
                positions: raw.positions && typeof raw.positions === "object" ? raw.positions : {},
                orders: raw.orders && typeof raw.orders === "object" ? raw.orders : {},
                updatedAt: finite(raw.updatedAt, Date.now()),
            };
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
            if (code === "ENOENT") return defaultState(this.initialBalanceUsd);
            throw error;
        }
    }

    private async saveState(state: SignedPaperState) {
        await mkdir(dirname(this.statePath), { recursive: true });
        state.updatedAt = Date.now();
        const temp = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temp, this.statePath);
    }

    private async marked(state: SignedPaperState) {
        let unrealized = 0;
        let gross = 0;
        for (const position of Object.values(state.positions)) {
            const quote = await this.getMarketQuote(position.symbol);
            const mark = quote.midPrice;
            unrealized += (mark - position.entryPrice) * position.quantity;
            gross += Math.abs(position.quantity * mark);
        }
        return { unrealized, gross, equity: state.walletBalanceUsd + unrealized };
    }

    async getAccountSnapshot(): Promise<DirectAccountSnapshot> {
        const state = await this.loadState();
        const marked = await this.marked(state);
        return {
            availableBalance: Math.max(0, marked.equity - marked.gross / this.maxGross),
            walletBalance: state.walletBalanceUsd,
            asset: "USDT",
            updatedAt: state.updatedAt,
        };
    }

    async getPositions(): Promise<DirectPosition[]> {
        const state = await this.loadState();
        const positions: DirectPosition[] = [];
        for (const row of Object.values(state.positions).filter((position) => Math.abs(position.quantity) > 1e-12)) {
            const quote = await this.getMarketQuote(row.symbol);
            const markPrice = quote.midPrice;
            const unrealizedPnl = (markPrice - row.entryPrice) * row.quantity;
            const entryNotional = Math.abs(row.entryPrice * row.quantity);
            positions.push({
                symbol: row.symbol,
                quantity: row.quantity,
                entryPrice: row.entryPrice,
                markPrice,
                unrealizedPnl,
                pnlPct: entryNotional > 0 ? unrealizedPnl / entryNotional * 100 : 0,
                notionalUsd: Math.abs(row.quantity * markPrice),
                positionSide: "BOTH",
                leverage: this.maxGross,
                updatedAt: row.updatedAt,
            });
        }
        return positions;
    }

    async getOpenOrders(): Promise<DirectOpenOrder[]> { return []; }
    getMarketQuote(symbol: string): Promise<DirectMarketQuote> { return this.marketExecutor.getMarketQuote(symbol); }
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
        const oldQuantity = finite(current?.quantity);
        const delta = command.side === "BUY" ? normalized.quantity : -normalized.quantity;
        if (command.reduceOnly) {
            if (oldQuantity === 0 || Math.sign(delta) === Math.sign(oldQuantity) || Math.abs(delta) > Math.abs(oldQuantity) + 1e-9) {
                throw new Error(`Invalid paper reduce-only order for ${symbol}: current=${oldQuantity}, delta=${delta}.`);
            }
        }
        const newQuantity = oldQuantity + delta;
        const fee = Math.abs(delta) * fillPrice * this.feeBpsPerSide / 10_000;
        let realized = 0;
        let newEntry = current?.entryPrice || fillPrice;
        if (oldQuantity === 0 || Math.sign(oldQuantity) === Math.sign(delta)) {
            const oldAbs = Math.abs(oldQuantity);
            const addAbs = Math.abs(delta);
            newEntry = (newEntry * oldAbs + fillPrice * addAbs) / Math.max(1e-12, oldAbs + addAbs);
        } else {
            const closed = Math.min(Math.abs(oldQuantity), Math.abs(delta));
            realized = (fillPrice - newEntry) * closed * Math.sign(oldQuantity);
            if (Math.sign(newQuantity) !== Math.sign(oldQuantity) && Math.abs(newQuantity) > 1e-12) newEntry = fillPrice;
        }
        state.walletBalanceUsd += realized - fee;
        if (Math.abs(newQuantity) <= 1e-12) delete state.positions[symbol];
        else state.positions[symbol] = { symbol, quantity: newQuantity, entryPrice: newEntry, updatedAt: Date.now() };

        const marked = await this.marked(state);
        if (marked.equity <= 0) throw new Error("Paper V35 equity is non-positive.");
        if (marked.gross > marked.equity * this.maxGross + 1e-6) {
            throw new Error(`Paper V35 gross cap exceeded: ${marked.gross.toFixed(2)} > ${(marked.equity * this.maxGross).toFixed(2)}.`);
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
            quoteQuantity: Math.abs(delta) * fillPrice,
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
            error: "Signed paper order not found.",
        };
    }
}
