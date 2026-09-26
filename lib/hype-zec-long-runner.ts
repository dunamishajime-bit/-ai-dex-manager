import { createHash } from "node:crypto";

import { assertHypeZecLiveGate, type HypeZecLongRuntime } from "../config/hypeZecLongRuntime";
import { HYPE_ZEC_LONG_POLICY, type HypeZecStrategy } from "../config/hypeZecLongPolicy";
import { classifyAsterSymbol } from "./disdex-aster-portfolio-classifier";
import { aggregatePendingExposure, readPendingExposureRegistry } from "./disdex-pending-exposure-registry";
import { findManagedHypeZecProtectiveOrders } from "./disdex-managed-protective-orders";
import { readQuality102CausalV1Ownership, quality102OwnsPosition } from "./disdex-quality102-causal-v1-ownership";
import { planStrictPortfolio, type StrictPortfolioIntent, type StrictPortfolioPosition } from "./disdex-strict-portfolio-planner";
import type { AccountLockHandle, FileAccountOrderLock } from "./disdex-account-order-lock";
import type { DirectAccountSnapshot, DirectMarketQuote, DirectOpenOrder, DirectPosition, DirectTradeExecutor, DirectTradeResult } from "./direct-trade-executor";
import type { V12AsterLiveAdapter } from "./v12-aster-live-adapter";
import { buildHypeZecProtection, calculateHypeZecQuantity, evaluateHypeLongSignal, evaluateZecLongSignal, type HypeZecSignalResult } from "./hype-zec-long-sleeves";
import type { HypeZecLongMarketData } from "./hype-zec-long-market-data";
import { FileHypeZecLongRunnerStateStore, type HypeZecLongPositionState, type HypeZecLongRunnerState } from "./hype-zec-long-runner-state";

const EPSILON = 1e-9;

export interface HypeZecLongRunnerDependencies {
  marketData: { load(): Promise<HypeZecLongMarketData> };
  executor: DirectTradeExecutor;
  adapter: V12AsterLiveAdapter;
  stateStore: FileHypeZecLongRunnerStateStore;
  lock: FileAccountOrderLock;
  runtime: HypeZecLongRuntime;
  now?: () => number;
  logger?: { info(message: string, payload?: Record<string, unknown>): void; warn(message: string, payload?: Record<string, unknown>): void; error(message: string, payload?: Record<string, unknown>): void };
}

export type HypeZecLongTickResult =
  | { status: "disabled" | "locked" | "shadow" | "held" | "no-change" | "planned" | "completed" | "manual-review"; message: string; strategy?: HypeZecStrategy }
  | { status: "failed"; message: string };

function defaultLogger() {
  return {
    info: (message: string, payload?: Record<string, unknown>) => console.log(JSON.stringify({ level: "info", message, ...(payload || {}) })),
    warn: (message: string, payload?: Record<string, unknown>) => console.warn(JSON.stringify({ level: "warn", message, ...(payload || {}) })),
    error: (message: string, payload?: Record<string, unknown>) => console.error(JSON.stringify({ level: "error", message, ...(payload || {}) })),
  };
}

function positionSide(position: DirectPosition): "LONG" | "SHORT" {
  if (position.positionSide === "LONG") return "LONG";
  if (position.positionSide === "SHORT") return "SHORT";
  return position.quantity < 0 ? "SHORT" : "LONG";
}

function actualPosition(positions: readonly DirectPosition[], symbol: string) {
  return positions.find((position) => position.symbol.toUpperCase() === symbol.toUpperCase() && Math.abs(position.quantity) > EPSILON);
}

function actualQuantity(position: DirectPosition) { return Math.abs(position.quantity); }
function gross(position: DirectPosition, equity: number) { return equity > 0 ? Math.abs(position.notionalUsd) / equity : Number.POSITIVE_INFINITY; }
function hashId(parts: readonly unknown[], prefix: string) { return `${prefix}-${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 27)}`.slice(0, 36); }
function active(order: DirectOpenOrder) { return ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(String(order.status || "").toUpperCase()); }
function hasExposure(result: DirectTradeResult) { return ["FILLED", "PARTIALLY_FILLED"].includes(result.status) && result.executedQuantity > EPSILON; }

