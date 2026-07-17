import { createHash, randomUUID } from "node:crypto";
import { AsterV3Client, type Aster24hTicker, type AsterBookTicker, type AsterExchangeSymbol, type AsterKline, type AsterPriceTicker } from "@/lib/aster-v3-client";
import {
    type DirectAccountSnapshot,
    type DirectOpenOrder,
    type DirectPosition,
    type DirectTradeCommand,
    type DirectTradeExecutor,
    type DirectTradeResult,
} from "@/lib/direct-trade-executor";
import {
    buildContinuousStrategyMonitor,
    type ContinuousMonitorRuntimeState,
    type ContinuousStrategyCandidate,
    type ContinuousStrategyMonitor,
    type MarketSnapshot,
    type PriceSample,
    type StrategyEngineInput,
} from "@/lib/cycle-strategy";
import {
    STRATEGY_UNIVERSE_SYMBOLS,
    getStrategyAssetMeta,
} from "@/config/strategyUniverse";
import {
    classifyMainStrategyCandidate,
    resolveWin80Ultra90Overlap,
    WIN80_ULTRA90_MAIN_STRATEGY,
    type MainStrategyOverlapAction,
    type MainStrategyTier,
} from "@/lib/win80-ultra90-main-strategy";
import {
    type LiveRunnerLock,
    type LiveRunnerPendingTransaction,
    type LiveRunnerState,
    type LiveRunnerStateStore,
} from "@/lib/live-runner-state";

export const DEFAULT_WIN80_ASTER_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "NEARUSDT", "AVAXUSDT",
    "OPUSDT", "LDOUSDT", "FETUSDT", "LINKUSDT", "AAVEUSDT", "UNIUSDT",
    "DOGEUSDT", "SUIUSDT", "SEIUSDT", "APTUSDT", "ARBUSDT", "PEPEUSDT",
    "WIFUSDT", "BONKUSDT", "PENGUUSDT", "INJUSDT", "DOTUSDT", "LTCUSDT",
    "BCHUSDT", "TRXUSDT", "ADAUSDT", "ASTERUSDT", "WLFIUSDT", "CAKEUSDT",
] as const;

export interface LiveStrategyMarketBundle {
    generatedAt: number;
    latestMarketTimestamp: number;
    exchangeSymbols: string[];
    asterToStrategySymbol: Record<string, string>;
    strategyToAsterSymbol: Record<string, string>;
    marketSnapshots: Record<string, MarketSnapshot | undefined>;
    priceHistory: Record<string, PriceSample[] | undefined>;
}

export interface LiveStrategyMarketDataProvider {
    load(symbols: string[]): Promise<LiveStrategyMarketBundle>;
}

export interface AsterStrategyMarketDataProviderOptions {
    historyInterval?: string;
    historyLimit?: number;
    historyCacheTtlMs?: number;
    historyConcurrency?: number;
}

export interface LiveRunnerLogger {
    info(message: string, payload?: Record<string, unknown>): void;
    warn(message: string, payload?: Record<string, unknown>): void;
    error(message: string, payload?: Record<string, unknown>): void;
}

export interface Win80Ultra90LiveRunnerConfig {
    mode: "paper" | "live";
    liveExecutionEnabled: boolean;
    productionConfigLiveEnabled: boolean;
    symbols: string[];
    maxMarketAgeMs: number;
    cashReservePct: number;
    leverage: number;
    maxInitialNotionalUsd: number;
    maxSlippageBps: number;
    maxConcurrentPositions: number;
    maxTransactionRetries: number;
    minOrderNotionalUsd: number;
}

export interface RunnerTickResult {
    status: "locked" | "no-signal" | "held" | "planned" | "completed" | "failed" | "manual-review";
    message: string;
    candidate?: string;
    tier?: MainStrategyTier;
    action?: MainStrategyOverlapAction;
    idempotencyKey?: string;
}

export interface StrategySelectionContext {
    input: StrategyEngineInput;
    runtimeState: ContinuousMonitorRuntimeState;
}

export type StrategySelector = (context: StrategySelectionContext) => ContinuousStrategyMonitor;

