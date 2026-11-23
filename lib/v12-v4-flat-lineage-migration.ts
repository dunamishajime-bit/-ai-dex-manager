import { appendV4ExecutionEvent, type V4ExecutionDocument } from "./v12-v4-execution-store";
import { createProductionState, type ForeignExposure } from "./v12-v4-production-lifecycle";
import type { PendingExposureEntry } from "./disdex-pending-exposure-registry";

const SHA = /^[a-f0-9]{40}$/;
const EPSILON = 1e-8;
const ACTIVE_PENDING = new Set(["PENDING", "SUBMITTED", "UNKNOWN"]);

export type V4FlatVenuePosition = { symbol: string; positionAmt: number | string };
export type V4FlatVenueOrder = {
    symbol: string;
    origQty: number | string;
    executedQty?: number | string;
    reduceOnly: boolean | string;
    status?: string;
};
export type V4FlatLineageEvidence = {
    observedAt: number;
    accountEquityUsd: number;
    availableBalanceUsd: number;
    prices: Record<string, number>;
    positions: readonly V4FlatVenuePosition[];
    openOrders: readonly V4FlatVenueOrder[];
    pendingEntries: readonly PendingExposureEntry[];
};

function symbol(value: string) {
    const normalized = String(value || "").trim().toUpperCase();
    return normalized.endsWith("USDT") ? normalized : `${normalized}USDT`;
}

function side(positionAmt: number): "LONG" | "SHORT" {
    if (positionAmt > EPSILON) return "LONG";
    if (positionAmt < -EPSILON) return "SHORT";
    throw new Error("V4_FLAT_LINEAGE_ZERO_POSITION");
}

function numeric(value: number | string | undefined, label: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`V4_FLAT_LINEAGE_${label}_INVALID`);
    return parsed;
}

function foreignKey(row: ForeignExposure) {
    return `${symbol(row.symbol)}:${row.side}`;
}

function assertFlatLifecycle(observed: V4ExecutionDocument, expectedOldSha: string, newSha: string) {
    if (!SHA.test(expectedOldSha) || !SHA.test(newSha) || expectedOldSha === newSha)
        throw new Error("V4_FLAT_LINEAGE_SHA_INVALID");
    if (observed.schema !== 2 || observed.releaseSha !== expectedOldSha)
        throw new Error("V4_FLAT_LINEAGE_RELEASE_MISMATCH");
    if (observed.state.initial.holdProtected || observed.state.executionReview)
        throw new Error("V4_FLAT_LINEAGE_HOLD_OR_REVIEW_PRESENT");
    if (Object.values(observed.intents).some((intent) => intent.stage !== "TERMINAL"))
        throw new Error("V4_FLAT_LINEAGE_ACTIVE_LIFECYCLE");
    if (Object.values(observed.protections).some((protection) => protection.phase !== "CLOSED"))
        throw new Error("V4_FLAT_LINEAGE_ACTIVE_PROTECTION");
    if (Object.values(observed.state.legs).some((leg) =>
        !["CLOSED", "CANCELLED"].includes(leg.status) ||
        leg.qty > EPSILON || leg.entryNotional > EPSILON || leg.reservationUsd > EPSILON || leg.exitRemainingQty > EPSILON))
        throw new Error("V4_FLAT_LINEAGE_ACTIVE_LIFECYCLE");
    if (observed.state.foreign.some((row) => row.owner === "V12_V4"))
        throw new Error("V4_FLAT_LINEAGE_FOREIGN_OWNER_CONFLICT");
}

