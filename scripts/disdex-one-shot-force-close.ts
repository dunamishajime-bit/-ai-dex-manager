import "dotenv/config";

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectPosition, type DirectTradeResult } from "../lib/direct-trade-executor";
import { FileAccountOrderLock, type AccountLockHandle } from "../lib/disdex-account-order-lock";
import { classifyAsterSymbol } from "../lib/disdex-aster-portfolio-classifier";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";
import {
  ONE_SHOT_FORCE_CLOSE_REQUESTS,
  FileOneShotForceCloseStateStore,
  closeClientOrderId,
  createOneShotPlan,
  isOneShotStrategyPosition,
  markCloseSubmitted,
  markEntryPending,
  planDueCloseOrders,
  recordCloseExecution,
  recordEntryExecution,
  type OneShotForceCloseRequest,
  type OneShotForceCloseState,
  type OneShotLegState,
  type OneShotOwner,
} from "../lib/disdex-one-shot-force-close";
import { FileV12X1AllRunnerStateStore, type V12X1AllRunnerState } from "../lib/v12-x1-all-runner-state";
import { createPenguDualLsV2RunnerState, FilePenguDualLsV2RunnerStateStore, type PenguDualLsV2RunnerState } from "../lib/pengu-dual-ls-v2-runner-state";
import { createQuality102CausalV1State, FileQuality102CausalV1StateStore, type Quality102CausalV1State } from "../lib/disdex-quality102-causal-v1-state";
import { protectiveLevels } from "../lib/v12-x1-all";

const ONE_SHOT_ACK = "I_ACCEPT_ONE_SHOT_REAL_ORDERS_20260908";
const HOUR_MS = 3_600_000;
const MAX_DATA_AGE_MS = 90_000;
const SLEEP_MS = 15_000;
const QUANTITY_EPSILON = 1e-10;

function boolEnv(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function requiredString(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`ONE_SHOT_REQUIRED_ENV:${name}`);
  return value;
}

function runtimeSha(): string {
  const value = String(process.env.DISDEX_RUNTIME_COMMIT_SHA || process.env.DISDEX_RELEASE_SHA || process.env.DISDEX_V96_RUNTIME_COMMIT_SHA || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("ONE_SHOT_RUNTIME_SHA_REQUIRED");
  return value;
}

function currentTimestamp(): number {
  const value = Date.now();
  if (!Number.isFinite(value) || value <= 0) throw new Error("ONE_SHOT_LOCAL_CLOCK_INVALID");
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function sideOf(position: DirectPosition): "LONG" | "SHORT" {
  if (position.positionSide === "SHORT") return "SHORT";
  if (position.positionSide === "LONG") return "LONG";
  return position.quantity < 0 ? "SHORT" : "LONG";
}

function nonZero(position: DirectPosition): boolean {
  return Math.abs(position.quantity) > QUANTITY_EPSILON;
}

function statePaths() {
  const v12 = resolveV12X1AllRuntime(process.env);
  const penguRoot = resolve(process.env.PENGU_DUAL_LS_V2_STATE_DIR || ".runtime-state/pengu-dual-ls-v2");
  const q102Root = resolve(process.env.QUALITY102_CAUSAL_V1_STATE_DIR || ".runtime-state/quality102-causal-v1");
  return {
    v12: resolve(v12.statePath),
    pengu: resolve(process.env.PENGU_DUAL_LS_V2_STATE_PATH || resolve(penguRoot, "runner-live.json")),
    q102: resolve(process.env.QUALITY102_CAUSAL_V1_STATE_PATH || resolve(q102Root, "state.json")),
    lock: resolve(process.env.DISDEX_ACCOUNT_LOCK_PATH || ".runtime-state/shared/account-order.lock"),
    risk: resolve(v12.riskPath),
    oneShot: resolve(process.env.DISDEX_ONE_SHOT_FORCE_CLOSE_STATE_PATH || ".runtime-state/one-shot-force-close-20260908.json"),
  };
}

function assertProductionLiveGates(sha: string) {
  if (String(process.env.V12_X1_ALL_MODE || "").toUpperCase() !== "LIVE"
    || !boolEnv("V12_X1_ALL_ENABLED")
    || !boolEnv("V12_X1_ALL_LIVE_TRADING_ENABLED")
    || !boolEnv("V12_X1_ALL_LIVE_EXECUTION_ENABLED")
    || !boolEnv("DISDEX_V12_LIVE_ALLOW_REAL_ORDERS")) {
    throw new Error("ONE_SHOT_V12_LIVE_GATES_NOT_ALL_ENABLED");
  }
  if (String(process.env.PENGU_DUAL_LS_V2_MODE || "").toUpperCase() !== "LIVE"
    || !boolEnv("PENGU_DUAL_LS_V2_ENABLED")
    || !boolEnv("PENGU_DUAL_LS_V2_LIVE_TRADING_ENABLED")
    || !boolEnv("PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED")) {
    throw new Error("ONE_SHOT_PENGU_LIVE_GATES_NOT_ALL_ENABLED");
  }
  if (String(process.env.QUALITY102_CAUSAL_V1_MODE || "").toUpperCase() !== "LIVE"
    || !boolEnv("QUALITY102_CAUSAL_V1_ENABLED")
    || !boolEnv("QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED")
    || !boolEnv("QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED")
    || !boolEnv("QUALITY102_CAUSAL_V1_OPERATOR_ARMED")) {
    throw new Error("ONE_SHOT_Q102_LIVE_GATES_NOT_ALL_ENABLED");
  }
  if (boolEnv("QUALITY102_LIVE_SELECTOR_PARITY") || boolEnv("QUALITY102_LIVE_ENABLED")) {
    throw new Error("ONE_SHOT_HISTORICAL_Q102_SELECTOR_MUST_REMAIN_DISABLED");
  }
  const releaseSha = String(process.env.DISDEX_RELEASE_SHA || process.env.V12_LIVE_COMMIT_SHA || sha).trim().toLowerCase();
  if (releaseSha !== sha || String(process.env.V12_LIVE_ACK || "").trim().toLowerCase() !== releaseSha) throw new Error("ONE_SHOT_V12_RELEASE_ACK_MISMATCH");
  if (String(process.env.QUALITY102_CAUSAL_V1_LIVE_ACK || "").trim().toLowerCase() !== sha) throw new Error("ONE_SHOT_Q102_RELEASE_ACK_MISMATCH");
}

function createExecutor(): { client: AsterV3Client; executor: AsterDirectTradeExecutor } {
  const release = runtimeSha();
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
    recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5_000),
    userAgent: `DisDex-OneShot-ForceClose/${release.slice(0, 12)}`,
  });
  if (!client.hasTradingCredentials()) throw new Error("ONE_SHOT_ASTER_CREDENTIALS_MISSING");
  return {
    client,
    executor: new AsterDirectTradeExecutor(client, {
      exchangeInfoTtlMs: numberEnv("ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
      reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
      reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1_500),
    }),
  };
}

