import { createHash, randomUUID } from "node:crypto";
import type { DirectAccountSnapshot, DirectPosition, DirectTradeCommand, DirectTradeExecutor, DirectTradeResult } from "@/lib/direct-trade-executor";
import type { LiveRunnerLock } from "@/lib/live-runner-state";
import { buildDisDexV35RebalanceActions, type DisDexV35RebalanceAction } from "@/lib/disdex-v35-portfolio-runner";
import type { DisDexV46AsterMarketDataProvider } from "@/lib/disdex-v46-market-data-provider";
import { buildDisDexV96CombinedSignal, type DisDexV96CombinedSignal } from "@/lib/disdex-v96-combined-signal";
import {
    planDisDexV96ExecutionCapacity,
    shouldSkipDisDexV96Signal,
    type DisDexV96ExecutionCapacityPlan,
} from "@/lib/disdex-v96-execution-capacity";
import { normalizeDisDexV96OrderQuantity } from "@/lib/disdex-v96-order-quantity";
import type {
    DisDexV96PendingOrder,
    DisDexV96RunnerMode,
    DisDexV96RunnerState,
    DisDexV96RunnerStateStore,
} from "@/lib/disdex-v96-runner-state";
import {
    readDisDexV96KillSwitch,
    updateDisDexV96DailyRisk,
    type DisDexV96OperatorOverrideApproval,
} from "@/lib/disdex-v96-live-risk-controls";
import { DISDEX_V96_LIVE_PROMOTION, DISDEX_V96_RUNTIME, DISDEX_V96_STRATEGY_ID } from "@/config/disdexV96Runtime";
import { disDexV96ConfigFingerprint } from "@/lib/disdex-v96-live-gates";
import { createDailyLossLedgerEntry } from "@/lib/disdex-daily-loss-ledger";

const MANAGED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"] as const;
const CORE_MANAGED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"] as const;

function legacyPenguEnabled() {
    return !/^(0|false|off|no)$/i.test(String(process.env.PENGU_LEGACY_CORE_ENABLED ?? "true").trim());
}
const ONE_TIME_ETH_SIGNAL_SKIP_REFERENCE_TS = 1785024000000;
const DEFAULT_ROUND_TRIP_FEE_BPS = 8;
const DEFAULT_MINIMUM_EXECUTION_HEADROOM_USD = 4;

export interface DisDexV96PortfolioRunnerConfig {
    mode: DisDexV96RunnerMode;
    liveGateAllowed: boolean;
    cashReservePct: number;
    maxGross: number;
    maxSlippageBps: number;
    minOrderNotionalUsd: number;
    rebalanceTolerancePct: number;
    maxTransactionRetries: number;
    closeUnmanagedPositions: boolean;
    penguTargetGrossCap?: number;
    oneTimeSkippedSignalReferenceTs?: number;
    roundTripFeeBps: number;
    minimumExecutionHeadroomUsd: number;
    maximumDailyLossPct: number;
    maximumDailyLossUsd?: number;
    killSwitchPath?: string;
    operatorOverride?: DisDexV96OperatorOverrideApproval;
    liveGateCheck?: () => Promise<{ allowed: boolean; message?: string }>;
}

export interface DisDexV96TickResult {
    status: "locked" | "held" | "no-change" | "planned" | "completed" | "failed" | "manual-review";
    message: string;
    signal?: DisDexV96CombinedSignal;
    action?: DisDexV35RebalanceAction;
    idempotencyKey?: string;
}

export interface DisDexV96RunnerLogger {
    info(message: string, payload?: Record<string, unknown>): void;
    warn(message: string, payload?: Record<string, unknown>): void;
    error(message: string, payload?: Record<string, unknown>): void;
}

export interface DisDexV96PortfolioRunnerDependencies {
    marketData: DisDexV46AsterMarketDataProvider;
    executor: DirectTradeExecutor;
    stateStore: DisDexV96RunnerStateStore;
    lock: LiveRunnerLock;
    config: DisDexV96PortfolioRunnerConfig;
    logger?: DisDexV96RunnerLogger;
    now?: () => number;
}