export interface Win80Ultra90LiveRunnerDependencies {
    marketData: LiveStrategyMarketDataProvider;
    executor: DirectTradeExecutor;
    stateStore: LiveRunnerStateStore;
    lock: LiveRunnerLock;
    config: Win80Ultra90LiveRunnerConfig;
    logger?: LiveRunnerLogger;
    selectStrategy?: StrategySelector;
    now?: () => number;
}

function safeNumber(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function asArray<T>(value: T | T[]): T[] {
    return Array.isArray(value) ? value : [value];
}

function baseFromAsterSymbol(symbol: string) {
    return symbol.toUpperCase().replace(/USDT$/, "");
}

function comparableStrategySymbol(symbol: string) {
    return symbol.toUpperCase().replace(/\.SOL$/, "");
}

function buildStrategySymbolMap(asterSymbols: string[]) {
    const strategyUniverse = new Set(STRATEGY_UNIVERSE_SYMBOLS.map((symbol) => symbol.toUpperCase()));
    const asterToStrategySymbol: Record<string, string> = {};
    const strategyToAsterSymbol: Record<string, string> = {};
    for (const asterSymbol of asterSymbols) {
        const normalizedAster = asterSymbol.toUpperCase();
        const base = baseFromAsterSymbol(normalizedAster);
        const strategySymbol = strategyUniverse.has(base)
            ? base
            : strategyUniverse.has(`${base}.SOL`)
                ? `${base}.SOL`
                : undefined;
        if (!strategySymbol) continue;
        asterToStrategySymbol[normalizedAster] = strategySymbol;
        strategyToAsterSymbol[strategySymbol] = normalizedAster;
    }
    return { asterToStrategySymbol, strategyToAsterSymbol };
}

async function mapWithConcurrency<T, U>(
    values: T[],
    concurrency: number,
    mapper: (value: T) => Promise<U>,
): Promise<U[]> {
    const results = new Array<U>(values.length);
    let index = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, values.length)) }, async () => {
        while (index < values.length) {
            const current = index;
            index += 1;
            results[current] = await mapper(values[current]);
        }
    });
    await Promise.all(workers);
    return results;
}

export class AsterStrategyMarketDataProvider implements LiveStrategyMarketDataProvider {
    private readonly historyInterval: string;
    private readonly historyLimit: number;
    private readonly historyCacheTtlMs: number;
    private readonly historyConcurrency: number;
    private exchangeCache?: { expiresAt: number; symbols: AsterExchangeSymbol[] };
    private readonly historyCache = new Map<string, { expiresAt: number; samples: PriceSample[]; latestTimestamp: number }>();

    constructor(
        private readonly client: AsterV3Client,
        options: AsterStrategyMarketDataProviderOptions = {},
    ) {
        this.historyInterval = options.historyInterval || "1h";
        this.historyLimit = Math.max(60, Math.min(500, options.historyLimit ?? 220));
        this.historyCacheTtlMs = Math.max(60_000, options.historyCacheTtlMs ?? 5 * 60_000);
        this.historyConcurrency = Math.max(1, options.historyConcurrency ?? 5);
    }

    private async tradingSymbols() {
        const now = Date.now();
        if (this.exchangeCache && this.exchangeCache.expiresAt > now) return this.exchangeCache.symbols;
        const info = await this.client.getExchangeInfo();
        const symbols = (info.symbols || []).filter((item) => item.status === "TRADING");
        this.exchangeCache = { expiresAt: now + 15 * 60_000, symbols };
        return symbols;
    }

    private async loadHistory(symbol: string) {
        const cached = this.historyCache.get(symbol);
        if (cached && cached.expiresAt > Date.now()) return cached;
        const rows = await this.client.getKlines(symbol, this.historyInterval, this.historyLimit);
        const samples = rows
            .map((row: AsterKline): PriceSample | null => {
                const closeTime = safeNumber(row[6]);
                const close = safeNumber(row[4]);
                return closeTime > 0 && close > 0 ? { ts: closeTime, price: close } : null;
            })
            .filter((sample): sample is PriceSample => sample !== null);
        const value = {
            expiresAt: Date.now() + this.historyCacheTtlMs,
            samples,
            latestTimestamp: samples.at(-1)?.ts || 0,
        };
        this.historyCache.set(symbol, value);
        return value;
    }

