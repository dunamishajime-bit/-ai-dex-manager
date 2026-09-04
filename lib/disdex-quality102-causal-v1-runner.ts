import { createHash, randomUUID } from "node:crypto";

import {
    QUALITY102_CAUSAL_V1,
    type Quality102CausalV1Mode,
} from "@/config/disdexQuality102CausalV1Runtime";
import {
    QUALITY102_HIGH_VOL_MAX_HOLD_HOURS,
    QUALITY102_HIGH_VOL_TRAIL_DISTANCE,
    QUALITY102_HIGH_VOL_TRAIL_TRIGGER,
} from "@/lib/disdex-quality102-causal-pipeline";
import {
    buildQuality102CausalV1Signal,
    type Quality102CausalV1History,
    type Quality102CausalV1Signal,
} from "@/lib/disdex-quality102-causal-v1-signal";
import {
    type Quality102CausalV1PendingOrder,
    type Quality102CausalV1State,
    type Quality102CausalV1StateStore,
} from "@/lib/disdex-quality102-causal-v1-state";
import {
    markToMarketReducePosition,
    planStrictPortfolio,
    type StrictPortfolioPosition,
    type StrictPortfolioPlan,
} from "@/lib/disdex-strict-portfolio-planner";
import {
    readDisDexV96KillSwitch,
} from "@/lib/disdex-v96-live-risk-controls";
import {
    readSharedCryptoDailyRisk,
} from "@/lib/disdex-shared-crypto-daily-risk";
import { classifyAsterSymbol } from "@/lib/disdex-aster-portfolio-classifier";
import type {
    DirectAccountSnapshot,
    DirectMarketQuote,
    DirectOpenOrder,
    DirectPosition,
    DirectTradeCommand,
    DirectTradeExecutor,
    DirectTradeResult,
} from "@/lib/direct-trade-executor";
import type {
    LiveRunnerLock,
    LiveRunnerLockHandle,
} from "@/lib/live-runner-state";

const STRATEGY_ID = QUALITY102_CAUSAL_V1.strategyId;
const HOUR_MS = 3_600_000;
const MAX_DATA_AGE_MS = 5 * 60_000;
const EPSILON = 1e-9;

export type Quality102CausalV1TickStatus =
    | "disabled"
    | "locked"
    | "shadow"
    | "held"
    | "no-change"
    | "planned"
    | "completed"
    | "blocked-local"
    | "manual-review";

export interface Quality102CausalV1TickResult {
    status: Quality102CausalV1TickStatus;
    message: string;
    signal?: Quality102CausalV1Signal;
    idempotencyKey?: string;
    exitReason?: "hard_stop" | "trail_5pct_after_12pct" | "72h_time" | "shared_risk_flatten";
    ordersSent?: number;
}

export interface Quality102CausalV1RunnerConfig {
    mode: Quality102CausalV1Mode;
    enabled: boolean;
    liveTradingEnabled: boolean;
    liveExecutionEnabled: boolean;
    operatorArmed: boolean;
    runtimeCommitSha: string;
    expectedRuntimeCommitSha: string;
    symbols: readonly string[];
    maximumGross: number;
    cryptoGrossCap: number;
    totalGrossCap: number;
    maximumPositions: number;
    maxSlippageBps: number;
    minimumOrderNotionalUsd: number;
    maximumEntryDelayMs: number;
    maximumDailyLossPct: number;
    maxDataAgeMs?: number;
    killSwitchPath?: string;
    sharedDailyRiskPath?: string;
    accountScope?: string;
}

export interface Quality102CausalV1Logger {
    info(message: string, payload?: Record<string, unknown>): void;
    warn(message: string, payload?: Record<string, unknown>): void;
    error(message: string, payload?: Record<string, unknown>): void;
}

export interface Quality102CausalV1ReservationInput {
    strategyId: string;
    symbol: string;
    side: "LONG" | "SHORT" | "FLAT";
    gross: number;
    notionalUsd: number;
}

export interface Quality102CausalV1LockHandle extends LiveRunnerLockHandle {
    reserve?(input: Quality102CausalV1ReservationInput): Promise<{ reservationId: string }>;
    releaseReservation?(reservationId: string): Promise<void>;
}

export interface Quality102CausalV1AccountLock extends LiveRunnerLock {
    acquire(ownerId: string, accountScope?: string): Promise<Quality102CausalV1LockHandle | null>;
}

export interface Quality102CausalV1RunnerDependencies {
    marketData: { load(force?: boolean): Promise<Quality102CausalV1History> };
    executor: DirectTradeExecutor;
    stateStore: Quality102CausalV1StateStore;
    lock: Quality102CausalV1AccountLock;
    config: Quality102CausalV1RunnerConfig;
    logger?: Quality102CausalV1Logger;
    now?: () => number;
    riskReader?: () => Promise<string | undefined>;
    signalBuilder?: (input: {
        history: Quality102CausalV1History;
        decisionTs: number;
        sleeveOccupancy: { activePosition: boolean; unresolvedPendingEntry: boolean };
    }) => Quality102CausalV1Signal;
}

function defaultLogger(): Quality102CausalV1Logger {
    return {
        info: (message, payload) => console.log(JSON.stringify({ level: "info", strategyId: STRATEGY_ID, message, ...(payload || {}) })),
        warn: (message, payload) => console.warn(JSON.stringify({ level: "warn", strategyId: STRATEGY_ID, message, ...(payload || {}) })),
        error: (message, payload) => console.error(JSON.stringify({ level: "error", strategyId: STRATEGY_ID, message, ...(payload || {}) })),
    };
}

function positive(value: unknown, name: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive.`);
    return parsed;
}

function finite(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function finiteSigned(value: unknown, name: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${name} must be finite.`);
    return parsed;
}

function nonZero(position: DirectPosition): boolean {
    return Number.isFinite(position.quantity) && Math.abs(position.quantity) > EPSILON;
}

function actualSide(position: DirectPosition): -1 | 1 {
    if (position.positionSide === "SHORT") return -1;
    if (position.positionSide === "LONG") return 1;
    return position.quantity < 0 ? -1 : 1;
}

function orderFilled(result: DirectTradeResult): boolean {
    return result.status === "FILLED" && result.executedQuantity > EPSILON;
}

function terminalWithoutExposure(result: DirectTradeResult): boolean {
    return ["REJECTED", "CANCELED", "EXPIRED"].includes(result.status) && result.executedQuantity <= EPSILON;
}

function normalizedSymbols(symbols: readonly string[]): string[] {
    const values = symbols.map((symbol) => String(symbol || "").trim().toUpperCase()).filter(Boolean);
    if (!values.length) throw new Error("QUALITY102_CAUSAL_V1_SYMBOLS_REQUIRED");
    const unique = [...new Set(values)].sort();
    for (const symbol of unique) {
        const classification = classifyAsterSymbol(symbol);
        if (classification.tradable) throw new Error(`QUALITY102_CAUSAL_V1_SYMBOL_OVERLAPS_BASE_SLEEVE:${symbol}`);
    }
    return unique;
}