async function loadStrategyStores(paths: ReturnType<typeof statePaths>, sha: string) {
  const v12 = new FileV12X1AllRunnerStateStore(paths.v12, "LIVE");
  const pengu = new FilePenguDualLsV2RunnerStateStore(paths.pengu, "LIVE");
  const q102 = new FileQuality102CausalV1StateStore(paths.q102, "LIVE", sha);
  const [v12State, penguState, q102State] = await Promise.all([v12.load(), pengu.load(), q102.load()]);
  return { v12, pengu, q102, v12State, penguState, q102State };
}

function assertStrategyStatesReady(states: Awaited<ReturnType<typeof loadStrategyStores>>) {
  if (states.v12State.active || states.v12State.pending || states.v12State.killSwitch?.active || states.v12State.manualReview) {
    throw new Error("ONE_SHOT_V12_STATE_NOT_FLAT_OR_REVIEW_REQUIRED");
  }
  if (states.penguState.position || states.penguState.pending) throw new Error("ONE_SHOT_PENGU_STATE_NOT_FLAT_OR_PENDING");
  if (states.q102State.position || states.q102State.pending) throw new Error("ONE_SHOT_Q102_STATE_NOT_FLAT_OR_PENDING");
}

function assertFreshQuote(quote: { symbol: string; bidPrice: number; askPrice: number; bidQuantity: number; askQuantity: number; updatedAt: number }, symbol: string, now: number) {
  if (quote.symbol.toUpperCase() !== symbol || !(quote.bidPrice > 0) || !(quote.askPrice >= quote.bidPrice) || !(quote.bidQuantity > 0) || !(quote.askQuantity > 0)) {
    throw new Error(`ONE_SHOT_QUOTE_INVALID:${symbol}`);
  }
  if (!(quote.updatedAt > 0) || quote.updatedAt > now || now - quote.updatedAt > MAX_DATA_AGE_MS) throw new Error(`ONE_SHOT_QUOTE_STALE:${symbol}`);
}

