import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
import {
    buildPenguDualLsV2Signal,
    type PenguDualLsV2History,
    type PenguDualLsV2Position,
    type PenguDualLsV2Signal,
} from "@/lib/pengu-dual-ls-v2";
import type {
    PenguDualLsV2PendingOrder,
    PenguDualLsV2RunnerState,
    PenguDualLsV2RunnerStateStore,
} from "@/lib/pengu-dual-ls-v2-runner-state";
import type { PenguDualLsV2Mode } from "@/config/penguDualLsV2Runtime";
import { readDisDexV96KillSwitch } from "@/lib/disdex-v96-live-risk-controls";
import { readSharedCryptoDailyRisk } from "@/lib/disdex-shared-crypto-daily-risk";
import { createPenguShortV20State } from "@/lib/pengu-short-v20";
import {
    placeRecoveryV8EntryHardStop,
    replaceRecoveryV8Stops,
    type RecoveryV8ProtectiveOrderGateway,
} from "@/lib/pengu-recovery-v8-protective-orders";

const SYMBOL = "PENGUUSDT";

export interface PenguDualLsV2PortfolioRunnerConfig {
    mode: PenguDualLsV2Mode;
    enabled: boolean;
    liveExecutionEnabled: boolean;
    productionConfigLiveEnabled: boolean;
    maximumGross: number;
    longGross: number;
    shortGross: number;
    cashReservePct: number;
    maxSlippageBps: number;
    minimumOrderNotionalUsd: number;
    maxTransactionRetries: number;
    maximumEntryDelayMs: number;
    portfolioGrossCap: number;
    maximumDailyLossPct: number;
    killSwitchPath?: string;
    portfolioDailyLossStatePath?: string;
    recoveryV8Enabled?: boolean;
}

export interface PenguDualLsV2RunnerLogger {
    info(message: string, payload?: Record<string, unknown>): void;
    warn(message: string, payload?: Record<string, unknown>): void;
    error(message: string, payload?: Record<string, unknown>): void;
}

export interface PenguDualLsV2PortfolioRunnerDependencies {
    marketData: { load(force?: boolean): Promise<PenguDualLsV2History> };
    executor: DirectTradeExecutor;
    stateStore: PenguDualLsV2RunnerStateStore;
    lock: LiveRunnerLock;
    config: PenguDualLsV2PortfolioRunnerConfig;
    logger?: PenguDualLsV2RunnerLogger;
    now?: () => number;
    recoveryV8Protection?: RecoveryV8ProtectiveOrderGateway;
}

export interface PenguDualLsV2TickResult {
    status: "disabled" | "locked" | "shadow" | "held" | "no-change" | "planned" | "completed" | "failed" | "manual-review";
    message: string;
    signal?: PenguDualLsV2Signal;
    idempotencyKey?: string;
}

function defaultLogger(): PenguDualLsV2RunnerLogger {
    return {
        info: (message, payload) => console.log(JSON.stringify({ level: "info", message, ...(payload || {}) })),
        warn: (message, payload) => console.warn(JSON.stringify({ level: "warn", message, ...(payload || {}) })),
        error: (message, payload) => console.error(JSON.stringify({ level: "error", message, ...(payload || {}) })),
    };
}

