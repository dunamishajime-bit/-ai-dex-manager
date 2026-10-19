/**
 * Idle SHORT 20% STOP-risk venue bridge.
 *
 * PURE: accepts authenticated, complete account-wide Aster snapshots acquired
 * while the shared account lock is held. Never sends or modifies orders.
 * Unknown ownership/stop coverage/pending reservations => Fail Closed.
 */
import type { DirectPosition, DirectOpenOrder } from "./direct-trade-executor";
import type { PendingExposureRegistry } from "./disdex-pending-exposure-registry";
import type {
    PendingShortRiskReservation, SignedShortStopSnapshot,
} from "./idle-priority-short-basket-adopted";

export type SignedPendingShortRisk = PendingShortRiskReservation & { reservationId: string };
export type IdleCrossRunnerRiskReadback = {
    ok: boolean;
    reason: string;
    existingShorts: SignedShortStopSnapshot[];
    pendingShortReservations: PendingShortRiskReservation[];
};
const EPS = 1e-9;
const ACTIVE_ORDER = new Set(["NEW", "PARTIALLY_FILLED", "PENDING_NEW"]);
const ACTIVE_RESERVATION = new Set(["PENDING", "SUBMITTED", "UNKNOWN"]);
const positive = (n: number) => Number.isFinite(n) && n > 0;
const stale = (timestamp: number, now: number, maxAgeMs: number) =>
    !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > now ||
    now - timestamp > maxAgeMs;

function fail(reason: string): IdleCrossRunnerRiskReadback {
    return { ok: false, reason, existingShorts: [], pendingShortReservations: [] };
}
function isShort(position: DirectPosition) {
    return position.positionSide === "SHORT"
        || (position.positionSide === "BOTH" && position.quantity < 0);
}

/**
 * Aster getPositions/getOpenOrders must be authenticated full-account reads,
 * not stale UI caches, independent per-symbol reads, or locally synthesized STOPs.
 * The bridge cannot itself certify exchange signatures: its caller owns that proof.
 */
export function buildIdleCrossRunnerStopRiskReadback(input: {
    nowMs: number;
    signedAccountReadbackComplete: true;
    positions: readonly DirectPosition[];
    openOrders: readonly DirectOpenOrder[];
    pendingRegistry: PendingExposureRegistry;
    signedPendingStopRisks: readonly SignedPendingShortRisk[];
    maxAgeMs?: number;
}): IdleCrossRunnerRiskReadback {
    const { nowMs, positions, openOrders, pendingRegistry, signedPendingStopRisks } = input;
    const maxAgeMs = input.maxAgeMs ?? 90_000;
    if (input.signedAccountReadbackComplete !== true || !Number.isSafeInteger(nowMs)
        || !Array.isArray(positions) || !Array.isArray(openOrders)
        || !pendingRegistry || !Array.isArray(pendingRegistry.entries)
        || !Array.isArray(signedPendingStopRisks) || !positive(maxAgeMs)) {
        return fail("SHORT_BASKET_ACCOUNT_READBACK_INCOMPLETE");
    }
    if (stale(pendingRegistry.updatedAt, nowMs, maxAgeMs))
        return fail("SHORT_BASKET_PENDING_REGISTRY_STALE");
    const existingShorts: SignedShortStopSnapshot[] = [];
    for (const position of positions) {
        if (!position || !positive(Math.abs(position.quantity))) continue;
        if (!isShort(position)) continue;
        if (!position.symbol || !positive(position.entryPrice)
            || !positive(position.markPrice) || !positive(Math.abs(position.quantity))
            || stale(position.updatedAt, nowMs, maxAgeMs)) {
            return fail("SHORT_BASKET_POSITION_SNAPSHOT_INVALID_OR_STALE");
        }
        const orders = openOrders.filter((order) =>
            String(order.symbol).toUpperCase() === position.symbol.toUpperCase()
            && ACTIVE_ORDER.has(String(order.status || "").toUpperCase())
            && order.reduceOnly === true
            && String(order.side).toUpperCase() === "BUY"
            && String(order.type).toUpperCase() === "STOP_MARKET");
        if (orders.length !== 1 || !positive(Number(orders[0].stopPrice))
            || !positive(orders[0].quantity)
            || Math.abs(orders[0].quantity - Math.abs(position.quantity)) > EPS) {
            return fail("SHORT_BASKET_STOP_NOT_UNIQUELY_SIGNED_AND_COMPLETE");
        }
        const stop = orders[0];
        existingShorts.push({
            symbol: position.symbol.toUpperCase(),
            side: "SHORT",
            entryPrice: position.entryPrice,
            currentMarkPrice: position.markPrice,
            quantity: Math.abs(position.quantity),
            exchangeStopReadback: {
                stopPrice: Number(stop.stopPrice),
                quantity: stop.quantity,
                reduceOnly: true,
                verified: true,
                verifiedAtMs: nowMs,
            },
        });
    }
    const pendingShortReservations: PendingShortRiskReservation[] = [];
    const found = new Set<string>();
    for (const entry of pendingRegistry.entries) {
        if (!ACTIVE_RESERVATION.has(entry.status) || entry.side !== "SHORT") continue;
        const risk = signedPendingStopRisks.find((row) => row.reservationId === entry.reservationId);
        if (!risk || found.has(entry.reservationId)
            || risk.symbol.toUpperCase() !== entry.symbol.toUpperCase()
            || risk.side !== "SHORT" || risk.complete !== true
            || !Number.isFinite(risk.worstCaseLossUsd) || risk.worstCaseLossUsd < 0
            || stale(risk.verifiedAtMs, nowMs, maxAgeMs)) {
            // The v1 shared registry only has gross/notional, not verified STOP risk.
            // Do not invent a risk estimate from notional or omit the reservation.
            return fail("SHORT_BASKET_PENDING_STOP_RISK_PROOF_MISSING");
        }
        found.add(entry.reservationId);
        pendingShortReservations.push({
            symbol: entry.symbol, side: "SHORT",
            worstCaseLossUsd: risk.worstCaseLossUsd,
            complete: true, verifiedAtMs: risk.verifiedAtMs,
        });
    }
    return { ok: true, reason: "SHORT_BASKET_STOP_RISK_VERIFIED", existingShorts, pendingShortReservations };
}
