import { createHash } from "node:crypto";
import { protectiveLevels, nextTrailingStop, type V12Side } from "@/lib/v12-x1-all";

export interface V12StopState {
    strategyId: "V12_X1.00_ALL"; symbol: string; side: V12Side; positionId: string; quantity: number; entryPrice: number; atrAtEntry: number;
    initialStop: number; lastAckStop: number; takeProfit: number; peakOrTrough: number; stopClientOrderId?: string; takeProfitClientOrderId?: string; manualReview?: string;
}
export interface ResidentOrderView { clientOrderId: string; stopPrice?: number; status?: string; side?: "BUY" | "SELL"; type?: string; reduceOnly?: boolean; quantity?: number; }
export interface ResidentStopAdapter {
    placeStopMarket(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; stopPrice: number; clientOrderId: string; reduceOnly: true }): Promise<{ acknowledged: boolean; orderId?: string }>;
    placeTakeProfit(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; stopPrice: number; clientOrderId: string; reduceOnly: true }): Promise<{ acknowledged: boolean; orderId?: string }>;
    cancel(clientOrderId: string): Promise<void>;
    flattenReduceOnly(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; clientOrderId: string }): Promise<void>;
    openOrders(symbol: string): Promise<ResidentOrderView[]>;
}
function exitSide(side: V12Side) { return side === "LONG" ? "SELL" : "BUY"; }
function id(state: V12StopState, leg: "STOP" | "TP", version = 0) { return `v12-${leg.toLowerCase()}-${createHash("sha256").update(`${state.positionId}|${state.symbol}|${leg}|${version}`).digest("hex").slice(0, 22)}`.slice(0, 36); }
function isActive(status?: string) { return !["CANCELED", "CANCELLED", "REJECTED", "EXPIRED", "FILLED"].includes(String(status || "NEW").toUpperCase()); }
function priceMatches(actual: number | undefined, expected: number) { return !Number.isFinite(actual) || Math.abs(Number(actual) - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-6); }
function validateLeg(order: ResidentOrderView | undefined, input: { id: string; type: string; side: "BUY" | "SELL"; quantity: number; stopPrice: number }) {
    if (!order || !isActive(order.status)) return false;
    if (order.clientOrderId !== input.id || !priceMatches(order.stopPrice, input.stopPrice)) return false;
    if (order.type && order.type.toUpperCase() !== input.type) return false;
    if (order.side && order.side !== input.side) return false;
    if (order.reduceOnly === false) return false;
    if (Number.isFinite(order.quantity) && Math.abs(Number(order.quantity) - input.quantity) > Math.max(1e-8, input.quantity * 0.001)) return false;
    return true;
}

async function verifyProtection(adapter: ResidentStopAdapter, state: V12StopState, stopId: string, tpId: string) {
    const open = await adapter.openOrders(state.symbol); const side = exitSide(state.side);
    const stop = open.find((order) => order.clientOrderId === stopId); const tp = open.find((order) => order.clientOrderId === tpId);
    if (!validateLeg(stop, { id: stopId, type: "STOP_MARKET", side, quantity: state.quantity, stopPrice: state.initialStop })) throw new Error("RESIDENT_STOP_VERIFICATION_FAILED");
    if (!validateLeg(tp, { id: tpId, type: "TAKE_PROFIT_MARKET", side, quantity: state.quantity, stopPrice: state.takeProfit })) throw new Error("RESIDENT_TP_VERIFICATION_FAILED");
}

/** Idempotent installation: an already-active deterministic leg is reused after
 * a crash; it is never blindly submitted a second time. */