    async load(symbols: string[]): Promise<LiveStrategyMarketBundle> {
        const requested = Array.from(new Set(symbols.map((symbol) => symbol.toUpperCase())));
        const trading = await this.tradingSymbols();
        const tradingSet = new Set(trading.map((item) => item.symbol));
        const eligible = requested.filter((symbol) => tradingSet.has(symbol));
        if (!eligible.length) throw new Error("No requested Aster symbols are currently TRADING.");

        const [pricePayload, bookPayload, statsPayload, histories] = await Promise.all([
            this.client.getPriceTickers(),
            this.client.getBookTickers(),
            this.client.get24hTickers(),
            mapWithConcurrency(eligible, this.historyConcurrency, async (symbol) => ({ symbol, history: await this.loadHistory(symbol) })),
        ]);
        const priceMap = new Map(asArray<AsterPriceTicker>(pricePayload).map((item) => [item.symbol, item]));
        const bookMap = new Map(asArray<AsterBookTicker>(bookPayload).map((item) => [item.symbol, item]));
        const statsMap = new Map(asArray<Aster24hTicker>(statsPayload).map((item) => [item.symbol, item]));
        const historyMap = new Map(histories.map((item) => [item.symbol, item.history]));
        const { asterToStrategySymbol, strategyToAsterSymbol } = buildStrategySymbolMap(eligible);
        const marketSnapshots: Record<string, MarketSnapshot | undefined> = {};
        const priceHistory: Record<string, PriceSample[] | undefined> = {};
        let latestMarketTimestamp = 0;

        for (const asterSymbol of eligible) {
            const strategySymbol = asterToStrategySymbol[asterSymbol];
            if (!strategySymbol) continue;
            const priceRow = priceMap.get(asterSymbol);
            const bookRow = bookMap.get(asterSymbol);
            const statsRow = statsMap.get(asterSymbol);
            const history = historyMap.get(asterSymbol);
            const price = safeNumber(priceRow?.price ?? statsRow?.lastPrice);
            const bid = safeNumber(bookRow?.bidPrice);
            const ask = safeNumber(bookRow?.askPrice);
            if (price <= 0 || bid <= 0 || ask <= 0 || ask < bid || !history?.samples.length) continue;
            const mid = (bid + ask) / 2;
            const quoteVolume = safeNumber(statsRow?.quoteVolume);
            const topBookUsd = (safeNumber(bookRow?.bidQty) * bid) + (safeNumber(bookRow?.askQty) * ask);
            const timestamp = Math.max(
                safeNumber(priceRow?.time),
                safeNumber(bookRow?.time),
                safeNumber(statsRow?.closeTime),
                history.latestTimestamp,
                Date.now(),
            );
            latestMarketTimestamp = Math.max(latestMarketTimestamp, timestamp);
            const meta = getStrategyAssetMeta(strategySymbol);
            marketSnapshots[strategySymbol] = {
                price,
                change24h: safeNumber(statsRow?.priceChangePercent),
                volume: quoteVolume,
                liquidity: Math.max(topBookUsd, quoteVolume * 0.005),
                spreadBps: mid > 0 ? ((ask - bid) / mid) * 10_000 : 0,
                marketCap: 0,
                tokenAgeDays: 365,
                txns1h: 100,
                dexPairFound: true,
                executionSupported: true,
                executionChain: meta.chain,
                executionRouteKind: "native",
                executionSource: "aster-v3-futures",
                executionLiquidityUsd: Math.max(topBookUsd, quoteVolume * 0.005),
                executionVolume24hUsd: quoteVolume,
                executionTxns1h: 100,
                source: "aster-v3-futures",
                displaySymbol: meta.displaySymbol,
                chain: meta.chain,
            };
            priceHistory[strategySymbol] = history.samples;
        }

        if (!Object.keys(marketSnapshots).length) {
            throw new Error("Aster market data did not produce any complete strategy snapshots.");
        }
        return {
            generatedAt: Date.now(),
            latestMarketTimestamp,
            exchangeSymbols: eligible,
            asterToStrategySymbol,
            strategyToAsterSymbol,
            marketSnapshots,
            priceHistory,
        };
    }
}