function finite(value: unknown, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function filled(result: DirectTradeResult) {
    return result.status === "FILLED" && result.executedQuantity > 0;
}

function positionSide(position: DirectPosition): -1 | 1 {
    if (position.positionSide === "SHORT") return -1;
    if (position.positionSide === "LONG") return 1;
    return position.quantity < 0 ? -1 : 1;
}

function orderIdempotency(signal: PenguDualLsV2Signal, side: AsterOrderSide, reduceOnly: boolean, quantity: number) {
    return createHash("sha256")
        .update([signal.strategyId, signal.referenceTs, signal.entryTs || 0, signal.side, side, reduceOnly ? "reduce" : "entry", quantity.toFixed(12)].join("|"))
        .digest("hex");
}

function clientOrderId(idempotencyKey: string) {
    return `dualls2-${idempotencyKey}`.slice(0, 36);
}

function actualPosition(positions: DirectPosition[]) {
    return positions.find((position) => position.symbol.toUpperCase() === SYMBOL && Math.abs(position.quantity) > 1e-12);
}

function grossOf(position: DirectPosition) {
    return Math.abs(finite(position.notionalUsd, position.quantity * position.markPrice));
}

export function normalizedPositionGross(positions: DirectPosition[], equity: number, excludedSymbol?: string) {
    if (!(equity > 0)) return Number.POSITIVE_INFINITY;
    return positions
        .filter((position) => !excludedSymbol || position.symbol.toUpperCase() !== excludedSymbol.toUpperCase())
        .reduce((sum, position) => sum + grossOf(position), 0) / equity;
}

async function readPortfolioDailyLoss(pathValue?: string) {
    if (!pathValue) return false;
    try {
        const raw = JSON.parse(await readFile(pathValue, "utf8")) as Record<string, unknown>;
        const candidate = raw.portfolioDailyLossLatch && typeof raw.portfolioDailyLossLatch === "object"
            ? raw.portfolioDailyLossLatch
            : raw.dailyRisk && typeof raw.dailyRisk === "object"
                ? raw.dailyRisk
                : raw;
        return Boolean(candidate && typeof candidate === "object" && (candidate as { tripped?: unknown }).tripped === true);
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code === "ENOENT") return false;
        throw error;
    }
}

function statePositionFromActual(actual: DirectPosition, previous?: PenguDualLsV2Position): PenguDualLsV2Position {
    const side = positionSide(actual);
    return {
        side,
        entryTs: previous?.entryTs || actual.updatedAt || Date.now(),
        entryPrice: actual.entryPrice,
        quantity: Math.abs(actual.quantity),
        gross: previous?.recoveryV8?.partialDefenseTriggered ? 0.25 : previous?.gross || 0,
        highWaterMark: side > 0 ? Math.max(previous?.highWaterMark || actual.entryPrice, actual.markPrice) : previous?.highWaterMark || actual.markPrice,
        lowWaterMark: side < 0 ? Math.min(previous?.lowWaterMark || actual.entryPrice, actual.markPrice) : previous?.lowWaterMark || actual.markPrice,
        entryVersion: previous?.entryVersion || "LEGACY_V2",
        shortV20: previous?.shortV20,
        recoveryV8: previous?.recoveryV8
            ? {
                ...previous.recoveryV8,
                entryTs: previous.entryTs || actual.updatedAt || Date.now(),
                entryPrice: actual.entryPrice,
                quantity: Math.abs(actual.quantity),
                highWaterMark: side > 0 ? Math.max(previous.recoveryV8.highWaterMark, actual.markPrice) : previous.recoveryV8.highWaterMark,
            }
            : undefined,
    };
}

export class PenguDualLsV2PortfolioRunner {
    private readonly log: PenguDualLsV2RunnerLogger;
    private readonly now: () => number;

    constructor(private readonly dependencies: PenguDualLsV2PortfolioRunnerDependencies) {
        this.log = dependencies.logger || defaultLogger();
        this.now = dependencies.now || Date.now;
    }

    private ensureLiveGate() {
        const config = this.dependencies.config;
        if (config.mode !== "LIVE") return;
        if (!config.enabled || !config.liveExecutionEnabled || !config.productionConfigLiveEnabled) {
            throw new Error("PENGU_DUAL_LS_V2_FINAL LIVE is locked: enabled, runtime and production execution gates are all required.");
        }
    }

