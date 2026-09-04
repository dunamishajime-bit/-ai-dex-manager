import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
    FileQuality102CausalV1StateStore,
    type Quality102CausalV1PendingOrder,
    type Quality102CausalV1State,
} from "@/lib/disdex-quality102-causal-v1-state";
import { readQuality102CausalV1Ownership } from "@/lib/disdex-quality102-causal-v1-ownership";
import {
    markToMarketReducePosition,
    type MarkToMarketReduction,
    type StrictPortfolioPosition,
} from "@/lib/disdex-strict-portfolio-planner";
import type {
    DirectMarketQuote,
    DirectPosition,
    DirectTradeExecutor,
    DirectTradeResult,
} from "@/lib/direct-trade-executor";

const STRATEGY_ID = "QUALITY102_CAUSAL_V1" as const;
const EPSILON = 1e-9;
const DEFAULT_MAX_DATA_AGE_MS = 5 * 60_000;

export interface Quality102CausalV1LiveReductionInput {
    executor: DirectTradeExecutor;
    reduction: MarkToMarketReduction;
    causeIdempotencyKey: string;
    maxSlippageBps: number;
    maxDataAgeMs?: number;
    statePath?: string;
    expectedRuntimeSha?: string;
    now?: () => number;
}

export type Quality102CausalV1LiveReductionResult =
    | { status: "not-needed"; message: string }
    | { status: "reduced"; message: string; reduction: MarkToMarketReduction; result: DirectTradeResult }
    | { status: "blocked"; message: string };

function failureMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function nonZero(position: DirectPosition): boolean {
    return Number.isFinite(position.quantity) && Math.abs(position.quantity) > EPSILON;
}

function sideOf(position: DirectPosition): -1 | 1 {
    if (position.positionSide === "SHORT") return -1;
    if (position.positionSide === "LONG") return 1;
    return position.quantity < 0 ? -1 : 1;
}

function validQuote(quote: DirectMarketQuote, symbol: string, now: number, maxAgeMs: number): boolean {
    return quote.symbol.toUpperCase() === symbol.toUpperCase()
        && Number.isFinite(quote.bidPrice) && quote.bidPrice > 0
        && Number.isFinite(quote.askPrice) && quote.askPrice > 0
        && quote.askPrice >= quote.bidPrice
        && Number.isFinite(quote.midPrice) && quote.midPrice > 0
        && Number.isFinite(quote.spreadBps) && quote.spreadBps >= 0
        && Number.isFinite(quote.bidQuantity) && quote.bidQuantity > 0
        && Number.isFinite(quote.askQuantity) && quote.askQuantity > 0
        && Number.isFinite(quote.updatedAt) && quote.updatedAt > 0
        && quote.updatedAt <= now && now - quote.updatedAt <= maxAgeMs;
}

function strictPosition(statePosition: NonNullable<Quality102CausalV1State["position"]>, quote: DirectMarketQuote): StrictPortfolioPosition {
    return {
        id: `aster:q102:${statePosition.symbol.toUpperCase()}`,
        strategy: STRATEGY_ID,
        symbol: statePosition.symbol.toUpperCase(),
        side: statePosition.side > 0 ? "LONG" : "SHORT",
        quantity: statePosition.quantity,
        entryPrice: statePosition.entryPrice,
        markPrice: quote.midPrice,
        entryTs: statePosition.entryTs,
        updatedAt: quote.updatedAt,
        markSource: "LIVE_MARKET_QUOTE",
        markSourceEvidence: {
            source: "LIVE_MARKET_QUOTE",
            timestamp: quote.updatedAt,
            price: quote.midPrice,
            crossChecked: true,
        },
    };
}

function clientOrderId(idempotencyKey: string): string {
    return `q102v1-reduce-${idempotencyKey}`.slice(0, 36);
}

function samePosition(position: DirectPosition, statePosition: NonNullable<Quality102CausalV1State["position"]>): boolean {
    return position.symbol.toUpperCase() === statePosition.symbol.toUpperCase()
        && sideOf(position) === statePosition.side
        && Math.abs(Math.abs(position.quantity) - statePosition.quantity) <= Math.max(1e-8, statePosition.quantity * 0.01);
}

function appendFailure(state: Quality102CausalV1State, message: string, idempotencyKey?: string, now = Date.now()): void {
    state.failures = [...state.failures, { occurredAt: now, message, ...(idempotencyKey ? { idempotencyKey } : {}) }].slice(-100);
}

async function manualReview(
    state: Quality102CausalV1State,
    store: FileQuality102CausalV1StateStore,
    message: string,
    idempotencyKey?: string,
    now = Date.now(),
): Promise<Quality102CausalV1LiveReductionResult> {
    if (state.pending) {
        state.pending.phase = "manual_review";
        state.pending.lastError = message;
        state.pending.updatedAt = now;
    }
    appendFailure(state, message, idempotencyKey, now);
    await store.save(state);
    return { status: "blocked", message };
}