function defaultLogger(): DisDexV96RunnerLogger {
    return {
        info: (message, payload) => console.log(JSON.stringify({ level: "info", strategyId: DISDEX_V96_STRATEGY_ID, message, ...(payload || {}) })),
        warn: (message, payload) => console.warn(JSON.stringify({ level: "warn", strategyId: DISDEX_V96_STRATEGY_ID, message, ...(payload || {}) })),
        error: (message, payload) => console.error(JSON.stringify({ level: "error", strategyId: DISDEX_V96_STRATEGY_ID, message, ...(payload || {}) })),
    };
}

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function signedPositionQuantity(position: DirectPosition) {
    if (position.positionSide === "SHORT") return -Math.abs(position.quantity);
    if (position.positionSide === "LONG") return Math.abs(position.quantity);
    return finite(position.quantity);
}

function accountEquity(account: DirectAccountSnapshot, positions: DirectPosition[]) {
    return Math.max(0, finite(account.walletBalance) + positions.reduce((sum, position) => sum + finite(position.unrealizedPnl), 0));
}

function managedPositions(positions: DirectPosition[]) {
    return positions.filter((position) => {
        const symbol = position.symbol.toUpperCase();
        return legacyPenguEnabled()
            ? MANAGED_SYMBOLS.includes(symbol as typeof MANAGED_SYMBOLS[number])
            : CORE_MANAGED_SYMBOLS.includes(symbol as typeof CORE_MANAGED_SYMBOLS[number]);
    });
}

function corePositions(positions: DirectPosition[]) {
    return legacyPenguEnabled()
        ? positions
        : positions.filter((position) => position.symbol.toUpperCase() !== "PENGUUSDT");
}

function grossOf(position: DirectPosition) {
    return Math.abs(finite(position.notionalUsd, position.quantity * position.markPrice));
}

function filled(result: DirectTradeResult) {
    return result.status === "FILLED" && result.executedQuantity > 0;
}

function idempotencyKey(signal: DisDexV96CombinedSignal, action: DisDexV35RebalanceAction, riskReason?: string) {
    return createHash("sha256")
        .update([
            DISDEX_V96_STRATEGY_ID,
            disDexV96ConfigFingerprint(),
            signal.referenceTs,
            signal.pengu.entryTs || 0,
            signal.pengu.exitTs || 0,
            signal.pengu.side,
            action.symbol,
            action.side,
            action.reduceOnly ? "reduce" : "open",
            action.targetWeight.toFixed(8),
            (action.currentNotionalUsd / 5).toFixed(0),
            riskReason || "normal",
        ].join("|"))
        .digest("hex");
}

function clientOrderId(key: string) {
    return `${DISDEX_V96_RUNTIME.orderClientIdPrefix}${key.slice(0, 27)}`.slice(0, 36);
}

function recordFailure(state: DisDexV96RunnerState, error: unknown, now: number) {
    const message = error instanceof Error ? error.message : String(error);
    state.failures = [...state.failures, {
        occurredAt: now,
        message,
        idempotencyKey: state.pending?.idempotencyKey,
        symbol: state.pending?.symbol,
    }].slice(-100);
    return message;
}

function recordCompleted(state: DisDexV96RunnerState, pending: DisDexV96PendingOrder, result: DirectTradeResult, now: number) {
    if (state.completedExecutions.some((item) => item.idempotencyKey === pending.idempotencyKey)) return;
    state.completedExecutions = [...state.completedExecutions, {
        idempotencyKey: pending.idempotencyKey,
        clientOrderId: pending.clientOrderId,
        orderId: result.orderId,
        symbol: result.symbol || pending.symbol,
        side: result.side,
        reduceOnly: pending.reduceOnly,
        requestedQuantity: result.requestedQuantity,
        submittedQuantity: result.submittedQuantity,
        executedQuantity: result.executedQuantity,
        averagePrice: result.averagePrice,
        quoteQuantity: result.quoteQuantity,
        status: result.status,
        completedAt: now,
        referenceTs: pending.referenceTs,
    }].slice(-500);
    state.lastCompletedIdempotencyKey = pending.idempotencyKey;
    state.pending = undefined;
}