function strategyForClassification(sleeve: string): StrictPortfolioPosition["strategy"] | undefined {
  if (sleeve === "V12" || sleeve === "PENGU_DUAL_LS_V2" || sleeve === "FET_RESIDUAL" || sleeve === "V11_EQ" || sleeve === "V50_POST_OPEN_BASIS" || sleeve === "HYPE_LONG" || sleeve === "ZEC_LONG") return sleeve;
  return undefined;
}

export class HypeZecLongRunner {
  private readonly now: () => number;
  private readonly log: NonNullable<HypeZecLongRunnerDependencies["logger"]>;

  constructor(private readonly dependencies: HypeZecLongRunnerDependencies) {
    this.now = dependencies.now || Date.now;
    this.log = dependencies.logger || defaultLogger();
  }

  private liveGate() {
    if (this.dependencies.runtime.mode === "LIVE") assertHypeZecLiveGate(this.dependencies.runtime);
  }

  private async strictPositions(positions: DirectPosition[], now: number) {
    const ownership = await readQuality102CausalV1Ownership({ expectedRuntimeSha: this.dependencies.runtime.runtimeSha || undefined });
    const rows: StrictPortfolioPosition[] = [];
    for (const position of positions.filter((row) => Math.abs(row.quantity) > EPSILON)) {
      const strategy = quality102OwnsPosition(ownership, position)
        ? "QUALITY102_CAUSAL_V1"
        : strategyForClassification(classifyAsterSymbol(position.symbol).sleeve);
      if (!strategy) throw new Error(`HYPE_ZEC_UNKNOWN_ACTIVE_POSITION:${position.symbol}`);
      if (strategy === "QUALITY102_CAUSAL_V1") {
        const q102 = ownership?.position;
        if (!q102) throw new Error(`HYPE_ZEC_Q102_OWNERSHIP_MISSING:${position.symbol}`);
        rows.push({
          id: `aster:q102:${position.symbol.toUpperCase()}`,
          strategy,
          symbol: position.symbol.toUpperCase(),
          side: q102.side > 0 ? "LONG" : "SHORT",
          quantity: actualQuantity(position),
          entryPrice: q102.entryPrice,
          markPrice: position.markPrice,
          entryTs: q102.entryTs,
          updatedAt: position.updatedAt,
          markSource: "LIVE_MARKET_QUOTE",
          markSourceEvidence: { source: "LIVE_MARKET_QUOTE", timestamp: position.updatedAt, price: position.markPrice, crossChecked: true },
        });
        continue;
      }
      rows.push({
        id: `aster:${position.symbol.toUpperCase()}:${position.positionSide}`,
        strategy,
        symbol: position.symbol.toUpperCase(),
        side: positionSide(position),
        quantity: actualQuantity(position),
        entryPrice: position.entryPrice,
        markPrice: position.markPrice,
        entryTs: Math.min(position.updatedAt, now),
        updatedAt: position.updatedAt,
        markSource: strategy === "FET_RESIDUAL" ? "LIVE_MARKET_QUOTE" : undefined,
        markSourceEvidence: strategy === "FET_RESIDUAL"
          ? { source: "LIVE_MARKET_QUOTE", timestamp: position.updatedAt, price: position.markPrice, crossChecked: true }
          : undefined,
      });
    }
    return rows;
  }

  private async filters(symbol: string) {
    const exchangeInfo = await this.dependencies.adapter.client.getExchangeInfo();
    const row = exchangeInfo.symbols.find((item) => item.symbol.toUpperCase() === symbol.toUpperCase() && item.status === "TRADING");
    const tickSize = Number(row?.filters?.find((filter) => filter.filterType === "PRICE_FILTER")?.tickSize);
    const stepSize = Number(row?.filters?.find((filter) => filter.filterType === "LOT_SIZE")?.stepSize);
    if (!(tickSize > 0) || !(stepSize > 0)) throw new Error(`HYPE_ZEC_FILTERS_UNAVAILABLE:${symbol}`);
    return { tickSize, stepSize };
  }

