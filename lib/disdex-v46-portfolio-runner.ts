import { createHash, randomUUID } from "node:crypto";
import type { AsterOrderSide } from "@/lib/aster-v3-client";
import type {
    DirectMarketQuote,
    DirectPosition,
    DirectTradeCommand,
    DirectTradeExecutor,
    DirectTradeResult,
} from "@/lib/direct-trade-executor";
import type { LiveRunnerLock } from "@/lib/live-runner-state";
import { buildDisDexV35RebalanceActions, type DisDexV35RebalanceAction } from "@/lib/disdex-v35-portfolio-runner";
import type {
    DisDexV35PendingOrder,
    DisDexV35RunnerMode,
    DisDexV35RunnerState,
    DisDexV35RunnerStateStore,
} from "@/lib/disdex-v35-runner-state";
import type { DisDexV46AsterMarketDataProvider } from "@/lib/disdex-v46-market-data-provider";
import { buildDisDexV46CombinedSignal, type DisDexV46CombinedSignal } from "@/lib/disdex-v46-combined-signal";
import type { DisDexV46ExecutionRecord } from "./disdex-v46-settlement-analysis";

const MANAGED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"] as const;

export interface DisDexV46PortfolioRunnerConfig {
    mode: DisDexV35RunnerMode;
    liveExecutionEnabled: boolean;
    productionConfigLiveEnabled: boolean;
    cashReservePct: number;
    maxGross: number;
    maxSlippageBps: number;
    minOrderNotionalUsd: number;
    rebalanceTolerancePct: number;
    maxTransactionRetries: number;
    closeUnmanagedPositions: boolean;
}

export interface DisDexV46RunnerLogger {
    info(message: string, payload?: Record<string, unknown>): void;
    warn(message: string, payload?: Record<string, unknown>): void;
    error(message: string, payload?: Record<string, unknown>): void;
}

export interface DisDexV46PortfolioRunnerDependencies {
    marketData: DisDexV46AsterMarketDataProvider;
    executor: DirectTradeExecutor;
    stateStore: DisDexV35RunnerStateStore;
    lock: LiveRunnerLock;
    config: DisDexV46PortfolioRunnerConfig;
    logger?: DisDexV46RunnerLogger;
    now?: () => number;
}

export interface DisDexV46TickResult {
    status: "locked" | "held" | "no-change" | "planned" | "completed" | "failed" | "manual-review";
    message: string;
    signal?: DisDexV46CombinedSignal;
    action?: DisDexV35RebalanceAction;
    idempotencyKey?: string;
}

function defaultLogger(): DisDexV46RunnerLogger {
    return {
        info: (message, payload) => console.log(JSON.stringify({ level: "info", message, ...(payload || {}) })),
        warn: (message, payload) => console.warn(JSON.stringify({ level: "warn", message, ...(payload || {}) })),
        error: (message, payload) => console.error(JSON.stringify({ level: "error", message, ...(payload || {}) })),
    };
}

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function orderFilled(result: DirectTradeResult) {
    return (result.status === "FILLED" || result.status === "PARTIALLY_FILLED") && result.executedQuantity > 0;
}


function availableOrderCapacityUsd(account: { availableBalance: number }, cashReservePct: number) {
    return Math.max(0, finite(account.availableBalance)) * Math.max(0, 1 - cashReservePct / 100);
}
function quotePrice(quote: DirectMarketQuote, side: AsterOrderSide) {
    return side === "BUY" ? quote.askPrice : quote.bidPrice;
}

function clientOrderId(key: string) {
    return `v46-${createHash("sha256").update(key).digest("hex").slice(0, 27)}`.slice(0, 36);
}

function idempotencyKey(signal: DisDexV46CombinedSignal, action: DisDexV35RebalanceAction) {
    return createHash("sha256")
        .update([
            signal.strategyId,
            signal.referenceTs,
            signal.pengu.entryTs || 0,
            signal.pengu.exitTs || 0,
            signal.pengu.side,
            action.symbol,
            action.side,
            action.reduceOnly ? "reduce" : "open",
            action.targetWeight.toFixed(6),
            (action.currentNotionalUsd / 5).toFixed(0),
        ].join("|"))
        .digest("hex");
}

