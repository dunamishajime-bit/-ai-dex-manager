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

type V12V4ProtectionCandidate = {
    order: DirectOpenOrder;
    position: DirectPosition;
    leg: "STOP" | "TP";
    remainingQuantity: number;
};

/**
 * V12 V4 uses durable order identities (`v12-v4-<28 hex>`) and may have a
 * resident STOP without a TAKE_PROFIT_MARKET companion.  The older V12
 * classifier intentionally requires a STOP/TP pair, so keeping V4 separate
 * avoids weakening that legacy ownership contract while allowing Q102's
 * read-only preflight to recognize a real V4 STOP-only position.
 */
function v12V4ProtectionCandidate(
    order: DirectOpenOrder,
    positions: readonly DirectPosition[],
): V12V4ProtectionCandidate | undefined {
    const symbol = String(order.symbol || "").trim().toUpperCase();
    const clientOrderId = String(order.clientOrderId || "");
    if (!symbol || !/^v12-v4-[0-9a-f]{28}$/i.test(clientOrderId)) return undefined;
    if (order.reduceOnly !== true || !["NEW", "PARTIALLY_FILLED"].includes(String(order.status || "").toUpperCase())) return undefined;

    const type = String(order.type || "").toUpperCase();
    const leg = type === "STOP_MARKET" ? "STOP" : type === "TAKE_PROFIT_MARKET" ? "TP" : undefined;
    if (!leg || !Number.isFinite(order.stopPrice) || order.stopPrice! <= 0) return undefined;
    if (!Number.isFinite(order.quantity) || order.quantity <= 0) return undefined;
    if (!Number.isFinite(order.executedQuantity) || order.executedQuantity < 0 || order.executedQuantity > order.quantity) return undefined;

    const matchingPositions = positions.filter((position) =>
        position.symbol.toUpperCase() === symbol
        && Number.isFinite(position.quantity)
        && Math.abs(position.quantity) > MIN_REMAINING_QUANTITY,
    );
    // One-way V4 ownership is unambiguous only when exactly one live position
    // exists for a symbol.  Multiple legs remain fail-closed here.
    if (matchingPositions.length !== 1) return undefined;
    const position = matchingPositions[0];
    const expectedSide = position.quantity > 0 ? "SELL" : "BUY";
    if (order.side !== expectedSide) return undefined;

    const remainingQuantity = order.quantity - order.executedQuantity;
    const tolerance = Math.max(1e-8, Math.abs(position.quantity) * 1e-9); // V4 resident STOP must cover the full one-way position
    if (remainingQuantity <= MIN_REMAINING_QUANTITY || Math.abs(remainingQuantity - Math.abs(position.quantity)) > tolerance) return undefined;
    return { order, position, leg, remainingQuantity };
}