function quantityPlanIsBelowExchangeMinimum(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /below the (configured )?minimum|normalized .*quantity is zero|normalized .*notional|quantity is zero/i.test(message);
}

export class DisDexV96PortfolioRunner {
    private readonly log: DisDexV96RunnerLogger;
    private readonly now: () => number;

    constructor(private readonly dependencies: DisDexV96PortfolioRunnerDependencies) {
        this.log = dependencies.logger || defaultLogger();
        this.now = dependencies.now || Date.now;
    }

    private ensureExecutionGate() {
        if (this.dependencies.config.mode === "live" && !this.dependencies.config.liveGateAllowed) {
            throw new Error("V96 LIVE execution is blocked by Forward Evidence/Operator Override or execution-parity gates.");
        }
    }

    private async refreshRisk(
        state: DisDexV96RunnerState,
        account?: DirectAccountSnapshot,
        positions?: DirectPosition[],
    ) {
        if (this.dependencies.config.mode !== "live") return { flatten: false, reason: undefined as string | undefined };
        const [resolvedAccount, resolvedPositions, killSwitch] = await Promise.all([
            account ? Promise.resolve(account) : this.dependencies.executor.getAccountSnapshot(),
            positions ? Promise.resolve(positions) : this.dependencies.executor.getPositions(),
            readDisDexV96KillSwitch(this.dependencies.config.killSwitchPath),
        ]);
        state.dailyRisk = updateDisDexV96DailyRisk({
            previous: state.dailyRisk,
            equity: accountEquity(resolvedAccount, resolvedPositions),
            maximumDailyLossPct: this.dependencies.config.maximumDailyLossPct,
            maximumDailyLossUsd: this.dependencies.config.maximumDailyLossUsd,
            now: this.now(),
        });
        state.portfolioDailyLossLatch = state.dailyRisk;
        const currentEquity = accountEquity(resolvedAccount, resolvedPositions);
        const ledger = state.dailyLossLedger ?? [];
        state.dailyLossLedger = [...ledger, createDailyLossLedgerEntry({
            strategyId: "V96",
            realizedPnl: 0,
            unrealizedPnl: resolvedPositions.reduce((sum, row) => sum + Number(row.unrealizedPnl || 0), 0),
            commission: 0,
            funding: 0,
            deposits: 0,
            withdrawals: 0,
            startEquity: state.dailyRisk.dayStartEquity,
            currentEquity,
            unattributedDifference: currentEquity - state.dailyRisk.dayStartEquity,
        })].slice(-500);
        const override = this.dependencies.config.operatorOverride;
        if (override) {
            state.operatorOverride = {
                artifactSha256: override.artifactSha256,
                operator: override.operator,
                approvedAt: override.approvedAt,
                ...(override.expiresAt ? { expiresAt: override.expiresAt } : {}),
                approvedCommitSha: override.approvedCommitSha,
                initialPenguGrossCap: override.initialPenguGrossCap,
                maximumPortfolioGross: override.maximumPortfolioGross,
                maximumDailyLossPct: override.maximumDailyLossPct,
                maximumDailyLossUsd: override.maximumDailyLossUsd,
            };
        }
        if (killSwitch) {
            state.killSwitch = {
                active: true,
                action: killSwitch.action,
                reason: killSwitch.reason,
                operator: killSwitch.operator,
                activatedAt: killSwitch.activatedAt,
                observedAt: this.now(),
            };
        } else if (state.killSwitch?.active) {
            state.killSwitch = { ...state.killSwitch, active: false, observedAt: this.now() };
        }
        if (killSwitch) return { flatten: true, reason: `Kill Switch: ${killSwitch.reason}` };
        if (state.portfolioDailyLossLatch?.tripped || state.dailyRisk.tripped) return { flatten: true, reason: state.dailyRisk.tripReason || "V96 portfolio daily loss limit tripped." };
        return { flatten: false, reason: undefined as string | undefined };
    }

