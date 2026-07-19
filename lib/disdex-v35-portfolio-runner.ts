import { createHash, randomUUID } from "node:crypto";
import type { AsterOrderSide } from "@/lib/aster-v3-client";
import type {
    DirectAccountSnapshot,
    DirectMarketQuote,
    DirectPosition,
    DirectTradeCommand,
    DirectTradeExecutor,
    DirectTradeResult,
} from "@/lib/direct-trade-executor";
import type { LiveRunnerLock } from "@/lib/live-runner-state";
import { buildDisDexV35Signal, type DisDexPenguRule, type DisDexV35SignalResult, type DisDexV35Symbol } from "@/lib/disdex-v35-signal-engine";
import type { DisDexV35AsterMarketDataProvider } from "@/lib/disdex-v35-market-data-provider";
import type {
    DisDexV35PendingOrder,
    DisDexV35RunnerMode,
    DisDexV35RunnerState,
    DisDexV35RunnerStateStore,
} from "@/lib/disdex-v35-runner-state";

const MANAGED_SYMBOLS: DisDexV35Symbol[] = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"];

export interface DisDexV35PortfolioRunnerConfig {
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
    penguRule: DisDexPenguRule;
}

export interface DisDexV35RunnerLogger {
    info(message: string, payload?: Record<string, unknown>): void;
    warn(message: string, payload?: Record<string, unknown>): void;
    error(message: string, payload?: Record<string, unknown>): void;
}

export interface DisDexV35PortfolioRunnerDependencies {
    marketData: DisDexV35AsterMarketDataProvider;
    executor: DirectTradeExecutor;
    stateStore: DisDexV35RunnerStateStore;
    lock: LiveRunnerLock;
    config: DisDexV35PortfolioRunnerConfig;
    logger?: DisDexV35RunnerLogger;
    now?: () => number;
}

export interface DisDexV35RebalanceAction {
    symbol: string;
    side: AsterOrderSide;
    quantity: number;
    reduceOnly: boolean;
    currentNotionalUsd: number;
    targetNotionalUsd: number;
    targetWeight: number;
    expectedPrice: number;
    deltaNotionalUsd: number;
    reason: string;
}

export interface DisDexV35TickResult {
    status: "locked" | "held" | "no-change" | "planned" | "completed" | "failed" | "manual-review";
    message: string;
    signal?: DisDexV35SignalResult;
    action?: DisDexV35RebalanceAction;
    idempotencyKey?: string;
}

