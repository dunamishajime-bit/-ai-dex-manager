import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

import type { AsterV3Client } from "./aster-v3-client";
import { AsterDirectTradeExecutor, type DirectAccountSnapshot, type DirectOpenOrder, type DirectPosition, type DirectTradeResult } from "./direct-trade-executor";
import { FileAccountOrderLock, type AccountLockHandle } from "./disdex-account-order-lock";
import { aggregatePendingExposure, readPendingExposureRegistry } from "./disdex-pending-exposure-registry";
import { readSharedCryptoDailyRisk } from "./disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "./disdex-shared-kill-switch";
import { classifyAsterSymbol } from "./disdex-aster-portfolio-classifier";
import { classifyAsterRateBudgetFailure } from "./disdex-aster-rate-budget-policy";
import { V12AsterLiveAdapter } from "./v12-aster-live-adapter";
import { IDLE_PRIORITY_SHORT_POLICY, IDLE_PRIORITY_SHORT_STRATEGY, type IdlePrioritySymbol } from "../config/idlePriorityShortPolicy";
import type { IdlePriorityShortRuntime } from "../config/idlePriorityShortRuntime";
import { buildIdleProtectionPlan, deterministicIdleClientOrderId, evaluateIdleLiveAdmission, type IdleBaselineAdmission } from "./idle-priority-short-live";
import { buildBaselineAdmissionEvidence } from "./idle-priority-short-baseline-admission";
import { assertIdleParityCertificate } from "./idle-priority-short-parity-cert";
import { computeIdlePriorityFeatures, evaluateIdleGenericCandidate, evaluateIdlePriorityShort, type IdleFeatures, type IdleSignal } from "./idle-priority-short-signal";
import { FileIdlePriorityShortStateStore, type IdleOwnedPosition, type IdlePending, type IdleState } from "./idle-priority-short-state";
import type { IdlePriorityMarketSnapshot } from "./idle-priority-short-market-data";
import { writeIdleDecisionDetails, IDLE_DECISION_DETAILS_SCHEMA } from "./idle-priority-decision-diagnostics";
import { evaluateIdleResidualLong } from "./idle-residual-long-signal";

const EPSILON = 1e-9;
const MAX_QUOTE_AGE_MS = 5 * 60_000;
const ACTIVE_ORDER_STATUSES = new Set(["NEW", "PARTIALLY_FILLED", "PENDING_NEW"]);
const CORE_SLEEVES = new Set(["V12", "PENGU_DUAL_LS_V2", "FET_RESIDUAL", "V11_EQ", "V50_POST_OPEN_BASIS", "QUALITY102_CAUSAL_V1"]);
const SIDEcar_SLEEVES = new Set(["HYPE_LONG", "ZEC_LONG"]);

export function classifyIdleFlatRateBudgetDeferral(state: IdleState, error: unknown) {
    const deferred = classifyAsterRateBudgetFailure(error);
    if (!deferred || state.manualReview || state.pending || state.positions.length > 0) return undefined;
    return `IDLE_RATE_BUDGET_DEFERRED:${deferred.reason}`;
}

export type IdlePriorityShortTickResult = {
    status: "disabled" | "locked" | "shadow" | "held" | "no-change" | "completed" | "manual-review";
    message: string;
    symbol?: string;
    ordersSent: number;
    cancelsSent: number;
    positionChangesSent: number;
};

export type IdlePriorityShortRunnerDependencies = {
    marketData: { load(): Promise<IdlePriorityMarketSnapshot> };
    executor: AsterDirectTradeExecutor;
    adapter: V12AsterLiveAdapter;
    client: AsterV3Client;
    stateStore: FileIdlePriorityShortStateStore;
    lock: FileAccountOrderLock;
    runtime: IdlePriorityShortRuntime;
    now?: () => number;
    logger?: { info(message: string, payload?: Record<string, unknown>): void; warn(message: string, payload?: Record<string, unknown>): void; error(message: string, payload?: Record<string, unknown>): void };
};

function defaultLogger() {
    return {
        info: (message: string, payload?: Record<string, unknown>) => console.log(JSON.stringify({ level: "info", message, ...(payload || {}) })),
        warn: (message: string, payload?: Record<string, unknown>) => console.warn(JSON.stringify({ level: "warn", message, ...(payload || {}) })),
        error: (message: string, payload?: Record<string, unknown>) => console.error(JSON.stringify({ level: "error", message, ...(payload || {}) })),
    };
}

function activeOrder(order: DirectOpenOrder) { return ACTIVE_ORDER_STATUSES.has(String(order.status || "").toUpperCase()); }
function activePosition(positions: readonly DirectPosition[], symbol: string) { return positions.find((position) => position.symbol.toUpperCase() === symbol.toUpperCase() && Math.abs(position.quantity) > EPSILON); }
function positionQuantity(position: DirectPosition) { return Math.abs(position.quantity); }
function shortPosition(position: DirectPosition) { return position.positionSide === "SHORT" || (position.positionSide === "BOTH" && position.quantity < 0); }
function hasExposure(result: DirectTradeResult) { return (result.status === "FILLED" || result.status === "PARTIALLY_FILLED") && result.executedQuantity > EPSILON; }
function hashId(parts: readonly unknown[], prefix: string) { return `${prefix}-${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 27)}`.slice(0, 36); }
function quoteFresh(quote: { updatedAt: number }, now: number) { return Number.isFinite(quote.updatedAt) && quote.updatedAt > 0 && quote.updatedAt <= now && now - quote.updatedAt <= MAX_QUOTE_AGE_MS; }
function sameQuantity(actual: number, expected: number) { return Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 0.01); }

function safeNumber(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0; }

function isOperatorActivationBlock(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.startsWith("OPERATOR_LIVE_ACTIVATION_REQUIRED")
        || message.startsWith("OPERATOR_GATE_")
        || message.startsWith("IDLE_PARITY_CERT_REQUIRED")
        || message === "OPERATOR_GATE_IMPLEMENTATION_NOT_READY";
}

async function readMarginHealthy(path: string, now: number, maxAgeMs: number) {
    const state = JSON.parse(await readFile(path, "utf8")) as { stage?: unknown; ordersAllowed?: unknown; checkedAt?: unknown; updatedAt?: unknown };
    const checkedAt = safeNumber(state.checkedAt ?? state.updatedAt);
    if (state.stage !== "HEALTHY" || state.ordersAllowed !== true || checkedAt <= 0 || checkedAt > now || now - checkedAt > maxAgeMs) return false;
    return true;
}