function q102Idempotency(signal: Quality102CausalV1Signal, gross: number): string {
    return createHash("sha256")
        .update([STRATEGY_ID, signal.referenceTs, signal.symbol || "", signal.side, gross.toFixed(12)].join("|"))
        .digest("hex");
}

function clientOrderId(idempotencyKey: string, reduceOnly: boolean): string {
    return `q102v1-${reduceOnly ? "exit" : "entry"}-${idempotencyKey}`.slice(0, 36);
}

function isKnownBasePosition(symbol: string): boolean {
    return classifyAsterSymbol(symbol).tradable;
}

function isKnownBaseOrder(order: DirectOpenOrder): boolean {
    if (isKnownBasePosition(order.symbol)) return true;
    return /^(v12-|dualls2-|v52-|v96-|win80-|ultra90-)/i.test(String(order.clientOrderId || ""));
}

function validQuote(quote: DirectMarketQuote, expectedSymbol: string, now: number, maxAgeMs: number): boolean {
    return quote.symbol.trim().toUpperCase() === expectedSymbol.trim().toUpperCase()
        && Number.isFinite(quote.bidPrice)
        && Number.isFinite(quote.askPrice)
        && quote.bidPrice > 0
        && quote.askPrice > 0
        && quote.askPrice >= quote.bidPrice
        && Number.isFinite(quote.midPrice)
        && quote.midPrice > 0
        && Number.isFinite(quote.spreadBps)
        && quote.spreadBps >= 0
        // A zero-sized book side is not executable liquidity. Treat it as
        // stale/invalid so a live entry or reduction cannot be submitted
        // against a quote that has no quantity behind it.
        && Number.isFinite(quote.bidQuantity)
        && quote.bidQuantity > 0
        && Number.isFinite(quote.askQuantity)
        && quote.askQuantity > 0
        && Number.isFinite(quote.updatedAt)
        && quote.updatedAt > 0
        && quote.updatedAt <= now
        && now - quote.updatedAt <= maxAgeMs;
}

function strictBasePosition(position: DirectPosition, now: number): StrictPortfolioPosition {
    const classification = classifyAsterSymbol(position.symbol);
    if (!classification.tradable) throw new Error(`UNKNOWN_POSITION_OWNERSHIP:${position.symbol}`);
    const strategy = classification.sleeve === "V12"
        ? "V12"
        : classification.sleeve === "PENGU_DUAL_LS_V2"
            ? "PENGU_DUAL_LS_V2"
            : "V52";
    const updatedAt = positive(position.updatedAt, "base position updatedAt");
    if (updatedAt > now) throw new Error(`BASE_POSITION_TIMESTAMP_IN_FUTURE:${position.symbol}`);
    return {
        id: `aster:${position.symbol.toUpperCase()}:${position.positionSide}`,
        strategy,
        symbol: position.symbol.toUpperCase(),
        side: actualSide(position) > 0 ? "LONG" : "SHORT",
        quantity: positive(Math.abs(position.quantity), "base position quantity"),
        entryPrice: positive(position.entryPrice, "base position entryPrice"),
        markPrice: positive(position.markPrice, "base position markPrice"),
        entryTs: updatedAt,
        updatedAt,
    };
}

function strictCausalPosition(
    actual: DirectPosition,
    statePosition: NonNullable<Quality102CausalV1State["position"]>,
    quote: DirectMarketQuote,
): StrictPortfolioPosition {
    const markTs = positive(quote.updatedAt, "causal quote updatedAt");
    return {
        id: `aster:q102:${actual.symbol.toUpperCase()}`,
        strategy: STRATEGY_ID,
        symbol: actual.symbol.toUpperCase(),
        side: statePosition.side > 0 ? "LONG" : "SHORT",
        quantity: positive(Math.abs(actual.quantity), "causal position quantity"),
        entryPrice: positive(statePosition.entryPrice, "causal position entryPrice"),
        markPrice: positive(quote.midPrice, "causal quote midPrice"),
        entryTs: positive(statePosition.entryTs, "causal position entryTs"),
        updatedAt: markTs,
        feeBpsPerSide: 0,
        fundingPerDay: 0,
        markSource: "LIVE_MARKET_QUOTE",
        markSourceEvidence: {
            source: "LIVE_MARKET_QUOTE",
            timestamp: markTs,
            price: quote.midPrice,
            crossChecked: true,
        },
    };
}

function q102ActualPositions(positions: readonly DirectPosition[], symbols: ReadonlySet<string>): DirectPosition[] {
    return positions.filter((position) => symbols.has(position.symbol.toUpperCase()) && nonZero(position));
}

function positionMatchesState(actual: DirectPosition, statePosition: NonNullable<Quality102CausalV1State["position"]>): boolean {
    return actual.symbol.toUpperCase() === statePosition.symbol.toUpperCase()
        && actualSide(actual) === statePosition.side
        && Math.abs(Math.abs(actual.quantity) - statePosition.quantity) <= Math.max(1e-8, statePosition.quantity * 0.01);
}

function exposurePositions(positions: readonly DirectPosition[], q102Symbols: ReadonlySet<string>, statePosition?: Quality102CausalV1State["position"]): DirectPosition[] {
    const q102 = q102ActualPositions(positions, q102Symbols);
    for (const position of positions.filter(nonZero)) {
        if (q102Symbols.has(position.symbol.toUpperCase())) continue;
        if (!isKnownBasePosition(position.symbol)) throw new Error(`UNKNOWN_POSITION_OWNERSHIP:${position.symbol}`);
    }
    if (!statePosition && q102.length) throw new Error(`Q102_UNMANAGED_POSITION:${q102.map((row) => row.symbol).join(",")}`);
    if (statePosition && (q102.length !== 1 || !positionMatchesState(q102[0], statePosition))) {
        throw new Error("Q102_STATE_POSITION_MISMATCH");
    }
    return q102;
}

function accountEquity(account: DirectAccountSnapshot, positions: readonly DirectPosition[]): number {
    const equity = account.walletBalance + positions.reduce((sum, position) => sum + finiteSigned(position.unrealizedPnl, `${position.symbol} unrealizedPnl`), 0);
    return positive(equity, "account equity");
}