    private async reconcilePending(state: DisDexV96RunnerState): Promise<DisDexV96TickResult> {
        const pending = state.pending;
        if (!pending) return { status: "held", message: "No pending V96 order." };
        if (pending.phase === "manual_review") {
            return { status: "manual-review", message: pending.lastError || "V96 pending order requires manual review.", idempotencyKey: pending.idempotencyKey };
        }
        if (pending.phase === "planned") return this.executePending(state);
        const result = await this.dependencies.executor.reconcileOrder(pending.symbol, pending.clientOrderId);
        if (result.status === "UNKNOWN" || result.status === "NEW" || result.status === "PARTIALLY_FILLED") {
            state.forwardEvidence.unknownOrderEvents += result.status === "UNKNOWN" ? 1 : 0;
            pending.retryCount += 1;
            pending.lastError = `V96 pending order requires reconciliation/manual review (${result.status}).`;
            pending.updatedAt = this.now();
            if (pending.retryCount >= this.dependencies.config.maxTransactionRetries || result.status === "PARTIALLY_FILLED") {
                pending.phase = "manual_review";
                state.manualReviewReason = pending.lastError;
            }
            await this.dependencies.stateStore.save(state);
            return {
                status: pending.phase === "manual_review" ? "manual-review" : "held",
                message: pending.lastError,
                idempotencyKey: pending.idempotencyKey,
            };
        }
        if (!filled(result)) {
            pending.phase = "manual_review";
            pending.lastError = `V96 pending order ended with ${result.status} and no complete fill.`;
            state.manualReviewReason = pending.lastError;
            await this.dependencies.stateStore.save(state);
            return { status: "manual-review", message: pending.lastError, idempotencyKey: pending.idempotencyKey };
        }
        recordCompleted(state, pending, result, this.now());
        await this.dependencies.stateStore.save(state);
        return { status: "completed", message: `Reconciled ${pending.side} ${pending.symbol}.`, idempotencyKey: pending.idempotencyKey };
    }

    private async executePending(state: DisDexV96RunnerState): Promise<DisDexV96TickResult> {
        const pending = state.pending;
        if (!pending) return { status: "held", message: "No pending V96 order." };
        if (!pending.normalizedQuantity || pending.normalizedQuantity <= 0) {
            pending.phase = "manual_review";
            pending.lastError = "V96 pending state has no normalized Aster quantity.";
            state.manualReviewReason = pending.lastError;
            await this.dependencies.stateStore.save(state);
            return { status: "manual-review", message: pending.lastError, idempotencyKey: pending.idempotencyKey };
        }
        try {
            if (!pending.reduceOnly) {
                const risk = await this.refreshRisk(state);
                if (risk.flatten) {
                    state.pending = undefined;
                    await this.dependencies.stateStore.save(state);
                    return { status: "held", message: `${risk.reason} Planned exposure-increasing order was canceled before submission.` };
                }
            }
            pending.phase = "submitted";
            pending.updatedAt = this.now();
            await this.dependencies.stateStore.save(state);
            const command: DirectTradeCommand = {
                requestId: pending.idempotencyKey,
                clientOrderId: pending.clientOrderId,
                symbol: pending.symbol,
                side: pending.side,
                quantity: pending.normalizedQuantity,
                positionSide: "BOTH",
                reduceOnly: pending.reduceOnly,
                expectedPrice: pending.expectedPrice,
                maxSlippageBps: this.dependencies.config.maxSlippageBps,
                reason: pending.reason,
            };
            const result = await this.dependencies.executor.executeMarket(command);
            if (result.status === "UNKNOWN" || result.status === "NEW" || result.status === "PARTIALLY_FILLED") {
                state.forwardEvidence.unknownOrderEvents += result.status === "UNKNOWN" ? 1 : 0;
                pending.lastError = `V96 execution requires reconciliation/manual review (${result.status}).`;
                if (result.status === "PARTIALLY_FILLED") {
                    pending.phase = "manual_review";
                    state.manualReviewReason = pending.lastError;
                }
                await this.dependencies.stateStore.save(state);
                return { status: pending.phase === "manual_review" ? "manual-review" : "held", message: pending.lastError, idempotencyKey: pending.idempotencyKey };
            }
            if (!filled(result)) throw new Error(`V96 order was not fully filled (${result.status}).`);
            recordCompleted(state, pending, result, this.now());
            await this.dependencies.stateStore.save(state);
            this.log.info("V96 rebalance completed", {
                symbol: pending.symbol,
                side: pending.side,
                reduceOnly: pending.reduceOnly,
                executedQuantity: result.executedQuantity,
                averagePrice: result.averagePrice,
                targetWeight: pending.targetWeight,
            });
            return { status: "completed", message: `${pending.side} ${pending.symbol} completed.`, idempotencyKey: pending.idempotencyKey };
        } catch (error) {
            pending.retryCount += 1;
            pending.lastError = recordFailure(state, error, this.now());
            pending.updatedAt = this.now();
            pending.phase = pending.retryCount >= this.dependencies.config.maxTransactionRetries ? "manual_review" : "planned";
            if (pending.phase === "manual_review") state.manualReviewReason = pending.lastError;
            await this.dependencies.stateStore.save(state);
            return {
                status: pending.phase === "manual_review" ? "manual-review" : "failed",
                message: pending.lastError,
                idempotencyKey: pending.idempotencyKey,
            };
        }
    }

