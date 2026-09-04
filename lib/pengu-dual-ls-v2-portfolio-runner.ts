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
import { classifyAsterSymbol } from "@/lib/disdex-aster-portfolio-classifier";
import { planStrictPortfolio, type StrictPortfolioIntent, type StrictPortfolioPosition } from "@/lib/disdex-strict-portfolio-planner";
import { readQuality102CausalV1Ownership, quality102OwnsOrder, quality102OwnsPosition, type Quality102CausalV1OwnershipSnapshot } from "@/lib/disdex-quality102-causal-v1-ownership";
import { reduceQuality102CausalV1ForBaseConflict } from "@/lib/disdex-quality102-causal-v1-live-reduction";

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

function validLiveQuote(quote: DirectMarketQuote, symbol: string, now: number, maxAgeMs = 5 * 60_000) {
    return quote.symbol.toUpperCase() === symbol.toUpperCase()
        && Number.isFinite(quote.bidPrice) && quote.bidPrice > 0
        && Number.isFinite(quote.askPrice) && quote.askPrice > 0
        && quote.askPrice >= quote.bidPrice
        && Number.isFinite(quote.midPrice) && quote.midPrice > 0
        && Number.isFinite(quote.spreadBps) && quote.spreadBps >= 0
        && Number.isFinite(quote.bidQuantity) && quote.bidQuantity > 0
        && Number.isFinite(quote.askQuantity) && quote.askQuantity > 0
        && Number.isFinite(quote.updatedAt) && quote.updatedAt > 0
        && quote.updatedAt <= now && now - quote.updatedAt <= maxAgeMs;
}

function validLiveAccount(account: DirectAccountSnapshot, now: number, maxAgeMs = 5 * 60_000) {
    return Number.isFinite(account.walletBalance) && account.walletBalance > 0
        && Number.isFinite(account.availableBalance) && account.availableBalance >= 0
        && String(account.asset || "").trim().length > 0
        && Number.isFinite(account.updatedAt) && account.updatedAt > 0
        && account.updatedAt <= now && now - account.updatedAt <= maxAgeMs;
}

function filled(result: DirectTradeResult) {
    return result.status === "FILLED" && result.executedQuantity > 0;
}