function resultMatches(result: DirectTradeResult, pending: Quality102CausalV1PendingOrder): boolean {
    return result.symbol.toUpperCase() === pending.symbol.toUpperCase()
        && result.clientOrderId === pending.clientOrderId
        && result.side === pending.side
        && Number.isFinite(result.executedQuantity)
        && result.executedQuantity >= 0
        && result.executedQuantity <= pending.quantity + EPSILON;
}

/**
 * Execute the only live-side mutation needed when a verified base strategy
 * requires capacity: a causal-v1 reduce-only order. The caller must already
 * hold the shared account lock. This function never sends an opening order.
 */
export async function reduceQuality102CausalV1ForBaseConflict(
    input: Quality102CausalV1LiveReductionInput,
): Promise<Quality102CausalV1LiveReductionResult> {
    if (input.reduction.strategy !== STRATEGY_ID || input.reduction.reducedQuantity <= EPSILON) return { status: "not-needed", message: "No causal-v1 reduction is required." };
    const statePath = String(input.statePath || process.env.QUALITY102_CAUSAL_V1_STATE_PATH || process.env.DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH || "").trim();
    if (!statePath) return { status: "blocked", message: "QUALITY102_CAUSAL_V1_STATE_PATH_REQUIRED_FOR_MTM_REDUCTION" };
    const now = input.now || Date.now;
    const decisionNow = now();
    const ownership = await readQuality102CausalV1Ownership({ path: statePath, expectedRuntimeSha: input.expectedRuntimeSha });
    if (!ownership?.state) return { status: "blocked", message: "QUALITY102_CAUSAL_V1_STATE_MISSING_FOR_MTM_REDUCTION" };
    const state = ownership.state;
    const store = new FileQuality102CausalV1StateStore(resolve(statePath), "LIVE", state.runtimeCommitSha);
    const statePosition = state.position;
    if (!statePosition) return { status: "blocked", message: "QUALITY102_CAUSAL_V1_POSITION_MISSING_FOR_MTM_REDUCTION" };
    if (state.pending) return { status: "blocked", message: "QUALITY102_CAUSAL_V1_PENDING_ORDER_REQUIRES_RECONCILIATION" };
    if (statePosition.symbol.toUpperCase() !== input.reduction.symbol.toUpperCase()
        || (statePosition.side > 0 ? "LONG" : "SHORT") !== input.reduction.side
        || input.reduction.reducedQuantity > statePosition.quantity + EPSILON) {
        return { status: "blocked", message: "QUALITY102_CAUSAL_V1_REDUCTION_STATE_MISMATCH" };
    }
    const maxAge = input.maxDataAgeMs ?? DEFAULT_MAX_DATA_AGE_MS;
    const quote = await input.executor.getMarketQuote(statePosition.symbol);
    if (!validQuote(quote, statePosition.symbol, decisionNow, maxAge)) return { status: "blocked", message: "QUALITY102_CAUSAL_V1_REDUCTION_QUOTE_STALE_OR_INVALID" };
    const strict = strictPosition(statePosition, quote);
    const plannedReduction = markToMarketReducePosition({
        position: strict,
        reduceQuantity: input.reduction.reducedQuantity,
        markPrice: quote.midPrice,
        markTs: quote.updatedAt,
        markSource: "LIVE_MARKET_QUOTE",
        markSourceEvidence: { source: "LIVE_MARKET_QUOTE", timestamp: quote.updatedAt, price: quote.midPrice, crossChecked: true },
    });
    const closeSide = statePosition.side > 0 ? "SELL" : "BUY";
    const idempotencyKey = createHash("sha256")
        .update([STRATEGY_ID, "BASE_PRIORITY_MTM", input.causeIdempotencyKey, statePosition.symbol, quote.updatedAt, input.reduction.reducedQuantity].join("|"))
        .digest("hex");
    const pending: Quality102CausalV1PendingOrder = {
        idempotencyKey,
        clientOrderId: clientOrderId(idempotencyKey),
        phase: "planned",
        symbol: statePosition.symbol,
        side: closeSide,
        quantity: input.reduction.reducedQuantity,
        reduceOnly: true,
        referenceTs: quote.updatedAt,
        createdAt: decisionNow,
        updatedAt: decisionNow,
        expectedPrice: closeSide === "SELL" ? quote.bidPrice : quote.askPrice,
        hardStop: statePosition.hardStop,
        reason: `BASE_PRIORITY_MTM_REDUCTION:${input.causeIdempotencyKey}`,
    };
    state.pending = pending;
    await store.save(state);
    try {
        const expectedPrice = pending.expectedPrice;
        if (!(expectedPrice && expectedPrice > 0)) return manualReview(state, store, "QUALITY102_CAUSAL_V1_REDUCTION_EXPECTED_PRICE_INVALID", idempotencyKey, now());
        const normalized = await input.executor.normalizeMarketQuantity(
            pending.symbol,
            pending.quantity,
            expectedPrice,
            { allowBelowMinNotional: true },
        );
        if (!(normalized.quantity > 0) || normalized.quantity > input.reduction.reducedQuantity + EPSILON) {
            return manualReview(state, store, "QUALITY102_CAUSAL_V1_REDUCTION_NORMALIZATION_INVALID", idempotencyKey, now());
        }
        pending.quantity = normalized.quantity;
        pending.updatedAt = now();
        pending.phase = "submitted";
        await store.save(state);
        let result: DirectTradeResult;
        try {
            result = await input.executor.executeMarket({
                requestId: idempotencyKey,
                clientOrderId: pending.clientOrderId,
                symbol: pending.symbol,
                side: pending.side,
                quantity: pending.quantity,
                positionSide: "BOTH",
                reduceOnly: true,
                expectedPrice: pending.expectedPrice || 0,
                maxSlippageBps: input.maxSlippageBps,
                reason: pending.reason || STRATEGY_ID,
            });
        } catch (error) {
            return manualReview(state, store, failureMessage(error), idempotencyKey, now());
        }
        if (!resultMatches(result, pending)) return manualReview(state, store, "QUALITY102_CAUSAL_V1_REDUCTION_RESULT_IDENTITY_MISMATCH", idempotencyKey, now());
        if (result.status === "UNKNOWN" || result.executionUnknown) return manualReview(state, store, result.error || "QUALITY102 reduction execution is unknown; retry is forbidden.", idempotencyKey, now());
        if (result.status === "REJECTED" || result.status === "CANCELED" || result.status === "EXPIRED") {
            state.pending = undefined;
            state.lastCompletedIdempotencyKey = idempotencyKey;
            await store.save(state);
            return { status: "blocked", message: `QUALITY102_CAUSAL_V1_REDUCTION_${result.status}_NO_RETRY` };
        }
        if (result.status !== "FILLED" || result.executedQuantity <= EPSILON) return manualReview(state, store, `QUALITY102 reduction ended with ${result.status}; blind retry is forbidden.`, idempotencyKey, now());
        const actualRows = (await input.executor.getPositions()).filter((position) => position.symbol.toUpperCase() === statePosition.symbol.toUpperCase() && nonZero(position));
        const expectedRemaining = statePosition.quantity - result.executedQuantity;
        if (expectedRemaining > EPSILON) {
            if (actualRows.length !== 1 || Math.abs(Math.abs(actualRows[0].quantity) - expectedRemaining) > Math.max(1e-8, expectedRemaining * 0.02)) return manualReview(state, store, "QUALITY102_CAUSAL_V1_REDUCTION_POSITION_MISMATCH", idempotencyKey, now());
        } else if (actualRows.length !== 0) {
            return manualReview(state, store, "QUALITY102_CAUSAL_V1_REDUCTION_NOT_FLAT", idempotencyKey, now());
        }
        const executionPrice = Number(result.averagePrice) > 0 ? Number(result.averagePrice) : expectedPrice;
        if (!(executionPrice > 0)) return manualReview(state, store, "QUALITY102_CAUSAL_V1_REDUCTION_EXECUTION_PRICE_INVALID", idempotencyKey, now());
        const realized = markToMarketReducePosition({
            position: strict,
            reduceQuantity: result.executedQuantity,
            markPrice: executionPrice,
            markTs: pending.referenceTs,
            markSource: "LIVE_MARKET_QUOTE",
            markSourceEvidence: { source: "LIVE_MARKET_QUOTE", timestamp: pending.referenceTs, price: executionPrice, crossChecked: true },
        });
        const actual = actualRows[0];
        state.position = expectedRemaining > EPSILON && actual
            ? { ...statePosition, quantity: Math.abs(actual.quantity) }
            : undefined;
        state.lastReduction = {
            idempotencyKey,
            symbol: statePosition.symbol,
            side: statePosition.side,
            reducedQuantity: result.executedQuantity,
            markTs: realized.markTs,
            markPrice: realized.markPrice,
            realizedPnl: realized.realizedPnl,
            transactionCost: realized.transactionCost,
            fundingCost: realized.fundingCost,
            accounting: realized.accounting,
        };
        state.pending = undefined;
        state.lastCompletedIdempotencyKey = idempotencyKey;
        state.lastReconciledAt = now();
        await store.save(state);
        return { status: "reduced", message: "QUALITY102_CAUSAL_V1_BASE_PRIORITY_MTM_REDUCTION_FILLED", reduction: realized, result };
    } catch (error) {
        return manualReview(state, store, failureMessage(error), idempotencyKey, now());
    }
}
