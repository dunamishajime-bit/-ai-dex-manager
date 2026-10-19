import assert from "node:assert/strict";
import { evaluateIdleShortBasketCandidate as decide, IDLE_SHORT_BASKET_ADOPTED_CANDIDATE as C }
  from "../lib/idle-priority-short-basket-adopted.ts";

const nowMs = Date.parse("2026-10-19T07:00:00Z");
const baseline = () => ({
  nowMs, sharedAccountLockHeld: true, signedExposureSnapshotComplete: true,
  equityUsd: 1000, atrRatio: 0.018, requestedGross: 1,
  cryptoAndTotalGrossRoom: 1.5, entryPrice: 100,
  quantityStep: 0.01, venueMinQuantity: 0.01, venueMinNotionalUsd: 5,
  existingShorts: [], pendingShortReservations: [],
});
const held = (overrides={}) => ({
  symbol: "JUPUSDT",side:"SHORT",entryPrice:100,currentMarkPrice:100,quantity:10,
  exchangeStopReadback:{stopPrice:110,quantity:10,reduceOnly:true,verified:true,verifiedAtMs:nowMs-1000},
  ...overrides,
});
let cases=0;const testCase=(name,fn)=>{fn();cases++;console.log("PASS "+name);};

testCase("ATR 2.5% is inclusive and 2.51% rejected",()=>{
  assert.equal(decide({...baseline(),atrRatio:.025}).allowed,true);
  assert.equal(decide({...baseline(),atrRatio:.0251}).reason,"IDLE_ATR_OVER_2P5_PCT");
});
testCase("20% risk budget limits new notional",()=>{
  const d=decide({...baseline(),requestedGross:2,cryptoAndTotalGrossRoom:2});
  assert.equal(d.allowed,true);
  assert.ok(d.gross<2 && d.gross>1.6);
  assert.ok(d.aggregateRiskPct<=20);
});
testCase("same-direction existing risk and new capacity adjust without full rejection",()=>{
  const d=decide({...baseline(),existingShorts:[held()]});
  assert.equal(d.allowed,true);
  assert.ok(d.gross<1 && d.gross>.25);
  assert.ok(d.aggregateRiskPct<=20);
});
testCase("stale or unsigned stop fails closed",()=>{
  assert.equal(decide({...baseline(),existingShorts:[held({exchangeStopReadback:null})]}).allowed,false);
  assert.equal(decide({...baseline(),existingShorts:[held({exchangeStopReadback:{stopPrice:110,quantity:10,reduceOnly:true,verified:true,verifiedAtMs:nowMs-100_000}})]}).allowed,false);
});
testCase("unverified pending reservation fails closed",()=>{
  const bad={symbol:"TIAUSDT",side:"SHORT",worstCaseLossUsd:10,complete:false,verifiedAtMs:nowMs};
  assert.equal(decide({...baseline(),pendingShortReservations:[bad]}).reason,"PENDING_SHORT_RESERVATION_UNVERIFIED");
});
testCase("pending risk consumes available budget",()=>{
  const good={symbol:"TIAUSDT",side:"SHORT",worstCaseLossUsd:175,complete:true,verifiedAtMs:nowMs};
  assert.equal(decide({...baseline(),pendingShortReservations:[good]}).allowed,false);
});
testCase("positive floating profit without protected stop is not credited",()=>{
  const a=decide({...baseline(),existingShorts:[held({currentMarkPrice:96})]});
  const b=decide({...baseline(),existingShorts:[held({currentMarkPrice:96,
    exchangeStopReadback:{stopPrice:101,quantity:10,reduceOnly:true,verified:true,verifiedAtMs:nowMs-1000}})]});
  assert.ok(b.currentShortStopRiskUsd<a.currentShortStopRiskUsd);
  assert.ok(a.aggregateRiskPct>0);
});
testCase("qty rounds down and never breaches total budget",()=>{
  const d=decide({...baseline(),requestedGross:2,cryptoAndTotalGrossRoom:2,quantityStep:0.35});
  assert.equal(d.allowed,true);
  assert.ok(d.aggregateRiskPct<=20 && Number((d.quantity/0.35).toFixed(8))%1===0);
});
testCase("account shared lock required",()=>{
  assert.equal(decide({...baseline(),sharedAccountLockHeld:false}).allowed,false);
});
testCase("gross floor and exchange notional are independently checked",()=>{
  const x=decide({...baseline(),existingShorts:[held()],venueMinNotionalUsd:700});
  assert.equal(x.reason,"BASKET_QUANTITY_NOT_EXCHANGE_FEASIBLE");
});
assert.equal(C.shortBasketStopLossBudgetPct,20);
assert.equal(C.atrRatioMax,.025);
assert.equal(C.profitLockAdopted,false);
console.log("TOTAL PASS "+cases);
