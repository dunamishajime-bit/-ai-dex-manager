import { recordPenguClosedTrade } from "./pengu-route-quarantine-dd-governor";
import { cooldownHoursForPenguExit } from "./pengu-dual-ls-v2";
import { recordPenguM05ShadowExitOutcome, type PenguDualLsV2RunnerState } from "./pengu-dual-ls-v2-runner-state";
import type { V12X1AllRunnerState } from "./v12-x1-all-runner-state";

/**
 * Operator-only preparation of an external manual-close state reconciliation.
 * PURE: this module never writes state, sends orders, or disables the kill switch.
 * An independent guarded operator transaction must validate the venue again,
 * archive all four original documents, and atomically apply the returned payloads.
 */
export type ExternalFlatProof = {
  observedAt: number;
  consecutiveSuccesses: number;
  openPositionCount: number;
  openOrderCount: number;
  ordersSent: false;
  cancelSent: false;
  positionChangesSent: false;
};
export type AuthenticatedFill = {
  symbol: string;
  orderId: number;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  time: number;
  realizedPnl: number;
  commission: number;
};
type ObjectState = Record<string, unknown>;

function ensure(ok: unknown, code: string): asserts ok {
  if (!ok) throw new Error("EXTERNAL_MANUAL_FLAT_BLOCKED:" + code);
}
const equal = (a: number, b: number) => Math.abs(a-b) <= Math.max(1e-8, b * 1e-8);