function signedPositionQuantity(position: DirectPosition) {
    if (position.positionSide === "SHORT") return -Math.abs(position.quantity);
    if (position.positionSide === "LONG") return Math.abs(position.quantity);
    return finite(position.quantity);
}

function recordFilledExecution(state: DisDexV35RunnerState, pending: DisDexV35PendingOrder, result: DirectTradeResult, completedAt: number) {
    const existing = state.completedExecutions || [];
    if (existing.some((item) => item.idempotencyKey === pending.idempotencyKey)) return;
    const record: DisDexV46ExecutionRecord = {
        idempotencyKey: pending.idempotencyKey,
        clientOrderId: pending.clientOrderId,
        orderId: result.orderId,
        symbol: (result.symbol || pending.symbol).toUpperCase(),
        side: result.side,
        reduceOnly: pending.reduceOnly,
        status: result.status === "PARTIALLY_FILLED" ? "PARTIALLY_FILLED" : "FILLED",
        requestedQuantity: result.requestedQuantity,
        executedQuantity: result.executedQuantity,
        averagePrice: result.averagePrice,
        quoteQuantity: result.quoteQuantity,
        completedAt,
        referenceTs: pending.referenceTs,
        targetWeight: pending.targetWeight,
        reason: pending.reason,
        positionBefore: pending.positionBefore,
    };
    state.completedExecutions = [...existing, record].slice(-500);
}

export class DisDexV46PortfolioRunner {
    private readonly log: DisDexV46RunnerLogger;
    private readonly now: () => number;

    constructor(private readonly dependencies: DisDexV46PortfolioRunnerDependencies) {
        this.log = dependencies.logger || defaultLogger();
        this.now = dependencies.now || Date.now;
    }

    private ensureLiveGate() {
        const config = this.dependencies.config;
        if (config.mode !== "live") return;
        if (!config.liveExecutionEnabled || !config.productionConfigLiveEnabled) {
            throw new Error("V46 live runner is locked. Runtime and production live flags are both required.");
        }
    }

    private recordFailure(state: DisDexV35RunnerState, error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        state.failures = [...state.failures, {
            occurredAt: this.now(),
            message,
            idempotencyKey: state.pending?.idempotencyKey,
            symbol: state.pending?.symbol,
        }].slice(-100);
        return message;
    }

    private async reconcilePending(state: DisDexV35RunnerState): Promise<DisDexV46TickResult> {
        const pending = state.pending;
        if (!pending) return { status: "held", message: "No pending V46 order." };
        if (pending.phase === "manual_review") {
            return { status: "manual-review", message: pending.lastError || "V46 pending order requires manual review.", idempotencyKey: pending.idempotencyKey };
        }
        if (pending.phase === "planned") return this.executePending(state);
        const result = await this.dependencies.executor.reconcileOrder(pending.symbol, pending.clientOrderId);
        if (result.status === "UNKNOWN") {
            pending.retryCount += 1;
            pending.lastError = result.error || "V46 order status remains unknown.";
            pending.updatedAt = this.now();
            if (pending.retryCount >= this.dependencies.config.maxTransactionRetries) pending.phase = "manual_review";
            await this.dependencies.stateStore.save(state);
            return {
                status: pending.phase === "manual_review" ? "manual-review" : "held",
                message: pending.lastError,
                idempotencyKey: pending.idempotencyKey,
            };
        }
        if (!orderFilled(result)) throw new Error(`V46 pending order ended with ${result.status} and no fill.`);
        recordFilledExecution(state, pending, result, this.now());
        state.lastCompletedIdempotencyKey = pending.idempotencyKey;
        state.pending = undefined;
        await this.dependencies.stateStore.save(state);
        return { status: "completed", message: `Reconciled ${pending.side} ${pending.symbol}.`, idempotencyKey: pending.idempotencyKey };
    }

