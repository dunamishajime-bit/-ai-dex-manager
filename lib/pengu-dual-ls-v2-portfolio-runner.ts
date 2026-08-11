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
        gross: previous?.gross || 0,
        highWaterMark: side > 0 ? Math.max(previous?.highWaterMark || actual.entryPrice, actual.markPrice) : previous?.highWaterMark || actual.markPrice,
        lowWaterMark: side < 0 ? Math.min(previous?.lowWaterMark || actual.entryPrice, actual.markPrice) : previous?.lowWaterMark || actual.markPrice,
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
        const dailyLossTripped = await readPortfolioDailyLoss(this.dependencies.config.portfolioDailyLossStatePath);
        if (dailyLossTripped) return `V96 portfolio daily loss latch is active at ${this.dependencies.config.maximumDailyLossPct}%.`;
        return undefined;
    }

    private recordFailure(state: PenguDualLsV2RunnerState, error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        state.failures = [...state.failures, { occurredAt: this.now(), message, idempotencyKey: state.pending?.idempotencyKey }].slice(-100);
        return message;
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
            state.position = {
                side: pending.side === "BUY" ? 1 : -1,
                entryTs: pending.referenceTs + 3_600_000,
                entryPrice: result.averagePrice || pending.expectedPrice,
                quantity: result.executedQuantity,
                gross: pending.targetGross,
                highWaterMark: result.averagePrice || pending.expectedPrice,
                lowWaterMark: result.averagePrice || pending.expectedPrice,
            };
        }
        state.lastCompletedIdempotencyKey = pending.idempotencyKey;
        state.pending = undefined;
        await this.dependencies.stateStore.save(state);
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
            if (state.position && actual) {
                const actualSide = positionSide(actual);
                if (actualSide !== state.position.side || Math.abs(Math.abs(actual.quantity) - state.position.quantity) > Math.max(1e-8, state.position.quantity * 0.01)) {
                    return { status: "manual-review", message: "PENGU Dual LS durable state and Aster position disagree." };
                }
                state.position = statePositionFromActual(actual, state.position);
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
