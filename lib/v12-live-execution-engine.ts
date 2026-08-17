import { randomUUID } from "node:crypto";

import { V12_X1_ALL } from "@/config/v12X1AllRuntime";
import { FileAccountOrderLock } from "@/lib/disdex-account-order-lock";
import { classifyAsterSymbol } from "@/lib/disdex-aster-portfolio-classifier";
import { readSharedCryptoDailyRisk } from "@/lib/disdex-shared-crypto-daily-risk";
import { planUnifiedPortfolio, type ActivePortfolioPosition } from "@/lib/disdex-unified-portfolio-routing";
import { V12AsterLiveAdapter, deterministicV12ClientOrderId } from "@/lib/v12-aster-live-adapter";
import { cancelV12Protection, installV12Protection, reconcileV12Protection, updateV12TrailingStop, type V12StopState } from "@/lib/v12-resident-stop-lifecycle";
import { buildV12Signal, protectiveLevels, sizeV12Position, type V12Bar, type V12Signal } from "@/lib/v12-x1-all";
import { FileV12X1AllRunnerStateStore, type V12ActivePositionState, type V12PendingOrderState, type V12X1AllRunnerState } from "@/lib/v12-x1-all-runner-state";
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
function initialProtection(input: { symbol: string; side: "LONG" | "SHORT"; quantity: number; entryPrice: number; atr: number; positionId: string }): V12StopState {
    const levels = protectiveLevels(input.entryPrice, input.atr, input.side);
    return { strategyId: "V12_X1.00_ALL", symbol: input.symbol, side: input.side, positionId: input.positionId, quantity: input.quantity, entryPrice: input.entryPrice, atrAtEntry: input.atr, initialStop: levels.initialStop, lastAckStop: levels.initialStop, takeProfit: levels.takeProfit, peakOrTrough: input.entryPrice };
}

export class V12LiveExecutionEngine {
    private readonly now: () => number;
    private readonly log: (message: string, payload?: Record<string, unknown>) => void;
    constructor(private readonly d: V12LiveExecutionDependencies) { this.now = d.now || Date.now; this.log = d.log || ((message, payload) => console.log(JSON.stringify({ message, ...(payload || {}) }))); }

    private async fail(state: V12X1AllRunnerState, reason: string): Promise<V12LiveTickResult> {
        await this.d.stateStore.tripKillSwitch(state, reason); this.log("v12-fail-closed", { reason }); return { status: "manual-review", reason };
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
        const allowed = new Set([state.pending?.clientOrderId, state.active?.protection.stopClientOrderId, state.active?.protection.takeProfitClientOrderId].filter((value): value is string => Boolean(value)));
        const unknown = open.filter((order) => activeOrderStatus(order.status) && !allowed.has(order.clientOrderId));
        if (unknown.length) throw new Error(`V12_UNKNOWN_ACTIVE_ORDER:${unknown.map((row) => row.clientOrderId).join(",")}`);
    }

