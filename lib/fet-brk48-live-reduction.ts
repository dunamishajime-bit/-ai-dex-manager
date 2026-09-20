import { createHash } from "node:crypto";

import type { DirectTradeExecutor } from "@/lib/direct-trade-executor";
import type { V12AsterLiveAdapter } from "@/lib/v12-aster-live-adapter";
import { readFetBrk48State, writeFetBrk48State } from "@/lib/fet-brk48-state";
import { readQuality102CausalV1Ownership, quality102OwnsPosition } from "@/lib/disdex-quality102-causal-v1-ownership";

const EPS = 1e-9;

export interface FetCoreReductionInput {
    executor: DirectTradeExecutor;
    adapter: V12AsterLiveAdapter;
    causeIdempotencyKey: string;
    statePath?: string;
    maxSlippageBps: number;
    expectedRuntimeSha?: string;
    now?: () => number;
}

async function stopIsActive(adapter: V12AsterLiveAdapter, clientOrderId: string) {
    const open = await adapter.getOpenOrders();
    return open.some((row) => row.clientOrderId === clientOrderId
        && ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(String(row.status || "").toUpperCase()));
}

export async function reduceFetBrk48ForCoreConflict(input: FetCoreReductionInput) {
    const now = input.now || Date.now;
    const path = input.statePath || process.env.FET_BRK48_STATE_PATH || "/var/lib/disdex/fet-brk48-residual/state.json";
    let state;
    try {
        state = await readFetBrk48State(path, input.expectedRuntimeSha);
    } catch (error) {
        return { status: "blocked" as const, message: error instanceof Error ? error.message : String(error) };
    }
    if (state.manualReview) return { status: "blocked" as const, message: `FET_RESIDUAL_MANUAL_REVIEW:${state.manualReview}` };

    const q102 = await readQuality102CausalV1Ownership({
        expectedRuntimeSha: process.env.DISDEX_Q102_RUNTIME_SHA || input.expectedRuntimeSha,
    });
    const allFet = (await input.executor.getPositions()).filter(
        (position) => position.symbol.toUpperCase() === "FETUSDT" && Math.abs(position.quantity) > EPS,
    );
    const q102Fet = allFet.filter((position) => quality102OwnsPosition(q102, position));
    const residualRows = allFet.filter((position) => !quality102OwnsPosition(q102, position));
    const position = state.position;

    if (!position) {
        if (residualRows.length) return { status: "blocked" as const, message: "FET_RESIDUAL_UNOWNED_POSITION_PRESENT" };
        return { status: "not-needed" as const, message: q102Fet.length ? "FET_OWNED_BY_Q102" : "FET_RESIDUAL_FLAT" };
    }
    if (q102Fet.length) return { status: "blocked" as const, message: "FET_RESIDUAL_Q102_OWNERSHIP_COLLISION" };
    if (state.pending) return { status: "blocked" as const, message: "FET_RESIDUAL_PENDING_REQUIRES_RECONCILIATION" };

    if (residualRows.length === 0) {
        // A flat venue with a persisted FET position is only safe to clear when
        // its protective stop can be proven inactive/removed.
        if (await stopIsActive(input.adapter, position.stopClientOrderId)) {
            await input.adapter.cancel(position.stopClientOrderId);
            if (await stopIsActive(input.adapter, position.stopClientOrderId)) {
                state.manualReview = "FET_RESIDUAL_STALE_STOP_REMAINS";
                await writeFetBrk48State(path, state);
                return { status: "blocked" as const, message: state.manualReview };
            }
        }
        state.position = undefined;
        state.lastReconciledAt = now();
        await writeFetBrk48State(path, state);
        return { status: "not-needed" as const, message: "FET_RESIDUAL_ALREADY_FLAT_RECONCILED" };
    }

    if (residualRows.length !== 1
        || residualRows[0].quantity < 0
        || Math.abs(Math.abs(residualRows[0].quantity) - position.quantity) > Math.max(1e-8, position.quantity * 0.02)) {
        return { status: "blocked" as const, message: "FET_RESIDUAL_POSITION_MISMATCH" };
    }

    const quote = await input.executor.getMarketQuote("FETUSDT");
    if (!(quote.bidPrice > 0) || !(quote.updatedAt > 0)) return { status: "blocked" as const, message: "FET_RESIDUAL_QUOTE_INVALID" };

    const key = createHash("sha256")
        .update(`FET_RESIDUAL|PREEMPT|${input.causeIdempotencyKey}|${position.entryTs}|${position.quantity}`)
        .digest("hex");
    const clientOrderId = `fet-red-${key.slice(0, 27)}`.slice(0, 36);
    state.pending = {
        action: "PREEMPT",
        idempotencyKey: key,
        clientOrderId,
        symbol: "FETUSDT",
        side: "SELL",
        quantity: position.quantity,
        referenceTs: quote.updatedAt,
        createdAt: now(),
        updatedAt: now(),
        expectedPrice: quote.bidPrice,
        reason: `CORE_PREEMPT:${input.causeIdempotencyKey}`,
    };
    await writeFetBrk48State(path, state);

    const result = await input.executor.executeMarket({
        requestId: key,
        clientOrderId,
        symbol: "FETUSDT",
        side: "SELL",
        quantity: position.quantity,
        reduceOnly: true,
        expectedPrice: quote.bidPrice,
        maxSlippageBps: input.maxSlippageBps,
        reason: "FET_BRK48_CORE_PREEMPT",
    });
    if (result.status === "UNKNOWN" || result.executionUnknown) {
        state.manualReview = "FET_PREEMPT_EXECUTION_UNKNOWN";
        await writeFetBrk48State(path, state);
        return { status: "blocked" as const, message: state.manualReview };
    }

    const remaining = (await input.executor.getPositions()).filter(
        (row) => row.symbol.toUpperCase() === "FETUSDT" && Math.abs(row.quantity) > EPS,
    );
    if (remaining.length) {
        state.manualReview = "FET_PREEMPT_POSITION_REMAINS";
        await writeFetBrk48State(path, state);
        return { status: "blocked" as const, message: state.manualReview };
    }

    await input.adapter.cancel(position.stopClientOrderId);
    if (await stopIsActive(input.adapter, position.stopClientOrderId)) {
        state.manualReview = "FET_PREEMPT_STOP_CANCEL_NOT_CONFIRMED";
        await writeFetBrk48State(path, state);
        return { status: "blocked" as const, message: state.manualReview };
    }

    state.position = undefined;
    state.pending = undefined;
    state.lastCompletedIdempotencyKey = key;
    state.manualReview = undefined;
    state.lastReconciledAt = now();
    await writeFetBrk48State(path, state);
    return { status: "reduced" as const, message: "FET_RESIDUAL_PREEMPTED", result };
}
