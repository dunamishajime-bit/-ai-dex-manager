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
function isActive(status?: string) { return !["CANCELED", "CANCELLED", "REJECTED", "EXPIRED", "FILLED"].includes(String(status || "NEW").toUpperCase()); }

async function verifyProtection(adapter: ResidentStopAdapter, state: V12StopState, stopId: string, tpId: string) {
    const open = await adapter.openOrders(state.symbol);
    const stop = open.find((order) => order.clientOrderId === stopId && isActive(order.status));
    const tp = open.find((order) => order.clientOrderId === tpId && isActive(order.status));
    if (!stop || !tp) throw new Error("RESIDENT_PROTECTION_NOT_VISIBLE_ON_EXCHANGE");
    if (Number.isFinite(stop.stopPrice) && Math.abs(Number(stop.stopPrice) - state.initialStop) > Math.max(1e-8, Math.abs(state.initialStop) * 1e-6)) {
        throw new Error("RESIDENT_STOP_TRIGGER_MISMATCH");
    }
}

/** At-most-once resident protection. If installation cannot be acknowledged
 * and verified on the exchange, the managed position is flattened reduce-only
 * and marked for manual review. */
export async function installV12Protection(adapter: ResidentStopAdapter, state: V12StopState): Promise<V12StopState> {
    const stopClientOrderId = state.stopClientOrderId || id(state, "STOP");
    const takeProfitClientOrderId = state.takeProfitClientOrderId || id(state, "TP");
    const closeSide = exitSide(state.side);
    try {
        const stop = await adapter.placeStopMarket({ symbol: state.symbol, side: closeSide, quantity: state.quantity, stopPrice: state.initialStop, clientOrderId: stopClientOrderId, reduceOnly: true });
        if (!stop.acknowledged) throw new Error("RESIDENT_STOP_NOT_ACKNOWLEDGED");
        const tp = await adapter.placeTakeProfit({ symbol: state.symbol, side: closeSide, quantity: state.quantity, stopPrice: state.takeProfit, clientOrderId: takeProfitClientOrderId, reduceOnly: true });
        if (!tp.acknowledged) throw new Error("RESIDENT_TP_NOT_ACKNOWLEDGED");
        await verifyProtection(adapter, state, stopClientOrderId, takeProfitClientOrderId);
        return { ...state, stopClientOrderId, takeProfitClientOrderId, lastAckStop: state.initialStop };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // Best-effort protection cleanup happens before the failsafe close. The
        // flatten itself must be verified by the venue adapter and may throw;
        // callers then trip the sticky kill switch and stop new entries.
        for (const clientOrderId of [stopClientOrderId, takeProfitClientOrderId]) {
            try { await adapter.cancel(clientOrderId); } catch { /* fail-safe close remains mandatory */ }
        }
        await adapter.flattenReduceOnly({ symbol: state.symbol, side: closeSide, quantity: state.quantity, clientOrderId: id(state, "STOP", 999) });
        return { ...state, stopClientOrderId, takeProfitClientOrderId, manualReview: `PROTECTION_FAILED_FLATTENED:${reason}` };
    }
}

/** Replace a trailing stop confirm-before-cancel. A failed new STOP never
 * removes the previously acknowledged STOP. */
export async function updateV12TrailingStop(adapter: ResidentStopAdapter, state: V12StopState, price: number): Promise<V12StopState> {
    if (state.manualReview) return state;
    const nextExtreme = state.side === "LONG" ? Math.max(state.peakOrTrough, price) : Math.min(state.peakOrTrough, price);
    const levels = protectiveLevels(state.entryPrice, state.atrAtEntry, state.side);
    const candidate = nextTrailingStop(state.side, state.lastAckStop, nextExtreme, levels.trailingDistance);
    if (candidate === state.lastAckStop || !Number.isFinite(candidate)) return { ...state, peakOrTrough: nextExtreme };
    const nextId = id(state, "STOP", Math.round(candidate * 1e8));
    try {
        const result = await adapter.placeStopMarket({ symbol: state.symbol, side: exitSide(state.side), quantity: state.quantity, stopPrice: candidate, clientOrderId: nextId, reduceOnly: true });
        if (!result.acknowledged) throw new Error("TRAILING_STOP_NOT_ACKNOWLEDGED");
        const openAfterPlace = await adapter.openOrders(state.symbol);
        const newStop = openAfterPlace.find((order) => order.clientOrderId === nextId && isActive(order.status));
        if (!newStop) throw new Error("TRAILING_STOP_NOT_VISIBLE_ON_EXCHANGE");
        if (Number.isFinite(newStop.stopPrice) && Math.abs(Number(newStop.stopPrice) - candidate) > Math.max(1e-8, Math.abs(candidate) * 1e-6)) {
            throw new Error("TRAILING_STOP_TRIGGER_MISMATCH");
        }
        // Only after the new STOP has been seen active at the venue may the old
        // acknowledged STOP be cancelled.
        if (state.stopClientOrderId && state.stopClientOrderId !== nextId) await adapter.cancel(state.stopClientOrderId);
        return { ...state, peakOrTrough: nextExtreme, lastAckStop: candidate, stopClientOrderId: nextId };
    } catch (error) {
        // Keep old STOP. Clean up only the unverified replacement if it exists.
        try { if (nextId !== state.stopClientOrderId) await adapter.cancel(nextId); } catch { /* old STOP is still authoritative */ }
        return { ...state, peakOrTrough: nextExtreme, manualReview: `TRAILING_STOP_UPDATE_FAILED:${error instanceof Error ? error.message : String(error)}` };
    }
}

export async function reconcileV12Protection(adapter: ResidentStopAdapter, state: V12StopState): Promise<V12StopState> {
    if (state.manualReview) return state;
    const open = await adapter.openOrders(state.symbol);
    const hasStop = open.some((order) => order.clientOrderId === state.stopClientOrderId && isActive(order.status));
    const hasTp = open.some((order) => order.clientOrderId === state.takeProfitClientOrderId && isActive(order.status));
    if (!hasStop || !hasTp) return { ...state, manualReview: "RESIDENT_PROTECTION_RECONCILIATION_FAILED" };
    return state;
}

export async function cancelV12Protection(adapter: ResidentStopAdapter, state: V12StopState) {
    for (const clientOrderId of [state.stopClientOrderId, state.takeProfitClientOrderId]) {
        if (clientOrderId) await adapter.cancel(clientOrderId);
    }
    const open = await adapter.openOrders(state.symbol);
    const stale = open.filter((order) => order.clientOrderId.startsWith("v12-") && isActive(order.status));
    if (stale.length) throw new Error(`V12_PROTECTION_CLEANUP_FAILED:${stale.map((row) => row.clientOrderId).join(",")}`);
}
