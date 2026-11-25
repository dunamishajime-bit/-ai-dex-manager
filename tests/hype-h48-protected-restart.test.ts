import {strict as assert} from "node:assert";
import {test} from "node:test";
import {assessH48ProtectedRestart} from "../lib/hype-h48-protected-restart";
import {newH48ExecutionJournal,type H48SignedVenueSnapshot,type H48ExecutionJournal}
  from "../lib/hype-h48-execution-journal";
import {createHypeH48TimeOnlyContract} from "../lib/hype-stable4-time-only-contract";
import {makeH48Stop8Intent,type H48Stop8Intent} from "../lib/hype-h48-resident-stop8";

const SHA="4786f600ae7bf86ffca948f1412956a9113cb20d";
const PLAN="b".repeat(64);
const E=Date.UTC(2026,10,24,0),NOW=E+1_000_000,ID="h48e-"+"a".repeat(30);
const contract=createHypeH48TimeOnlyContract({sourceSha:SHA,logicalEntryTs:E,
  positionId:"H48|HYPEUSDT|"+E});
function open():H48ExecutionJournal {
  return {...newH48ExecutionJournal(SHA),revision:3,mode:"OPEN",
    research:{schema:"disdex-h48-r4-wsig-research-sequence/v1",sourceSha:SHA,
      lastEvaluatedEntryTs:E,nextBaseEligibleTs:E+48*3_600_000},
    position:{contract,quantity:2,entryPrice:100,entryClientOrderId:ID,observedAt:E+2000},
  };
}
function stop():H48Stop8Intent{
  return {...makeH48Stop8Intent({
    sourceSha:SHA,planSha256:PLAN,positionId:contract.positionId,entryClientOrderId:ID,
    entryPrice:100,quantity:2,tickSize:0.1,now:NOW-5000,
  }),stage:"CONFIRMED",submittedAt:NOW-4000,confirmedAt:NOW-3000};
}
function venue(s=stop()):H48SignedVenueSnapshot{
  return {source:"ASTER_SIGNED_READ_ONLY",observedAt:NOW-100,
    positions:[{symbol:"HYPEUSDT",quantity:2,entryPrice:100,markPrice:101,
      pnlPct:0.01,unrealizedPnl:2,notionalUsd:202,
      positionSide:"BOTH",leverage:5,updatedAt:NOW-100}],
    openOrders:[{symbol:"HYPEUSDT",clientOrderId:s.stopClientOrderId,type:"STOP_MARKET",
      side:"SELL",reduceOnly:true,stopPrice:s.stopPrice,status:"NEW",
      quantity:2,executedQuantity:0}],
  };
}
const assess=(over:Partial<Parameters<typeof assessH48ProtectedRestart>[0]>={})=>{
  const s=stop();
  return assessH48ProtectedRestart({journal:open(),stop8:s,venue:venue(s),
    runtimeSha:SHA,planSha256:PLAN,now:NOW,...over});
};
test("OPEN can resume READ-ONLY only with actual signed HYPE position and sole owned STOP8",()=>{
  const r=assess();
  assert.equal(r.decision,"OPEN_STOP8_VERIFIED_READ_ONLY");
  assert.equal(r.ordersSent,0);assert.equal(r.cancelsSent,0);
});
test("OPEN without STOP8 persisted confirmation cannot restart as verified",()=>{
  assert.equal(assess({stop8:null}).decision,"HOLD_PROTECTED_RECONCILIATION");
  assert.equal(assess({stop8:{...stop(),stage:"SUBMITTED",confirmedAt:null}}).decision,
    "HOLD_PROTECTED_RECONCILIATION");
});
test("OPEN fails closed on wrong plan/SHA, stop price, duplicate stop or wrong position",()=>{
  const s=stop(),v=venue(s);
  for(const overrides of [
    {planSha256:"f".repeat(64)},
    {stop8:{...s,planSha256:"f".repeat(64)}},
    {venue:{...v,openOrders:[{...v.openOrders[0],stopPrice:80}]}},
    {venue:{...v,openOrders:[...v.openOrders,...v.openOrders]}},
    {venue:{...v,positions:[{...v.positions[0],quantity:3}]}},
    {venue:{...v,positions:[]}},
    {venue:{...v,observedAt:NOW-90_000}},
  ]) assert.equal(assess(overrides).decision,"HOLD_PROTECTED_RECONCILIATION");
});
test("FLAT cannot be certified while a HYPE STOP remains, even with no position",()=>{
  const flat=newH48ExecutionJournal(SHA),v=venue();
  assert.equal(assess({journal:flat,stop8:null,venue:{...v,positions:[]}}).decision,
    "HOLD_PROTECTED_RECONCILIATION");
  assert.equal(assess({journal:flat,stop8:stop(),venue:{...v,positions:[],openOrders:[]}}).decision,
    "HOLD_PROTECTED_RECONCILIATION");
  assert.equal(assess({journal:flat,stop8:null,venue:{...v,positions:[],openOrders:[]}}).decision,
    "FLAT_VERIFIED_READ_ONLY");
});
test("submitted/unknown EXIT remains protected HOLD and never resets to FLAT",()=>{
  const j=open();
  const pending={phase:"EXIT" as const,stage:"SUBMITTED" as const,
    clientOrderId:"h48x-"+"d".repeat(30),contract,quantity:2,referencePrice:100,
    certificateSha256:"c".repeat(64),authorizationExpiresAt:NOW+60_000,
    preparedAt:NOW-1000,submittedAt:NOW-500};
  const exitPending={...j,mode:"EXIT_PENDING" as const,pending};
  const res=assess({journal:exitPending});
  assert.equal(res.decision,"HOLD_PROTECTED_RECONCILIATION");
  assert.equal(res.ordersSent,0);
});

test("signed FLAT after STOP8 cleanup can accept NEXT grid only with matching confirmed retirement",()=>{
  const flat=newH48ExecutionJournal(SHA),v=venue(),old=stop();
  const receipt={
    schema:"disdex-h48-stop8-retirement/v1" as const,
    sourceSha:SHA,planSha256:PLAN,positionId:old.positionId,
    stopClientOrderId:old.stopClientOrderId,
    phase:"CONFIRMED" as const,
    preparedAt:NOW-1200,submittedAt:NOW-1100,confirmedAt:NOW-1000,
  };
  const signed={...v,positions:[],openOrders:[],observedAt:NOW-100};
  assert.equal(assess({journal:flat,stop8:old,stopRetirement:receipt,venue:signed}).decision,
    "FLAT_VERIFIED_READ_ONLY");
  assert.equal(assess({journal:flat,stop8:old,stopRetirement:{...receipt,phase:"CANCEL_SUBMITTED",confirmedAt:null},venue:signed}).decision,
    "HOLD_PROTECTED_RECONCILIATION");
  assert.equal(assess({journal:flat,stop8:old,stopRetirement:{...receipt,stopClientOrderId:"OTHER"},venue:signed}).decision,
    "HOLD_PROTECTED_RECONCILIATION");
  assert.equal(assess({journal:flat,stop8:old,stopRetirement:{...receipt,confirmedAt:NOW+1},venue:signed}).decision,
    "HOLD_PROTECTED_RECONCILIATION");
});
