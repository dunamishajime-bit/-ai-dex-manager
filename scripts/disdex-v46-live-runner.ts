import "dotenv/config";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectOpenOrder, type DirectPosition, type DirectTradeExecutor, type DirectTradeResult } from "../lib/direct-trade-executor";
import { DisDexV46AsterMarketDataProvider } from "../lib/disdex-v46-market-data-provider";
import { DisDexV46PortfolioRunner, buildDefaultDisDexV46RunnerConfig, type DisDexV46TickResult } from "../lib/disdex-v46-portfolio-runner";
import { FileDisDexV46RunnerStateStore, type DisDexV46RunnerState } from "../lib/disdex-v46-runner-state";
import { buildDisDexV46AccountLock, CompositeLiveRunnerLock } from "../lib/disdex-v46-account-lock";
import { assertMarketDataFreshness, calculateEquity, DISDEX_V46_MANAGED_SYMBOLS, isV46OwnedOrder, positionsMatch, snapshotPositions } from "../lib/disdex-v46-live-safety";
import { DisDexV46LiveExecutionSafetyExecutor } from "../lib/disdex-v46-live-execution-safety";
import { FileLiveRunnerLock, type LiveRunnerLock } from "../lib/live-runner-state";
import { SignedPaperDirectTradeExecutor } from "../lib/signed-paper-direct-trade-executor";
import { DISDEX_PENGU_DUAL_ENGINE_V46, DISDEX_V46_RUNTIME } from "../config/disdexV46Runtime";
import { selectDisDexV46Executor } from "../lib/disdex-v46-live-gates";
import { FileDisDexV46SettlementAnalysisStore, type DisDexV46ExecutionRecord } from "../lib/disdex-v46-settlement-analysis";
import type { DisDexV35PendingOrder } from "../lib/disdex-v35-runner-state";

function boolEnv(name: string, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(raw.trim());
}

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function mode(): "paper" | "live" {
    return String(process.env.DISDEX_V46_RUNNER_MODE || "paper").toLowerCase() === "live" ? "live" : "paper";
}

let wakeSleep: (() => void) | undefined;

function sleep(ms: number) {
    return new Promise<void>((resolveWait) => {
        const timer = setTimeout(() => {
            wakeSleep = undefined;
            resolveWait();
        }, ms);
        wakeSleep = () => {
            clearTimeout(timer);
            wakeSleep = undefined;
            resolveWait();
        };
    });
}

function isManagedSymbol(symbol: string) {
    return (DISDEX_V46_MANAGED_SYMBOLS as readonly string[]).includes(String(symbol).toUpperCase());
}

function isUnknownPending(state: DisDexV46RunnerState) {
    const pending = state.pending;
    if (!pending) return false;
    return pending.phase === "manual_review" || /unknown/i.test(String(pending.lastError || ""));
}

function oneWayMode(response: { dualSidePosition?: boolean | string }) {
    const value = response.dualSidePosition;
    return !(value === true || String(value).toLowerCase() === "true");
}

function safePositionDetails(positions: DirectPosition[]) {
    return positions
        .filter((position) => isManagedSymbol(position.symbol))
        .map((position) => ({
            symbol: position.symbol.toUpperCase(),
            positionSide: position.positionSide,
            quantity: position.quantity,
            notionalUsd: position.notionalUsd,
        }));
}

function safeOrderDetails(orders: DirectOpenOrder[]) {
    return orders.map((order) => ({
        symbol: order.symbol.toUpperCase(),
        clientOrderId: order.clientOrderId ? "present" : "missing",
        status: order.status,
        quantity: order.quantity,
        executedQuantity: order.executedQuantity,
    }));
}

class DisDexV46ManualReviewError extends Error {
    readonly manualReview = true;
}