    async tick(): Promise<DisDexV96TickResult> {
        this.ensureExecutionGate();
        if (this.dependencies.config.mode === "live" && this.dependencies.config.liveGateCheck) {
            const gate = await this.dependencies.config.liveGateCheck();
            if (!gate.allowed) return { status: "manual-review", message: gate.message || "V96 LIVE approval gate failed during tick." };
        }
        const lock = await this.dependencies.lock.acquire(randomUUID());
        if (!lock) return { status: "locked", message: "Another V96 tick owns the runner lock." };
        try {
            const state = await this.dependencies.stateStore.load();
            state.lastRunAt = this.now();
            if (state.manualReviewReason) {
                await this.dependencies.stateStore.save(state);
                return { status: "manual-review", message: state.manualReviewReason };
            }
            if (state.pending) return await this.reconcilePending(state);

            const [history, account, positions, openOrders] = await Promise.all([
                this.dependencies.marketData.load(),
                this.dependencies.executor.getAccountSnapshot(),
                this.dependencies.executor.getPositions(),
                this.dependencies.executor.getOpenOrders(),
            ]);
            let risk: { flatten: boolean; reason?: string };
            try {
                risk = await this.refreshRisk(state, account, positions);
            } catch (error) {
                state.manualReviewReason = `V96 risk-control validation failed: ${error instanceof Error ? error.message : String(error)}`;
                await this.dependencies.stateStore.save(state);
                return { status: "manual-review", message: state.manualReviewReason };
            }
            if (state.bootstrapRequired) {
                if (this.dependencies.config.mode === "live") {
                    const initialManagedPositions = managedPositions(positions);
                    if (initialManagedPositions.length || openOrders.length) {
                        state.manualReviewReason = "Initial V96 LIVE bootstrap requires managed symbols to be flat and zero open orders.";
                        await this.dependencies.stateStore.save(state);
                        return { status: "manual-review", message: state.manualReviewReason };
                    }
                }
                state.bootstrapRequired = false;
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "V96 bootstrap completed; signal evaluation starts on the next tick." };
            }
            if (openOrders.length) {
                if (risk.flatten) {
                    state.manualReviewReason = `${risk.reason} Existing open orders prevent automatic emergency flattening.`;
                    await this.dependencies.stateStore.save(state);
                    return { status: "manual-review", message: state.manualReviewReason };
                }
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: `V96 will not rebalance while ${openOrders.length} open order(s) exist.` };
            }