    private async sharedRiskReason() {
        if (this.dependencies.config.mode !== "LIVE") return undefined;
        const killSwitch = await readDisDexV96KillSwitch(this.dependencies.config.killSwitchPath);
        if (killSwitch) return `Shared Kill Switch: ${killSwitch.reason}`;
        const sharedPath = this.dependencies.config.portfolioDailyLossStatePath || process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH;
        if (sharedPath) {
            const validation = await readSharedCryptoDailyRisk(sharedPath);
            if (!validation.ok) return `Shared crypto daily-risk state blocked PENGU entry: ${validation.reason}.`;
        }
        const dailyLossTripped = await readPortfolioDailyLoss(this.dependencies.config.portfolioDailyLossStatePath);
        if (dailyLossTripped) return `Shared crypto daily loss latch is active at ${this.dependencies.config.maximumDailyLossPct}%.`;
        return undefined;
    }

    private recordFailure(state: PenguDualLsV2RunnerState, error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        state.failures = [...state.failures, { occurredAt: this.now(), message, idempotencyKey: state.pending?.idempotencyKey }].slice(-100);
        return message;
    }

    private async reconcileRecoveryV8PartialFill(state: PenguDualLsV2RunnerState, actual: DirectPosition) {
        const position = state.position;
        const recovery = position?.recoveryV8;
        const gateway = this.dependencies.recoveryV8Protection;
        if (!position || position.entryVersion !== "RECOVERY_V8" || !recovery || recovery.partialDefenseTriggered || !gateway?.getOrder || !recovery.partialStopClientOrderId) return false;
        const previousQuantity = position.quantity;
        const actualQuantity = Math.abs(actual.quantity);
        if (positionSide(actual) !== 1) throw new Error("PENGU Recovery V8 partial reconciliation found a non-Long position.");
        const expectedFilled = previousQuantity * 0.5;
        const observedFilled = previousQuantity - actualQuantity;
        if (!(observedFilled > 0) || Math.abs(observedFilled - expectedFilled) > Math.max(1e-8, previousQuantity * 0.01)) return false;
        const order = await gateway.getOrder(SYMBOL, recovery.partialStopClientOrderId);
        if (!/^FILLED$/i.test(order.status) || Math.abs((order.executedQuantity || 0) - observedFilled) > Math.max(1e-8, previousQuantity * 0.01)) {
            throw new Error("PENGU Recovery V8 partial stop fill is not fully reconciled; manual review required.");
        }
        const triggerPrice = position.entryPrice * (1 - 0.04);
        const averagePrice = Number(order.averagePrice || 0);
        if (!(averagePrice > 0)) throw new Error("PENGU Recovery V8 partial stop fill has no average price.");
        state.position = {
            ...position,
            quantity: actualQuantity,
            gross: 0.25,
            recoveryV8: {
                ...recovery,
                quantity: actualQuantity,
                remainingGross: 0.25,
                partialDefenseTriggered: true,
                actualPartialFill: {
                    filledAtTs: this.now(),
                    executedQuantity: observedFilled,
                    averagePrice,
                    triggerPrice,
                    slippageBps: (averagePrice / triggerPrice - 1) * 10_000,
                    orderId: order.orderId,
                    clientOrderId: order.clientOrderId,
                },
            },
        };
        return true;
    }