function validatePositionSnapshot(position: DirectPosition, now: number, maxAgeMs: number): void {
    const symbol = String(position.symbol || "").trim().toUpperCase();
    if (!symbol) throw new Error("Q102_POSITION_SYMBOL_INVALID");
    if (!Number.isFinite(position.quantity) || !Number.isFinite(position.notionalUsd) || !Number.isFinite(position.unrealizedPnl) || !Number.isFinite(position.pnlPct)) {
        throw new Error(`Q102_POSITION_NUMERIC_FIELD_INVALID:${symbol}`);
    }
    if (!Number.isFinite(position.updatedAt) || position.updatedAt <= 0 || position.updatedAt > now || now - position.updatedAt > maxAgeMs) {
        throw new Error(`Q102_POSITION_STALE_OR_INVALID:${symbol}`);
    }
    if (nonZero(position)) {
        if (!(position.entryPrice > 0) || !(position.markPrice > 0) || !(position.notionalUsd > 0) || !(position.leverage > 0)) {
            throw new Error(`Q102_POSITION_EXPOSURE_INVALID:${symbol}`);
        }
    }
    if (position.positionSide !== "BOTH" && position.positionSide !== "LONG" && position.positionSide !== "SHORT") {
        throw new Error(`Q102_POSITION_SIDE_INVALID:${symbol}`);
    }
}

function activePositionOrUndefined(state: Quality102CausalV1State, positions: readonly DirectPosition[], q102Symbols: ReadonlySet<string>): DirectPosition | undefined {
    if (!state.position) return undefined;
    const actual = q102ActualPositions(positions, q102Symbols);
    if (actual.length !== 1 || !positionMatchesState(actual[0], state.position)) throw new Error("Q102_STATE_POSITION_MISMATCH");
    return actual[0];
}

function exitReasonFor(statePosition: NonNullable<Quality102CausalV1State["position"]>, markPrice: number, now: number): "hard_stop" | "trail_5pct_after_12pct" | "72h_time" | undefined {
    const hardStop = statePosition.hardStop;
    const bestPrice = statePosition.bestPrice;
    if (!(hardStop && bestPrice)) return undefined;
    const long = statePosition.side > 0;
    const stopPrice = long ? statePosition.entryPrice * (1 - hardStop) : statePosition.entryPrice * (1 + hardStop);
    if ((long && markPrice <= stopPrice) || (!long && markPrice >= stopPrice)) return "hard_stop";
    const trailActive = statePosition.trailActive === true
        || (long ? bestPrice / statePosition.entryPrice - 1 : 1 - bestPrice / statePosition.entryPrice) >= QUALITY102_HIGH_VOL_TRAIL_TRIGGER - 1e-15;
    if (trailActive) {
        const trailPrice = long ? bestPrice * (1 - QUALITY102_HIGH_VOL_TRAIL_DISTANCE) : bestPrice * (1 + QUALITY102_HIGH_VOL_TRAIL_DISTANCE);
        if ((long && markPrice <= trailPrice) || (!long && markPrice >= trailPrice)) return "trail_5pct_after_12pct";
    }
    if (now - statePosition.entryTs >= QUALITY102_HIGH_VOL_MAX_HOLD_HOURS * HOUR_MS) return "72h_time";
    return undefined;
}

export class Quality102CausalV1Runner {
    private readonly log: Quality102CausalV1Logger;
    private readonly now: () => number;
    private readonly symbols: string[];
    private readonly symbolSet: ReadonlySet<string>;

    constructor(private readonly dependencies: Quality102CausalV1RunnerDependencies) {
        this.log = dependencies.logger || defaultLogger();
        this.now = dependencies.now || Date.now;
        this.symbols = normalizedSymbols(dependencies.config.symbols);
        this.symbolSet = new Set(this.symbols);
        if (Math.abs(dependencies.config.maximumGross - QUALITY102_CAUSAL_V1.maximumGross) > EPSILON
            || Math.abs(dependencies.config.cryptoGrossCap - QUALITY102_CAUSAL_V1.cryptoGrossCap) > EPSILON
            || Math.abs(dependencies.config.totalGrossCap - QUALITY102_CAUSAL_V1.totalGrossCap) > EPSILON
            || dependencies.config.maximumPositions !== QUALITY102_CAUSAL_V1.maximumPositions) {
            throw new Error("QUALITY102_CAUSAL_V1_GROSS_CONFIG_MISMATCH");
        }
    }

    private ensureLiveGate() {
        const config = this.dependencies.config;
        if (config.mode !== "LIVE") return;
        if (!config.enabled) throw new Error("QUALITY102_CAUSAL_V1_DISABLED");
        if (!config.liveTradingEnabled) throw new Error("QUALITY102_CAUSAL_V1_LIVE_TRADING_GATE_REQUIRED");
        if (!config.liveExecutionEnabled) throw new Error("QUALITY102_CAUSAL_V1_LIVE_EXECUTION_GATE_REQUIRED");
        if (!config.operatorArmed) throw new Error("OPERATOR_ARM_REQUIRED");
        if (!/^[0-9a-f]{40}$/i.test(config.runtimeCommitSha) || config.runtimeCommitSha.toLowerCase() !== config.expectedRuntimeCommitSha.toLowerCase()) {
            throw new Error("QUALITY102_CAUSAL_V1_RUNTIME_SHA_MISMATCH");
        }
    }

    private async sharedRiskBlocked(): Promise<string | undefined> {
        if (this.dependencies.config.mode !== "LIVE") return undefined;
        if (this.dependencies.riskReader) return this.dependencies.riskReader();
        const killPath = String(this.dependencies.config.killSwitchPath || "").trim();
        const riskPath = String(this.dependencies.config.sharedDailyRiskPath || "").trim();
        if (!killPath) return "QUALITY102_CAUSAL_V1_KILL_SWITCH_PATH_REQUIRED";
        if (!riskPath) return "QUALITY102_CAUSAL_V1_DAILY_RISK_PATH_REQUIRED";
        const kill = await readDisDexV96KillSwitch(killPath);
        if (kill) return `SHARED_KILL_SWITCH:${kill.reason}`;
        const risk = await readSharedCryptoDailyRisk(riskPath, this.now());
        if (!risk.ok) return `SHARED_CRYPTO_DAILY_RISK:${risk.reason}`;
        return undefined;
    }

    private buildSignal(history: Quality102CausalV1History, decisionTs: number, activePosition: boolean, unresolvedPendingEntry: boolean) {
        const input = { history, decisionTs, sleeveOccupancy: { activePosition, unresolvedPendingEntry } } as const;
        return this.dependencies.signalBuilder
            ? this.dependencies.signalBuilder(input)
            : buildQuality102CausalV1Signal(input);
    }

    private recordFailure(state: Quality102CausalV1State, error: unknown, idempotencyKey?: string): string {
        const message = error instanceof Error ? error.message : String(error);
        state.failures = [...state.failures, { occurredAt: this.now(), message, idempotencyKey }].slice(-100);
        return message;
    }

    private async manualReview(state: Quality102CausalV1State, message: string, idempotencyKey?: string): Promise<Quality102CausalV1TickResult> {
        if (state.pending) {
            state.pending.phase = "manual_review";
            state.pending.lastError = message;
            state.pending.updatedAt = this.now();
        }
        this.recordFailure(state, message, idempotencyKey);
        await this.dependencies.stateStore.save(state);
        this.log.error("Q102 causal v1 manual review", { message, idempotencyKey });
        return { status: "manual-review", message, idempotencyKey, ordersSent: 0 };
    }

