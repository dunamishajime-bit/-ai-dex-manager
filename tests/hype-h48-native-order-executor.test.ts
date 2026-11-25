import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createHypeH48TimeOnlyContract } from "../lib/hype-stable4-time-only-contract";
import {
  H48NativeOrderExecutor,type H48ScopedOwnerOrderGrant,
} from "../lib/hype-h48-native-order-executor";
import { validateH48ExecutionJournal,assertH48JournalTransition,
  type H48ExecutionJournal,type H48SignedVenueSnapshot } from "../lib/hype-h48-execution-journal";
import type { AccountLockHandle,AccountReservation } from "../lib/disdex-account-order-lock";
import type { DirectTradeCommand,DirectTradeResult,DirectTradeExecutor } from "../lib/direct-trade-executor";

const SHA="4786f600ae7bf86ffca948f1412956a9113cb20d",E=Date.UTC(2026,10,24,0),H=3600000,NOW=E+1500;
const ID="h48e-"+"c".repeat(30);
const contract=createHypeH48TimeOnlyContract({positionId:"H48|HYPEUSDT|"+E,sourceSha:SHA,logicalEntryTs:E});
function intent():H48ExecutionJournal{
  return {
    schema:"disdex-h48-native-execution-journal/v1",sourceSha:SHA,revision:1,
    mode:"ENTRY_PENDING",research:{schema:"disdex-h48-r4-wsig-research-sequence/v1",
      sourceSha:SHA,lastEvaluatedEntryTs:E,nextBaseEligibleTs:E+48*H},
    position:null,reviewReason:null,
    pending:{phase:"ENTRY",stage:"PREPARED",contract,
      clientOrderId:ID,quantity:2,referencePrice:100,
      certificateSha256:"a".repeat(64),
      authorizationExpiresAt:E+60000,preparedAt:E+1000,submittedAt:null},
  };
}
const okResult=(clientOrderId=ID):DirectTradeResult=>({
  requestId:clientOrderId,clientOrderId,symbol:"HYPEUSDT",side:"BUY",
  status:"FILLED",requestedQuantity:2,submittedQuantity:2,executedQuantity:2,
  averagePrice:100,quoteQuantity:200,reconciled:true,executionUnknown:false,reduceOnly:false,
});
const venue=(qty=2):H48SignedVenueSnapshot=>({
  source:"ASTER_SIGNED_READ_ONLY",observedAt:NOW+200,openOrders:[],
  positions:qty?[{symbol:"HYPEUSDT",quantity:qty,entryPrice:100,
    markPrice:100,unrealizedPnl:0,pnlPct:0,notionalUsd:qty*100,
    positionSide:"BOTH",leverage:5,updatedAt:NOW+200}]:[],
});
const grant=(p=intent().pending!):H48ScopedOwnerOrderGrant=>({
  schema:"disdex-h48-production-order-grant/v2",
  scope:"HYPE_TREND_LONG",approvedSha:SHA,
  planSha256:"b".repeat(64),certificateSha256:p.certificateSha256,
  clientOrderId:p.clientOrderId,phase:p.phase,
  approvalId:"11111111-1111-4111-8111-111111111111",
  issuedAt:NOW-1000,expiresAt:NOW+50000,
  maxEntryNotionalUsd:220,maxSlippageBps:20,grossCapHype:1.5,
  stopGovernanceCertified:true,
});
function fake(options:{
  badGrant?:boolean;blockKill?:boolean;blockRisk?:boolean;executionThrows?:boolean;
  result?:DirectTradeResult;quantity?:number;
  starting?:H48ExecutionJournal;
}={}){
  let state=options.starting??intent(),requests:DirectTradeCommand[]=[],reserves=0,releases=0,saves=0;
  const store={
    load:async()=>JSON.parse(JSON.stringify(state)) as H48ExecutionJournal,
    save:async(old:H48ExecutionJournal,next:H48ExecutionJournal,_lock:AccountLockHandle)=>{
      assert.deepEqual(old,state);
      assertH48JournalTransition(old,next);
      saves++;state=validateH48ExecutionJournal(next,SHA);
      return state;
    },
  };
  const executor={
    normalizeMarketQuantity:async()=>({
      symbol:"HYPEUSDT",quantity:options.quantity??2,quantityText:"2",minQuantity:0.01,
      maxQuantity:1000,stepSize:0.01,minNotional:5,notional:200,
    }),
    getAccountSnapshot:async()=>({
      asset:"USDT",walletBalance:200,availableBalance:200,updatedAt:NOW,
    }),
    executeMarket:async(command:DirectTradeCommand)=>{
      requests.push(command);
      assert.equal(state.pending?.stage,"SUBMITTED","must fsync before POST");
      if(options.executionThrows)throw Error("ASTER_NETWORK_UNKNOWN");
      return options.result??okResult();
    },
    reconcileOrder:async()=>options.result??okResult(),
  } as Pick<DirectTradeExecutor,
    "normalizeMarketQuantity"|"getAccountSnapshot"|"executeMarket"|"reconcileOrder">;
  const lock={
    ownerId:"h48-test",leaseId:"lock-1",acquiredAt:NOW-1000,renewalIntervalMs:1000,
    document:async()=>({
      schema:"disdex-account-lock/v1" as const,accountScope:"ASTER_FUTURES",
      ownerId:"h48-test",leaseId:"lock-1",acquiredAt:NOW-1000,expiresAt:NOW+120000,
      reservations:[],
    }),
    renew:async()=>{throw Error("NO_RENEW_TEST")},
    reserve:async()=>{reserves++;return {
      reservationId:"res-1",strategyId:"HYPE_LONG",symbol:"HYPEUSDT",
      side:"LONG" as const,gross:1,notionalUsd:200,createdAt:NOW,status:"RESERVED" as const,
    } satisfies AccountReservation;},
    releaseReservation:async()=>{releases++},
    release:async()=>{},
  } as AccountLockHandle;
  const runner=new H48NativeOrderExecutor({
    sourceSha:SHA,store,executor,lease:lock,now:()=>NOW,
    rootGrant:{verifyForOrder:async()=>options.badGrant?{...grant(),approvedSha:"f".repeat(40)}:grant(state.pending!)},
    signedVenue:{read:async()=>venue()},
    assertGlobalOrderRelease:async()=>{if(options.blockKill)throw Error("HOLD_PROTECTED")},
    assertFreshSharedRiskAndStops:async()=>{if(options.blockRisk)throw Error("STOP_NOT_APPROVED")},
  });
  return {runner,requests,getState:()=>state,
    getReserves:()=>reserves,getReleases:()=>releases,getSaves:()=>saves};
}

