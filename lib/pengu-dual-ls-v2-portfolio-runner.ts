import { appendStopIntent, reconcileStopLedger, retireStopLedger } from "./resident-stop-ledger";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AsterOrderSide } from "@/lib/aster-v3-client";
import type { AccountLockHandle } from "@/lib/disdex-account-order-lock";
import type {
    DirectAccountSnapshot,
    DirectMarketQuote,
    DirectOpenOrder,
    DirectPosition,
    DirectTradeCommand,
    DirectTradeExecutor,
    DirectTradeResult,
} from "@/lib/direct-trade-executor";
import type { LiveRunnerLock, LiveRunnerLockHandle } from "@/lib/live-runner-state";
import {
    buildPenguDualLsV2Signal,
    cooldownHoursForPenguExit,
    type PenguDualLsV2History,
    type PenguDualLsV2Position,
    type PenguDualLsV2Signal,
} from "@/lib/pengu-dual-ls-v2";
import {
    recordPenguM05ShadowExitOutcome,
    recordPenguM05ShadowTickOutcome,
    type PenguDualLsV2PendingOrder,
    type PenguDualLsV2RunnerState,
    type PenguDualLsV2RunnerStateStore,
} from "@/lib/pengu-dual-ls-v2-runner-state";
import { PENGU_DUAL_LS_V2, type PenguDualLsV2Mode } from "@/config/penguDualLsV2Runtime";
import { readDisDexV96KillSwitch } from "@/lib/disdex-v96-live-risk-controls";
import { readSharedCryptoDailyRisk, readSharedCryptoDailyRiskWithRolloverRetry } from "@/lib/disdex-shared-crypto-daily-risk";
import { readPortfolioDdGovernor } from "@/lib/disdex-portfolio-dd-governor";
import { createPenguShortV20State } from "@/lib/pengu-short-v20";
import { classifyAsterSymbol } from "@/lib/disdex-aster-portfolio-classifier";
import { classifyAsterRateBudgetFailure } from "@/lib/disdex-aster-rate-budget-policy";
import { planStrictPortfolio, type StrictPortfolioIntent, type StrictPortfolioPosition } from "@/lib/disdex-strict-portfolio-planner";
import { aggregatePendingExposure, readPendingExposureRegistry } from "@/lib/disdex-pending-exposure-registry";
import { INTEGRATED_PRODUCTION_RISK_POLICY } from "@/config/integratedProductionRiskPolicy";
import { isHypeZecSoleSharedCapacityCause, releaseHypeZecCapacityForPriorityEntry } from "@/lib/hype-zec-priority-capacity";
import { releaseIdleResidualLongForFormalEntry } from "@/lib/idle-residual-long-preemption";
import { readQuality102CausalV1Ownership, quality102OwnsOrder, quality102OwnsPosition, type Quality102CausalV1OwnershipSnapshot } from "@/lib/disdex-quality102-causal-v1-ownership";
import { reduceQuality102CausalV1ForBaseConflict } from "@/lib/disdex-quality102-causal-v1-live-reduction";
import { reduceFetBrk48ForCoreConflict } from "@/lib/fet-brk48-live-reduction";
import { findManagedOrdinaryResidentStops, findManagedFetBrk48ProtectiveOrders, findManagedPenguRecoveryV8ProtectiveOrders, findManagedV12ProtectiveOrders } from "@/lib/disdex-managed-protective-orders";
import type { V12AsterLiveAdapter } from "@/lib/v12-aster-live-adapter";
import { reduceV12DynamicResidualForCoreConflict } from "@/lib/v12-dynamic-residual-live-reduction";
import {
    placeRecoveryV8EntryHardStop,
    replaceRecoveryV8Stops,
    type RecoveryV8ProtectiveOrderGateway,
} from "@/lib/pengu-recovery-v8-protective-orders";
import {
    createPenguRiskOverlayState,
    evaluatePenguNewEntryGate,
    recordPenguClosedTrade,
    recordPenguHardStop,
    routeForPenguEntryVersion,
} from "@/lib/pengu-route-quarantine-dd-governor";

import { residentStopPlan, verifyResidentStopPartial, retireResidentStop, ensureResidentStop, type ResidentStopGateway } from "./venue-resident-stop";

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
    residentStopRequired?: boolean;
    recoveryV8Enabled?: boolean;
    v64DynamicLongEnabled?: boolean;
}

export interface PenguDualLsV2RunnerLogger {
    info(message: string, payload?: Record<string, unknown>): void;
    warn(message: string, payload?: Record<string, unknown>): void;
    error(message: string, payload?: Record<string, unknown>): void;
}

export interface PenguDualLsV2ReservationInput {
    strategyId: string;
    symbol: string;
    side: "LONG" | "SHORT" | "FLAT";
    gross: number;
    notionalUsd: number;
}

export interface PenguDualLsV2LockHandle extends LiveRunnerLockHandle {
    document?(): Promise<Awaited<ReturnType<AccountLockHandle["document"]>>>;
    reserve?(input: PenguDualLsV2ReservationInput): Promise<{ reservationId: string }>;
    releaseReservation?(reservationId: string): Promise<void>;
}

export interface PenguDualLsV2AccountLock extends LiveRunnerLock {
    acquire(ownerId: string): Promise<PenguDualLsV2LockHandle | null>;
}