async function assertOperatorActivation(runtime: IdlePriorityShortRuntime) {
    if (runtime.mode !== "LIVE") return;
    const readiness = JSON.parse(await readFile(`${runtime.releaseRoot}/docs/production/current-implementation-readiness.json`, "utf8")) as { schema?: string; target?: string; implementationStatus?: string; blockers?: unknown[] };
    if (readiness.schema !== "disdex-current-implementation-readiness/v1" || readiness.implementationStatus !== "READY" || !readiness.target || (readiness.blockers || []).some((value) => value !== "OPERATOR_LIVE_ACTIVATION_REQUIRED")) {
        throw new Error("OPERATOR_GATE_IMPLEMENTATION_NOT_READY");
    }
    try {
        const certStats = await lstat(runtime.parityCertificatePath);
        if (!certStats.isFile() || certStats.isSymbolicLink()) throw new Error("IDLE_PARITY_CERT_NOT_REGULAR_FILE");
        if (typeof certStats.uid === "number" && (certStats.uid !== 0 || certStats.gid !== 0)) throw new Error("IDLE_PARITY_CERT_NOT_ROOT_OWNED");
        if ((certStats.mode & 0o022) !== 0) throw new Error("IDLE_PARITY_CERT_WRITABLE_BY_NON_ROOT");
        assertIdleParityCertificate(JSON.parse(await readFile(runtime.parityCertificatePath, "utf8")), runtime.runtimeSha);
    } catch (error) {
        throw new Error(`IDLE_PARITY_CERT_REQUIRED:${error instanceof Error ? error.message : String(error)}`);
    }
    const stats = await lstat(runtime.operatorActivationPath);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("OPERATOR_LIVE_ACTIVATION_REQUIRED:ARTIFACT_NOT_REGULAR_FILE");
    if (typeof stats.uid === "number" && (stats.uid !== 0 || stats.gid !== 0)) throw new Error("OPERATOR_LIVE_ACTIVATION_REQUIRED:ARTIFACT_NOT_ROOT_OWNED");
    if ((stats.mode & 0o022) !== 0) throw new Error("OPERATOR_LIVE_ACTIVATION_REQUIRED:ARTIFACT_WRITABLE_BY_NON_ROOT");
    const artifact = JSON.parse(await readFile(runtime.operatorActivationPath, "utf8")) as { schema?: string; approvedSha?: string; target?: string; ordersEnabled?: boolean; operatorAcknowledgement?: string; approvedRunners?: unknown[]; approvedAt?: string };
    if (artifact.schema !== "disdex-live-operator-activation/v1") throw new Error("OPERATOR_LIVE_ACTIVATION_REQUIRED:ARTIFACT_MISSING_OR_INVALID");
    if (String(artifact.approvedSha || "").toLowerCase() !== runtime.runtimeSha) throw new Error("OPERATOR_LIVE_ACTIVATION_REQUIRED:SHA_MISMATCH");
    if (artifact.target !== readiness.target) throw new Error("OPERATOR_LIVE_ACTIVATION_REQUIRED:TARGET_MISMATCH");
    if (artifact.ordersEnabled !== true || artifact.operatorAcknowledgement !== "I_ACK_REAL_MONEY_LIVE_ACTIVATION") throw new Error("OPERATOR_LIVE_ACTIVATION_REQUIRED:ACK_MISSING");
    if (!Array.isArray(artifact.approvedRunners) || !artifact.approvedRunners.includes(IDLE_PRIORITY_SHORT_STRATEGY)) throw new Error("OPERATOR_LIVE_ACTIVATION_REQUIRED:RUNNER_NOT_APPROVED:IDLE_PRIORITY_SHORT");
    const approvedAt = Date.parse(String(artifact.approvedAt || ""));
    if (!Number.isFinite(approvedAt) || approvedAt <= 0 || approvedAt > Date.now() + 300_000) throw new Error("OPERATOR_LIVE_ACTIVATION_REQUIRED:APPROVED_AT_INVALID");
}

export function coreAndSidecarExposure(positions: readonly DirectPosition[], equity: number, idleOwnedSymbols: ReadonlySet<string> = new Set()) {
    let baselineOpenPositions = 0;
    let nonBaselineCryptoExposure = 0;
    let totalGross = 0;
    let cryptoGross = 0;
    let stockGross = 0;
    for (const position of positions) {
        const classification = classifyAsterSymbol(position.symbol);
        if (!classification.tradable || classification.assetClass === "UNKNOWN") throw new Error(`IDLE_UNKNOWN_ACTIVE_POSITION:${position.symbol}`);
        const gross = equity > 0 ? Math.abs(position.notionalUsd) / equity : Number.POSITIVE_INFINITY;
        totalGross += gross;
        if (classification.assetClass === "CRYPTO") cryptoGross += gross;
        else if (classification.assetClass === "STOCK") stockGross += gross;

        const symbol = position.symbol.toUpperCase();
        if (idleOwnedSymbols.has(symbol)) continue;
        if (symbol === "HYPEUSDT" || symbol === "ZECUSDT" || SIDEcar_SLEEVES.has(classification.sleeve)) {
            nonBaselineCryptoExposure += gross;
            continue;
        }
        // Ownership is deliberately not inferred from symbol->sleeve classification.
        // Any non-Idle-owned, non-HYPE/ZEC live position is baseline/core exposure
        // for Idle-admission purposes, including Q102 positions in an Idle symbol.
        baselineOpenPositions += 1;
    }
    return { baselineOpenPositions, nonBaselineCryptoExposure, totalGross, cryptoGross, stockGross };
}

function pendingExposureByOwner(entries: Awaited<ReturnType<typeof readPendingExposureRegistry>>) {
    let baselinePendingExposure = 0;
    let nonBaselinePendingExposure = 0;
    for (const entry of entries.entries) {
        if (!["PENDING", "SUBMITTED", "UNKNOWN"].includes(entry.status)) continue;
        const owner = entry.strategyId.toUpperCase();
        if (owner.includes("HYPE") || owner.includes("ZEC")) nonBaselinePendingExposure += Number(entry.gross || 0);
        else baselinePendingExposure += Number(entry.gross || 0);
    }
    return { baselinePendingExposure, nonBaselinePendingExposure };
}

export class IdlePriorityShortRunner {
    private readonly now: () => number;
    private readonly log: NonNullable<IdlePriorityShortRunnerDependencies["logger"]>;

    constructor(private readonly dependencies: IdlePriorityShortRunnerDependencies) {
        this.now = dependencies.now || Date.now;
        this.log = dependencies.logger || defaultLogger();
    }