    private async completedProtectionExit(state: V12X1AllRunnerState) {
        if (!state.active) return false;
        const ids = [state.active.protection.stopClientOrderId, state.active.protection.takeProfitClientOrderId].filter((value): value is string => Boolean(value));
        for (const clientOrderId of ids) {
            const order = await this.d.adapter.queryOrderSameId(state.active.symbol, clientOrderId);
            if (order?.status === "FILLED") return true;
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
        let active: V12ActivePositionState = state.active || { symbol: pending.symbol, side: pending.side, quantity, gross: pending.requestedGross || 0, positionId: pending.clientOrderId, entryPrice, atrAtEntry: pending.atrAtEntry, entrySignalTs: pending.signalTs, holdingBars: 0, peakPrice: entryPrice, troughPrice: entryPrice, protection };
        active = { ...active, quantity, entryPrice, protection: { ...active.protection, quantity, entryPrice } };
        state.active = active; await this.d.stateStore.save(state);
        const installed = await installV12Protection(this.d.adapter, active.protection);
        if (installed.manualReview) { state.active = undefined; state.pending = undefined; return this.fail(state, installed.manualReview); }
        state.active = { ...active, protection: installed }; state.pending = undefined; state.lastCompletedIdempotencyKey = pending.idempotencyKey; await this.d.stateStore.save(state);
        return { status: "entered", reason: result.status === "PARTIALLY_FILLED" ? "PARTIAL_FILL_PROTECTED_AND_RECONCILED" : "ENTRY_RECOVERED_AND_PROTECTED", clientOrderId: pending.clientOrderId };
    }

    private async reconcilePendingExit(state: V12X1AllRunnerState, pending: V12PendingOrderState, positions: DirectPosition[]) {
        const result = await this.d.adapter.reconcileOrder(pending.symbol, pending.clientOrderId);
        if (result.status === "UNKNOWN") return this.fail(state, `V12_PENDING_EXIT_UNKNOWN:${pending.clientOrderId}`);
        const actual = positions.find((row) => row.symbol.toUpperCase() === pending.symbol && Math.abs(row.quantity) > EPS);
        if (actual) return this.fail(state, `V12_PENDING_EXIT_POSITION_REMAINS:${result.status}`);
        if (state.active) await cancelV12Protection(this.d.adapter, state.active.protection);
        state.active = undefined; state.pending = undefined; state.lastCompletedIdempotencyKey = pending.idempotencyKey; state.cooldownUntilTs = pending.signalTs + V12_X1_ALL.cooldownBars * V12_X1_ALL.timeframeHours * 3_600_000; await this.d.stateStore.save(state);
        return { status: "exited" as const, reason: "EXIT_RECONCILED", clientOrderId: pending.clientOrderId };
    }

    private async restartReconcile(state: V12X1AllRunnerState, positions: DirectPosition[]) : Promise<V12LiveTickResult | undefined> {
        this.validatePortfolioPositions(positions);
        if (state.killSwitch?.active || state.manualReview) return { status: "manual-review", reason: state.killSwitch?.reason || state.manualReview || "V12_MANUAL_REVIEW" };
        if (state.pending) return state.pending.action === "ENTRY" ? this.reconcilePendingEntry(state, state.pending, positions) : this.reconcilePendingExit(state, state.pending, positions);
        const v12Actual = positions.filter((row) => V12_SYMBOLS.has(row.symbol.toUpperCase()) && Math.abs(row.quantity) > EPS);
        if (!state.active && v12Actual.length) return this.fail(state, `V12_POSITION_ONLY_MISMATCH:${v12Actual.map((row) => row.symbol).join(",")}`);
        if (state.active) {
            const actual = v12Actual.find((row) => row.symbol.toUpperCase() === state.active!.symbol.toUpperCase());
            if (!actual) {
                if (await this.completedProtectionExit(state)) {
                    await cancelV12Protection(this.d.adapter, state.active.protection); state.active = undefined; state.cooldownUntilTs = (state.lastReferenceTs || this.now()) + V12_X1_ALL.cooldownBars * V12_X1_ALL.timeframeHours * 3_600_000; await this.d.stateStore.save(state);
                } else return this.fail(state, "V12_STATE_ONLY_POSITION_MISMATCH");
            } else {
                if (v12Actual.length !== 1 || !positionMatches(state.active, actual)) return this.fail(state, "V12_POSITION_SIDE_OR_QTY_MISMATCH");
                const protection = await reconcileV12Protection(this.d.adapter, state.active.protection);
                if (protection.manualReview) return this.fail(state, protection.manualReview);
                state.active = { ...state.active, quantity: actualQuantity(actual), entryPrice: actual.entryPrice || state.active.entryPrice, protection }; await this.d.stateStore.save(state);
            }
        }
        await this.verifyNoUnexpectedV12Orders(state);
        return undefined;
    }

    private async executeExit(state: V12X1AllRunnerState, signalTs: number, reason: string): Promise<V12LiveTickResult> {
        const active = state.active!; const quote = await this.d.adapter.executor.getMarketQuote(active.symbol);
        const clientOrderId = deterministicV12ClientOrderId({ action: "EXIT", signalTs, symbol: active.symbol, side: active.side, version: reason });
        const pending: V12PendingOrderState = { idempotencyKey: clientOrderId, action: "EXIT", clientOrderId, symbol: active.symbol, side: active.side, quantity: active.quantity, signalTs, expectedPrice: active.side === "LONG" ? quote.bidPrice : quote.askPrice, reason, createdAt: this.now() };
        state.pending = pending; await this.d.stateStore.save(state);
        const result = await this.d.adapter.executeExit({ signalTs, symbol: active.symbol, positionSide: active.side, quantity: active.quantity, expectedPrice: pending.expectedPrice!, clientOrderId });
        if (result.status === "UNKNOWN") return this.fail(state, `V12_EXIT_UNKNOWN:${clientOrderId}`);
        const positions = await this.d.adapter.getPositions(); const remains = positions.some((row) => row.symbol.toUpperCase() === active.symbol && Math.abs(row.quantity) > EPS);
        if (remains) return this.fail(state, `V12_EXIT_NOT_FLAT:${result.status}`);
        await cancelV12Protection(this.d.adapter, active.protection); state.active = undefined; state.pending = undefined; state.lastCompletedIdempotencyKey = pending.idempotencyKey; state.cooldownUntilTs = signalTs + V12_X1_ALL.cooldownBars * V12_X1_ALL.timeframeHours * 3_600_000; await this.d.stateStore.save(state);
        return { status: "exited", reason, clientOrderId };
    }

    async tick(): Promise<V12LiveTickResult> {
        const handle = await this.d.lock.acquire(`V12_X1.00_ALL:${process.pid}:${randomUUID()}`); if (!handle) return { status: "locked", reason: "ACCOUNT_LOCK_BUSY_OR_STALE_REVIEW_REQUIRED" };
        try {
            let state = await this.d.stateStore.load();
            if (!(await this.d.adapter.credentialsReady())) return this.fail(state, "V12_ASTER_CREDENTIALS_NOT_READY");
            const risk = await readSharedCryptoDailyRisk(this.d.riskPath, this.now());
            const [account, positions] = await Promise.all([this.d.adapter.getAccountSnapshot(), this.d.adapter.getPositions()]);
            const recovery = await this.restartReconcile(state, positions); if (recovery) return recovery;
            state = await this.d.stateStore.load();
            const data = await this.d.marketData.load(); const index = latestIndex(data); const latestTs = data[V12_X1_ALL.universe[0]][index].endTs;

            if (state.active) {
                if (state.lastReferenceTs !== undefined && latestTs <= state.lastReferenceTs) return { status: "held", reason: "NO_NEW_CONFIRMED_2H_BAR" };
                const activeBars = data[state.active.symbol.replace(/USDT$/, "")]; if (!activeBars) return this.fail(state, "V12_ACTIVE_SYMBOL_MARKET_DATA_MISSING");
                const activeBar = activeBars[index];
                const protection = await updateV12TrailingStop(this.d.adapter, state.active.protection, activeBar.close);
                if (protection.manualReview) return this.fail(state, protection.manualReview);
                const holdingBars = state.active.holdingBars + 1; state.active = { ...state.active, holdingBars, peakPrice: Math.max(state.active.peakPrice, activeBar.high), troughPrice: Math.min(state.active.troughPrice, activeBar.low), protection };
                state.lastReferenceTs = latestTs; const next = buildV12Signal(data, index);
                const changed = Boolean(next && (`${next.symbol}USDT` !== state.active.symbol || next.side !== state.active.side));
                const reason = holdingBars >= V12_X1_ALL.maxHoldBars ? "max-hold" : holdingBars >= V12_X1_ALL.rebalanceBars && changed ? "signal-rotation" : undefined;
                await this.d.stateStore.save(state);
                if (reason) return this.executeExit(state, latestTs, reason);
                return { status: "held", reason: "V12_POSITION_HELD", signal: next || undefined };
            }

            if (!risk.ok) return { status: "risk-blocked", reason: `SHARED_CRYPTO_RISK:${risk.reason}` };
            if (state.lastReferenceTs !== undefined && latestTs <= state.lastReferenceTs) return { status: "no-signal", reason: "NO_NEW_CONFIRMED_2H_BAR" };
            const signal = buildV12Signal(data, index); state.lastReferenceTs = latestTs;
            if (!signal) { await this.d.stateStore.save(state); return { status: "no-signal", reason: "NO_COMPLETED_BAR_SIGNAL" }; }
            if ((state.cooldownUntilTs || 0) > latestTs) { await this.d.stateStore.save(state); return { status: "held", reason: "V12_COOLDOWN_ACTIVE", signal }; }
            const symbol = `${signal.symbol}USDT`; const quote = await this.d.adapter.executor.getMarketQuote(symbol); const expectedPrice = signal.side === "LONG" ? quote.askPrice : quote.bidPrice;
            const equity = Math.max(0, finite(account.walletBalance)); if (!(equity > 0)) return this.fail(state, "V12_ACCOUNT_EQUITY_INVALID");
            const sizing = sizeV12Position(equity, expectedPrice, signal.atr, signal.side);
            const plan = planUnifiedPortfolio([{ sleeve: "V12", symbol, side: signal.side, gross: sizing.requestedGross, notionalUsd: sizing.requestedNotional, signalTs: signal.referenceTs }], this.activePortfolio(positions, equity));
            const accepted = plan.accepted[0]; if (!accepted) { await this.d.stateStore.save(state); return { status: "capacity-blocked", reason: plan.rejected[0]?.reason || "CAPACITY_BLOCKED", signal }; }
            const scale = sizing.requestedGross > 0 ? accepted.gross / sizing.requestedGross : 0; const quantity = sizing.quantity * scale;
            if (!(quantity > 0)) { await this.d.stateStore.save(state); return { status: "capacity-blocked", reason: "ZERO_EXECUTABLE_QUANTITY", signal }; }
            const clientOrderId = deterministicV12ClientOrderId({ action: "ENTRY", signalTs: signal.referenceTs, symbol, side: signal.side });
            if (state.lastCompletedIdempotencyKey === clientOrderId) { await this.d.stateStore.save(state); return { status: "held", reason: "SAME_SIGNAL_ALREADY_COMPLETED", signal, clientOrderId }; }
            const reservation = await handle.reserve({ strategyId: "V12_X1.00_ALL", symbol, side: signal.side, gross: accepted.gross, notionalUsd: accepted.gross * equity });
            const pending: V12PendingOrderState = { idempotencyKey: clientOrderId, action: "ENTRY", clientOrderId, symbol, side: signal.side, quantity, signalTs: signal.referenceTs, expectedPrice, requestedGross: accepted.gross, atrAtEntry: signal.atr, reason: "signal-entry", createdAt: this.now() };
            state.pending = pending; await this.d.stateStore.save(state);
            const result = await this.d.adapter.executeEntry({ signalTs: signal.referenceTs, symbol, side: signal.side, quantity, expectedPrice, clientOrderId });
            await handle.releaseReservation(reservation.reservationId);
            if (result.status === "UNKNOWN") return this.fail(state, `V12_ENTRY_UNKNOWN:${clientOrderId}`);
            if (!resultHasExposure(result)) { state.pending = undefined; state.lastCompletedIdempotencyKey = clientOrderId; await this.d.stateStore.save(state); return { status: "held", reason: `ENTRY_${result.status}_NO_RETRY`, signal, clientOrderId }; }
            const refreshed = await this.d.adapter.getPositions(); const actual = refreshed.find((row) => row.symbol.toUpperCase() === symbol && Math.abs(row.quantity) > EPS);
            if (!actual || actualSide(actual) !== signal.side) return this.fail(state, "V12_ENTRY_FILL_POSITION_MISMATCH");
            const entryPrice = actual.entryPrice > 0 ? actual.entryPrice : result.averagePrice; const protectionState = initialProtection({ symbol, side: signal.side, quantity: actualQuantity(actual), entryPrice, atr: signal.atr, positionId: clientOrderId });
            const active: V12ActivePositionState = { symbol, side: signal.side, quantity: actualQuantity(actual), gross: accepted.gross, positionId: clientOrderId, entryPrice, atrAtEntry: signal.atr, entrySignalTs: signal.referenceTs, holdingBars: 0, peakPrice: entryPrice, troughPrice: entryPrice, protection: protectionState };
            state.active = active; await this.d.stateStore.save(state);
            const installed = await installV12Protection(this.d.adapter, protectionState);
            if (installed.manualReview) { state.active = undefined; state.pending = undefined; return this.fail(state, installed.manualReview); }
            state.active = { ...active, protection: installed }; state.pending = undefined; state.lastCompletedIdempotencyKey = clientOrderId; await this.d.stateStore.save(state);
            return { status: "entered", reason: result.status === "PARTIALLY_FILLED" ? "PARTIAL_FILL_PROTECTED" : "ENTRY_FILLED_AND_PROTECTED", signal, clientOrderId };
        } catch (error) {
            const state = await this.d.stateStore.load(); return this.fail(state, error instanceof Error ? error.message : String(error));
        } finally { await handle.release(); }
    }
}
