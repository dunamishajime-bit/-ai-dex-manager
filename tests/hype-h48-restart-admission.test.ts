import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHypeH48TimeOnlyContract } from "../lib/hype-stable4-time-only-contract";
import type { H48SignedVenueSnapshot,H48ExecutionJournal } from "../lib/hype-h48-execution-journal";
import { newH48ExecutionJournal } from "../lib/hype-h48-execution-journal";
import { assessH48Restart,inspectH48Restart } from "../lib/hype-h48-restart-admission";
import type { DirectTradeExecutor } from "../lib/direct-trade-executor";
import type { AccountLockHandle } from "../lib/disdex-account-order-lock";

const SHA="4786f600ae7bf86ffca948f1412956a9113cb20d",E=Date.UTC(2026,10,24,0),NOW=Date.UTC(2026,10,25,14,30);
const contract=createHypeH48TimeOnlyContract({positionId:"H48|HYPEUSDT|"+E,sourceSha:SHA,logicalEntryTs:E});
const noExposure:H48SignedVenueSnapshot={source:"ASTER_SIGNED_READ_ONLY",observedAt:NOW,positions:[],openOrders:[]};
const livePosition={
  symbol:"HYPEUSDT",quantity:2,entryPrice:110,markPrice:112,unrealizedPnl:4,pnlPct:0.01,notionalUsd:224,
  positionSide:"BOTH" as const,leverage:5,updatedAt:NOW,
};
function open():H48ExecutionJournal{
  return {...newH48ExecutionJournal(SHA),revision:3,mode:"OPEN",
    research:{schema:"disdex-h48-r4-wsig-research-sequence/v1",sourceSha:SHA,
      lastEvaluatedEntryTs:E,nextBaseEligibleTs:E+48*3600000},
    position:{contract,quantity:2,entryPrice:110,entryClientOrderId:"h48e-"+"a".repeat(30),observedAt:E+1000}};
}
function pending():H48ExecutionJournal{
  return {...newH48ExecutionJournal(SHA),revision:4,mode:"EXIT_PENDING",
    research:open().research,position:open().position,
    pending:{phase:"EXIT",stage:"SUBMITTED",clientOrderId:"h48x-"+"c".repeat(30),
      contract,quantity:2,referencePrice:120,certificateSha256:"b".repeat(64),
      authorizationExpiresAt:E+48*3600000+60000,preparedAt:E+48*3600000+1000,
      submittedAt:E+48*3600000+2000}};
}

test("restart FLAT requires zero exposure, cannot silently discard real venue position",()=>{
  const flat=newH48ExecutionJournal(SHA);
  assert.equal(assessH48Restart(flat,noExposure).decision,"FLAT_VERIFIED_READ_ONLY");
  const bad=assessH48Restart(flat,{...noExposure,positions:[livePosition]});
  assert.equal(bad.decision,"HOLD_UNTRUSTED_INVENTORY");
  assert.equal(bad.ordersSent,0);
});

test("restart OPEN requires matching long HYPE quantity/entryPrice and no open orders",()=>{
  const current=open();
  const okay=assessH48Restart(current,{...noExposure,positions:[livePosition]});
  assert.equal(okay.decision,"OPEN_VERIFIED_READ_ONLY");
  for(const venue of [
    noExposure,
    {...noExposure,positions:[{...livePosition,quantity:1}]},
    {...noExposure,positions:[{...livePosition,entryPrice:120}]},
    {...noExposure,positions:[{...livePosition,quantity:-2}]},
    {...noExposure,positions:[livePosition],openOrders:[{symbol:"HYPEUSDT",clientOrderId:"rogue",quantity:2,executedQuantity:0}]},
  ]){
    assert.equal(assessH48Restart(current,venue).decision,"HOLD_UNTRUSTED_INVENTORY");
  }
});

test("restart submitted H48 order never automatically re-submits or treats position as closed",()=>{
  const sent=pending();
  const outcome=assessH48Restart(sent,{...noExposure,positions:[livePosition]});
  assert.equal(outcome.decision,"HOLD_RECONCILIATION_REQUIRED");
  assert.equal(outcome.ordersSent,0);
  assert.equal(outcome.journal.mode,"EXIT_PENDING");
  assert.equal(outcome.journal.pending?.stage,"SUBMITTED");
  assert.equal(assessH48Restart({...sent,mode:"MANUAL_REVIEW",reviewReason:"H48_AMBIGUOUS_EXECUTION"},noExposure).decision,"HOLD_MANUAL_REVIEW");
});

test("full restart inspection reads journal and authenticated venue under active lease without order access",async()=>{
  const store={load:async()=>open()};
  const executor:Pick<DirectTradeExecutor,"getPositions"|"getOpenOrders"|"getAccountSnapshot">={
    getPositions:async()=>[livePosition],
    getOpenOrders:async()=>[],
    getAccountSnapshot:async()=>({
      asset:"USDT",availableBalance:200,walletBalance:250,updatedAt:NOW,
    }),
  };
  const lease={
    document:async()=>({
      schema:"disdex-account-lock/v1" as const,accountScope:"ASTER_FUTURES",
      ownerId:"h48-test",leaseId:"lock-1",acquiredAt:NOW-1000,expiresAt:NOW+60000,reservations:[],
    }),
  } as AccountLockHandle;
  const result=await inspectH48Restart({journalStore:store,executor,lease,runtimeSha:SHA,now:()=>NOW});
  assert.equal(result.decision,"OPEN_VERIFIED_READ_ONLY");
  assert.equal(result.ordersSent,0);
  await assert.rejects(inspectH48Restart({journalStore:store,executor,lease,runtimeSha:"f".repeat(40),now:()=>NOW}),/HYPE_H48_JOURNAL_/);
});