function defaultLogger(): LiveRunnerLogger {
    return {
        info: (message, payload) => console.log(JSON.stringify({ level: "info", message, ...(payload || {}) })),
        warn: (message, payload) => console.warn(JSON.stringify({ level: "warn", message, ...(payload || {}) })),
        error: (message, payload) => console.error(JSON.stringify({ level: "error", message, ...(payload || {}) })),
    };
}

function clientOrderId(idempotencyKey: string, leg: "sell" | "buy", retryCount: number) {
    const digest = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 18);
    return `w80-${digest}-${leg[0]}${retryCount}`.slice(0, 36);
}

function makeIdempotencyKey(input: {
    candidate: ContinuousStrategyCandidate;
    action: MainStrategyOverlapAction;
    sourceSymbol?: string;
    triggerTimestamp: number;
}) {
    return createHash("sha256")
        .update([
            WIN80_ULTRA90_MAIN_STRATEGY.id,
            comparableStrategySymbol(input.candidate.symbol),
            input.action,
            input.sourceSymbol || "cash",
            Math.floor(input.triggerTimestamp / 60_000),
        ].join("|"))
        .digest("hex");
}

function addFailure(state: LiveRunnerState, message: string) {
    state.failures = [...state.failures, {
        idempotencyKey: state.pending?.idempotencyKey,
        phase: state.pending?.phase,
        message,
        occurredAt: Date.now(),
    }].slice(-50);
}

function orderFilled(result: DirectTradeResult) {
    return (result.status === "FILLED" || result.status === "PARTIALLY_FILLED") && result.executedQuantity > 0;
}

function actualQuote(result: DirectTradeResult, fallbackPrice: number) {
    if (result.quoteQuantity > 0) return result.quoteQuantity;
    const price = result.averagePrice > 0 ? result.averagePrice : fallbackPrice;
    return result.executedQuantity * price;
}

export class Win80Ultra90LiveRunner {
    private readonly logger: LiveRunnerLogger;
    private readonly selectStrategy: StrategySelector;
    private readonly now: () => number;

    constructor(private readonly dependencies: Win80Ultra90LiveRunnerDependencies) {
        this.logger = dependencies.logger || defaultLogger();
        this.selectStrategy = dependencies.selectStrategy || ((context) => buildContinuousStrategyMonitor(context.input, context.runtimeState));
        this.now = dependencies.now || Date.now;
    }

    private ensureLiveGate() {
        const config = this.dependencies.config;
        if (config.mode !== "live") return;
        if (!config.liveExecutionEnabled || !config.productionConfigLiveEnabled) {
            throw new Error(
                "Live runner is locked. Both WIN80_LIVE_EXECUTION_ENABLED=true and MAIN_STRATEGY_REAL_TRADING_ENABLED=true are required.",
            );
        }
    }

    private strategyInput(
        market: LiveStrategyMarketBundle,
        positions: DirectPosition[],
        referenceTs: number,
    ): StrategyEngineInput {
        return {
            referenceTs,
            marketSnapshots: market.marketSnapshots,
            priceHistory: market.priceHistory,
            positions: positions
                .filter((position) => position.quantity > 0)
                .map((position) => {
                    const strategySymbol = market.asterToStrategySymbol[position.symbol];
                    return strategySymbol ? {
                        symbol: strategySymbol,
                        amount: Math.abs(position.quantity),
                        entryPrice: position.entryPrice,
                    } : null;
                })
                .filter((position): position is { symbol: string; amount: number; entryPrice: number } => position !== null),
            cyclePerformance: [],
        };
    }

    private runtimeState(
        market: LiveStrategyMarketBundle,
        positions: DirectPosition[],
        openOrders: DirectOpenOrder[],
    ): ContinuousMonitorRuntimeState {
        return {
            openSymbols: positions
                .map((position) => market.asterToStrategySymbol[position.symbol])
                .filter((symbol): symbol is string => Boolean(symbol)),
            pendingSymbols: openOrders
                .map((order) => market.asterToStrategySymbol[order.symbol])
                .filter((symbol): symbol is string => Boolean(symbol)),
            recentTrades: [],
        };
    }

