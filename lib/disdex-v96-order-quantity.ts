import type { AsterOrderSide } from "@/lib/aster-v3-client";
import type {
    DirectMarketQuote,
    DirectTradeExecutor,
    NormalizedOrderQuantity,
} from "@/lib/direct-trade-executor";

export interface DisDexV96OrderQuantityPlan {
    symbol: string;
    side: AsterOrderSide;
    referencePrice: number;
    requestedDeltaNotionalUsd: number;
    requestedQuantity: number;
    normalized: NormalizedOrderQuantity;
    roundingPolicy: "FLOOR_TO_ASTER_MARKET_STEP";
}

function finitePositive(value: unknown, name: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be positive.`);
    return number;
}

export function disDexV96ExecutionPrice(quote: DirectMarketQuote, side: AsterOrderSide) {
    return finitePositive(side === "BUY" ? quote.askPrice : quote.bidPrice, `${quote.symbol} execution price`);
}

export async function normalizeDisDexV96OrderQuantity(input: {
    executor: DirectTradeExecutor;
    symbol: string;
    side: AsterOrderSide;
    quote: DirectMarketQuote;
    deltaNotionalUsd: number;
    minimumOrderNotionalUsd: number;
    reduceOnly: boolean;
    currentPositionQuantity?: number;
}): Promise<DisDexV96OrderQuantityPlan> {
    const symbol = input.symbol.toUpperCase();
    const referencePrice = disDexV96ExecutionPrice(input.quote, input.side);
    const requestedDeltaNotionalUsd = Math.abs(finitePositive(Math.abs(input.deltaNotionalUsd), "V96 delta notional"));
    if (requestedDeltaNotionalUsd + 1e-9 < input.minimumOrderNotionalUsd) {
        throw new Error(`V96 order notional ${requestedDeltaNotionalUsd.toFixed(4)} is below the configured minimum ${input.minimumOrderNotionalUsd}.`);
    }
    let requestedQuantity = requestedDeltaNotionalUsd / referencePrice;
    if (input.reduceOnly) {
        const current = Math.abs(Number(input.currentPositionQuantity || 0));
        if (!Number.isFinite(current) || current <= 0) throw new Error("V96 reduce-only conversion requires a positive current position quantity.");
        requestedQuantity = Math.min(requestedQuantity, current);
    }
    const normalized = await input.executor.normalizeMarketQuantity(symbol, requestedQuantity, referencePrice);
    if (normalized.quantity <= 0) throw new Error("Aster normalized V96 quantity is zero.");
    if (normalized.quantity > requestedQuantity + Math.max(normalized.stepSize, 1e-12)) {
        throw new Error("Aster quantity normalization increased the V96 order beyond the requested quantity.");
    }
    if (input.reduceOnly && normalized.quantity > Math.abs(Number(input.currentPositionQuantity || 0)) + 1e-12) {
        throw new Error("Normalized V96 reduce-only quantity exceeds the current position.");
    }
    if (normalized.notional + 1e-9 < input.minimumOrderNotionalUsd) {
        throw new Error(`Normalized V96 notional ${normalized.notional.toFixed(4)} is below the configured minimum.`);
    }
    return {
        symbol,
        side: input.side,
        referencePrice,
        requestedDeltaNotionalUsd,
        requestedQuantity,
        normalized,
        roundingPolicy: "FLOOR_TO_ASTER_MARKET_STEP",
    };
}