            const coreOnlyPositions = corePositions(positions);
            const currentAccountEquity = accountEquity(account, positions);
            const activePenguGross = legacyPenguEnabled()
                ? 0
                : currentAccountEquity > 0
                    ? positions
                        .filter((position) => position.symbol.toUpperCase() === "PENGUUSDT")
                        .reduce((sum, position) => sum + grossOf(position), 0) / currentAccountEquity
                    : Number.POSITIVE_INFINITY;
            const effectiveMaxGross = legacyPenguEnabled()
                ? this.dependencies.config.maxGross
                : Math.max(0, this.dependencies.config.maxGross - activePenguGross);
            const signal = buildDisDexV96CombinedSignal(history, this.now(), {
                penguTargetGrossCap: legacyPenguEnabled() ? this.dependencies.config.penguTargetGrossCap : 0,
                totalGrossCap: effectiveMaxGross,
            });
            if (!risk.flatten && signal.allocation.finalGross > effectiveMaxGross + 1e-9) {
                state.forwardEvidence.grossCapBreaches += 1;
                state.manualReviewReason = `V96 Gross cap breach: ${signal.allocation.finalGross}`;
                await this.dependencies.stateStore.save(state);
                return { status: "manual-review", message: state.manualReviewReason, signal };
            }
            if (state.lastSignalReferenceTs !== signal.referenceTs) {
                state.forwardEvidence.startedAt ||= this.now();
                state.forwardEvidence.completedDecisionBars += 1;
                if (signal.pengu.side !== 0) {
                    state.forwardEvidence.minimumObservedPenguClip = Math.min(
                        state.forwardEvidence.minimumObservedPenguClip,
                        signal.allocation.penguClip,
                    );
                }
                state.forwardEvidence.lastUpdatedAt = this.now();
            }
            state.lastSignalReferenceTs = signal.referenceTs;