function logger(): DisDexV35RunnerLogger {
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

function signedPositionQuantity(position: DirectPosition) {
    if (position.positionSide === "SHORT") return -Math.abs(position.quantity);
    if (position.positionSide === "LONG") return Math.abs(position.quantity);
    return finite(position.quantity);
}

function quotePrice(quote: DirectMarketQuote, side: AsterOrderSide) {
    return side === "BUY" ? quote.askPrice : quote.bidPrice;
}

function scaleTargetWeights(
    targetWeights: Partial<Record<DisDexV35Symbol, number>>,
    maxGross: number,
) {
    const rawGross = Object.values(targetWeights).reduce((sum, value) => sum + Math.abs(finite(value)), 0);
    const scale = rawGross > maxGross && rawGross > 0 ? maxGross / rawGross : 1;
    return Object.fromEntries(
        Object.entries(targetWeights).map(([symbol, weight]) => [symbol, finite(weight) * scale]),
    ) as Partial<Record<DisDexV35Symbol, number>>;
}

export function buildDisDexV35RebalanceActions(input: {
    account: DirectAccountSnapshot;
    positions: DirectPosition[];
    quotes: Record<string, DirectMarketQuote>;
    targetWeights: Partial<Record<DisDexV35Symbol, number>>;
    config: Pick<DisDexV35PortfolioRunnerConfig, "cashReservePct" | "maxGross" | "minOrderNotionalUsd" | "rebalanceTolerancePct" | "closeUnmanagedPositions">;
}) {
    const equity = Math.max(0, finite(input.account.walletBalance) + input.positions.reduce((sum, position) => sum + finite(position.unrealizedPnl), 0));
    const investableEquity = equity * Math.max(0, 1 - input.config.cashReservePct / 100);
    const targetWeights = scaleTargetWeights(input.targetWeights, input.config.maxGross);
    const positionMap = new Map(input.positions.map((position) => [position.symbol.toUpperCase(), position]));
    const symbolSet = new Set<string>([...MANAGED_SYMBOLS, ...Object.keys(targetWeights)]);
    if (input.config.closeUnmanagedPositions) {
        for (const position of input.positions) symbolSet.add(position.symbol.toUpperCase());
    }
    const tolerance = Math.max(input.config.minOrderNotionalUsd, equity * input.config.rebalanceTolerancePct / 100);
    const actions: DisDexV35RebalanceAction[] = [];
    for (const symbol of symbolSet) {
        const position = positionMap.get(symbol);
        const quote = input.quotes[symbol];
        if (!quote) continue;
        const isManaged = MANAGED_SYMBOLS.includes(symbol as DisDexV35Symbol);
        if (!isManaged && !input.config.closeUnmanagedPositions) continue;
        const targetWeight = isManaged ? finite(targetWeights[symbol as DisDexV35Symbol]) : 0;
        const targetNotionalUsd = investableEquity * targetWeight;
        const currentQuantity = position ? signedPositionQuantity(position) : 0;
        const currentNotionalUsd = currentQuantity * quote.midPrice;
        const signFlip = currentQuantity !== 0 && targetNotionalUsd !== 0 && Math.sign(currentQuantity) !== Math.sign(targetNotionalUsd);
        let deltaQuantity: number;
        let reduceOnly: boolean;
        let reason: string;
        if (signFlip) {
            deltaQuantity = -currentQuantity;
            reduceOnly = true;
            reason = "Close the existing side with reduce-only before opening the opposite V35 target.";
        } else {
            const desiredQuantity = quote.midPrice > 0 ? targetNotionalUsd / quote.midPrice : 0;
            deltaQuantity = desiredQuantity - currentQuantity;
            reduceOnly = currentQuantity !== 0
                && (targetNotionalUsd === 0 || Math.abs(desiredQuantity) < Math.abs(currentQuantity))
                && Math.sign(deltaQuantity) === -Math.sign(currentQuantity);
            reason = reduceOnly
                ? "Reduce the current position toward the V35 target."
                : "Open or increase the position toward the V35 target.";
        }
        const deltaNotionalUsd = deltaQuantity * quote.midPrice;
        if (Math.abs(deltaNotionalUsd) + 1e-9 < tolerance) continue;
        if (reduceOnly && position) {
            deltaQuantity = Math.sign(deltaQuantity) * Math.min(Math.abs(deltaQuantity), Math.abs(currentQuantity));
        }
        if (Math.abs(deltaQuantity) <= 1e-12) continue;
        const side: AsterOrderSide = deltaQuantity > 0 ? "BUY" : "SELL";
        actions.push({
            symbol,
            side,
            quantity: Math.abs(deltaQuantity),
            reduceOnly,
            currentNotionalUsd,
            targetNotionalUsd,
            targetWeight,
            expectedPrice: quotePrice(quote, side),
            deltaNotionalUsd,
            reason,
        });
    }
    actions.sort((left, right) => {
        if (left.reduceOnly !== right.reduceOnly) return left.reduceOnly ? -1 : 1;
        return Math.abs(right.deltaNotionalUsd) - Math.abs(left.deltaNotionalUsd);
    });
    return { equity, investableEquity, targetWeights, tolerance, actions };
}

function clientOrderId(key: string) {
    return `v35-${createHash("sha256").update(key).digest("hex").slice(0, 27)}`.slice(0, 36);
}

function idempotencyKey(signal: DisDexV35SignalResult, action: DisDexV35RebalanceAction) {
    return createHash("sha256")
        .update([
            signal.strategyId,
            signal.referenceTs,
            signal.penguEntryTs || 0,
            action.symbol,
            action.side,
            action.reduceOnly ? "reduce" : "open",
            action.targetWeight.toFixed(6),
            (action.currentNotionalUsd / 5).toFixed(0),
        ].join("|"))
        .digest("hex");
}

export class DisDexV35PortfolioRunner {
    private readonly log: DisDexV35RunnerLogger;
    private readonly now: () => number;

    constructor(private readonly dependencies: DisDexV35PortfolioRunnerDependencies) {
        this.log = dependencies.logger || logger();
        this.now = dependencies.now || Date.now;
    }

    private ensureLiveGate() {
        const config = this.dependencies.config;
        if (config.mode !== "live") return;
        if (!config.liveExecutionEnabled || !config.productionConfigLiveEnabled) {
            throw new Error("V35 live runner is locked. Both DISDEX_V35_LIVE_EXECUTION_ENABLED=true and the production V35 live flag are required.");
        }
    }

    private failure(state: DisDexV35RunnerState, error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        state.failures = [...state.failures, {
            occurredAt: this.now(),
            message,
            idempotencyKey: state.pending?.idempotencyKey,
            symbol: state.pending?.symbol,
        }].slice(-100);
        return message;
    }

    private async reconcilePending(state: DisDexV35RunnerState): Promise<DisDexV35TickResult> {
        const pending = state.pending;
        if (!pending) return { status: "held", message: "No pending V35 order." };
        if (pending.phase === "manual_review") {
            return { status: "manual-review", message: pending.lastError || "V35 pending order requires manual review.", idempotencyKey: pending.idempotencyKey };
        }
        if (pending.phase === "planned") return this.executePending(state);
        const result = await this.dependencies.executor.reconcileOrder(pending.symbol, pending.clientOrderId);
        if (result.status === "UNKNOWN") {
            pending.retryCount += 1;
            pending.lastError = result.error || "V35 order status remains unknown.";
            pending.updatedAt = this.now();
            if (pending.retryCount >= this.dependencies.config.maxTransactionRetries) pending.phase = "manual_review";
            await this.dependencies.stateStore.save(state);
            return {
                status: pending.phase === "manual_review" ? "manual-review" : "held",
                message: pending.lastError,
                idempotencyKey: pending.idempotencyKey,
            };
        }
        if (!orderFilled(result)) {
            throw new Error(`V35 pending order ended with ${result.status} and no fill.`);
        }
        state.lastCompletedIdempotencyKey = pending.idempotencyKey;
        state.pending = undefined;
        await this.dependencies.stateStore.save(state);
        return { status: "completed", message: `Reconciled ${pending.side} ${pending.symbol}.`, idempotencyKey: pending.idempotencyKey };
    }

    private async executePending(state: DisDexV35RunnerState): Promise<DisDexV35TickResult> {
        const pending = state.pending;
        if (!pending) return { status: "held", message: "No pending V35 order." };
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
                pending.lastError = result.error || "V35 order execution is unknown.";
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: pending.lastError, idempotencyKey: pending.idempotencyKey };
            }
            if (!orderFilled(result)) throw new Error(`V35 order was not filled (${result.status}).`);
            state.lastCompletedIdempotencyKey = pending.idempotencyKey;
            state.pending = undefined;
            await this.dependencies.stateStore.save(state);
            this.log.info("V35 order completed", {
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
            pending.lastError = this.failure(state, error);
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

    async tick(): Promise<DisDexV35TickResult> {
        this.ensureLiveGate();
        const ownerId = randomUUID();
        const lock = await this.dependencies.lock.acquire(ownerId);
        if (!lock) return { status: "locked", message: "Another V35 tick owns the execution lock." };
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
            if (openOrders.length) {
                return { status: "held", message: `V35 will not rebalance while ${openOrders.length} open order(s) exist.` };
            }
            const signal = buildDisDexV35Signal(history, this.dependencies.config.penguRule, this.now());
            const quoteSymbols = new Set<string>([
                ...MANAGED_SYMBOLS,
                ...(this.dependencies.config.closeUnmanagedPositions ? positions.map((position) => position.symbol.toUpperCase()) : []),
            ]);
            const quotes = Object.fromEntries(await Promise.all([...quoteSymbols].map(async (symbol) => [symbol, await this.dependencies.executor.getMarketQuote(symbol)])));
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
                return { status: "no-change", message: `V35 portfolio is within ${rebalance.tolerance.toFixed(2)} USD tolerance.`, signal };
            }
            const action = rebalance.actions[0];
            const key = idempotencyKey(signal, action);
            if (state.lastCompletedIdempotencyKey === key) {
                return { status: "held", message: "The same V35 rebalance action was already completed.", signal, action, idempotencyKey: key };
            }
            if (Math.abs(action.deltaNotionalUsd) < this.dependencies.config.minOrderNotionalUsd) {
                return { status: "held", message: "V35 rebalance action is below minimum notional.", signal, action };
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
                reason: `${signal.strategyId}: ${action.reason} state=${signal.allocation.state} targetWeight=${action.targetWeight.toFixed(6)}`,
            };
            state.pending = pending;
            await this.dependencies.stateStore.save(state);
            this.log.info("V35 rebalance planned", {
                signalReferenceTs: signal.referenceTs,
                regime: signal.regime,
                state: signal.allocation.state,
                symbol: action.symbol,
                side: action.side,
                reduceOnly: action.reduceOnly,
                targetWeight: action.targetWeight,
                currentNotionalUsd: action.currentNotionalUsd,
                targetNotionalUsd: action.targetNotionalUsd,
                mode: this.dependencies.config.mode,
            });
            const result = await this.executePending(state);
            return { ...result, signal, action, idempotencyKey: key };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log.error("V35 runner tick failed", { message });
            return { status: /manual review/i.test(message) ? "manual-review" : "failed", message };
        } finally {
            await lock.release();
        }
    }
}

export function buildDefaultDisDexV35RunnerConfig(input: Partial<DisDexV35PortfolioRunnerConfig> & { penguRule: DisDexPenguRule }): DisDexV35PortfolioRunnerConfig {
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
        penguRule: input.penguRule,
    };
}
