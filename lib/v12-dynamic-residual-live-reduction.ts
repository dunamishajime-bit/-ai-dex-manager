import { createHash } from "node:crypto";

import { V12AsterLiveAdapter, deterministicV12ClientOrderId } from "@/lib/v12-aster-live-adapter";
import { resizeV12ProtectionQuantity } from "@/lib/v12-resident-stop-lifecycle";
import {
    FileV12X1AllRunnerStateStore,
    type V12ActivePositionState,
    type V12PendingOrderState,
    type V12X1AllRunnerState,
} from "@/lib/v12-x1-all-runner-state";

const EPS = 1e-9;
const DEFAULT_MAX_DATA_AGE_MS = 5 * 60_000;

export interface V12DynamicResidualReductionInput {
    adapter: V12AsterLiveAdapter;
    requiredGross: number;
    equity: number;
    causeIdempotencyKey: string;
    statePath?: string;
    maxDataAgeMs?: number;
    now?: () => number;
}

export type V12DynamicResidualReductionResult =
    | { status: "not-needed"; message: string; trimmedGross: number }
    | { status: "reduced"; message: string; trimmedGross: number; trims: number }
    | { status: "blocked"; message: string; trimmedGross: number };

function actives(state: V12X1AllRunnerState): V12ActivePositionState[] {
    if (state.activePositions?.length) return [...state.activePositions];
    return state.active ? [state.active] : [];
}

async function failClosed(
    store: FileV12X1AllRunnerStateStore,
    state: V12X1AllRunnerState,
    message: string,
): Promise<V12DynamicResidualReductionResult> {
    state.manualReview = message;
    state.reconciliationStatus = "MANUAL_REVIEW";
    await store.save(state);
    return { status: "blocked", message, trimmedGross: 0 };
}

function updateActives(state: V12X1AllRunnerState, rows: V12ActivePositionState[]) {
    const activePositions = rows.filter((row) => row.quantity > EPS);
    state.activePositions = activePositions.length ? activePositions : undefined;
    state.active = activePositions[0];
}

/**
 * Reduce only durable V12 Dynamic residual notional to free Gross for a Core
 * entry. The caller must already own the shared account-order lock.
 * An unresolved pending trim is never blindly retried.
 */
