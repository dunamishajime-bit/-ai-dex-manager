import { createHash } from "node:crypto";
import { protectiveLevels, nextTrailingStop, type V12Side } from "@/lib/v12-x1-all";

export interface V12StopState {
    strategyId: "V12_X1.00_ALL";
    symbol: string;
    side: V12Side;
    positionId: string;
    quantity: number;
    entryPrice: number;
    atrAtEntry: number;
    initialStop: number;
    lastAckStop: number;
    takeProfit: number;
    peakOrTrough: number;
    stopClientOrderId?: string;
    takeProfitClientOrderId?: string;
    manualReview?: string;
}

export interface ResidentStopAdapter {
    placeStopMarket(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; stopPrice: number; clientOrderId: string; reduceOnly: true }): Promise<{ acknowledged: boolean; orderId?: string }>;
    placeTakeProfit(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; stopPrice: number; clientOrderId: string; reduceOnly: true }): Promise<{ acknowledged: boolean; orderId?: string }>;
    cancel(clientOrderId: string): Promise<void>;
    flattenReduceOnly(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; clientOrderId: string }): Promise<void>;
    openOrders(symbol: string): Promise<Array<{ clientOrderId: string; stopPrice?: number; status?: string }>>;
}

function exitSide(side: V12Side) { return side === "LONG" ? "SELL" : "BUY"; }
function id(state: V12StopState, leg: "STOP" | "TP", version = 0) { return `v12-${leg.toLowerCase()}-${createHash("sha256").update(`${state.positionId}|${state.symbol}|${leg}|${version}`).digest("hex").slice(0, 22)}`.slice(0, 36); }

/** At-most-once resident protection. If installation cannot be acknowledged,
 * the managed position is flattened reduce-only and marked for review. */
export async function installV12Protection(adapter: ResidentStopAdapter, state: V12StopState): Promise<V12StopState> {
    const stopClientOrderId = state.stopClientOrderId || id(state, "STOP");
    const takeProfitClientOrderId = state.takeProfitClientOrderId || id(state, "TP");
    const closeSide = exitSide(state.side);
    try {
        const stop = await adapter.placeStopMarket({ symbol: state.symbol, side: closeSide, quantity: state.quantity, stopPrice: state.initialStop, clientOrderId: stopClientOrderId, reduceOnly: true });
        const tp = await adapter.placeTakeProfit({ symbol: state.symbol, side: closeSide, quantity: state.quantity, stopPrice: state.takeProfit, clientOrderId: takeProfitClientOrderId, reduceOnly: true });
        if (!stop.acknowledged || !tp.acknowledged) throw new Error("RESIDENT_PROTECTION_NOT_ACKNOWLEDGED");
        return { ...state, stopClientOrderId, takeProfitClientOrderId, lastAckStop: state.initialStop };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await adapter.flattenReduceOnly({ symbol: state.symbol, side: closeSide, quantity: state.quantity, clientOrderId: id(state, "STOP", 999) });
        return { ...state, stopClientOrderId, takeProfitClientOrderId, manualReview: `PROTECTION_FAILED_FLATTENED:${reason}` };
    }
}

export async function updateV12TrailingStop(adapter: ResidentStopAdapter, state: V12StopState, price: number): Promise<V12StopState> {
    if (state.manualReview) return state;
    const nextExtreme = state.side === "LONG" ? Math.max(state.peakOrTrough, price) : Math.min(state.peakOrTrough, price);
    const levels = protectiveLevels(state.entryPrice, state.atrAtEntry, state.side);
    const candidate = nextTrailingStop(state.side, state.lastAckStop, nextExtreme, levels.trailingDistance);
    if (candidate === state.lastAckStop || !Number.isFinite(candidate)) return { ...state, peakOrTrough: nextExtreme };
    const nextId = id(state, "STOP", Math.round(candidate * 1e8));
    try {
        const result = await adapter.placeStopMarket({ symbol: state.symbol, side: exitSide(state.side), quantity: state.quantity, stopPrice: candidate, clientOrderId: nextId, reduceOnly: true });
        if (!result.acknowledged) return { ...state, peakOrTrough: nextExtreme, manualReview: "TRAILING_STOP_NOT_ACKNOWLEDGED" };
        if (state.stopClientOrderId) await adapter.cancel(state.stopClientOrderId);
        return { ...state, peakOrTrough: nextExtreme, lastAckStop: candidate, stopClientOrderId: nextId };
    } catch (error) {
        return { ...state, peakOrTrough: nextExtreme, manualReview: `TRAILING_STOP_UPDATE_FAILED:${error instanceof Error ? error.message : String(error)}` };
    }
}

export async function reconcileV12Protection(adapter: ResidentStopAdapter, state: V12StopState): Promise<V12StopState> {
    if (state.manualReview) return state;
    const open = await adapter.openOrders(state.symbol);
    const hasStop = open.some((order) => order.clientOrderId === state.stopClientOrderId && String(order.status || "").toUpperCase() !== "CANCELED");
    const hasTp = open.some((order) => order.clientOrderId === state.takeProfitClientOrderId && String(order.status || "").toUpperCase() !== "CANCELED");
    if (!hasStop || !hasTp) return { ...state, manualReview: "RESIDENT_PROTECTION_RECONCILIATION_FAILED" };
    return state;
}