function assertVenueMatchesForeign(observed: V4ExecutionDocument, evidence: V4FlatLineageEvidence) {
    if (!Number.isFinite(evidence.observedAt) || evidence.observedAt <= 0)
        throw new Error("V4_FLAT_LINEAGE_OBSERVATION_TIME_INVALID");
    if (!(evidence.accountEquityUsd > 0) || !Number.isFinite(evidence.accountEquityUsd) ||
        !Number.isFinite(evidence.availableBalanceUsd) || evidence.availableBalanceUsd < 0)
        throw new Error("V4_FLAT_LINEAGE_ACCOUNT_NOT_VERIFIED");
    const foreign = observed.state.foreign;
    const foreignByKey = new Map(foreign.map((row) => [foreignKey(row), row]));
    if (foreignByKey.size !== foreign.length) throw new Error("V4_FLAT_LINEAGE_DUPLICATE_FOREIGN_OWNER");
    const venueByKey = new Map<string, number>();
    for (const row of evidence.positions) {
        const positionAmt = numeric(row.positionAmt, "POSITION");
        if (Math.abs(positionAmt) <= EPSILON) continue;
        const key = `${symbol(row.symbol)}:${side(positionAmt)}`;
        venueByKey.set(key, (venueByKey.get(key) || 0) + Math.abs(positionAmt));
    }
    for (const [key, quantity] of venueByKey) {
        const owner = foreignByKey.get(key);
        if (!owner || Math.abs(owner.qty - quantity) > EPSILON)
            throw new Error("V4_FLAT_LINEAGE_POSITION_MISMATCH");
    }
    for (const owner of foreign) {
        const key = foreignKey(owner);
        const quantity = venueByKey.get(key) || 0;
        if (Math.abs(owner.qty - quantity) > EPSILON) throw new Error("V4_FLAT_LINEAGE_POSITION_MISMATCH");
        if (owner.qty > EPSILON) {
            const price = numeric(evidence.prices[symbol(owner.symbol)], "PRICE");
            if (!(price > 0)) throw new Error("V4_FLAT_LINEAGE_PRICE_MISSING");
        }
    }
    for (const order of evidence.openOrders) {
        if (String(order.reduceOnly).toLowerCase() !== "true")
            throw new Error("V4_FLAT_LINEAGE_UNMANAGED_ORDER");
        const orderSymbol = symbol(order.symbol);
        if (!foreign.some((row) => symbol(row.symbol) === orderSymbol))
            throw new Error("V4_FLAT_LINEAGE_UNMANAGED_ORDER");
        const requested = numeric(order.origQty, "ORDER_QTY");
        const executed = numeric(order.executedQty ?? 0, "ORDER_EXECUTED_QTY");
        if (!(requested > 0) || executed < 0 || executed > requested + EPSILON)
            throw new Error("V4_FLAT_LINEAGE_ORDER_QTY_INVALID");
    }
}

export function migrateFlatV4State(args: {
    observed: V4ExecutionDocument;
    expectedOldSha: string;
    newSha: string;
    evidence: V4FlatLineageEvidence;
}): V4ExecutionDocument {
    assertFlatLifecycle(args.observed, args.expectedOldSha, args.newSha);
    if (args.evidence.pendingEntries.some((row) =>
        row.strategyId === "V12_V4" && ACTIVE_PENDING.has(row.status)))
        throw new Error("V4_FLAT_LINEAGE_PENDING_EXPOSURE");
    assertVenueMatchesForeign(args.observed, args.evidence);

    const initial = createProductionState({
        equityUsd: args.observed.state.equityUsd,
        foreign: structuredClone(args.observed.state.foreign),
        holdProtected: false,
    });
    const base: V4ExecutionDocument = {
        schema: 2,
        releaseSha: args.newSha,
        revision: 0,
        state: initial,
        intents: {},
        protections: {},
    };
    const marked = appendV4ExecutionEvent(base, {
        type: "ACCOUNT_MARK",
        eventId: `v4-flat-lineage-migration:${args.newSha}:${args.evidence.observedAt}`,
        ts: args.evidence.observedAt,
        equityUsd: args.evidence.accountEquityUsd,
        prices: structuredClone(args.evidence.prices),
        foreign: structuredClone(args.observed.state.foreign),
    });
    return marked;
}
