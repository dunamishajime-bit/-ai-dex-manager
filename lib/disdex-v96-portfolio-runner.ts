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
      