async function fileExists(path: string) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function saveManualReview(
    stateStore: FileDisDexV46RunnerStateStore,
    state: DisDexV46RunnerState,
    reason: string,
) {
    state.recovery = { status: "manual_review", startedAt: state.recovery.startedAt || Date.now(), reason };
    if (state.pending && state.pending.phase !== "manual_review") {
        state.pending.phase = "manual_review";
        state.pending.lastError = reason;
        state.pending.updatedAt = Date.now();
    }
    await stateStore.save(state);
    throw new DisDexV46ManualReviewError(reason);
}

function recordRecoveredExecution(state: DisDexV46RunnerState, pending: DisDexV35PendingOrder, result: DirectTradeResult, completedAt: number) {
    if (!pending.reduceOnly || result.executedQuantity <= 0 || result.averagePrice <= 0) return;
    const existing = state.completedExecutions || [];
    if (existing.some((item) => item.idempotencyKey === pending.idempotencyKey)) return;
    const record: DisDexV46ExecutionRecord = {
        idempotencyKey: pending.idempotencyKey,
        clientOrderId: pending.clientOrderId,
        orderId: result.orderId,
        symbol: (result.symbol || pending.symbol).toUpperCase(),
        side: result.side,
        reduceOnly: true,
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

interface LivePreparationResult {
    skip: boolean;
    message?: string;
}

async function prepareLiveTick(input: {
    client: AsterV3Client;
    rawExecutor: AsterDirectTradeExecutor;
    marketData: DisDexV46AsterMarketDataProvider;
    stateStore: FileDisDexV46RunnerStateStore;
    statePath: string;
}) : Promise<LivePreparationResult> {
    const stateFilePresent = await fileExists(input.statePath);
    const state = await input.stateStore.load();
    if (state.recovery.status === "manual_review") {
        throw new DisDexV46ManualReviewError(state.recovery.reason || "V46 recovery is in manual review.");
    }

    const [history, account, positions, openOrders, positionMode] = await Promise.all([
        input.marketData.load(true),
        input.rawExecutor.getAccountSnapshot(),
        input.rawExecutor.getPositions(),
        input.rawExecutor.getOpenOrders(),
        input.client.getPositionMode(),
    ]);
    if (!oneWayMode(positionMode)) {
        await saveManualReview(input.stateStore, state, "Aster account is in Hedge Mode; V46 requires One-way Mode.");
    }
    if (positions.some((position) => position.positionSide !== "BOTH")) {
        await saveManualReview(input.stateStore, state, "Aster returned non-BOTH position data; LIVE execution is stopped.");
    }
    assertMarketDataFreshness(history, Date.now(), {
        core12hMs: numberEnv("DISDEX_V46_CORE_MAX_MARKET_DATA_AGE_MS", 13 * 60 * 60_000),
        hourlyMs: numberEnv("DISDEX_V46_HOURLY_MAX_MARKET_DATA_AGE_MS", 2 * 60 * 60_000),
    });
    const accountSnapshot = calculateEquity(account, positions);
    try {
        if (state.accountSnapshot) {
            const ratio = accountSnapshot.equity / state.accountSnapshot.equity;
            if (!Number.isFinite(ratio) || ratio > 2.5 || ratio < 0.4) {
                await saveManualReview(input.stateStore, state, `LIVE account equity changed abnormally (ratio=${ratio}).`);
            }
        }
    } catch (error) {
        if (error instanceof DisDexV46ManualReviewError) throw error;
        throw error;
    }

    const bootstrap = !stateFilePresent || state.bootstrapRequired;
    if (bootstrap) {
        if (state.pending || isUnknownPending(state)) {
            await saveManualReview(input.stateStore, state, "Initial LIVE bootstrap has pending or UNKNOWN state.");
        }
        const managedPositions = positions.filter((position) => isManagedSymbol(position.symbol));
        if (managedPositions.length) {
            await saveManualReview(input.stateStore, state, `Initial LIVE bootstrap requires managed symbols to be flat: ${JSON.stringify(safePositionDetails(managedPositions))}`);
        }
        if (openOrders.length) {
            await saveManualReview(input.stateStore, state, `Initial LIVE bootstrap requires zero Open Orders: ${JSON.stringify(safeOrderDetails(openOrders))}`);
        }
        state.bootstrapRequired = false;
        state.bootstrapCompletedAt = Date.now();
        state.recovery = { status: "complete", startedAt: state.recovery.startedAt || Date.now(), completedAt: Date.now(), reason: "Initial LIVE bootstrap checks passed." };
        state.positionsSnapshot = snapshotPositions(positions);
        state.accountSnapshot = accountSnapshot;
        state.lastOpenOrderClientOrderIds = [];
        await input.stateStore.save(state);
        return { skip: true, message: "LIVE bootstrap completed; signal evaluation starts on the next tick." };
    }

    if (!state.pending && !positionsMatch(state.positionsSnapshot, positions)) {
        await saveManualReview(input.stateStore, state, `Saved position state does not match Aster positions. Current managed positions: ${JSON.stringify(safePositionDetails(positions))}`);
    }

    if (state.pending) {
        if (isUnknownPending(state)) {
            await saveManualReview(input.stateStore, state, "Saved V46 pending state is UNKNOWN/manual-review; no recovery order will be sent.");
        }
        const matchingOrder = openOrders.find((order) => order.clientOrderId === state.pending?.clientOrderId);
        if (!matchingOrder) {
            await saveManualReview(input.stateStore, state, "Saved pending clientOrderId does not match an Aster Open Order; manual review is required.");
        }
        const reconciled = await input.rawExecutor.reconcileOrder(state.pending.symbol, state.pending.clientOrderId);
        if (reconciled.status === "UNKNOWN") {
            await saveManualReview(input.stateStore, state, "Pending Aster order status is UNKNOWN after recovery reconciliation.");
        }
        if (reconciled.status === "NEW" || reconciled.status === "PARTIALLY_FILLED") {
            state.recovery = { status: "in_progress", startedAt: state.recovery.startedAt || Date.now(), reason: "Matching pending Open Order is being recovered; signal orders are disabled." };
            state.accountSnapshot = accountSnapshot;
            state.positionsSnapshot = snapshotPositions(positions);
            state.lastOpenOrderClientOrderIds = openOrders.map((order) => order.clientOrderId).filter(Boolean);
            await input.stateStore.save(state);
            return { skip: true, message: "Recovery-only: matching pending Open Order remains active; no new signal order." };
        }
        if (reconciled.status === "FILLED" && reconciled.executedQuantity > 0) {
            const recoveredPositions = await input.rawExecutor.getPositions();
            if (recoveredPositions.some((position) => position.positionSide !== "BOTH")) {
                await saveManualReview(input.stateStore, state, "Post-recovery position data is not One-way/BOTH.");
            }
            recordRecoveredExecution(state, state.pending, reconciled, Date.now());
            state.pending = undefined;
            state.recovery = { status: "complete", startedAt: state.recovery.startedAt || Date.now(), completedAt: Date.now(), reason: "Pending order reconciled as filled." };
            state.positionsSnapshot = snapshotPositions(recoveredPositions);
            state.accountSnapshot = calculateEquity(account, recoveredPositions);
            state.lastOpenOrderClientOrderIds = openOrders.map((order) => order.clientOrderId).filter(Boolean);
            await input.stateStore.save(state);
            return { skip: true, message: "Recovery completed after pending order reconciliation; signal evaluation starts on the next tick." };
        }
        await saveManualReview(input.stateStore, state, `Pending order ended in ${reconciled.status}; no automatic retry is allowed.`);
    }

    if (state.recovery.status !== "complete") {
        if (openOrders.length) {
            await saveManualReview(input.stateStore, state, `Recovery found Open Orders without a matching durable pending order: ${JSON.stringify(safeOrderDetails(openOrders))}`);
        }
        state.recovery = { status: "complete", startedAt: state.recovery.startedAt || Date.now(), completedAt: Date.now(), reason: "Durable state and account recovery checks passed." };
        state.accountSnapshot = accountSnapshot;
        state.positionsSnapshot = snapshotPositions(positions);
        state.lastOpenOrderClientOrderIds = [];
        await input.stateStore.save(state);
        return { skip: true, message: "Recovery completed; signal evaluation starts on the next tick." };
    }

    const conflictingOrders = openOrders.filter((order) => isV46OwnedOrder(order) || isManagedSymbol(order.symbol));
    if (conflictingOrders.length) {
        await saveManualReview(input.stateStore, state, `A V46-owned or managed-symbol Open Order has no pending recovery record: ${JSON.stringify(safeOrderDetails(conflictingOrders))}`);
    }
    state.accountSnapshot = accountSnapshot;
    state.positionsSnapshot = snapshotPositions(positions);
    state.lastOpenOrderClientOrderIds = openOrders.map((order) => order.clientOrderId).filter(Boolean);
    await input.stateStore.save(state);
    return { skip: false };
}

async function reconcileAfterTick(input: {
    rawExecutor: AsterDirectTradeExecutor;
    stateStore: FileDisDexV46RunnerStateStore;
    result: DisDexV46TickResult;
}) {
    const [account, positions, openOrders] = await Promise.all([
        input.rawExecutor.getAccountSnapshot(),
        input.rawExecutor.getPositions(),
        input.rawExecutor.getOpenOrders(),
    ]);
    if (positions.some((position) => position.positionSide !== "BOTH")) {
        throw new Error("LIVE post-tick position reconciliation found Hedge Mode position data.");
    }
    const state = await input.stateStore.load();
    state.positionsSnapshot = snapshotPositions(positions);
    state.accountSnapshot = calculateEquity(account, positions);
    state.lastOpenOrderClientOrderIds = openOrders.map((order) => order.clientOrderId).filter(Boolean);
    state.lastRunAt = Date.now();
    if (input.result.status === "manual-review" || state.pending?.phase === "manual_review") {
        state.recovery = { status: "manual_review", startedAt: state.recovery.startedAt || Date.now(), reason: input.result.message };
    }
    await input.stateStore.save(state);
}

async function processSettlementAnalyses(input: {
    stateStore: FileDisDexV46RunnerStateStore;
    marketData: DisDexV46AsterMarketDataProvider;
    settlementStore: FileDisDexV46SettlementAnalysisStore;
}) {
    const state = await input.stateStore.load();
    const executions = state.completedExecutions || [];
    const existing = await input.settlementStore.load();
    const existingKeys = new Set(existing.items.map((item) => item.sourceExecutionKey));
    const hasNewSettlement = executions.some((execution) => execution.reduceOnly && !existingKeys.has(execution.idempotencyKey));
    if (!hasNewSettlement) return;
    const history = await input.marketData.load(true);
    const created = await input.settlementStore.process({ executions, history, now: Date.now() });
    if (created.created > 0 && created.latest) {
        console.log(JSON.stringify({
            event: "disdex-v46-settlement-analysis-created",
            strategyId: created.latest.strategyId,
            symbol: created.latest.symbol,
            outcome: created.latest.outcome,
            netPnlEstimateUsd: created.latest.netPnlEstimateUsd,
            opportunityLeftPct: created.latest.opportunityLeftPct,
            completedAt: created.latest.completedAt,
        }));
    }
}

async function main() {
    const runnerMode = mode();
    const stateRoot = resolve(process.env.DISDEX_V46_STATE_DIR || ".runtime-state/disdex-v46");
    const statePath = resolve(stateRoot, `runner-${runnerMode}.json`);
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V46-PENGU-DualEngine-LIVE/1.0",
    });
    const liveExecutionEnabled = boolEnv("DISDEX_V46_LIVE_EXECUTION_ENABLED", false);
    const productionConfigLiveEnabled = DISDEX_V46_RUNTIME.liveTradingEnabled === true;
    if (runnerMode === "live" && !client.hasTradingCredentials()) {
        throw new Error("V46 live mode requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
    }
    const aster = new AsterDirectTradeExecutor(client, {
        exchangeInfoTtlMs: numberEnv("ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const paperExecutor = new SignedPaperDirectTradeExecutor(aster, {
        statePath: resolve(stateRoot, "paper-portfolio.json"),
        initialBalanceUsd: numberEnv("DISDEX_V46_PAPER_INITIAL_BALANCE_USD", 1000),
        feeBpsPerSide: numberEnv("DISDEX_V46_PAPER_FEE_BPS_PER_SIDE", 6),
        maxGross: numberEnv("DISDEX_V46_PAPER_MAX_GROSS", DISDEX_V46_RUNTIME.maximumGross + 0.05),
    });
    const rawExecutor: DirectTradeExecutor = aster;
    const liveExecutor = new DisDexV46LiveExecutionSafetyExecutor(aster, {
        maximumGross: numberEnv("DISDEX_V46_MAX_GROSS", DISDEX_V46_RUNTIME.maximumGross),
        openOrderFilter: (order) => isV46OwnedOrder(order) || isManagedSymbol(order.symbol),
        positionCheckAttempts: numberEnv("DISDEX_V46_POST_ORDER_POSITION_CHECK_ATTEMPTS", 4),
        positionCheckDelayMs: numberEnv("DISDEX_V46_POST_ORDER_POSITION_CHECK_DELAY_MS", 750),
    });
    const executor: DirectTradeExecutor = selectDisDexV46Executor({
        runnerMode,
        liveExecutionEnabled,
        productionConfigLiveEnabled,
        liveExecutor: liveExecutor as DirectTradeExecutor,
        paperExecutor: paperExecutor as DirectTradeExecutor,
    });
    const marketData = new DisDexV46AsterMarketDataProvider(client, {
        coreLimit: numberEnv("DISDEX_V46_CORE_12H_LIMIT", 400),
        hourlyLimit: numberEnv("DISDEX_V46_HOURLY_LIMIT", 1000),
        fundingLimit: numberEnv("DISDEX_V46_FUNDING_LIMIT", 1000),
        fundingBaseUrl: process.env.ASTER_PUBLIC_FUTURES_BASE_URL || "https://fapi.asterdex.com",
        cacheTtlMs: numberEnv("DISDEX_V46_HISTORY_CACHE_TTL_MS", 5 * 60_000),
        fundingCacheTtlMs: numberEnv("DISDEX_V46_FUNDING_CACHE_TTL_MS", 5 * 60_000),
    });
    const config = buildDefaultDisDexV46RunnerConfig({
        mode: runnerMode,
        liveExecutionEnabled,
        productionConfigLiveEnabled,
        cashReservePct: numberEnv("DISDEX_V46_CASH_RESERVE_PCT", DISDEX_V46_RUNTIME.cashReservePct),
        maxGross: numberEnv("DISDEX_V46_MAX_GROSS", DISDEX_V46_RUNTIME.maximumGross),
        maxSlippageBps: numberEnv("DISDEX_V46_MAX_SLIPPAGE_BPS", DISDEX_V46_RUNTIME.maximumSlippageBps),
        minOrderNotionalUsd: numberEnv("DISDEX_V46_MIN_ORDER_NOTIONAL_USD", DISDEX_V46_RUNTIME.minimumOrderNotionalUsd),
        rebalanceTolerancePct: numberEnv("DISDEX_V46_REBALANCE_TOLERANCE_PCT", DISDEX_V46_RUNTIME.rebalanceTolerancePct),
        maxTransactionRetries: numberEnv("DISDEX_V46_MAX_TRANSACTION_RETRIES", 5),
        closeUnmanagedPositions: boolEnv("DISDEX_V46_CLOSE_UNMANAGED_POSITIONS", DISDEX_V46_RUNTIME.closeUnmanagedPositions),
    });
    const durableState = new FileDisDexV46RunnerStateStore(statePath, runnerMode);
    const settlementStore = new FileDisDexV46SettlementAnalysisStore(resolve(stateRoot, "settlement-analysis.json"));
    const stateLock = new FileLiveRunnerLock(resolve(stateRoot, `runner-${runnerMode}.lock`), numberEnv("DISDEX_V46_LOCK_STALE_MS", 10 * 60_000));
    const noOpLock: LiveRunnerLock = {
        acquire: async (ownerId) => ({ ownerId, acquiredAt: Date.now(), release: async () => undefined }),
    };
    const runner = new DisDexV46PortfolioRunner({
        marketData,
        executor,
        config,
        stateStore: durableState.asV35CompatibleStore(),
        lock: runnerMode === "live" ? noOpLock : stateLock,
    });

    console.log(JSON.stringify({
        event: "disdex-v46-runner-start",
        runnerMode,
        liveExecutionEnabled,
        productionConfigLiveEnabled,
        executor: executor.constructor.name,
        strategyId: DISDEX_V46_RUNTIME.strategyId,
        maximumGross: config.maxGross,
        cashReservePct: config.cashReservePct,
        closeUnmanagedPositions: config.closeUnmanagedPositions,
        pristineForwardEvidence: DISDEX_PENGU_DUAL_ENGINE_V46.evidence.pristineForwardEvidence,
        livePromotionBasis: DISDEX_V46_RUNTIME.livePromotionBasis,
        accountLock: runnerMode === "live",
        recoverySafety: runnerMode === "live",
        settlementAnalysis: "post-settlement-event",
    }));

    const daemon = process.argv.includes("--daemon");
    const intervalMs = Math.max(30_000, numberEnv("DISDEX_V46_RUNNER_INTERVAL_MS", 5 * 60_000));
    const outerLock = runnerMode === "live"
        ? new CompositeLiveRunnerLock([
            buildDisDexV46AccountLock(String(process.env.ASTER_USER_ADDRESS)),
            stateLock,
        ])
        : stateLock;
    let stopping = false;
    let manualReviewStop = false;
    let failed = false;
    const stop = () => { stopping = true; wakeSleep?.(); };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    do {
        let held: { release(): Promise<void> } | null = null;
        try {
            const ownerId = randomUUID();
            held = await outerLock.acquire(ownerId);
            if (!held) {
                console.log(JSON.stringify({ timestamp: new Date().toISOString(), runnerMode, status: "locked", message: "Another V46 runner owns the account/state lock." }));
            } else {
                if (runnerMode === "live") {
                    const preparation = await prepareLiveTick({ client, rawExecutor: aster, marketData, stateStore: durableState, statePath });
                    if (preparation.skip) {
                        console.log(JSON.stringify({ timestamp: new Date().toISOString(), runnerMode, status: "held", message: preparation.message }));
                    } else {
                        const result = await runner.tick();
                        await reconcileAfterTick({ rawExecutor: aster, stateStore: durableState, result });
                        console.log(JSON.stringify({ timestamp: new Date().toISOString(), runnerMode, ...result }));
                        if (result.status === "manual-review") {
                            manualReviewStop = true;
                            stopping = true;
                        }
                    }
                    try {
                        await processSettlementAnalyses({ stateStore: durableState, marketData, settlementStore });
                    } catch (error) {
                        console.error(JSON.stringify({ level: "error", event: "disdex-v46-settlement-analysis-failed", message: error instanceof Error ? error.message : String(error) }));
                    }
                } else {
                    const result = await runner.tick();
                    console.log(JSON.stringify({ timestamp: new Date().toISOString(), runnerMode, ...result }));
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(JSON.stringify({ level: "error", event: "disdex-v46-runner-cycle-failed", message }));
            if (error instanceof DisDexV46ManualReviewError) {
                manualReviewStop = true;
                stopping = true;
            } else if (!daemon) {
                failed = true;
                stopping = true;
            }
        } finally {
            if (held) await held.release();
        }
        if (!daemon || stopping) break;
        await sleep(intervalMs);
    } while (!stopping);

    if (manualReviewStop) {
        console.error(JSON.stringify({ level: "error", event: "disdex-v46-runner-stopped", reason: "manual_review" }));
        return;
    }
    if (failed) process.exitCode = 1;
}

main().catch((error) => {
    console.error(JSON.stringify({ level: "fatal", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
});
