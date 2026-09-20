import type { DirectOpenOrder, DirectPosition } from "@/lib/direct-trade-executor";

const MIN_REMAINING_QUANTITY = 1e-12;
const PROTECTION_TOLERANCE_PCT = 0.01;

type Candidate = {
    order: DirectOpenOrder;
    position: DirectPosition;
    remainingQuantity: number;
};

function candidate(order: DirectOpenOrder, positions: readonly DirectPosition[]): Candidate | undefined {
    const symbol = String(order.symbol || "").trim().toUpperCase();
    const clientOrderId = String(order.clientOrderId || "");
    if (symbol !== "PENGUUSDT" || !/^recv8-[0-9a-f]{16,36}$/i.test(clientOrderId)) return undefined;
    if (order.reduceOnly !== true || !["NEW", "PARTIALLY_FILLED"].includes(String(order.status || "").toUpperCase())) return undefined;
    if (!Number.isFinite(order.quantity) || order.quantity <= 0) return undefined;
    if (!Number.isFinite(order.executedQuantity) || order.executedQuantity < 0 || order.executedQuantity > order.quantity) return undefined;
    const position = positions.find((row) => row.symbol.toUpperCase() === symbol && Math.abs(row.quantity) > MIN_REMAINING_QUANTITY);
    if (!position || !Number.isFinite(position.quantity)) return undefined;
    const expectedSide = position.quantity > 0 ? "SELL" : "BUY";
    if (order.side !== expectedSide) return undefined;
    const remainingQuantity = order.quantity - order.executedQuantity;
    const tolerance = Math.max(1e-8, Math.abs(position.quantity) * PROTECTION_TOLERANCE_PCT);
    if (remainingQuantity <= MIN_REMAINING_QUANTITY || remainingQuantity > Math.abs(position.quantity) + tolerance) return undefined;
    return { order, position, remainingQuantity };
}

export function findManagedPenguRecoveryV8ProtectiveOrders(
    openOrders: readonly DirectOpenOrder[],
    positions: readonly DirectPosition[],
): DirectOpenOrder[] {
    const candidates = openOrders
        .map((order) => candidate(order, positions))
        .filter((entry): entry is Candidate => Boolean(entry));
    if (candidates.length === 0) return [];
    const clientOrderIds = new Set(candidates.map(({ order }) => order.clientOrderId));
    if (clientOrderIds.size !== candidates.length) return [];

    const managed = new Set<DirectOpenOrder>();
    for (const position of positions) {
        if (position.symbol.toUpperCase() !== "PENGUUSDT" || !Number.isFinite(position.quantity) || Math.abs(position.quantity) <= MIN_REMAINING_QUANTITY) continue;
        const matching = candidates.filter(({ position: candidatePosition }) => candidatePosition === position);
        if (matching.length === 0) continue;
        const protectedQuantity = matching.reduce((sum, entry) => sum + entry.remainingQuantity, 0);
        const tolerance = Math.max(1e-8, Math.abs(position.quantity) * PROTECTION_TOLERANCE_PCT);
        if (Math.abs(protectedQuantity - Math.abs(position.quantity)) <= tolerance) {
            for (const entry of matching) managed.add(entry.order);
        }
    }
    return openOrders.filter((order) => managed.has(order));
}

export function isManagedPenguRecoveryV8ProtectiveOrder(
    order: DirectOpenOrder,
    openOrders: readonly DirectOpenOrder[],
    positions: readonly DirectPosition[],
): boolean {
    return findManagedPenguRecoveryV8ProtectiveOrders(openOrders, positions).some((candidateOrder) => candidateOrder === order);
}

type V12ProtectionCandidate = {
    order: DirectOpenOrder;
    position: DirectPosition;
    leg: "STOP" | "TP";
    remainingQuantity: number;
};

