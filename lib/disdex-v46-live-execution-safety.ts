import type {
    DirectAccountSnapshot,
    DirectMarketQuote,
    DirectOpenOrder,
    DirectPosition,
    DirectTradeCommand,
    DirectTradeExecutor,
    DirectTradeResult,
    NormalizedOrderQuantity,
} from "./direct-trade-executor";
import { calculateEquity } from "./disdex-v46-live-safety";

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function filled(result: DirectTradeResult) {
    return (result.status === "FILLED" || result.status === "PARTIALLY_FILLED") && result.executedQuantity > 0;
}

export interface DisDexV46LiveExecutionSafetyOptions {
    maximumGross: number;
    positionCheckAttempts?: number;
    positionCheckDelayMs?: number;
    openOrderFilter?: (order: DirectOpenOrder) => boolean;
}

export class DisDexV46LiveExecutionSafetyExecutor implements DirectTradeExecutor {
    private readonly attempts: number;
    private readonly delayMs: number;

    constructor(
        private readonly inner: DirectTradeExecutor,
        private readonly options: DisDexV46LiveExecutionSafetyOptions,
    ) {
        this.attempts = Math.max(1, options.positionCheckAttempts ?? 4);
        this.delayMs = Math.max(100, options.positionCheckDelayMs ?? 750);
    }

    getAccountSnapshot(): Promise<DirectAccountSnapshot> {
        return this.inner.getAccountSnapshot();
    }

    getPositions(): Promise<DirectPosition[]> {
        return this.inner.getPositions();
    }

    async getOpenOrders(): Promise<DirectOpenOrder[]> {
        const orders = await this.inner.getOpenOrders();
        return this.options.openOrderFilter ? orders.filter(this.options.openOrderFilter) : orders;
    }

    getMarketQuote(symbol: string): Promise<DirectMarketQuote> {
        return this.inner.getMarketQuote(symbol);
    }

    normalizeMarketQuantity(symbol: string, requestedQuantity: number, referencePrice: number): Promise<NormalizedOrderQuantity> {
        return this.inner.normalizeMarketQuantity(symbol, requestedQuantity, referencePrice);
    }

    reconcileOrder(symbol: string, clientOrderId: string): Promise<DirectTradeResult> {
        return this.inner.reconcileOrder(symbol, clientOrderId);
    }

    private async assertGrossImmediatelyBeforeOrder(command: DirectTradeCommand) {
        const [account, positions, quote] = await Promise.all([
            this.inner.getAccountSnapshot(),
            this.inner.getPositions(),
            this.inner.getMarketQuote(command.symbol),
        ]);
        const accountState = calculateEquity(account, positions);
        const executionPrice = command.side === "BUY" ? quote.askPrice : quote.bidPrice;
        const orderNotional = Math.abs(command.quantity * executionPrice);
        const symbol = command.symbol.toUpperCase();
        const currentSymbol = positions
            .filter((position) => position.symbol.toUpperCase() === symbol)
            .reduce((sum, position) => sum + Math.abs(finite(position.notionalUsd)), 0);
        const otherNotional = positions
            .filter((position) => position.symbol.toUpperCase() !== symbol)
            .reduce((sum, position) => sum + Math.abs(finite(position.notionalUsd)), 0);
        const projectedSymbol = command.reduceOnly
            ? Math.max(0, currentSymbol - orderNotional)
            : currentSymbol + orderNotional;
        const projectedGross = (otherNotional + projectedSymbol) / accountState.equity;
        if (!Number.isFinite(projectedGross) || projectedGross > this.options.maximumGross + 1e-9) {
            throw new Error(`LIVE order-just-in-time gross guard blocked projected gross ${projectedGross}.`);
        }
        return accountState;
    }

    private async assertPostOrderPositions(command: DirectTradeCommand, result: DirectTradeResult) {
        if (!filled(result)) return;
        let lastPositions: DirectPosition[] = [];
        for (let attempt = 0; attempt < this.attempts; attempt += 1) {
            if (attempt > 0) await new Promise<void>((resolveWait) => setTimeout(resolveWait, this.delayMs));
            lastPositions = await this.inner.getPositions();
            if (lastPositions.some((position) => position.positionSide !== "BOTH")) {
                throw new Error("LIVE post-order position check found Hedge Mode position data.");
            }
            const position = lastPositions.find((item) => item.symbol.toUpperCase() === command.symbol.toUpperCase());
            if (command.reduceOnly || (position && Math.abs(position.quantity) > 1e-12)) return;
        }
        if (!command.reduceOnly) {
            throw new Error(`LIVE post-order position check did not observe ${command.symbol} after execution.`);
        }
    }

    async executeMarket(command: DirectTradeCommand): Promise<DirectTradeResult> {
        await this.assertGrossImmediatelyBeforeOrder(command);
        const result = await this.inner.executeMarket(command);
        await this.assertPostOrderPositions(command, result);
        return result;
    }
}