    private longPositions(positions: DirectPosition[]) {
        const unsupported = positions.filter((position) => position.quantity < 0 || position.positionSide === "SHORT");
        if (unsupported.length) {
            throw new Error(`Manual review required: short/negative positions detected (${unsupported.map((item) => item.symbol).join(", ")}).`);
        }
        return positions.filter((position) => position.quantity > 0 && position.notionalUsd >= 0.5);
    }

    private async persistFailure(state: LiveRunnerState, error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (state.pending) {
            state.pending.retryCount += 1;
            state.pending.lastError = message;
            state.pending.updatedAt = this.now();
            if (state.pending.retryCount >= this.dependencies.config.maxTransactionRetries) {
                state.pending.phase = "manual_review";
            } else if (state.pending.phase === "target_buy_submitted") {
                state.pending.phase = state.pending.sourceSymbol ? "source_sell_confirmed" : "planned";
                state.pending.targetClientOrderId = undefined;
            } else if (state.pending.phase === "source_sell_submitted") {
                // The source order may have executed. Keep submitted state and reconcile; never resubmit it.
            } else {
                state.pending.phase = "failed";
            }
        }
        addFailure(state, message);
        await this.dependencies.stateStore.save(state);
        this.logger.error("Win80 runner transaction failed", { message, phase: state.pending?.phase });
    }

    private async reconcileSubmittedLeg(
        state: LiveRunnerState,
        pending: LiveRunnerPendingTransaction,
        leg: "source" | "target",
    ) {
        const symbol = leg === "source" ? pending.sourceSymbol : pending.incomingSymbol;
        const orderId = leg === "source" ? pending.sourceClientOrderId : pending.targetClientOrderId;
        if (!symbol || !orderId) throw new Error(`Cannot reconcile ${leg} leg without symbol/clientOrderId.`);
        const result = await this.dependencies.executor.reconcileOrder(symbol, orderId);
        if (result.status === "UNKNOWN") {
            pending.retryCount += 1;
            pending.lastError = result.error || `${leg} order remains UNKNOWN.`;
            pending.updatedAt = this.now();
            if (pending.retryCount >= this.dependencies.config.maxTransactionRetries) pending.phase = "manual_review";
            await this.dependencies.stateStore.save(state);
            return false;
        }
        if (!orderFilled(result)) {
            throw new Error(`${leg} order ended with ${result.status} and no fill.`);
        }
        if (leg === "source") {
            pending.sourceExecutedQuantity = result.executedQuantity;
            pending.sourceAveragePrice = result.averagePrice;
            pending.sourceQuoteQuantity = actualQuote(result, pending.targetNotionalUsd / Math.max(result.executedQuantity, 1e-12));
            pending.targetNotionalUsd = Math.max(pending.sourceQuoteQuantity, this.dependencies.config.minOrderNotionalUsd);
            pending.phase = "source_sell_confirmed";
        } else {
            pending.phase = "completed";
            state.lastCompletedIdempotencyKey = pending.idempotencyKey;
            state.pending = undefined;
        }
        pending.updatedAt = this.now();
        await this.dependencies.stateStore.save(state);
        return true;
    }