  private async unmanagedOrders(openOrders: DirectOpenOrder[], positions: DirectPosition[]) {
    const managed = new Set(findManagedHypeZecProtectiveOrders(openOrders, positions));
    return openOrders.filter((order) => active(order) && !managed.has(order));
  }

  private async manualReview(state: HypeZecLongRunnerState, reason: string): Promise<HypeZecLongTickResult> {
    state.manualReview = reason;
    state.failures = [...state.failures, { message: reason, occurredAt: this.now() }].slice(-100);
    await this.dependencies.stateStore.save(state);
    this.log.error("hype-zec-live-manual-review", { reason, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 });
    return { status: "manual-review", message: reason };
  }

  private async reconcileOwnership(state: HypeZecLongRunnerState, positions: DirectPosition[], openOrders: DirectOpenOrder[]) {
    const statePositions = state.positions || [];
    const actualSidecars = positions.filter((position) => (position.symbol.toUpperCase() === "HYPEUSDT" || position.symbol.toUpperCase() === "ZECUSDT") && Math.abs(position.quantity) > EPSILON);
    for (const actual of actualSidecars) {
      const owned = statePositions.find((row) => row.symbol === actual.symbol.toUpperCase());
      if (!owned || positionSide(actual) !== "LONG" || Math.abs(actual.quantity - owned.quantity) > Math.max(1e-8, owned.quantity * 0.01)) return `HYPE_ZEC_STATE_POSITION_MISMATCH:${actual.symbol}`;
    }
    for (const owned of statePositions) {
      const actual = actualPosition(positions, owned.symbol);
      if (!actual || positionSide(actual) !== "LONG") return `HYPE_ZEC_STATE_EXPECTS_MISSING_POSITION:${owned.symbol}`;
      const protections = findManagedHypeZecProtectiveOrders(openOrders, [actual]);
      if (protections.length !== 2) return `HYPE_ZEC_PROTECTION_NOT_VERIFIED:${owned.symbol}`;
    }
    return undefined;
  }

  private async exitPosition(state: HypeZecLongRunnerState, owned: HypeZecLongPositionState, actual: DirectPosition, quote: DirectMarketQuote, reason: string, lock: AccountLockHandle): Promise<HypeZecLongTickResult> {
    if (this.dependencies.runtime.mode !== "LIVE") {
      state.lastDecision = { strategy: owned.strategy, signalTs: owned.signalTs, accepted: false, reason: `SHADOW_EXIT_${reason}` };
      state.lastDecisionTs = this.now();
      await this.dependencies.stateStore.save(state);
      return { status: "shadow", message: `HYPE_ZEC_SHADOW_EXIT:${owned.symbol}:${reason}`, strategy: owned.strategy };
    }
    const idempotencyKey = hashId([owned.strategy, owned.symbol, owned.positionId, "EXIT", reason], "hz-exit");
    state.pending = { idempotencyKey, clientOrderId: idempotencyKey, action: "EXIT", strategy: owned.strategy, symbol: owned.symbol, side: "SELL", quantity: actualQuantity(actual), expectedPrice: quote.bidPrice, phase: "planned", createdAt: this.now(), updatedAt: this.now(), reason };
    await this.dependencies.stateStore.save(state);
    let result: DirectTradeResult;
    try {
      state.pending.phase = "submitted";
      await this.dependencies.stateStore.save(state);
      result = await this.dependencies.executor.executeMarket({ requestId: idempotencyKey, clientOrderId: idempotencyKey, symbol: owned.symbol, side: "SELL", positionSide: "BOTH", quantity: actualQuantity(actual), reduceOnly: true, expectedPrice: quote.bidPrice, maxSlippageBps: this.dependencies.runtime.maximumSlippageBps, reason, requireVenueMargin5xCross: true });
    } catch (error) {
      return this.manualReview(state, `HYPE_ZEC_EXIT_ERROR:${error instanceof Error ? error.message : String(error)}`);
    }
    if (result.status === "UNKNOWN" || result.executionUnknown) return this.manualReview(state, `HYPE_ZEC_EXIT_UNKNOWN:${idempotencyKey}`);
    const remaining = await this.dependencies.executor.getPositions();
    if (actualPosition(remaining, owned.symbol)) return this.manualReview(state, `HYPE_ZEC_EXIT_POSITION_REMAINS:${owned.symbol}`);
    const open = await this.dependencies.executor.getOpenOrders();
    for (const order of findManagedHypeZecProtectiveOrders(open, [actual])) await this.dependencies.adapter.cancel(order.clientOrderId);
    state.positions = (state.positions || []).filter((row) => row.positionId !== owned.positionId);
    state.pending = undefined;
    state.lastDecision = { strategy: owned.strategy, signalTs: owned.signalTs, accepted: true, reason: `EXIT:${reason}` };
    state.lastDecisionTs = this.now();
    await this.dependencies.stateStore.save(state);
    await lock.document();
    return { status: "completed", message: `HYPE_ZEC_EXIT_COMPLETED:${owned.symbol}`, strategy: owned.strategy };
  }

