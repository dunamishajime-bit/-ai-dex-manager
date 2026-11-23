import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { HYPE_ZEC_LONG_POLICY, isHypeZecStrategy, type HypeZecStrategy } from "../config/hypeZecLongPolicy";
import { findManagedHypeZecProtectiveOrders } from "./disdex-managed-protective-orders";
import type { HypeZecPreemptionPlan, HypeZecReductionPlan } from "./hype-zec-preemption";
import type { DirectOpenOrder, DirectPosition, DirectTradeExecutor, DirectTradeResult } from "./direct-trade-executor";

const SCHEMA = "disdex-hype-zec-preemption/v1" as const;
const EPSILON = 1e-9;
const MAX_QUOTE_AGE_MS = 5 * 60_000;

export type HypeZecPreemptionPhase = "planned" | "submitted" | "manual_review";

export interface HypeZecPreemptionPending {
    idempotencyKey: string;
    clientOrderId: string;
    strategy: HypeZecStrategy;
    symbol: "HYPEUSDT" | "ZECUSDT";
    positionId: string;
    quantity: number;
    expectedPrice: number;
    phase: HypeZecPreemptionPhase;
    createdAt: number;
    updatedAt: number;
    reason: string;
    lastError?: string;
}

export interface HypeZecPreemptionState {
    schema: typeof SCHEMA;
    runtimeCommitSha: string;
    pending?: HypeZecPreemptionPending;
    lastCompletedIdempotencyKey?: string;
    manualReview?: string;
    updatedAt: number;
}

export interface HypeZecPreemptionStateStore {
    load(): Promise<HypeZecPreemptionState>;
    save(state: HypeZecPreemptionState): Promise<void>;
}

type HypeZecLockHandle = { document(): Promise<{ expiresAt: number }> };

function stateDocument(value: unknown, expectedRuntimeSha?: string): HypeZecPreemptionState {
    if (!value || typeof value !== "object") throw new Error("HYPE_ZEC_PREEMPTION_STATE_MALFORMED");
    const row = value as Partial<HypeZecPreemptionState>;
    if (row.schema !== SCHEMA || typeof row.runtimeCommitSha !== "string" || !row.runtimeCommitSha.trim()) throw new Error("HYPE_ZEC_PREEMPTION_STATE_MALFORMED");
    if (expectedRuntimeSha && row.runtimeCommitSha !== expectedRuntimeSha) throw new Error(`HYPE_ZEC_PREEMPTION_STATE_RUNTIME_SHA_MISMATCH:${row.runtimeCommitSha}:${expectedRuntimeSha}`);
    if (row.pending && typeof row.pending !== "object") throw new Error("HYPE_ZEC_PREEMPTION_PENDING_MALFORMED");
    return {
        schema: SCHEMA,
        runtimeCommitSha: row.runtimeCommitSha,
        pending: row.pending,
        lastCompletedIdempotencyKey: row.lastCompletedIdempotencyKey,
        manualReview: row.manualReview,
        updatedAt: Number(row.updatedAt),
    };
}

export class FileHypeZecPreemptionStateStore implements HypeZecPreemptionStateStore {
    private readonly path: string;
    private readonly runtimeCommitSha: string;

    constructor(path = process.env.DISDEX_HYPE_ZEC_PREEMPTION_STATE_PATH || ".runtime-state/hype-zec-preemption/state.json", runtimeCommitSha = process.env.DISDEX_RELEASE_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA || "unknown") {
        this.path = resolve(path);
        this.runtimeCommitSha = runtimeCommitSha;
    }

    async load(): Promise<HypeZecPreemptionState> {
        try {
            const state = stateDocument(JSON.parse(await readFile(this.path, "utf8")), this.runtimeCommitSha);
            if (!Number.isFinite(state.updatedAt) || state.updatedAt <= 0) throw new Error("HYPE_ZEC_PREEMPTION_STATE_TIMESTAMP_INVALID");
            return state;
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
            if (code === "ENOENT") return { schema: SCHEMA, runtimeCommitSha: this.runtimeCommitSha, updatedAt: Date.now() };
            throw error;
        }
    }

