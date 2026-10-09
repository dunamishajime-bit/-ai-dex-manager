import test from "node:test";
import assert from "node:assert/strict";
import { prepareExternalManualFlatReconciliation } from "../lib/external-manual-flat-reconcile";
import { createPenguRiskOverlayState } from "../lib/pengu-route-quarantine-dd-governor";

const sha = "ce1edeead8d0f9e5d88e829d415057117502a335";
const now = 1791525000000;
const original = () => ({
  productionSha: sha,
  now,
  proof:{observedAt:now-1000, consecutiveSuccesses:3,openPositionCount:0,openOrderCount:0,ordersSent:false as const,cancelSent:false as const,positionChangesSent:false as const},
  killSwitch:{active:true,action:"FLATTEN_MANAGED",escalatedFrom:"HOLD_PROTECTED",reason:"V52 managed Stock symbol reconciliation mismatch",operator:"disdex-v52-aster-only",strategyId:"DISDEX_V35_STRONG_RESERVED_PENGU_V96"},
  v12:{schema:"v12-x1-all-runner-state/v1" as const,strategyId:"V12_X1.00_ALL" as const,mode:"LIVE" as const,updatedAt:now-3000,runtimeCommitSha:sha,reconciliationStatus:"MANUAL_REVIEW" as const,manualReview:"SHARED_KILL_SWITCH_ACTIVE:V52 recoverable tick error: HTTP 503 stale_quote",killSwitch:{active:true,reason:"V52 recoverable tick error: HTTP 503 stale_quote",trippedAt:now-100000}},
  v52:{strategyId:"DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96",v52Ledger:{strategyId:"DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96",trades:[]},v50CompletedTrades:0,positions:{"V50_POST_OPEN_BASIS":{symbol:"TSLA",asterQty:0.38,strategy:"V50_POST_OPEN_BASIS",openedAt:1791473417300,positionId:"original-tsla"}},pendingOrder:null,updatedAt:now-50000},
  pengu:{
    version:2 as const,strategyId:"PENGU_DUAL_LS_V2_FINAL" as const,mode:"LIVE" as const,updatedAt:now-50000,
    position:{side:-1 as const,entryTs:1791435622600,entryPrice:0.008574,quantity:7718,gross:1,highWaterMark:0.008574,lowWaterMark:0.007585,entryVersion:"SHORT_V20" as const,residentStop:{orderId:1166455175}},
    riskOverlay:createPenguRiskOverlayState(),failures:[],
  },
  penguEntry:{symbol:"PENGUUSDT",orderId:1165455175,side:"SELL" as const,qty:7718,price:0.008574,time:1791435622600,realizedPnl:0,commission:0},
  penguExit:{symbol:"PENGUUSDT",orderId:1167343620,side:"BUY" as const,qty:7718,price:0.008163,time:1791524113700,realizedPnl:3.172098,commission:0.02520081},
  tslaEntry:{symbol:"TSLAUSDT",orderId:304049477,side:"BUY" as const,qty:0.38,price:372.64,time:1791473417300,realizedPnl:0,commission:0},
  tslaExit:{symbol:"TSLAUSDT",orderId:305148915,side:"SELL" as const,qty:0.38,price:378.87,time:1791524111150,realizedPnl:2.3674,commission:0.01799632},
});
function run(row = original()) { return prepareExternalManualFlatReconciliation(row as unknown as Parameters<typeof prepareExternalManualFlatReconciliation>[0]); }
test("manual closes prepare a non-mutating operator-only recovery", () => {
  const input=original();
  const initial=JSON.stringify(input);
  const out=run(input);
  assert.equal(JSON.stringify(input),initial);
  assert.equal(out.pengu.position,undefined);
  assert.deepEqual(out.v52.positions,{});
  assert.equal(out.v52.v50CompletedTrades,1);
  assert.equal((out.v52.v52Ledger as { trades:{ realizedPnl:number; exitReason:string }[] }).trades.length,1);
  assert.equal((out.v52.v52Ledger as { trades:{ realizedPnl:number; exitReason:string }[] }).trades[0]!.exitReason,"OPERATOR_EXTERNAL_MANUAL_CLOSE");
  assert.ok(Math.abs((out.v52.v52Ledger as { trades:{ realizedPnl:number }[] }).trades[0]!.realizedPnl - (2.3674-0.01799632))<1e-10);
  assert.equal(out.v12.reconciliationStatus,"PASS");
  assert.equal(out.v12.manualReview,undefined);
  assert.equal(out.killSwitch.active,false);
  assert.equal(out.receipt.ordersSent,false);
  assert.equal(out.receipt.requiresArchivedOriginalsAndOperatorTransaction,true);
  assert.ok(out.pengu.riskOverlay.realizedEquity>1);
  assert.equal(out.pengu.cooldownUntilTs, input.penguExit.time + 6 * 3_600_000);
});
test("rejects missing third consecutive authenticated flat read",()=>{
 const x=original();x.proof.consecutiveSuccesses=2;assert.throws(()=>run(x),/AUTHENTICATED_TRIPLE_FLAT/);
});
test("rejects nonempty order inventory",()=>{
 const x=original();x.proof.openOrderCount=1;assert.throws(()=>run(x),/AUTHENTICATED_TRIPLE_FLAT/);
});
test("rejects stale proof",()=>{
 const x=original();x.proof.observedAt=now-70_000;assert.throws(()=>run(x),/PROOF_STALE/);
});
test("rejects mismatched kill reason",()=>{
 const x=original();x.killSwitch.reason="another failure";assert.throws(()=>run(x),/KILL_REASON/);
});
test("rejects changed venue fill identity",()=>{
 const x=original();x.penguExit.qty=7717;assert.throws(()=>run(x),/FILL_IDENTITY/);
});
test("rejects nonflat V12",()=>{
 const x=original();(x.v12 as Record<string,unknown>).pending={action:"ENTRY"};assert.throws(()=>run(x),/V12_STATE/);
});
test("rejects stop order being mislabeled as manual exit",()=>{
 const x=original();x.pengu.position.residentStop.orderId=x.penguExit.orderId;assert.throws(()=>run(x),/MANUAL_CLOSE_IS_NOT_RESIDENT_STOP/);
});
test("rejects forged manual-close profit",()=>{
 const x=original();x.tslaExit.realizedPnl=5;assert.throws(()=>run(x),/REALIZED_PNL/);
});

test("rejects V52 ledger mismatch instead of silently dropping close",()=>{
 const x=original();x.v52.v52Ledger.strategyId="wrong";assert.throws(()=>run(x),/V52_LEDGER_IDENTITY/);
});
test("rejects incorrect V52 completion counter",()=>{
 const x=original();x.v52.v50CompletedTrades=-1;assert.throws(()=>run(x),/V52_COMPLETED_TRADE_COUNT/);
});
test("rejects invalid verified commission",()=>{
 const x=original();x.tslaExit.commission=-1;assert.throws(()=>run(x),/FILL_IDENTITY/);
});