export function findManagedV12V4ProtectiveOrders(
    openOrders: readonly DirectOpenOrder[],
    positions: readonly DirectPosition[],
): DirectOpenOrder[] {
    const candidates = openOrders
        .map((order) => v12V4ProtectionCandidate(order, positions))
        .filter((entry): entry is V12V4ProtectionCandidate => Boolean(entry));
    if (candidates.length === 0) return [];

    const clientOrderIds = new Set(candidates.map(({ order }) => order.clientOrderId));
    if (clientOrderIds.size !== candidates.length) return [];

    const managed = new Set<DirectOpenOrder>();
    for (const position of positions) {
        if (!Number.isFinite(position.quantity) || Math.abs(position.quantity) <= MIN_REMAINING_QUANTITY) continue;
        const matching = candidates.filter(({ position: candidatePosition }) => candidatePosition === position);
        const stops = matching.filter((entry) => entry.leg === "STOP");
        const takeProfits = matching.filter((entry) => entry.leg === "TP");
        // Exactly one resident STOP is mandatory.  TP is optional because
        // V4 can intentionally run with STOP-only protection during a
        // lifecycle transition or after a TP has been retired.
        if (stops.length !== 1 || takeProfits.length > 1) continue;
        managed.add(stops[0].order);
        if (takeProfits.length === 1) managed.add(takeProfits[0].order);
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

type HypeZecProtectionCandidate = {
    order: DirectOpenOrder;
    position: DirectPosition;
    leg: "STOP" | "TP";
    remainingQuantity: number;
};

function hypeZecProtectionCandidate(
    order: DirectOpenOrder,
    positions: readonly DirectPosition[],
): HypeZecProtectionCandidate | undefined {
    const symbol = String(order.symbol || "").trim().toUpperCase();
    if (symbol !== "HYPEUSDT" && symbol !== "ZECUSDT") return undefined;
    const match = /^hz-(stop|tp)-[a-z0-9_-]+$/i.exec(String(order.clientOrderId || ""));
    if (!match || order.reduceOnly !== true || !["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(String(order.status || "").toUpperCase())) return undefined;
    const leg = match[1].toLowerCase() === "stop" ? "STOP" : "TP";
    const type = String(order.type || "").toUpperCase();
    if ((leg === "STOP" && type !== "STOP_MARKET") || (leg === "TP" && type !== "TAKE_PROFIT_MARKET")) return undefined;
    if (!(Number.isFinite(order.quantity) && order.quantity > 0) || !(Number.isFinite(order.executedQuantity) && order.executedQuantity >= 0 && order.executedQuantity <= order.quantity)) return undefined;
    const position = positions.find((row) => row.symbol.toUpperCase() === symbol && row.quantity > MIN_REMAINING_QUANTITY && row.positionSide !== "SHORT");
    if (!position || order.side !== "SELL") return undefined;
    const remainingQuantity = order.quantity - order.executedQuantity;
    const tolerance = Math.max(1e-8, Math.abs(position.quantity) * PROTECTION_TOLERANCE_PCT);
    if (remainingQuantity <= MIN_REMAINING_QUANTITY || Math.abs(remainingQuantity - position.quantity) > tolerance) return undefined;
    return { order, position, leg, remainingQuantity };
}

export function findManagedHypeZecProtectiveOrders(
    openOrders: readonly DirectOpenOrder[],
    positions: readonly DirectPosition[],
): DirectOpenOrder[] {
    const candidates = openOrders
        .map((order) => hypeZecProtectionCandidate(order, positions))
        .filter((entry): entry is HypeZecProtectionCandidate => Boolean(entry));
    const managed = new Set<DirectOpenOrder>();
    for (const position of positions) {
        const symbol = position.symbol.toUpperCase();
        if ((symbol !== "HYPEUSDT" && symbol !== "ZECUSDT") || position.quantity <= MIN_REMAINING_QUANTITY) continue;
        const matching = candidates.filter(({ position: candidatePosition }) => candidatePosition === position);
        if (matching.filter((entry) => entry.leg === "STOP").length !== 1 || matching.filter((entry) => entry.leg === "TP").length !== 1) continue;
        for (const entry of matching) managed.add(entry.order);
    }
    return openOrders.filter((order) => managed.has(order));
}

type IdlePriorityShortProtectionCandidate = {
    order: DirectOpenOrder;
    position: DirectPosition;
    leg: "STOP" | "TP";
    remainingQuantity: number;
};

function idlePriorityShortProtectionCandidate(
    order: DirectOpenOrder,
    positions: readonly DirectPosition[],
): IdlePriorityShortProtectionCandidate | undefined {
    const symbol = String(order.symbol || "").trim().toUpperCase();
    const match = /^idle-(stop|tp)-[a-f0-9]{16,36}$/i.exec(String(order.clientOrderId || ""));
    if (!symbol || !match || order.reduceOnly !== true) return undefined;
    if (!["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(String(order.status || "").toUpperCase())) return undefined;
    const leg = match[1].toLowerCase() === "stop" ? "STOP" : "TP";
    const type = String(order.type || "").toUpperCase();
    if ((leg === "STOP" && type !== "STOP_MARKET") || (leg === "TP" && type !== "TAKE_PROFIT_MARKET")) return undefined;
    if (!(Number.isFinite(order.quantity) && order.quantity > 0) || !(Number.isFinite(order.executedQuantity) && order.executedQuantity >= 0 && order.executedQuantity <= order.quantity)) return undefined;
    const position = positions.find((row) => row.symbol.toUpperCase() === symbol && row.quantity < -MIN_REMAINING_QUANTITY);
    if (!position || order.side !== "BUY") return undefined;
    const remainingQuantity = order.quantity - order.executedQuantity;
    const tolerance = Math.max(1e-8, Math.abs(position.quantity) * PROTECTION_TOLERANCE_PCT);
    if (remainingQuantity <= MIN_REMAINING_QUANTITY || Math.abs(remainingQuantity - Math.abs(position.quantity)) > tolerance) return undefined;
    return { order, position, leg, remainingQuantity };
}

/**
 * Idle SHORT owns one full-quantity STOP and one full-quantity TP.  Other
 * runners may observe those reduce-only orders during their read-only
 * preflight, but they must only treat the pair as managed when both legs
 * match the live short position exactly.  Any mismatch remains fail-closed.
 */
export function findManagedIdlePriorityShortProtectiveOrders(
    openOrders: readonly DirectOpenOrder[],
    positions: readonly DirectPosition[],
): DirectOpenOrder[] {
    const candidates = openOrders
        .map((order) => idlePriorityShortProtectionCandidate(order, positions))
        .filter((entry): entry is IdlePriorityShortProtectionCandidate => Boolean(entry));
    if (candidates.length === 0) return [];
    const clientOrderIds = new Set(candidates.map(({ order }) => order.clientOrderId));
    if (clientOrderIds.size !== candidates.length) return [];

    const managed = new Set<DirectOpenOrder>();
    for (const position of positions) {
        if (!Number.isFinite(position.quantity) || position.quantity >= -MIN_REMAINING_QUANTITY) continue;
        const matching = candidates.filter(({ position: candidatePosition }) => candidatePosition === position);
        if (matching.filter((entry) => entry.leg === "STOP").length !== 1 || matching.filter((entry) => entry.leg === "TP").length !== 1) continue;
        for (const entry of matching) managed.add(entry.order);
    }
    return openOrders.filter((order) => managed.has(order));
}

export function isManagedHypeZecProtectiveOrder(
    order: DirectOpenOrder,
    openOrders: readonly DirectOpenOrder[],
    positions: readonly DirectPosition[],
): boolean {
    return findManagedHypeZecProtectiveOrders(openOrders, positions).some((candidate) => candidate === order);
}

/** Shape recognition is only an ownership filter. Each owner independently verifies durable ID/price via venue read-back. */
export function findManagedOrdinaryResidentStops(orders:readonly DirectOpenOrder[], positions:readonly DirectPosition[]):DirectOpenOrder[]{
 return orders.filter(o=>{
  if(!/^(pengu|q102)-stop-[a-f0-9]{22}$/.test(o.clientOrderId)||o.type!=="STOP_MARKET"||o.reduceOnly!==true||!["NEW","PARTIALLY_FILLED"].includes(o.status||"")||!(Number.isFinite(o.stopPrice)&&o.stopPrice!>0))return false;
  if(o.clientOrderId.startsWith("pengu-")&&o.symbol!=="PENGUUSDT")return false;
  const p=positions.find(p=>p.symbol===o.symbol&&Math.abs(p.quantity)>1e-12);
  if(!p||o.side!==(p.quantity>0?"SELL":"BUY")||!Number.isFinite(o.executedQuantity)||o.executedQuantity<0)return false;
  if(Math.abs(o.quantity-o.executedQuantity-Math.abs(p.quantity))>Math.max(1e-8,Math.abs(p.quantity)*1e-9))return false;
  return orders.filter(row=>row.symbol===o.symbol&&/^(pengu|q102)-stop-/.test(row.clientOrderId)).length===1;
 });
}