    private async applyResult(state: PenguDualLsV2RunnerState, pending: PenguDualLsV2PendingOrder, result: DirectTradeResult): Promise<PenguDualLsV2TickResult> {
        if (result.status === "UNKNOWN") {
            pending.phase = "manual_review";
            pending.lastError = result.error || "PENGU Dual LS order status is UNKNOWN.";
            pending.updatedAt = this.now();
            await this.dependencies.stateStore.save(state);
            return { status: "manual-review", message: pending.lastError, idempotencyKey: pending.idempotencyKey };
        }
        if (!filled(result)) {
            pending.phase = "manual_review";
            pending.lastError = `PENGU Dual LS order ended with ${result.status}; no blind retry is allowed.`;
            pending.updatedAt = this.now();
            await this.dependencies.stateStore.save(state);
            return { status: "manual-review", message: pending.lastError, idempotencyKey: pending.idempotencyKey };
        }
        if (pending.reduceOnly) {
            state.position = undefined;
            state.cooldownUntilTs = pending.referenceTs + 6 * 3_600_000;
        } else {
            const entryPrice = result.averagePrice || pending.expectedPrice;
            const isRecoveryV8 = pending.entryVersion === "RECOVERY_V8";
            state.position = {
                side: pending.side === "BUY" ? 1 : -1,
                entryTs: pending.referenceTs + 3_600_000,
                entryPrice,
                quantity: result.executedQuantity,
                gross: pending.targetGross,
                highWaterMark: entryPrice,
                lowWaterMark: entryPrice,
                entryVersion: pending.entryVersion || "LEGACY_V2",
                shortV20: pending.shortV20Seed
                    ? createPenguShortV20State({ entryPrice, ...pending.shortV20Seed })
                    : undefined,
                recoveryV8: isRecoveryV8
                    ? {
                        version: "RECOVERY_V8",
                        side: 1,
                        entryTs: pending.referenceTs + 3_600_000,
                        entryPrice,
                        quantity: result.executedQuantity,
                        originalQuantity: result.executedQuantity,
                        originalGross: 0.5,
                        remainingGross: 0.5,
                        partialDefenseTriggered: false,
                        highWaterMark: entryPrice,
                        protectionLifecycle: "MANUAL_REVIEW",
                    }
                    : undefined,
            };
        }
        state.lastCompletedIdempotencyKey = pending.idempotencyKey;
        state.pending = undefined;
        await this.dependencies.stateStore.save(state);
        if (!pending.reduceOnly && pending.entryVersion === "RECOVERY_V8" && state.position?.recoveryV8) {
            const gateway = this.dependencies.recoveryV8Protection;
            if (!gateway) {
                state.position.recoveryV8.protectionLifecycle = "MANUAL_REVIEW";
                state.failures = [...state.failures, { occurredAt: this.now(), message: "PENGU Recovery V8 entry filled but protective-order gateway is unavailable." }].slice(-100);
                await this.dependencies.stateStore.save(state);
                return { status: "manual-review", message: "PENGU Recovery V8 entry filled without a protective-order gateway; fail closed.", idempotencyKey: pending.idempotencyKey };
            }
            try {
                const stop = await placeRecoveryV8EntryHardStop(gateway, {
                    symbol: SYMBOL,
                    entryTs: state.position.recoveryV8.entryTs,
                    entryPrice: state.position.recoveryV8.entryPrice,
                    quantity: state.position.recoveryV8.quantity,
                });
                state.position.recoveryV8 = {
                    ...state.position.recoveryV8,
                    protectionLifecycle: "FULL_HARD_STOP",
                    fullHardStopClientOrderId: stop.clientOrderId,
                };
                await this.dependencies.stateStore.save(state);
            } catch (error) {
                state.position.recoveryV8.protectionLifecycle = "MANUAL_REVIEW";
                const message = this.recordFailure(state, error);
                await this.dependencies.stateStore.save(state);
                return { status: "manual-review", message: `PENGU Recovery V8 entry protection failed: ${message}`, idempotencyKey: pending.idempotencyKey };
            }
        }
        this.log.info("PENGU Dual LS order completed", {
            strategyId: "PENGU_DUAL_LS_V2_FINAL",
            symbol: SYMBOL,
            side: pending.side,
            reduceOnly: pending.reduceOnly,
            quantity: result.executedQuantity,
            averagePrice: result.averagePrice,
            reason: pending.reason,
        });
        return { status: "completed", message: `PENGU Dual LS ${pending.side} ${pending.reduceOnly ? "exit" : "entry"} completed.`, idempotencyKey: pending.idempotencyKey };
    }

    private async reconcilePending(state: PenguDualLsV2RunnerState): Promise<PenguDualLsV2TickResult> {
        const pending = state.pending;
        if (!pending) return { status: "held", message: "No PENGU Dual LS pending order." };
        if (pending.phase === "manual_review") return { status: "manual-review", message: pending.lastError || "PENGU Dual LS pending order requires manual review.", idempotencyKey: pending.idempotencyKey };
        const result = await this.dependencies.executor.reconcileOrder(SYMBOL, pending.clientOrderId);
        return this.applyResult(state, pending, result);
    }

