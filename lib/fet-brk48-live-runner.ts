import { createHash } from "node:crypto";

import { FET_BRK48_RESIDUAL } from "@/config/fetBrk48Runtime";
import { INTEGRATED_PRODUCTION_RISK_POLICY } from "@/config/integratedProductionRiskPolicy";
import type { AsterV3Client } from "@/lib/aster-v3-client";
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
  findManagedPenguRecoveryV8ProtectiveOrders,
  findManagedV12ProtectiveOrders,
} from "@/lib/disdex-managed-protective-orders";
import type { DirectOpenOrder, DirectPosition, DirectTradeExecutor } from "@/lib/direct-trade-executor";
import { buildFetBrk48Signal, normalizeFetH1, type FetBrk48Signal } from "@/lib/fet-brk48-signal";
import {
  readFetBrk48State,
  writeFetBrk48State,
  type FetBrk48PendingState,
  type FetBrk48PositionState,
  type FetBrk48State,
} from "@/lib/fet-brk48-state";
import type { V12AsterLiveAdapter } from "@/lib/v12-aster-live-adapter";
import { aggregatePendingExposure, readPendingExposureRegistry } from "@/lib/disdex-pending-exposure-registry";

const EPS = 1e-9;
const DEFAULT_RISK_PATH = "/var/lib/disdex/shared/crypto-daily-risk.json";

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
  status: "held" | "entered" | "exited" | "preempted" | "blocked" | "manual-review" | "no-signal";
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

async function maybeArmProfitFloor(
  deps: FetBrk48LiveRunnerDependencies,
  state: FetBrk48State,
  actual: DirectPosition,
) {
  const position = state.position;
  if (!position) return false;
  if (position.protectionMode === "PROFIT_FLOOR_0P5") return false;

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
    position.protectionMode = "PROFIT_FLOOR_0P5";
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

  await deps.adapter.cancel(previousStopClientOrderId);
  await ensureProtection(deps, state, actual, {
    entryTs: position.entryTs,
    exitTs: position.exitTs,
    targetGross: position.gross,
    hardStopPct: FET_BRK48_RESIDUAL.hardStopPct,
    requestedStopPrice: normalizedFloor.price,
    stopClientOrderId: nextStopClientOrderId,
    protectionMode: "PROFIT_FLOOR_0P5",
    profitFloorArmedAt: armedAt,
    profitFloorTriggerPrice: triggerPrice,
  });
  return true;
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
  state.failures.push({ occurredAt: now, message: reason });
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
    const accountLock = this.deps.accountLock || new FileAccountOrderLock();
    const lock = await accountLock.acquire(`FET_BRK48_RESIDUAL:${this.deps.runtimeSha}`, "ASTER_FUTURES");
    if (!lock) return { status: "blocked", message: "FET_ACCOUNT_ORDER_LOCK_BUSY", ordersSent: 0 };

    try {
      let state = await readFetBrk48State(this.deps.statePath, this.deps.runtimeSha);
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
        if (ours.length !== 1 || ours[0].quantity <= 0 || Math.abs(Math.abs(ours[0].quantity) - state.position.quantity) > Math.max(1e-8, state.position.quantity * 0.02)) {
          state.manualReview = "FET_LIVE_POSITION_STATE_MISMATCH";
          await writeFetBrk48State(this.deps.statePath, state);
          return { status: "manual-review", message: state.manualReview, ordersSent: 0 };
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
          state.lastReconciledAt = now;
          await writeFetBrk48State(this.deps.statePath, state);
          if (profitFloorArmed) {
            return { status: "held", message: "FET_PROFIT_FLOOR_ARMED_0P5_AFTER_5P0", ordersSent: 1, gross: state.position?.gross };
          }
        } catch (error) {
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
        ...findManagedPenguRecoveryV8ProtectiveOrders(openOrders, positions),
        ...findManagedV12ProtectiveOrders(openOrders, positions),
        ...findManagedFetBrk48ProtectiveOrders(openOrders, positions),
      ]);
      const unmanaged = openOrders.filter((order) => !managed.has(order) && !quality102OwnsOrder(q102, order));
      if (unmanaged.length) return { status: "blocked", message: "FET_UNMANAGED_OPEN_ORDER_CONFLICT", ordersSent: 0 };

      const klines = await this.deps.client.getKlines("FETUSDT", "1h", 120);
      const signal = buildFetBrk48Signal(normalizeFetH1(klines, now), now);
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

      const normalized = await this.deps.executor.normalizeMarketQuantity("FETUSDT", requestedNotional / executablePrice, executablePrice);
      if (!(normalized.quantity > 0)) return { status: "blocked", message: "FET_ENTRY_QUANTITY_INVALID", ordersSent: 0, signal };

      const idempotencyKey = createHash("sha256")
        .update(`FET|ENTRY|${signal.referenceTs}|${targetGross.toFixed(12)}`)
        .digest("hex");
      if (state.lastCompletedIdempotencyKey === idempotencyKey) {
        return { status: "held", message: "FET_ENTRY_ALREADY_COMPLETED", ordersSent: 0, signal, gross: targetGross };
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
        targetGross,
        entryTs: signal.entryTs,
        exitTs: signal.exitTs,
        hardStopPct: FET_BRK48_RESIDUAL.hardStopPct,
      };
      await writeFetBrk48State(this.deps.statePath, state);
      const reservation = await lock.reserve({
        strategyId: FET_BRK48_RESIDUAL.strategyId,
        symbol: "FETUSDT",
        side: "LONG",
        gross: targetGross,
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
        });
        if (result.status === "UNKNOWN" || result.executionUnknown) {
          state.manualReview = "FET_ENTRY_EXECUTION_UNKNOWN";
          await writeFetBrk48State(this.deps.statePath, state);
          return { status: "manual-review", message: state.manualReview, ordersSent: 1, signal, gross: targetGross };
        }
        const actual = activePosition(await this.deps.executor.getPositions()).filter((row) => row.quantity > 0);
        if (actual.length !== 1) {
          state.manualReview = "FET_ENTRY_POSITION_READBACK_MISMATCH";
          await writeFetBrk48State(this.deps.statePath, state);
          return { status: "manual-review", message: state.manualReview, ordersSent: 1, signal, gross: targetGross };
        }
        try {
          await ensureProtection(this.deps, state, actual[0], {
            entryTs: signal.entryTs,
            exitTs: signal.exitTs,
            targetGross,
            hardStopPct: FET_BRK48_RESIDUAL.hardStopPct,
          });
        } catch (error) {
          await emergencyFlattenProtectedFailure(this.deps, state, actual[0], error instanceof Error ? error.message : String(error));
          return { status: "manual-review", message: state.manualReview || "FET_PROTECTION_FAILURE", ordersSent: 2, signal, gross: targetGross };
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
          gross: targetGross,
        };
      } finally {
        if (releaseExposureReservation) await lock.releaseReservation(reservation.reservationId).catch(() => undefined);
      }
    } finally {
      await lock.release();
    }
  }
}
