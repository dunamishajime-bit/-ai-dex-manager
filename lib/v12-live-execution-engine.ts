import { randomUUID } from "node:crypto";

import { V12_X1_ALL } from "@/config/v12X1AllRuntime";
import { FileAccountOrderLock, type AccountLockHandle } from "@/lib/disdex-account-order-lock";
import { classifyAsterSymbol } from "@/lib/disdex-aster-portfolio-classifier";
import { readSharedCryptoDailyRisk } from "@/lib/disdex-shared-crypto-daily-risk";
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
import { buildV12DecisionEvaluation, protectiveLevels, sizeV12Position, type V12Bar, type V12DecisionEvaluation, type V12Signal } from "@/lib/v12-x1-all";
import type { V12DecisionSnapshotInput } from "@/lib/v12-decision-snapshot-writer";
import { FileV12X1AllRunnerStateStore, v12ActivePositionsAggregateGross, v12ExistingAggregateGrossOverCap, V12_AGGREGATE_GROSS_CAP, type V12ActivePositionState, type V12PendingOrderState, type V12X1AllRunnerState } from "@/lib/v12-x1-all-runner-state";
import { decideV12ResidualEntry } from "@/lib/v12-top2-residual";
import type { DirectPosition, DirectTradeResult } from "@/lib/direct-trade-executor";

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
    writeDecisionSnapshot?: (input: V12DecisionSnapshotInput) => Promise<unknown>;
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
function latestIndex(data: Record<string, V12Bar[]>) {
    const rows = Object.entries(data); if (rows.length !== V12_X1_ALL.universe.length) throw new Error("V12_MARKET_DATA_UNIVERSE_MISMATCH");
    const lengths = rows.map(([, bars]) => bars.length); if (!lengths.length || Math.min(...lengths) < 80 || lengths.some((length) => length !== lengths[0])) throw new Error("V12_MARKET_DATA_ALIGNMENT_REQUIRED");
    const index = lengths[0] - 1; const endTs = rows[0][1][index].endTs;
    if (rows.some(([, bars]) => bars[index].endTs !== endTs)) throw new Error("V12_MARKET_DATA_TIMESTAMP_MISMATCH");
    return index;
}
function isRecoverableAccountLockError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("account-order.lock") && (message.includes("ENOENT") || message.includes("ACCOUNT_LOCK_NOT_OWNER"));
}
function initialProtection(input: { symbol: string; side: "LONG" | "SHORT"; quantity: number; entryPrice: number; atr: number; positionId: string }): V12StopState {
    const levels = protectiveLevels(input.entryPrice, input.atr, input.side);
    return { strategyId: "V12_X1.00_ALL", symbol: input.symbol, side: input.side, positionId: input.positionId, quantity: input.quantity, entryPrice: input.entryPrice, atrAtEntry: input.atr, initialStop: levels.initialStop, lastAckStop: levels.initialStop, takeProfit: levels.takeProfit, peakOrTrough: input.entryPrice };
}

function activePositionsOf(state: V12X1AllRunnerState): V12ActivePositionState[] {
    if (Array.isArray(state.activePositions) && state.activePositions.length) return [...state.activePositions];
    return state.active ? [state.active] : [];
}