function v12ProtectionCandidate(
    order: DirectOpenOrder,
    positions: readonly DirectPosition[],
): V12ProtectionCandidate | undefined {
    const symbol = String(order.symbol || "").trim().toUpperCase();
    const clientOrderId = String(order.clientOrderId || "");
    const match = /^v12-(stop|tp)-[0-9a-f]{22}$/i.exec(clientOrderId);
    if (!symbol || !match) return undefined;
    if (order.reduceOnly !== true || !["NEW", "PARTIALLY_FILLED"].includes(String(order.status || "").toUpperCase())) return undefined;
    const type = String(order.type || "").toUpperCase();
    const leg = match[1].toLowerCase() === "stop" ? "STOP" : "TP";
    if (leg === "STOP" && type !== "STOP_MARKET") return undefined;
    if (leg === "TP" && type !== "TAKE_PROFIT_MARKET") return undefined;
    if (!Number.isFinite(order.quantity) || order.quantity <= 0) return undefined;
    if (!Number.isFinite(order.executedQuantity) || order.executedQuantity < 0 || order.executedQuantity > order.quantity) return undefined;
    const position = positions.find((row) => row.symbol.toUpperCase() === symbol && Math.abs(row.quantity) > MIN_REMAINING_QUANTITY);
    if (!position || !Number.isFinite(position.quantity)) return undefined;
    const expectedSide = position.quantity > 0 ? "SELL" : "BUY";
    if (order.side !== expectedSide) return undefined;
    const remainingQuantity = order.quantity - order.executedQuantity;
    const tolerance = Math.max(1e-8, Math.abs(position.quantity) * PROTECTION_TOLERANCE_PCT);
    if (remainingQuantity <= MIN_REMAINING_QUANTITY || Math.abs(remainingQuantity - Math.abs(position.quantity)) > tolerance) return undefined;
    return { order, position, leg, remainingQuantity };
}

export function findManagedV12ProtectiveOrders(
    openOrders: readonly DirectOpenOrder[],
    positions: readonly DirectPosition[],
): DirectOpenOrder[] {
    const candidates = openOrders
        .map((order) => v12ProtectionCandidate(order, positions))
        .filter((entry): entry is V12ProtectionCandidate => Boolean(entry));
    if (candidates.length === 0) return [];

    const managed = new Set<DirectOpenOrder>();
    for (const position of positions) {
        if (!Number.isFinite(position.quantity) || Math.abs(position.quantity) <= MIN_REMAINING_QUANTITY) continue;
        const matching = candidates.filter(({ position: candidatePosition }) => candidatePosition === position);
        const stops = matching.filter((entry) => entry.leg === "STOP");
        const takeProfits = matching.filter((entry) => entry.leg === "TP");
        if (stops.length !== 1 || takeProfits.length !== 1) continue;
        managed.add(stops[0].order);
        managed.add(takeProfits[0].order);
    }
    return openOrders.filter((order) => managed.has(order));
}

type FetProtectionCandidate = {
    order: DirectOpenOrder;
    position: DirectPosition;
    remainingQuantity: number;
};

function fetProtectionCandidate(
    order: DirectOpenOrder,
    positions: readonly DirectPosition[],
): FetProtectionCandidate | undefined {
    const symbol = String(order.symbol || "").trim().toUpperCase();
    const clientOrderId = String(order.clientOrderId || "");
    if (symbol !== "FETUSDT" || !/^fet-stop-[0-9a-f]{16,36}$/i.test(clientOrderId)) return undefined;
    if (order.reduceOnly !== true || !["NEW", "PARTIALLY_FILLED"].includes(String(order.status || "").toUpperCase())) return undefined;
    if (String(order.type || "").toUpperCase() !== "STOP_MARKET") return undefined;
    if (!Number.isFinite(order.quantity) || order.quantity <= 0) return undefined;
    if (!Number.isFinite(order.executedQuantity) || order.executedQuantity < 0 || order.executedQuantity > order.quantity) return undefined;
    const position = positions.find((row) => row.symbol.toUpperCase() === symbol && Math.abs(row.quantity) > MIN_REMAINING_QUANTITY);
    if (!position || position.quantity <= 0 || order.side !== "SELL") return undefined;
    const remainingQuantity = order.quantity - order.executedQuantity;
    const tolerance = Math.max(1e-8, Math.abs(position.quantity) * PROTECTION_TOLERANCE_PCT);
    if (remainingQuantity <= MIN_REMAINING_QUANTITY || Math.abs(remainingQuantity - Math.abs(position.quantity)) > tolerance) return undefined;
    return { order, position, remainingQuantity };
}

export function findManagedFetBrk48ProtectiveOrders(
    openOrders: readonly DirectOpenOrder[],
    positions: readonly DirectPosition[],
): DirectOpenOrder[] {
    const candidates = openOrders
        .map((order) => fetProtectionCandidate(order, positions))
        .filter((entry): entry is FetProtectionCandidate => Boolean(entry));
    if (candidates.length !== 1) return [];
    return [candidates[0].order];
}