    private async executePending(state: DisDexV35RunnerState): Promise<DisDexV46TickResult> {
        const pending = state.pending;
        if (!pending) return { status: "held", message: "No pending V46 order." };
        try {
            const quote = await this.dependencies.executor.getMarketQuote(pending.symbol);
            const price = quotePrice(quote, pending.side);
            const normalized = await this.dependencies.executor.normalizeMarketQuantity(pending.symbol, pending.quantity, price);
            pending.quantity = normalized.quantity;
            pending.expectedPrice = price;
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
                expectedPrice: price,
                maxSlippageBps: this.dependencies.config.maxSlippageBps,
                reason: pending.reason,
            };
            const result = await this.dependencies.executor.executeMarket(command);
            if (result.status === "UNKNOWN") {
                pending.lastError = result.error || "V46 order execution is unknown.";
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: pending.lastError, idempotencyKey: pending.idempotencyKey };
            }
            if (!orderFilled(result)) throw new Error(`V46 order was not filled (${result.status}).`);
            recordFilledExecution(state, pending, result, this.now());
            state.lastCompletedIdempotencyKey = pending.idempotencyKey;
            state.pending = undefined;
            await this.dependencies.stateStore.save(state);
            this.log.info("V46 rebalance completed", {
                symbol: pending.symbol,
                side: pending.side,
                reduceOnly: pending.reduceOnly,
                quantity: result.executedQuantity,
                averagePrice: result.averagePrice,
                targetWeight: pending.targetWeight,
            });
            return { status: "completed", message: `${pending.side} ${pending.symbol} completed.`, idempotencyKey: pending.idempotencyKey };
        } catch (error) {
            pending.retryCount += 1;
            pending.lastError = this.recordFailure(state, error);
            pending.updatedAt = this.now();
            pending.phase = pending.retryCount >= this.dependencies.config.maxTransactionRetries ? "manual_review" : "planned";
            await this.dependencies.stateStore.save(state);
            return {
                status: pending.phase === "manual_review" ? "manual-review" : "failed",
                message: pending.lastError,
                idempotencyKey: pending.idempotencyKey,
            };
        }
    }

    async tick(): Promise<DisDexV46TickResult> {
        this.ensureLiveGate();
        const ownerId = randomUUID();
        const lock = await this.dependencies.lock.acquire(ownerId);
        if (!lock) return { status: "locked", message: "Another V46 tick owns the execution lock." };
        try {
            const state = await this.dependencies.stateStore.load();
            state.lastRunAt = this.now();
            await this.dependencies.stateStore.save(state);
            if (state.pending) return await this.reconcilePending(state);

            const [history, account, positions, openOrders] = await Promise.all([
                this.dependencies.marketData.load(),
                this.dependencies.executor.getAccountSnapshot(),
                this.dependencies.executor.getPositions(),
                this.dependencies.executor.getOpenOrders(),
            ]);
            if (openOrders.length) return { status: "held", message: `V46 will not rebalance while ${openOrders.length} open order(s) exist.` };

            const signal = buildDisDexV46CombinedSignal(history, this.now());
            const quoteSymbols = new Set<string>([
                ...MANAGED_SYMBOLS,
                ...(this.dependencies.config.closeUnmanagedPositions ? positions.map((position) => position.symbol.toUpperCase()) : []),
            ]);
            const quotes = Object.fromEntries(await Promise.all(
                [...quoteSymbols].map(async (symbol) => [symbol, await this.dependencies.executor.getMarketQuote(symbol)]),
            ));
            const rebalance = buildDisDexV35RebalanceActions({
                account,
                positions,
                quotes,
                targetWeights: signal.targetWeights,
                config: this.dependencies.config,
            });
            state.lastSignalReferenceTs = signal.referenceTs;
            if (!rebalance.actions.length) {
                await this.dependencies.stateStore.save(state);
                return { status: "no-change", message: `V46 portfolio is within ${rebalance.tolerance.toFixed(2)} USD tolerance.`, signal };
            }
            const action = rebalance.actions[0];
            const key = idempotencyKey(signal, action);
            if (state.lastCompletedIdempotencyKey === key) {
                return { status: "held", message: "The same V46 rebalance action was already completed.", signal, action, idempotencyKey: key };
            }
            const position = positions.find((item) => item.symbol.toUpperCase() === action.symbol);
            const signedQuantity = position ? signedPositionQuantity(position) : 0;
            if (signedQuantity !== 0 && action.targetWeight !== 0 && Math.sign(signedQuantity) !== Math.sign(action.targetWeight) && !action.reduceOnly) {
                throw new Error("V46 invariant violation: a direction change must close reduce-only before opening the opposite side.");
            }
            const currentMagnitudeUsd = Math.abs(action.currentNotionalUsd);
            const targetMagnitudeUsd = Math.abs(action.targetNotionalUsd);
            const requiredIncreaseUsd = Math.max(0, targetMagnitudeUsd - currentMagnitudeUsd);
            const availableCapacityUsd = availableOrderCapacityUsd(account, this.dependencies.config.cashReservePct);
            if (!action.reduceOnly && requiredIncreaseUsd > availableCapacityUsd + 1e-9) {
                await this.dependencies.stateStore.save(state);
                this.log.warn("V46 order held: available balance capacity is insufficient", {
                    symbol: action.symbol,
                    requiredIncreaseUsd,
                    availableCapacityUsd,
                    targetNotionalUsd: action.targetNotionalUsd,
                    currentNotionalUsd: action.currentNotionalUsd,
                });
                return {
                    status: "held",
                    message: `Insufficient available balance capacity for ${action.symbol}; no order was sent.`,
                    signal,
                    action,
                    idempotencyKey: key,
                };
            }
            const pending: DisDexV35PendingOrder = {
                idempotencyKey: key,
                phase: "planned",
                symbol: action.symbol,
                side: action.side,
                quantity: action.quantity,
                reduceOnly: action.reduceOnly,
                expectedPrice: action.expectedPrice,
                clientOrderId: clientOrderId(key),
                targetWeight: action.targetWeight,
                targetNotionalUsd: action.targetNotionalUsd,
                referenceTs: signal.referenceTs,
                createdAt: this.now(),
                updatedAt: this.now(),
                retryCount: 0,
                reason: `${signal.strategyId}: ${action.reason} core=${signal.core.allocation.state} pengu=${signal.pengu.side} targetWeight=${action.targetWeight.toFixed(6)}`,
                positionBefore: position ? {
                    signedQuantity,
                    entryPrice: position.entryPrice,
                    markPrice: position.markPrice,
                    notionalUsd: position.notionalUsd,
                    observedAt: position.updatedAt || this.now(),
                } : undefined,
            };
            state.pending = pending;
            await this.dependencies.stateStore.save(state);
            this.log.info("V46 rebalance planned", {
                signalReferenceTs: signal.referenceTs,
                coreState: signal.core.allocation.state,
                penguSide: signal.pengu.side,
                penguReason: signal.pengu.reason,
                symbol: action.symbol,
                side: action.side,
                reduceOnly: action.reduceOnly,
                targetWeight: action.targetWeight,
                mode: this.dependencies.config.mode,
            });
            const result = await this.executePending(state);
            return { ...result, signal, action, idempotencyKey: key };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log.error("V46 runner tick failed", { message });
            return { status: /manual review/i.test(message) ? "manual-review" : "failed", message };
        } finally {
            await lock.release();
        }
    }
}

export function buildDefaultDisDexV46RunnerConfig(
    input: Partial<DisDexV46PortfolioRunnerConfig> = {},
): DisDexV46PortfolioRunnerConfig {
    return {
        mode: input.mode || "paper",
        liveExecutionEnabled: input.liveExecutionEnabled === true,
        productionConfigLiveEnabled: input.productionConfigLiveEnabled === true,
        cashReservePct: Math.min(25, Math.max(0, input.cashReservePct ?? 2)),
        maxGross: Math.min(2, Math.max(0.1, input.maxGross ?? 2)),
        maxSlippageBps: Math.max(1, input.maxSlippageBps ?? 35),
        minOrderNotionalUsd: Math.max(5, input.minOrderNotionalUsd ?? 5),
        rebalanceTolerancePct: Math.min(10, Math.max(0.1, input.rebalanceTolerancePct ?? 1)),
        maxTransactionRetries: Math.max(1, input.maxTransactionRetries ?? 5),
        closeUnmanagedPositions: input.closeUnmanagedPositions !== false,
    };
}