            const activeManagedPositions = managedPositions(positions);
            if (risk.flatten && activeManagedPositions.length === 0) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: `${risk.reason} No managed position remains open.`, signal };
            }
            const quoteSymbols = new Set<string>([
                ...(legacyPenguEnabled() ? MANAGED_SYMBOLS : CORE_MANAGED_SYMBOLS),
                ...(this.dependencies.config.closeUnmanagedPositions ? coreOnlyPositions.map((position) => position.symbol.toUpperCase()) : []),
            ]);
            const quotes = Object.fromEntries(await Promise.all(
                [...quoteSymbols].map(async (symbol) => [symbol, await this.dependencies.executor.getMarketQuote(symbol)]),
            ));
            const targetWeights = risk.flatten ? {} : signal.targetWeights;
            const rebalance = buildDisDexV35RebalanceActions({
                account,
                positions: coreOnlyPositions,
                quotes,
                targetWeights,
                config: {
                    cashReservePct: this.dependencies.config.cashReservePct,
                    maxGross: effectiveMaxGross,
                    minOrderNotionalUsd: this.dependencies.config.minOrderNotionalUsd,
                    rebalanceTolerancePct: this.dependencies.config.rebalanceTolerancePct,
                    closeUnmanagedPositions: this.dependencies.config.closeUnmanagedPositions,
                },
            });
            if (!rebalance.actions.length) {
                await this.dependencies.stateStore.save(state);
                return {
                    status: "no-change",
                    message: risk.flatten
                        ? `${risk.reason} Emergency flatten target is already satisfied.`
                        : `V96 portfolio is within ${rebalance.tolerance.toFixed(2)} USD tolerance.`,
                    signal,
                };
            }
            let action = rebalance.actions[0];
            if (risk.flatten && !action.reduceOnly) {
                state.manualReviewReason = "V96 risk invariant violation: emergency action was not reduce-only.";
                await this.dependencies.stateStore.save(state);
                return { status: "manual-review", message: state.manualReviewReason, signal, action };
            }
            if (!risk.flatten && shouldSkipDisDexV96Signal({
                configuredReferenceTs: this.dependencies.config.oneTimeSkippedSignalReferenceTs,
                signalReferenceTs: signal.referenceTs,
                symbol: action.symbol,
                side: action.side,
                reduceOnly: action.reduceOnly,
            })) {
                state.skippedSignalReferenceTs = signal.referenceTs;
                await this.dependencies.stateStore.save(state);
                this.log.warn("V96 stale ETH signal was formally skipped", {
                    referenceTs: signal.referenceTs,
                    symbol: action.symbol,
                    side: action.side,
                    alreadyRecorded: state.skippedSignalReferenceTs === signal.referenceTs,
                });
                return {
                    status: "held",
                    message: `ETHUSDT BUY referenceTs=${signal.referenceTs} is the explicitly skipped stale signal; no order was sent.`,
                    signal,
                    action,
                };
            }
            const position = positions.find((item) => item.symbol.toUpperCase() === action.symbol);
            const signedQuantity = position ? signedPositionQuantity(position) : 0;
            if (signedQuantity !== 0 && action.targetWeight !== 0 && Math.sign(signedQuantity) !== Math.sign(action.targetWeight) && !action.reduceOnly) {
                throw new Error("V96 invariant violation: direction changes must close reduce-only before opening the opposite side.");
            }

            let capacityPlan: DisDexV96ExecutionCapacityPlan;
            try {
                capacityPlan = planDisDexV96ExecutionCapacity({
                    account,
                    positions,
                    managedPositions: activeManagedPositions,
                    action,
                    config: {
                        cashReservePct: this.dependencies.config.cashReservePct,
                        maxGross: effectiveMaxGross,
                        maxSlippageBps: this.dependencies.config.maxSlippageBps,
                        minOrderNotionalUsd: this.dependencies.config.minOrderNotionalUsd,
                        roundTripFeeBps: this.dependencies.config.roundTripFeeBps,
                        minimumExecutionHeadroomUsd: this.dependencies.config.minimumExecutionHeadroomUsd,
                    },
                });
            } catch (error) {
                state.manualReviewReason = `V96 execution-capacity validation failed: ${error instanceof Error ? error.message : String(error)}`;
                await this.dependencies.stateStore.save(state);
                return { status: "manual-review", message: state.manualReviewReason, signal, action };
            }
            action = capacityPlan.action;
            if (capacityPlan.blockedReason) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: `${capacityPlan.blockedReason} No order was sent.`, signal, action };
            }
            const key = idempotencyKey(signal, action, risk.reason);
            if (state.lastCompletedIdempotencyKey === key) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "The same V96 rebalance action was already completed.", signal, action, idempotencyKey: key };
            }

            let quantityPlan;
            try {
                quantityPlan = await normalizeDisDexV96OrderQuantity({
                    executor: this.dependencies.executor,
                    symbol: action.symbol,
                    side: action.side,
                    quote: quotes[action.symbol],
                    deltaNotionalUsd: action.deltaNotionalUsd,
                    minimumOrderNotionalUsd: this.dependencies.config.minOrderNotionalUsd,
                    reduceOnly: action.reduceOnly,
                    currentPositionQuantity: position ? signedPositionQuantity(position) : undefined,
                });
            } catch (error) {
                if (quantityPlanIsBelowExchangeMinimum(error)) {
                    await this.dependencies.stateStore.save(state);
                    return {
                        status: "held",
                        message: `${error instanceof Error ? error.message : String(error)} No order was sent.`,
                        signal,
                        action,
                        idempotencyKey: key,
                    };
                }
                throw error;
            }
            const pending: DisDexV96PendingOrder = {
                idempotencyKey: key,
                clientOrderId: clientOrderId(key),
                phase: "planned",
                symbol: action.symbol,
                side: action.side,
                requestedQuantity: quantityPlan.requestedQuantity,
                normalizedQuantity: quantityPlan.normalized.quantity,
                reduceOnly: action.reduceOnly,
                expectedPrice: quantityPlan.referencePrice,
                targetWeight: action.targetWeight,
                targetNotionalUsd: action.targetNotionalUsd,
                deltaNotionalUsd: action.deltaNotionalUsd,
                referenceTs: signal.referenceTs,
                createdAt: this.now(),
                updatedAt: this.now(),
                retryCount: 0,
                reason: `${DISDEX_V96_STRATEGY_ID}: ${risk.reason || action.reason} coreScale=${signal.allocation.coreScale.toFixed(6)} penguSide=${signal.pengu.side} penguClip=${signal.allocation.penguClip.toFixed(6)} penguGrossCap=${signal.penguGrossCapApplied.toFixed(6)} signalTargetWeight=${capacityPlan.signalTargetWeight.toFixed(6)} executionTargetWeight=${capacityPlan.executionTargetWeight.toFixed(6)} executionScale=${capacityPlan.executionScale.toFixed(6)}`,
            };
            state.pending = pending;
            await this.dependencies.stateStore.save(state);
            this.log.info("V96 rebalance planned", {
                referenceTs: signal.referenceTs,
                symbol: action.symbol,
                side: action.side,
                reduceOnly: action.reduceOnly,
                signalTargetWeight: capacityPlan.signalTargetWeight,
                executionTargetWeight: capacityPlan.executionTargetWeight,
                executionScale: capacityPlan.executionScale,
                requestedIncreaseUsd: capacityPlan.requestedIncreaseUsd,
                executableIncreaseUsd: capacityPlan.executableIncreaseUsd,
                availableBalanceUsd: capacityPlan.reportedAvailableBalanceUsd,
                requiredInitialMarginUsd: capacityPlan.requiredInitialMarginUsd,
                cashReserveUsd: capacityPlan.cashReserveUsd,
                estimatedCostHeadroomUsd: capacityPlan.estimatedCostHeadroomUsd,
                protectedCashUsd: capacityPlan.protectedCashUsd,
                projectedManagedGross: capacityPlan.projectedManagedGross,
                requestedQuantity: pending.requestedQuantity,
                normalizedQuantity: pending.normalizedQuantity,
                coreScale: signal.allocation.coreScale,
                penguClip: signal.allocation.penguClip,
                penguGrossCap: signal.penguGrossCapApplied,
                riskReason: risk.reason,
            });
            const result = await this.executePending(state);
            return { ...result, signal, action, idempotencyKey: key };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log.error("V96 runner tick failed", { message });
            return { status: /manual review/i.test(message) ? "manual-review" : "failed", message };
        } finally {
            await lock.release();
        }
    }
}