async function runReadOnlyPreflight(client: AsterV3Client, executor: AsterDirectTradeExecutor, paths: ReturnType<typeof statePaths>, sha: string) {
  const kill = await readSharedKillSwitch(process.env);
  if (!kill.configuredPaths.length) throw new Error("ONE_SHOT_KILL_SWITCH_PATH_REQUIRED");
  if (kill.active) throw new Error(`ONE_SHOT_KILL_SWITCH_ACTIVE:${kill.reason || "UNSPECIFIED"}`);
  const risk = await readSharedCryptoDailyRisk(paths.risk, currentTimestamp());
  if (!risk.ok) throw new Error(`ONE_SHOT_DAILY_RISK_NOT_CLEAR:${risk.reason || "UNKNOWN"}`);
  const states = await loadStrategyStores(paths, sha);
  const oneShotStore = new FileOneShotForceCloseStateStore(paths.oneShot);
  const oneShot = await oneShotStore.load();
  if (!oneShot) assertStrategyStatesReady(states);
  const [, account, positions, openOrders] = await Promise.all([
    client.ping(),
    executor.getAccountSnapshot(),
    executor.getPositions(),
    executor.getOpenOrders(),
  ]);
  const now = currentTimestamp();
  if (!(account.walletBalance > 0) || !(account.availableBalance >= 0) || !(account.updatedAt > 0) || account.updatedAt > now || now - account.updatedAt > MAX_DATA_AGE_MS) throw new Error("ONE_SHOT_ACCOUNT_STALE_OR_INVALID");
  const quotes: Record<string, { bidPrice: number; askPrice: number; updatedAt: number; normalizedQuantity: number; normalizedNotional: number }> = {};
  for (const request of ONE_SHOT_FORCE_CLOSE_REQUESTS) {
    const quote = await executor.getMarketQuote(request.symbol);
    assertFreshQuote(quote, request.symbol, now);
    const normalized = await executor.normalizeMarketQuantity(request.symbol, request.maxNotionalUsd / quote.bidPrice, quote.bidPrice);
    if (!(normalized.quantity > 0) || !(normalized.notional >= 5) || normalized.notional > request.maxNotionalUsd + 1e-8 || normalized.quantity > quote.bidQuantity + 1e-12) throw new Error(`ONE_SHOT_QUANTITY_OR_LIQUIDITY_INVALID:${request.symbol}`);
    quotes[request.symbol] = { bidPrice: quote.bidPrice, askPrice: quote.askPrice, updatedAt: quote.updatedAt, normalizedQuantity: normalized.quantity, normalizedNotional: normalized.notional };
  }
  const minimumAvailable = Object.values(quotes).reduce((sum, quote) => sum + quote.normalizedNotional, 0) * 1.1;
  if ((!oneShot || oneShot.legs.some((leg) => leg.status === "PLANNED" || leg.status === "ENTRY_PENDING")) && account.availableBalance < minimumAvailable) throw new Error("ONE_SHOT_AVAILABLE_BALANCE_BUFFER_INSUFFICIENT");
  if (oneShot) {
    const allowed = new Set(oneShot.legs.filter((leg) => leg.status === "ENTRY_PENDING" || leg.status === "CLOSE_SUBMITTED").map((leg) => leg.status === "ENTRY_PENDING" ? leg.entryClientOrderId : leg.closeClientOrderId));
    const unexpectedOrders = openOrders.filter((order) => !allowed.has(order.clientOrderId));
    if (unexpectedOrders.length) throw new Error(`ONE_SHOT_RESUME_UNKNOWN_OPEN_ORDER:${unexpectedOrders.map((order) => order.clientOrderId || order.symbol).join(",")}`);
  }
  if (!oneShot && positions.some(nonZero)) throw new Error(`ONE_SHOT_FRESH_PREFLIGHT_POSITIONS_NOT_EMPTY:${positions.map((row) => row.symbol).join(",")}`);
  if (!oneShot && openOrders.length) throw new Error(`ONE_SHOT_FRESH_PREFLIGHT_OPEN_ORDERS_NOT_EMPTY:${openOrders.map((row) => row.clientOrderId || row.symbol).join(",")}`);
  return {
    status: "PASS" as const,
    account: { availableBalance: account.availableBalance, walletBalance: account.walletBalance, updatedAt: account.updatedAt },
    positions: positions.map((row) => ({ symbol: row.symbol, quantity: row.quantity, side: sideOf(row), notionalUsd: row.notionalUsd })),
    openOrders: openOrders.map((row) => ({ symbol: row.symbol, clientOrderId: row.clientOrderId, status: row.status })),
    quotes,
    killSwitch: { active: kill.active, sourcePath: kill.sourcePath },
    dailyRisk: { ok: risk.ok, reason: risk.reason },
    existingOneShot: Boolean(oneShot),
  };
}

function actualPosition(positions: DirectPosition[], symbol: string): DirectPosition | undefined {
  return positions.find((position) => position.symbol.toUpperCase() === symbol.toUpperCase() && nonZero(position));
}