test("H48 ENTRY sends exactly one BUY only AFTER durable SUBMITTED journal and reserved exposure",async()=>{
  const x=fake();
  const result=await x.runner.submitPrepared();
  assert.equal(result.status,"RECONCILED_OPEN");
  assert.equal(x.requests.length,1);
  assert.equal(x.requests[0].symbol,"HYPEUSDT");
  assert.equal(x.requests[0].side,"BUY");
  assert.equal(x.requests[0].reduceOnly,false);
  assert.equal(x.requests[0].requireVenueMargin5xCross,true);
  assert.equal(x.getReserves(),1);
  assert.equal(x.getReleases(),1);
  assert.equal(x.getSaves(),2);
  assert.equal(x.getState().mode,"OPEN");
});

test("missing valid Root order grant, Kill release, STOP risk or quantity parity prevent any order",async()=>{
  for(const o of [{badGrant:true},{blockKill:true},{blockRisk:true},{quantity:1}]){
    const x=fake(o);
    await assert.rejects(x.runner.submitPrepared());
    assert.equal(x.requests.length,0);
    assert.equal(x.getState().pending?.stage,"PREPARED");
    assert.equal(x.getReleases(),0);
  }
});

test("UNKNOWN outcome freezes submitted intent and retains pending exposure reservation",async()=>{
  const x=fake({executionThrows:true});
  const result=await x.runner.submitPrepared();
  assert.equal(result.status,"SUBMITTED_RECONCILIATION_REQUIRED");
  assert.equal(x.requests.length,1);
  assert.equal(x.getReserves(),1);
  assert.equal(x.getReleases(),0);
  assert.equal(x.getState().pending?.stage,"SUBMITTED");
  await assert.rejects(x.runner.submitPrepared(),/NO_PREPARED_INTENT/);
  assert.equal(x.requests.length,1);
});

test("filled HTTP result without matching authenticated order GET stays protected",async()=>{
  const x=fake({result:{...okResult(),clientOrderId:"WRONG"}});
  const result=await x.runner.submitPrepared();
  assert.equal(result.status,"MANUAL_REVIEW");
  assert.equal(x.getState().mode,"MANUAL_REVIEW");
  assert.equal(x.getReserves(),1);
  assert.equal(x.getReleases(),0);
});

test("no PREPARED journal refuses even a valid Root grant",async()=>{
  const x=fake({starting:{...intent(),mode:"FLAT",pending:null}});
  await assert.rejects(x.runner.submitPrepared(),/NO_PREPARED_INTENT/);
  assert.equal(x.requests.length,0);
});