    private async manualReview(state: IdleState, reason: string): Promise<IdlePriorityShortTickResult> {
        state.manualReview = reason;
        state.failures = [...state.failures, { message: reason, occurredAt: this.now() }].slice(-100);
        await this.dependencies.stateStore.save(state);
        this.log.error("idle-priority-short-manual-review", { reason, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 });
        return { status: "manual-review", message: reason, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
    }

    private async verifyVenueFiveXCross(symbol: string) {
        const rows = await this.dependencies.client.getPositions(symbol);
        const matching = rows.filter((row) => row.symbol.toUpperCase() === symbol.toUpperCase());
        if (!matching.length) return false;
        for (const row of matching) {
            if (Math.abs(Number(row.positionAmt)) > 1e-12) return false;
            const margin = String(row.marginType || "").toLowerCase();
            const cross = margin === "cross" || margin === "crossed" || row.isolated === false;
            if (Number(row.leverage) !== 5 || !cross) return false;
        }
        return (await this.dependencies.client.getOpenOrders(symbol)).length === 0;
    }

    private candidateLifecycleAllows(state: IdleState, candidate: { symbol: IdlePrioritySymbol; features: Pick<IdleFeatures, "decisionTs"> }) {
        const last = Number(state.lastAcceptedBySymbol[candidate.symbol] || 0);
        const cooldownMs = IDLE_PRIORITY_SHORT_POLICY.cooldownHours * 3_600_000;
        return last <= 0 || candidate.features.decisionTs - last >= cooldownMs;
    }

    private markCandidateLifecycle(state: IdleState, candidate: { symbol: IdlePrioritySymbol; features: Pick<IdleFeatures, "decisionTs"> }) {
        state.lastAcceptedBySymbol = { ...state.lastAcceptedBySymbol, [candidate.symbol]: candidate.features.decisionTs };
    }

    private async protectionReadBack(symbol: string, plan: ReturnType<typeof buildIdleProtectionPlan>, expectedQty: number) {
        const orders = (await this.dependencies.adapter.openOrders(symbol)).filter((order) => activeOrder({ symbol, clientOrderId: order.clientOrderId, quantity: order.quantity, executedQuantity: 0, status: order.status, type: order.type, side: order.side, reduceOnly: order.reduceOnly }));
        const stop = orders.find((order) => order.clientOrderId === plan.stopClientOrderId);
        const takeProfit = orders.find((order) => order.clientOrderId === plan.takeProfitClientOrderId);
        if (!stop || !takeProfit || stop.reduceOnly !== true || takeProfit.reduceOnly !== true || !sameQuantity(stop.quantity, expectedQty) || !sameQuantity(takeProfit.quantity, expectedQty)) throw new Error("IDLE_PROTECTION_READBACK_FAILED");
        if (String(stop.type).toUpperCase() !== "STOP_MARKET" || String(takeProfit.type).toUpperCase() !== "TAKE_PROFIT_MARKET") throw new Error("IDLE_PROTECTION_TYPE_READBACK_FAILED");
        if (String(stop.side).toUpperCase() !== "BUY" || String(takeProfit.side).toUpperCase() !== "BUY") throw new Error("IDLE_PROTECTION_SIDE_READBACK_FAILED");
        const sameTrigger = (actual: number | undefined, expected: number) => Number.isFinite(Number(actual)) && Math.abs(Number(actual) - expected) <= Math.max(1e-12, Math.abs(expected) * 1e-6);
        if (!sameTrigger(stop.stopPrice, plan.stopPrice) || !sameTrigger(takeProfit.stopPrice, plan.takeProfitPrice)) throw new Error("IDLE_PROTECTION_TRIGGER_READBACK_FAILED");
        return true;
    }

    private async reconcileVenueProtectiveFills(state: IdleState, positions: DirectPosition[], openOrders: DirectOpenOrder[]) {
        let changed = false;
        for (const owned of [...state.positions]) {
            if (activePosition(positions, owned.symbol)) continue;
            const [stop, takeProfit] = await Promise.all([
                this.dependencies.executor.reconcileOrder(owned.symbol, owned.stopClientOrderId),
                this.dependencies.executor.reconcileOrder(owned.symbol, owned.takeProfitClientOrderId),
            ]);
            const stopFilled = stop.status === "FILLED" && stop.executedQuantity > EPSILON;
            const takeProfitFilled = takeProfit.status === "FILLED" && takeProfit.executedQuantity > EPSILON;
            if (!stopFilled && !takeProfitFilled) continue;

            const siblingId = stopFilled ? owned.takeProfitClientOrderId : owned.stopClientOrderId;
            if (openOrders.some((order) => order.clientOrderId === siblingId && activeOrder(order))) {
                await this.dependencies.adapter.cancel(siblingId).catch(() => undefined);
            }
            state.positions = state.positions.filter((row) => row.symbol !== owned.symbol);
            state.lastDecision = {
                decisionTs: this.now(),
                symbol: owned.symbol,
                route: owned.route,
                accepted: true,
                reason: `EXIT:${stopFilled ? "HARD_STOP" : "TAKE_PROFIT"}_VENUE_RECONCILED`,
            };
            changed = true;
        }
        if (changed) await this.dependencies.stateStore.save(state);
        return changed;
    }

    private async reconcileOwnership(state: IdleState, positions: DirectPosition[], openOrders: DirectOpenOrder[]) {
        const owned = new Map(state.positions.map((position) => [position.symbol, position]));
        for (const position of positions.filter((row) => Math.abs(row.quantity) > EPSILON && Object.prototype.hasOwnProperty.call(IDLE_PRIORITY_SHORT_POLICY.routes, row.symbol.toUpperCase()))) {
            const statePosition = owned.get(position.symbol.toUpperCase() as IdlePrioritySymbol);
            if (!statePosition || !shortPosition(position) || !sameQuantity(positionQuantity(position), statePosition.quantity)) return `IDLE_STATE_POSITION_MISMATCH:${position.symbol}`;
        }
        for (const statePosition of state.positions) {
            const actual = activePosition(positions, statePosition.symbol);
            if (!actual || !shortPosition(actual) || !sameQuantity(positionQuantity(actual), statePosition.quantity)) return `IDLE_STATE_EXPECTS_MISSING_POSITION:${statePosition.symbol}`;
            const protections = openOrders.filter((order) => order.symbol.toUpperCase() === statePosition.symbol && (order.clientOrderId === statePosition.stopClientOrderId || order.clientOrderId === statePosition.takeProfitClientOrderId));
            if (protections.length !== 2 || protections.some((order) => order.reduceOnly !== true || !activeOrder(order))) return `IDLE_PROTECTION_NOT_VERIFIED:${statePosition.symbol}`;
        }
        const expectedOrderIds = new Set(state.positions.flatMap((position) => [position.stopClientOrderId, position.takeProfitClientOrderId]));
        for (const order of openOrders.filter((row) => Object.prototype.hasOwnProperty.call(IDLE_PRIORITY_SHORT_POLICY.routes, row.symbol.toUpperCase()) && activeOrder(row))) {
            if (!expectedOrderIds.has(order.clientOrderId)) return `IDLE_UNMANAGED_OPEN_ORDER:${order.symbol}:${order.clientOrderId}`;
        }
    }

    private async installProtection(state: IdleState, pending: IdlePending, actual: DirectPosition): Promise<IdleOwnedPosition> {
        const symbol = pending.symbol;
        const plan = buildIdleProtectionPlan({ symbol, signalTs: pending.signalTs, entryPrice: actual.entryPrice, quantity: positionQuantity(actual) });
        const stop = await this.dependencies.adapter.normalizeStopPrice(symbol, plan.stopPrice);
        const takeProfit = await this.dependencies.adapter.normalizeStopPrice(symbol, plan.takeProfitPrice);
        try {
            await this.dependencies.adapter.placeStopMarket({ symbol, side: "BUY", quantity: plan.quantity, stopPrice: stop.price, clientOrderId: plan.stopClientOrderId, reduceOnly: true });
            await this.dependencies.adapter.placeTakeProfit({ symbol, side: "BUY", quantity: plan.quantity, stopPrice: takeProfit.price, clientOrderId: plan.takeProfitClientOrderId, reduceOnly: true });
            await this.protectionReadBack(symbol, { ...plan, stopPrice: stop.price, takeProfitPrice: takeProfit.price }, plan.quantity);
        } catch (error) {
            throw new Error(`IDLE_PROTECTION_INSTALL_FAILED:${error instanceof Error ? error.message : String(error)}`);
        }
        return {
            symbol,
            route: pending.route,
            side: "SHORT",
            signalTs: pending.signalTs,
            entryTs: this.now(),
            exitTs: this.now() + pending.holdHours * 3_600_000,
            entryPrice: actual.entryPrice,
            quantity: positionQuantity(actual),
            holdHours: pending.holdHours,
            gross: 1,
            stopPrice: stop.price,
            takeProfitPrice: takeProfit.price,
            stopClientOrderId: plan.stopClientOrderId,
            takeProfitClientOrderId: plan.takeProfitClientOrderId,
            protectionVerified: true,
        };
    }

    private async safetyCloseUnprotectedEntry(state: IdleState, pending: IdlePending, actual: DirectPosition, lock: AccountLockHandle, protectionError: string): Promise<IdlePriorityShortTickResult> {
        const quote = await this.dependencies.executor.getMarketQuote(pending.symbol);
        if (!quoteFresh(quote, this.now())) return this.manualReview(state, `IDLE_UNPROTECTED_ENTRY_QUOTE_STALE:${pending.symbol}:${protectionError}`);
        const clientOrderId = hashId([pending.clientOrderId, "UNPROTECTED_SAFETY_CLOSE"], "idle-safe");
        try {
            const result = await this.dependencies.executor.executeMarket({
                requestId: clientOrderId,
                clientOrderId,
                symbol: pending.symbol,
                side: "BUY",
                positionSide: "BOTH",
                quantity: positionQuantity(actual),
                reduceOnly: true,
                expectedPrice: quote.askPrice,
                maxSlippageBps: this.dependencies.runtime.maximumSlippageBps,
                reason: "IDLE_PRIORITY_SHORT_UNPROTECTED_SAFETY_CLOSE",
            });
            if (result.status === "UNKNOWN" || result.executionUnknown || activePosition(await this.dependencies.executor.getPositions(), pending.symbol)) {
                return this.manualReview(state, `IDLE_UNPROTECTED_SAFETY_CLOSE_UNCONFIRMED:${pending.symbol}:${protectionError}`);
            }
            const plan = buildIdleProtectionPlan({ symbol: pending.symbol, signalTs: pending.signalTs, entryPrice: actual.entryPrice, quantity: positionQuantity(actual) });
            await this.dependencies.adapter.cancel(plan.stopClientOrderId).catch(() => undefined);
            await this.dependencies.adapter.cancel(plan.takeProfitClientOrderId).catch(() => undefined);
            state.pending = null;
            state.positions = state.positions.filter((row) => row.symbol !== pending.symbol);
            state.lastDecision = { decisionTs: this.now(), symbol: pending.symbol, route: pending.route, accepted: false, reason: "IDLE_UNPROTECTED_ENTRY_SAFETY_CLOSED" };
            state.manualReview = `IDLE_PROTECTION_INSTALL_FAILED_SAFETY_CLOSED:${protectionError}`;
            state.failures = [...state.failures, { message: state.manualReview, occurredAt: this.now() }].slice(-100);
            await this.dependencies.stateStore.save(state);
            if (pending.reservationId) await lock.releaseReservation(pending.reservationId);
            await lock.document();
            return { status: "manual-review", message: state.manualReview, symbol: pending.symbol, ordersSent: 1, cancelsSent: 2, positionChangesSent: 1 };
        } catch (error) {
            return this.manualReview(state, `IDLE_UNPROTECTED_SAFETY_CLOSE_FAILED:${pending.symbol}:${error instanceof Error ? error.message : String(error)}:${protectionError}`);
        }
    }

    private async finalizeEntry(state: IdleState, pending: IdlePending, result: DirectTradeResult, lock: AccountLockHandle): Promise<IdlePriorityShortTickResult> {
        if (!hasExposure(result)) {
            state.pending = null;
            await this.dependencies.stateStore.save(state);
            if (pending.reservationId) await lock.releaseReservation(pending.reservationId);
            return { status: "held", message: `IDLE_ENTRY_${result.status}_NO_EXPOSURE`, symbol: pending.symbol, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
        }
        const positions = await this.dependencies.executor.getPositions();
        const actual = activePosition(positions, pending.symbol);
        if (!actual || !shortPosition(actual)) return this.manualReview(state, `IDLE_ENTRY_POSITION_MISMATCH:${pending.symbol}`);
        let position: IdleOwnedPosition;
        try { position = await this.installProtection(state, pending, actual); }
        catch (error) {
            return this.safetyCloseUnprotectedEntry(state, pending, actual, lock, error instanceof Error ? error.message : String(error));
        }
        state.positions = [...state.positions.filter((row) => row.symbol !== position.symbol), position];
        state.pending = null;
        state.lastDecision = { decisionTs: pending.decisionTs, symbol: position.symbol, route: position.route, accepted: true, reason: result.status === "PARTIALLY_FILLED" ? "IDLE_ENTRY_PARTIAL_FILLED_PROTECTED_MANUAL_REVIEW" : "IDLE_ENTRY_FILLED" };
        if (result.status === "PARTIALLY_FILLED") state.manualReview = "IDLE_PARTIAL_FILL_REQUIRES_OPERATOR_REVIEW";
        await this.dependencies.stateStore.save(state);
        if (pending.reservationId) await lock.releaseReservation(pending.reservationId);
        await lock.document();
        if (state.manualReview) return { status: "manual-review", message: state.manualReview, symbol: position.symbol, ordersSent: 1, cancelsSent: 0, positionChangesSent: 0 };
        return { status: "completed", message: `IDLE_ENTRY_COMPLETED:${position.symbol}`, symbol: position.symbol, ordersSent: 1, cancelsSent: 0, positionChangesSent: 1 };
    }

    private async reconcilePending(state: IdleState, lock: AccountLockHandle): Promise<IdlePriorityShortTickResult | undefined> {
        const pending = state.pending;
        if (!pending) return undefined;
        if (pending.action === "ENTRY" && !pending.reservationId) return this.manualReview(state, "IDLE_PENDING_RESERVATION_MISSING");
        const result = await this.dependencies.executor.reconcileOrder(pending.symbol, pending.clientOrderId);
        if (result.status === "UNKNOWN" || result.executionUnknown) return this.manualReview(state, `IDLE_PENDING_EXECUTION_UNKNOWN:${pending.clientOrderId}`);
        if (pending.action === "ENTRY") return this.finalizeEntry(state, pending, result, lock);
        const positions = await this.dependencies.executor.getPositions();
        if (activePosition(positions, pending.symbol)) return this.manualReview(state, `IDLE_EXIT_POSITION_REMAINS:${pending.symbol}`);
        const owned = state.positions.find((row) => row.symbol === pending.symbol);
        if (owned) {
            await this.dependencies.adapter.cancel(owned.stopClientOrderId);
            await this.dependencies.adapter.cancel(owned.takeProfitClientOrderId);
        }
        state.positions = state.positions.filter((row) => row.symbol !== pending.symbol);
        state.pending = null;
        await this.dependencies.stateStore.save(state);
        if (pending.reservationId) await lock.releaseReservation(pending.reservationId);
        return { status: "completed", message: `IDLE_EXIT_RECONCILED:${pending.symbol}`, symbol: pending.symbol, ordersSent: 0, cancelsSent: 2, positionChangesSent: 1 };
    }

    private async exitPosition(state: IdleState, owned: IdleOwnedPosition, actual: DirectPosition, lock: AccountLockHandle, reason: string): Promise<IdlePriorityShortTickResult> {
        const quote = await this.dependencies.executor.getMarketQuote(owned.symbol);
        if (!quoteFresh(quote, this.now())) return { status: "held", message: `IDLE_EXIT_QUOTE_STALE:${owned.symbol}`, symbol: owned.symbol, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
        const clientOrderId = deterministicIdleClientOrderId({ action: "EXIT", symbol: owned.symbol, signalTs: owned.signalTs });
        const pending: IdlePending = { action: "EXIT", phase: "planned", symbol: owned.symbol, route: owned.route, clientOrderId, idempotencyKey: clientOrderId, quantity: positionQuantity(actual), expectedPrice: quote.askPrice, signalTs: owned.signalTs, decisionTs: this.now(), holdHours: owned.holdHours, createdAt: this.now(), updatedAt: this.now(), reason };
        state.pending = pending;
        await this.dependencies.stateStore.save(state);
        let result: DirectTradeResult;
        try {
            state.pending.phase = "submitted";
            await this.dependencies.stateStore.save(state);
            result = await this.dependencies.executor.executeMarket({ requestId: clientOrderId, clientOrderId, symbol: owned.symbol, side: "BUY", positionSide: "BOTH", quantity: positionQuantity(actual), reduceOnly: true, expectedPrice: quote.askPrice, maxSlippageBps: this.dependencies.runtime.maximumSlippageBps, reason: `IDLE_PRIORITY_SHORT_EXIT:${reason}` });
        } catch (error) { return this.manualReview(state, `IDLE_EXIT_ERROR:${error instanceof Error ? error.message : String(error)}`); }
        if (result.status === "UNKNOWN" || result.executionUnknown) return this.manualReview(state, `IDLE_EXIT_UNKNOWN:${clientOrderId}`);
        if (activePosition(await this.dependencies.executor.getPositions(), owned.symbol)) return this.manualReview(state, `IDLE_EXIT_POSITION_REMAINS:${owned.symbol}`);
        await this.dependencies.adapter.cancel(owned.stopClientOrderId);
        await this.dependencies.adapter.cancel(owned.takeProfitClientOrderId);
        state.positions = state.positions.filter((row) => row.symbol !== owned.symbol);
        state.pending = null;
        state.lastDecision = { decisionTs: this.now(), symbol: owned.symbol, route: owned.route, accepted: true, reason: `EXIT:${reason}` };
        await this.dependencies.stateStore.save(state);
        await lock.document();
        return { status: "completed", message: `IDLE_EXIT_COMPLETED:${owned.symbol}`, symbol: owned.symbol, ordersSent: 1, cancelsSent: 2, positionChangesSent: 1 };
    }

    private async enter(state: IdleState, signal: IdleSignal, account: DirectAccountSnapshot, positions: DirectPosition[], lock: AccountLockHandle, pendingAggregate: ReturnType<typeof aggregatePendingExposure>): Promise<IdlePriorityShortTickResult> {
        const symbol = signal.symbol;
        const quote = await this.dependencies.executor.getMarketQuote(symbol);
        if (!quoteFresh(quote, this.now())) return { status: "held", message: `IDLE_ENTRY_QUOTE_STALE:${symbol}`, symbol, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
        const equity = account.walletBalance + positions.reduce((sum, position) => sum + Number(position.unrealizedPnl || 0), 0);
        if (!(equity > 0)) return { status: "held", message: "IDLE_EQUITY_INVALID", symbol, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
        const exposure = coreAndSidecarExposure(positions, equity, new Set(state.positions.map((row) => row.symbol)));
        const ownerPending = pendingExposureByOwner(await readPendingExposureRegistry(this.dependencies.runtime.pendingExposurePath));
        if (exposure.baselineOpenPositions > EPSILON || ownerPending.baselinePendingExposure > EPSILON) {
            state.lastDecision = { decisionTs: signal.features.decisionTs, symbol, route: signal.route, accepted: false, reason: "BASELINE_OPEN_OR_PENDING" };
            await this.dependencies.stateStore.save(state);
            return { status: "no-change", message: "IDLE_BASELINE_NOT_IDLE", symbol, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
        }
        let baseline: IdleBaselineAdmission;
        try {
            baseline = await buildBaselineAdmissionEvidence({
                runtimeSha: this.dependencies.runtime.runtimeSha,
                decisionTs: signal.features.decisionTs,
                now: this.now(),
                baselineOpenPositions: exposure.baselineOpenPositions,
                baselinePendingExposure: ownerPending.baselinePendingExposure,
                decisionPath: this.dependencies.runtime.decisionPath,
                v12Path: this.dependencies.runtime.v12DecisionPath,
                q102Path: this.dependencies.runtime.q102DecisionPath,
                penguPath: this.dependencies.runtime.penguStatePath,
                fetPath: this.dependencies.runtime.fetStatePath,
                v52Path: this.dependencies.runtime.v52StatePath,
            });
        } catch (error) {
            const reason = `BASELINE_ADMISSION_BLOCKED:${error instanceof Error ? error.message : String(error)}`;
            state.lastDecision = { decisionTs: signal.features.decisionTs, symbol, route: signal.route, accepted: false, reason };
            await this.dependencies.stateStore.save(state);
            return { status: "held", message: `IDLE_${reason}`, symbol, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
        }
        let venueFiveXCrossConfirmed = true;
        if (this.dependencies.runtime.mode === "LIVE") {
            try {
                await this.dependencies.executor.prepareVenueMargin5xCross(symbol);
                venueFiveXCrossConfirmed = await this.verifyVenueFiveXCross(symbol);
            } catch (error) {
                return { status: "held", message: `IDLE_VENUE_MARGIN_PREPARATION_BLOCKED:${error instanceof Error ? error.message : String(error)}`, symbol, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
            }
            if (!venueFiveXCrossConfirmed) return { status: "held", message: "IDLE_VENUE_5X_CROSS_READBACK_FAILED", symbol, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
        }
        const fullCryptoGrossAvailable = INTEGRATED_CRYPTO_CAP - exposure.cryptoGross - pendingAggregate.cryptoGross;
        const fullTotalGrossAvailable = INTEGRATED_TOTAL_CAP - exposure.totalGross - pendingAggregate.cryptoGross - pendingAggregate.stockGross;
        const kill = await readSharedKillSwitch(process.env);
        const risk = await readSharedCryptoDailyRisk(this.dependencies.runtime.riskPath, this.now());
        let marginHealthy = false;
        try { marginHealthy = await readMarginHealthy(this.dependencies.runtime.marginPath, this.now(), this.dependencies.runtime.marginMaxAgeMs); } catch { marginHealthy = false; }
        const baseInput = {
            runtimeMode: this.dependencies.runtime.mode,
            operatorArmed: true,
            candidateAccepted: signal.accepted,
            candidateSide: signal.side,
            decisionTs: signal.features.decisionTs,
            baselineDecisionTs: baseline.decisionTs,
            baselineFresh: true,
            baselineSourceComplete: baseline.sourceComplete,
            // The historical shadow baseline is only one source of evidence;
            // current live ownership/pending state is an additional hard gate.
            // Never let a stale or incomplete shadow snapshot hide a real
            // baseline position or reservation that exists now.
            baselineOpenPositions: Math.max(baseline.baselineOpenPositions, exposure.baselineOpenPositions),
            baselinePendingExposure: Math.max(baseline.baselinePendingExposure, ownerPending.baselinePendingExposure),
            baselineAcceptedThisTimestamp: baseline.baselineAcceptedThisTimestamp,
            nonBaselineCryptoExposure: exposure.nonBaselineCryptoExposure,
            nonBaselinePendingExposure: ownerPending.nonBaselinePendingExposure,
            sharedRiskHealthy: risk.ok,
            marginGuardHealthy: marginHealthy,
            killSwitchActive: kill.active,
            venueFiveXCrossConfirmed,
            fullCryptoGrossAvailable,
            fullTotalGrossAvailable,
            sameSymbolIdleActive: Boolean(state.positions.find((position) => position.symbol === symbol)),
        } as const;
        const admission = evaluateIdleLiveAdmission(baseInput);
        state.lastDecision = { decisionTs: signal.features.decisionTs, symbol, route: signal.route, accepted: admission.accepted, reason: admission.reason };
        await this.dependencies.stateStore.save(state);
        if (!admission.accepted) return { status: "held", message: `IDLE_ENTRY_BLOCKED:${admission.reason}`, symbol, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
        if (this.dependencies.runtime.mode !== "LIVE") return { status: "shadow", message: `IDLE_SHADOW_ENTRY:${symbol}`, symbol, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
        await assertOperatorActivation(this.dependencies.runtime);
        await this.dependencies.executor.getAccountSnapshot();
        const normalized = await this.dependencies.executor.normalizeMarketQuantity(symbol, equity / quote.bidPrice, quote.bidPrice);
        if (normalized.notional / equity < 1 - 1e-6) return { status: "held", message: `IDLE_FULL_1X_NOT_REALIZABLE_AFTER_ROUNDING:${symbol}`, symbol, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
        const clientOrderId = deterministicIdleClientOrderId({ action: "ENTRY", symbol, signalTs: signal.features.signalTs });
        const reservation = await lock.reserve({ strategyId: IDLE_PRIORITY_SHORT_STRATEGY, symbol, side: "SHORT", gross: 1, notionalUsd: equity });
        const pending: IdlePending = { action: "ENTRY", phase: "planned", symbol, route: signal.route, clientOrderId, idempotencyKey: clientOrderId, reservationId: reservation.reservationId, quantity: normalized.quantity, expectedPrice: quote.bidPrice, signalTs: signal.features.signalTs, decisionTs: signal.features.decisionTs, holdHours: signal.holdHours as 12 | 24, createdAt: this.now(), updatedAt: this.now(), reason: signal.reason };
        state.pending = pending;
        await this.dependencies.stateStore.save(state);
        try {
            state.pending.phase = "submitted";
            await this.dependencies.stateStore.save(state);
            const result = await this.dependencies.executor.executeMarket({ requestId: clientOrderId, clientOrderId, symbol, side: "SELL", positionSide: "BOTH", quantity: normalized.quantity, expectedPrice: quote.bidPrice, maxSlippageBps: this.dependencies.runtime.maximumSlippageBps, reason: `IDLE_PRIORITY_SHORT_ENTRY:${signal.route}`, requireVenueMargin5xCross: true });
            return await this.finalizeEntry(state, pending, result, lock);
        } catch (error) {
            return this.manualReview(state, `IDLE_ENTRY_ERROR:${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async tick(): Promise<IdlePriorityShortTickResult> {
        if (!this.dependencies.runtime.enabled) return { status: "disabled", message: "IDLE_PRIORITY_SHORT_DISABLED", ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
        const lock = await this.dependencies.lock.acquire(`${IDLE_PRIORITY_SHORT_STRATEGY}:${process.pid}:${Date.now()}`);
        if (!lock) return { status: "locked", message: "IDLE_PRIORITY_SHORT_ACCOUNT_LOCK_BUSY", ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
        try {
            await assertOperatorActivation(this.dependencies.runtime);
            const state = await this.dependencies.stateStore.load();
            if (state.manualReview) return { status: "manual-review", message: state.manualReview, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
            const recovered = await this.reconcilePending(state, lock);
            if (recovered) return recovered;
            const [account, positions, openOrders, market] = await Promise.all([
                this.dependencies.executor.getAccountSnapshot(),
                this.dependencies.executor.getPositions(),
                this.dependencies.executor.getOpenOrders(),
                this.dependencies.marketData.load(),
            ]);
            const diagnosticSymbols = (Object.keys(market.symbols) as IdlePrioritySymbol[]).map((symbol) => {
                const features = computeIdlePriorityFeatures(market.decisionTs, market.symbols[symbol], market.btc);
                const generic = evaluateIdleGenericCandidate(features);
                const routeDecision = evaluateIdlePriorityShort(symbol, features, generic);
                const lastLifecycleTs = Number(state.lastAcceptedBySymbol[symbol] || 0) || null;
                const cooldownAllowed = lastLifecycleTs == null || market.decisionTs - lastLifecycleTs >= IDLE_PRIORITY_SHORT_POLICY.cooldownHours * 3_600_000;
                return {
                    symbol,
                    route: IDLE_PRIORITY_SHORT_POLICY.routes[symbol].route,
                    features,
                    generic: { accepted: generic.accepted, archetype: generic.archetype, side: generic.side, reason: generic.reason },
                    routeDecision: { accepted: routeDecision.accepted, side: routeDecision.side, reason: routeDecision.reason, holdHours: routeDecision.holdHours },
                    cooldownAllowed,
                    lastLifecycleTs,
                };
            });
            const diagnosticResidual = (Object.keys(market.residualSymbols) as Array<keyof typeof market.residualSymbols>).map((symbol) => {
                const decision = evaluateIdleResidualLong(symbol, market.decisionTs, market.residualSymbols[symbol], market.btc);
                return {
                    symbol,
                    route: decision.route,
                    features: decision.features,
                    decision: { accepted: decision.accepted, side: decision.side, reason: decision.reason, holdHours: decision.holdHours, priority: decision.priority },
                };
            });
            await writeIdleDecisionDetails(this.dependencies.runtime.decisionDetailsPath, {
                schema: IDLE_DECISION_DETAILS_SCHEMA,
                runtimeSha: this.dependencies.runtime.runtimeSha,
                decisionTs: market.decisionTs,
                updatedAt: this.now(),
                symbols: diagnosticSymbols,
                residual: diagnosticResidual,
                finalReason: state.lastDecision?.reason,
            });
            const protectionReconciled = await this.reconcileVenueProtectiveFills(state, positions, openOrders);
            const ownershipOrders = protectionReconciled ? await this.dependencies.executor.getOpenOrders() : openOrders;
            const ownershipIssue = await this.reconcileOwnership(state, positions, ownershipOrders);
            if (ownershipIssue) return this.manualReview(state, ownershipIssue);
            const pendingRegistry = await readPendingExposureRegistry(this.dependencies.runtime.pendingExposurePath);
            let pendingAggregate = aggregatePendingExposure(pendingRegistry);
            for (const owned of state.positions) {
                const actual = activePosition(positions, owned.symbol);
                if (!actual) return this.manualReview(state, `IDLE_POSITION_MISSING:${owned.symbol}`);
                const quote = await this.dependencies.executor.getMarketQuote(owned.symbol);
                if (!quoteFresh(quote, this.now())) return { status: "held", message: `IDLE_HELD_QUOTE_STALE:${owned.symbol}`, symbol: owned.symbol, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
                const exitReason = quote.askPrice >= owned.stopPrice ? "HARD_STOP" : quote.bidPrice <= owned.takeProfitPrice ? "TAKE_PROFIT" : this.now() >= owned.exitTs ? "FIXED_HOLD_EXIT" : undefined;
                if (exitReason && this.dependencies.runtime.mode === "LIVE") return await this.exitPosition(state, owned, actual, lock, exitReason);
                if (exitReason) return { status: "shadow", message: `IDLE_SHADOW_EXIT:${owned.symbol}:${exitReason}`, symbol: owned.symbol, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
            }
            // Historical parity order:
            // 1) build the generic LONG/SHORT candidate stream,
            // 2) apply the per-symbol 12h lifecycle while the baseline is fully Idle,
            // 3) only then apply the five-symbol SHORT route filter.
            // A generic LONG or route-unselected candidate still advances the
            // lifecycle because that is how the source 495-row stream was built.
            const rawGeneric = (Object.keys(market.symbols) as IdlePrioritySymbol[])
                .map((symbol) => {
                    const features = computeIdlePriorityFeatures(market.decisionTs, market.symbols[symbol], market.btc);
                    return { symbol, features, generic: evaluateIdleGenericCandidate(features) };
                })
                .filter((row) => row.generic.accepted);
            const lifecycleCandidates = rawGeneric.filter((row) => this.candidateLifecycleAllows(state, row));
            if (!lifecycleCandidates.length) {
                await this.dependencies.stateStore.save({
                    ...state,
                    lastDecision: {
                        decisionTs: market.decisionTs,
                        accepted: false,
                        reason: rawGeneric.length ? "IDLE_PER_SYMBOL_COOLDOWN_ACTIVE" : "NO_GENERIC_IDLE_CANDIDATE",
                    },
                });
                return {
                    status: "no-change",
                    message: rawGeneric.length ? "IDLE_PER_SYMBOL_COOLDOWN_ACTIVE" : "IDLE_NO_GENERIC_CANDIDATE",
                    ordersSent: 0,
                    cancelsSent: 0,
                    positionChangesSent: 0,
                };
            }

            // Candidate lifecycle is baseline-Idle-only.  Do not consume a
            // lifecycle slot when the five core strategies are still active,
            // pending, accepted at this timestamp, or have not completed the
            // current decision cycle.
            const lifecycleEquity = account.walletBalance + positions.reduce((sum, position) => sum + Number(position.unrealizedPnl || 0), 0);
            if (!(lifecycleEquity > 0)) {
                return { status: "held", message: "IDLE_GENERIC_EQUITY_INVALID", ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
            }
            const lifecycleExposure = coreAndSidecarExposure(positions, lifecycleEquity, new Set(state.positions.map((row) => row.symbol)));
            const lifecycleOwnerPending = pendingExposureByOwner(pendingRegistry);
            if (lifecycleExposure.baselineOpenPositions > EPSILON || lifecycleOwnerPending.baselinePendingExposure > EPSILON) {
                state.lastDecision = { decisionTs: market.decisionTs, accepted: false, reason: "BASELINE_OPEN_OR_PENDING" };
                await this.dependencies.stateStore.save(state);
                return { status: "no-change", message: "IDLE_GENERIC_BASELINE_NOT_IDLE", ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
            }
            let lifecycleBaseline: IdleBaselineAdmission;
            try {
                lifecycleBaseline = await buildBaselineAdmissionEvidence({
                    runtimeSha: this.dependencies.runtime.runtimeSha,
                    decisionTs: market.decisionTs,
                    now: this.now(),
                    baselineOpenPositions: lifecycleExposure.baselineOpenPositions,
                    baselinePendingExposure: lifecycleOwnerPending.baselinePendingExposure,
                    decisionPath: this.dependencies.runtime.decisionPath,
                    v12Path: this.dependencies.runtime.v12DecisionPath,
                    q102Path: this.dependencies.runtime.q102DecisionPath,
                    penguPath: this.dependencies.runtime.penguStatePath,
                    fetPath: this.dependencies.runtime.fetStatePath,
                    v52Path: this.dependencies.runtime.v52StatePath,
                });
            } catch (error) {
                const reason = `BASELINE_ADMISSION_BLOCKED:${error instanceof Error ? error.message : String(error)}`;
                state.lastDecision = { decisionTs: market.decisionTs, accepted: false, reason };
                await this.dependencies.stateStore.save(state);
                return {
                    status: "held",
                    message: `IDLE_GENERIC_${reason}`,
                    ordersSent: 0,
                    cancelsSent: 0,
                    positionChangesSent: 0,
                };
            }
            if (Math.max(lifecycleBaseline.baselineOpenPositions, lifecycleExposure.baselineOpenPositions) > EPSILON
                || Math.max(lifecycleBaseline.baselinePendingExposure, lifecycleOwnerPending.baselinePendingExposure) > EPSILON
                || lifecycleBaseline.baselineAcceptedThisTimestamp > 0) {
                state.lastDecision = {
                    decisionTs: market.decisionTs,
                    accepted: false,
                    reason: lifecycleBaseline.baselineAcceptedThisTimestamp > 0
                        ? "BASELINE_ACCEPTED_SAME_TIMESTAMP"
                        : "BASELINE_OPEN_OR_PENDING",
                };
                await this.dependencies.stateStore.save(state);
                return { status: "no-change", message: "IDLE_GENERIC_BASELINE_NOT_IDLE", ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
            }

            for (const candidate of lifecycleCandidates) this.markCandidateLifecycle(state, candidate);
            await this.dependencies.stateStore.save(state);

            const signals = lifecycleCandidates
                .map((row) => evaluateIdlePriorityShort(row.symbol, row.features, row.generic))
                .filter((signal) => signal.accepted);
            if (!signals.length) {
                state.lastDecision = { decisionTs: market.decisionTs, accepted: false, reason: "GENERIC_CANDIDATE_NOT_SELECTED_ROUTE" };
                await this.dependencies.stateStore.save(state);
                return { status: "no-change", message: "IDLE_GENERIC_CANDIDATE_NOT_SELECTED_ROUTE", ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
            }

            if (signals.length > 1) {
                const equity = account.walletBalance + positions.reduce((sum, position) => sum + Number(position.unrealizedPnl || 0), 0);
                const exposure = coreAndSidecarExposure(positions, equity, new Set(state.positions.map((row) => row.symbol)));
                const fullCryptoGrossAvailable = INTEGRATED_CRYPTO_CAP - exposure.cryptoGross - pendingAggregate.cryptoGross;
                const fullTotalGrossAvailable = INTEGRATED_TOTAL_CAP - exposure.totalGross - pendingAggregate.cryptoGross - pendingAggregate.stockGross;
                if (fullCryptoGrossAvailable + EPSILON < signals.length || fullTotalGrossAvailable + EPSILON < signals.length) {
                    state.lastDecision = { decisionTs: market.decisionTs, accepted: false, reason: "IDLE_MULTI_SIGNAL_CAPACITY_AMBIGUOUS" };
                    await this.dependencies.stateStore.save(state);
                    return { status: "held", message: "IDLE_MULTI_SIGNAL_CAPACITY_AMBIGUOUS", ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
                }
            }

            let aggregateResult: IdlePriorityShortTickResult | undefined;
            for (const signal of signals) {
                const accountNow = aggregateResult?.status === "completed" ? await this.dependencies.executor.getAccountSnapshot() : account;
                const positionsNow = aggregateResult?.status === "completed" ? await this.dependencies.executor.getPositions() : positions;
                if (aggregateResult?.status === "completed") {
                    pendingAggregate = aggregatePendingExposure(await readPendingExposureRegistry(this.dependencies.runtime.pendingExposurePath));
                }
                const result = await this.enter(state, signal, accountNow, positionsNow, lock, pendingAggregate);
                if (result.status === "manual-review") return result;
                if (result.status === "completed" || result.status === "shadow") {
                    aggregateResult = aggregateResult
                        ? { ...result, message: `IDLE_MULTI_SIGNAL_PROCESSED:${market.decisionTs}`, ordersSent: aggregateResult.ordersSent + result.ordersSent, cancelsSent: aggregateResult.cancelsSent + result.cancelsSent, positionChangesSent: aggregateResult.positionChangesSent + result.positionChangesSent }
                        : result;
                    continue;
                }
                if (!aggregateResult) aggregateResult = result;
            }
            return aggregateResult || { status: "no-change", message: "IDLE_NO_ACTION_AFTER_SIGNAL_SCAN", ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
        } catch (error) {
            if (isOperatorActivationBlock(error)) {
                return { status: "held", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
            }
            const state = await this.dependencies.stateStore.load().catch(() => undefined);
            if (state) {
                const deferred = classifyIdleFlatRateBudgetDeferral(state, error);
                if (deferred) {
                    return { status: "held", message: deferred, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
                }
                return this.manualReview(state, `IDLE_RUNNER_FAIL_CLOSED:${error instanceof Error ? error.message : String(error)}`);
            }
            throw error;
        } finally {
            await lock.release();
        }
    }
}

const INTEGRATED_CRYPTO_CAP = 3.0;
const INTEGRATED_TOTAL_CAP = 4.25;

export function idleRunnerSelfTest() {
    if (IDLE_PRIORITY_SHORT_POLICY.gross !== 1 || IDLE_PRIORITY_SHORT_POLICY.leverage !== 5 || IDLE_PRIORITY_SHORT_POLICY.marginType !== "cross") throw new Error("IDLE_LIVE_POLICY_SELFTEST_FAILED");
    if (IDLE_PRIORITY_SHORT_POLICY.emergencyStopPct !== 10 || IDLE_PRIORITY_SHORT_POLICY.emergencyTakeProfitPct !== 25) throw new Error("IDLE_LIVE_PROTECTION_SELFTEST_FAILED");
    if (deterministicIdleClientOrderId({ action: "ENTRY", symbol: "DOTUSDT", signalTs: 1 }) !== deterministicIdleClientOrderId({ action: "ENTRY", symbol: "DOTUSDT", signalTs: 1 })) throw new Error("IDLE_LIVE_IDEMPOTENCY_SELFTEST_FAILED");
    return true;
}