    private async executePending(state: PenguDualLsV2RunnerState): Promise<PenguDualLsV2TickResult> {
        const pending = state.pending;
        if (!pending) return { status: "held", message: "No PENGU Dual LS pending order." };
        try {
            const quote = await this.dependencies.executor.getMarketQuote(SYMBOL);
            const expectedPrice = pending.side === "BUY" ? quote.askPrice : quote.bidPrice;
            const normalized = await this.dependencies.executor.normalizeMarketQuantity(SYMBOL, pending.quantity, expectedPrice, { allowBelowMinNotional: pending.reduceOnly });
            pending.quantity = normalized.quantity;
            pending.expectedPrice = expectedPrice;
            pending.phase = "submitted";
            pending.updatedAt = this.now();
            await this.dependencies.stateStore.save(state);
            const command: DirectTradeCommand = {
                requestId: pending.idempotencyKey,
                clientOrderId: pending.clientOrderId,
                symbol: SYMBOL,
                side: pending.side,
                quantity: normalized.quantity,
                positionSide: "BOTH",
                reduceOnly: pending.reduceOnly,
                expectedPrice,
                maxSlippageBps: this.dependencies.config.maxSlippageBps,
                reason: pending.reason,
            };
            const result = await this.dependencies.executor.executeMarket(command);
            return this.applyResult(state, pending, result);
        } catch (error) {
            pending.retryCount += 1;
            pending.lastError = this.recordFailure(state, error);
            pending.updatedAt = this.now();
            pending.phase = pending.retryCount >= this.dependencies.config.maxTransactionRetries ? "manual_review" : "planned";
            await this.dependencies.stateStore.save(state);
            return { status: pending.phase === "manual_review" ? "manual-review" : "failed", message: pending.lastError, idempotencyKey: pending.idempotencyKey };
        }
    }

