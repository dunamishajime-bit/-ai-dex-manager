import { recordFetExit } from "./fet-brk48-state";
import { createHash } from "node:crypto";

import { FET_BRK48_RESIDUAL } from "@/config/fetBrk48Runtime";
import { INTEGRATED_PRODUCTION_RISK_POLICY } from "@/config/integratedProductionRiskPolicy";
import type { AsterKline, AsterV3Client } from "@/lib/aster-v3-client";
import { classifyAsterSymbol } from "@/lib/disdex-aster-portfolio-classifier";
import { FileAccountOrderLock } from "@/lib/disdex-account-order-lock";
import {
  readQuality102CausalV1Ownership,
  quality102OwnsOrder,
  quality102OwnsPosition,
} from "@/lib/disdex-quality102-causal-v1-ownership";
import { readSharedCryptoDailyRiskWithRolloverRetry } from "@/lib/disdex-shared-crypto-daily-risk";
import { assertSharedKillSwitchAllowsNewEntry } from "@/lib/disdex-shared-kill-switch";
import {
  findManagedFetBrk48ProtectiveOrders,
  findManagedIdlePriorityShortProtectiveOrders,
  findManagedOrdinaryResidentStops,
  findManagedPenguRecoveryV8ProtectiveOrders,
  findManagedV12ProtectiveOrders,
} from "@/lib/disdex-managed-protective-orders";
import type { DirectOpenOrder, DirectPosition, DirectTradeExecutor } from "@/lib/direct-trade-executor";
import { fetCompletedReturn72h, buildFetBrk48Signal, normalizeFetH1, type FetBrk48Signal } from "@/lib/fet-brk48-signal";
import {
  readFetBrk48State,
  writeFetBrk48State,
  type FetBrk48PendingState,
  type FetBrk48PositionState,
  type FetBrk48State,
} from "@/lib/fet-brk48-state";
import type { V12AsterLiveAdapter } from "@/lib/v12-aster-live-adapter";
import { aggregatePendingExposure, readPendingExposureRegistry } from "@/lib/disdex-pending-exposure-registry";
import { isHypeZecSoleSharedCapacityCause, releaseHypeZecCapacityForPriorityEntry } from "@/lib/hype-zec-priority-capacity";
import { releaseIdleResidualLongForFormalEntry } from "@/lib/idle-residual-long-preemption";
import { planStrictPortfolio, type StrictPortfolioIntent } from "@/lib/disdex-strict-portfolio-planner";
import { buildLiveEntryCandidate, liveEntryScore, requireApprovedLiveGross, strictIntentForLiveCandidate } from "@/lib/disdex-live-entry-approval";
import { toStrictPosition } from "@/lib/v12-strict-live-adapter";
import {
  advanceFetBrk48LongTrailingStop,
  FET_BRK48_TRAILING_STOP_POLICY,
  type FetBrk48TrailingStopState,
} from "@/lib/fet-brk48-trailing-stop";
import type { ConfirmedFiveMinuteBar } from "@/lib/disdex-exit-overlay-contract";

const EPS = 1e-9;
const DEFAULT_RISK_PATH = "/var/lib/disdex/shared/crypto-daily-risk.json";
const FIVE_MINUTE_MS = 5 * 60_000;

function trailingStopEnabled() {
  const enabled = /^(1|true|yes|on)$/i.test(String(process.env.FET_BRK48_TRAILING_STOP_ENABLED || ""));
  if (!enabled) return false;
  if (String(process.env.FET_BRK48_TRAILING_STOP_POLICY || "") !== FET_BRK48_TRAILING_STOP_POLICY.id) {
    throw new Error(`FET_TRAILING_STOP_POLICY_MISMATCH:${process.env.FET_BRK48_TRAILING_STOP_POLICY || "MISSING"}`);
  }
  return true;
}

function normalizeCompletedFetM5Bar(row: AsterKline, now: number): ConfirmedFiveMinuteBar | undefined {
  const [timestampMs, open, high, low, close, , closeTs] = row;
  const bar = {
    timestampMs: finite(timestampMs),
    open: finite(open),
    high: finite(high),
    low: finite(low),
    close: finite(close),
  };
  const completedAt = finite(closeTs);
  if (!(bar.timestampMs > 0 && completedAt > bar.timestampMs && completedAt < now)) return undefined;
  if (![bar.open, bar.high, bar.low, bar.close].every((value) => value > 0)
      || bar.high < Math.max(bar.open, bar.close)
      || bar.low > Math.min(bar.open, bar.close)
      || bar.high < bar.low) {
    throw new Error(`FET_TRAILING_M5_OHLC_INVALID:${bar.timestampMs}`);
  }
  return bar;
}

export interface FetBrk48LiveRunnerDependencies {
  client: AsterV3Client;
  executor: DirectTradeExecutor;
  adapter: V12AsterLiveAdapter;
  statePath: string;
  runtimeSha: string;
  accountLock?: FileAccountOrderLock;
  sharedRiskPath?: string;
  maxSlippageBps?: number;
  minimumOrderNotionalUsd?: number;
  now?: () => number;
}

export interface FetBrk48TickResult {
  status: "held" | "entered" | "exited" | "preempted" | "blocked" | "locked" | "manual-review" | "no-signal";
  message: string;
  ordersSent: number;
  signal?: FetBrk48Signal;
  gross?: number;
}