function syncActivePositions(state: V12X1AllRunnerState, positions: V12ActivePositionState[]) {
    const ranked = positions.filter((position) => position.quantity > EPS);
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

    private async writeDecisionSnapshot(evaluation: V12DecisionEvaluation, selected?: V12Signal, requestedGross?: number, rationale?: string) {
        if (!this.d.writeDecisionSnapshot) return;
        const selectedRow = selected ? evaluation.candidates.find((candidate) => candidate.symbol === selected.symbol) : undefined;
        await this.d.writeDecisionSnapshot({
            selected: selected ? { ...selected, rank: selectedRow?.rank, requestedGross } : undefined,
            referenceTs: evaluation.referenceTs,
            entryTs: evaluation.entryTs,
            regime: evaluation.regime,
            btcRegime: evaluation.regime,
            rationale,
            candidates: evaluation.candidates.map((candidate) => ({
                symbol: candidate.symbol,
                side: candidate.side,
                rank: candidate.rank,
                score: candidate.score,
                momentum: candidate.momentum,
                volumeRatio: candidate.volumeRatio,
            })),
        });
    }

    private validatePortfolioPositions(positions: DirectPosition[]) {
        for (const position of positions.filter((row) => Math.abs(row.quantity) > EPS)) {
            const classification = classifyAsterSymbol(position.symbol);
            if (!classification.tradable) throw new Error(`ASTER_UNKNOWN_NONZERO_POSITION:${position.symbol}`);
        }
    }

    private activePortfolio(positions: DirectPosition[], equity: number): ActivePortfolioPosition[] {
        if (!(equity > 0)) throw new Error("V12_ACCOUNT_EQUITY_INVALID");
        return positions.filter((row) => Math.abs(row.quantity) > EPS).map((position) => {
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

    private async completedProtectionExit(state: V12X1AllRunnerState) {
        for (const active of activePositionsOf(state)) {
            const ids = [active.protection.stopClientOrderId, active.protection.takeProfitClientOrderId].filter((value): value is string => Boolean(value));
            for (const clientOrderId of ids) {
                const order = await this.d.adapter.queryOrderSameId(active.symbol, clientOrderId);
                if (order?.status === "FILLED") return true;
            }
        }
        return false;
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
        const quantity = actualQuantity(actual); const entryPrice = actual.entryPrice > 0 ? actual.entryPrice : result.averagePrice;
        if (!(entryPrice > 0 && pending.atrAtEntry && pending.atrAtEntry > 0)) return this.fail(state, "V12_PENDING_ENTRY_RECOVERY_METADATA_INVALID");
        const protection = initialProtection({ symbol: pending.symbol, side: pending.side, quantity, entryPrice, atr: pending.atrAtEntry, positionId: pending.clientOrderId });
        const existing = activePositionsOf(state).filter((row) => row.symbol.toUpperCase() !== pending.symbol.toUpperCase());
        let active: V12ActivePositionState = { symbol: pending.symbol, side: pending.side, quantity, gross: pending.requestedGross || 0, positionId: pending.clientOrderId, entryPrice, atrAtEntry: pending.atrAtEntry, entrySignalTs: pending.signalTs, holdingBars: 0, peakPrice: entryPrice, troughPrice: entryPrice, protection };
        active = { ...active, quantity, entryPrice, protection: { ...active.protection, quantity, entryPrice } };
        syncActivePositions(state, [...existing, active]); await this.d.stateStore.save(state);
        const installed = await installV12Protection(this.d.adapter, active.protection);
        if (installed.manualReview) { state.active = undefined; state.pending = undefined; return this.fail(state, installed.manualReview); }
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

    private async restartReconcile(state: V12X1AllRunnerState, positions: DirectPosition[]) : Promise<V12LiveTickResult | undefined> {
        this.validatePortfolioPositions(positions);
        if (state.killSwitch?.active || state.manualReview) return { status: "manual-review", reason: state.killSwitch?.reason || state.manualReview || "V12_MANUAL_REVIEW" };
        if (state.pending) {
            if (state.pending.action === "ENTRY") return this.reconcilePendingEntry(state, state.pending, positions);
            if (state.pending.action === "EXIT") return this.reconcilePendingExit(state, state.pending, positions);
            if (state.pending.action === "STOP_UPDATE") {
                const recovery = await this.reconcilePendingStopUpdate(state, state.pending, positions);
                if (recovery) return recovery;
                state = await this.d.stateStore.load();
            } else {
                return this.fail(state, `V12_FAILSAFE_CLOSE_PENDING_REQUIRES_MANUAL_REVIEW:${state.pending.clientOrderId}`);
            }
        }
        const v12Actual = positions.filter((row) => V12_SYMBOLS.has(row.symbol.toUpperCase()) && Math.abs(row.quantity) > EPS);
        const stateActives = activePositionsOf(state);
        if (!stateActives.length && v12Actual.length) return this.fail(state, `V12_POSITION_ONLY_MISMATCH:${v12Actual.map((row) => row.symbol).join(",")}`);
        if (stateActives.length) {
            if (v12Actual.length !== stateActives.length) {
                if (await this.completedProtectionExit(state)) {
                    const actualSymbols = new Set(v12Actual.map((row) => row.symbol.toUpperCase()));
                    const remaining = stateActives.filter((active) => actualSymbols.has(active.symbol.toUpperCase()));
                    for (const active of stateActives.filter((row) => !actualSymbols.has(row.symbol.toUpperCase()))) await cancelV12Protection(this.d.adapter, active.protection);
                    syncActivePositions(state, remaining); state.cooldownUntilTs = (state.lastReferenceTs || this.now()) + V12_X1_ALL.cooldownBars * V12_X1_ALL.timeframeHours * 3_600_000; await this.d.stateStore.save(state);
                } else return this.fail(state, "V12_POSITION_COUNT_MISMATCH");
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
        acceptedGross: number,
    ): Promise<V12LiveTickResult> {
        const symbol = `${signal.symbol}USDT`;
        const quote = await this.d.adapter.executor.getMarketQuote(symbol);
        const expectedPrice = signal.side === "LONG" ? quote.askPrice : quote.bidPrice;
        const scale = sizing.requestedGross > 0 ? acceptedGross / sizing.requestedGross : 0;
        const quantity = sizing.quantity * scale;
        if (!(quantity > 0)) return { status: "capacity-blocked", reason: "ZERO_EXECUTABLE_QUANTITY", signal };
        // Check exchange lot/notional rules before writing a pending order.
        // A signal whose requested notional cannot produce one executable
        // unit is a deterministic capacity block, not a failed live order.
        // Keeping this check before reservation/pending also ensures the
        // same signal cannot leave a stale pending row or trip Kill Switch.
        try {
            await this.d.adapter.executor.normalizeMarketQuantity(symbol, quantity, expectedPrice);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/^(?:Quantity .* is below Aster minQty|Notional .* is below Aster minimum)/i.test(message)) {
                return { status: "capacity-blocked", reason: `EXECUTION_RULE_BLOCKED:${message}`, signal };
            }
            throw error;
        }
        const clientOrderId = deterministicV12ClientOrderId({ action: "ENTRY", signalTs: signal.referenceTs, symbol, side: signal.side });
        if (state.lastCompletedIdempotencyKey === clientOrderId) return { status: "held", reason: "SAME_SIGNAL_ALREADY_COMPLETED", signal, clientOrderId };
        const reservation = await handle.reserve({ strategyId: "V12_X1.00_ALL", symbol, side: signal.side, gross: acceptedGross, notionalUsd: acceptedGross * equity });
        const pending: V12PendingOrderState = { idempotencyKey: clientOrderId, action: "ENTRY", clientOrderId, symbol, side: signal.side, quantity, signalTs: signal.referenceTs, expectedPrice, requestedGross: acceptedGross, atrAtEntry: signal.atr, reason: "signal-entry", createdAt: this.now() };
        state.pending = pending; await this.d.stateStore.save(state);
        const result = await this.d.adapter.executeEntry({ signalTs: signal.referenceTs, symbol, side: signal.side, quantity, expectedPrice, clientOrderId });
        await handle.releaseReservation(reservation.reservationId);
        if (result.status === "UNKNOWN") return this.fail(state, `V12_ENTRY_UNKNOWN:${clientOrderId}`);
        if (!resultHasExposure(result)) { state.pending = undefined; state.lastCompletedIdempotencyKey = clientOrderId; await this.d.stateStore.save(state); return { status: "held", reason: `ENTRY_${result.status}_NO_RETRY`, signal, clientOrderId }; }
        const refreshed = await this.d.adapter.getPositions(); const actual = refreshed.find((row) => row.symbol.toUpperCase() === symbol && Math.abs(row.quantity) > EPS);
        if (!actual || actualSide(actual) !== signal.side) return this.fail(state, "V12_ENTRY_FILL_POSITION_MISMATCH");
        const entryPrice = actual.entryPrice > 0 ? actual.entryPrice : result.averagePrice; const protectionState = initialProtection({ symbol, side: signal.side, quantity: actualQuantity(actual), entryPrice, atr: signal.atr, positionId: clientOrderId });
        const active: V12ActivePositionState = { symbol, side: signal.side, quantity: actualQuantity(actual), gross: acceptedGross, positionId: clientOrderId, entryPrice, atrAtEntry: signal.atr, entrySignalTs: signal.referenceTs, holdingBars: 0, peakPrice: entryPrice, troughPrice: entryPrice, protection: protectionState };
        syncActivePositions(state, [...activePositionsOf(state).filter((row) => row.symbol.toUpperCase() !== symbol), active]); await this.d.stateStore.save(state);
        const installed = await installV12Protection(this.d.adapter, protectionState);
        if (installed.manualReview) { syncActivePositions(state, activePositionsOf(state).filter((row) => row.positionId !== clientOrderId)); state.pending = undefined; return this.fail(state, installed.manualReview); }
        syncActivePositions(state, activePositionsOf(state).map((row) => row.positionId === clientOrderId ? { ...row, protection: installed } : row)); state.pending = undefined; state.lastCompletedIdempotencyKey = clientOrderId; await this.d.stateStore.save(state);
        return { status: "entered", reason: result.status === "PARTIALLY_FILLED" ? "PARTIAL_FILL_PROTECTED" : "ENTRY_FILLED_AND_PROTECTED", signal, clientOrderId };
    }

    async tick(): Promise<V12LiveTickResult> {
        let handle: AccountLockHandle | null;
        try {
            handle = await this.d.lock.acquire(`V12_X1.00_ALL:${process.pid}:${randomUUID()}`);
        } catch (error) {
            if (isRecoverableAccountLockError(error)) {
                this.log("v12-account-lock-retry", { reason: "ACCOUNT_LOCK_TRANSIENTLY_MISSING", ordersSent: false });
                return { status: "locked", reason: "ACCOUNT_LOCK_TRANSIENTLY_MISSING" };
            }
            throw error;
        }
        if (!handle) return { status: "locked", reason: "ACCOUNT_LOCK_BUSY_OR_STALE_REVIEW_REQUIRED" };
        try {
            let state = await this.d.stateStore.load();
            if (!(await this.d.adapter.credentialsReady())) return this.fail(state, "V12_ASTER_CREDENTIALS_NOT_READY");
            const risk = await readSharedCryptoDailyRisk(this.d.riskPath, this.now());
            const positions = await this.d.adapter.getPositions();
            const recovery = await this.restartReconcile(state, positions); if (recovery) return recovery;
            state = await this.d.stateStore.load();
            const data = await this.d.marketData.load(); const index = latestIndex(data); const latestTs = data[V12_X1_ALL.universe[0]][index].endTs;

            const actives = activePositionsOf(state);
            const evaluation = buildV12DecisionEvaluation(data, index);
            const signals = evaluation.signals;
            await this.writeDecisionSnapshot(evaluation, signals[0], undefined, "V12_SELECTION_EVALUATED");
            if (actives.length) {
                if (state.lastReferenceTs !== undefined && latestTs <= state.lastReferenceTs) return { status: "held", reason: "NO_NEW_CONFIRMED_2H_BAR" };
                const updated: V12ActivePositionState[] = [];
                for (const active of actives) {
                    const activeBars = data[active.symbol.replace(/USDT$/, "")]; if (!activeBars) return this.fail(state, "V12_ACTIVE_SYMBOL_MARKET_DATA_MISSING");
                    const activeBar = activeBars[index];
                    const planned = await planV12TrailingStop(this.d.adapter, active.protection, activeBar.close);
                    let protection = planned.state;
                    if (planned.plan) {
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
                    if (reason) return this.executeExit(state, active, latestTs, reason);
                }
                if (!risk.ok || activePositionsOf(state).length >= V12_X1_ALL.maximumPositions) return { status: risk.ok ? "held" : "risk-blocked", reason: risk.ok ? "V12_POSITION_HELD" : `SHARED_CRYPTO_RISK:${risk.reason}`, signal: signals[0] };
                const existingAggregateGross = v12ActivePositionsAggregateGross(state);
                if (v12ExistingAggregateGrossOverCap(state)) {
                    await this.writeDecisionSnapshot(evaluation, signals[0], undefined, "V12_EXISTING_AGGREGATE_GROSS_OVER_CAP");
                    this.log("v12-entry-fail-closed", {
                        reason: "V12_EXISTING_AGGREGATE_GROSS_OVER_CAP",
                        existingAggregateGross,
                        aggregateGrossCap: V12_AGGREGATE_GROSS_CAP,
                        ordersSent: false,
                    });
                    return { status: "capacity-blocked", reason: "V12_EXISTING_AGGREGATE_GROSS_OVER_CAP", signal: signals[0] };
                }
                const existingSymbols = new Set(activePositionsOf(state).map((row) => row.symbol.toUpperCase()));
                const next = signals.find((candidate) => !existingSymbols.has(`${candidate.symbol}USDT`));
                if (!next) return { status: "held", reason: "V12_POSITION_HELD", signal: signals[0] };
                const [freshAccount, freshPositions] = await Promise.all([this.d.adapter.getAccountSnapshot(), this.d.adapter.getPositions()]); const freshEquity = Math.max(0, finite(freshAccount.walletBalance));
                const freshActive = this.activePortfolio(freshPositions, freshEquity);
                const equity = freshEquity; if (!(equity > 0)) return this.fail(state, "V12_ACCOUNT_EQUITY_INVALID");
                const quote = await this.d.adapter.executor.getMarketQuote(`${next.symbol}USDT`); const sizing = sizeV12Position(equity, next.side === "LONG" ? quote.askPrice : quote.bidPrice, next.atr, next.side);
                const snapshot = { v12Gross: freshActive.filter((row) => row.sleeve === "V12").reduce((sum, row) => sum + row.gross, 0), penguGross: freshActive.filter((row) => row.sleeve === "PENGU_DUAL_LS_V2").reduce((sum, row) => sum + row.gross, 0), cryptoGross: freshActive.filter((row) => row.sleeve === "V12" || row.sleeve === "PENGU_DUAL_LS_V2").reduce((sum, row) => sum + row.gross, 0), stockGross: freshActive.filter((row) => row.sleeve === "V11_EQ" || row.sleeve === "V50_POST_OPEN_BASIS").reduce((sum, row) => sum + row.gross, 0), totalGross: freshActive.reduce((sum, row) => sum + row.gross, 0) };
                const decision = decideV12ResidualEntry(sizing.requestedGross, snapshot, activePositionsOf(state).length);
                if (!(decision.acceptedGross > 0)) return { status: "capacity-blocked", reason: `V12_RANK2_${decision.reason || "NO_RESIDUAL"}`, signal: next };
                await this.writeDecisionSnapshot(evaluation, next, decision.acceptedGross, decision.reason || "V12_ENTRY_DECISION");
                return this.executeEntryForSignal(state, handle, next, equity, sizing, decision.acceptedGross);
            }

            if (!risk.ok) return { status: "risk-blocked", reason: `SHARED_CRYPTO_RISK:${risk.reason}` };
            if (state.lastReferenceTs !== undefined && latestTs <= state.lastReferenceTs) return { status: "no-signal", reason: "NO_NEW_CONFIRMED_2H_BAR" };
            state.lastReferenceTs = latestTs;
            if (!signals.length) { await this.d.stateStore.save(state); return { status: "no-signal", reason: "NO_COMPLETED_BAR_SIGNAL" }; }
            if ((state.cooldownUntilTs || 0) > latestTs) { await this.d.stateStore.save(state); return { status: "held", reason: "V12_COOLDOWN_ACTIVE", signal: signals[0] }; }
            let latestPositions = positions;
            let lastResult: V12LiveTickResult = { status: "no-signal", reason: "NO_ENTRY" };
            for (const signal of signals.slice(0, V12_X1_ALL.maximumPositions)) {
                const [freshAccount, freshPositions] = await Promise.all([this.d.adapter.getAccountSnapshot(), this.d.adapter.getPositions()]);
                latestPositions = freshPositions;
                const entryEquity = Math.max(0, finite(freshAccount.walletBalance)); if (!(entryEquity > 0)) return this.fail(state, "V12_ACCOUNT_EQUITY_INVALID");
                const activePortfolio = this.activePortfolio(latestPositions, entryEquity);
                const quote = await this.d.adapter.executor.getMarketQuote(`${signal.symbol}USDT`);
                const entryPrice = signal.side === "LONG" ? quote.askPrice : quote.bidPrice;
                const sizing = sizeV12Position(entryEquity, entryPrice, signal.atr, signal.side);
                const snapshot = { v12Gross: activePortfolio.filter((row) => row.sleeve === "V12").reduce((sum, row) => sum + row.gross, 0), penguGross: activePortfolio.filter((row) => row.sleeve === "PENGU_DUAL_LS_V2").reduce((sum, row) => sum + row.gross, 0), cryptoGross: activePortfolio.filter((row) => row.sleeve === "V12" || row.sleeve === "PENGU_DUAL_LS_V2").reduce((sum, row) => sum + row.gross, 0), stockGross: activePortfolio.filter((row) => row.sleeve === "V11_EQ" || row.sleeve === "V50_POST_OPEN_BASIS").reduce((sum, row) => sum + row.gross, 0), totalGross: activePortfolio.reduce((sum, row) => sum + row.gross, 0) };
                const decision = decideV12ResidualEntry(sizing.requestedGross, snapshot, activePositionsOf(state).length);
                if (!(decision.acceptedGross > 0)) { lastResult = { status: "capacity-blocked", reason: `V12_RANK${activePositionsOf(state).length + 1}_${decision.reason || "NO_RESIDUAL"}`, signal }; break; }
                await this.writeDecisionSnapshot(evaluation, signal, decision.acceptedGross, decision.reason || "V12_ENTRY_DECISION");
                lastResult = await this.executeEntryForSignal(state, handle, signal, entryEquity, sizing, decision.acceptedGross);
                if (lastResult.status === "manual-review") return lastResult;
                if (lastResult.status !== "entered") break;
            }
            return lastResult;
        } catch (error) {
            if (isRecoverableAccountLockError(error)) {
                this.log("v12-account-lock-retry", { reason: "ACCOUNT_LOCK_LOST_DURING_TICK", ordersSent: false });
                return { status: "locked", reason: "ACCOUNT_LOCK_LOST_DURING_TICK" };
            }
            const state = await this.d.stateStore.load(); return this.fail(state, error instanceof Error ? error.message : String(error));
        } finally { await handle.release(); }
    }
}