    private async executePending(
        state: LiveRunnerState,
        market: LiveStrategyMarketBundle,
    ): Promise<RunnerTickResult> {
        const pending = state.pending;
        if (!pending) return { status: "held", message: "No pending transaction." };
        if (pending.phase === "manual_review") {
            return {
                status: "manual-review",
                message: pending.lastError || "Pending transaction requires manual review.",
                candidate: pending.incomingSymbol,
                tier: pending.incomingTier,
                action: pending.action,
                idempotencyKey: pending.idempotencyKey,
            };
        }
        try {
            if (pending.phase === "source_sell_submitted") {
                const resolved = await this.reconcileSubmittedLeg(state, pending, "source");
                if (!resolved) {
                    return { status: state.pending?.phase === "manual_review" ? "manual-review" : "held", message: "Source sell status is still unknown.", idempotencyKey: pending.idempotencyKey };
                }
            }
            if (pending.phase === "target_buy_submitted") {
                const resolved = await this.reconcileSubmittedLeg(state, pending, "target");
                if (!resolved) {
                    return { status: state.pending?.phase === "manual_review" ? "manual-review" : "held", message: "Target buy status is still unknown.", idempotencyKey: pending.idempotencyKey };
                }
                if (!state.pending) {
                    return { status: "completed", message: "Target buy reconciled and transaction completed.", idempotencyKey: pending.idempotencyKey };
                }
            }

            if (pending.sourceSymbol && pending.phase === "planned") {
                const sourcePosition = (await this.dependencies.executor.getPositions())
                    .find((position) => position.symbol === pending.sourceSymbol && position.quantity > 0);
                if (!sourcePosition) throw new Error(`Source position disappeared before rotation: ${pending.sourceSymbol}`);
                const requestedQuantity = Math.min(
                    sourcePosition.quantity,
                    sourcePosition.quantity * safeNumber(pending.sourceSellFraction),
                );
                pending.sourceQuantity = requestedQuantity;
                pending.sourceClientOrderId = pending.sourceClientOrderId || clientOrderId(pending.idempotencyKey, "sell", pending.retryCount);
                pending.phase = "source_sell_submitted";
                pending.updatedAt = this.now();
                await this.dependencies.stateStore.save(state);
                const sell: DirectTradeCommand = {
                    requestId: `${pending.idempotencyKey}:source`,
                    clientOrderId: pending.sourceClientOrderId,
                    symbol: pending.sourceSymbol,
                    side: "SELL",
                    quantity: requestedQuantity,
                    positionSide: "BOTH",
                    reduceOnly: true,
                    expectedPrice: sourcePosition.markPrice,
                    maxSlippageBps: this.dependencies.config.maxSlippageBps,
                    reason: pending.reason,
                };
                const result = await this.dependencies.executor.executeMarket(sell);
                if (result.status === "UNKNOWN") {
                    pending.lastError = result.error || "Source sell execution is unknown.";
                    await this.dependencies.stateStore.save(state);
                    return { status: "held", message: pending.lastError, idempotencyKey: pending.idempotencyKey };
                }
                if (!orderFilled(result)) throw new Error(`Source sell was not filled (${result.status}).`);
                pending.sourceExecutedQuantity = result.executedQuantity;
                pending.sourceAveragePrice = result.averagePrice;
                pending.sourceQuoteQuantity = actualQuote(result, sourcePosition.markPrice);
                pending.targetNotionalUsd = Math.max(pending.sourceQuoteQuantity, this.dependencies.config.minOrderNotionalUsd);
                pending.phase = "source_sell_confirmed";
                pending.updatedAt = this.now();
                await this.dependencies.stateStore.save(state);
            }

            if (pending.phase === "planned" || pending.phase === "source_sell_confirmed" || pending.phase === "failed") {
                const quote = await this.dependencies.executor.getMarketQuote(pending.incomingSymbol);
                const requestedQuantity = pending.targetNotionalUsd / quote.askPrice;
                const normalized = await this.dependencies.executor.normalizeMarketQuantity(
                    pending.incomingSymbol,
                    requestedQuantity,
                    quote.askPrice,
                );
                pending.targetQuantity = normalized.quantity;
                pending.targetClientOrderId = pending.targetClientOrderId || clientOrderId(pending.idempotencyKey, "buy", pending.retryCount);
                pending.phase = "target_buy_submitted";
                pending.updatedAt = this.now();
                await this.dependencies.stateStore.save(state);
                const buy: DirectTradeCommand = {
                    requestId: `${pending.idempotencyKey}:target`,
                    clientOrderId: pending.targetClientOrderId,
                    symbol: pending.incomingSymbol,
                    side: "BUY",
                    quantity: normalized.quantity,
                    positionSide: "BOTH",
                    reduceOnly: false,
                    expectedPrice: quote.askPrice,
                    maxSlippageBps: this.dependencies.config.maxSlippageBps,
                    reason: pending.reason,
                };
                const result = await this.dependencies.executor.executeMarket(buy);
                if (result.status === "UNKNOWN") {
                    pending.lastError = result.error || "Target buy execution is unknown.";
                    await this.dependencies.stateStore.save(state);
                    return { status: "held", message: pending.lastError, idempotencyKey: pending.idempotencyKey };
                }
                if (!orderFilled(result)) throw new Error(`Target buy was not filled (${result.status}).`);
                pending.phase = "completed";
                pending.updatedAt = this.now();
                state.lastCompletedIdempotencyKey = pending.idempotencyKey;
                state.pending = undefined;
                await this.dependencies.stateStore.save(state);
                this.logger.info("Win80 runner transaction completed", {
                    incomingSymbol: pending.incomingSymbol,
                    action: pending.action,
                    executedQuantity: result.executedQuantity,
                    averagePrice: result.averagePrice,
                });
                return {
                    status: "completed",
                    message: `${pending.action} completed for ${pending.incomingSymbol}.`,
                    candidate: pending.incomingSymbol,
                    tier: pending.incomingTier,
                    action: pending.action,
                    idempotencyKey: pending.idempotencyKey,
                };
            }
            return { status: "held", message: `Pending transaction is in ${pending.phase}.`, idempotencyKey: pending.idempotencyKey };
        } catch (error) {
            await this.persistFailure(state, error);
            return {
                status: state.pending?.phase === "manual_review" ? "manual-review" : "failed",
                message: error instanceof Error ? error.message : String(error),
                candidate: pending.incomingSymbol,
                tier: pending.incomingTier,
                action: pending.action,
                idempotencyKey: pending.idempotencyKey,
            };
        }
    }