export function prepareExternalManualFlatReconciliation(input: {
  productionSha: string;
  now: number;
  proof: ExternalFlatProof;
  pengu: PenguDualLsV2RunnerState;
  v52: ObjectState;
  v12: V12X1AllRunnerState;
  killSwitch: ObjectState;
  penguEntry: AuthenticatedFill;
  penguExit: AuthenticatedFill;
  tslaEntry: AuthenticatedFill;
  tslaExit: AuthenticatedFill;
}) {
  const { productionSha, now, proof } = input;
  ensure(/^[a-f0-9]{40}$/.test(productionSha), "SHA");
  ensure(proof.consecutiveSuccesses >= 3 && proof.openOrderCount === 0 && proof.openPositionCount === 0
    && proof.ordersSent === false && proof.cancelSent === false && proof.positionChangesSent === false,
    "AUTHENTICATED_TRIPLE_FLAT");
  ensure(now >= proof.observedAt && now - proof.observedAt < 60_000, "PROOF_STALE");
  const k = input.killSwitch, p = input.pengu, stock = input.v52, v = input.v12;
  ensure(k.active === true && k.action === "FLATTEN_MANAGED"
    && k.escalatedFrom === "HOLD_PROTECTED"
    && k.reason === "V52 managed Stock symbol reconciliation mismatch"
    && k.operator === "disdex-v52-aster-only", "KILL_REASON");
  ensure(v.mode === "LIVE" && v.runtimeCommitSha === productionSha
    && !v.active && (!v.activePositions || v.activePositions.length === 0)
    && !v.pending && v.reconciliationStatus === "MANUAL_REVIEW"
    && String(v.manualReview || "").startsWith("SHARED_KILL_SWITCH_ACTIVE:V52 recoverable tick error:")
    && v.killSwitch?.active === true, "V12_STATE");
  ensure(p.mode === "LIVE" && p.strategyId === "PENGU_DUAL_LS_V2_FINAL"
    && !p.pending && p.position?.entryVersion === "SHORT_V20"
    && p.position?.side === -1 && p.position?.quantity === 7718 && p.position?.entryPrice === 0.008574,
    "PENGU_STATE");
  const positions = stock.positions as Record<string, Record<string, unknown>> | undefined;
  ensure(!!positions && Object.keys(positions).length === 1
    && positions.V50_POST_OPEN_BASIS?.symbol === "TSLA"
    && positions.V50_POST_OPEN_BASIS?.asterQty === 0.38 && !stock.pendingOrder,
    "V52_STATE");
  const fills = [
    [input.penguEntry, "PENGUUSDT", "SELL", 7718, 0.008574],
    [input.penguExit, "PENGUUSDT", "BUY", 7718, 0.008163],
    [input.tslaEntry, "TSLAUSDT", "BUY", 0.38, 372.64],
    [input.tslaExit, "TSLAUSDT", "SELL", 0.38, 378.87],
  ] as const;
  for (const [f,s,side,qty,price] of fills) {
    ensure(f.symbol === s && f.side === side && equal(f.qty, qty)
      && equal(f.price, price) && Number.isFinite(f.commission) && f.commission >= 0
      && Number.isSafeInteger(f.orderId)
      && f.orderId > 0 && f.time > 0, "FILL_IDENTITY");
  }
  ensure(input.penguEntry.time < input.penguExit.time
    && input.tslaEntry.time < input.tslaExit.time
    && input.penguExit.time <= proof.observedAt
    && input.tslaExit.time <= proof.observedAt, "FILL_CHRONOLOGY");
  ensure(p.position?.residentStop?.orderId !== input.penguExit.orderId,
    "MANUAL_CLOSE_IS_NOT_RESIDENT_STOP");
  ensure(equal(input.penguExit.realizedPnl, 3.172098)
    && equal(input.tslaExit.realizedPnl, 2.3674),
    "REALIZED_PNL");
  const directionReturn = p.position!.entryPrice / input.penguExit.price - 1;
  const realizedAccountReturn = p.position!.gross * (directionReturn - 2 * 0.0006);
  const updatedPengu: PenguDualLsV2RunnerState = structuredClone(p);
  updatedPengu.riskOverlay = recordPenguClosedTrade(updatedPengu.riskOverlay, "SHORT_V20", realizedAccountReturn, input.penguExit.time);
  recordPenguM05ShadowExitOutcome(updatedPengu, {
    entryTs: p.position!.entryTs,
    exitIdempotencyKey: "manual:" + input.penguExit.orderId,
    exitFillObservedAt: input.penguExit.time,
    exitFillPrice: input.penguExit.price,
    exitReason: "OPERATOR_EXTERNAL_MANUAL_CLOSE",
    realizedDirectionalReturn: directionReturn,
    realizedNetAccountReturn: realizedAccountReturn,
  });
  updatedPengu.position = undefined;
  updatedPengu.updatedAt = now;
  updatedPengu.cooldownUntilTs = Math.max(updatedPengu.cooldownUntilTs || 0, input.penguExit.time + cooldownHoursForPenguExit(undefined) * 3_600_000);
  const v52Ledger = stock.v52Ledger as { strategyId?: string; trades?: Record<string, unknown>[] } | undefined;
  ensure(v52Ledger?.strategyId === stock.strategyId
    && Array.isArray(v52Ledger?.trades)
    && !v52Ledger?.trades?.some(row => row.tradeId === "manual:" + input.tslaExit.orderId
      || row.clientOrderId === "manual:" + input.tslaExit.orderId), "V52_LEDGER_IDENTITY");
  ensure(Number.isSafeInteger(stock.v50CompletedTrades)
    && (stock.v50CompletedTrades as number) >= 0, "V52_COMPLETED_TRADE_COUNT");
  const stockPosition = positions!.V50_POST_OPEN_BASIS!;
  const v52GrossPnl = (input.tslaExit.price - input.tslaEntry.price) * input.tslaExit.qty;
  const v52Commission = input.tslaEntry.commission + input.tslaExit.commission;
  const updatedV52: ObjectState = {
    ...stock,
    positions:{},
    updatedAt:now,
    v50CompletedTrades:(stock.v50CompletedTrades as number)+1,
    v52Ledger:{...v52Ledger, trades:[...v52Ledger!.trades!, {
      strategyId:"V50_POST_OPEN_BASIS", symbol:"TSLA", side:"LONG",
      entryAt:stockPosition.openedAt, exitAt:input.tslaExit.time,
      realizedPnl:v52GrossPnl-v52Commission, unrealizedPnl:0,
      commission:v52Commission, funding:0, deposits:0, withdrawals:0,
      unattributedDifference:0,
      clientOrderId:"manual:"+input.tslaExit.orderId,
      tradeId:"manual:"+input.tslaExit.orderId,
      positionId:stockPosition.positionId,
      exitReason:"OPERATOR_EXTERNAL_MANUAL_CLOSE",
    } ]},
  };
  const updatedV12: V12X1AllRunnerState = {...v,manualReview:undefined,killSwitch:undefined,reconciliationStatus:"PASS",updatedAt:now};
  const updatedKill: ObjectState = {
    active:false,action:"FLATTEN_MANAGED",strategyId:k.strategyId,
    reason:"OPERATOR_EXTERNAL_MANUAL_CLOSE_VERIFIED_3X_FLAT",
    operator:"SIGNED_TRIPLE_FLAT_RECOVERY",
    recoveredAt:new Date(now).toISOString(),previousReason:k.reason,
    productionSha,
  };
  return {
    pengu:updatedPengu,v52:updatedV52,v12:updatedV12,killSwitch:updatedKill,
    receipt:{
      productionSha,observedAt:proof.observedAt,openPositionCount:0,openOrderCount:0,
      confirmedManualOrders:[input.penguExit.orderId,input.tslaExit.orderId],
      penguRealizedPnlUsdt:input.penguExit.realizedPnl,
      tslaRealizedPnlUsdt:input.tslaExit.realizedPnl,
      v52NetPnlUsdt:v52GrossPnl-v52Commission,
      v52TradeCount:(stock.v50CompletedTrades as number)+1,
      penguAccountReturn:realizedAccountReturn,
      ordersSent:false,orderCancelsSent:false,
      requiresArchivedOriginalsAndOperatorTransaction:true,
    },
  };
}
