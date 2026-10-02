import { createHash } from "node:crypto";

import { V12AsterLiveAdapter, deterministicV12ClientOrderId } from "@/lib/v12-aster-live-adapter";
import { cancelV12Protection } from "@/lib/v12-resident-stop-lifecycle";
import {
    FileV12X1AllRunnerStateStore,
    type V12ActivePositionState,
    type V12PendingOrderState,
    type V12X1AllRunnerState,
} from "@/lib/v12-x1-all-runner-state";
import {
    q102MayPreemptV12,
    setV12SymbolCooldown,
    V12_FORMAL_PRIORITY_20261003,
} from "@/lib/v12-formal-priority-policy";

const EPS = 1e-9;
const DEFAULT_MAX_DATA_AGE_MS = 5 * 60_000;

export interface V12Q102PriorityPreemptionInput {
    adapter: V12AsterLiveAdapter;
    requiredGross: number;
    equity: number;
    q102Family?: string;
    expectedRuntimeSha?: string;
    causeIdempotencyKey: string;
    statePath?: string;
    maxDataAgeMs?: number;
    now?: () => number;
}

export type V12Q102PriorityPreemptionResult =
    | { status: "not-needed"; message: string; freedGross: number; exits: number }
    | { status: "reduced"; message: string; freedGross: number; exits: number }
    | { status: "blocked"; message: string; freedGross: number; exits: number };

function actives(state: V12X1AllRunnerState): V12ActivePositionState[] {
    if (state.activePositions?.length) return [...state.activePositions];
    return state.active ? [state.active] : [];
}

function updateActives(state: V12X1AllRunnerState, rows: V12ActivePositionState[]) {
    const activePositions = rows.filter((row) => row.quantity > EPS);
    state.activePositions = activePositions.length ? activePositions : undefined;
    state.active = activePositions[0];
}

async function failClosed(
    store: FileV12X1AllRunnerStateStore,
    state: V12X1AllRunnerState,
    message: string,
    freedGross: number,
    exits: number,
): Promise<V12Q102PriorityPreemptionResult> {
    state.manualReview = message;
    state.reconciliationStatus = "MANUAL_REVIEW";
    await store.save(state);
    return { status: "blocked", message, freedGross, exits };
}

function rankPriority(row: V12ActivePositionState) {
    const rank = Number(row.entryRank || 1);
    const index = (V12_FORMAL_PRIORITY_20261003.q102V12PreemptionRankOrder as readonly number[]).indexOf(rank);
    return index >= 0 ? index : 99;
}

/**
 * Formal 2026-10-03 Q102 handoff.
 *
 * For PB/REV/HIGH_VOL only, close whole V12 positions in Rank3 -> Rank2 ->
 * Rank1 order until enough current Gross is freed for the Q102 target. The
 * caller must already own the shared account-order lock. Every exit is
 * reduce-only, reconciled against venue positions, and starts the exited
 * symbol's cooldown from the venue's actual fill timestamp.
 */