export function buildDefaultDisDexV96RunnerConfig(
    input: Partial<DisDexV96PortfolioRunnerConfig> = {},
): DisDexV96PortfolioRunnerConfig {
    return {
        mode: input.mode || "paper",
        liveGateAllowed: input.liveGateAllowed === true,
        cashReservePct: Math.min(25, Math.max(0, input.cashReservePct ?? DISDEX_V96_RUNTIME.cashReservePct)),
        maxGross: Math.min(DISDEX_V96_RUNTIME.maximumGross, Math.max(0.1, input.maxGross ?? DISDEX_V96_RUNTIME.maximumGross)),
        maxSlippageBps: Math.max(1, input.maxSlippageBps ?? DISDEX_V96_RUNTIME.maximumSlippageBps),
        minOrderNotionalUsd: Math.max(5, input.minOrderNotionalUsd ?? DISDEX_V96_RUNTIME.minimumOrderNotionalUsd),
        rebalanceTolerancePct: Math.min(10, Math.max(0.1, input.rebalanceTolerancePct ?? DISDEX_V96_RUNTIME.rebalanceTolerancePct)),
        maxTransactionRetries: Math.max(1, input.maxTransactionRetries ?? 3),
        closeUnmanagedPositions: input.closeUnmanagedPositions === true,
        penguTargetGrossCap: input.penguTargetGrossCap,
        oneTimeSkippedSignalReferenceTs: Number.isFinite(Number(input.oneTimeSkippedSignalReferenceTs))
            ? Number(input.oneTimeSkippedSignalReferenceTs)
            : ONE_TIME_ETH_SIGNAL_SKIP_REFERENCE_TS,
        roundTripFeeBps: Math.max(0, input.roundTripFeeBps ?? DEFAULT_ROUND_TRIP_FEE_BPS),
        minimumExecutionHeadroomUsd: Math.max(0, input.minimumExecutionHeadroomUsd ?? DEFAULT_MINIMUM_EXECUTION_HEADROOM_USD),
        maximumDailyLossPct: Math.min(
            DISDEX_V96_LIVE_PROMOTION.maximumDailyLossPct,
            Math.max(0.1, input.maximumDailyLossPct ?? DISDEX_V96_LIVE_PROMOTION.maximumDailyLossPct),
        ),
        maximumDailyLossUsd: input.maximumDailyLossUsd && input.maximumDailyLossUsd > 0 ? input.maximumDailyLossUsd : undefined,
        killSwitchPath: input.killSwitchPath,
        operatorOverride: input.operatorOverride,
    };
}