export async function installV12Protection(adapter: ResidentStopAdapter, state: V12StopState): Promise<V12StopState> {
    const stopClientOrderId = state.stopClientOrderId || id(state, "STOP"); const takeProfitClientOrderId = state.takeProfitClientOrderId || id(state, "TP"); const closeSide = exitSide(state.side);
    try {
        let open = await adapter.openOrders(state.symbol);
        let existingStop = open.find((order) => order.clientOrderId === stopClientOrderId);
        if (existingStop && !validateLeg(existingStop, { id: stopClientOrderId, type: "STOP_MARKET", side: closeSide, quantity: state.quantity, stopPrice: state.initialStop })) throw new Error("RESIDENT_STOP_EXISTING_MISMATCH");
        if (!existingStop) {
            const stop = await adapter.placeStopMarket({ symbol: state.symbol, side: closeSide, quantity: state.quantity, stopPrice: state.initialStop, clientOrderId: stopClientOrderId, reduceOnly: true });
            if (!stop.acknowledged) throw new Error("RESIDENT_STOP_NOT_ACKNOWLEDGED");
        }
        open = await adapter.openOrders(state.symbol);
        const existingTp = open.find((order) => order.clientOrderId === takeProfitClientOrderId);
        if (existingTp && !validateLeg(existingTp, { id: takeProfitClientOrderId, type: "TAKE_PROFIT_MARKET", side: closeSide, quantity: state.quantity, stopPrice: state.takeProfit })) throw new Error("RESIDENT_TP_EXISTING_MISMATCH");
        if (!existingTp) {
            const tp = await adapter.placeTakeProfit({ symbol: state.symbol, side: closeSide, quantity: state.quantity, stopPrice: state.takeProfit, clientOrderId: takeProfitClientOrderId, reduceOnly: true });
            if (!tp.acknowledged) throw new Error("RESIDENT_TP_NOT_ACKNOWLEDGED");
        }
        await verifyProtection(adapter, state, stopClientOrderId, takeProfitClientOrderId);
        return { ...state, stopClientOrderId, takeProfitClientOrderId, lastAckStop: state.lastAckStop || state.initialStop };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        for (const clientOrderId of [stopClientOrderId, takeProfitClientOrderId]) { try { await adapter.cancel(clientOrderId); } catch { /* flatten remains mandatory */ } }
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
    const nextId = id(state, "STOP", Math.round(candidate * 1e8)); const closeSide = exitSide(state.side);
    try {
        let open = await adapter.openOrders(state.symbol); let existing = open.find((order) => order.clientOrderId === nextId);
        if (existing && !validateLeg(existing, { id: nextId, type: "STOP_MARKET", side: closeSide, quantity: state.quantity, stopPrice: candidate })) throw new Error("TRAILING_STOP_EXISTING_MISMATCH");
        if (!existing) {
            const result = await adapter.placeStopMarket({ symbol: state.symbol, side: closeSide, quantity: state.quantity, stopPrice: candidate, clientOrderId: nextId, reduceOnly: true });
            if (!result.acknowledged) throw new Error("TRAILING_STOP_NOT_ACKNOWLEDGED");
        }
        open = await adapter.openOrders(state.symbol); existing = open.find((order) => order.clientOrderId === nextId);
        if (!validateLeg(existing, { id: nextId, type: "STOP_MARKET", side: closeSide, quantity: state.quantity, stopPrice: candidate })) throw new Error("TRAILING_STOP_NOT_VISIBLE_OR_MISMATCH");
        if (state.stopClientOrderId && state.stopClientOrderId !== nextId) await adapter.cancel(state.stopClientOrderId);
        return { ...state, peakOrTrough: nextExtreme, lastAckStop: candidate, stopClientOrderId: nextId };
    } catch (error) {
        try { if (nextId !== state.stopClientOrderId) await adapter.cancel(nextId); } catch { /* old STOP is still authoritative */ }
        return { ...state, peakOrTrough: nextExtreme, manualReview: `TRAILING_STOP_UPDATE_FAILED:${error instanceof Error ? error.message : String(error)}` };
    }
}

export async function reconcileV12Protection(adapter: ResidentStopAdapter, state: V12StopState): Promise<V12StopState> {
    if (state.manualReview) return state;
    try { await verifyProtection(adapter, state, state.stopClientOrderId || "", state.takeProfitClientOrderId || ""); return state; }
    catch (error) { return { ...state, manualReview: `RESIDENT_PROTECTION_RECONCILIATION_FAILED:${error instanceof Error ? error.message : String(error)}` }; }
}

export async function cancelV12Protection(adapter: ResidentStopAdapter, state: V12StopState) {
    for (const clientOrderId of [state.stopClientOrderId, state.takeProfitClientOrderId]) if (clientOrderId) await adapter.cancel(clientOrderId);
    const open = await adapter.openOrders(state.symbol); const stale = open.filter((order) => order.clientOrderId.startsWith("v12-") && isActive(order.status));
    if (stale.length) throw new Error(`V12_PROTECTION_CLEANUP_FAILED:${stale.map((row) => row.clientOrderId).join(",")}`);
}