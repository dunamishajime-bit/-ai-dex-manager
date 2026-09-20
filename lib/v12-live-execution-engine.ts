import { randomUUID } from "node:crypto";

import { V12_X1_ALL } from "@/config/v12X1AllRuntime";
import { AsterApiError } from "@/lib/aster-v3-client";
import { FileAccountOrderLock } from "@/lib/disdex-account-order-lock";
import { classifyAsterSymbol } from "@/lib/disdex-aster-portfolio-classifier";
import { readSharedCryptoDailyRisk, readSharedCryptoDailyRiskWithRolloverRetry } from "@/lib/disdex-shared-crypto-daily-risk";
import type { ActivePortfolioPosition } from "@/lib/disdex-unified-portfolio-routing";
import { V12AsterLiveAdapter, deterministicV12ClientOrderId } from "@/lib/v12-aster-live-adapter";
import {
    applyV12TrailingStop,
    cancelV12Protection,
    installV12Protection,
    planV12TrailingStop,
    reconcileV12Protection,
    type V12StopState,
    type V12TrailingPlan,
} from "@/lib/v12-resident-stop-lifecycle";
import { buildV12DecisionObservation, buildV12Signals, protectiveLevels, sizeV12Position, v12EntryGrossCapForRank, type V12Bar, type V12DecisionObservation, type V12Signal } from "@/lib/v12-x1-all";
import { FileV12X1AllRunnerStateStore, type V12ActivePositionState, type V12PendingOrderState, type V12X1AllRunnerState } from "@/lib/v12-x1-all-runner-state";
import { decideV12ResidualEntry, type V12ResidualDecision } from "@/lib/v12-top2-residual";
import { reduceV12DynamicResidualForCoreConflict } from "@/lib/v12-dynamic-residual-live-reduction";
import type { DirectPosition, DirectTradeResult } from "@/lib/direct-trade-executor";
import { readQuality102CausalV1Ownership, quality102OwnsPosition, type Quality102CausalV1OwnershipSnapshot } from "@/lib/disdex-quality102-causal-v1-ownership";

const V12_SYMBOLS = new Set(V12_X1_ALL.universe.map((symbol) => `${symbol}USDT`));
const EPS = 1e-12;

export type V12LiveTickStatus = "locked" | "held" | "no-signal" | "capacity-blocked" | "entered" | "exited" | "risk-blocked" | "manual-review";
export interface V12LiveTickResult { status: V12LiveTickStatus; reason: string; signal?: V12Signal; clientOrderId?: string; }
export interface V12LiveExecutionDependencies {
    adapter: V12AsterLiveAdapter;
    marketData: { load(): Promise<Record<string, V12Bar[]>> };
    stateStore: FileV12X1AllRunnerStateStore;
    lock: FileAccountOrderLock;
    riskPath: string;
    statePath?: string;
    decisionObserver?: (snapshot: V12DecisionObservation) => Promise<void> | void;
    now?: () => number;
    log?: (message: string, payload?: Record<string, unknown>) => void;
}