    private async applyFilledEntry(state: Quality102CausalV1State, pending: Quality102CausalV1PendingOrder, result: DirectTradeResult): Promise<Quality102CausalV1TickResult> {
        const positions = await this.dependencies.executor.getPositions();
        const q102Positions = q102ActualPositions(positions, this.symbolSet);
        const actual = q102Positions.length === 1 ? q102Positions[0] : undefined;
        if (!actual || actualSide(actual) !== (pending.side === "BUY" ? 1 : -1) || Math.abs(Math.abs(actual.quantity) - result.executedQuantity) > Math.max(1e-8, result.executedQuantity * 0.02)) {
            return this.manualReview(state, "Q102_ENTRY_FILL_POSITION_MISMATCH", pending.idempotencyKey);
        }
        const entryPrice = positive(actual.entryPrice || result.averagePrice, "Q102 entry price");
        const hardStop = positive(pending.hardStop, "Q102 hard stop");
        state.position = {
            symbol: pending.symbol,
            side: pending.side === "BUY" ? 1 : -1,
            quantity: Math.abs(actual.quantity),
            entryPrice,
            entryTs: positive(actual.updatedAt || pending.referenceTs, "Q102 entry timestamp"),
            hardStop,
            bestPrice: entryPrice,
            trailActive: false,
        };
        state.lastCompletedIdempotencyKey = pending.idempotencyKey;
        state.lastProcessedReferenceTs = Math.max(state.lastProcessedReferenceTs || 0, pending.referenceTs);
        state.pending = undefined;
        state.lastReconciledAt = this.now();
        await this.dependencies.stateStore.save(state);
        return { status: "completed", message: "QUALITY102_CAUSAL_V1_ENTRY_FILLED", idempotencyKey: pending.idempotencyKey, ordersSent: 1 };
    }

    private async applyFilledBaseReduction(state: Quality102CausalV1State, pending: Quality102CausalV1PendingOrder, result: DirectTradeResult): Promise<Quality102CausalV1TickResult> {
        const position = state.position;
        if (!position || !pending.reason?.startsWith("BASE_PRIORITY_MTM_REDUCTION:")) return this.manualReview(state, "Q102_BASE_REDUCTION_STATE_MISSING", pending.idempotencyKey);
        if (result.executedQuantity <= EPSILON || result.executedQuantity > position.quantity + EPSILON) return this.manualReview(state, "Q102_BASE_REDUCTION_FILL_QUANTITY_INVALID", pending.idempotencyKey);
        const positions = await this.dependencies.executor.getPositions();
        const actualRows = q102ActualPositions(positions, this.symbolSet);
        const expectedRemaining = position.quantity - result.executedQuantity;
        if (expectedRemaining > EPSILON) {
            if (actualRows.length !== 1 || !positionMatchesState(actualRows[0], { ...position, quantity: expectedRemaining })) return this.manualReview(state, "Q102_BASE_REDUCTION_RECONCILED_POSITION_MISMATCH", pending.idempotencyKey);
        } else if (actualRows.length !== 0) {
            return this.manualReview(state, "Q102_BASE_REDUCTION_RECONCILED_NOT_FLAT", pending.idempotencyKey);
        }
        const executionPrice = result.averagePrice > 0 ? result.averagePrice : pending.expectedPrice || 0;
        if (!(executionPrice > 0)) return this.manualReview(state, "Q102_BASE_REDUCTION_RECONCILED_PRICE_INVALID", pending.idempotencyKey);
        const markQuote: DirectMarketQuote = {
            symbol: position.symbol,
            bidPrice: executionPrice,
            askPrice: executionPrice,
            bidQuantity: result.executedQuantity,
            askQuantity: result.executedQuantity,
            midPrice: executionPrice,
            spreadBps: 0,
            updatedAt: pending.referenceTs,
        };
        const strict = strictCausalPosition({
            symbol: position.symbol,
            quantity: position.quantity,
            entryPrice: position.entryPrice,
            markPrice: executionPrice,
            unrealizedPnl: 0,
            pnlPct: 0,
            notionalUsd: position.quantity * executionPrice,
            positionSide: position.side > 0 ? "LONG" : "SHORT",
            leverage: 1,
            updatedAt: pending.referenceTs,
        }, position, markQuote);
        const reduction = markToMarketReducePosition({
            position: strict,
            reduceQuantity: result.executedQuantity,
            markPrice: executionPrice,
            markTs: pending.referenceTs,
            markSource: "LIVE_MARKET_QUOTE",
            markSourceEvidence: { source: "LIVE_MARKET_QUOTE", timestamp: pending.referenceTs, price: executionPrice, crossChecked: true },
        });
        const actual = actualRows[0];
        state.position = expectedRemaining > EPSILON && actual ? { ...position, quantity: Math.abs(actual.quantity) } : undefined;
        state.lastReduction = {
            idempotencyKey: pending.idempotencyKey,
            symbol: position.symbol,
            side: position.side,
            reducedQuantity: result.executedQuantity,
            markTs: reduction.markTs,
            markPrice: reduction.markPrice,
            realizedPnl: reduction.realizedPnl,
            transactionCost: reduction.transactionCost,
            fundingCost: reduction.fundingCost,
            accounting: reduction.accounting,
        };
        state.pending = undefined;
        state.lastCompletedIdempotencyKey = pending.idempotencyKey;
        state.lastReconciledAt = this.now();
        await this.dependencies.stateStore.save(state);
        return { status: "completed", message: "QUALITY102_CAUSAL_V1_BASE_PRIORITY_MTM_REDUCTION_RECONCILED", idempotencyKey: pending.idempotencyKey, ordersSent: 1 };
    }

    private async applyFilledExit(state: Quality102CausalV1State, pending: Quality102CausalV1PendingOrder, result: DirectTradeResult): Promise<Quality102CausalV1TickResult> {
        const positions = await this.dependencies.executor.getPositions();
        if (q102ActualPositions(positions, this.symbolSet).length) return this.manualReview(state, "Q102_EXIT_POSITION_REMAINS_AFTER_FILL", pending.idempotencyKey);
        state.position = undefined;
        state.lastCompletedIdempotencyKey = pending.idempotencyKey;
        state.lastProcessedReferenceTs = Math.max(state.lastProcessedReferenceTs || 0, pending.referenceTs);
        state.pending = undefined;
        state.lastReconciledAt = this.now();
        await this.dependencies.stateStore.save(state);
        return { status: "completed", message: "QUALITY102_CAUSAL_V1_EXIT_FILLED", idempotencyKey: pending.idempotencyKey, exitReason: pending.reason as Quality102CausalV1TickResult["exitReason"], ordersSent: 1 };
    }