    async tick(): Promise<RunnerTickResult> {
        this.ensureLiveGate();
        const ownerId = randomUUID();
        const lock = await this.dependencies.lock.acquire(ownerId);
        if (!lock) return { status: "locked", message: "Another live runner tick owns the execution lock." };
        try {
            const state = await this.dependencies.stateStore.load();
            state.lastRunAt = this.now();
            await this.dependencies.stateStore.save(state);
            if (state.pending && !["completed", "idle"].includes(state.pending.phase)) {
                return await this.executePending(state, await this.dependencies.marketData.load(this.dependencies.config.symbols));
            }

            const [market, account, rawPositions, openOrders] = await Promise.all([
                this.dependencies.marketData.load(this.dependencies.config.symbols),
                this.dependencies.executor.getAccountSnapshot(),
                this.dependencies.executor.getPositions(),
                this.dependencies.executor.getOpenOrders(),
            ]);
            const now = this.now();
            const marketAge = Math.max(0, now - market.latestMarketTimestamp);
            if (marketAge > this.dependencies.config.maxMarketAgeMs) {
                throw new Error(`Stale Aster market data: ${marketAge}ms old.`);
            }
            const positions = this.longPositions(rawPositions);
            const input = this.strategyInput(market, positions, now);
            const runtimeState = this.runtimeState(market, positions, openOrders);
            const monitor = this.selectStrategy({ input, runtimeState });
            const candidate = monitor.selected[0];
            if (!candidate) return { status: "no-signal", message: "No WIN80/ULTRA90 candidate passed the realtime gate." };
            const tier = classifyMainStrategyCandidate(candidate);
            if (tier === "BLOCKED") return { status: "no-signal", message: "Selected candidate failed final WIN80 classification.", candidate: candidate.symbol, tier };
            const incomingSymbol = market.strategyToAsterSymbol[candidate.symbol];
            if (!incomingSymbol) throw new Error(`No Aster execution mapping for strategy symbol ${candidate.symbol}.`);
            if (openOrders.some((order) => order.symbol === incomingSymbol)) {
                return { status: "held", message: `Open order already exists for ${incomingSymbol}.`, candidate: incomingSymbol, tier };
            }
            const samePosition = positions.find((position) => position.symbol === incomingSymbol);
            if (samePosition) {
                return { status: "held", message: `Same symbol ${incomingSymbol} is already open; pyramiding is disabled.`, candidate: incomingSymbol, tier, action: "HOLD_SAME" };
            }
            if (positions.length >= this.dependencies.config.maxConcurrentPositions) {
                return { status: "held", message: `Maximum ${this.dependencies.config.maxConcurrentPositions} positions already open.`, candidate: incomingSymbol, tier };
            }
            const source = [...positions].sort((left, right) => right.notionalUsd - left.notionalUsd)[0];
            const overlap = resolveWin80Ultra90Overlap({
                current: source ? { symbol: market.asterToStrategySymbol[source.symbol] || source.symbol, pnlPct: source.pnlPct, usdValue: source.notionalUsd } : null,
                incoming: candidate,
            });
            if (overlap.action === "HOLD_SAME" || overlap.action === "REJECT") {
                return { status: "held", message: overlap.reason, candidate: incomingSymbol, tier, action: overlap.action };
            }
            const initialNotional = Math.min(
                account.availableBalance * Math.max(0, 1 - (this.dependencies.config.cashReservePct / 100)) * this.dependencies.config.leverage,
                this.dependencies.config.maxInitialNotionalUsd,
            );
            const targetNotionalUsd = overlap.action === "OPEN_FULL"
                ? initialNotional
                : Math.max(this.dependencies.config.minOrderNotionalUsd, safeNumber(source?.notionalUsd) * overlap.sourceSellFraction);
            if (targetNotionalUsd < this.dependencies.config.minOrderNotionalUsd) {
                return { status: "held", message: `Target notional ${targetNotionalUsd.toFixed(2)} is below runner minimum.`, candidate: incomingSymbol, tier, action: overlap.action };
            }
            const idempotencyKey = makeIdempotencyKey({
                candidate,
                action: overlap.action,
                sourceSymbol: source?.symbol,
                triggerTimestamp: monitor.triggerUpdatedAt,
            });
            if (state.lastCompletedIdempotencyKey === idempotencyKey) {
                return { status: "held", message: "This signal/action was already completed.", candidate: incomingSymbol, tier, action: overlap.action, idempotencyKey };
            }
            const pending: LiveRunnerPendingTransaction = {
                idempotencyKey,
                phase: "planned",
                action: overlap.action as "OPEN_FULL" | "SPLIT_50" | "SWITCH_70",
                incomingSymbol,
                incomingStrategySymbol: candidate.symbol,
                incomingTier: tier,
                sourceSymbol: source?.symbol,
                sourceSellFraction: overlap.sourceSellFraction,
                targetNotionalUsd,
                createdAt: now,
                updatedAt: now,
                retryCount: 0,
                reason: `${WIN80_ULTRA90_MAIN_STRATEGY.id}: ${overlap.reason}`,
            };
            state.pending = pending;
            await this.dependencies.stateStore.save(state);
            this.logger.info("Win80 runner planned transaction", {
                candidate: incomingSymbol,
                tier,
                action: overlap.action,
                sourceSymbol: source?.symbol,
                targetNotionalUsd,
                idempotencyKey,
                mode: this.dependencies.config.mode,
            });
            return await this.executePending(state, market);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error("Win80 runner tick failed", { message });
            return { status: /manual review/i.test(message) ? "manual-review" : "failed", message };
        } finally {
            await lock.release();
        }
    }
}