function assertShortPosition(position: DirectPosition | undefined, symbol: string): asserts position is DirectPosition {
  if (!position || sideOf(position) !== "SHORT" || !(position.entryPrice > 0) || !(position.markPrice > 0) || !(position.notionalUsd > 0) || !(position.updatedAt > 0)) throw new Error(`ONE_SHOT_FILLED_POSITION_INVALID:${symbol}`);
}

function assertGrossCapacity(accountEquity: number, positions: DirectPosition[], additionalNotionalUsd: number) {
  if (!(accountEquity > 0)) throw new Error("ONE_SHOT_ACCOUNT_EQUITY_INVALID");
  const currentTotal = positions.filter(nonZero).reduce((sum, position) => sum + Math.abs(position.notionalUsd), 0) / accountEquity;
  const currentCrypto = positions.filter((position) => nonZero(position) && classifyAsterSymbol(position.symbol).assetClass === "CRYPTO").reduce((sum, position) => sum + Math.abs(position.notionalUsd), 0) / accountEquity;
  if (currentTotal + additionalNotionalUsd / accountEquity > 2.5 + 1e-9) throw new Error("ONE_SHOT_TOTAL_GROSS_CAP");
  if (currentCrypto + additionalNotionalUsd / accountEquity > 2 + 1e-9) throw new Error("ONE_SHOT_CRYPTO_GROSS_CAP");
}

function placeholderV12Protection(symbol: string, side: "SHORT", quantity: number, entryPrice: number, positionId: string) {
  const atr = Math.max(entryPrice * 0.01, 1e-8);
  const levels = protectiveLevels(entryPrice, atr, side);
  return {
    strategyId: "V12_X1.00_ALL" as const,
    symbol,
    side,
    positionId,
    quantity,
    entryPrice,
    atrAtEntry: atr,
    initialStop: levels.initialStop,
    lastAckStop: levels.initialStop,
    takeProfit: levels.takeProfit,
    peakOrTrough: entryPrice,
  };
}

async function syncStrategyStateForFill(
  owner: OneShotOwner,
  leg: OneShotLegState,
  state: OneShotForceCloseState,
  position: DirectPosition,
  equity: number,
  stores: Awaited<ReturnType<typeof loadStrategyStores>>,
) {
  const quantity = Math.abs(position.quantity);
  const entryPrice = position.entryPrice;
  const filledAtTs = leg.filledAtTs || state.updatedAt;
  const gross = quantity * entryPrice / equity;
  if (owner === "V12_X1.00_ALL") {
    const current = await stores.v12.load();
    if (current.active || current.pending || current.killSwitch?.active || current.manualReview) throw new Error("ONE_SHOT_V12_STATE_CHANGED_DURING_TEST");
    const active: V12X1AllRunnerState["active"] = {
      symbol: leg.symbol,
      side: "SHORT",
      quantity,
      gross,
      positionId: leg.entryClientOrderId,
      entryPrice,
      atrAtEntry: Math.max(entryPrice * 0.01, 1e-8),
      entrySignalTs: filledAtTs,
      holdingBars: 0,
      peakPrice: entryPrice,
      troughPrice: entryPrice,
      protection: placeholderV12Protection(leg.symbol, "SHORT", quantity, entryPrice, leg.entryClientOrderId),
    };
    await stores.v12.save({ ...current, active, oneShotTestId: state.testId, oneShotCloseAtTs: leg.closeAtTs });
    return;
  }
  if (owner === "PENGU_DUAL_LS_V2_FINAL") {
    const current = await stores.pengu.load();
    if (current.position || current.pending) throw new Error("ONE_SHOT_PENGU_STATE_CHANGED_DURING_TEST");
    await stores.pengu.save({
      ...current,
      position: { side: -1, entryTs: filledAtTs, entryPrice, quantity, gross, highWaterMark: entryPrice, lowWaterMark: entryPrice, entryVersion: "LEGACY_V2" },
      oneShotTestId: state.testId,
      oneShotCloseAtTs: leg.closeAtTs,
    });
    return;
  }
  const current = await stores.q102.load();
  if (current.position || current.pending) throw new Error("ONE_SHOT_Q102_STATE_CHANGED_DURING_TEST");
  await stores.q102.save({
    ...current,
    position: {
      symbol: leg.symbol,
      side: -1,
      quantity,
      entryPrice,
      entryTs: filledAtTs,
      hardStop: 0.15,
      bestPrice: entryPrice,
      trailActive: false,
      family: "HIGH_VOL",
      variant: "ONE_SHOT_FORCE_CLOSE",
      layer: "S1",
      exitPolicy: "FIXED_HOLD_STOP",
      maxHoldHours: 72,
    },
    oneShotTestId: state.testId,
    oneShotCloseAtTs: leg.closeAtTs,
  });
}