export async function reduceV12DynamicResidualForCoreConflict(
    input: V12DynamicResidualReductionInput,
): Promise<V12DynamicResidualReductionResult> {
    const requiredGross = Number(input.requiredGross);
    if (!Number.isFinite(requiredGross) || requiredGross <= EPS) {
        return { status: "not-needed", message: "No V12 Dynamic reduction is required.", trimmedGross: 0 };
    }
    const equity = Number(input.equity);
    if (!Number.isFinite(equity) || equity <= 0) {
        return { status: "blocked", message: "V12_DYNAMIC_TRIM_EQUITY_INVALID", trimmedGross: 0 };
    }
    const statePath = String(
        input.statePath || process.env.V12_X1_ALL_STATE_PATH || ".runtime-state/v12-x1-all/runner.json",
    ).trim();
    const store = new FileV12X1AllRunnerStateStore(statePath, "LIVE");
    const state = await store.load();
    if (state.manualReview) {
        return { status: "blocked", message: "V12_DYNAMIC_TRIM_STATE_MANUAL_REVIEW:" + state.manualReview, trimmedGross: 0 };
    }
    if (state.pending) {
        return { status: "blocked", message: "V12_DYNAMIC_TRIM_PENDING_ORDER_REQUIRES_RECONCILIATION", trimmedGross: 0 };
    }

    const rows = actives(state);
    const availableDynamicGross = rows.reduce(
        (sum, row) => sum + Math.max(0, row.dynamicGross),
        0,
    );
    if (!(availableDynamicGross > EPS)) {
        return {
            status: "not-needed",
            message: "V12_DYNAMIC_TRIM_NO_DYNAMIC_GROSS_AVAILABLE",
            trimmedGross: 0,
        };
    }

    const now = input.now || Date.now;
    const maxAgeMs = input.maxDataAgeMs ?? DEFAULT_MAX_DATA_AGE_MS;
    let remainingGross = requiredGross;
    let trimmedGross = 0;
    let trims = 0;

    for (const original of rows) {
        if (remainingGross <= EPS) break;
        if (!(original.dynamicGross > EPS && original.dynamicQuantity > EPS)) continue;
        if (original.protection.manualReview) {
            return failClosed(store, state, "V12_DYNAMIC_TRIM_PROTECTION_ALREADY_MANUAL_REVIEW");
        }

        const targetGross = Math.min(remainingGross, original.dynamicGross);
        const rawQuantity = original.dynamicQuantity * (targetGross / original.dynamicGross);
        const quote = await input.adapter.executor.getMarketQuote(original.symbol);
        const decisionNow = now();
        if (!Number.isFinite(quote.updatedAt) || quote.updatedAt <= 0
            || quote.updatedAt > decisionNow || decisionNow - quote.updatedAt > maxAgeMs) {
            return failClosed(store, state, "V12_DYNAMIC_TRIM_QUOTE_STALE:" + original.symbol);
        }
        const expectedPrice = original.side === "LONG" ? quote.bidPrice : quote.askPrice;

        const normalized = await input.adapter.executor.normalizeMarketQuantity(
            original.symbol,
            rawQuantity,
            expectedPrice,
            { allowBelowMinNotional: true },
        );
        if (!(normalized.quantity > EPS)
            || normalized.quantity > original.dynamicQuantity + Math.max(1e-8, original.dynamicQuantity * 0.001)) {
            return failClosed(store, state, "V12_DYNAMIC_TRIM_NORMALIZATION_INVALID:" + original.symbol);
        }

        const trimGross = original.dynamicGross * (normalized.quantity / original.dynamicQuantity);
        const fingerprint = createHash("sha256")
            .update(["V12_DYNAMIC_TRIM", input.causeIdempotencyKey, original.positionId, normalized.quantity].join("|"))
            .digest("hex")
            .slice(0, 16);
        const clientOrderId = deterministicV12ClientOrderId({
            action: "DYNAMIC_TRIM",
            signalTs: decisionNow,
            symbol: original.symbol,
            side: original.side,
            version: fingerprint,
        });
        const pending: V12PendingOrderState = {
            idempotencyKey: clientOrderId,
            action: "DYNAMIC_TRIM",
            clientOrderId,
            symbol: original.symbol,
            side: original.side,
            quantity: normalized.quantity,
            signalTs: decisionNow,
            expectedPrice,
            requestedGross: trimGross,
            baseRequestedGross: 0,
            dynamicRequestedGross: trimGross,
            reason: "CORE_PRIORITY_DYNAMIC_TRIM:" + input.causeIdempotencyKey,
            createdAt: decisionNow,
            positionId: original.positionId,
        };
        state.pending = pending;
        await store.save(state);

        const result = await input.adapter.executeDynamicTrim({
            signalTs: decisionNow,
            symbol: original.symbol,
            positionSide: original.side,
            quantity: normalized.quantity,
            expectedPrice,
            clientOrderId,
        });
        if (result.status === "UNKNOWN" || result.executionUnknown) {
            return failClosed(store, state, "V12_DYNAMIC_TRIM_EXECUTION_UNKNOWN:" + clientOrderId);
        }
        if (result.status !== "FILLED" || result.executedQuantity <= EPS) {
            return failClosed(store, state, "V12_DYNAMIC_TRIM_NOT_FILLED:" + result.status);
        }
        if (result.executedQuantity > original.dynamicQuantity
            + Math.max(1e-8, original.dynamicQuantity * 0.001)) {
            return failClosed(store, state, "V12_DYNAMIC_TRIM_EXECUTED_OVER_DYNAMIC_QUANTITY");
        }

        const venueRows = (await input.adapter.getPositions()).filter(
            (row) => row.symbol.toUpperCase() === original.symbol.toUpperCase()
                && Math.abs(row.quantity) > EPS,
        );
        if (venueRows.length !== 1) {
            return failClosed(
                store,
                state,
                "V12_DYNAMIC_TRIM_POSITION_READBACK_MISMATCH:" + original.symbol,
            );
        }
        const venueQuantity = Math.abs(venueRows[0].quantity);
        if (venueQuantity + Math.max(1e-8, original.baseQuantity * 0.001) < original.baseQuantity) {
            return failClosed(store, state, "V12_DYNAMIC_TRIM_TOUCHED_BASE_QUANTITY");
        }

        const nextDynamicQuantity = Math.max(0, venueQuantity - original.baseQuantity);
        const dynamicRatio = original.dynamicQuantity > EPS
            ? nextDynamicQuantity / original.dynamicQuantity
            : 0;
        const nextDynamicGross = Math.max(0, original.dynamicGross * dynamicRatio);
        const nextProtection = await resizeV12ProtectionQuantity(
            input.adapter,
            original.protection,
            venueQuantity,
        );
        if (nextProtection.manualReview) {
            return failClosed(store, state, nextProtection.manualReview);
        }

        const next: V12ActivePositionState = {
            ...original,
            quantity: venueQuantity,
            gross: original.baseGross + nextDynamicGross,
            baseQuantity: original.baseQuantity,
            dynamicQuantity: nextDynamicQuantity,
            dynamicGross: nextDynamicGross,
            dynamicUpdatedAt: now(),
            protection: nextProtection,
        };
        const latestRows = actives(state).map(
            (row) => row.positionId === original.positionId ? next : row,
        );
        updateActives(state, latestRows);
        state.pending = undefined;
        state.lastCompletedIdempotencyKey = clientOrderId;
        state.latestTrimOrderId = result.clientOrderId || clientOrderId;
        state.lastTrimReason = input.causeIdempotencyKey;
        state.lastTrimAt = decisionNow;
        state.lastTrimQuantity = result.executedQuantity;
        state.trimCount = (state.trimCount || 0) + 1;
        state.reconciliationStatus = "PASS";
        await store.save(state);

        const actualTrimmedGross = Math.max(
            0,
            original.dynamicGross - nextDynamicGross,
        );
        trimmedGross += actualTrimmedGross;
        remainingGross = Math.max(0, requiredGross - trimmedGross);
        trims += 1;
    }

    return {
        status: "reduced",
        message: remainingGross > 1e-6
            ? "V12_DYNAMIC_RESIDUAL_PARTIALLY_REDUCED_FOR_CORE"
            : "V12_DYNAMIC_RESIDUAL_REDUCED_FOR_CORE",
        trimmedGross,
        trims,
    };
}