  private async enter(state: HypeZecLongRunnerState, signal: HypeZecSignalResult, account: DirectAccountSnapshot, positions: DirectPosition[], lock: AccountLockHandle): Promise<HypeZecLongTickResult> {
    if (!signal.accepted || !signal.entryPrice || !signal.stopPrice || !signal.signalTs) return { status: "no-change", message: signal.reason, strategy: signal.strategy };
    const symbol = signal.symbol;
    const quote = await this.dependencies.executor.getMarketQuote(symbol);
    if (quote.updatedAt > this.now() || this.now() - quote.updatedAt > 5 * 60_000) return { status: "held", message: `HYPE_ZEC_QUOTE_STALE:${symbol}`, strategy: signal.strategy };
    const filters = await this.filters(symbol);
    const protection = buildHypeZecProtection({ strategy: signal.strategy, entryPrice: signal.entryPrice, tickSize: filters.tickSize, quantity: 1, stepSize: filters.stepSize });
    const equity = Math.max(0, account.walletBalance + positions.reduce((sum, position) => sum + Number(position.unrealizedPnl || 0), 0));
    const sizing = calculateHypeZecQuantity({ strategy: signal.strategy, equityUsd: equity, entryPrice: signal.entryPrice, stopPrice: signal.stopPrice, feeBpsPerSide: this.dependencies.runtime.feeBpsPerSide, slippageBps: this.dependencies.runtime.maximumSlippageBps, fundingBps: this.dependencies.runtime.fundingBps, stepSize: filters.stepSize });
    if (!(sizing.quantity > 0)) return { status: "held", message: `HYPE_ZEC_CAPACITY_BLOCKED_BY_MINIMUM:${symbol}`, strategy: signal.strategy };

    const active = await this.strictPositions(positions, this.now());
    const pendingExposure = aggregatePendingExposure(await readPendingExposureRegistry());
    const candidate: StrictPortfolioIntent = {
      idempotencyKey: `${signal.strategy}|${signal.signalTs}|ENTRY`,
      strategy: signal.strategy,
      symbol,
      side: "LONG",
      gross: Math.min(sizing.gross, this.dependencies.runtime.maximumGross),
      requestedGross: Math.min(sizing.gross, this.dependencies.runtime.maximumGross),
      notionalUsd: Math.min(sizing.gross, this.dependencies.runtime.maximumGross) * equity,
      signalTs: signal.signalTs,
    };
    const plan = planStrictPortfolio({
      equity,
      now: this.now(),
      active,
      pendingExposure,
      availableBalanceUsd: account.availableBalance,
      intents: [candidate],
    });
    const accepted = plan.status === "planned" ? plan.accepted.find((intent) => intent.strategy === signal.strategy) : undefined;
    state.lastDecision = { strategy: signal.strategy, signalTs: signal.signalTs, accepted: Boolean(accepted), reason: accepted ? signal.reason : (plan.reason || plan.rejected.find((row) => row.intent.strategy === signal.strategy)?.reason || "CAPACITY_BLOCKED") };
    state.lastDecisionTs = this.now();
    if (!accepted) { await this.dependencies.stateStore.save(state); return { status: "held", message: `HYPE_ZEC_ENTRY_CAPACITY_BLOCKED:${state.lastDecision.reason}`, strategy: signal.strategy }; }
    if (this.dependencies.runtime.mode !== "LIVE") { await this.dependencies.stateStore.save(state); return { status: "shadow", message: `HYPE_ZEC_SHADOW_ENTRY:${symbol}`, strategy: signal.strategy }; }
    const quantity = await this.dependencies.executor.normalizeMarketQuantity(symbol, sizing.quantity * (accepted.gross / Math.max(candidate.gross, EPSILON)), signal.entryPrice);
    if (!(quantity.quantity > 0) || quantity.notional < 1) { await this.dependencies.stateStore.save(state); return { status: "held", message: `HYPE_ZEC_NORMALIZED_MINIMUM_BLOCKED:${symbol}`, strategy: signal.strategy }; }
    const idempotencyKey = hashId([signal.strategy, signal.signalTs, symbol, quantity.quantity], "hz-entry");
    const pendingEntry = { idempotencyKey, clientOrderId: idempotencyKey, action: "ENTRY" as const, strategy: signal.strategy, symbol, side: "BUY" as const, quantity: quantity.quantity, expectedPrice: signal.entryPrice, phase: "planned" as const, createdAt: this.now(), updatedAt: this.now(), reason: signal.reason };
    state.pending = pendingEntry;
    await this.dependencies.stateStore.save(state);
    let result: DirectTradeResult;
    try {
      state.pending.phase = "submitted";
      await this.dependencies.stateStore.save(state);
      result = await this.dependencies.executor.executeMarket({ requestId: idempotencyKey, clientOrderId: idempotencyKey, symbol, side: "BUY", positionSide: "BOTH", quantity: quantity.quantity, expectedPrice: signal.entryPrice, maxSlippageBps: this.dependencies.runtime.maximumSlippageBps, reason: `HYPE_ZEC_${signal.strategy}_ENTRY`, requireVenueMargin5xCross: true });
    } catch (error) {
      return this.manualReview(state, `HYPE_ZEC_ENTRY_ERROR:${error instanceof Error ? error.message : String(error)}`);
    }
    if (result.status === "UNKNOWN" || result.executionUnknown) return this.manualReview(state, `HYPE_ZEC_ENTRY_UNKNOWN:${idempotencyKey}`);
    if (!hasExposure(result)) { state.pending = undefined; await this.dependencies.stateStore.save(state); return { status: "held", message: `HYPE_ZEC_ENTRY_${result.status}_NO_EXPOSURE`, strategy: signal.strategy }; }
    const refreshed = await this.dependencies.executor.getPositions();
    const actual = actualPosition(refreshed, symbol);
    if (!actual || positionSide(actual) !== "LONG") return this.manualReview(state, `HYPE_ZEC_ENTRY_POSITION_MISMATCH:${symbol}`);
    const actualQty = actualQuantity(actual);
    const levels = buildHypeZecProtection({ strategy: signal.strategy, entryPrice: actual.entryPrice || signal.entryPrice, tickSize: filters.tickSize, quantity: actualQty, stepSize: filters.stepSize });
    const stopId = hashId([idempotencyKey, "STOP"], "hz-stop");
    const tpId = hashId([idempotencyKey, "TP"], "hz-tp");
    try {
      await this.dependencies.adapter.placeStopMarket({ symbol, side: "SELL", quantity: levels.quantity, stopPrice: levels.stopPrice, clientOrderId: stopId, reduceOnly: true });
      await this.dependencies.adapter.placeTakeProfit({ symbol, side: "SELL", quantity: levels.quantity, stopPrice: levels.takeProfitPrice, clientOrderId: tpId, reduceOnly: true });
      const readBack = await this.dependencies.executor.getOpenOrders();
      if (findManagedHypeZecProtectiveOrders(readBack, [actual]).length !== 2) throw new Error("HYPE_ZEC_PROTECTION_READBACK_FAILED");
    } catch (error) {
      return this.manualReview(state, `HYPE_ZEC_PROTECTION_INSTALL_FAILED:${error instanceof Error ? error.message : String(error)}`);
    }
    const position: HypeZecLongPositionState = { strategy: signal.strategy, symbol, side: "LONG", positionId: idempotencyKey, quantity: actualQty, entryPrice: actual.entryPrice || signal.entryPrice, entryTs: this.now(), signalTs: signal.signalTs, stopPrice: levels.stopPrice, takeProfitPrice: levels.takeProfitPrice, peakPrice: actual.markPrice || signal.entryPrice, updatedAt: this.now() };
    state.positions = [...(state.positions || []).filter((row) => row.strategy !== signal.strategy), position];
    state.pending = undefined;
    await stateStoreSave(this.dependencies.stateStore, state);
    await lock.document();
    return { status: "completed", message: `HYPE_ZEC_ENTRY_COMPLETED:${symbol}`, strategy: signal.strategy };
  }

