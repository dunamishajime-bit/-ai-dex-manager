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

export class OneWayLongDirectTradeExecutor implements DirectTradeExecutor {
    constructor(private readonly delegate: DirectTradeExecutor) {}

    getAccountSnapshot(): Promise<DirectAccountSnapshot> {
        return this.delegate.getAccountSnapshot();
    }

    async getPositions(): Promise<DirectPosition[]> {
        const positions = await this.delegate.getPositions();
        const unsupported = positions.filter((position) =>
            position.quantity < 0
            || position.positionSide !== "BOTH",
        );
        if (unsupported.length) {
            throw new Error(
                `Manual review required: Win80 live runner supports one-way LONG positions only. Unsupported positions: ${unsupported
                    .map((position) => `${position.symbol}:${position.positionSide}:${position.quantity}`)
                    .join(", ")}`,
            );
        }
        return positions;
    }

    getOpenOrders(): Promise<DirectOpenOrder[]> {
        return this.delegate.getOpenOrders();
    }

    getMarketQuote(symbol: string): Promise<DirectMarketQuote> {
        return this.delegate.getMarketQuote(symbol);
    }

    normalizeMarketQuantity(
        symbol: string,
        requestedQuantity: number,
        referencePrice: number,
    ): Promise<NormalizedOrderQuantity> {
        return this.delegate.normalizeMarketQuantity(symbol, requestedQuantity, referencePrice);
    }

    executeMarket(command: DirectTradeCommand): Promise<DirectTradeResult> {
        return this.delegate.executeMarket(command);
    }

    reconcileOrder(symbol: string, clientOrderId: string): Promise<DirectTradeResult> {
        return this.delegate.reconcileOrder(symbol, clientOrderId);
    }
}