async function clearStrategyStateForClose(owner: OneShotOwner, testId: string, closeTs: number, stores: Awaited<ReturnType<typeof loadStrategyStores>>) {
  if (owner === "V12_X1.00_ALL") {
    const state = await stores.v12.load();
    if (state.oneShotTestId !== testId) throw new Error("ONE_SHOT_V12_CLEAR_MARKER_MISMATCH");
    await stores.v12.save({ ...state, active: undefined, pending: undefined, oneShotTestId: undefined, oneShotCloseAtTs: undefined, lastCompletedIdempotencyKey: `${testId}:closed` });
    return;
  }
  if (owner === "PENGU_DUAL_LS_V2_FINAL") {
    const state = await stores.pengu.load();
    if (state.oneShotTestId !== testId) throw new Error("ONE_SHOT_PENGU_CLEAR_MARKER_MISMATCH");
    await stores.pengu.save({ ...state, position: undefined, pending: undefined, oneShotTestId: undefined, oneShotCloseAtTs: undefined, lastCompletedIdempotencyKey: `${testId}:closed`, cooldownUntilTs: closeTs });
    return;
  }
  const state = await stores.q102.load();
  if (state.oneShotTestId !== testId) throw new Error("ONE_SHOT_Q102_CLEAR_MARKER_MISMATCH");
  await stores.q102.save({ ...state, position: undefined, pending: undefined, oneShotTestId: undefined, oneShotCloseAtTs: undefined, lastCompletedIdempotencyKey: `${testId}:closed`, lastReconciledAt: closeTs });
}

async function reconcileExpectedPositions(executor: AsterDirectTradeExecutor, state: OneShotForceCloseState, stores: Awaited<ReturnType<typeof loadStrategyStores>>) {
  const positions = await executor.getPositions();
  const expected = state.legs.filter((leg) => leg.status === "CLOSE_PENDING" || leg.status === "CLOSE_SUBMITTED");
  const expectedSymbols = new Set(expected.map((leg) => leg.symbol));
  const unexpected = positions.filter(nonZero).filter((position) => !expectedSymbols.has(position.symbol.toUpperCase()));
  if (unexpected.length) throw new Error(`ONE_SHOT_UNEXPECTED_POSITION:${unexpected.map((row) => row.symbol).join(",")}`);
  for (const leg of expected) {
    const position = actualPosition(positions, leg.symbol);
    assertShortPosition(position, leg.symbol);
    if (leg.filledQuantity && Math.abs(Math.abs(position.quantity) - leg.filledQuantity) > Math.max(1e-8, leg.filledQuantity * 0.02)) throw new Error(`ONE_SHOT_POSITION_QUANTITY_MISMATCH:${leg.symbol}`);
  }
  void stores;
  return positions;
}

async function reconcileSubmittedOrders(state: OneShotForceCloseState, store: FileOneShotForceCloseStateStore, executor: AsterDirectTradeExecutor, stores: Awaited<ReturnType<typeof loadStrategyStores>>) {
  let working = state;
  for (const leg of [...working.legs]) {
    if (leg.status === "ENTRY_PENDING") {
      const result = await executor.reconcileOrder(leg.symbol, leg.entryClientOrderId);
      if (result.status === "UNKNOWN" || result.executionUnknown) throw new Error(`ONE_SHOT_ENTRY_RECONCILIATION_UNKNOWN:${leg.symbol}`);
      if (result.status !== "FILLED" && result.status !== "PARTIALLY_FILLED") throw new Error(`ONE_SHOT_ENTRY_RECONCILIATION_NOT_FILLED:${leg.symbol}:${result.status}`);
      const fillTs = result.updatedAt;
      if (!fillTs) throw new Error(`ONE_SHOT_ENTRY_FILL_TIMESTAMP_MISSING:${leg.symbol}`);
      working = recordEntryExecution(working, leg.owner, result, fillTs);
      await store.save(working);
      const positions = await executor.getPositions();
      const position = actualPosition(positions, leg.symbol);
      assertShortPosition(position, leg.symbol);
      const account = await executor.getAccountSnapshot();
      await syncStrategyStateForFill(leg.owner, working.legs.find((item) => item.legId === leg.legId)!, working, position, account.walletBalance + positions.reduce((sum, row) => sum + row.unrealizedPnl, 0), stores);
    } else if (leg.status === "CLOSE_SUBMITTED") {
      const result = await executor.reconcileOrder(leg.symbol, leg.closeClientOrderId);
      if (result.status === "UNKNOWN" || result.executionUnknown) throw new Error(`ONE_SHOT_CLOSE_RECONCILIATION_UNKNOWN:${leg.symbol}`);
      if (result.reduceOnly !== true) throw new Error(`ONE_SHOT_CLOSE_RECONCILIATION_NOT_REDUCE_ONLY:${leg.symbol}`);
      working = recordCloseExecution(working, leg.legId, result, result.updatedAt || currentTimestamp());
      await store.save(working);
      if (working.legs.find((item) => item.legId === leg.legId)?.status === "CLOSED") {
        const remaining = await executor.getPositions();
        if (actualPosition(remaining, leg.symbol)) throw new Error(`ONE_SHOT_CLOSE_RECONCILIATION_POSITION_REMAINS:${leg.symbol}`);
        await clearStrategyStateForClose(leg.owner, working.testId, result.updatedAt || currentTimestamp(), stores);
      }
    }
  }
  return working;
}