    async tick(): Promise<PenguDualLsV2TickResult> {
        if (!this.dependencies.config.enabled) return { status: "disabled", message: "PENGU_DUAL_LS_V2_FINAL is disabled." };
        this.ensureLiveGate();
        const ownerId = randomUUID();
        const lock = await this.dependencies.lock.acquire(ownerId);
        if (!lock) return { status: "locked", message: "Another PENGU Dual LS tick owns the account lock." };
        try {
            const state = await this.dependencies.stateStore.load();
            state.lastRunAt = this.now();
            if (state.pending) return await this.reconcilePending(state);
            const history = await this.dependencies.marketData.load();
            if (this.dependencies.config.mode === "SHADOW") {
                const signal = buildPenguDualLsV2Signal(history, state.position, this.now(), state.cooldownUntilTs);
                state.lastSignalReferenceTs = signal.referenceTs;
                state.latestSignal = signal;
                await this.dependencies.stateStore.save(state);
                this.log.info("PENGU Dual LS shadow decision", {
                    strategyId: signal.strategyId,
                    side: signal.side,
                    reason: signal.reason,
                    referenceTs: signal.referenceTs,
                    orderSent: 0,
                });
                return { status: "shadow", message: signal.reason, signal };
            }

            const [account, positions, openOrders] = await Promise.all([
                this.dependencies.executor.getAccountSnapshot(),
                this.dependencies.executor.getPositions(),
                this.dependencies.executor.getOpenOrders(),
            ]);
            const actual = actualPosition(positions);
            if (!state.position && actual) {
                return { status: "manual-review", message: "PENGU Dual LS found an unmanaged existing PENGU position; no takeover is allowed." };
            }
            if (state.position && !actual) {
                return { status: "manual-review", message: "PENGU Dual LS state expects a position but Aster returned none." };
            }
            const recoveredPartial = state.position && actual
                ? await this.reconcileRecoveryV8PartialFill(state, actual)
                : false;
            if (state.position && actual && !recoveredPartial) {
                const actualSide = positionSide(actual);
                if (actualSide !== state.position.side || Math.abs(Math.abs(actual.quantity) - state.position.quantity) > Math.max(1e-8, state.position.quantity * 0.01)) {
                    return { status: "manual-review", message: "PENGU Dual LS durable state and Aster position disagree." };
                }
                state.position = statePositionFromActual(actual, state.position);
            }
            if (state.position?.entryVersion === "RECOVERY_V8" && state.position.recoveryV8 && actual && this.dependencies.config.mode === "LIVE") {
                if (state.position.recoveryV8.protectionLifecycle === "MANUAL_REVIEW") {
                    return { status: "manual-review", message: "PENGU Recovery V8 protection state is in manual review; no order mutation is allowed." };
                }
                const gateway = this.dependencies.recoveryV8Protection;
                if (!gateway) return { status: "manual-review", message: "PENGU Recovery V8 protective-order gateway is unavailable; fail closed." };
                if (state.position.recoveryV8.protectionLifecycle === "FULL_HARD_STOP"
                    && this.now() >= state.position.entryTs + 24 * 3_600_000) {
                    try {
                        const replaced = await replaceRecoveryV8Stops(gateway, {
                            symbol: SYMBOL,
                            entryTs: state.position.entryTs,
                            entryPrice: state.position.entryPrice,
                            currentQuantity: Math.abs(actual.quantity),
                            oldHardStopClientOrderId: state.position.recoveryV8.fullHardStopClientOrderId,
                            nowTs: this.now(),
                        });
                        state.position.recoveryV8 = {
                            ...state.position.recoveryV8,
                            protectionLifecycle: "SPLIT_PROTECTION",
                            partialDefenseArmedAtTs: this.now(),
                            partialStopClientOrderId: replaced.partial.clientOrderId,
                            remainingHardStopClientOrderId: replaced.remainingHard.clientOrderId,
                        };
                        await this.dependencies.stateStore.save(state);
                    } catch (error) {
                        state.position.recoveryV8.protectionLifecycle = "MANUAL_REVIEW";
                        const message = this.recordFailure(state, error);
                        await this.dependencies.stateStore.save(state);
                        return { status: "manual-review", message: `PENGU Recovery V8 protection replacement failed: ${message}` };
                    }
                }
            }
            if (openOrders.some((order) => order.symbol.toUpperCase() === SYMBOL)) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "PENGU Dual LS will not create an order while a PENGU open order exists." };
            }