export async function preemptV12ForQ102Priority(
    input: V12Q102PriorityPreemptionInput,
): Promise<V12Q102PriorityPreemptionResult> {
    if (!q102MayPreemptV12(input.q102Family)) {
        return { status: "not-needed", message: "Q102 family is not authorized to preempt V12.", freedGross: 0, exits: 0 };
    }
    const requiredGross = Number(input.requiredGross);
    if (!Number.isFinite(requiredGross) || requiredGross <= EPS) {
        return { status: "not-needed", message: "No V12 priority handoff is required.", freedGross: 0, exits: 0 };
    }
    const equity = Number(input.equity);
    if (!Number.isFinite(equity) || equity <= 0) {
        return { status: "blocked", message: "Q102_V12_PRIORITY_EQUITY_INVALID", freedGross: 0, exits: 0 };
    }

    const statePath = String(
        input.statePath || process.env.V12_X1_ALL_STATE_PATH || ".runtime-state/v12-x1-all/runner.json",
    ).trim();
    const store = new FileV12X1AllRunnerStateStore(statePath, "LIVE");
    const state = await store.load();
    const expectedSha = String(input.expectedRuntimeSha || process.env.DISDEX_RELEASE_SHA || "").trim();
    if (expectedSha && (!/^[a-f0-9]{40}$/i.test(expectedSha)
        || String(state.runtimeCommitSha || "").toLowerCase() !== expectedSha.toLowerCase())) {
        return { status: "blocked", message: "Q102_V12_PRIORITY_RUNTIME_SHA_MISMATCH", freedGross: 0, exits: 0 };
    }
    if (state.killSwitch?.active) {
        return { status: "blocked", message: "Q102_V12_PRIORITY_LOCAL_KILL_SWITCH_ACTIVE", freedGross: 0, exits: 0 };
    }
    if (state.manualReview) {
        return { status: "blocked", message: "Q102_V12_PRIORITY_STATE_MANUAL_REVIEW:" + state.manualReview, freedGross: 0, exits: 0 };
    }
    if (state.pending) {
        return { status: "blocked", message: "Q102_V12_PRIORITY_PENDING_ORDER_REQUIRES_RECONCILIATION", freedGross: 0, exits: 0 };
    }

    const rows = actives(state).sort((a, b) =>
        rankPriority(a) - rankPriority(b)
        || Number(a.entrySignalTs || 0) - Number(b.entrySignalTs || 0)
        || a.symbol.localeCompare(b.symbol),
    );
    if (!rows.length) {
        return { status: "not-needed", message: "No V12 position is available for priority handoff.", freedGross: 0, exits: 0 };
    }

    const now = input.now || Date.now;
    const maxAgeMs = input.maxDataAgeMs ?? DEFAULT_MAX_DATA_AGE_MS;
    let freedGross = 0;
    let exits = 0;

    for (const original of rows) {
        if (freedGross + EPS >= requiredGross) break;
        if (![1, 2, 3].includes(Number(original.entryRank || 1))) continue;
        if (original.protection.manualReview) {
            return failClosed(store, state, "Q102_V12_PRIORITY_PROTECTION_ALREADY_MANUAL_REVIEW", freedGross, exits);
        }

        const owned = (await input.adapter.getPositions()).filter(
            row => row.symbol.toUpperCase() === original.symbol.toUpperCase() && Math.abs(row.quantity) > EPS,
        );
        const actual = owned[0];
        const actualSide = actual?.positionSide === "LONG" || actual?.positionSide === "SHORT"
            ? actual.positionSide : Number(actual?.quantity) < 0 ? "SHORT" : "LONG";
        if (owned.length !== 1 || actualSide !== original.side
            || Math.abs(Math.abs(Number(actual?.quantity)) - original.quantity) > Math.max(1e-8, original.quantity * 1e-6)) {
            return failClosed(store, state, "Q102_V12_PRIORITY_VENUE_OWNERSHIP_MISMATCH:" + original.symbol, freedGross, exits);
        }

        const quote = await input.adapter.executor.getMarketQuote(original.symbol);
        const decisionNow = now();
        if (!Number.isFinite(quote.updatedAt) || quote.updatedAt <= 0
            || quote.updatedAt > decisionNow || decisionNow - quote.updatedAt > maxAgeMs) {
            return failClosed(store, state, "Q102_V12_PRIORITY_QUOTE_STALE:" + original.symbol, freedGross, exits);
        }
        const expectedPrice = original.side === "LONG" ? quote.bidPrice : quote.askPrice;
        const currentGross = original.quantity * expectedPrice / equity;
        if (!(currentGross > EPS)) {
            return failClosed(store, state, "Q102_V12_PRIORITY_CURRENT_GROSS_INVALID:" + original.symbol, freedGross, exits);
        }

        const fingerprint = createHash("sha256")
            .update([
                "Q102_V12_PRIORITY",
                input.causeIdempotencyKey,
                original.positionId,
                original.entryRank || 1,
            ].join("|"))
            .digest("hex")
            .slice(0, 16);
        const clientOrderId = deterministicV12ClientOrderId({
            action: "EXIT",
            signalTs: decisionNow,
            symbol: original.symbol,
            side: original.side,
            version: fingerprint,
        });
        const pending: V12PendingOrderState = {
            idempotencyKey: clientOrderId,
            action: "EXIT",
            clientOrderId,
            symbol: original.symbol,
            side: original.side,
            quantity: original.quantity,
            signalTs: decisionNow,
            expectedPrice,
            reason: `Q102_PRIORITY_PREEMPT:${String(input.q102Family || "UNKNOWN").toUpperCase()}:V12_R${original.entryRank || 1}`,
            createdAt: decisionNow,
            positionId: original.positionId,
        };
        state.pending = pending;
        await store.save(state);

        const result = await input.adapter.executeExit({
            signalTs: decisionNow,
            symbol: original.symbol,
            positionSide: original.side,
            quantity: original.quantity,
            expectedPrice,
            clientOrderId,
            reason: pending.reason,
        });
        if (result.status === "UNKNOWN" || result.executionUnknown) {
            return failClosed(store, state, "Q102_V12_PRIORITY_EXIT_UNKNOWN:" + clientOrderId, freedGross, exits);
        }
        const venueRows = (await input.adapter.getPositions()).filter(
            (row) => row.symbol.toUpperCase() === original.symbol.toUpperCase() && Math.abs(row.quantity) > EPS,
        );
        if (venueRows.length) {
            return failClosed(store, state, "Q102_V12_PRIORITY_EXIT_POSITION_REMAINS:" + original.symbol, freedGross, exits);
        }
        if (result.status !== "FILLED"
            || Math.abs(result.executedQuantity - original.quantity) > Math.max(1e-8, original.quantity * 1e-6)) {
            return failClosed(store, state, "Q102_V12_PRIORITY_EXIT_FILL_NOT_VERIFIED:" + clientOrderId, freedGross, exits);
        }
        const actualExitTs = Number(result.updatedAt || 0);
        if (!Number.isFinite(actualExitTs) || !(actualExitTs > 0) || actualExitTs > now()) {
            return failClosed(store, state, "Q102_V12_PRIORITY_EXIT_TIMESTAMP_MISSING:" + clientOrderId, freedGross, exits);
        }

        await cancelV12Protection(input.adapter, original.protection);
        updateActives(state, actives(state).filter((row) => row.positionId !== original.positionId));
        state.pending = undefined;
        state.lastCompletedIdempotencyKey = clientOrderId;
        setV12SymbolCooldown(state, original.symbol, actualExitTs);
        state.lastPriorityHandoff = {
            family: String(input.q102Family).toUpperCase(), symbol: original.symbol,
            victimRank: Number(original.entryRank || 1), quantity: original.quantity,
            freedGross: currentGross, actualExitTs, reason: pending.reason!, clientOrderId,
        };
        state.reconciliationStatus = "PASS";
        await store.save(state);

        freedGross += currentGross;
        exits += 1;
        // The caller re-fetches equity, all positions, Q102 quote and Governor
        // capacity after this confirmed fill. Never close a second victim from
        // the pre-exit equity/Gross snapshot.
        break;
    }

    if (!(freedGross > EPS)) {
        return { status: "not-needed", message: "No eligible V12 position was preempted.", freedGross: 0, exits: 0 };
    }
    return {
        status: "reduced",
        message: freedGross + EPS >= requiredGross
            ? "Q102_V12_PRIORITY_CAPACITY_RELEASED"
            : "Q102_V12_PRIORITY_CAPACITY_PARTIALLY_RELEASED",
        freedGross,
        exits,
    };
}