function finite(value: unknown, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function actualSide(position: DirectPosition): "LONG" | "SHORT" { if (position.positionSide === "LONG") return "LONG"; if (position.positionSide === "SHORT") return "SHORT"; return position.quantity < 0 ? "SHORT" : "LONG"; }
function actualQuantity(position: DirectPosition) { return Math.abs(position.quantity); }
function positionMatches(state: V12ActivePositionState, actual: DirectPosition) {
    return actual.symbol.toUpperCase() === state.symbol.toUpperCase() && actualSide(actual) === state.side && Math.abs(actualQuantity(actual) - state.quantity) <= Math.max(1e-8, state.quantity * 0.01);
}
function resultHasExposure(result: DirectTradeResult) { return (result.status === "FILLED" || result.status === "PARTIALLY_FILLED") && result.executedQuantity > 0; }
function activeOrderStatus(status?: string) { return ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(String(status || "").toUpperCase()); }
function safeV12ErrorMessage(error: unknown) {
    if (error instanceof AsterApiError) return `${error.message} [ASTER_READ path=${error.path || "unknown"} status=${error.status} code=${error.code ?? "none"}]`;
    return error instanceof Error ? error.message : String(error);
}
function latestIndex(data: Record<string, V12Bar[]>) {
    const rows = Object.entries(data); if (rows.length !== V12_X1_ALL.universe.length) throw new Error("V12_MARKET_DATA_UNIVERSE_MISMATCH");
    const lengths = rows.map(([, bars]) => bars.length); if (!lengths.length || Math.min(...lengths) < 80 || lengths.some((length) => length !== lengths[0])) throw new Error("V12_MARKET_DATA_ALIGNMENT_REQUIRED");
    const index = lengths[0] - 1; const endTs = rows[0][1][index].endTs;
    if (rows.some(([, bars]) => bars[index].endTs !== endTs)) throw new Error("V12_MARKET_DATA_TIMESTAMP_MISMATCH");
    return index;
}
function initialProtection(input: { symbol: string; side: "LONG" | "SHORT"; quantity: number; entryPrice: number; atr: number; positionId: string }): V12StopState {
    const levels = protectiveLevels(input.entryPrice, input.atr, input.side);
    return { strategyId: "V12_X1.00_ALL", symbol: input.symbol, side: input.side, positionId: input.positionId, quantity: input.quantity, entryPrice: input.entryPrice, atrAtEntry: input.atr, initialStop: levels.initialStop, lastAckStop: levels.initialStop, takeProfit: levels.takeProfit, peakOrTrough: input.entryPrice };
}

function activePositionsOf(state: V12X1AllRunnerState): V12ActivePositionState[] {
    if (Array.isArray(state.activePositions) && state.activePositions.length) return [...state.activePositions];
    return state.active ? [state.active] : [];
}

function v12SlotAvailable(active: readonly V12ActivePositionState[], rank: number | undefined) {
    if (active.length >= V12_X1_ALL.maximumPositions) return false;
    const baseCount = active.filter((position) => position.entryRank !== 3).length;
    const residualOccupied = active.some((position) => position.entryRank === 3);
    return rank === 3 ? !residualOccupied : baseCount < 2;
}

function v12GrossComponents(state: V12X1AllRunnerState, portfolio: ActivePortfolioPosition[]) {
    const actives = activePositionsOf(state);
    const bySymbol = new Map(actives.map((row) => [row.symbol.toUpperCase(), row]));
    let baseGross = 0;
    let dynamicGross = 0;
    for (const row of portfolio.filter((position) => position.sleeve === "V12")) {
        const managed = bySymbol.get(row.symbol.toUpperCase());
        if (!managed || !(managed.quantity > 0)) {
            baseGross += row.gross;
            continue;
        }
        const baseRatio = Math.max(0, Math.min(1, managed.baseQuantity / managed.quantity));
        baseGross += row.gross * baseRatio;
        dynamicGross += row.gross * (1 - baseRatio);
    }
    return { baseGross, dynamicGross };
}

function syncActivePositions(state: V12X1AllRunnerState, positions: V12ActivePositionState[]) {
    const ranked = positions.filter((position) => position.quantity > EPS);
    if (ranked.length > V12_X1_ALL.maximumPositions) throw new Error("V12_MAX_POSITIONS_REACHED");
    if (ranked.filter((position) => position.entryRank !== 3).length > 2) throw new Error("V12_BASE_SLOT_COUNT_OVER_CAP");
    if (ranked.filter((position) => position.entryRank === 3).length > 1) throw new Error("V12_RANK3_SLOT_COUNT_OVER_CAP");
    if (ranked.some((position) => position.entryRank === 3 && position.gross > V12_X1_ALL.rank3EntryGrossCap + EPS)) throw new Error("V12_RANK3_GROSS_OVER_CAP");
    if (new Set(ranked.map((position) => position.symbol.toUpperCase())).size !== ranked.length) throw new Error("V12_DUPLICATE_ACTIVE_SYMBOL");
    if (ranked.some((position) => position.gross > V12_X1_ALL.perPositionEntryGrossCap + EPS)) throw new Error("V12_POSITION_GROSS_OVER_CAP");
    if (ranked.some((position) => Math.abs(position.baseGross + position.dynamicGross - position.gross) > 1e-6
        || Math.abs(position.baseQuantity + position.dynamicQuantity - position.quantity) > Math.max(1e-8, position.quantity * 1e-6))) {
        throw new Error("V12_BASE_DYNAMIC_STATE_MISMATCH");
    }
    if (ranked.reduce((sum, position) => sum + position.baseGross, 0) > V12_X1_ALL.aggregateEntryGrossCap + EPS) throw new Error("V12_BASE_AGGREGATE_GROSS_OVER_CAP");
    if (ranked.reduce((sum, position) => sum + position.gross, 0) > V12_X1_ALL.dynamicResidualAggregateGrossCap + EPS) throw new Error("V12_AGGREGATE_GROSS_OVER_CAP");
    state.activePositions = ranked.length ? ranked : undefined;
    state.active = ranked[0];
}

export class V12LiveExecutionEngine {
    private readonly now: () => number;
    private readonly log: (message: string, payload?: Record<string, unknown>) => void;
    constructor(private readonly d: V12LiveExecutionDependencies) { this.now = d.now || Date.now; this.log = d.log || ((message, payload) => console.log(JSON.stringify({ message, ...(payload || {}) }))); }

    private async fail(state: V12X1AllRunnerState, reason: string): Promise<V12LiveTickResult> {
        await this.d.stateStore.tripKillSwitch(state, reason); this.log("v12-fail-closed", { reason }); return { status: "manual-review", reason };
    }

    private validatePortfolioPositions(positions: DirectPosition[], quality102Ownership?: Quality102CausalV1OwnershipSnapshot) {
        for (const position of positions.filter((row) => Math.abs(row.quantity) > EPS)) {
            if (quality102OwnsPosition(quality102Ownership, position)) continue;
            const classification = classifyAsterSymbol(position.symbol);
            if (!classification.tradable) throw new Error(`ASTER_UNKNOWN_NONZERO_POSITION:${position.symbol}`);
        }
    }

    private activePortfolio(positions: DirectPosition[], equity: number, quality102Ownership?: Quality102CausalV1OwnershipSnapshot): ActivePortfolioPosition[] {
        if (!(equity > 0)) throw new Error("V12_ACCOUNT_EQUITY_INVALID");
        return positions.filter((row) => Math.abs(row.quantity) > EPS && !quality102OwnsPosition(quality102Ownership, row)).map((position) => {
            const c = classifyAsterSymbol(position.symbol);
            if (!c.tradable) throw new Error(`ASTER_UNKNOWN_NONZERO_POSITION:${position.symbol}`);
            return { sleeve: c.sleeve === "V11_EQ" ? "V11_EQ" : c.sleeve, symbol: position.symbol, gross: Math.abs(position.notionalUsd) / equity } as ActivePortfolioPosition;
        });
    }

    private async verifyNoUnexpectedV12Orders(state: V12X1AllRunnerState) {
        const open = await this.d.adapter.listV12Orders();
        const protectionIds = activePositionsOf(state).flatMap((active) => [active.protection.stopClientOrderId, active.protection.takeProfitClientOrderId]);
        const allowed = new Set([state.pending?.clientOrderId, ...protectionIds].filter((value): value is string => Boolean(value)));
        const unknown = open.filter((order) => activeOrderStatus(order.status) && !allowed.has(order.clientOrderId));
        if (unknown.length) throw new Error(`V12_UNKNOWN_ACTIVE_ORDER:${unknown.map((row) => row.clientOrderId).join(",")}`);
    }

    private async completedProtectionExit(active: V12ActivePositionState) {
        const ids = [active.protection.stopClientOrderId, active.protection.takeProfitClientOrderId].filter((value): value is string => Boolean(value));
        for (const clientOrderId of ids) {
            const order = await this.d.adapter.queryOrderSameId(active.symbol, clientOrderId);
            if (order?.status === "FILLED") return true;
        }
        return false;
    }

    /**
     * Lightweight between-bar reconciliation for venue-resident STOP/TP fills.
     *
     * This does not evaluate signals or submit exposure-increasing orders. It uses
     * the same account-order lock as the 2h tick, requires the venue position to
     * be flat, and requires positive FILLED evidence from one of the deterministic
     * protection orders before removing the local active state.
     */
    async reconcileProtectionFillsOnly(): Promise<V12LiveTickResult | undefined> {
        const handle = await this.d.lock.acquire(`V12_PROTECTION_FILL_RECONCILE:${process.pid}:${randomUUID()}`);
        if (!handle) return { status: "locked", reason: "ACCOUNT_LOCK_BUSY_OR_STALE_REVIEW_REQUIRED" };
        try {
            const state = await this.d.stateStore.load();
            if (state.pending || state.killSwitch?.active || state.manualReview) return undefined;
            const actives = activePositionsOf(state);
            if (!actives.length) return undefined;

            const positions = await this.d.adapter.getPositions();
            const actualSymbols = new Set(
                positions
                    .filter((row) => Math.abs(row.quantity) > EPS)
                    .map((row) => row.symbol.toUpperCase()),
            );
            const missing = actives.filter((active) => !actualSymbols.has(active.symbol.toUpperCase()));
            if (!missing.length) return undefined;

            for (const active of missing) {
                if (!(await this.completedProtectionExit(active))) {
                    return this.fail(state, `V12_STATE_ONLY_POSITION_MISMATCH:${active.symbol}`);
                }
            }

            for (const active of missing) await cancelV12Protection(this.d.adapter, active.protection);
            const missingIds = new Set(missing.map((row) => row.positionId));
            syncActivePositions(state, actives.filter((row) => !missingIds.has(row.positionId)));
            state.cooldownUntilTs = Math.max(
                Number(state.cooldownUntilTs || 0),
                (state.lastReferenceTs || this.now()) + V12_X1_ALL.cooldownBars * V12_X1_ALL.timeframeHours * 3_600_000,
            );
            await this.d.stateStore.save(state);
            const symbols = missing.map((row) => row.symbol).sort();
            this.log("v12-protection-fill-reconciled", {
                symbols,
                remainingActivePositions: activePositionsOf(state).map((row) => row.symbol),
                ordersSent: 0,
                positionChangesSent: 0,
            });
            return { status: "exited", reason: `PROTECTION_FILL_RECONCILED:${symbols.join(",")}` };
        } finally {
            await handle.release();
        }
    }

    private async reconcilePendingEntry(state: V12X1AllRunnerState, pending: V12PendingOrderState, positions: DirectPosition[]): Promise<V12LiveTickResult | undefined> {
        const result = await this.d.adapter.reconcileOrder(pending.symbol, pending.clientOrderId);
        if (result.status === "UNKNOWN") return this.fail(state, `V12_PENDING_ENTRY_UNKNOWN:${pending.clientOrderId}`);
        if (["REJECTED", "CANCELED", "EXPIRED"].includes(result.status) && result.executedQuantity <= 0) {
            state.pending = undefined; state.lastCompletedIdempotencyKey = pending.idempotencyKey; await this.d.stateStore.save(state);
            return { status: "held", reason: `ENTRY_${result.status}_NO_RETRY`, clientOrderId: pending.clientOrderId };
        }
        if (!resultHasExposure(result)) return this.fail(state, `V12_PENDING_ENTRY_UNRESOLVED:${result.status}`);
        const actual = positions.find((row) => row.symbol.toUpperCase() === pending.symbol && Math.abs(row.quantity) > EPS);
        if (!actual || actualSide(actual) !== pending.side) return this.fail(state, "V12_PENDING_ENTRY_POSITION_MISMATCH");
        const account = await this.d.adapter.getAccountSnapshot();
        if (!(account.walletBalance > 0)) return this.fail(state, "V12_PENDING_ENTRY_EQUITY_INVALID");
        const quantity = actualQuantity(actual); const entryPrice = actual.entryPrice > 0 ? actual.entryPrice : result.averagePrice;
        const actualGross = Math.abs(actual.notionalUsd) / account.walletBalance;
        if (!(actualGross > 0 && actualGross <= V12_X1_ALL.perPositionEntryGrossCap + EPS)) return this.fail(state, "V12_PENDING_ENTRY_GROSS_INVALID");
        if (!(entryPrice > 0 && pending.atrAtEntry && pending.atrAtEntry > 0)) return this.fail(state, "V12_PENDING_ENTRY_RECOVERY_METADATA_INVALID");
        const protection = initialProtection({ symbol: pending.symbol, side: pending.side, quantity, entryPrice, atr: pending.atrAtEntry, positionId: pending.clientOrderId });
        const existing = activePositionsOf(state).filter((row) => row.symbol.toUpperCase() !== pending.symbol.toUpperCase());
        const plannedBaseGross = Math.max(0, finite(pending.baseRequestedGross, pending.requestedGross ?? actualGross));
        const plannedDynamicGross = Math.max(0, finite(pending.dynamicRequestedGross, 0));
        const plannedTotalGross = plannedBaseGross + plannedDynamicGross;
        const baseRatio = plannedTotalGross > EPS ? Math.max(0, Math.min(1, plannedBaseGross / plannedTotalGross)) : 1;
        let active: V12ActivePositionState = {
            symbol: pending.symbol,
            side: pending.side,
            quantity,
            gross: actualGross,
            baseQuantity: quantity * baseRatio,
            dynamicQuantity: quantity * (1 - baseRatio),
            baseGross: actualGross * baseRatio,
            dynamicGross: actualGross * (1 - baseRatio),
            dynamicUpdatedAt: plannedDynamicGross > EPS ? this.now() : undefined,
            entryRank: pending.entryRank,
            positionId: pending.clientOrderId,
            entryPrice,
            atrAtEntry: pending.atrAtEntry,
            entrySignalTs: pending.signalTs,
            holdingBars: 0,
            peakPrice: entryPrice,
            troughPrice: entryPrice,
            protection,
        };
        active = { ...active, quantity, entryPrice, protection: { ...active.protection, quantity, entryPrice } };
        syncActivePositions(state, [...existing, active]); await this.d.stateStore.save(state);
        const installed = await installV12Protection(this.d.adapter, active.protection);
        if (installed.manualReview) return this.fail(state, installed.manualReview);
        const protectedActive = { ...active, protection: installed };
        syncActivePositions(state, [...existing, protectedActive]); state.pending = undefined; state.lastCompletedIdempotencyKey = pending.idempotencyKey; await this.d.stateStore.save(state);
        return { status: "entered", reason: result.status === "PARTIALLY_FILLED" ? "PARTIAL_FILL_PROTECTED_AND_RECONCILED" : "ENTRY_RECOVERED_AND_PROTECTED", clientOrderId: pending.clientOrderId };
    }

    private async reconcilePendingExit(state: V12X1AllRunnerState, pending: V12PendingOrderState, positions: DirectPosition[]) {
        const result = await this.d.adapter.reconcileOrder(pending.symbol, pending.clientOrderId);
        if (result.status === "UNKNOWN") return this.fail(state, `V12_PENDING_EXIT_UNKNOWN:${pending.clientOrderId}`);
        const actual = positions.find((row) => row.symbol.toUpperCase() === pending.symbol && Math.abs(row.quantity) > EPS);
        if (actual) return this.fail(state, `V12_PENDING_EXIT_POSITION_REMAINS:${result.status}`);
        const remaining = activePositionsOf(state).filter((active) => active.symbol.toUpperCase() !== pending.symbol.toUpperCase());
        const exiting = activePositionsOf(state).find((active) => active.symbol.toUpperCase() === pending.symbol.toUpperCase());
        if (exiting) await cancelV12Protection(this.d.adapter, exiting.protection);
        syncActivePositions(state, remaining); state.pending = undefined; state.lastCompletedIdempotencyKey = pending.idempotencyKey; state.cooldownUntilTs = pending.signalTs + V12_X1_ALL.cooldownBars * V12_X1_ALL.timeframeHours * 3_600_000; await this.d.stateStore.save(state);
        return { status: "exited" as const, reason: "EXIT_RECONCILED", clientOrderId: pending.clientOrderId };
    }

    private async reconcilePendingStopUpdate(state: V12X1AllRunnerState, pending: V12PendingOrderState, positions: DirectPosition[]): Promise<V12LiveTickResult | undefined> {
        const active = activePositionsOf(state).find((row) => row.positionId === pending.positionId);
        if (!active) return this.fail(state, "V12_STOP_UPDATE_PENDING_WITHOUT_ACTIVE_STATE");
        const actual = positions.find((row) => row.symbol.toUpperCase() === active.symbol.toUpperCase() && Math.abs(row.quantity) > EPS);
        if (!actual || !positionMatches(active, actual)) return this.fail(state, "V12_STOP_UPDATE_POSITION_MISMATCH");
        if (pending.positionId !== active.positionId || pending.symbol !== active.symbol || pending.side !== active.side || Math.abs(pending.quantity - active.quantity) > Math.max(1e-8, active.quantity * 0.01)) {
            return this.fail(state, "V12_STOP_UPDATE_METADATA_MISMATCH");
        }
        if (!(Number(pending.stopPrice) > 0) || !Number.isFinite(Number(pending.nextPeakOrTrough))) return this.fail(state, "V12_STOP_UPDATE_METADATA_INVALID");
        const plan: V12TrailingPlan = {
            clientOrderId: pending.clientOrderId,
            stopPrice: Number(pending.stopPrice),
            previousStopClientOrderId: pending.previousStopClientOrderId,
            nextPeakOrTrough: Number(pending.nextPeakOrTrough),
        };
        const applied = await applyV12TrailingStop(this.d.adapter, active.protection, plan);
        if (applied.manualReview) return this.fail(state, applied.manualReview);
        const updated = { ...active, quantity: actualQuantity(actual), entryPrice: actual.entryPrice || active.entryPrice, protection: applied };
        syncActivePositions(state, activePositionsOf(state).map((row) => row.positionId === active.positionId ? updated : row));
        state.pending = undefined;
        await this.d.stateStore.save(state);
        await this.verifyNoUnexpectedV12Orders(state);
        return undefined;
    }

    private async restartReconcile(state: V12X1AllRunnerState, positions: DirectPosition[], quality102Ownership?: Quality102CausalV1OwnershipSnapshot) : Promise<V12LiveTickResult | undefined> {
        this.validatePortfolioPositions(positions, quality102Ownership);
        if (state.killSwitch?.active || state.manualReview) return { status: "manual-review", reason: state.killSwitch?.reason || state.manualReview || "V12_MANUAL_REVIEW" };
        if (state.pending) {
            if (state.pending.action === "ENTRY") return this.reconcilePendingEntry(state, state.pending, positions);
            if (state.pending.action === "EXIT") return this.reconcilePendingExit(state, state.pending, positions);
            if (state.pending.action === "STOP_UPDATE") {
                const recovery = await this.reconcilePendingStopUpdate(state, state.pending, positions);
                if (recovery) return recovery;
                state = await this.d.stateStore.load();
            } else if (state.pending.action === "DYNAMIC_TRIM") {
                return this.fail(state, `V12_DYNAMIC_TRIM_PENDING_REQUIRES_MANUAL_REVIEW:${state.pending.clientOrderId}`);
            } else {
                return this.fail(state, `V12_FAILSAFE_CLOSE_PENDING_REQUIRES_MANUAL_REVIEW:${state.pending.clientOrderId}`);
            }
        }
        const v12Actual = positions.filter((row) => V12_SYMBOLS.has(row.symbol.toUpperCase()) && Math.abs(row.quantity) > EPS);
        const stateActives = activePositionsOf(state);
        if (!stateActives.length && v12Actual.length) return this.fail(state, `V12_POSITION_ONLY_MISMATCH:${v12Actual.map((row) => row.symbol).join(",")}`);
        if (stateActives.length) {
            if (v12Actual.length !== stateActives.length) {
                const actualSymbols = new Set(v12Actual.map((row) => row.symbol.toUpperCase()));
                const missing = stateActives.filter((active) => !actualSymbols.has(active.symbol.toUpperCase()));
                if (!missing.length || v12Actual.length > stateActives.length) return this.fail(state, "V12_POSITION_COUNT_MISMATCH");
                for (const active of missing) {
                    if (!(await this.completedProtectionExit(active))) return this.fail(state, `V12_STATE_ONLY_POSITION_MISMATCH:${active.symbol}`);
                }
                const remaining = stateActives.filter((active) => actualSymbols.has(active.symbol.toUpperCase()));
                for (const active of missing) await cancelV12Protection(this.d.adapter, active.protection);
                syncActivePositions(state, remaining); state.cooldownUntilTs = (state.lastReferenceTs || this.now()) + V12_X1_ALL.cooldownBars * V12_X1_ALL.timeframeHours * 3_600_000; await this.d.stateStore.save(state);
            } else {
                const refreshed: V12ActivePositionState[] = [];
                for (const active of stateActives) {
                    const actual = v12Actual.find((row) => row.symbol.toUpperCase() === active.symbol.toUpperCase());
                    if (!actual || !positionMatches(active, actual)) return this.fail(state, "V12_POSITION_SIDE_OR_QTY_MISMATCH");
                    const protection = await reconcileV12Protection(this.d.adapter, active.protection);
                    if (protection.manualReview) return this.fail(state, protection.manualReview);
                    refreshed.push({ ...active, quantity: actualQuantity(actual), entryPrice: actual.entryPrice || active.entryPrice, protection });
                }
                syncActivePositions(state, refreshed); await this.d.stateStore.save(state);
            }
        }
        await this.verifyNoUnexpectedV12Orders(state);
        return undefined;
    }

    private async executeExit(state: V12X1AllRunnerState, active: V12ActivePositionState, signalTs: number, reason: string): Promise<V12LiveTickResult> {
        const quote = await this.d.adapter.executor.getMarketQuote(active.symbol);
        const clientOrderId = deterministicV12ClientOrderId({ action: "EXIT", signalTs, symbol: active.symbol, side: active.side, version: reason });
        const pending: V12PendingOrderState = { idempotencyKey: clientOrderId, action: "EXIT", clientOrderId, symbol: active.symbol, side: active.side, quantity: active.quantity, signalTs, expectedPrice: active.side === "LONG" ? quote.bidPrice : quote.askPrice, reason, createdAt: this.now() };
        state.pending = pending; await this.d.stateStore.save(state);
        const result = await this.d.adapter.executeExit({ signalTs, symbol: active.symbol, positionSide: active.side, quantity: active.quantity, expectedPrice: pending.expectedPrice!, clientOrderId });
        if (result.status === "UNKNOWN") return this.fail(state, `V12_EXIT_UNKNOWN:${clientOrderId}`);
        const positions = await this.d.adapter.getPositions(); const remains = positions.some((row) => row.symbol.toUpperCase() === active.symbol && Math.abs(row.quantity) > EPS);
        if (remains) return this.fail(state, `V12_EXIT_NOT_FLAT:${result.status}`);
        await cancelV12Protection(this.d.adapter, active.protection); syncActivePositions(state, activePositionsOf(state).filter((row) => row.positionId !== active.positionId)); state.pending = undefined; state.lastCompletedIdempotencyKey = pending.idempotencyKey; state.cooldownUntilTs = signalTs + V12_X1_ALL.cooldownBars * V12_X1_ALL.timeframeHours * 3_600_000; await this.d.stateStore.save(state);
        return { status: "exited", reason, clientOrderId };
    }

    private async executeEntryForSignal(
        state: V12X1AllRunnerState,
        handle: Awaited<ReturnType<FileAccountOrderLock["acquire"]>> extends infer T ? Exclude<T, null> : never,
        signal: V12Signal,
        equity: number,
        sizing: ReturnType<typeof sizeV12Position>,
        decision: V12ResidualDecision,
    ): Promise<V12LiveTickResult> {
        const acceptedGross = decision.acceptedGross;
        const symbol = `${signal.symbol}USDT`;
        const quote = await this.d.adapter.executor.getMarketQuote(symbol);
        const expectedPrice = signal.side === "LONG" ? quote.askPrice : quote.bidPrice;
        const scale = sizing.requestedGross > 0 ? acceptedGross / sizing.requestedGross : 0;
        const quantity = sizing.quantity * scale;
        if (!(quantity > 0)) return { status: "capacity-blocked", reason: "ZERO_EXECUTABLE_QUANTITY", signal };
        const clientOrderId = deterministicV12ClientOrderId({ action: "ENTRY", signalTs: signal.referenceTs, symbol, side: signal.side });
        if (state.lastCompletedIdempotencyKey === clientOrderId) return { status: "held", reason: "SAME_SIGNAL_ALREADY_COMPLETED", signal, clientOrderId };
        const reservation = await handle.reserve({ strategyId: "V12_X1.00_ALL", symbol, side: signal.side, gross: acceptedGross, notionalUsd: acceptedGross * equity });
        const pending: V12PendingOrderState = {
            idempotencyKey: clientOrderId,
            action: "ENTRY",
            clientOrderId,
            symbol,
            side: signal.side,
            quantity,
            signalTs: signal.referenceTs,
            expectedPrice,
            requestedGross: acceptedGross,
            baseRequestedGross: decision.baseAcceptedGross,
            dynamicRequestedGross: decision.dynamicAcceptedGross,
            entryRank: signal.rank,
            atrAtEntry: signal.atr,
            reason: decision.dynamicAcceptedGross > EPS ? "signal-entry-with-dynamic-residual" : "signal-entry-base",
            createdAt: this.now(),
        };
        state.pending = pending; await this.d.stateStore.save(state);
        const result = await this.d.adapter.executeEntry({ signalTs: signal.referenceTs, symbol, side: signal.side, quantity, expectedPrice, clientOrderId });
        await handle.releaseReservation(reservation.reservationId);
        if (result.status === "UNKNOWN") return this.fail(state, `V12_ENTRY_UNKNOWN:${clientOrderId}`);
        if (!resultHasExposure(result)) { state.pending = undefined; state.lastCompletedIdempotencyKey = clientOrderId; await this.d.stateStore.save(state); return { status: "held", reason: `ENTRY_${result.status}_NO_RETRY`, signal, clientOrderId }; }
        const refreshed = await this.d.adapter.getPositions(); const actual = refreshed.find((row) => row.symbol.toUpperCase() === symbol && Math.abs(row.quantity) > EPS);
        if (!actual || actualSide(actual) !== signal.side) return this.fail(state, "V12_ENTRY_FILL_POSITION_MISMATCH");
        const entryPrice = actual.entryPrice > 0 ? actual.entryPrice : result.averagePrice; const protectionState = initialProtection({ symbol, side: signal.side, quantity: actualQuantity(actual), entryPrice, atr: signal.atr, positionId: clientOrderId });
        const actualGross = Math.abs(actual.notionalUsd) / equity;
        if (!(actualGross > 0 && actualGross <= acceptedGross + 1e-6 && actualGross <= V12_X1_ALL.perPositionEntryGrossCap + EPS)) return this.fail(state, "V12_ENTRY_FILL_GROSS_MISMATCH");
        const filledQuantity = actualQuantity(actual);
        const plannedTotalGross = decision.baseAcceptedGross + decision.dynamicAcceptedGross;
        const baseRatio = plannedTotalGross > EPS ? Math.max(0, Math.min(1, decision.baseAcceptedGross / plannedTotalGross)) : 1;
        const active: V12ActivePositionState = {
            symbol,
            side: signal.side,
            quantity: filledQuantity,
            gross: actualGross,
            baseQuantity: filledQuantity * baseRatio,
            dynamicQuantity: filledQuantity * (1 - baseRatio),
            baseGross: actualGross * baseRatio,
            dynamicGross: actualGross * (1 - baseRatio),
            dynamicUpdatedAt: decision.dynamicAcceptedGross > EPS ? this.now() : undefined,
            entryRank: signal.rank,
            positionId: clientOrderId,
            entryPrice,
            atrAtEntry: signal.atr,
            entrySignalTs: signal.referenceTs,
            holdingBars: 0,
            peakPrice: entryPrice,
            troughPrice: entryPrice,
            protection: protectionState,
        };
        syncActivePositions(state, [...activePositionsOf(state).filter((row) => row.symbol.toUpperCase() !== symbol), active]); await this.d.stateStore.save(state);
        const installed = await installV12Protection(this.d.adapter, protectionState);
        if (installed.manualReview) return this.fail(state, installed.manualReview);
        syncActivePositions(state, activePositionsOf(state).map((row) => row.positionId === clientOrderId ? { ...row, protection: installed } : row)); state.pending = undefined; state.lastCompletedIdempotencyKey = clientOrderId; await this.d.stateStore.save(state);
        return { status: "entered", reason: result.status === "PARTIALLY_FILLED" ? "PARTIAL_FILL_PROTECTED" : "ENTRY_FILLED_AND_PROTECTED", signal, clientOrderId };
    }

    async tick(): Promise<V12LiveTickResult> {
        let preloadedData: Record<string, V12Bar[]> | undefined;
        try {
            const beforeLockState = await this.d.stateStore.load();
            if (!beforeLockState.pending) preloadedData = await this.d.marketData.load();
            if (!beforeLockState.pending) {
                await readSharedCryptoDailyRiskWithRolloverRetry(this.d.riskPath, {
                    now: this.now,
                    rolloverGraceMs: 60_000,
                    pollMs: 2_000,
                    maxAttempts: 31,
                });
            }
        } catch {
            // Preserve the existing fail-closed path under the shared lock.
        }
        const handle = await this.d.lock.acquire(`V12_X1.00_ALL:${process.pid}:${randomUUID()}`); if (!handle) return { status: "locked", reason: "ACCOUNT_LOCK_BUSY_OR_STALE_REVIEW_REQUIRED" };
        try {
            let state = await this.d.stateStore.load();
            if (!(await this.d.adapter.credentialsReady())) return this.fail(state, "V12_ASTER_CREDENTIALS_NOT_READY");
            const risk = await readSharedCryptoDailyRisk(this.d.riskPath, this.now());
            const [account, positions] = await Promise.all([this.d.adapter.getAccountSnapshot(), this.d.adapter.getPositions()]);
            const quality102Ownership = await readQuality102CausalV1Ownership({ expectedRuntimeSha: process.env.DISDEX_Q102_RUNTIME_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA });
            const recovery = await this.restartReconcile(state, positions, quality102Ownership); if (recovery) return recovery;
            state = await this.d.stateStore.load();
            const data = preloadedData ?? await this.d.marketData.load(); const index = latestIndex(data); const latestTs = data[V12_X1_ALL.universe[0]][index].endTs;

            const actives = activePositionsOf(state);
            const signals = buildV12Signals(data, index);
            if (this.d.decisionObserver) {
                try {
                    const observation = buildV12DecisionObservation(data, index, this.now());
                    if (observation) await this.d.decisionObserver(observation);
                } catch (error) {
                    this.log("v12-decision-observation-write-failed", { reason: safeV12ErrorMessage(error), referenceTs: latestTs });
                }
            }
            if (actives.length) {
                const deferredEntryRetry = state.deferredEntryReferenceTs === latestTs;
                if (!deferredEntryRetry) {
                    if (state.lastReferenceTs !== undefined && latestTs <= state.lastReferenceTs) return { status: "held", reason: "NO_NEW_CONFIRMED_2H_BAR" };
                    const updated: V12ActivePositionState[] = [];
                    for (const active of actives) {
                        const activeBars = data[active.symbol.replace(/USDT$/, "")]; if (!activeBars) return this.fail(state, "V12_ACTIVE_SYMBOL_MARKET_DATA_MISSING");
                        const activeBar = activeBars[index];
                        const planned = await planV12TrailingStop(this.d.adapter, active.protection, activeBar.close);
                        let protection = planned.state;
                        if (planned.plan) {
                            const liveQuote = await this.d.adapter.executor.getMarketQuote(active.symbol);
                            const trailingStopAlreadyCrossed = active.side === "LONG"
                                ? liveQuote.bidPrice <= planned.plan.stopPrice
                                : liveQuote.askPrice >= planned.plan.stopPrice;
                            if (trailingStopAlreadyCrossed) {
                                return await this.executeExit(state, active, latestTs, "trailing-stop-crossed-before-replacement");
                            }
                            const pending: V12PendingOrderState = { idempotencyKey: planned.plan.clientOrderId, action: "STOP_UPDATE", clientOrderId: planned.plan.clientOrderId, symbol: active.symbol, side: active.side, quantity: active.quantity, signalTs: latestTs, reason: "TRAILING_STOP_UPDATE", createdAt: this.now(), positionId: active.positionId, stopPrice: planned.plan.stopPrice, previousStopClientOrderId: planned.plan.previousStopClientOrderId, nextPeakOrTrough: planned.plan.nextPeakOrTrough };
                            state.pending = pending; await this.d.stateStore.save(state);
                            protection = await applyV12TrailingStop(this.d.adapter, planned.state, planned.plan);
                            if (protection.manualReview) return this.fail(state, protection.manualReview);
                            state.pending = undefined;
                        }
                        const holdingBars = active.holdingBars + 1;
                        updated.push({ ...active, holdingBars, peakPrice: Math.max(active.peakPrice, activeBar.high), troughPrice: Math.min(active.troughPrice, activeBar.low), protection });
                    }
                    syncActivePositions(state, updated); state.lastReferenceTs = latestTs; await this.d.stateStore.save(state);
                    for (const active of activePositionsOf(state)) {
                        const primary = signals[0];
                        const changed = Boolean(primary && (`${primary.symbol}USDT` !== active.symbol || primary.side !== active.side));
                        const reason = active.holdingBars >= V12_X1_ALL.maxHoldBars ? "max-hold" : active.holdingBars >= V12_X1_ALL.rebalanceBars && changed ? "signal-rotation" : undefined;
                        if (reason) return await this.executeExit(state, active, latestTs, reason);
                    }
                }
                if (activePositionsOf(state).length >= V12_X1_ALL.maximumPositions) {
                    state.deferredEntryReferenceTs = undefined; await this.d.stateStore.save(state);
                    return { status: "held", reason: "V12_POSITION_HELD", signal: signals[0] };
                }
                const currentActives = activePositionsOf(state);
                const existingSymbols = new Set(currentActives.map((row) => row.symbol.toUpperCase()));
                const next = signals.find((candidate) => !existingSymbols.has(`${candidate.symbol}USDT`) && v12SlotAvailable(currentActives, candidate.rank));
                if (!next) {
                    state.deferredEntryReferenceTs = undefined; await this.d.stateStore.save(state);
                    return { status: "held", reason: "V12_POSITION_HELD", signal: signals[0] };
                }
                if (!risk.ok) {
                    state.deferredEntryReferenceTs = latestTs; await this.d.stateStore.save(state);
                    return { status: "risk-blocked", reason: `SHARED_CRYPTO_RISK:${risk.reason}`, signal: next };
                }
                if (state.deferredEntryReferenceTs !== undefined) {
                    state.deferredEntryReferenceTs = undefined; await this.d.stateStore.save(state);
                }
                let equity = 0;
                let sizing: ReturnType<typeof sizeV12Position> | undefined;
                let decision: V12ResidualDecision | undefined;
                for (let attempt = 0; attempt < 2; attempt += 1) {
                    const [freshAccount, freshPositions] = await Promise.all([
                        this.d.adapter.getAccountSnapshot(),
                        this.d.adapter.getPositions(),
                    ]);
                    equity = Math.max(0, finite(freshAccount.walletBalance));
                    if (!(equity > 0)) return this.fail(state, "V12_ACCOUNT_EQUITY_INVALID");
                    const freshActive = this.activePortfolio(freshPositions, equity, quality102Ownership);
                    const quote = await this.d.adapter.executor.getMarketQuote(`${next.symbol}USDT`);
                    sizing = sizeV12Position(
                        equity,
                        next.side === "LONG" ? quote.askPrice : quote.bidPrice,
                        next.atr,
                        next.side,
                    );
                    const v12Components = v12GrossComponents(state, freshActive);
                    const snapshot = {
                        v12Gross: freshActive.filter((row) => row.sleeve === "V12").reduce((sum, row) => sum + row.gross, 0),
                        v12BaseGross: v12Components.baseGross,
                        v12DynamicGross: v12Components.dynamicGross,
                        cryptoGross: freshActive.filter((row) => row.sleeve === "V12" || row.sleeve === "PENGU_DUAL_LS_V2").reduce((sum, row) => sum + row.gross, 0),
                        stockGross: freshActive.filter((row) => row.sleeve === "V11_EQ" || row.sleeve === "V50_POST_OPEN_BASIS").reduce((sum, row) => sum + row.gross, 0),
                        totalGross: freshActive.reduce((sum, row) => sum + row.gross, 0),
                    };
                    const rankedRequestGross = Math.min(sizing.requestedGross, v12EntryGrossCapForRank(next.rank));
                    decision = decideV12ResidualEntry(rankedRequestGross, snapshot, activePositionsOf(state).length);
                    const requestedBase = Math.min(
                        rankedRequestGross,
                        v12EntryGrossCapForRank(next.rank),
                        Math.max(0, V12_X1_ALL.aggregateEntryGrossCap - v12Components.baseGross),
                    );
                    const trimNeeded = Math.min(
                        Math.max(0, requestedBase - decision.baseAcceptedGross),
                        v12Components.dynamicGross,
                    );
                    if (attempt === 0 && trimNeeded > 1e-9) {
                        const trim = await reduceV12DynamicResidualForCoreConflict({
                            adapter: this.d.adapter,
                            requiredGross: trimNeeded,
                            equity,
                            causeIdempotencyKey: `V12_BASE_PRIORITY|${next.referenceTs}|${next.symbol}|${next.side}`,
                            statePath: this.d.statePath,
                            now: this.now,
                        });
                        if (trim.status === "blocked") return this.fail(state, trim.message);
                        if (trim.status === "reduced" && trim.trimmedGross > 1e-9) {
                            state = await this.d.stateStore.load();
                            continue;
                        }
                    }
                    break;
                }
                if (!sizing || !decision || !(decision.acceptedGross > 0)) {
                    return { status: "capacity-blocked", reason: `V12_RANK2_${decision?.reason || "NO_RESIDUAL"}`, signal: next };
                }
                return await this.executeEntryForSignal(state, handle, next, equity, sizing, decision);
            }

            if (!risk.ok) return { status: "risk-blocked", reason: `SHARED_CRYPTO_RISK:${risk.reason}` };
            const deferredFlatEntryRetry = state.deferredEntryReferenceTs === latestTs;
            if (!deferredFlatEntryRetry && state.lastReferenceTs !== undefined && latestTs <= state.lastReferenceTs) return { status: "no-signal", reason: "NO_NEW_CONFIRMED_2H_BAR" };
            state.lastReferenceTs = latestTs;
            state.deferredEntryReferenceTs = undefined;
            if (!signals.length) { await this.d.stateStore.save(state); return { status: "no-signal", reason: "NO_COMPLETED_BAR_SIGNAL" }; }
            if ((state.cooldownUntilTs || 0) > latestTs) { await this.d.stateStore.save(state); return { status: "held", reason: "V12_COOLDOWN_ACTIVE", signal: signals[0] }; }
            let latestPositions = positions;
            let lastResult: V12LiveTickResult = { status: "no-signal", reason: "NO_ENTRY" };
            let enteredCount = 0;
            for (const signal of signals.slice(0, V12_X1_ALL.maximumPositions)) {
                const currentActives = activePositionsOf(state);
                if (currentActives.some((position) => position.symbol.toUpperCase() === `${signal.symbol}USDT`) || !v12SlotAvailable(currentActives, signal.rank)) continue;
                const [freshAccount, freshPositions] = await Promise.all([this.d.adapter.getAccountSnapshot(), this.d.adapter.getPositions()]);
                latestPositions = freshPositions;
                const entryEquity = Math.max(0, finite(freshAccount.walletBalance)); if (!(entryEquity > 0)) return this.fail(state, "V12_ACCOUNT_EQUITY_INVALID");
                const activePortfolio = this.activePortfolio(latestPositions, entryEquity, quality102Ownership);
                const quote = await this.d.adapter.executor.getMarketQuote(`${signal.symbol}USDT`);
                const entryPrice = signal.side === "LONG" ? quote.askPrice : quote.bidPrice;
                const sizing = sizeV12Position(entryEquity, entryPrice, signal.atr, signal.side);
                const v12Components = v12GrossComponents(state, activePortfolio);
                const snapshot = { v12Gross: activePortfolio.filter((row) => row.sleeve === "V12").reduce((sum, row) => sum + row.gross, 0), v12BaseGross: v12Components.baseGross, v12DynamicGross: v12Components.dynamicGross, cryptoGross: activePortfolio.filter((row) => row.sleeve === "V12" || row.sleeve === "PENGU_DUAL_LS_V2").reduce((sum, row) => sum + row.gross, 0), stockGross: activePortfolio.filter((row) => row.sleeve === "V11_EQ" || row.sleeve === "V50_POST_OPEN_BASIS").reduce((sum, row) => sum + row.gross, 0), totalGross: activePortfolio.reduce((sum, row) => sum + row.gross, 0) };
                const rankedRequestGross = Math.min(sizing.requestedGross, v12EntryGrossCapForRank(signal.rank));
                const decision = decideV12ResidualEntry(rankedRequestGross, snapshot, activePositionsOf(state).length);
                if (!(decision.acceptedGross > 0)) {
                    if (enteredCount === 0) lastResult = { status: "capacity-blocked", reason: `V12_RANK${activePositionsOf(state).length + 1}_${decision.reason || "NO_RESIDUAL"}`, signal };
                    break;
                }
                const entryResult = await this.executeEntryForSignal(state, handle, signal, entryEquity, sizing, decision);
                if (entryResult.status === "manual-review") return entryResult;
                if (entryResult.status !== "entered") { if (enteredCount === 0) lastResult = entryResult; break; }
                enteredCount += 1;
                lastResult = { ...entryResult, reason: `V12_ENTRIES_COMPLETED:${enteredCount}` };
            }
            return lastResult;
        } catch (error) {
            const state = await this.d.stateStore.load(); return this.fail(state, safeV12ErrorMessage(error));
        } finally { await handle.release(); }
    }
}