    async save(state: HypeZecPreemptionState): Promise<void> {
        const normalized = stateDocument({ ...state, runtimeCommitSha: this.runtimeCommitSha, updatedAt: Date.now() }, this.runtimeCommitSha);
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        try {
            const existing = await lstat(this.path);
            if (existing.isSymbolicLink()) throw new Error("HYPE_ZEC_PREEMPTION_STATE_SYMLINK_FORBIDDEN");
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
            if (code !== "ENOENT") throw error;
        }
        const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        try {
            await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
            await rename(temporary, this.path);
            await chmod(this.path, 0o600);
        } catch (error) {
            await unlink(temporary).catch(() => undefined);
            throw error;
        }
    }
}

type HypeZecAdapter = {
    getOpenOrders(): Promise<DirectOpenOrder[]>;
    cancel(clientOrderId: string): Promise<void>;
    placeStopMarket(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; stopPrice: number; clientOrderId: string; reduceOnly: true }): Promise<unknown>;
    placeTakeProfit(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; stopPrice: number; clientOrderId: string; reduceOnly: true }): Promise<unknown>;
};

export type HypeZecVenueRisk = { leverage: number; marginType: "cross" | "isolated" | "unknown" };

export interface HypeZecProtectionLevel {
    stopPrice: number;
    takeProfitPrice: number;
    tickSize: number;
    stepSize: number;
}

export type HypeZecPreemptionExecutionResult =
    | { status: "not-needed"; message: string }
    | { status: "reduced"; message: string; results: Array<{ reduction: HypeZecReductionPlan; result: DirectTradeResult; remainingQuantity: number }> }
    | { status: "blocked"; message: string };

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function active(order: DirectOpenOrder) { return ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(String(order.status || "").toUpperCase()); }
function validTime(value: unknown, now: number) { return Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= now && now - Number(value) <= MAX_QUOTE_AGE_MS; }
function pendingId(row: HypeZecReductionPlan, cause: string) { return createHash("sha256").update(["HYPE_ZEC_PREEMPT", cause, row.strategy, row.symbol, row.positionId, row.reducedQuantity].join("|")).digest("hex"); }
function protectionId(kind: "stop" | "tp", key: string) { return `hz-${kind}-${createHash("sha256").update(`${key}|${kind}`).digest("hex").slice(0, 27)}`.slice(0, 36); }
function sameResult(result: DirectTradeResult, pending: HypeZecPreemptionPending, quantity: number) {
    return result.symbol.toUpperCase() === pending.symbol
        && result.clientOrderId === pending.clientOrderId
        && result.side === "SELL"
        && result.reduceOnly === true
        && Number.isFinite(result.executedQuantity)
        && result.executedQuantity >= quantity - EPSILON;
}

async function manualReview(state: HypeZecPreemptionState, store: HypeZecPreemptionStateStore, reason: string, now: number): Promise<HypeZecPreemptionExecutionResult> {
    state.manualReview = reason;
    if (state.pending) {
        state.pending.phase = "manual_review";
        state.pending.lastError = reason;
        state.pending.updatedAt = now;
    }
    await store.save(state);
    return { status: "blocked", message: reason };
}