async function executeEntryForLeg(
  state: OneShotForceCloseState,
  store: FileOneShotForceCloseStateStore,
  request: OneShotForceCloseRequest,
  executor: AsterDirectTradeExecutor,
  stores: Awaited<ReturnType<typeof loadStrategyStores>>,
): Promise<OneShotForceCloseState> {
  let working = markEntryPending(state, request.legId, currentTimestamp());
  await store.save(working);
  const quote = await executor.getMarketQuote(request.symbol);
  const now = currentTimestamp();
  assertFreshQuote(quote, request.symbol, now);
  const requestedQuantity = request.maxNotionalUsd / quote.bidPrice;
  const normalized = await executor.normalizeMarketQuantity(request.symbol, requestedQuantity, quote.bidPrice);
  if (!(normalized.notional >= 5) || normalized.notional > request.maxNotionalUsd + 1e-8 || normalized.quantity > quote.bidQuantity + 1e-12) throw new Error(`ONE_SHOT_ENTRY_QUANTITY_INVALID:${request.symbol}`);
  const result = await executor.executeMarket({
    requestId: working.legs.find((leg) => leg.legId === request.legId)!.entryClientOrderId,
    clientOrderId: working.legs.find((leg) => leg.legId === request.legId)!.entryClientOrderId,
    symbol: request.symbol,
    side: "SELL",
    positionSide: "BOTH",
    quantity: normalized.quantity,
    expectedPrice: quote.bidPrice,
    maxSlippageBps: numberEnv("DISDEX_ONE_SHOT_MAX_SLIPPAGE_BPS", 35),
    reason: `ONE_SHOT_FORCE_ENTRY:${request.owner}:${request.symbol}:SHORT`,
  });
  let confirmed = result;
  if ((confirmed.status !== "FILLED" && confirmed.status !== "PARTIALLY_FILLED") || !confirmed.updatedAt || !(confirmed.averagePrice > 0)) {
    confirmed = await executor.reconcileOrder(request.symbol, working.legs.find((leg) => leg.legId === request.legId)!.entryClientOrderId);
  }
  if (confirmed.status === "UNKNOWN" || confirmed.executionUnknown) {
    working = recordEntryExecution(working, request.owner, confirmed, currentTimestamp());
    await store.save(working);
    throw new Error(`ONE_SHOT_ENTRY_UNKNOWN_MANUAL_REVIEW:${request.symbol}`);
  }
  const fillTs = confirmed.updatedAt;
  if (!fillTs) throw new Error(`ONE_SHOT_ENTRY_FILL_TIMESTAMP_MISSING:${request.symbol}`);
  working = recordEntryExecution(working, request.owner, confirmed, fillTs);
  await store.save(working);
  const positions = await executor.getPositions();
  const position = actualPosition(positions, request.symbol);
  assertShortPosition(position, request.symbol);
  const account = await executor.getAccountSnapshot();
  const equity = account.walletBalance + positions.reduce((sum, row) => sum + row.unrealizedPnl, 0);
  assertGrossCapacity(equity, positions.filter((row) => row.symbol.toUpperCase() !== request.symbol), Math.abs(position.notionalUsd));
  await syncStrategyStateForFill(request.owner, working.legs.find((leg) => leg.legId === request.legId)!, working, position, equity, stores);
  return working;
}