function finite(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function activePosition(rows: readonly DirectPosition[]) {
  return rows.filter((row) => row.symbol.toUpperCase() === "FETUSDT" && Math.abs(row.quantity) > EPS);
}

function orderFilled(status: string) {
  return ["FILLED", "PARTIALLY_FILLED"].includes(String(status || "").toUpperCase());
}

function terminalNoFill(status: string) {
  return ["REJECTED", "CANCELED", "EXPIRED"].includes(String(status || "").toUpperCase());
}

function deterministicId(kind: "entry" | "exit" | "stop" | "failsafe", seed: string) {
  const digest = createHash("sha256").update(`FET_BRK48_RESIDUAL|${kind}|${seed}`).digest("hex");
  return `fet-${kind.slice(0, 5)}-${digest.slice(0, 22)}`.slice(0, 36);
}

export function deterministicFetEntryIdempotencyKey(referenceTs: number) {
  if (!Number.isFinite(referenceTs) || referenceTs <= 0) throw new Error("FET_ENTRY_REFERENCE_TS_INVALID");
  return createHash("sha256").update(`FET|ENTRY|${referenceTs}`).digest("hex");
}

export class FetProtectionReplacementError extends Error {
  constructor(
    message: string,
    readonly newProtectionVerified: boolean,
  ) {
    super(message);
    this.name = "FetProtectionReplacementError";
  }
}

function portfolioEquity(walletBalance: number, positions: readonly DirectPosition[]) {
  return walletBalance + positions.reduce((sum, row) => sum + finite(row.unrealizedPnl), 0);
}

async function portfolioGross(
  positions: readonly DirectPosition[],
  equity: number,
  q102: Awaited<ReturnType<typeof readQuality102CausalV1Ownership>>,
) {
  let cryptoNotional = 0;
  let stockNotional = 0;
  const unknown: string[] = [];
  for (const row of positions) {
    if (Math.abs(row.quantity) <= EPS) continue;
    const notional = Math.abs(row.quantity) * finite(row.markPrice || row.entryPrice);
    if (!(notional > 0)) throw new Error(`FET_PORTFOLIO_MARK_INVALID:${row.symbol}`);
    if (quality102OwnsPosition(q102, row)) {
      cryptoNotional += notional;
      continue;
    }
    // A non-Q102 FET must be owned by this runner state and is handled before
    // entry planning. Do not guess it into V12.
    if (row.symbol.toUpperCase() === "FETUSDT") {
      unknown.push(row.symbol);
      continue;
    }
    const classification = classifyAsterSymbol(row.symbol);
    if (classification.assetClass === "CRYPTO") cryptoNotional += notional;
    else if (classification.assetClass === "STOCK") stockNotional += notional;
    else unknown.push(row.symbol);
  }
  return {
    cryptoNotional,
    stockNotional,
    cryptoGross: cryptoNotional / equity,
    stockGross: stockNotional / equity,
    totalGross: (cryptoNotional + stockNotional) / equity,
    unknown,
  };
}

async function verifyStop(
  adapter: V12AsterLiveAdapter,
  position: FetBrk48PositionState,
) {
  const rows = await adapter.openOrders("FETUSDT");
  const row = rows.find((item) => item.clientOrderId === position.stopClientOrderId);
  if (!row) return false;
  const qtyTolerance = Math.max(1e-8, position.quantity * 0.01);
  const priceTolerance = Math.max(1e-8, position.hardStop * 0.001);
  return row.type === "STOP_MARKET"
    && row.side === "SELL"
    && row.reduceOnly === true
    && ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(String(row.status || "").toUpperCase())
    && Math.abs(row.quantity - position.quantity) <= qtyTolerance
    && Number.isFinite(row.stopPrice)
    && Math.abs(Number(row.stopPrice) - position.hardStop) <= priceTolerance;
}

async function ensureProtection(
  deps: FetBrk48LiveRunnerDependencies,
  state: FetBrk48State,
  actual: DirectPosition,
  input: {
    entryTs: number;
    exitTs: number;
    targetGross: number;
    hardStopPct: number;
    stopClientOrderId?: string;
    requestedStopPrice?: number;
    protectionMode?: FetBrk48PositionState["protectionMode"];
    profitFloorArmedAt?: number;
    profitFloorTriggerPrice?: number;
    trailingStop?: FetBrk48TrailingStopState;
  },
) {
  const entryPrice = finite(actual.entryPrice);
  const quantity = Math.abs(actual.quantity);
  if (!(entryPrice > 0 && quantity > 0)) throw new Error("FET_PROTECTION_POSITION_INVALID");
  const requestedStop = finite(input.requestedStopPrice) > 0
    ? finite(input.requestedStopPrice)
    : entryPrice * (1 - input.hardStopPct);
  const normalizedStop = await deps.adapter.normalizeStopPrice("FETUSDT", requestedStop);
  const stopClientOrderId = input.stopClientOrderId || deterministicId("stop", `${input.entryTs}|${quantity}|${entryPrice}`);
  const position: FetBrk48PositionState = {
    symbol: "FETUSDT",
    side: 1,
    quantity,
    entryPrice,
    entryTs: input.entryTs,
    exitTs: input.exitTs,
    gross: input.targetGross,
    hardStop: normalizedStop.price,
    stopClientOrderId,
    protectionMode: input.protectionMode || "INITIAL_HARD_STOP",
    profitFloorArmedAt: input.profitFloorArmedAt,
    profitFloorTriggerPrice: input.profitFloorTriggerPrice,
    trailingStop: input.trailingStop,
  };

  if (!await verifyStop(deps.adapter, position)) {
    await deps.adapter.placeStopMarket({
      symbol: "FETUSDT",
      side: "SELL",
      quantity,
      stopPrice: normalizedStop.price,
      clientOrderId: stopClientOrderId,
      reduceOnly: true,
    });
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await verifyStop(deps.adapter, position)) {
      state.position = position;
      state.lastReconciledAt = (deps.now || Date.now)();
      return position;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error("FET_PROTECTIVE_STOP_READBACK_FAILED");
}

/**
 * Replace protection without creating an unprotected interval.  The new
 * reduce-only STOP is placed and read back by ensureProtection first; only
 * then is the previous STOP retired.  A failed retirement leaves both orders
 * visible and moves the runner to manual review instead of deleting safety.
 */
async function replaceProtection(
  deps: FetBrk48LiveRunnerDependencies,
  state: FetBrk48State,
  actual: DirectPosition,
  input: Parameters<typeof ensureProtection>[3],
  previousStopClientOrderId?: string,
) {
  const next = await ensureProtection(deps, state, actual, input);
  if (previousStopClientOrderId && previousStopClientOrderId !== next.stopClientOrderId) {
    try {
      await deps.adapter.cancel(previousStopClientOrderId);
    } catch (error) {
      state.manualReview = `FET_PROTECTION_OLD_STOP_RETIREMENT_FAILED:${previousStopClientOrderId}`;
      await writeFetBrk48State(deps.statePath, state);
      throw new FetProtectionReplacementError(state.manualReview, true);
    }
    const remaining = (await deps.adapter.openOrders("FETUSDT"))
      .filter((row) => row.clientOrderId === previousStopClientOrderId
        && ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(String(row.status || "").toUpperCase()));
    if (remaining.length) {
      state.manualReview = `FET_PROTECTION_OLD_STOP_REMAINS:${previousStopClientOrderId}`;
      await writeFetBrk48State(deps.statePath, state);
      throw new FetProtectionReplacementError(state.manualReview, true);
    }
  }
  return next;
}

async function maybeArmProfitFloor(
  deps: FetBrk48LiveRunnerDependencies,
  state: FetBrk48State,
  actual: DirectPosition,
) {
  const position = state.position;
  if (!position) return false;
  if (position.protectionMode === "PROFIT_FLOOR_3P0") return false;

  const markPrice = finite(actual.markPrice);
  if (!(markPrice > 0)) return false;

  const triggerPrice = position.entryPrice * (1 + FET_BRK48_RESIDUAL.profitFloorTriggerPct);
  if (markPrice + EPS < triggerPrice) return false;

  const armedAt = (deps.now || Date.now)();
  const normalizedFloor = await deps.adapter.normalizeStopPrice(
    "FETUSDT",
    position.entryPrice * (1 + FET_BRK48_RESIDUAL.profitFloorStopPct),
  );
  if (!(normalizedFloor.price > position.hardStop + EPS)) {
    if (position.protectionMode !== "TRAIL_8P_GIVEBACK_4P") position.protectionMode = "PROFIT_FLOOR_3P0";
    position.profitFloorArmedAt = armedAt;
    position.profitFloorTriggerPrice = triggerPrice;
    state.position = position;
    return true;
  }

  const previousStopClientOrderId = position.stopClientOrderId;
  const nextStopClientOrderId = deterministicId(
    "stop",
    `${position.entryTs}|${position.quantity}|${position.entryPrice}|profit-floor|${normalizedFloor.price}`,
  );

  await replaceProtection(deps, state, actual, {
    entryTs: position.entryTs,
    exitTs: position.exitTs,
    targetGross: position.gross,
    hardStopPct: FET_BRK48_RESIDUAL.hardStopPct,
    requestedStopPrice: normalizedFloor.price,
    stopClientOrderId: nextStopClientOrderId,
    protectionMode: "PROFIT_FLOOR_3P0",
    profitFloorArmedAt: armedAt,
    profitFloorTriggerPrice: triggerPrice,
    trailingStop: position.trailingStop,
  }, previousStopClientOrderId);
  return true;
}

async function loadCompletedFetM5Bars(
  deps: FetBrk48LiveRunnerDependencies,
  position: FetBrk48PositionState,
  now: number,
) {
  const currentOpen = Math.floor(now / FIVE_MINUTE_MS) * FIVE_MINUTE_MS;
  const rows = await deps.client.getKlines("FETUSDT", "5m", 1_000, {
    startTime: Math.floor(position.entryTs / FIVE_MINUTE_MS) * FIVE_MINUTE_MS,
    endTime: currentOpen + 1,
  });
  const completed = rows
    .map((row) => normalizeCompletedFetM5Bar(row, now))
    .filter((row): row is ConfirmedFiveMinuteBar => Boolean(row))
    .filter((row) => row.timestampMs >= position.entryTs)
    .sort((left, right) => left.timestampMs - right.timestampMs);
  const unique = new Map<number, ConfirmedFiveMinuteBar>();
  for (const row of completed) {
    if (unique.has(row.timestampMs)) throw new Error(`FET_TRAILING_M5_DUPLICATE_BAR:${row.timestampMs}`);
    unique.set(row.timestampMs, row);
  }
  const ordered = [...unique.values()];
  const previousTs = position.trailingStop?.lastConfirmedBarTs;
  const unprocessed = previousTs === undefined ? ordered : ordered.filter((row) => row.timestampMs > previousTs);
  if (previousTs !== undefined && unprocessed.length > 0 && unprocessed[0].timestampMs > previousTs + FIVE_MINUTE_MS) {
    throw new Error(`FET_TRAILING_M5_GAP:${previousTs}:${unprocessed[0].timestampMs}`);
  }
  for (let index = 1; index < unprocessed.length; index += 1) {
    if (unprocessed[index].timestampMs !== unprocessed[index - 1].timestampMs + FIVE_MINUTE_MS) {
      throw new Error(`FET_TRAILING_M5_GAP:${unprocessed[index - 1].timestampMs}:${unprocessed[index].timestampMs}`);
    }
  }
  return unprocessed;
}

async function maybeAdvanceTrailingStop(
  deps: FetBrk48LiveRunnerDependencies,
  state: FetBrk48State,
  actual: DirectPosition,
): Promise<{ kind: "disabled" | "unchanged" | "updated" | "manual-review" | "unavailable"; message: string; ordersSent: number }> {
  if (!trailingStopEnabled()) return { kind: "disabled", message: "FET_TRAILING_STOP_DISABLED", ordersSent: 0 };
  const position = state.position;
  if (!position) return { kind: "unchanged", message: "FET_TRAILING_STOP_NO_POSITION", ordersSent: 0 };

  let bars: ConfirmedFiveMinuteBar[];
  try {
    bars = await loadCompletedFetM5Bars(deps, position, (deps.now || Date.now)());
  } catch (error) {
    // Existing protection remains authoritative.  A missing/invalid candle
    // must not delete it or synthesize an exit from an unconfirmed price.
    return {
      kind: "unavailable",
      message: `FET_TRAILING_M5_UNAVAILABLE:${error instanceof Error ? error.message : String(error)}`,
      ordersSent: 0,
    };
  }
  if (!bars.length) return { kind: "unchanged", message: "FET_TRAILING_M5_NO_NEW_CONFIRMED_BAR", ordersSent: 0 };

  let trailingState = position.trailingStop;
  let lastResult: ReturnType<typeof advanceFetBrk48LongTrailingStop> | undefined;
  for (const bar of bars) {
    lastResult = advanceFetBrk48LongTrailingStop({ entryPrice: position.entryPrice, state: trailingState, bar });
    trailingState = lastResult.state;
    if (lastResult.stopHit) {
      state.manualReview = "FET_TRAILING_STOP_TRIGGERED_BUT_POSITION_REMAINS";
      await writeFetBrk48State(deps.statePath, state);
      return { kind: "manual-review", message: state.manualReview, ordersSent: 0 };
    }
  }
  if (!lastResult || !trailingState) return { kind: "unchanged", message: "FET_TRAILING_M5_NO_NEW_CONFIRMED_BAR", ordersSent: 0 };

  const candidate = Number(trailingState.stopPrice);
  if (!(candidate > 0)) {
    position.trailingStop = trailingState;
    await writeFetBrk48State(deps.statePath, state);
    return { kind: "unchanged", message: "FET_TRAILING_STOP_NOT_ARMED", ordersSent: 0 };
  }
  if (candidate <= position.hardStop + EPS) {
    position.trailingStop = trailingState;
    if (trailingState.armed && position.protectionMode === "INITIAL_HARD_STOP") {
      position.protectionMode = "TRAIL_8P_GIVEBACK_4P";
    }
    await writeFetBrk48State(deps.statePath, state);
    return { kind: "unchanged", message: "FET_TRAILING_STOP_BELOW_EXISTING_PROTECTION", ordersSent: 0 };
  }

  const previousStopClientOrderId = position.stopClientOrderId;
  const nextStopClientOrderId = deterministicId(
    "stop",
    `${position.entryTs}|${position.quantity}|${position.entryPrice}|${FET_BRK48_TRAILING_STOP_POLICY.id}|${candidate}`,
  );
  await replaceProtection(deps, state, actual, {
    entryTs: position.entryTs,
    exitTs: position.exitTs,
    targetGross: position.gross,
    hardStopPct: FET_BRK48_RESIDUAL.hardStopPct,
    requestedStopPrice: candidate,
    stopClientOrderId: nextStopClientOrderId,
    protectionMode: "TRAIL_8P_GIVEBACK_4P",
    profitFloorArmedAt: position.profitFloorArmedAt,
    profitFloorTriggerPrice: position.profitFloorTriggerPrice,
    trailingStop: trailingState,
  }, previousStopClientOrderId);
  return { kind: "updated", message: "FET_TRAIL_8P_GIVEBACK_4P_STOP_UPDATED", ordersSent: 1 };
}

async function emergencyFlattenProtectedFailure(
  deps: FetBrk48LiveRunnerDependencies,
  state: FetBrk48State,
  actual: DirectPosition,
  reason: string,
) {
  const now = (deps.now || Date.now)();
  const clientOrderId = deterministicId("failsafe", `${now}|${actual.quantity}|${reason}`);
  await deps.adapter.flattenReduceOnly({
    symbol: "FETUSDT",
    side: "SELL",
    quantity: Math.abs(actual.quantity),
    clientOrderId,
  });
  if (activePosition(await deps.executor.getPositions()).length) throw new Error("FET_PROTECTION_FAILURE_FLATTEN_NOT_CONFIRMED");
  state.failures.push({ occurredAt: now, message: reason });
  recordFetExit(state, (deps.now || Date.now)());
  state.position = undefined;
  state.pending = undefined;
  state.manualReview = `FET_PROTECTION_FAILURE_FLATTENED:${reason}`;
  state.lastReconciledAt = now;
  await writeFetBrk48State(deps.statePath, state);
}

async function reconcilePending(
  deps: FetBrk48LiveRunnerDependencies,
  state: FetBrk48State,
): Promise<FetBrk48TickResult | undefined> {
  const pending = state.pending;
  if (!pending) return undefined;
  const result = await deps.executor.reconcileOrder("FETUSDT", pending.clientOrderId);
  const positions = await deps.executor.getPositions();
  const q102 = await readQuality102CausalV1Ownership({ expectedRuntimeSha: process.env.DISDEX_Q102_RUNTIME_SHA || deps.runtimeSha });
  const q102Fet = activePosition(positions).filter((row) => quality102OwnsPosition(q102, row));
  if (q102Fet.length) {
    state.manualReview = "FET_PENDING_Q102_OWNERSHIP_COLLISION";
    await writeFetBrk48State(deps.statePath, state);
    return { status: "manual-review", message: state.manualReview, ordersSent: 0 };
  }
  const ours = activePosition(positions);

  if (pending.action === "ENTRY") {
    if (ours.length === 0 && terminalNoFill(result.status)) {
      state.pending = undefined;
      state.lastReferenceTs = Math.max(state.lastReferenceTs || 0, pending.referenceTs);
      state.lastCompletedIdempotencyKey = pending.idempotencyKey;
      state.lastReconciledAt = (deps.now || Date.now)();
      await writeFetBrk48State(deps.statePath, state);
      return { status: "held", message: `FET_ENTRY_${result.status}_RECONCILED`, ordersSent: 0 };
    }
    if (ours.length !== 1 || ours[0].quantity <= 0 || !orderFilled(result.status)) {
      state.manualReview = `FET_ENTRY_PENDING_UNRESOLVED:${result.status}`;
      await writeFetBrk48State(deps.statePath, state);
      return { status: "manual-review", message: state.manualReview, ordersSent: 0 };
    }
    try {
      await ensureProtection(deps, state, ours[0], {
        entryTs: pending.entryTs!,
        exitTs: pending.exitTs!,
        targetGross: pending.targetGross!,
        hardStopPct: pending.hardStopPct!,
      });
    } catch (error) {
      await emergencyFlattenProtectedFailure(deps, state, ours[0], error instanceof Error ? error.message : String(error));
      return { status: "manual-review", message: state.manualReview || "FET_PROTECTION_FAILURE", ordersSent: 1 };
    }
    state.pending = undefined;
    state.lastReferenceTs = Math.max(state.lastReferenceTs || 0, pending.referenceTs);
    state.lastCompletedIdempotencyKey = pending.idempotencyKey;
    state.manualReview = result.status === "FILLED" ? undefined : "FET_PARTIAL_ENTRY_PROTECTED_OPERATOR_REVIEW";
    await writeFetBrk48State(deps.statePath, state);
    return {
      status: state.manualReview ? "manual-review" : "entered",
      message: state.manualReview || "FET_ENTRY_RECONCILED_AND_PROTECTED",
      ordersSent: 0,
      gross: pending.targetGross,
    };
  }

  if (ours.length === 0 && (orderFilled(result.status) || terminalNoFill(result.status))) {
    if (state.position?.stopClientOrderId) await deps.adapter.cancel(state.position.stopClientOrderId);
    recordFetExit(state, (deps.now || Date.now)());
    state.position = undefined;
    state.pending = undefined;
    state.lastCompletedIdempotencyKey = pending.idempotencyKey;
    state.lastReconciledAt = (deps.now || Date.now)();
    await writeFetBrk48State(deps.statePath, state);
    return { status: pending.action === "PREEMPT" ? "preempted" : "exited", message: "FET_REDUCE_ONLY_RECONCILED_FLAT", ordersSent: 0 };
  }

  state.manualReview = `FET_${pending.action}_PENDING_UNRESOLVED:${result.status}`;
  await writeFetBrk48State(deps.statePath, state);
  return { status: "manual-review", message: state.manualReview, ordersSent: 0 };
}

async function executeExit(
  deps: FetBrk48LiveRunnerDependencies,
  state: FetBrk48State,
  actual: DirectPosition,
): Promise<FetBrk48TickResult> {
  const now = (deps.now || Date.now)();
  const quote = await deps.executor.getMarketQuote("FETUSDT");
  const idempotencyKey = createHash("sha256").update(`FET|EXIT|${state.position?.entryTs}|${state.position?.quantity}`).digest("hex");
  const clientOrderId = deterministicId("exit", idempotencyKey);
  const pending: FetBrk48PendingState = {
    action: "EXIT",
    idempotencyKey,
    clientOrderId,
    symbol: "FETUSDT",
    side: "SELL",
    quantity: Math.abs(actual.quantity),
    referenceTs: quote.updatedAt || now,
    createdAt: now,
    updatedAt: now,
    expectedPrice: quote.bidPrice,
    reason: "FET_BRK48_HOLD_24H_EXIT",
  };
  state.pending = pending;
  await writeFetBrk48State(deps.statePath, state);
  const result = await deps.executor.executeMarket({
    requestId: idempotencyKey,
    clientOrderId,
    symbol: "FETUSDT",
    side: "SELL",
    quantity: pending.quantity,
    reduceOnly: true,
    expectedPrice: quote.bidPrice,
    maxSlippageBps: deps.maxSlippageBps ?? 20,
    reason: pending.reason,
  });
  if (result.status === "UNKNOWN" || result.executionUnknown) {
    state.manualReview = "FET_EXIT_EXECUTION_UNKNOWN";
    await writeFetBrk48State(deps.statePath, state);
    return { status: "manual-review", message: state.manualReview, ordersSent: 1 };
  }
  const remain = activePosition(await deps.executor.getPositions());
  if (remain.length) {
    state.manualReview = "FET_EXIT_POSITION_REMAINS";
    await writeFetBrk48State(deps.statePath, state);
    return { status: "manual-review", message: state.manualReview, ordersSent: 1 };
  }
  if (state.position?.stopClientOrderId) await deps.adapter.cancel(state.position.stopClientOrderId);
  recordFetExit(state, (deps.now || Date.now)());
  state.position = undefined;
  state.pending = undefined;
  state.lastCompletedIdempotencyKey = idempotencyKey;
  state.lastReconciledAt = now;
  await writeFetBrk48State(deps.statePath, state);
  return { status: "exited", message: "FET_24H_EXIT_FILLED", ordersSent: 1 };
}

export class FetBrk48LiveRunner {
  constructor(private readonly deps: FetBrk48LiveRunnerDependencies) {}

  async tick(): Promise<FetBrk48TickResult> {
    const now = (this.deps.now || Date.now)();

    // Flat/no-pending/no-review ticks are read-only until a BRK48 candidate
    // actually exists. Avoid monopolizing the shared account-order lock for
    // the overwhelmingly common no-signal path. Candidate=true, position
    // management, pending reconciliation and every order mutation continue
    // through the original locked path below.
    const preState = await readFetBrk48State(this.deps.statePath, this.deps.runtimeSha);
    const boundaryTs = Math.floor(now/3_600_000)*3_600_000;
    let heldReturnTelemetry: {value:number|undefined;boundaryTs:number}|undefined;
    if (preState.position && preState.lastEvaluationReturn72hObservedTs !== boundaryTs) {
      try { const rows = normalizeFetH1(await this.deps.client.getKlines("FETUSDT", "1h", 120), now); heldReturnTelemetry = {value:fetCompletedReturn72h(rows,boundaryTs),boundaryTs}; }
      catch { heldReturnTelemetry = {value:undefined,boundaryTs}; }
    }
    if (!preState.position && !preState.pending && !preState.manualReview) {

      // The flat/no-signal fast path only needs to prove that FET itself has
      // no venue exposure.  Reading account-wide openOrders here costs weight
      // 40 every 30 seconds and can starve shared-risk/account reads.  A real
      // candidate still falls through to the locked path below, which keeps
      // the authoritative account-wide positions/orders/risk reconciliation.
      const [prePositionRows, preOpenOrders] = await Promise.all([
        this.deps.client.getPositions("FETUSDT"),
        this.deps.client.getOpenOrders("FETUSDT"),
      ]);
      const venueFlat = prePositionRows.every((row) => Math.abs(finite(row.positionAmt)) <= EPS)
        && preOpenOrders.length === 0;
      if (venueFlat && now >= (preState.cooldownUntilTs || 0)) {
        const preKlines = await this.deps.client.getKlines("FETUSDT", "1h", 120);
        const preDecisionTs = Math.floor(now / 3_600_000) * 3_600_000;
        const preSignal = buildFetBrk48Signal(normalizeFetH1(preKlines, now), now);
        if (!preSignal) {
          preState.lastEvaluationReturn72h = fetCompletedReturn72h(normalizeFetH1(preKlines,now),preDecisionTs);
          preState.lastEvaluationReturn72hObservedTs = preDecisionTs;
          preState.lastEvaluationDecisionTs = preDecisionTs;
          preState.lastEvaluationCandidate = false;
          preState.lastEvaluationReason="FET_NO_BRK48_R72_SIGNAL";
          await writeFetBrk48State(this.deps.statePath, preState);
          return { status: "no-signal", message: "FET_NO_BRK48_SIGNAL", ordersSent: 0 };
        }
      }
    }

    const accountLock = this.deps.accountLock || new FileAccountOrderLock();
    const lock = await accountLock.acquire(`FET_BRK48_RESIDUAL:${this.deps.runtimeSha}`, "ASTER_FUTURES");
    if (!lock) return { status: "locked", message: "FET_ACCOUNT_ORDER_LOCK_BUSY", ordersSent: 0 };

    try {
      let state = await readFetBrk48State(this.deps.statePath, this.deps.runtimeSha);
      if(heldReturnTelemetry){state.lastEvaluationReturn72h=heldReturnTelemetry.value;state.lastEvaluationReturn72hObservedTs=heldReturnTelemetry.boundaryTs;}
      // Persist a heartbeat even while flat/no-signal so health monitoring can
      // distinguish a healthy idle runner from a missing/stale state store.
      await writeFetBrk48State(this.deps.statePath, state);
      if (state.manualReview) return { status: "manual-review", message: state.manualReview, ordersSent: 0 };

      const pendingResult = await reconcilePending(this.deps, state);
      if (pendingResult) return pendingResult;
      state = await readFetBrk48State(this.deps.statePath, this.deps.runtimeSha);

      const [account, positions, openOrders, q102] = await Promise.all([
        this.deps.executor.getAccountSnapshot(),
        this.deps.executor.getPositions(),
        this.deps.executor.getOpenOrders(),
        readQuality102CausalV1Ownership({ expectedRuntimeSha: process.env.DISDEX_Q102_RUNTIME_SHA || this.deps.runtimeSha }),
      ]);
      const q102Fet = activePosition(positions).filter((row) => quality102OwnsPosition(q102, row));
      const ours = activePosition(positions).filter((row) => !quality102OwnsPosition(q102, row));

      if (state.position) {
        if (q102Fet.length) {
          state.manualReview = "FET_STATE_Q102_OWNERSHIP_COLLISION";
          await writeFetBrk48State(this.deps.statePath, state);
          return { status: "manual-review", message: state.manualReview, ordersSent: 0 };
        }
        if (ours.length === 0) {
          const stop = await this.deps.adapter.queryOrderSameId("FETUSDT", state.position.stopClientOrderId);
          if (stop && String(stop.status).toUpperCase() === "FILLED") {
            const completedStopClientOrderId = state.position.stopClientOrderId;
            recordFetExit(state, Number(stop.updatedAt)>0?Number(stop.updatedAt):now);
            state.position = undefined;
            state.lastCompletedIdempotencyKey = completedStopClientOrderId;
            state.lastReconciledAt = now;
            await writeFetBrk48State(this.deps.statePath, state);
            return { status: "exited", message: "FET_HARD_STOP_FILL_RECONCILED", ordersSent: 0 };
          }
          state.manualReview = "FET_STATE_POSITION_MISSING_WITHOUT_PROVEN_STOP_FILL";
          await writeFetBrk48State(this.deps.statePath, state);
          return { status: "manual-review", message: state.manualReview, ordersSent: 0 };
        }
        if (ours.length !== 1 || ours[0].quantity <= 0) {
          state.manualReview = "FET_LIVE_POSITION_STATE_MISMATCH";
          await writeFetBrk48State(this.deps.statePath, state);
          return { status: "manual-review", message: state.manualReview, ordersSent: 0 };
        }
        const venueQuantityChanged = Math.abs(Math.abs(ours[0].quantity) - state.position.quantity) > Math.max(1e-8, state.position.quantity * 0.001);
        if (venueQuantityChanged) {
          const previousStopClientOrderId = state.position.stopClientOrderId;
          const nextStopClientOrderId = deterministicId(
            "stop",
            `${state.position.entryTs}|${ours[0].quantity}|${state.position.entryPrice}|partial-quantity`,
          );
          try {
            await replaceProtection(this.deps, state, ours[0], {
              entryTs: state.position.entryTs,
              exitTs: state.position.exitTs,
              targetGross: state.position.gross,
              hardStopPct: FET_BRK48_RESIDUAL.hardStopPct,
              requestedStopPrice: state.position.hardStop,
              stopClientOrderId: nextStopClientOrderId,
              protectionMode: state.position.protectionMode,
              profitFloorArmedAt: state.position.profitFloorArmedAt,
              profitFloorTriggerPrice: state.position.profitFloorTriggerPrice,
              trailingStop: state.position.trailingStop,
            }, previousStopClientOrderId);
          } catch (error) {
            if (error instanceof FetProtectionReplacementError && error.newProtectionVerified) {
              return { status: "manual-review", message: error.message, ordersSent: 1 };
            }
            await emergencyFlattenProtectedFailure(this.deps, state, ours[0], error instanceof Error ? error.message : String(error));
            return { status: "manual-review", message: state.manualReview || "FET_PARTIAL_POSITION_PROTECTION_FAILURE", ordersSent: 1 };
          }
        }
        if (!await verifyStop(this.deps.adapter, state.position)) {
          try {
            await ensureProtection(this.deps, state, ours[0], {
              entryTs: state.position.entryTs,
              exitTs: state.position.exitTs,
              targetGross: state.position.gross,
              hardStopPct: FET_BRK48_RESIDUAL.hardStopPct,
              stopClientOrderId: state.position.stopClientOrderId,
              requestedStopPrice: state.position.hardStop,
              protectionMode: state.position.protectionMode,
              profitFloorArmedAt: state.position.profitFloorArmedAt,
              profitFloorTriggerPrice: state.position.profitFloorTriggerPrice,
              trailingStop: state.position.trailingStop,
            });
            await writeFetBrk48State(this.deps.statePath, state);
          } catch (error) {
            await emergencyFlattenProtectedFailure(this.deps, state, ours[0], error instanceof Error ? error.message : String(error));
            return { status: "manual-review", message: state.manualReview || "FET_PROTECTION_FAILURE", ordersSent: 1 };
          }
        }
        if (now >= state.position.exitTs) return executeExit(this.deps, state, ours[0]);
        try {
          const profitFloorArmed = await maybeArmProfitFloor(this.deps, state, ours[0]);
          const trailing = await maybeAdvanceTrailingStop(this.deps, state, ours[0]);
          if (trailing.kind === "manual-review") {
            return { status: "manual-review", message: trailing.message, ordersSent: trailing.ordersSent, gross: state.position?.gross };
          }
          state.lastReconciledAt = now;
          await writeFetBrk48State(this.deps.statePath, state);
          if (trailing.kind === "updated") {
            return { status: "held", message: trailing.message, ordersSent: trailing.ordersSent, gross: state.position?.gross };
          }
          if (profitFloorArmed) {
            return { status: "held", message: "FET_PROFIT_FLOOR_ARMED_3P0_AFTER_5P0", ordersSent: 1, gross: state.position?.gross };
          }
        } catch (error) {
          if (error instanceof FetProtectionReplacementError && error.newProtectionVerified) {
            return { status: "manual-review", message: error.message, ordersSent: 1, gross: state.position?.gross };
          }
          await emergencyFlattenProtectedFailure(this.deps, state, ours[0], error instanceof Error ? error.message : String(error));
          return { status: "manual-review", message: state.manualReview || "FET_PROFIT_FLOOR_PROTECTION_FAILURE", ordersSent: 1 };
        }
        state.lastReconciledAt = now;
        await writeFetBrk48State(this.deps.statePath, state);
        return { status: "held", message: "FET_POSITION_HELD_PROTECTED", ordersSent: 0, gross: state.position.gross };
      }

      if (ours.length) {
        state.manualReview = "FET_UNOWNED_LIVE_POSITION_PRESENT";
        await writeFetBrk48State(this.deps.statePath, state);
        return { status: "manual-review", message: state.manualReview, ordersSent: 0 };
      }
      if (q102Fet.length) return { status: "held", message: "FET_SYMBOL_CURRENTLY_OWNED_BY_Q102", ordersSent: 0 };

      const managed = new Set([
        ...findManagedOrdinaryResidentStops(openOrders, positions),
        ...findManagedPenguRecoveryV8ProtectiveOrders(openOrders, positions),
        ...findManagedV12ProtectiveOrders(openOrders, positions),
        ...findManagedFetBrk48ProtectiveOrders(openOrders, positions),
        ...findManagedIdlePriorityShortProtectiveOrders(openOrders, positions),
      ]);
      const unmanaged = openOrders.filter((order) => !managed.has(order) && !quality102OwnsOrder(q102, order));
      if (unmanaged.length) return { status: "blocked", message: "FET_UNMANAGED_OPEN_ORDER_CONFLICT", ordersSent: 0 };

      if(now < (state.cooldownUntilTs||0)) {
        state.lastEvaluationDecisionTs=Math.floor(now/3_600_000)*3_600_000;state.lastEvaluationCandidate=false;state.lastEvaluationReason="FET_POST_EXIT_COOLDOWN_24H";
        await writeFetBrk48State(this.deps.statePath,state);return {status:"held",message:"FET_POST_EXIT_COOLDOWN_24H",ordersSent:0};
      }
      const klines = await this.deps.client.getKlines("FETUSDT", "1h", 120);
      const evaluationDecisionTs = Math.floor(now / 3_600_000) * 3_600_000;
      const signal = now < (state.cooldownUntilTs||0) ? undefined : buildFetBrk48Signal(normalizeFetH1(klines, now), now);
      state.lastEvaluationReason=now < (state.cooldownUntilTs||0)?"FET_POST_EXIT_COOLDOWN_24H":signal?"FET_BRK48_R72_SIGNAL":"FET_NO_BRK48_R72_SIGNAL";
      state.lastEvaluationReturn72h = fetCompletedReturn72h(normalizeFetH1(klines,now),evaluationDecisionTs);
      state.lastEvaluationReturn72hObservedTs = evaluationDecisionTs;
      state.lastEvaluationDecisionTs = evaluationDecisionTs;
      state.lastEvaluationCandidate = Boolean(signal);
      await writeFetBrk48State(this.deps.statePath, state);
      // Candidate=true is intentionally published before any order mutation:
      // Idle must fail closed while a current-cycle FET candidate is unresolved.
      if (!signal) return { status: "no-signal", message: "FET_NO_BRK48_SIGNAL", ordersSent: 0 };
      if (state.lastReferenceTs && signal.referenceTs <= state.lastReferenceTs) {
        return { status: "held", message: "FET_SIGNAL_ALREADY_PROCESSED", ordersSent: 0, signal };
      }

      await assertSharedKillSwitchAllowsNewEntry();
      const sharedRisk = await readSharedCryptoDailyRiskWithRolloverRetry(
        this.deps.sharedRiskPath || process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_FILE || DEFAULT_RISK_PATH,
        { now: this.deps.now || Date.now },
      );
      if (!sharedRisk.ok || !sharedRisk.state || sharedRisk.state.tripped) {
        return { status: "blocked", message: `FET_SHARED_RISK_BLOCKED:${sharedRisk.reason || "TRIPPED"}`, ordersSent: 0, signal };
      }

      const residualPreemption = await releaseIdleResidualLongForFormalEntry({
        executor: this.deps.executor,
        adapter: this.deps.adapter,
        lock,
        positions,
        causeIdempotencyKey: `FET_BRK48_RESIDUAL|${signal.referenceTs}|ENTRY`,
        expectedRuntimeSha: this.deps.runtimeSha,
        statePath: process.env.DISDEX_IDLE_RESIDUAL_LONG_STATE_PATH,
        enabled: /^(1|true|yes|on)$/i.test(String(process.env.DISDEX_IDLE_RESIDUAL_LONG_ENABLED || "")),
        maxSlippageBps: this.deps.maxSlippageBps,
        now: this.deps.now,
      });
      if (residualPreemption.status === "blocked") {
        return { status: "blocked", message: residualPreemption.message, ordersSent: 0, signal };
      }
      if (residualPreemption.status === "reduced") {
        return { status: "preempted", message: `IDLE_RESIDUAL_PREEMPTED_FOR_FET_PRIORITY_ENTRY:${residualPreemption.symbol}`, ordersSent: 1, signal };
      }

      const equity = portfolioEquity(account.walletBalance, positions);
      if (!(equity > 0)) return { status: "blocked", message: "FET_EQUITY_INVALID", ordersSent: 0, signal };
      const gross = await portfolioGross(positions, equity, q102);
      if (gross.unknown.length) return { status: "blocked", message: `FET_UNKNOWN_POSITION:${gross.unknown.join(",")}`, ordersSent: 0, signal };
      const pending = aggregatePendingExposure(await readPendingExposureRegistry());
      gross.cryptoGross += pending.cryptoGross;
      gross.totalGross += pending.cryptoGross + pending.stockGross;
      const residual = Math.max(0, Math.min(
        FET_BRK48_RESIDUAL.maximumGross,
        INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap - gross.cryptoGross,
        INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap - gross.totalGross,
      ));
      if (residual + EPS < FET_BRK48_RESIDUAL.minimumResidualGross) {
        const candidateGross = Math.min(
          FET_BRK48_RESIDUAL.maximumGross,
          Math.max(0, account.availableBalance) * FET_BRK48_RESIDUAL.requiredLeverage / equity,
        );
        const preemptionEnabled = /^(1|true|yes|on)$/i.test(String(process.env.DISDEX_HYPE_ZEC_PREEMPTION_ENABLED || ""));
        const candidate: StrictPortfolioIntent = {
          idempotencyKey: `FET_BRK48_RESIDUAL|${signal.referenceTs}|HYPE_ZEC_PREEMPTION`,
          strategy: "FET_RESIDUAL",
          symbol: "FETUSDT",
          side: "LONG",
          gross: candidateGross,
          requestedGross: candidateGross,
          notionalUsd: candidateGross * equity,
          signalTs: signal.referenceTs,
        };
        const sidecarCausesCapacity = preemptionEnabled && isHypeZecSoleSharedCapacityCause({
          positions,
          equityUsd: equity,
          pendingCryptoGross: pending.cryptoGross,
          pendingTotalGross: pending.cryptoGross + pending.stockGross,
          candidateGross,
          candidateSymbol: "FETUSDT",
          candidateStrategy: "FET_RESIDUAL",
          cryptoEntryCap: INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap,
          totalEntryCap: INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap,
        });
        if (sidecarCausesCapacity) {
          const released = await releaseHypeZecCapacityForPriorityEntry({
            adapter: this.deps.adapter,
            executor: this.deps.executor,
            lock,
            positions,
            equityUsd: equity,
            candidate,
            pendingCryptoGross: pending.cryptoGross,
            pendingTotalGross: pending.cryptoGross + pending.stockGross,
            cryptoEntryCap: INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap,
            totalEntryCap: INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap,
            causeIdempotencyKey: candidate.idempotencyKey,
            expectedRuntimeSha: this.deps.runtimeSha,
            enabled: true,
            statePath: process.env.DISDEX_HYPE_ZEC_PREEMPTION_STATE_PATH,
            maxSlippageBps: this.deps.maxSlippageBps,
          });
          if (released.status === "reduced") {
            const reductionOrders = released.result?.status === "reduced" ? released.result.results.length : 0;
            return { status: "preempted", message: "HYPE_ZEC_PREEMPTED_FOR_FET_PRIORITY_ENTRY", ordersSent: reductionOrders, signal };
          }
        }
        state.lastReferenceTs = Math.max(state.lastReferenceTs || 0, signal.referenceTs);
        await writeFetBrk48State(this.deps.statePath, state);
        return { status: "held", message: "FET_RESIDUAL_BELOW_MINIMUM", ordersSent: 0, signal, gross: residual };
      }

      const quote = await this.deps.executor.getMarketQuote("FETUSDT");
      const executablePrice = quote.askPrice;
      if (!(executablePrice > 0)) return { status: "blocked", message: "FET_ENTRY_QUOTE_INVALID", ordersSent: 0, signal };
      const leverageNotionalCapacity = Math.max(0, account.availableBalance) * FET_BRK48_RESIDUAL.requiredLeverage;
      const requestedNotional = Math.min(residual * equity, leverageNotionalCapacity);
      const targetGross = requestedNotional / equity;
      if (targetGross + EPS < FET_BRK48_RESIDUAL.minimumResidualGross || requestedNotional < (this.deps.minimumOrderNotionalUsd ?? 5)) {
        state.lastReferenceTs = Math.max(state.lastReferenceTs || 0, signal.referenceTs);
        await writeFetBrk48State(this.deps.statePath, state);
        return { status: "held", message: "FET_MARGIN_RESIDUAL_BELOW_EXECUTABLE_MINIMUM", ordersSent: 0, signal, gross: targetGross };
      }

      const plannerNow = this.deps.now ? this.deps.now() : Date.now();
      const idempotencyKey = deterministicFetEntryIdempotencyKey(signal.referenceTs);
      const liveCandidate = buildLiveEntryCandidate({
        idempotencyKey,
        strategy: "FET_RESIDUAL", symbol: "FETUSDT", side: "LONG", signalTs: signal.referenceTs,
        score: liveEntryScore("FET_RESIDUAL", signal), targetGross,
        minGross: Math.max(FET_BRK48_RESIDUAL.minimumResidualGross, (this.deps.minimumOrderNotionalUsd ?? 5) / equity),
        maxGross: FET_BRK48_RESIDUAL.maximumGross,
      });
      const strictActive = await Promise.all(positions.filter((position) => Math.abs(position.quantity) > EPS).map(async (position) =>
        toStrictPosition(position, plannerNow, q102, quality102OwnsPosition(q102, position)
          ? await this.deps.executor.getMarketQuote(position.symbol) : undefined)));
      const plan = planStrictPortfolio({ equity, now: plannerNow, active: strictActive,
        pendingExposure: pending, availableBalanceUsd: account.availableBalance,
        sharedDailyRisk: sharedRisk.state, intents: [strictIntentForLiveCandidate(liveCandidate, equity)],
        maxDataAgeMs: 5 * 60_000 });
      const approved = plan.status === "planned" ? plan.accepted.find((row) => row.idempotencyKey === liveCandidate.idempotencyKey) : undefined;
      if (!approved || plan.reductions.length > 0) {
        state.lastReferenceTs = Math.max(state.lastReferenceTs || 0, signal.referenceTs);
        await writeFetBrk48State(this.deps.statePath, state);
        return { status: "held", message: `FET_STRICT_PLAN_BLOCKED:${plan.reason || plan.rejected[0]?.reason || "NO_APPROVAL"}`, ordersSent: 0, signal };
      }
      let approvedGross: number;
      try {
        approvedGross = requireApprovedLiveGross({ candidate: liveCandidate, approved,
          now: this.deps.now ? this.deps.now() : Date.now(), snapshotAt: account.updatedAt,
          approvedAt: plannerNow, maxAgeMs: 5 * 60_000 });
      } catch (error) {
        return { status: "held", message: `FET_APPROVAL_BLOCKED:${error instanceof Error ? error.message : String(error)}`, ordersSent: 0, signal };
      }

      const normalized = await this.deps.executor.normalizeMarketQuantity("FETUSDT", approvedGross * equity / executablePrice, executablePrice);
      if (!(normalized.quantity > 0)) return { status: "blocked", message: "FET_ENTRY_QUANTITY_INVALID", ordersSent: 0, signal };

      if (state.lastCompletedIdempotencyKey === idempotencyKey) {
        return { status: "held", message: "FET_ENTRY_ALREADY_COMPLETED", ordersSent: 0, signal, gross: approvedGross };
      }
      const clientOrderId = deterministicId("entry", idempotencyKey);
      state.pending = {
        action: "ENTRY",
        idempotencyKey,
        clientOrderId,
        symbol: "FETUSDT",
        side: "BUY",
        quantity: normalized.quantity,
        referenceTs: signal.referenceTs,
        createdAt: now,
        updatedAt: now,
        expectedPrice: executablePrice,
        reason: "FET_BRK48_LONG_ENTRY",
        targetGross: approvedGross,
        entryTs: signal.entryTs,
        exitTs: signal.exitTs,
        hardStopPct: FET_BRK48_RESIDUAL.hardStopPct,
        approvalSource: "STRICT_PLANNER_APPROVAL",
      };
      await writeFetBrk48State(this.deps.statePath, state);
      const reservation = await lock.reserve({
        strategyId: FET_BRK48_RESIDUAL.strategyId,
        symbol: "FETUSDT",
        side: "LONG",
        gross: approvedGross,
        notionalUsd: normalized.notional,
      });
      let releaseExposureReservation = false;
      try {
        const result = await this.deps.executor.executeMarket({
          requestId: idempotencyKey,
          clientOrderId,
          symbol: "FETUSDT",
          side: "BUY",
          quantity: normalized.quantity,
          expectedPrice: executablePrice,
          maxSlippageBps: this.deps.maxSlippageBps ?? 20,
          reason: "FET_BRK48_LONG_ENTRY",
          requireVenueMargin5xCross: true,
          maxEntryNotionalUsd: approvedGross * equity,
        });
        if (result.status === "UNKNOWN" || result.executionUnknown) {
          state.manualReview = "FET_ENTRY_EXECUTION_UNKNOWN";
          await writeFetBrk48State(this.deps.statePath, state);
          return { status: "manual-review", message: state.manualReview, ordersSent: 1, signal, gross: approvedGross };
        }
        const actual = activePosition(await this.deps.executor.getPositions()).filter((row) => row.quantity > 0);
        if (actual.length !== 1) {
          state.manualReview = "FET_ENTRY_POSITION_READBACK_MISMATCH";
          await writeFetBrk48State(this.deps.statePath, state);
          return { status: "manual-review", message: state.manualReview, ordersSent: 1, signal, gross: approvedGross };
        }
        try {
          await ensureProtection(this.deps, state, actual[0], {
            entryTs: signal.entryTs,
            exitTs: signal.exitTs,
            targetGross: approvedGross,
            hardStopPct: FET_BRK48_RESIDUAL.hardStopPct,
          });
        } catch (error) {
          await emergencyFlattenProtectedFailure(this.deps, state, actual[0], error instanceof Error ? error.message : String(error));
          return { status: "manual-review", message: state.manualReview || "FET_PROTECTION_FAILURE", ordersSent: 2, signal, gross: approvedGross };
        }
        state.pending = undefined;
        state.lastReferenceTs = signal.referenceTs;
        state.lastCompletedIdempotencyKey = idempotencyKey;
        state.manualReview = result.status === "FILLED" ? undefined : "FET_PARTIAL_ENTRY_PROTECTED_OPERATOR_REVIEW";
        state.lastReconciledAt = now;
        await writeFetBrk48State(this.deps.statePath, state);
        releaseExposureReservation = true;
        return {
          status: state.manualReview ? "manual-review" : "entered",
          message: state.manualReview || "FET_ENTRY_FILLED_AND_PROTECTED",
          ordersSent: 1,
          signal,
          gross: approvedGross,
        };
      } finally {
        if (releaseExposureReservation) await lock.releaseReservation(reservation.reservationId).catch(() => undefined);
      }
    } finally {
      await lock.release();
    }
  }
}