/** Executes only a previously planned reduce-only sidecar reduction. */
export async function executeHypeZecPreemption(input: {
    plan: HypeZecPreemptionPlan;
    executor: DirectTradeExecutor;
    adapter: HypeZecAdapter;
    lock?: HypeZecLockHandle;
    stateStore: HypeZecPreemptionStateStore;
    readVenueRisk?: (symbol: string) => Promise<HypeZecVenueRisk>;
    protection: Partial<Record<HypeZecStrategy, HypeZecProtectionLevel>>;
    causeIdempotencyKey?: string;
    expectedRuntimeSha?: string;
    now?: () => number;
    maxSlippageBps?: number;
}): Promise<HypeZecPreemptionExecutionResult> {
    if (input.plan.status === "not-needed") return { status: "not-needed", message: input.plan.reason };
    if (input.plan.status !== "planned" || input.plan.reductions.length === 0) return { status: "blocked", message: input.plan.reason || "HYPE_ZEC_PREEMPTION_PLAN_INVALID" };
    if (!input.lock) return { status: "blocked", message: "HYPE_ZEC_PREEMPTION_ACCOUNT_LOCK_REQUIRED" };
    const now = input.now || Date.now;
    try {
        const document = await input.lock.document();
        if (!document || Number(document.expiresAt) <= now()) return { status: "blocked", message: "HYPE_ZEC_PREEMPTION_ACCOUNT_LOCK_UNCONFIRMED" };
    } catch (error) {
        return { status: "blocked", message: `HYPE_ZEC_PREEMPTION_ACCOUNT_LOCK_UNCONFIRMED:${message(error)}` };
    }
    let state: HypeZecPreemptionState;
    try { state = await input.stateStore.load(); } catch (error) { return { status: "blocked", message: `HYPE_ZEC_PREEMPTION_STATE_UNAVAILABLE:${message(error)}` }; }
    if (input.expectedRuntimeSha && state.runtimeCommitSha !== input.expectedRuntimeSha) return { status: "blocked", message: `HYPE_ZEC_PREEMPTION_STATE_RUNTIME_SHA_MISMATCH:${state.runtimeCommitSha}:${input.expectedRuntimeSha}` };
    if (state.manualReview) return { status: "blocked", message: `HYPE_ZEC_PREEMPTION_MANUAL_REVIEW:${state.manualReview}` };
    if (state.pending) return { status: "blocked", message: "HYPE_ZEC_PREEMPTION_PENDING_REQUIRES_RECONCILIATION" };
    if (!input.readVenueRisk) return { status: "blocked", message: "HYPE_ZEC_PREEMPTION_VENUE_RISK_READER_REQUIRED" };

    const results: Array<{ reduction: HypeZecReductionPlan; result: DirectTradeResult; remainingQuantity: number }> = [];
    for (const reduction of input.plan.reductions) {
        if (!isHypeZecStrategy(reduction.strategy) || reduction.symbol.toUpperCase() !== HYPE_ZEC_LONG_POLICY[reduction.strategy].symbol || !(reduction.reducedQuantity > 0) || reduction.reducedFraction > 0.5 + EPSILON) return manualReview(state, input.stateStore, "HYPE_ZEC_PREEMPTION_REDUCTION_PLAN_INVALID", now());
        const key = pendingId(reduction, input.causeIdempotencyKey || "UNSPECIFIED_PRIORITY_ENTRY");
        if (state.lastCompletedIdempotencyKey === key) return { status: "not-needed", message: `HYPE_ZEC_PREEMPTION_ALREADY_COMPLETED:${key}` };
        const positions = await input.executor.getPositions();
        const position = positions.find((row) => row.symbol.toUpperCase() === reduction.symbol.toUpperCase() && row.quantity > EPSILON && row.positionSide !== "SHORT");
        if (!position || position.quantity + EPSILON < reduction.reducedQuantity) return manualReview(state, input.stateStore, "HYPE_ZEC_PREEMPTION_POSITION_MISMATCH", now());
        const risk = await input.readVenueRisk(reduction.symbol);
        if (risk.leverage !== 5 || risk.marginType !== "cross") return manualReview(state, input.stateStore, `HYPE_ZEC_PREEMPTION_VENUE_MARGIN_UNCONFIRMED:${reduction.symbol}`, now());
        const quote = await input.executor.getMarketQuote(reduction.symbol);
        if (!(quote.bidPrice > 0) || !validTime(quote.updatedAt, now())) return manualReview(state, input.stateStore, "HYPE_ZEC_PREEMPTION_QUOTE_STALE_OR_INVALID", now());
        const openOrders = await input.adapter.getOpenOrders();
        const targetOrders = openOrders.filter((order) => order.symbol.toUpperCase() === reduction.symbol.toUpperCase() && active(order));
        const managed = findManagedHypeZecProtectiveOrders(targetOrders, [position]);
        if (targetOrders.length !== 2 || managed.length !== 2) return manualReview(state, input.stateStore, "HYPE_ZEC_PREEMPTION_PROTECTION_NOT_VERIFIED", now());
        const normalized = await input.executor.normalizeMarketQuantity(reduction.symbol, reduction.reducedQuantity, quote.bidPrice, { allowBelowMinNotional: true });
        if (!(normalized.quantity > 0) || normalized.quantity + EPSILON < reduction.reducedQuantity || normalized.quantity > position.quantity * 0.5 + EPSILON) return manualReview(state, input.stateStore, "HYPE_ZEC_PREEMPTION_QUANTITY_NORMALIZATION_INVALID", now());
        const pending: HypeZecPreemptionPending = {
            idempotencyKey: key,
            clientOrderId: `hzp-red-${key.slice(0, 27)}`.slice(0, 36),
            strategy: reduction.strategy,
            symbol: reduction.symbol as "HYPEUSDT" | "ZECUSDT",
            positionId: reduction.positionId,
            quantity: normalized.quantity,
            expectedPrice: quote.bidPrice,
            phase: "planned",
            createdAt: now(),
            updatedAt: now(),
            reason: `PRIORITY_ENTRY_CAPACITY_PREEMPTION:${input.causeIdempotencyKey || "UNSPECIFIED"}`,
        };
        state.pending = pending;
        state.updatedAt = now();
        await input.stateStore.save(state);
        let result: DirectTradeResult;
        try {
            pending.phase = "submitted";
            pending.updatedAt = now();
            await input.stateStore.save(state);
            result = await input.executor.executeMarket({ requestId: key, clientOrderId: pending.clientOrderId, symbol: pending.symbol, side: "SELL", quantity: pending.quantity, positionSide: "BOTH", reduceOnly: true, expectedPrice: pending.expectedPrice, maxSlippageBps: input.maxSlippageBps ?? 20, reason: pending.reason });
        } catch (error) {
            return manualReview(state, input.stateStore, `HYPE_ZEC_PREEMPTION_EXECUTION_ERROR:${message(error)}`, now());
        }
        if (!sameResult(result, pending, normalized.quantity) || result.status === "UNKNOWN" || result.executionUnknown) return manualReview(state, input.stateStore, "HYPE_ZEC_PREEMPTION_EXECUTION_UNKNOWN_OR_PARTIAL", now());
        const afterPositions = await input.executor.getPositions();
        const after = afterPositions.find((row) => row.symbol.toUpperCase() === reduction.symbol.toUpperCase() && row.quantity > EPSILON && row.positionSide !== "SHORT");
        const expectedRemaining = position.quantity - result.executedQuantity;
        if (!after || Math.abs(after.quantity - expectedRemaining) > Math.max(1e-8, position.quantity * 0.01)) return manualReview(state, input.stateStore, "HYPE_ZEC_PREEMPTION_POSITION_READBACK_MISMATCH", now());
        const remaining = after.quantity;
        const protection = input.protection[reduction.strategy];
        if (!protection || !(protection.stopPrice > 0) || !(protection.takeProfitPrice > 0) || !(protection.tickSize > 0) || !(protection.stepSize > 0)) return manualReview(state, input.stateStore, "HYPE_ZEC_PREEMPTION_PROTECTION_LEVELS_REQUIRED", now());
        const stopId = protectionId("stop", key);
        const takeProfitId = protectionId("tp", key);
        // Install and verify replacement protection before removing the old
        // protection.  A reduce-only preemption must never create an
        // unprotected interval after the fill.  If placement/read-back fails,
        // the original STOP/TP remains in place and the state is left in
        // manual review for an operator.
        await input.adapter.placeStopMarket({ symbol: reduction.symbol, side: "SELL", quantity: remaining, stopPrice: protection.stopPrice, clientOrderId: stopId, reduceOnly: true });
        await input.adapter.placeTakeProfit({ symbol: reduction.symbol, side: "SELL", quantity: remaining, stopPrice: protection.takeProfitPrice, clientOrderId: takeProfitId, reduceOnly: true });
        const readBack = await input.adapter.getOpenOrders();
        const verified = readBack.filter((order) => [stopId, takeProfitId].includes(order.clientOrderId));
        if (verified.length !== 2 || verified.some((order) => !active(order) || order.reduceOnly !== true || Math.abs(order.quantity - remaining) > Math.max(1e-8, remaining * 0.01))) return manualReview(state, input.stateStore, "HYPE_ZEC_PREEMPTION_PROTECTION_READBACK_FAILED", now());
        for (const order of managed) await input.adapter.cancel(order.clientOrderId);
        const finalReadBack = await input.adapter.getOpenOrders();
        const finalVerified = finalReadBack.filter((order) => [stopId, takeProfitId].includes(order.clientOrderId));
        const oldStillActive = finalReadBack.some((order) => managed.some((old) => old.clientOrderId === order.clientOrderId) && active(order));
        if (finalVerified.length !== 2 || finalVerified.some((order) => !active(order) || order.reduceOnly !== true || Math.abs(order.quantity - remaining) > Math.max(1e-8, remaining * 0.01)) || oldStillActive) return manualReview(state, input.stateStore, "HYPE_ZEC_PREEMPTION_PROTECTION_FINAL_READBACK_FAILED", now());
        state.pending = undefined;
        state.manualReview = undefined;
        state.lastCompletedIdempotencyKey = key;
        state.updatedAt = now();
        await input.stateStore.save(state);
        results.push({ reduction, result, remainingQuantity: remaining });
    }
    return { status: "reduced", message: "HYPE_ZEC_PREEMPTION_REDUCED_AND_PROTECTED", results };
}