    private async reconcilePending(state: Quality102CausalV1State): Promise<Quality102CausalV1TickResult> {
        const pending = state.pending;
        if (!pending) return { status: "held", message: "QUALITY102_CAUSAL_V1_NO_PENDING_ORDER", ordersSent: 0 };
        if (pending.phase === "manual_review") return { status: "manual-review", message: pending.lastError || "QUALITY102_CAUSAL_V1_PENDING_MANUAL_REVIEW", idempotencyKey: pending.idempotencyKey, ordersSent: 0 };
        this.validatePendingIdentity(state, pending);
        const result = await this.dependencies.executor.reconcileOrder(pending.symbol, pending.clientOrderId);
        if (result.symbol.toUpperCase() !== pending.symbol.toUpperCase()
            || result.clientOrderId !== pending.clientOrderId
            || result.side !== pending.side
            || !Number.isFinite(result.executedQuantity)
            || result.executedQuantity < 0
            || result.executedQuantity > pending.quantity + EPSILON) {
            return this.manualReview(state, "Q102_RECONCILED_RESULT_IDENTITY_MISMATCH", pending.idempotencyKey);
        }
        if (result.status === "UNKNOWN" || result.executionUnknown) return this.manualReview(state, result.error || "Q102 pending order status is UNKNOWN; retry is forbidden.", pending.idempotencyKey);
        if (terminalWithoutExposure(result)) {
            state.pending = undefined;
            state.lastCompletedIdempotencyKey = pending.idempotencyKey;
            state.lastReconciledAt = this.now();
            await this.dependencies.stateStore.save(state);
            return { status: "held", message: `QUALITY102_CAUSAL_V1_${result.status}_NO_RETRY`, idempotencyKey: pending.idempotencyKey, ordersSent: 0 };
        }
        if (!orderFilled(result)) return this.manualReview(state, `Q102 pending order is unresolved: ${result.status}`, pending.idempotencyKey);
        return pending.reduceOnly
            ? pending.reason?.startsWith("BASE_PRIORITY_MTM_REDUCTION:")
                ? this.applyFilledBaseReduction(state, pending, result)
                : this.applyFilledExit(state, pending, result)
            : this.applyFilledEntry(state, pending, result);
    }

    private async validateLiveAccount(
        state: Quality102CausalV1State,
    ): Promise<{ account: DirectAccountSnapshot; positions: DirectPosition[]; openOrders: DirectOpenOrder[]; equity: number; actualQ102?: DirectPosition }> {
        const [account, positions, openOrders] = await Promise.all([
            this.dependencies.executor.getAccountSnapshot(),
            this.dependencies.executor.getPositions(),
            this.dependencies.executor.getOpenOrders(),
        ]);
        const now = this.now();
        const maxAge = this.dependencies.config.maxDataAgeMs ?? MAX_DATA_AGE_MS;
        if (!positive(account.walletBalance, "account wallet balance")
            || !Number.isFinite(account.availableBalance)
            || account.availableBalance < 0
            || !String(account.asset || "").trim()
            || !Number.isFinite(account.updatedAt)
            || account.updatedAt <= 0
            || account.updatedAt > now
            || now - account.updatedAt > maxAge) throw new Error("Q102_ACCOUNT_SNAPSHOT_STALE_OR_INVALID");
        for (const position of positions) validatePositionSnapshot(position, now, maxAge);
        const actualQ102 = activePositionOrUndefined(state, positions, this.symbolSet);
        exposurePositions(positions, this.symbolSet, state.position);
        for (const order of openOrders) {
            if (!String(order.symbol || "").trim() || !Number.isFinite(order.quantity) || order.quantity < 0 || !Number.isFinite(order.executedQuantity) || order.executedQuantity < 0) {
                throw new Error("Q102_OPEN_ORDER_SNAPSHOT_INVALID");
            }
            if (this.symbolSet.has(order.symbol.toUpperCase())) throw new Error(`Q102_UNKNOWN_OR_DUPLICATE_OPEN_ORDER:${order.clientOrderId || order.symbol}`);
            if (!isKnownBaseOrder(order)) throw new Error(`UNKNOWN_OPEN_ORDER_OWNERSHIP:${order.clientOrderId || order.symbol}`);
        }
        return { account, positions, openOrders, equity: accountEquity(account, positions), actualQ102 };
    }

    private validatePendingIdentity(state: Quality102CausalV1State, pending: Quality102CausalV1PendingOrder): void {
        const now = this.now();
        if (!pending.idempotencyKey.trim() || !pending.clientOrderId.startsWith("q102v1-")) throw new Error("Q102_PENDING_IDENTITY_INVALID");
        if (!this.symbolSet.has(pending.symbol.toUpperCase())) throw new Error("Q102_PENDING_SYMBOL_OUTSIDE_UNIVERSE");
        if (!Number.isFinite(pending.referenceTs) || pending.referenceTs <= 0 || pending.referenceTs > now) throw new Error("Q102_PENDING_REFERENCE_INVALID");
        if (!Number.isFinite(pending.createdAt) || pending.createdAt <= 0 || pending.createdAt > now) throw new Error("Q102_PENDING_CREATED_AT_INVALID");
        if (!Number.isFinite(pending.updatedAt) || pending.updatedAt <= 0 || pending.updatedAt > now) throw new Error("Q102_PENDING_UPDATED_AT_INVALID");
        if (pending.reduceOnly) {
            if (!state.position || state.position.symbol.toUpperCase() !== pending.symbol.toUpperCase()) throw new Error("Q102_PENDING_EXIT_WITHOUT_STATE_POSITION");
            const expectedSide = state.position.side > 0 ? "SELL" : "BUY";
            if (pending.side !== expectedSide) throw new Error("Q102_PENDING_EXIT_SIDE_MISMATCH");
        } else if (state.position) {
            throw new Error("Q102_PENDING_ENTRY_WHILE_POSITION_ACTIVE");
        }
    }