export function buildDefaultLiveRunnerConfig(input: Partial<Win80Ultra90LiveRunnerConfig> = {}): Win80Ultra90LiveRunnerConfig {
    return {
        mode: input.mode || "paper",
        liveExecutionEnabled: input.liveExecutionEnabled === true,
        productionConfigLiveEnabled: input.productionConfigLiveEnabled === true,
        symbols: input.symbols?.length ? input.symbols.map((symbol) => symbol.toUpperCase()) : [...DEFAULT_WIN80_ASTER_SYMBOLS],
        maxMarketAgeMs: Math.max(5000, input.maxMarketAgeMs ?? 30_000),
        cashReservePct: Math.min(50, Math.max(0, input.cashReservePct ?? 2)),
        leverage: Math.min(5, Math.max(0.1, input.leverage ?? 1)),
        maxInitialNotionalUsd: Math.max(1, input.maxInitialNotionalUsd ?? 10_000),
        maxSlippageBps: Math.max(1, input.maxSlippageBps ?? 35),
        maxConcurrentPositions: Math.max(1, input.maxConcurrentPositions ?? WIN80_ULTRA90_MAIN_STRATEGY.maxConcurrentPositions),
        maxTransactionRetries: Math.max(1, input.maxTransactionRetries ?? 5),
        minOrderNotionalUsd: Math.max(1, input.minOrderNotionalUsd ?? 5),
    };
}