async function executeDueClose(
  state: OneShotForceCloseState,
  store: FileOneShotForceCloseStateStore,
  executor: AsterDirectTradeExecutor,
  stores: Awaited<ReturnType<typeof loadStrategyStores>>,
  lock: AccountLockHandle,
): Promise<OneShotForceCloseState> {
  let working = state;
  const due = planDueCloseOrders(working, currentTimestamp());
  for (const order of due) {
    const leg = working.legs.find((item) => item.legId === order.legId)!;
    const positions = await executor.getPositions();
    const position = actualPosition(positions, order.symbol);
    assertShortPosition(position, order.symbol);
    if (Math.abs(Math.abs(position.quantity) - order.quantity) > Math.max(1e-8, order.quantity * 0.02)) throw new Error(`ONE_SHOT_CLOSE_QUANTITY_MISMATCH:${order.symbol}`);
    const quote = await executor.getMarketQuote(order.symbol);
    const now = currentTimestamp();
    assertFreshQuote(quote, order.symbol, now);
    const currentAccount = await executor.getAccountSnapshot();
    const closeId = leg.closeClientOrderId || closeClientOrderId(working.testId, leg.legId, leg.closeAttemptCount);
    working = markCloseSubmitted(working, leg.legId, now);
    await store.save(working);
    const result = await executor.executeMarket({
      requestId: closeId,
      clientOrderId: closeId,
      symbol: order.symbol,
      side: "BUY",
      positionSide: "BOTH",
      quantity: order.quantity,
      reduceOnly: true,
      expectedPrice: quote.askPrice,
      maxSlippageBps: numberEnv("DISDEX_ONE_SHOT_MAX_SLIPPAGE_BPS", 35),
      reason: `ONE_SHOT_FORCE_CLOSE_1H:${leg.owner}:${order.symbol}:REDUCE_ONLY`,
    });
    let confirmed = result;
    if ((confirmed.status !== "FILLED" && confirmed.status !== "PARTIALLY_FILLED") || !confirmed.updatedAt) {
      confirmed = await executor.reconcileOrder(order.symbol, closeId);
    }
    if (confirmed.status === "UNKNOWN" || confirmed.executionUnknown) {
      working = { ...working, status: "MANUAL_REVIEW", legs: working.legs.map((item) => item.legId === leg.legId ? { ...item, status: "MANUAL_REVIEW", error: "CLOSE_EXECUTION_UNKNOWN_NO_RETRY" } : item), updatedAt: currentTimestamp() };
      await store.save(working);
      throw new Error(`ONE_SHOT_CLOSE_UNKNOWN_MANUAL_REVIEW:${order.symbol}`);
    }
    if (confirmed.reduceOnly !== true) throw new Error(`ONE_SHOT_CLOSE_RESULT_NOT_REDUCE_ONLY:${order.symbol}`);
    working = recordCloseExecution(working, leg.legId, confirmed, confirmed.updatedAt || currentTimestamp());
    await store.save(working);
    const remaining = await executor.getPositions();
    const stillOpen = actualPosition(remaining, order.symbol);
    const closedLeg = working.legs.find((item) => item.legId === leg.legId);
    if (closedLeg?.status === "CLOSED") {
      if (stillOpen) throw new Error(`ONE_SHOT_CLOSE_POSITION_REMAINS:${order.symbol}`);
      await clearStrategyStateForClose(leg.owner, working.testId, confirmed.updatedAt || currentTimestamp(), stores);
    } else if (stillOpen) {
      if (Math.abs(Math.abs(stillOpen.quantity) - Number(closedLeg?.filledQuantity || 0)) > Math.max(1e-8, Number(closedLeg?.filledQuantity || 0) * 0.02)) throw new Error(`ONE_SHOT_PARTIAL_CLOSE_RECONCILIATION_FAILED:${order.symbol}`);
    } else {
      throw new Error(`ONE_SHOT_PARTIAL_CLOSE_POSITION_MISSING:${order.symbol}`);
    }
    void currentAccount;
    await lock.document();
  }
  return working;
}

