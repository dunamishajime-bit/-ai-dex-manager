import assert from "node:assert/strict";
import { buildIdleCrossRunnerStopRiskReadback as check } from "../lib/idle-priority-short-basket-venue-bridge.ts";
import { evaluateIdleShortBasketCandidate as decide } from "../lib/idle-priority-short-basket-adopted.ts";

const nowMs = Date.parse("2026-10-19T13:00:00Z");
const pos = (extra={})=>({
 symbol:"DOGEUSDT",quantity:-10,positionSide:"BOTH",entryPrice:100,markPrice:100,
 unrealizedPnl:0,pnlPct:0,notionalUsd:1000,leverage:5,updatedAt:nowMs,...extra
});
const stop = (extra={})=>({
 symbol:"DOGEUSDT",clientOrderId:"runner-stop",side:"BUY",status:"NEW",
 type:"STOP_MARKET",stopPrice:110,reduceOnly:true,quantity:10,executedQuantity:0,...extra
});
const pending = (entries=[])=>({
 schema:"disdex-pending-exposure/v1",accountScope:"ASTER_FUTURES",updatedAt:nowMs,entries
});
const base=()=>({nowMs,signedAccountReadbackComplete:true,positions:[pos()],openOrders:[stop()],
 pendingRegistry:pending(),signedPendingStopRisks:[]});
let passed=0;
function test(name,fn){fn();passed++;console.log("PASS "+name);}
test("signed protected SHORT recognized cross-runner",()=>{
 const r=check(base());assert.equal(r.ok,true);assert.equal(r.existingShorts.length,1);
 assert.equal(r.existingShorts[0].exchangeStopReadback.stopPrice,110);
});
test("LONGs do not consume SHORT STOP risk",()=>{
 const r=check({...base(),positions:[pos({quantity:10,positionSide:"LONG"})],openOrders:[]});
 assert.equal(r.ok,true);assert.equal(r.existingShorts.length,0);
});
test("missing resident STOP rejects candidate",()=>{
 assert.equal(check({...base(),openOrders:[]}).reason,"SHORT_BASKET_STOP_NOT_UNIQUELY_SIGNED_AND_COMPLETE");
});
test("duplicate resident STOPs reject candidate",()=>{
 assert.equal(check({...base(),openOrders:[stop(),stop({clientOrderId:"double"})]}).ok,false);
});
test("wrong reduce-only STOP rejects candidate",()=>{
 assert.equal(check({...base(),openOrders:[stop({reduceOnly:false})]}).ok,false);
});
test("short readback too old rejects",()=>{
 assert.equal(check({...base(),positions:[pos({updatedAt:nowMs-100_000})]}).ok,false);
});
test("active pending SHORT without signed STOP-risk proof rejects",()=>{
 const entry={reservationId:"r1",strategyId:"V12_V4",sleeve:"CRYPTO",symbol:"ETHUSDT",side:"SHORT",
 gross:0.5,notionalUsd:500,status:"PENDING",createdAt:nowMs,updatedAt:nowMs};
 assert.equal(check({...base(),pendingRegistry:pending([entry])}).reason,"SHORT_BASKET_PENDING_STOP_RISK_PROOF_MISSING");
});
test("signed matching pending SHORT included",()=>{
 const entry={reservationId:"r1",strategyId:"V12_V4",sleeve:"CRYPTO",symbol:"ETHUSDT",side:"SHORT",
 gross:0.5,notionalUsd:500,status:"PENDING",createdAt:nowMs,updatedAt:nowMs};
 const proof={reservationId:"r1",symbol:"ETHUSDT",side:"SHORT",worstCaseLossUsd:50,complete:true,verifiedAtMs:nowMs};
 const r=check({...base(),pendingRegistry:pending([entry]),signedPendingStopRisks:[proof]});
 assert.equal(r.ok,true);assert.equal(r.pendingShortReservations[0].worstCaseLossUsd,50);
});
test("bridge and candidate include cross-runner risk without skipping",()=>{
 const r=check(base()); assert.equal(r.ok,true);
 const d=decide({nowMs,sharedAccountLockHeld:true,signedExposureSnapshotComplete:true,
  equityUsd:1000,atrRatio:0.02,requestedGross:1,cryptoAndTotalGrossRoom:2,entryPrice:100,
  quantityStep:0.01,venueMinQuantity:0.01,venueMinNotionalUsd:5,
  existingShorts:r.existingShorts,pendingShortReservations:r.pendingShortReservations});
 assert.equal(d.allowed,true);assert.ok(d.gross < 1 && d.gross >= .25);assert.ok(d.aggregateRiskPct <= 20);
});
console.log("TOTAL PASS "+passed);