    private async validatePendingExecutionWindow(
        state: Quality102CausalV1State,
        pending: Quality102CausalV1PendingOrder,
    ): Promise<{ account: DirectAccountSnapshot; positions: DirectPosition[]; openOrders: DirectOpenOrder[]; equity: number; quote: DirectMarketQuote; expectedPrice: number }> {
        this.validatePendingIdentity(state, pending);
        const live = await this.validateLiveAccount(state);
        const now = this.now();
        const quote = await this.dependencies.executor.getMarketQuote(pending.symbol);
        if (!validQuote(quote, pending.symbol, now, this.dependencies.config.maxDataAgeMs ?? MAX_DATA_AGE_MS)) throw new Error("Q102_PENDING_QUOTE_STALE_OR_INVALID");
        const expectedPrice = pending.side === "BUY" ? quote.askPrice : quote.bidPrice;
        if (!Number.isFinite(expectedPrice) || expectedPrice <= 0) throw new Error("Q102_PENDING_EXECUTION_PRICE_INVALID");
        if (!pending.reduceOnly) {
            if (live.openOrders.length > 0) throw new Error("Q102_BASE_OR_OTHER_OPEN_ORDER_CONFLICT");
            const planner = planStrictPortfolio({
                equity: live.equity,
                now,
                active: live.positions.filter(nonZero).map((position) => strictBasePosition(position, now)),
                intents: [{
                    idempotencyKey: pending.idempotencyKey,
                    strategy: STRATEGY_ID,
                    symbol: pending.symbol,
                    side: pending.side === "BUY" ? "LONG" : "SHORT",
                    gross: positive(pending.targetGross, "Q102 pending targetGross"),
                    notionalUsd: positive(pending.quantity * expectedPrice, "Q102 pending notional"),
                    signalTs: pending.referenceTs,
                }],
                maxDataAgeMs: this.dependencies.config.maxDataAgeMs ?? MAX_DATA_AGE_MS,
                quality102CausalV1Ready: true,
            });
            const accepted = planner.accepted.find((intent) => intent.strategy === STRATEGY_ID);
            if (planner.status !== "planned" || !accepted || accepted.gross + EPSILON < positive(pending.targetGross, "Q102 pending targetGross")) {
                throw new Error(`Q102_PENDING_CAPACITY_CHANGED:${planner.reason || planner.rejected.find((row) => row.intent.strategy === STRATEGY_ID)?.reason || "NO_ACCEPTED_INTENT"}`);
            }
            if (pending.quantity * expectedPrice / live.equity > accepted.gross + EPSILON) throw new Error("Q102_PENDING_NOTIONAL_OVER_CAPACITY");
        } else {
            const actual = live.actualQ102;
            if (!actual || !state.position) throw new Error("Q102_PENDING_EXIT_POSITION_MISSING");
            if (pending.quantity > Math.abs(actual.quantity) + EPSILON) throw new Error("Q102_PENDING_EXIT_QUANTITY_EXCEEDS_POSITION");
            const strict = strictCausalPosition(actual, state.position, quote);
            markToMarketReducePosition({
                position: strict,
                reduceQuantity: pending.quantity,
                markPrice: quote.midPrice,
                markTs: quote.updatedAt,
                markSource: "LIVE_MARKET_QUOTE",
                markSourceEvidence: {
                    source: "LIVE_MARKET_QUOTE",
                    timestamp: quote.updatedAt,
                    price: quote.midPrice,
                    crossChecked: true,
                },
            });
        }
        return { ...live, quote, expectedPrice };
    }

    private async updateTrailingState(state: Quality102CausalV1State, quote: DirectMarketQuote): Promise<void> {
        const position = state.position;
        if (!position) return;
        const bestPrice = position.side > 0
            ? Math.max(position.bestPrice || position.entryPrice, quote.midPrice)
            : Math.min(position.bestPrice || position.entryPrice, quote.midPrice);
        const trailActive = position.trailActive === true
            || (position.side > 0 ? bestPrice / position.entryPrice - 1 : 1 - bestPrice / position.entryPrice) >= QUALITY102_HIGH_VOL_TRAIL_TRIGGER - 1e-15;
        if (bestPrice !== position.bestPrice || trailActive !== position.trailActive) {
            state.position = { ...position, bestPrice, trailActive };
            await this.dependencies.stateStore.save(state);
        }
    }