export interface PenguDualLsV2PortfolioRunnerDependencies {
    marketData: { load(force?: boolean): Promise<PenguDualLsV2History> };
    executor: DirectTradeExecutor;
    stateStore: PenguDualLsV2RunnerStateStore;
    lock: PenguDualLsV2AccountLock;
    config: PenguDualLsV2PortfolioRunnerConfig;
    logger?: PenguDualLsV2RunnerLogger;
    now?: () => number;
    residentStopGateway?: ResidentStopGateway;
    recoveryV8Protection?: RecoveryV8ProtectiveOrderGateway;
    v12DynamicAdapter?: V12AsterLiveAdapter;
    v12StatePath?: string;
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

function isSharedCapacityBlock(reason: unknown) {
    const value = String(reason || "");
    return /^(CAPACITY_BLOCKED|CRYPTO_GROSS_CAP|TOTAL_GROSS_CAP|CRYPTO_ENTRY_GROSS_CAP|TOTAL_ENTRY_GROSS_CAP|PENDING_CRYPTO_GROSS|PENDING_TOTAL_GROSS|CRYPTO_GROSS_HARD_CAP|TOTAL_GROSS_HARD_CAP|.*_CAPACITY_BLOCKED)/.test(value);
}


export function buildPenguV8StrictGrossContract(requestedGross: number, equity: number, available: number) {
    const requested = Number.isFinite(requestedGross) && requestedGross > 0 ? PENGU_DUAL_LS_V2.fixedEntryGross : 0;
    const safeEquity = Number.isFinite(equity) ? Math.max(0, equity) : 0;
    // Available balance is collateral, not a notional cap. The executor's
    // existing 5x-cross margin gate validates collateral before submission.
    void available;
    return { requestedGross: requested, intentGross: requested, intentNotionalUsd: requested * safeEquity };
}

export function isPenguFixedEntryAllocation(gross: number, maximumGross: number) {
    return Number.isFinite(gross) && Number.isFinite(maximumGross)
        && Math.abs(gross - PENGU_DUAL_LS_V2.fixedEntryGross) <= 1e-9
        && maximumGross + 1e-9 >= PENGU_DUAL_LS_V2.fixedEntryGross;
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

function unmanagedCrossSleeveOpenOrders(
    openOrders: readonly DirectOpenOrder[],
    positions: readonly DirectPosition[],
    quality102Ownership?: Quality102CausalV1OwnershipSnapshot,
): DirectOpenOrder[] {
    const managedProtectiveOrders = new Set<DirectOpenOrder>([
        ...findManagedOrdinaryResidentStops(openOrders, positions),
        ...findManagedPenguRecoveryV8ProtectiveOrders(openOrders, positions),
        ...findManagedV12ProtectiveOrders(openOrders, positions),
        ...findManagedFetBrk48ProtectiveOrders(openOrders, positions),
    ]);
    return openOrders.filter(
        (order) => !quality102OwnsOrder(quality102Ownership, order)
            && !managedProtectiveOrders.has(order),
    );
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
    if (symbol === "HYPEUSDT") return "HYPE_LONG" as const;
    if (symbol === "ZECUSDT") return "ZEC_LONG" as const;
    const v12 = classifyAsterSymbol(symbol, "V12");
    if (v12.tradable && v12.sleeve === "V12") return "V12" as const;
    const fet = classifyAsterSymbol(symbol, "FET_RESIDUAL");
    if (fet.tradable && fet.sleeve === "FET_RESIDUAL") return "FET_RESIDUAL" as const;
    const stock = classifyAsterSymbol(symbol, "V50_POST_OPEN_BASIS");
    if (stock.tradable && stock.assetClass === "STOCK") return "V52" as const;
    const idle = classifyAsterSymbol(symbol, "IDLE_PRIORITY_SHORT");
    if (idle.tradable && idle.sleeve === "IDLE_PRIORITY_SHORT") return "IDLE_PRIORITY_SHORT" as const;
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
        markSource: strategy === "FET_RESIDUAL" ? "LIVE_MARKET_QUOTE" : undefined,
        markSourceEvidence: strategy === "FET_RESIDUAL"
            ? { source: "LIVE_MARKET_QUOTE", timestamp: position.updatedAt, price: position.markPrice, crossChecked: true }
            : undefined,
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
        gross: previous?.recoveryV8?.partialDefenseTriggered ? previous.recoveryV8.remainingGross : previous?.gross || 0,
        highWaterMark: side > 0 ? Math.max(previous?.highWaterMark || actual.entryPrice, actual.markPrice) : previous?.highWaterMark || actual.markPrice,
        lowWaterMark: side < 0 ? Math.min(previous?.lowWaterMark || actual.entryPrice, actual.markPrice) : previous?.lowWaterMark || actual.markPrice,
        entryVersion: previous?.entryVersion || "LEGACY_V2",
        shortV20: previous?.shortV20,
        recoveryV8: previous?.recoveryV8
            ? {
                ...previous.recoveryV8,
                entryTs: previous.entryTs || actual.updatedAt || Date.now(),
                entryPrice: actual.entryPrice,
                logicalEntryPrice: previous.recoveryV8.logicalEntryPrice ?? previous.recoveryV8.entryPrice,
                recoveryExecutionPrice: previous.recoveryV8.recoveryExecutionPrice ?? actual.entryPrice,
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

    private async releaseHypeZecForPriorityEntry(input: {
        lock: PenguDualLsV2LockHandle;
        positions: DirectPosition[];
        equity: number;
        targetGross: number;
        pendingCryptoGross: number;
        pendingTotalGross: number;
        signal: PenguDualLsV2Signal;
    }) {
        if (!/^(1|true|yes|on)$/i.test(String(process.env.DISDEX_HYPE_ZEC_PREEMPTION_ENABLED || "").trim())) return undefined;
        if (!this.dependencies.v12DynamicAdapter || typeof input.lock.document !== "function") return { status: "blocked" as const, message: "PENGU_HYPE_ZEC_PREEMPTION_LOCK_OR_ADAPTER_REQUIRED" };
        const candidate: StrictPortfolioIntent = {
            idempotencyKey: `${input.signal.strategyId}|${input.signal.referenceTs}|${input.signal.side}|ENTRY`,
            strategy: "PENGU_DUAL_LS_V2",
            symbol: SYMBOL,
            side: input.signal.side > 0 ? "LONG" : "SHORT",
            gross: input.targetGross,
            requestedGross: input.targetGross,
            notionalUsd: input.targetGross * input.equity,
            signalTs: input.signal.referenceTs,
        };
        return releaseHypeZecCapacityForPriorityEntry({
            adapter: this.dependencies.v12DynamicAdapter,
            executor: this.dependencies.executor,
            lock: input.lock as unknown as AccountLockHandle,
            positions: input.positions,
            equityUsd: input.equity,
            candidate,
            pendingCryptoGross: input.pendingCryptoGross,
            pendingTotalGross: input.pendingTotalGross,
            cryptoEntryCap: INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap,
            totalEntryCap: INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap,
            causeIdempotencyKey: candidate.idempotencyKey,
            expectedRuntimeSha: process.env.DISDEX_RELEASE_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA,
            enabled: true,
            statePath: process.env.DISDEX_HYPE_ZEC_PREEMPTION_STATE_PATH,
            maxSlippageBps: this.dependencies.config.maxSlippageBps,
            now: this.now,
        });
    }

    private async sharedRiskStatus(): Promise<{ reason: string; flattenExisting: boolean } | undefined> {
        if (this.dependencies.config.mode !== "LIVE") return undefined;
        const killSwitch = await readDisDexV96KillSwitch(this.dependencies.config.killSwitchPath);
        if (killSwitch) {
            return {
                reason: `Shared Kill Switch: ${killSwitch.reason}`,
                flattenExisting: killSwitch.action === "FLATTEN_MANAGED",
            };
        }
        const sharedPath = this.dependencies.config.portfolioDailyLossStatePath || process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH;
        if (sharedPath) {
            const validation = await readSharedCryptoDailyRisk(sharedPath);
            if (!validation.ok) {
                return {
                    reason: `Shared crypto daily-risk state blocked PENGU entry: ${validation.reason}.`,
                    flattenExisting: validation.reason === "DAILY_LOSS_TRIPPED" || validation.state?.tripped === true,
                };
            }
        }
        const dailyLossTripped = await readPortfolioDailyLoss(this.dependencies.config.portfolioDailyLossStatePath);
        if (dailyLossTripped) {
            return {
                reason: `Shared crypto daily loss latch is active at ${this.dependencies.config.maximumDailyLossPct}%.`,
                flattenExisting: true,
            };
        }
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
        const logicalEntryPrice = recovery.logicalEntryPrice ?? position.entryPrice;
        const triggerPrice = logicalEntryPrice * (1 - 0.04);
        const averagePrice = Number(order.averagePrice || 0);
        if (!(averagePrice > 0)) throw new Error("PENGU Recovery V8 partial stop fill has no average price.");
        state.position = {
            ...position,
            quantity: actualQuantity,
            gross: recovery.originalGross * actualQuantity / recovery.originalQuantity,
            recoveryV8: {
                ...recovery,
                quantity: actualQuantity,
                remainingGross: recovery.originalGross * actualQuantity / recovery.originalQuantity,
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
        const closedPosition = state.position;
        if (pending.reduceOnly) {
            if (actual) return this.manualReview(state, "PENGU_DUAL_LS_EXIT_POSITION_REMAINS_AFTER_FILL", pending.idempotencyKey);
            if (!closedPosition) return this.manualReview(state, "PENGU_DUAL_LS_EXIT_STATE_MISSING_AFTER_FILL", pending.idempotencyKey);
            let exitAverage=result.averagePrice, accountingGross=closedPosition.gross, hadStopFill=false;
            if(closedPosition.stopLedger){
                try {
                    if(!(result as any).residentLedgerAggregated)await reconcileStopLedger(closedPosition.stopLedger,0,id=>this.dependencies.executor.reconcileOrder(SYMBOL,id),pending,result);
                    const l=closedPosition.stopLedger;const qty=l.fills.reduce((n,f)=>n+f.quantity,0);
                    if(Math.abs(qty-l.originalQuantity)>1e-8)throw Error("PENGU_STOP_ACCOUNTING_QUANTITY");
                    exitAverage=l.fills.reduce((n,f)=>n+f.quantity*f.averagePrice,0)/qty;accountingGross=l.originalGross;hadStopFill=l.fills.some(f=>f.hardStop);
                    await this.dependencies.stateStore.save(state);
                    await retireStopLedger(this.dependencies.residentStopGateway!,l,this.now());
                }catch(error){return this.manualReview(state,"PENGU_STOP_ACCOUNTING_RECONCILIATION:"+(error instanceof Error?error.message:String(error)));}
            }else if((result as any).residentLedgerAggregated && closedPosition.recoveryV8){ accountingGross=closedPosition.recoveryV8.originalGross;
            }else if(closedPosition.recoveryV8?.actualPartialFill){
                const r=closedPosition.recoveryV8,f=r.actualPartialFill!;const qty=f.executedQuantity+result.executedQuantity;
                if(Math.abs(qty-r.originalQuantity)>1e-8)return this.manualReview(state,"PENGU_RECOVERY_EXIT_QUANTITY_UNRECONCILED");
                exitAverage=(f.executedQuantity*f.averagePrice+result.executedQuantity*result.averagePrice)/qty;accountingGross=r.originalGross;
            }else if (closedPosition.residentStop) {
                if (!this.dependencies.residentStopGateway) return this.manualReview(state, "PENGU_RESIDENT_STOP_RETIRE_GATEWAY_MISSING");
                try { await retireResidentStop(this.dependencies.residentStopGateway, closedPosition.residentStop); }
                catch (error) { return this.manualReview(state, `PENGU_RESIDENT_STOP_RETIRE_FAILED:${error instanceof Error ? error.message : String(error)}`); }
            }
            const directionalReturn = closedPosition.side > 0
                ? exitAverage / closedPosition.entryPrice - 1
                : closedPosition.entryPrice / exitAverage - 1;
            const netAccountReturn = accountingGross * (directionalReturn - 2 * 0.0006);
            if (closedPosition.entryVersion === "SHORT_V20") {
                recordPenguM05ShadowExitOutcome(state, {
                    entryTs: closedPosition.entryTs,
                    exitIdempotencyKey: pending.idempotencyKey,
                    exitFillObservedAt: result.updatedAt && Number.isFinite(result.updatedAt) ? result.updatedAt : this.now(),
                    exitFillPrice: exitAverage,
                    exitReason: pending.exitReason || pending.reason,
                    realizedDirectionalReturn: directionalReturn,
                    realizedNetAccountReturn: netAccountReturn,
                });
            }
            const route = routeForPenguEntryVersion(closedPosition.entryVersion === "LEGACY_V2" ? "LONG_V2_FINAL" : closedPosition.entryVersion);
            state.riskOverlay = recordPenguClosedTrade(state.riskOverlay || createPenguRiskOverlayState(), route, netAccountReturn, this.now());
            if (hadStopFill || pending.exitReason === "LONG_HARD_STOP" || pending.exitReason === "SHORT_HARD_STOP" || pending.exitReason === "RECOVERY_V8_HARD_STOP") {
                state.riskOverlay = recordPenguHardStop(state.riskOverlay, route, this.now());
            }
        } else if (!actual
            || positionSide(actual) !== (pending.side === "BUY" ? 1 : -1)
            || Math.abs(Math.abs(actual.quantity) - result.executedQuantity) > Math.max(1e-8, result.executedQuantity * 0.02)) {
            return this.manualReview(state, "PENGU_DUAL_LS_ENTRY_FILL_POSITION_MISMATCH", pending.idempotencyKey);
        }
        if (pending.reduceOnly) {
            state.position = undefined;
            state.cooldownUntilTs = pending.referenceTs + cooldownHoursForPenguExit(pending.exitReason) * 3_600_000;
        } else {
            const entryPrice = actual!.entryPrice > 0 ? actual!.entryPrice : result.averagePrice;
            const isRecoveryV8 = pending.entryVersion === "RECOVERY_V8";
            state.position = {
                side: pending.side === "BUY" ? 1 : -1,
                entryTs: pending.referenceTs + 3_600_000,
                entryPrice,
                quantity: Math.abs(actual!.quantity),
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
                        originalGross: pending.targetGross,
                        remainingGross: pending.targetGross,
                        partialDefenseTriggered: false,
                        highWaterMark: entryPrice,
                        logicalEntryPrice: entryPrice,
                        recoveryExecutionPrice: entryPrice,
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
                    entryPrice: state.position.recoveryV8.logicalEntryPrice ?? state.position.recoveryV8.entryPrice,
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
        if (!pending.reduceOnly && state.position?.entryVersion !== "RECOVERY_V8" && this.dependencies.config.residentStopRequired) {
            const blocked = await this.protectOrdinaryPosition(state);
            if (blocked) return blocked;
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

    private async reconcileRecoveryV8StopFill(state:PenguDualLsV2RunnerState):Promise<PenguDualLsV2TickResult|undefined>{
        const p=state.position,r=p?.recoveryV8,g=this.dependencies.recoveryV8Protection;
        if(!p||p.entryVersion!=="RECOVERY_V8"||!r||!g?.getOrder)return;
        if(actualPosition(await this.dependencies.executor.getPositions()))return;
        try{
            const ids=[r.fullHardStopClientOrderId,r.partialStopClientOrderId,r.remainingHardStopClientOrderId].filter((v):v is string=>!!v);
            if(!ids.length)throw Error("RECOVERY_STOP_IDS_MISSING");
            const fills:DirectTradeResult[]=[];
            for(const id of ids){const f=await this.dependencies.executor.reconcileOrder(SYMBOL,id);if(f.executionUnknown||f.status==="UNKNOWN"||f.symbol!==SYMBOL||f.clientOrderId!==id||f.side!=="SELL"||f.reduceOnly!==true)throw Error("RECOVERY_STOP_IDENTITY_UNKNOWN");if(f.executedQuantity>0){if(!(f.averagePrice>0))throw Error("RECOVERY_STOP_FILL_PRICE");fills.push(f);}}
            if(state.pending && state.pending.phase!=="planned"){const f=await this.dependencies.executor.reconcileOrder(SYMBOL,state.pending.clientOrderId);if(f.executionUnknown||f.status==="UNKNOWN"||f.side!=="SELL"||f.reduceOnly!==true||f.symbol!==SYMBOL)throw Error("RECOVERY_EXIT_RACE_UNKNOWN");if(f.executedQuantity>0)fills.push(f);}
            const qty=fills.reduce((n,f)=>n+f.executedQuantity,0);
            if(Math.abs(qty-r.originalQuantity)>1e-8)throw Error("RECOVERY_STOP_FILL_QUANTITY");
            for(const id of ids){const o=await g.getOrder(SYMBOL,id);if(o.symbol!==SYMBOL||o.clientOrderId!==id||o.side!=="SELL"||o.reduceOnly!==true)throw Error("RECOVERY_STOP_CLEANUP_IDENTITY");if(["NEW","PARTIALLY_FILLED"].includes(o.status)){await g.cancel(id,SYMBOL);const after=await g.getOrder(SYMBOL,id);if(!["FILLED","CANCELED","EXPIRED"].includes(after.status))throw Error("RECOVERY_STOP_CLEANUP_UNVERIFIED");}}
            const ts=Math.max(this.now(),...fills.map(f=>f.updatedAt||0)),id=ids[0];
            const pending:PenguDualLsV2PendingOrder={idempotencyKey:id,clientOrderId:id,phase:"submitted",side:"SELL",quantity:qty,reduceOnly:true,expectedPrice:1,reason:"VENUE_RESIDENT_STOP_FILLED",exitReason:"RECOVERY_V8_HARD_STOP",referenceTs:ts,targetGross:r.originalGross,createdAt:ts,updatedAt:ts,retryCount:0};
            const fill:any={symbol:SYMBOL,clientOrderId:id,side:"SELL",status:"FILLED",executedQuantity:qty,averagePrice:fills.reduce((n,f)=>n+f.executedQuantity*f.averagePrice,0)/qty,reduceOnly:true,executionUnknown:false,residentLedgerAggregated:true};
            return this.applyResult(state,pending,fill);
        }catch(error){return this.manualReview(state,"PENGU_RECOVERY_STOP_FILL_RECONCILIATION:"+(error instanceof Error?error.message:String(error)));}
    }

    private async reconcileOrdinaryStopFill(state: PenguDualLsV2RunnerState): Promise<PenguDualLsV2TickResult | undefined> {
        const p=state.position;if(!p||p.entryVersion==="RECOVERY_V8")return;
        const actual=actualPosition(await this.dependencies.executor.getPositions());const remaining=actual?Math.abs(actual.quantity):0;
        if(actual && (remaining>p.quantity+1e-8 || positionSide(actual)!==p.side))return this.manualReview(state,"PENGU_RESIDENT_STOP_POSITION_MISMATCH");
        if(actual&&Math.abs(remaining-p.quantity)<=1e-8)return;
        const g=this.dependencies.residentStopGateway!;
        const plan=residentStopPlan({strategy:"PENGU",symbol:SYMBOL,side:p.side,entryTs:p.entryTs,entryPrice:p.entryPrice,quantity:p.quantity,stopFraction:p.side>0?PENGU_DUAL_LS_V2.long.hardStopPct:PENGU_DUAL_LS_V2.short.hardStopPct});
        p.stopLedger=p.stopLedger??appendStopIntent(undefined,plan,p.quantity,p.gross);
        try{
            const proof=await reconcileStopLedger(p.stopLedger,remaining,id=>this.dependencies.executor.reconcileOrder(SYMBOL,id),state.pending);
            await this.dependencies.stateStore.save(state);
            if(remaining>0){
                const active=await g.openOrders(SYMBOL);
                const owned=active.filter(o=>p.stopLedger!.plans.some(a=>a.clientOrderId===o.clientOrderId)&&o.symbol===SYMBOL&&o.side===(p.side>0?"SELL":"BUY")&&o.reduceOnly&&Math.abs(o.quantity-o.executedQuantity-remaining)<=1e-8);
                if(owned.length!==1)return this.manualReview(state,"PENGU_RESIDENT_STOP_REMAINING_PROTECTION_AMBIGUOUS");
                const o=owned[0];
                for(const old of active.filter(a=>a.clientOrderId!==o.clientOrderId&&p.stopLedger!.plans.some(plan=>plan.clientOrderId===a.clientOrderId))){
                    if(old.symbol!==o.symbol||old.side!==o.side||!old.reduceOnly)throw Error("STOP_REPLACEMENT_OLD_IDENTITY");
                    await g.cancel(old.symbol,old.clientOrderId);const check=await g.getOrder(old.symbol,old.clientOrderId);if(!["CANCELED","FILLED","EXPIRED"].includes(check.status))throw Error("STOP_REPLACEMENT_CANCEL_UNVERIFIED");
                }
                const current=await g.getOrder(o.symbol,o.clientOrderId);if(!["NEW","PARTIALLY_FILLED"].includes(current.status)||Math.abs(current.quantity-current.executedQuantity-remaining)>1e-8)throw Error("STOP_REPLACEMENT_CHANGED_DURING_RECONCILIATION");
                p.residentStop={protected:true,clientOrderId:o.clientOrderId,orderId:o.orderId,symbol:o.symbol,side:o.side,quantity:remaining,originalQuantity:o.quantity,stopPrice:o.stopPrice,readBackStatus:"VERIFIED",lastReconciledAt:this.now()};
                if(state.pending?.phase==="planned"&&state.pending.reduceOnly)state.pending.quantity=remaining;
                p.quantity=remaining;p.gross=p.stopLedger.originalGross*remaining/p.stopLedger.originalQuantity;
                await this.dependencies.stateStore.save(state);
                return this.protectOrdinaryPosition(state);
            }
            const ts=proof.updatedAt||this.now();const pending:PenguDualLsV2PendingOrder={idempotencyKey:plan.clientOrderId,clientOrderId:plan.clientOrderId,phase:"submitted",side:plan.side,quantity:p.stopLedger.originalQuantity,reduceOnly:true,referenceTs:ts,createdAt:ts,updatedAt:ts,expectedPrice:proof.averagePrice,reason:"VENUE_RESIDENT_STOP_FILLED",exitReason:p.side>0?"LONG_HARD_STOP":"SHORT_HARD_STOP",targetGross:p.stopLedger.originalGross,retryCount:0};
            const fill:any={symbol:SYMBOL,clientOrderId:pending.clientOrderId,side:plan.side,status:"FILLED",executedQuantity:p.stopLedger.originalQuantity,averagePrice:proof.averagePrice,residentLedgerAggregated:true,reduceOnly:true,executionUnknown:false,updatedAt:ts};
            return this.applyResult(state,pending,fill);
        }catch(error){return this.manualReview(state,"PENGU_RESIDENT_STOP_FILL_RECONCILIATION:"+(error instanceof Error?error.message:String(error)));}
    }

    private async protectOrdinaryPosition(state: PenguDualLsV2RunnerState): Promise<PenguDualLsV2TickResult | undefined> {
        const position = state.position;
        if (!position || position.entryVersion === "RECOVERY_V8" || !this.dependencies.config.residentStopRequired) return;
        const gateway = this.dependencies.residentStopGateway;
        if (!gateway) return this.manualReview(state, "PENGU_RESIDENT_STOP_GATEWAY_UNAVAILABLE");
        try {
            position.residentStop = await ensureResidentStop(gateway, { strategy: "PENGU", symbol: SYMBOL, side: position.side, entryTs: position.entryTs, entryPrice: position.entryPrice, quantity: position.quantity, stopFraction: position.side > 0 ? PENGU_DUAL_LS_V2.long.hardStopPct : PENGU_DUAL_LS_V2.short.hardStopPct }, position.residentStop, this.now(), async plan=>{ position.stopLedger=appendStopIntent(position.stopLedger,plan,position.quantity,position.gross);await this.dependencies.stateStore.save(state); });
            await this.dependencies.stateStore.save(state);
        } catch (error) { if(position.residentStop)position.residentStop={...position.residentStop,protected:false,readBackStatus:"UNVERIFIED"}; return this.manualReview(state, `PENGU_RESIDENT_STOP_UNVERIFIED:${error instanceof Error ? error.message : String(error)}`); }
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
            let now = this.now();
            if (this.dependencies.config.mode === "LIVE") {
                const [account, positions, openOrders] = await Promise.all([
                    this.dependencies.executor.getAccountSnapshot(),
                    this.dependencies.executor.getPositions(),
                    this.dependencies.executor.getOpenOrders(),
                ]);
                // Account snapshots are timestamped when the venue response is
                // observed. Compare them against a clock captured afterwards,
                // never against the pre-request time.
                now = this.now();
                if (!validLiveAccount(account, now)) throw new Error("PENGU_DUAL_LS_PRE_SUBMIT_ACCOUNT_STALE_OR_INVALID");
                if (unmanagedCrossSleeveOpenOrders(openOrders, positions).length > 0) throw new Error("PENGU_DUAL_LS_PRE_SUBMIT_OPEN_ORDER_CONFLICT");
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
                reason: `${pending.reason} entryVersion=${pending.entryVersion || state.position?.entryVersion || "UNKNOWN"}`,
            };
            const result = await this.dependencies.executor.executeMarket(command);
            return this.applyResult(state, pending, result);
        } catch (error) {
            const rateBudget = classifyAsterRateBudgetFailure(error);
            if (rateBudget && !submitted) {
                pending.lastError = rateBudget.reason;
                pending.updatedAt = this.now();
                pending.phase = "planned";
                await this.dependencies.stateStore.save(state);
                this.log.warn("PENGU rate-budget deferred before Aster request", {
                    errorClass: rateBudget.kind,
                    reason: rateBudget.reason,
                    queueWaitMs: rateBudget.waitMs,
                    priority: "NEW_EXPOSURE",
                    decision: "DEFER_NO_EXPOSURE",
                    ordersSent: 0,
                    cancelsSent: 0,
                    positionChangesSent: 0,
                });
                return { status: "failed", message: rateBudget.reason, idempotencyKey: pending.idempotencyKey };
            }
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

    private async tickCore(): Promise<PenguDualLsV2TickResult> {
        if (!this.dependencies.config.enabled) return { status: "disabled", message: "PENGU_DUAL_LS_V2_FINAL is disabled." };
        this.ensureLiveGate();
        let preloadedHistory: PenguDualLsV2History | undefined;
        try {
            const beforeLockState = await this.dependencies.stateStore.load();
            if (!beforeLockState.pending) preloadedHistory = await this.dependencies.marketData.load();
            const sharedPath = this.dependencies.config.portfolioDailyLossStatePath || process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH;
            if (!beforeLockState.pending && sharedPath) {
                await readSharedCryptoDailyRiskWithRolloverRetry(sharedPath, {
                    now: this.now,
                    rolloverGraceMs: 60_000,
                    pollMs: 2_000,
                    maxAttempts: 31,
                });
            }
        } catch {
            // Preserve the existing fail-closed path under the shared lock.
        }
        const ownerId = randomUUID();
        const lock = await this.dependencies.lock.acquire(ownerId);
        if (!lock) return { status: "locked", message: "Another PENGU Dual LS tick owns the account lock." };
        try {
            const state = await this.dependencies.stateStore.load();
            state.lastRunAt = this.now();
            if (state.position && state.position.entryVersion!=="RECOVERY_V8" && this.dependencies.config.residentStopRequired && this.dependencies.residentStopGateway) {
                const stopResult = await this.reconcileOrdinaryStopFill(state);
                if (stopResult) return stopResult;
            }
            if(state.position?.entryVersion==="RECOVERY_V8"){const recoveryFill=await this.reconcileRecoveryV8StopFill(state);if(recoveryFill)return recoveryFill;}
            if (state.pending) return await this.reconcilePending(state);
            const history = preloadedHistory ?? await this.dependencies.marketData.load();
            if (this.dependencies.config.mode === "SHADOW") {
                const signal = buildPenguDualLsV2Signal(history, state.position, this.now(), state.cooldownUntilTs, { recoveryV8Enabled: this.dependencies.config.recoveryV8Enabled === true, v64DynamicLongEnabled: this.dependencies.config.v64DynamicLongEnabled === true });
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
            let quality102Ownership = await readQuality102CausalV1Ownership({ expectedRuntimeSha: process.env.DISDEX_Q102_RUNTIME_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA });
            if (quality102Ownership?.pending) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "Quality102 causal-v1 has a pending order and must reconcile before PENGU can enter.", signal: state.latestSignal || undefined };
            }
            const quality102OpenOrder = openOrders.some((order) => quality102OwnsOrder(quality102Ownership, order));
            const nonQuality102OpenOrders = unmanagedCrossSleeveOpenOrders(openOrders, positions, quality102Ownership);
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
                            entryPrice: state.position.recoveryV8.logicalEntryPrice ?? state.position.recoveryV8.entryPrice,
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
            const protectionBlocked = await this.protectOrdinaryPosition(state);
            if (protectionBlocked) return protectionBlocked;
            if (quality102OpenOrder) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "Quality102 causal-v1 has an in-flight order; PENGU waits for reconciliation." };
            }
            if (nonQuality102OpenOrders.length > 0) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "PENGU Dual LS will not create an order while any account open order exists." };
            }

            const baseSignal = buildPenguDualLsV2Signal(history, state.position, this.now(), state.cooldownUntilTs, { recoveryV8Enabled: this.dependencies.config.recoveryV8Enabled === true, v64DynamicLongEnabled: this.dependencies.config.v64DynamicLongEnabled === true });
            const sharedRisk = await this.sharedRiskStatus();
            const signal: PenguDualLsV2Signal = sharedRisk?.flattenExisting && state.position
                ? {
                    ...baseSignal,
                    side: 0,
                    reason: sharedRisk.reason,
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
                return { status: "held", message: `${sharedRisk.reason} No PENGU position is open; new entries are blocked.`, signal };
            }
            if (sharedRisk && !sharedRisk.flattenExisting && state.position && !reduceOnly && side) {
                await this.dependencies.stateStore.save(state);
                return {
                    status: "held",
                    message: `${sharedRisk.reason} Existing protected PENGU position is retained; exposure-increasing orders are blocked during recovery grace.`,
                    signal,
                };
            }
            if (!reduceOnly && signal.side !== 0) {
                const route = routeForPenguEntryVersion(signal.entryVersion);
                const riskGate = evaluatePenguNewEntryGate(state.riskOverlay || createPenguRiskOverlayState(), route, this.now());
                if (!riskGate.allowed) {
                    const message = `${riskGate.reason}${riskGate.untilTs ? ` until=${riskGate.untilTs}` : ""}`;
                    state.failures = [...state.failures, { occurredAt: this.now(), message }].slice(-100);
                    await this.dependencies.stateStore.save(state);
                    return { status: "held", message, signal };
                }
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
            const grossRiskPath = this.dependencies.config.portfolioDailyLossStatePath || process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH;
            const grossRisk = grossRiskPath
                ? await readSharedCryptoDailyRisk(grossRiskPath, decisionNow).catch(() => ({ ok: false as const }))
                : { ok: false as const };
            const ddGovernorPath = process.env.DISDEX_PORTFOLIO_DD_GOVERNOR_PATH;
            const portfolioDdGovernor = ddGovernorPath
                ? await readPortfolioDdGovernor(ddGovernorPath).catch(() => undefined)
                : undefined;
            let q102StrictPosition = await liveQuality102Position(this.dependencies.executor, workingPositions, quality102Ownership, decisionNow);
            const accountEquity = Math.max(0, finite(workingAccount.walletBalance, workingAccount.availableBalance) + workingPositions.reduce((sum, position) => sum + finite(position.unrealizedPnl), 0));
            if (!(accountEquity > 0)) {
                await this.dependencies.stateStore.save(state);
                return { status: "held", message: "PENGU Dual LS strict planner requires positive mark-to-market account equity.", signal };
            }
            if (!reduceOnly && this.dependencies.v12DynamicAdapter) {
                const residualPreemption = await releaseIdleResidualLongForFormalEntry({
                    executor: this.dependencies.executor,
                    adapter: this.dependencies.v12DynamicAdapter,
                    lock: lock as unknown as AccountLockHandle,
                    positions: workingPositions,
                    causeIdempotencyKey: `${signal.strategyId}|${signal.referenceTs}|${signal.side}|ENTRY`,
                    expectedRuntimeSha: String(process.env.DISDEX_RELEASE_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA || process.env.DISDEX_RUNTIME_SHA || ""),
                    statePath: process.env.DISDEX_IDLE_RESIDUAL_LONG_STATE_PATH,
                    enabled: /^(1|true|yes|on)$/i.test(String(process.env.DISDEX_IDLE_RESIDUAL_LONG_ENABLED || "")),
                    maxSlippageBps: this.dependencies.config.maxSlippageBps,
                    now: this.now,
                });
                if (residualPreemption.status === "blocked") {
                    await this.dependencies.stateStore.save(state);
                    return { status: "held", message: residualPreemption.message, signal };
                }
                if (residualPreemption.status === "reduced") {
                    [workingAccount, workingPositions] = await Promise.all([
                        this.dependencies.executor.getAccountSnapshot(),
                        this.dependencies.executor.getPositions(),
                    ]);
                    quote = await this.dependencies.executor.getMarketQuote(SYMBOL);
                }
            }
            let workingEquity = Math.max(0, finite(workingAccount.walletBalance, workingAccount.availableBalance) + workingPositions.reduce((sum, position) => sum + finite(position.unrealizedPnl), 0));
            let available = 0;
            let requestedGross = 0;
            let targetGross = 0;
            let targetNotional = 0;
            // A single entry decision may perform at most one sidecar
            // reduction cycle.  This bounds the cumulative reduction to the
            // planner's per-sidecar 50% ceiling even when the planner is
            // retried after a fresh venue read-back.
            let hypeZecPreemptionUsed = false;
            const retryAfterHypeZecPreemption = async (desiredGross: number) => {
                if (hypeZecPreemptionUsed || !(desiredGross > 0)) return false;
                const pendingExposure = aggregatePendingExposure(await readPendingExposureRegistry());
                const preemption = await this.releaseHypeZecForPriorityEntry({
                    lock,
                    positions: workingPositions,
                    equity: workingEquity,
                    targetGross: desiredGross,
                    pendingCryptoGross: pendingExposure.cryptoGross,
                    pendingTotalGross: pendingExposure.cryptoGross + pendingExposure.stockGross,
                    signal,
                });
                if (!preemption || preemption.status !== "reduced") return false;
                hypeZecPreemptionUsed = true;
                [workingAccount, workingPositions] = await Promise.all([
                    this.dependencies.executor.getAccountSnapshot(),
                    this.dependencies.executor.getPositions(),
                ]);
                quality102Ownership = await readQuality102CausalV1Ownership({ expectedRuntimeSha: process.env.DISDEX_Q102_RUNTIME_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA });
                quote = await this.dependencies.executor.getMarketQuote(SYMBOL);
                const refreshedNow = this.now();
                if (!validLiveAccount(workingAccount, refreshedNow) || !validLiveQuote(quote, SYMBOL, refreshedNow)) {
                    throw new Error("PENGU_HYPE_ZEC_PREEMPTION_REFRESH_STALE");
                }
                const refreshedOpenOrders = await this.dependencies.executor.getOpenOrders();
                if (unmanagedCrossSleeveOpenOrders(refreshedOpenOrders, workingPositions, quality102Ownership).length > 0) {
                    throw new Error("PENGU_HYPE_ZEC_PREEMPTION_OPEN_ORDER_CONFLICT");
                }
                return true;
            };
            if (!reduceOnly) {
                let accepted: StrictPortfolioIntent | undefined;
                for (let attempt = 0; attempt < 3; attempt += 1) {
                    const plannerNow = this.now();
                    q102StrictPosition = await liveQuality102Position(this.dependencies.executor, workingPositions, quality102Ownership, plannerNow);
                    workingEquity = Math.max(0, finite(workingAccount.walletBalance, workingAccount.availableBalance) + workingPositions.reduce((sum, position) => sum + finite(position.unrealizedPnl), 0));
                    if (!(workingEquity > 0)) throw new Error("PENGU_DUAL_LS_STRICT_EQUITY_INVALID_AFTER_MTM");
                    const reserve = workingEquity * this.dependencies.config.cashReservePct / 100;
                    available = Math.max(0, Math.min(workingAccount.availableBalance, workingEquity - reserve));
                    const grossContract = buildPenguV8StrictGrossContract(signal.targetGross, workingEquity, available);
                    requestedGross = grossContract.requestedGross;
                    targetGross = grossContract.intentGross;
                    targetNotional = grossContract.intentNotionalUsd;
                    const strictPlan = planStrictPortfolio({
                        equity: workingEquity,
                        now: plannerNow,
                        active: strictActivePositions(workingPositions, plannerNow, quality102Ownership, q102StrictPosition),
                        availableBalanceUsd: workingAccount.availableBalance,
                        sharedDailyRisk: grossRisk.ok ? grossRisk.state : undefined,
                        portfolioDdGovernor,
                        pendingExposure: aggregatePendingExposure(await readPendingExposureRegistry()),
                        intents: [{
                            idempotencyKey: `${signal.strategyId}|${signal.referenceTs}|${signal.side}|ENTRY`,
                            strategy: "PENGU_DUAL_LS_V2",
                            symbol: SYMBOL,
                            side: signal.side > 0 ? "LONG" : "SHORT",
                            gross: targetGross,
                            requestedGross,
                            notionalUsd: targetNotional,
                            signalTs: signal.referenceTs,
                        }],
                        maxDataAgeMs: 5 * 60_000,
                    });
                    if (strictPlan.status !== "planned") {
                        const planReason = strictPlan.reason || strictPlan.rejected[0]?.reason;
                        const pendingForCapacity = aggregatePendingExposure(await readPendingExposureRegistry());
                        const sidecarCausesCapacity = isHypeZecSoleSharedCapacityCause({
                            positions: workingPositions,
                            equityUsd: workingEquity,
                            pendingCryptoGross: pendingForCapacity.cryptoGross,
                            pendingTotalGross: pendingForCapacity.cryptoGross + pendingForCapacity.stockGross,
                            candidateGross: targetGross,
                            candidateSymbol: SYMBOL,
                            candidateStrategy: "PENGU_DUAL_LS_V2",
                            cryptoEntryCap: INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap,
                            totalEntryCap: INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap,
                        });
                        if (isSharedCapacityBlock(planReason) && sidecarCausesCapacity && await retryAfterHypeZecPreemption(targetGross)) continue;
                        await this.dependencies.stateStore.save(state);
                        return { status: "held", message: `PENGU Dual LS strict portfolio plan blocked entry: ${planReason || "NO_ACCEPTED_INTENT"}.`, signal };
                    }
                    const fetReduction = strictPlan.reductions.find((reduction) => reduction.strategy === "FET_RESIDUAL");
                    if (fetReduction) {
                        if (!this.dependencies.v12DynamicAdapter) throw new Error("PENGU_FET_PREEMPT_ADAPTER_REQUIRED");
                        const reduced = await reduceFetBrk48ForCoreConflict({
                            executor: this.dependencies.executor,
                            adapter: this.dependencies.v12DynamicAdapter,
                            causeIdempotencyKey: `${signal.strategyId}|${signal.referenceTs}|${signal.side}|ENTRY`,
                            statePath: process.env.FET_BRK48_STATE_PATH,
                            maxSlippageBps: this.dependencies.config.maxSlippageBps,
                            expectedRuntimeSha: process.env.DISDEX_Q102_RUNTIME_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA,
                            now: this.now,
                        });
                        if (reduced.status !== "reduced") throw new Error(`PENGU_FET_PREEMPT_BLOCKED:${reduced.message}`);
                        [workingAccount, workingPositions] = await Promise.all([
                            this.dependencies.executor.getAccountSnapshot(),
                            this.dependencies.executor.getPositions(),
                        ]);
                        quality102Ownership = await readQuality102CausalV1Ownership({ expectedRuntimeSha: process.env.DISDEX_Q102_RUNTIME_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA });
                        quote = await this.dependencies.executor.getMarketQuote(SYMBOL);
                        const refreshedNow = this.now();
                        if (!validLiveAccount(workingAccount, refreshedNow) || !validLiveQuote(quote, SYMBOL, refreshedNow)) {
                            throw new Error("PENGU_FET_PREEMPT_REFRESH_STALE");
                        }
                        const refreshedOpenOrders = await this.dependencies.executor.getOpenOrders();
                        if (unmanagedCrossSleeveOpenOrders(refreshedOpenOrders, workingPositions, quality102Ownership).length > 0) {
                            throw new Error("PENGU_FET_PREEMPT_OPEN_ORDER_CONFLICT");
                        }
                        continue;
                    }
                    const reductions = strictPlan.reductions.filter((reduction) => reduction.strategy === "QUALITY102_CAUSAL_V1");
                    if (strictPlan.reductions.some((reduction) => reduction.strategy !== "QUALITY102_CAUSAL_V1")) {
                        throw new Error("PENGU_STRICT_PORTFOLIO_UNEXPECTED_BASE_REDUCTION");
                    }
                    if (reductions.length > 0) {
                        for (const reduction of reductions) {
                            const reduced = await reduceQuality102CausalV1ForBaseConflict({
                                executor: this.dependencies.executor,
                                residentStopGateway: this.dependencies.residentStopGateway,
                                reduction,
                                causeIdempotencyKey: `${signal.strategyId}|${signal.referenceTs}|${signal.side}|ENTRY`,
                                maxSlippageBps: this.dependencies.config.maxSlippageBps,
                                maxDataAgeMs: 5 * 60_000,
                                expectedRuntimeSha: process.env.DISDEX_Q102_RUNTIME_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA,
                            });
                            if (reduced.status !== "reduced") throw new Error(`QUALITY102_MTM_REDUCTION_BLOCKED:${reduced.message}`);
                        }
                        [workingAccount, workingPositions] = await Promise.all([
                            this.dependencies.executor.getAccountSnapshot(),
                            this.dependencies.executor.getPositions(),
                        ]);
                        quality102Ownership = await readQuality102CausalV1Ownership({ expectedRuntimeSha: process.env.DISDEX_Q102_RUNTIME_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA });
                        quote = await this.dependencies.executor.getMarketQuote(SYMBOL);
                        const refreshedNow = this.now();
                        if (!validLiveAccount(workingAccount, refreshedNow) || !validLiveQuote(quote, SYMBOL, refreshedNow)) {
                            throw new Error("PENGU_DUAL_LS_STRICT_REFRESHED_SNAPSHOT_STALE");
                        }
                        const refreshedOpenOrders = await this.dependencies.executor.getOpenOrders();
                        if (unmanagedCrossSleeveOpenOrders(refreshedOpenOrders, workingPositions, quality102Ownership).length > 0) {
                            throw new Error("PENGU_DUAL_LS_STRICT_REFRESHED_OPEN_ORDER_CONFLICT");
                        }
                        continue;
                    }
                    accepted = strictPlan.accepted.find((intent) => intent.strategy === "PENGU_DUAL_LS_V2");
                    if (!accepted) {
                        const planReason = strictPlan.reason || strictPlan.rejected.find((row) => row.intent.strategy === "PENGU_DUAL_LS_V2")?.reason;
                        const pendingForCapacity = aggregatePendingExposure(await readPendingExposureRegistry());
                        const sidecarCausesCapacity = isHypeZecSoleSharedCapacityCause({
                            positions: workingPositions,
                            equityUsd: workingEquity,
                            pendingCryptoGross: pendingForCapacity.cryptoGross,
                            pendingTotalGross: pendingForCapacity.cryptoGross + pendingForCapacity.stockGross,
                            candidateGross: targetGross,
                            candidateSymbol: SYMBOL,
                            candidateStrategy: "PENGU_DUAL_LS_V2",
                            cryptoEntryCap: INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap,
                            totalEntryCap: INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap,
                        });
                        if (isSharedCapacityBlock(planReason) && sidecarCausesCapacity && await retryAfterHypeZecPreemption(targetGross)) continue;
                        await this.dependencies.stateStore.save(state);
                        return { status: "held", message: `PENGU Dual LS strict portfolio plan blocked entry: ${planReason || "NO_ACCEPTED_INTENT"}.`, signal };
                    }
                    if (accepted.gross + 1e-9 < targetGross && this.dependencies.v12DynamicAdapter) {
                        const trim = await reduceV12DynamicResidualForCoreConflict({
                            adapter: this.dependencies.v12DynamicAdapter,
                            requiredGross: targetGross - accepted.gross,
                            equity: workingEquity,
                            causeIdempotencyKey: `${signal.strategyId}|${signal.referenceTs}|${signal.side}|ENTRY`,
                            statePath: this.dependencies.v12StatePath,
                            maxDataAgeMs: 5 * 60_000,
                            now: this.now,
                        });
                        if (trim.status === "blocked") {
                            throw new Error(`PENGU_V12_DYNAMIC_REDUCTION_BLOCKED:${trim.message}`);
                        }
                        if (trim.status === "reduced" && trim.trimmedGross > 1e-9) {
                            [workingAccount, workingPositions] = await Promise.all([
                                this.dependencies.executor.getAccountSnapshot(),
                                this.dependencies.executor.getPositions(),
                            ]);
                            quality102Ownership = await readQuality102CausalV1Ownership({ expectedRuntimeSha: process.env.DISDEX_Q102_RUNTIME_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA });
                            quote = await this.dependencies.executor.getMarketQuote(SYMBOL);
                            const refreshedNow = this.now();
                            if (!validLiveAccount(workingAccount, refreshedNow) || !validLiveQuote(quote, SYMBOL, refreshedNow)) {
                                throw new Error("PENGU_V12_DYNAMIC_REDUCTION_REFRESH_STALE");
                            }
                            continue;
                        }
                    }
                    requestedGross = accepted.requestedGross ?? requestedGross;
                    if (!isPenguFixedEntryAllocation(accepted.gross, this.dependencies.config.maximumGross)) {
                        await this.dependencies.stateStore.save(state);
                        return { status: "held", message: "PENGU_FIXED1_NO_LOT_SHRINK: full1.0 allocation is unavailable.", signal };
                    }
                    targetGross = PENGU_DUAL_LS_V2.fixedEntryGross;
                    targetNotional = targetGross * workingEquity;
                    break;
                }
                if (!accepted) throw new Error("PENGU_STRICT_PORTFOLIO_REDUCTION_RETRY_EXHAUSTED");
                const finalNow = this.now();
                if (!validLiveAccount(workingAccount, finalNow) || !validLiveQuote(quote, SYMBOL, finalNow)) {
                    throw new Error("PENGU_DUAL_LS_STRICT_FINAL_SNAPSHOT_STALE");
                }
                const finalOpenOrders = await this.dependencies.executor.getOpenOrders();
                if (unmanagedCrossSleeveOpenOrders(finalOpenOrders, workingPositions, quality102Ownership).length > 0) {
                    throw new Error("PENGU_DUAL_LS_STRICT_FINAL_OPEN_ORDER_CONFLICT");
                }
            } else {
                const reserve = workingEquity * this.dependencies.config.cashReservePct / 100;
                available = Math.max(0, Math.min(workingAccount.availableBalance, workingEquity - reserve));
                requestedGross = 0;
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
                reason: reduceOnly ? signal.reason : `${signal.reason} requestedGross=${requestedGross.toFixed(4)} allocatedGross=${targetGross.toFixed(4)} portfolioRemaining=${Math.max(0, this.dependencies.config.portfolioGrossCap - normalizedPositionGross(workingPositions, workingEquity, SYMBOL)).toFixed(4)}`,
                exitReason: reduceOnly ? signal.exit?.reason : undefined,
                referenceTs: signal.referenceTs,
                targetGross,
                requestedGross: reduceOnly ? undefined : requestedGross,
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
                    ? { originalGross: targetGross, remainingGross: targetGross }
                    : undefined,
            };
            let exposureReservation: { reservationId: string } | undefined;
            if (!reduceOnly) {
                if (!lock.reserve || !lock.releaseReservation) {
                    throw new Error("PENGU_PENDING_EXPOSURE_RESERVATION_UNAVAILABLE");
                }
                exposureReservation = await lock.reserve({
                    strategyId: signal.strategyId,
                    symbol: SYMBOL,
                    side: signal.side > 0 ? "LONG" : "SHORT",
                    gross: targetGross,
                    notionalUsd: targetNotional,
                });
            }
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
            // A durable pending row remains active through UNKNOWN/manual-review
            // outcomes. Release it only after the runner has cleared its pending
            // state, which means the venue result was terminally reconciled.
            if (exposureReservation && !state.pending && lock.releaseReservation) {
                await lock.releaseReservation(exposureReservation.reservationId);
            }
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

    async tick(): Promise<PenguDualLsV2TickResult> {
        const result = await this.tickCore();
        try {
            const state = await this.dependencies.stateStore.load();
            if (recordPenguM05ShadowTickOutcome(state, result, this.now())) {
                await this.dependencies.stateStore.save(state);
            }
        } catch (error) {
            // Shadow telemetry is explicitly non-ordering. It must never fail or alter Production execution.
            this.log.warn("PENGU M05 shadow outcome telemetry update failed", {
                message: error instanceof Error ? error.message : String(error),
            });
        }
        return result;
    }
}