async function runSelfTest() {
  const plan = createOneShotPlan(currentTimestamp());
  if (plan.legs.length !== 3 || plan.legs.some((leg) => leg.entrySide !== "SELL" || leg.closeSide !== "BUY" || leg.requestedNotionalUsd !== 10)) throw new Error("ONE_SHOT_SELFTEST_PLAN_FAILED");
  if (!isOneShotStrategyPosition({ oneShotTestId: plan.testId, oneShotCloseAtTs: currentTimestamp() + HOUR_MS })) throw new Error("ONE_SHOT_SELFTEST_MARKER_FAILED");
  console.log("ONE_SHOT_FORCE_CLOSE_SELFTEST_PASS");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await runSelfTest();
    return;
  }
  const paths = statePaths();
  const sha = runtimeSha();
  assertProductionLiveGates(sha);
  const { client, executor } = createExecutor();
  if (process.argv.includes("--preflight")) {
    const result = await runReadOnlyPreflight(client, executor, paths, sha);
    console.log(JSON.stringify({ event: "one-shot-read-only-preflight", ...result }));
    return;
  }
  if (!process.argv.includes("--execute") || !process.argv.includes("--daemon")) throw new Error("ONE_SHOT_EXECUTE_REQUIRES_EXPLICIT_EXECUTE_AND_DAEMON");
  if (String(process.env.DISDEX_ONE_SHOT_REAL_ORDER_ACK || "") !== ONE_SHOT_ACK) throw new Error("ONE_SHOT_REAL_ORDER_ACK_REQUIRED");
  const store = new FileOneShotForceCloseStateStore(paths.oneShot);
  let state = await store.load();
  if (state?.status === "COMPLETE") {
    console.log(JSON.stringify({ event: "one-shot-already-complete", testId: state.testId, status: state.status }));
    return;
  }
  if (state?.status === "MANUAL_REVIEW") throw new Error("ONE_SHOT_EXISTING_STATE_MANUAL_REVIEW");
  const preflight = await runReadOnlyPreflight(client, executor, paths, sha);
  console.log(JSON.stringify({ event: "one-shot-read-only-preflight-pass-before-execution", ...preflight }));
  const lock = new FileAccountOrderLock(paths.lock, numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000));
  const handle = await lock.acquire(`ONE_SHOT_FORCE_CLOSE:${process.pid}:${randomUUID()}`, "ASTER_FUTURES");
  if (!handle) throw new Error("ONE_SHOT_ACCOUNT_LOCK_BUSY_OR_REVIEW_REQUIRED");
  try {
    const stores = await loadStrategyStores(paths, sha);
    if (!state) {
      assertStrategyStatesReady(stores);
      const fresh = await runReadOnlyPreflight(client, executor, paths, sha);
      if (fresh.positions.length || fresh.openOrders.length) throw new Error("ONE_SHOT_RACE_DETECTED_DURING_PREFLIGHT");
      state = createOneShotPlan(currentTimestamp());
      await store.save(state);
    } else {
      state = await reconcileSubmittedOrders(state, store, executor, stores);
      await reconcileExpectedPositions(executor, state, stores);
    }
    for (const request of ONE_SHOT_FORCE_CLOSE_REQUESTS) {
      const leg = state.legs.find((item) => item.legId === request.legId)!;
      if (leg.status === "PLANNED") {
        state = await executeEntryForLeg(state, store, request, executor, stores);
        await reconcileExpectedPositions(executor, state, stores);
      }
      const updatedLeg = state.legs.find((item) => item.legId === request.legId)!;
      if (updatedLeg.status === "ENTRY_PENDING" || updatedLeg.status === "MANUAL_REVIEW") throw new Error(`ONE_SHOT_ENTRY_NOT_COMPLETED:${request.symbol}`);
    }
  } finally {
    await handle.release();
  }
  console.log(JSON.stringify({ event: "one-shot-entries-complete", testId: state.testId, status: state.status, closeAtTs: state.legs.map((leg) => ({ owner: leg.owner, symbol: leg.symbol, closeAtTs: leg.closeAtTs })) }));
  let lastStatus = state.status;
  const stop = { requested: false };
  const onSignal = () => { stop.requested = true; };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  while (!stop.requested) {
    state = await store.load();
    if (!state) throw new Error("ONE_SHOT_STATE_DISAPPEARED");
    if (state.status === "MANUAL_REVIEW") throw new Error("ONE_SHOT_MANUAL_REVIEW_REQUIRED");
    if (state.status === "COMPLETE") break;
    const dueAt = state.legs.filter((leg) => leg.status === "CLOSE_PENDING").map((leg) => Number(leg.closeAtTs)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    const waitMs = dueAt ? Math.max(1_000, Math.min(SLEEP_MS, dueAt - currentTimestamp())) : SLEEP_MS;
    if (state.status !== lastStatus) {
      console.log(JSON.stringify({ event: "one-shot-state", testId: state.testId, status: state.status }));
      lastStatus = state.status;
    }
    await sleep(waitMs);
    state = await store.load();
    if (!state) throw new Error("ONE_SHOT_STATE_DISAPPEARED_AFTER_WAIT");
    if (state.status === "COMPLETE") break;
    const closeHandle = await lock.acquire(`ONE_SHOT_CLOSE:${process.pid}:${randomUUID()}`, "ASTER_FUTURES");
    if (!closeHandle) continue;
    try {
      const freshStores = await loadStrategyStores(paths, sha);
      state = await reconcileSubmittedOrders(state, store, executor, freshStores);
      await reconcileExpectedPositions(executor, state, freshStores);
      state = await executeDueClose(state, store, executor, freshStores, closeHandle);
      await reconcileExpectedPositions(executor, state, freshStores);
    } finally {
      await closeHandle.release();
    }
  }
  const final = await store.load();
  console.log(JSON.stringify({ event: "one-shot-finished", testId: final?.testId, status: final?.status, legs: final?.legs.map((leg) => ({ owner: leg.owner, symbol: leg.symbol, status: leg.status, filledQuantity: leg.filledQuantity, closeAtTs: leg.closeAtTs, closedAtTs: leg.closedAtTs })) }));
  if (!final || final.status !== "COMPLETE") throw new Error("ONE_SHOT_DAEMON_STOPPED_BEFORE_COMPLETE");
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "one-shot-failed", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