    private async executePending(state: Quality102CausalV1State, lock: Quality102CausalV1LockHandle): Promise<Quality102CausalV1TickResult> {
        const pending = state.pending;
        if (!pending) return { status: "held", message: "QUALITY102_CAUSAL_V1_NO_PENDING_ORDER", ordersSent: 0 };
        if (pending.phase !== "planned") return this.manualReview(state, "Q102_PENDING_PHASE_NOT_EXECUTABLE", pending.idempotencyKey);
        let reservation: { reservationId: string } | undefined;
        try {
            const executionWindow = await this.validatePendingExecutionWindow(state, pending);
            const normalized = await this.dependencies.executor.normalizeMarketQuantity(
                pending.symbol,
                pending.quantity,
                executionWindow.expectedPrice,
                { allowBelowMinNotional: pending.reduceOnly },
            );
            if (!(normalized.quantity > 0) || !Number.isFinite(normalized.notional) || normalized.notional <= 0) {
                return this.manualReview(state, "Q102_PENDING_NORMALIZED_QUANTITY_INVALID", pending.idempotencyKey);
            }
            if (!pending.reduceOnly && normalized.notional / executionWindow.equity > (pending.targetGross || 0) + EPSILON) {
                return this.manualReview(state, "Q102_PENDING_NORMALIZED_NOTIONAL_OVER_TARGET", pending.idempotencyKey);
            }
            pending.quantity = normalized.quantity;
            pending.expectedPrice = executionWindow.expectedPrice;
            if (!pending.reduceOnly && lock.reserve) {
                const reserved = await lock.reserve({
                    strategyId: STRATEGY_ID,
                    symbol: pending.symbol,
                    side: pending.side === "BUY" ? "LONG" : "SHORT",
                    gross: pending.targetGross || 0,
                    notionalUsd: normalized.notional,
                });
                reservation = { reservationId: reserved.reservationId };
            }
            pending.phase = "submitted";
            pending.updatedAt = this.now();
            await this.dependencies.stateStore.save(state);
            const command: DirectTradeCommand = {
                requestId: pending.idempotencyKey,
                clientOrderId: pending.clientOrderId,
                symbol: pending.symbol,
                side: pending.side,
                quantity: normalized.quantity,
                positionSide: "BOTH",
                reduceOnly: pending.reduceOnly,
                expectedPrice: executionWindow.expectedPrice,
                maxSlippageBps: this.dependencies.config.maxSlippageBps,
                reason: pending.reason || STRATEGY_ID,
            };
            let result: DirectTradeResult;
            try {
                result = await this.dependencies.executor.executeMarket(command);
            } catch (error) {
                return this.manualReview(state, error instanceof Error ? error.message : String(error), pending.idempotencyKey);
            }
            if (result.symbol.toUpperCase() !== pending.symbol.toUpperCase()
                || result.clientOrderId !== pending.clientOrderId
                || result.side !== pending.side
                || !Number.isFinite(result.executedQuantity)
                || result.executedQuantity < 0
                || result.executedQuantity > normalized.quantity + EPSILON) {
                return this.manualReview(state, "Q102_EXECUTION_RESULT_IDENTITY_MISMATCH", pending.idempotencyKey);
            }
            if (result.status === "UNKNOWN" || result.executionUnknown) {
                return this.manualReview(state, result.error || "Q102 execution status UNKNOWN; blind retry forbidden.", pending.idempotencyKey);
            }
            if (terminalWithoutExposure(result)) {
                state.pending = undefined;
                state.lastCompletedIdempotencyKey = pending.idempotencyKey;
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: `QUALITY102_CAUSAL_V1_${result.status}_NO_RETRY`, idempotencyKey: pending.idempotencyKey, ordersSent: 1 };
            }
            if (!orderFilled(result)) return this.manualReview(state, `Q102 execution unresolved: ${result.status}`, pending.idempotencyKey);
            return pending.reduceOnly ? await this.applyFilledExit(state, pending, result) : await this.applyFilledEntry(state, pending, result);
        } finally {
            if (reservation && lock.releaseReservation) await lock.releaseReservation(reservation.reservationId).catch(() => undefined);
        }
    }

    private async planExit(
        state: Quality102CausalV1State,
        actual: DirectPosition,
        quote: DirectMarketQuote,
        reason: Quality102CausalV1TickResult["exitReason"],
    ): Promise<Quality102CausalV1TickResult> {
        const position = state.position;
        if (!position || !reason) return { status: "held", message: "QUALITY102_CAUSAL_V1_POSITION_HELD", ordersSent: 0 };
        const strict = strictCausalPosition(actual, position, quote);
        // A protective reduction is allowed even when an earlier mark or a
        // profitable position would temporarily appear above an entry-cap
        // check. Validate the live mark and MTM accounting directly; never
        // reject a risk exit merely because exposure is already over a cap.
        try {
            markToMarketReducePosition({
                position: strict,
                reduceQuantity: Math.abs(actual.quantity),
                markPrice: quote.midPrice,
                markTs: quote.updatedAt,
                markSource: "LIVE_MARKET_QUOTE",
                markSourceEvidence: {
                    source: "LIVE_MARKET_QUOTE",
                    timestamp: quote.updatedAt,
                    price: quote.midPrice,
                    crossChecked: true,
                },
            });
        } catch (error) {
            return { status: "blocked-local", message: `Q102 exit mark validation blocked: ${error instanceof Error ? error.message : String(error)}`, ordersSent: 0 };
        }
        const closeSide = position.side > 0 ? "SELL" : "BUY";
        const expectedPrice = closeSide === "SELL" ? quote.bidPrice : quote.askPrice;
        const idempotencyKey = createHash("sha256")
            .update([STRATEGY_ID, "EXIT", position.symbol, position.entryTs, reason, quote.updatedAt].join("|"))
            .digest("hex");
        if (state.lastCompletedIdempotencyKey === idempotencyKey) return { status: "no-change", message: "Q102 exit already completed.", idempotencyKey, ordersSent: 0 };
        const pending: Quality102CausalV1PendingOrder = {
            idempotencyKey,
            clientOrderId: clientOrderId(idempotencyKey, true),
            phase: "planned",
            symbol: position.symbol,
            side: closeSide,
            quantity: Math.abs(actual.quantity),
            reduceOnly: true,
            referenceTs: quote.updatedAt,
            createdAt: this.now(),
            updatedAt: this.now(),
            expectedPrice,
            targetGross: QUALITY102_CAUSAL_V1.maximumGross,
            hardStop: position.hardStop,
            reason,
        };
        state.pending = pending;
        await this.dependencies.stateStore.save(state);
        return { status: "planned", message: `Q102 exit planned: ${reason}`, idempotencyKey, exitReason: reason, ordersSent: 0 };
    }

    private async planEntry(
        state: Quality102CausalV1State,
        signal: Quality102CausalV1Signal,
        account: DirectAccountSnapshot,
        positions: DirectPosition[],
        quote: DirectMarketQuote,
    ): Promise<Quality102CausalV1TickResult> {
        if (signal.side === 0 || !signal.symbol || signal.requestedGross <= 0) {
            state.lastProcessedReferenceTs = Math.max(state.lastProcessedReferenceTs || 0, signal.referenceTs);
            await this.dependencies.stateStore.save(state);
            return { status: "no-change", message: signal.reason, signal, ordersSent: 0 };
        }
        const symbol = signal.symbol.toUpperCase();
        if (!this.symbolSet.has(symbol)) return { status: "blocked-local", message: "Q102 signal symbol is outside configured causal universe.", signal, ordersSent: 0 };
        if (classifyAsterSymbol(symbol).tradable) return { status: "blocked-local", message: "Q102 signal overlaps a base sleeve.", signal, ordersSent: 0 };
        const localNow = this.now();
        if (!validQuote(quote, symbol, localNow, this.dependencies.config.maxDataAgeMs ?? MAX_DATA_AGE_MS)) return { status: "blocked-local", message: "Q102 entry quote is stale or invalid.", signal, ordersSent: 0 };
        if (!Number.isFinite(signal.referenceTs) || signal.referenceTs <= 0 || signal.referenceTs > localNow || localNow - signal.referenceTs > this.dependencies.config.maximumEntryDelayMs) {
            return { status: "blocked-local", message: "Q102 signal is outside the executable entry window.", signal, ordersSent: 0 };
        }
        if (signal.referenceTs > quote.updatedAt) return { status: "blocked-local", message: "Q102 quote precedes signal reference.", signal, ordersSent: 0 };
        const equity = accountEquity(account, positions);
        const available = Math.max(0, Math.min(account.availableBalance, equity));
        const requestedNotional = Math.min(signal.requestedGross * equity, available);
        if (!(requestedNotional >= this.dependencies.config.minimumOrderNotionalUsd)) {
            state.lastProcessedReferenceTs = Math.max(state.lastProcessedReferenceTs || 0, signal.referenceTs);
            await this.dependencies.stateStore.save(state);
            return { status: "held", message: "Q102 executable notional is below minimum.", signal, ordersSent: 0 };
        }
        const entrySide = signal.side > 0 ? "LONG" : "SHORT";
        const planner: StrictPortfolioPlan = planStrictPortfolio({
            equity,
            now: quote.updatedAt,
            active: positions.filter(nonZero).map(strictBasePosition),
            intents: [{
                idempotencyKey: `${STRATEGY_ID}|${signal.referenceTs}|${symbol}|${signal.side}`,
                strategy: STRATEGY_ID,
                symbol,
                side: entrySide,
                gross: Math.min(signal.requestedGross, QUALITY102_CAUSAL_V1.maximumGross),
                notionalUsd: requestedNotional,
                signalTs: signal.referenceTs,
            }],
            maxDataAgeMs: this.dependencies.config.maxDataAgeMs ?? MAX_DATA_AGE_MS,
            quality102CausalV1Ready: true,
        });
        const accepted = planner.accepted.find((intent) => intent.strategy === STRATEGY_ID);
        if (planner.status !== "planned" || !accepted) {
            state.lastProcessedReferenceTs = Math.max(state.lastProcessedReferenceTs || 0, signal.referenceTs);
            await this.dependencies.stateStore.save(state);
            return { status: "held", message: `Q102 entry planner blocked: ${planner.reason || planner.rejected.find((row) => row.intent.strategy === STRATEGY_ID)?.reason || "NO_ACCEPTED_INTENT"}`, signal, ordersSent: 0 };
        }
        const expectedPrice = signal.side > 0 ? quote.askPrice : quote.bidPrice;
        const requestedQuantity = accepted.notionalUsd / expectedPrice;
        const normalized = await this.dependencies.executor.normalizeMarketQuantity(symbol, requestedQuantity, expectedPrice);
        if (!(normalized.quantity > 0) || normalized.notional < this.dependencies.config.minimumOrderNotionalUsd) {
            state.lastProcessedReferenceTs = Math.max(state.lastProcessedReferenceTs || 0, signal.referenceTs);
            await this.dependencies.stateStore.save(state);
            return { status: "held", message: "Q102 normalized quantity is below executable minimum.", signal, ordersSent: 0 };
        }
        const idempotencyKey = q102Idempotency(signal, accepted.gross);
        if (state.lastCompletedIdempotencyKey === idempotencyKey || state.lastProcessedReferenceTs === signal.referenceTs) {
            return { status: "no-change", message: "Q102 signal already processed.", signal, idempotencyKey, ordersSent: 0 };
        }
        const pending: Quality102CausalV1PendingOrder = {
            idempotencyKey,
            clientOrderId: clientOrderId(idempotencyKey, false),
            phase: "planned",
            symbol,
            side: signal.side > 0 ? "BUY" : "SELL",
            quantity: normalized.quantity,
            reduceOnly: false,
            referenceTs: signal.referenceTs,
            createdAt: this.now(),
            updatedAt: this.now(),
            expectedPrice,
            targetGross: accepted.gross,
            hardStop: signal.hardStop,
            reason: `${signal.reason}:${signal.family || "UNKNOWN"}`,
        };
        if (!pending.hardStop) return this.manualReview(state, "Q102 signal has no recovered hard-stop metadata; entry blocked.", idempotencyKey);
        state.pending = pending;
        await this.dependencies.stateStore.save(state);
        return { status: "planned", message: "QUALITY102_CAUSAL_V1_ENTRY_PLANNED", signal, idempotencyKey, ordersSent: 0 };
    }

    async tick(): Promise<Quality102CausalV1TickResult> {
        if (!this.dependencies.config.enabled) return { status: "disabled", message: "QUALITY102_CAUSAL_V1 is disabled.", ordersSent: 0 };
        this.ensureLiveGate();
        const ownerId = `${STRATEGY_ID}:${process.pid}:${randomUUID()}`;
        const lock = await this.dependencies.lock.acquire(ownerId, this.dependencies.config.accountScope || "ASTER_FUTURES");
        if (!lock) return { status: "locked", message: "Q102 shared account lock is busy or requires review.", ordersSent: 0 };
        try {
            const state = await this.dependencies.stateStore.load();
            if (state.strategyId !== STRATEGY_ID || state.mode !== this.dependencies.config.mode) {
                return this.manualReview(state, "Q102 runtime state identity/mode mismatch.");
            }
            if (this.dependencies.config.mode === "LIVE" && state.runtimeCommitSha.toLowerCase() !== this.dependencies.config.runtimeCommitSha.toLowerCase()) {
                return this.manualReview(state, "Q102 runtime state SHA mismatch.");
            }
            if (state.pending) return state.pending.phase === "planned" || state.pending.phase === "submitted" || state.pending.phase === "manual_review"
                ? this.reconcilePending(state)
                : this.manualReview(state, "Q102 pending phase is invalid.", state.pending.idempotencyKey);

            const history = await this.dependencies.marketData.load();
            if (this.dependencies.config.mode === "SHADOW") {
                const signal = this.buildSignal(history, this.now(), false, false);
                state.lastProcessedReferenceTs = Math.max(state.lastProcessedReferenceTs || 0, signal.referenceTs);
                await this.dependencies.stateStore.save(state);
                return { status: "shadow", message: signal.reason, signal, ordersSent: 0 };
            }

            const riskBlocked = await this.sharedRiskBlocked();
            const live = await this.validateLiveAccount(state);
            const actual = live.actualQ102;
            if (state.position && !actual) return this.manualReview(state, "Q102 state expects a position but exchange returned none.");
            if (!state.position && actual) return this.manualReview(state, "Q102 exchange position is unmanaged.");
            if (state.position) {
                if (!state.position.hardStop || !state.position.bestPrice || state.position.trailActive === undefined) return this.manualReview(state, "Q102 active state lacks recovered exit metadata.");
                const quote = await this.dependencies.executor.getMarketQuote(state.position.symbol);
                if (!validQuote(quote, state.position.symbol, this.now(), this.dependencies.config.maxDataAgeMs ?? MAX_DATA_AGE_MS)) return { status: "blocked-local", message: "Q102 active mark quote is stale or invalid.", ordersSent: 0 };
                await this.updateTrailingState(state, quote);
                const reason = riskBlocked ? "shared_risk_flatten" : exitReasonFor(state.position, quote.midPrice, quote.updatedAt);
                if (!reason) return { status: "held", message: "QUALITY102_CAUSAL_V1_POSITION_HELD", ordersSent: 0 };
                const planned = await this.planExit(state, actual!, quote, reason);
                return planned.status === "planned" ? this.executePending(state, lock) : planned;
            }
            if (riskBlocked) return { status: "blocked-local", message: riskBlocked, ordersSent: 0 };
            const signal = this.buildSignal(history, this.now(), false, false);
            if (state.lastProcessedReferenceTs !== undefined && signal.referenceTs <= state.lastProcessedReferenceTs) {
                return { status: "no-change", message: "Q102 signal reference was already processed.", signal, ordersSent: 0 };
            }
            if (signal.side === 0 || !signal.symbol) {
                state.lastProcessedReferenceTs = signal.referenceTs;
                await this.dependencies.stateStore.save(state);
                return { status: "no-change", message: signal.reason, signal, ordersSent: 0 };
            }
            if (live.openOrders.length > 0) {
                return { status: "blocked-local", message: "Q102 entry waits for the shared account to have no open orders; base orders remain untouched.", signal, ordersSent: 0 };
            }
            const quote = await this.dependencies.executor.getMarketQuote(signal.symbol);
            const planned = await this.planEntry(state, signal, live.account, live.positions, quote);
            return planned.status === "planned" ? this.executePending(state, lock) : planned;
        } catch (error) {
            const state = await this.dependencies.stateStore.load().catch(() => undefined);
            if (state) {
                const message = this.recordFailure(state, error);
                await this.dependencies.stateStore.save(state).catch(() => undefined);
                this.log.error("Q102 causal v1 blocked locally", { message });
                return { status: "blocked-local", message, ordersSent: 0 };
            }
            return { status: "blocked-local", message: error instanceof Error ? error.message : String(error), ordersSent: 0 };
        } finally {
            await lock.release();
        }
    }
}

export { markToMarketReducePosition };