  async tick(): Promise<HypeZecLongTickResult> {
    if (!this.dependencies.runtime.enabled) return { status: "disabled", message: "HYPE_ZEC_LONG_DISABLED" };
    this.liveGate();
    const lock = await this.dependencies.lock.acquire(`HYPE_ZEC_LONG:${process.pid}:${Date.now()}`);
    if (!lock) return { status: "locked", message: "HYPE_ZEC_LONG_ACCOUNT_LOCK_BUSY" };
    try {
      const state = await this.dependencies.stateStore.load();
      if (state.manualReview) return { status: "manual-review", message: state.manualReview };
      if (state.pending) return this.manualReview(state, "HYPE_ZEC_PENDING_REQUIRES_RECONCILIATION");
      const [account, positions, openOrders, market] = await Promise.all([
        this.dependencies.executor.getAccountSnapshot(),
        this.dependencies.executor.getPositions(),
        this.dependencies.executor.getOpenOrders(),
        this.dependencies.marketData.load(),
      ]);
      const ownershipIssue = await this.reconcileOwnership(state, positions, openOrders);
      if (ownershipIssue) return this.manualReview(state, ownershipIssue);
      if ((await this.unmanagedOrders(openOrders, positions)).length > 0) return { status: "held", message: "HYPE_ZEC_UNMANAGED_OPEN_ORDER_BLOCK", };
      for (const owned of state.positions || []) {
        const actual = actualPosition(positions, owned.symbol);
        if (!actual) return this.manualReview(state, `HYPE_ZEC_POSITION_MISSING:${owned.symbol}`);
        const quote = await this.dependencies.executor.getMarketQuote(owned.symbol);
        const age = this.now() - quote.updatedAt;
        if (age < 0 || age > 5 * 60_000) return { status: "held", message: `HYPE_ZEC_EXIT_QUOTE_STALE:${owned.symbol}`, strategy: owned.strategy };
        const heldMinutes = (this.now() - owned.entryTs) / 60_000;
        const exit = quote.bidPrice <= owned.stopPrice ? "HARD_STOP" : quote.bidPrice >= owned.takeProfitPrice ? "TAKE_PROFIT" : heldMinutes >= HYPE_ZEC_LONG_POLICY[owned.strategy].signal.holdMinutes ? "MAX_HOLD" : undefined;
        if (exit) return this.exitPosition(state, owned, actual, quote, exit, lock);
      }
      const existingStrategies = new Set((state.positions || []).map((row) => row.strategy));
      const signals: HypeZecSignalResult[] = [
        evaluateHypeLongSignal({ now: this.now(), btc15m: market.btc15m, symbol15m: market.hype15m, symbol1m: market.hype1m }),
        evaluateZecLongSignal({ now: this.now(), btc15m: market.btc15m, symbol15m: market.zec15m, symbol1m: market.zec1m }),
      ];
      for (const signal of signals) {
        if (existingStrategies.has(signal.strategy)) continue;
        const result = await this.enter(state, signal, account, positions, lock);
        if (result.status === "completed" || result.status === "manual-review") return result;
      }
      await this.dependencies.stateStore.save({ ...state, lastDecisionTs: this.now() });
      return { status: "no-change", message: "HYPE_ZEC_NO_ACCEPTED_ENTRY" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.manualReview(await this.dependencies.stateStore.load(), `HYPE_ZEC_RUNNER_FAIL_CLOSED:${message}`);
    } finally {
      await lock.release();
    }
  }
}

async function stateStoreSave(store: FileHypeZecLongRunnerStateStore, state: HypeZecLongRunnerState) {
  await store.save(state);
}