function resultMatchesPending(result: DirectTradeResult, pending: PenguDualLsV2PendingOrder) {
    return result.symbol.toUpperCase() === SYMBOL
        && result.clientOrderId === pending.clientOrderId
        && result.side === pending.side
        && Number.isFinite(result.executedQuantity)
        && result.executedQuantity >= 0
        && result.executedQuantity <= pending.quantity + 1e-9;
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

function strictStrategyForPosition(position: DirectPosition, quality102Ownership?: Quality102CausalV1OwnershipSnapshot) {
    if (quality102OwnsPosition(quality102Ownership, position)) return "QUALITY102_CAUSAL_V1" as const;
    const symbol = position.symbol.toUpperCase();
    if (symbol === SYMBOL) return "PENGU_DUAL_LS_V2" as const;
    const v12 = classifyAsterSymbol(symbol, "V12");
    if (v12.tradable && v12.sleeve === "V12") return "V12" as const;
    const stock = classifyAsterSymbol(symbol, "V50_POST_OPEN_BASIS");
    if (stock.tradable && stock.assetClass === "STOCK") return "V52" as const;
    throw new Error(`MANUAL_REVIEW_UNKNOWN_STRATEGY_OWNERSHIP:${symbol}`);
}

function strictActivePositions(positions: DirectPosition[], now: number, quality102Ownership?: Quality102CausalV1OwnershipSnapshot, quality102Position?: StrictPortfolioPosition): StrictPortfolioPosition[] {
    return positions.map((position) => {
        const strategy = strictStrategyForPosition(position, quality102Ownership);
        if (strategy === "QUALITY102_CAUSAL_V1") {
            if (!quality102Position) throw new Error(`QUALITY102_CAUSAL_V1_LIVE_QUOTE_REQUIRED:${position.symbol}`);
            return quality102Position;
        }
        return {
        id: `${position.symbol.toUpperCase()}:${position.positionSide}:${position.quantity}`,
        strategy,
        symbol: position.symbol.toUpperCase(),
        side: positionSide(position) > 0 ? "LONG" : "SHORT",
        quantity: Math.abs(position.quantity),
        entryPrice: position.entryPrice,
        markPrice: position.markPrice,
        entryTs: Math.min(position.updatedAt, now),
        updatedAt: position.updatedAt,
        };
    });
}

async function liveQuality102Position(
    executor: DirectTradeExecutor,
    positions: DirectPosition[],
    ownership: Quality102CausalV1OwnershipSnapshot | undefined,
    now: number,
): Promise<StrictPortfolioPosition | undefined> {
    const statePosition = ownership?.position;
    if (!statePosition) return undefined;
    const actual = positions.find((position) => quality102OwnsPosition(ownership, position));
    if (!actual) throw new Error("QUALITY102_CAUSAL_V1_STATE_POSITION_MISMATCH");
    const quote = await executor.getMarketQuote(actual.symbol);
    if (!validLiveQuote(quote, actual.symbol, now)) {
        throw new Error("QUALITY102_CAUSAL_V1_LIVE_QUOTE_REQUIRED");
    }
    return {
        id: `aster:q102:${actual.symbol.toUpperCase()}`,
        strategy: "QUALITY102_CAUSAL_V1",
        symbol: actual.symbol.toUpperCase(),
        side: statePosition.side > 0 ? "LONG" : "SHORT",
        quantity: Math.abs(actual.quantity),
        entryPrice: statePosition.entryPrice,
        markPrice: quote.midPrice,
        entryTs: statePosition.entryTs,
        updatedAt: quote.updatedAt,
        markSource: "LIVE_MARKET_QUOTE",
        markSourceEvidence: { source: "LIVE_MARKET_QUOTE", timestamp: quote.updatedAt, price: quote.midPrice, crossChecked: true },
    };
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
        entryVersion: previous?.entryVersion || "LEGACY_V2",
        shortV20: previous?.shortV20,
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

    private async manualReview(state: PenguDualLsV2RunnerState, message: string, idempotencyKey?: string): Promise<PenguDualLsV2TickResult> {
        if (state.pending) {
            state.pending.phase = "manual_review";
            state.pending.lastError = message;
            state.pending.updatedAt = this.now();
        }
        this.recordFailure(state, message);
        await this.dependencies.stateStore.save(state);
        this.log.error("PENGU Dual LS manual review required", { message, idempotencyKey });
        return { status: "manual-review", message, idempotencyKey };
    }

    private async applyResult(state: PenguDualLsV2RunnerState, pending: PenguDualLsV2PendingOrder, result: DirectTradeResult): Promise<PenguDualLsV2TickResult> {
        if (!resultMatchesPending(result, pending)) return this.manualReview(state, "PENGU_DUAL_LS_EXECUTION_RESULT_IDENTITY_MISMATCH", pending.idempotencyKey);
        if (result.status === "UNKNOWN" || result.executionUnknown) {
            return this.manualReview(state, result.error || "PENGU Dual LS order status is UNKNOWN; blind retry is forbidden.", pending.idempotencyKey);
        }
        if (!filled(result)) return this.manualReview(state, `PENGU Dual LS order ended with ${result.status}; no blind retry is allowed.`, pending.idempotencyKey);
        if (!(result.averagePrice > 0) || !Number.isFinite(result.averagePrice)) {
            return this.manualReview(state, "PENGU_DUAL_LS_EXECUTION_PRICE_INVALID", pending.idempotencyKey);
        }

        let positions: DirectPosition[];
        try {
            positions = await this.dependencies.executor.getPositions();
        } catch (error) {
            return this.manualReview(state, `PENGU_DUAL_LS_POST_FILL_RECONCILIATION_FAILED:${error instanceof Error ? error.message : String(error)}`, pending.idempotencyKey);
        }
        const actual = actualPosition(positions);
        if (pending.reduceOnly) {
            if (actual) return this.manualReview(state, "PENGU_DUAL_LS_EXIT_POSITION_REMAINS_AFTER_FILL", pending.idempotencyKey);
        } else if (!actual
            || positionSide(actual) !== (pending.side === "BUY" ? 1 : -1)
            || Math.abs(Math.abs(actual.quantity) - result.executedQuantity) > Math.max(1e-8, result.executedQuantity * 0.02)) {
            return this.manualReview(state, "PENGU_DUAL_LS_ENTRY_FILL_POSITION_MISMATCH", pending.idempotencyKey);
        }
        if (pending.reduceOnly) {
            state.position = undefined;
            state.cooldownUntilTs = pending.referenceTs + 6 * 3_600_000;
        } else {
            const entryPrice = result.averagePrice;
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
        let submitted = false;
        try {
            const quote = await this.dependencies.executor.getMarketQuote(SYMBOL);
            const now = this.now();
            if (this.dependencies.config.mode === "LIVE") {
                const [account, positions, openOrders] = await Promise.all([
                    this.dependencies.executor.getAccountSnapshot(),
                    this.dependencies.executor.getPositions(),
                    this.dependencies.executor.getOpenOrders(),
                ]);
                if (!validLiveAccount(account, now)) throw new Error("PENGU_DUAL_LS_PRE_SUBMIT_ACCOUNT_STALE_OR_INVALID");
                if (openOrders.length > 0) throw new Error("PENGU_DUAL_LS_PRE_SUBMIT_OPEN_ORDER_CONFLICT");
                const actual = actualPosition(positions);
                if (pending.reduceOnly) {
                    if (!state.position || !actual || positionSide(actual) !== state.position.side || Math.abs(Math.abs(actual.quantity) - state.position.quantity) > Math.max(1e-8, state.position.quantity * 0.02)) {
                        throw new Error("PENGU_DUAL_LS_PRE_SUBMIT_EXIT_POSITION_MISMATCH");
                    }
                } else if (actual || state.position) {
                    throw new Error("PENGU_DUAL_LS_PRE_SUBMIT_ENTRY_POSITION_ALREADY_ACTIVE");
                }
            }
            if (this.dependencies.config.mode === "LIVE" && !validLiveQuote(quote, SYMBOL, now)) throw new Error("PENGU_DUAL_LS_PRE_SUBMIT_QUOTE_STALE_OR_INVALID");
            const expectedPrice = pending.side === "BUY" ? quote.askPrice : quote.bidPrice;
            if (!(expectedPrice > 0) || !Number.isFinite(expectedPrice)) throw new Error("PENGU_DUAL_LS_PRE_SUBMIT_EXECUTION_PRICE_INVALID");
            const normalized = await this.dependencies.executor.normalizeMarketQuantity(SYMBOL, pending.quantity, expectedPrice, { allowBelowMinNotional: pending.reduceOnly });
            if (!(normalized.quantity > 0) || !Number.isFinite(normalized.notional) || normalized.notional <= 0 || normalized.quantity > pending.quantity + 1e-9) {
                throw new Error("PENGU_DUAL_LS_PRE_SUBMIT_NORMALIZED_QUANTITY_INVALID");
            }
            pending.quantity = normalized.quantity;
            pending.expectedPrice = expectedPrice;
            pending.phase = "submitted";
            submitted = true;
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
            pending.lastError = this.recordFailure(state, error);
            pending.updatedAt = this.now();
            // Once the durable state says submitted, any exception can be
            // after the venue accepted the request. Never make that order
            // retryable without reconciliation.
            if (submitted) pending.phase = "manual_review";
            else {
                pending.retryCount += 1;
                pending.phase = pending.retryCount >= this.dependencies.config.maxTransactionRetries ? "manual_review" : "planned";
            }
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
            let quality102Ownership = await readQuality102CausalV1Ownership({ expectedRuntimeSha: process.env.DISDEX_RUNTIME_COMMIT_SHA });
            if (quality102Ownership?.pending) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "Quality102 causal-v1 has a pending order and must reconcile before PENGU can enter.", signal: state.latestSignal || undefined };
            }
            const quality102OpenOrder = openOrders.some((order) => quality102OwnsOrder(quality102Ownership, order));
            const nonQuality102OpenOrders = openOrders.filter((order) => !quality102OwnsOrder(quality102Ownership, order));
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
            if (quality102OpenOrder) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "Quality102 causal-v1 has an in-flight order; PENGU waits for reconciliation." };
            }
            if (nonQuality102OpenOrders.length > 0) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "PENGU Dual LS will not create an order while any account open order exists." };
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

            let quote = await this.dependencies.executor.getMarketQuote(SYMBOL);
            const decisionNow = this.now();
            if (!validLiveAccount(account, decisionNow)) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "PENGU Dual LS strict planner blocked: account snapshot is missing or stale." };
            }
            if (!validLiveQuote(quote, SYMBOL, decisionNow)) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "PENGU Dual LS strict planner blocked: market quote is missing or stale." };
            }
            let workingAccount = account;
            let workingPositions = positions;
            let q102StrictPosition = await liveQuality102Position(this.dependencies.executor, workingPositions, quality102Ownership, decisionNow);
            const accountEquity = Math.max(0, finite(workingAccount.walletBalance, workingAccount.availableBalance) + workingPositions.reduce((sum, position) => sum + finite(position.unrealizedPnl), 0));
            if (!(accountEquity > 0)) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "PENGU Dual LS strict planner requires positive mark-to-market account equity.", signal };
            }
            let workingEquity = accountEquity;
            let available = 0;
            let targetGross = 0;
            let targetNotional = 0;
            if (!reduceOnly) {
                let accepted: StrictPortfolioIntent | undefined;
                for (let attempt = 0; attempt < 3; attempt += 1) {
                    const plannerNow = this.now();
                    q102StrictPosition = await liveQuality102Position(this.dependencies.executor, workingPositions, quality102Ownership, plannerNow);
                    workingEquity = Math.max(0, finite(workingAccount.walletBalance, workingAccount.availableBalance) + workingPositions.reduce((sum, position) => sum + finite(position.unrealizedPnl), 0));
                    if (!(workingEquity > 0)) throw new Error("PENGU_DUAL_LS_STRICT_EQUITY_INVALID_AFTER_MTM");
                    const reserve = workingEquity * this.dependencies.config.cashReservePct / 100;
                    available = Math.max(0, Math.min(workingAccount.availableBalance, workingEquity - reserve));
                    targetGross = Math.min(this.dependencies.config.maximumGross, signal.targetGross);
                    targetNotional = Math.min(targetGross * workingEquity, available);
                    const strictPlan = planStrictPortfolio({
                        equity: workingEquity,
                        now: plannerNow,
                        active: strictActivePositions(workingPositions, plannerNow, quality102Ownership, q102StrictPosition),
                        intents: [{
                            idempotencyKey: `${signal.strategyId}|${signal.referenceTs}|${signal.side}|ENTRY`,
                            strategy: "PENGU_DUAL_LS_V2",
                            symbol: SYMBOL,
                            side: signal.side > 0 ? "LONG" : "SHORT",
                            gross: targetGross,
                            notionalUsd: targetNotional,
                            signalTs: signal.referenceTs,
                        }],
                        maxDataAgeMs: 5 * 60_000,
                    });
                    if (strictPlan.status !== "planned") {
                        await this.dependencies.stateStore.save(state);
                        return { status: "held", message: `PENGU Dual LS strict portfolio plan blocked entry: ${strictPlan.reason || strictPlan.rejected[0]?.reason || "NO_ACCEPTED_INTENT"}.`, signal };
                    }
                    const reductions = strictPlan.reductions.filter((reduction) => reduction.strategy === "QUALITY102_CAUSAL_V1");
                    if (strictPlan.reductions.some((reduction) => reduction.strategy !== "QUALITY102_CAUSAL_V1")) {
                        throw new Error("PENGU_STRICT_PORTFOLIO_UNEXPECTED_BASE_REDUCTION");
                    }
                    if (reductions.length > 0) {
                        for (const reduction of reductions) {
                            const reduced = await reduceQuality102CausalV1ForBaseConflict({
                                executor: this.dependencies.executor,
                                reduction,
                                causeIdempotencyKey: `${signal.strategyId}|${signal.referenceTs}|${signal.side}|ENTRY`,
                                maxSlippageBps: this.dependencies.config.maxSlippageBps,
                                maxDataAgeMs: 5 * 60_000,
                                expectedRuntimeSha: process.env.DISDEX_RUNTIME_COMMIT_SHA,
                            });
                            if (reduced.status !== "reduced") throw new Error(`QUALITY102_MTM_REDUCTION_BLOCKED:${reduced.message}`);
                        }
                        [workingAccount, workingPositions] = await Promise.all([
                            this.dependencies.executor.getAccountSnapshot(),
                            this.dependencies.executor.getPositions(),
                        ]);
                        quality102Ownership = await readQuality102CausalV1Ownership({ expectedRuntimeSha: process.env.DISDEX_RUNTIME_COMMIT_SHA });
                        quote = await this.dependencies.executor.getMarketQuote(SYMBOL);
                        const refreshedNow = this.now();
                        if (!validLiveAccount(workingAccount, refreshedNow) || !validLiveQuote(quote, SYMBOL, refreshedNow)) {
                            throw new Error("PENGU_DUAL_LS_STRICT_REFRESHED_SNAPSHOT_STALE");
                        }
                        if ((await this.dependencies.executor.getOpenOrders()).length > 0) {
                            throw new Error("PENGU_DUAL_LS_STRICT_REFRESHED_OPEN_ORDER_CONFLICT");
                        }
                        continue;
                    }
                    accepted = strictPlan.accepted.find((intent) => intent.strategy === "PENGU_DUAL_LS_V2");
                    if (!accepted) {
                        await this.dependencies.stateStore.save(state);
                        return { status: "held", message: `PENGU Dual LS strict portfolio plan blocked entry: ${strictPlan.rejected[0]?.reason || "NO_ACCEPTED_INTENT"}.`, signal };
                    }
                    targetGross = accepted.gross;
                    targetNotional = Math.min(accepted.notionalUsd, available);
                    break;
                }
                if (!accepted) throw new Error("PENGU_STRICT_PORTFOLIO_REDUCTION_RETRY_EXHAUSTED");
                const finalNow = this.now();
                if (!validLiveAccount(workingAccount, finalNow) || !validLiveQuote(quote, SYMBOL, finalNow)) {
                    throw new Error("PENGU_DUAL_LS_STRICT_FINAL_SNAPSHOT_STALE");
                }
                if ((await this.dependencies.executor.getOpenOrders()).length > 0) {
                    throw new Error("PENGU_DUAL_LS_STRICT_FINAL_OPEN_ORDER_CONFLICT");
                }
            } else {
                const reserve = workingEquity * this.dependencies.config.cashReservePct / 100;
                available = Math.max(0, Math.min(workingAccount.availableBalance, workingEquity - reserve));
                targetGross = 0;
                targetNotional = Math.abs(actual!.quantity) * quote.midPrice;
            }
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
                reason: reduceOnly ? signal.reason : `${signal.reason} targetGross=${targetGross.toFixed(4)} portfolioRemaining=${Math.max(0, this.dependencies.config.portfolioGrossCap - normalizedPositionGross(workingPositions, workingEquity, SYMBOL)).toFixed(4)}`,
                referenceTs: signal.referenceTs,
                targetGross,
                createdAt: this.now(),
                updatedAt: this.now(),
                retryCount: 0,
                entryVersion: !reduceOnly ? (signal.side < 0 ? "SHORT_V20" : "LONG_V2_FINAL") : undefined,
                shortV20Seed: !reduceOnly && signal.side < 0 && signal.features
                    ? {
                        requestedGross: signal.targetGross,
                        entryAtr24Ratio: signal.features.atr24Ratio,
                        btcEma168Distance: signal.features.btcEma168Distance,
                        btcReturn24h: signal.features.btcReturn24h,
                    }
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
                otherGross: normalizedPositionGross(workingPositions, workingEquity, SYMBOL),
                remainingPortfolioGross: Math.max(0, this.dependencies.config.portfolioGrossCap - normalizedPositionGross(workingPositions, workingEquity, SYMBOL)),
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