            const baseSignal = buildPenguDualLsV2Signal(history, state.position, this.now(), state.cooldownUntilTs);
            const sharedRisk = await this.sharedRiskReason();
            const signal: PenguDualLsV2Signal = sharedRisk && state.position
                ? {
                    ...baseSignal,
                    side: 0,
                    reason: sharedRisk,
                    exit: {
                        side: state.position.side,
                        reason: "SHARED_RISK_FLATTEN",
                        updatedPosition: state.position,
                    },
                }
                : baseSignal;
            state.lastSignalReferenceTs = signal.referenceTs;
            state.latestSignal = signal;
            if (state.position && signal.updatedPosition) state.position = signal.updatedPosition;
            const reduceOnly = Boolean(signal.exit && state.position && actual);
            const side: AsterOrderSide | undefined = reduceOnly
                ? (state.position!.side > 0 ? "SELL" : "BUY")
                : signal.side > 0 ? "BUY" : signal.side < 0 ? "SELL" : undefined;
            if (sharedRisk && !state.position) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: `${sharedRisk} No PENGU position is open; new entries are blocked.`, signal };
            }
            if (!side) {
                await this.dependencies.stateStore.save(state);
                return { status: "no-change", message: signal.reason, signal };
            }
            if (!reduceOnly) {
                const now = this.now();
                if (!signal.entryTs || now < signal.entryTs || now - signal.entryTs > this.dependencies.config.maximumEntryDelayMs) {
                    await this.dependencies.stateStore.save(state);
                    return {
                        status: "held",
                        message: `PENGU V2 entry window is not current: entryTs=${signal.entryTs ?? 0}, now=${now}, maximumDelayMs=${this.dependencies.config.maximumEntryDelayMs}.`,
                        signal,
                    };
                }
            }

            const quote = await this.dependencies.executor.getMarketQuote(SYMBOL);
            const accountEquity = Math.max(0, finite(account.walletBalance, account.availableBalance));
            const reserve = accountEquity * this.dependencies.config.cashReservePct / 100;
            const available = Math.max(0, Math.min(account.availableBalance, accountEquity - reserve));
            const otherGross = normalizedPositionGross(positions, accountEquity, SYMBOL);
            const remainingPortfolioGross = Math.max(0, this.dependencies.config.portfolioGrossCap - otherGross);
            const targetGross = reduceOnly
                ? 0
                : Math.min(this.dependencies.config.maximumGross, signal.targetGross, remainingPortfolioGross);
            const targetNotional = reduceOnly ? Math.abs(actual!.quantity) * quote.midPrice : Math.min(targetGross * accountEquity, available);
            if (!reduceOnly && targetNotional < this.dependencies.config.minimumOrderNotionalUsd) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: `PENGU Dual LS entry skipped: executable notional ${targetNotional.toFixed(4)} is below minimum or portfolio capacity.`, signal };
            }
            const requestedQuantity = reduceOnly ? Math.abs(actual!.quantity) : targetNotional / (side === "BUY" ? quote.askPrice : quote.bidPrice);
            const key = orderIdempotency(signal, side, reduceOnly, requestedQuantity);
            if (state.lastCompletedIdempotencyKey === key) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "The same PENGU Dual LS action was already completed.", signal, idempotencyKey: key };
            }
            const pending: PenguDualLsV2PendingOrder = {
                idempotencyKey: key,
                clientOrderId: clientOrderId(key),
                phase: "planned",
                side,
                quantity: requestedQuantity,
                reduceOnly,
                expectedPrice: side === "BUY" ? quote.askPrice : quote.bidPrice,
                reason: reduceOnly ? signal.reason : `${signal.reason} targetGross=${targetGross.toFixed(4)} portfolioRemaining=${remainingPortfolioGross.toFixed(4)}`,
                referenceTs: signal.referenceTs,
                targetGross,
                createdAt: this.now(),
                updatedAt: this.now(),
                retryCount: 0,
                entryVersion: !reduceOnly ? (signal.entryVersion || (signal.side < 0 ? "SHORT_V20" : "LONG_V2_FINAL")) : undefined,
                shortV20Seed: !reduceOnly && signal.side < 0 && signal.features
                    ? {
                        requestedGross: signal.targetGross,
                        entryAtr24Ratio: signal.features.atr24Ratio,
                        btcEma168Distance: signal.features.btcEma168Distance,
                        btcReturn24h: signal.features.btcReturn24h,
                    }
                    : undefined,
                recoveryV8Seed: !reduceOnly && signal.entryVersion === "RECOVERY_V8"
                    ? { originalGross: 0.5, remainingGross: 0.5 }
                    : undefined,
            };
            state.pending = pending;
            await this.dependencies.stateStore.save(state);
            this.log.info("PENGU Dual LS order planned", {
                strategyId: signal.strategyId,
                symbol: SYMBOL,
                side,
                reduceOnly,
                targetGross,
                targetNotional,
                otherGross,
                remainingPortfolioGross,
                referenceTs: signal.referenceTs,
            });
            const result = await this.executePending(state);
            return { ...result, signal, idempotencyKey: key };
        } catch (error) {
            const failedState = await this.dependencies.stateStore.load();
            const message = this.recordFailure(failedState, error);
            await this.dependencies.stateStore.save(failedState);
            this.log.error("PENGU Dual LS tick failed", { message });
            return { status: /manual|unknown|state/i.test(message) ? "manual-review" : "failed", message };
        } finally {
            await lock.release();
        }
    }
}
