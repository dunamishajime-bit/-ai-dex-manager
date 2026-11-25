import {strict as assert} from "node:assert";
import {test} from "node:test";
import type {AccountLockHandle} from "../lib/disdex-account-order-lock";
import {newH48ExecutionJournal,assertH48JournalTransition,
  type H48ExecutionJournal,type H48SignedVenueSnapshot}
  from "../lib/hype-h48-execution-journal";
import {createHypeH48TimeOnlyContract} from "../lib/hype-stable4-time-only-contract";
import {makeH48Stop8Intent} from "../lib/hype-h48-resident-stop8";
import {H48NativeStop8Coordinator} from "../lib/hype-h48-native-stop8-coordinator";
import {initialPortfolioDdGovernor} from "../lib/disdex-portfolio-dd-governor";
import {buildSharedCryptoDailyRiskState,SHARED_CRYPTO_STRATEGIES}
  from "../lib/disdex-shared-crypto-daily-risk";
import {emptyPendingExposureRegistry} from "../lib/disdex-pending-exposure-registry";
import type {H48AllRunnerRiskObservation} from "../lib/hype-h48-allrunner-risk-precheck";

const SOURCE_SHA="4786f600ae7bf86ffca948f1412956a9113cb20d";
const PLAN="a".repeat(64);
const E=Date.UTC(2026,10,24,0),H=3_600_000;
const contract=createHypeH48TimeOnlyContract({sourceSha:SOURCE_SHA,
  positionId:"H48|HYPEUSDT|"+E,logicalEntryTs:E});
const entryId="h48e-"+"a".repeat(30);
function bars(){const t=E-H;
  return {
    entry:{openTs:E,open:110,observedAt:E+500},
    hypeClosed:Array.from({length:25},(_,i)=>({
      openTs:t-(24-i)*H,close:i<=12?100+i*.25:103,
    })),
    btcClosed:Array.from({length:25},(_,i)=>({
      openTs:t-(24-i)*H,close:100+i*2/24,
    })),
  };
}
function risk(now:number,venue:H48SignedVenueSnapshot,
  hold=false):H48AllRunnerRiskObservation{
  return {
    now,accountEquityUsd:1000,requestedHypeNotionalUsd:200,
    venue, pending:emptyPendingExposureRegistry(now),
    sharedDailyRisk:buildSharedCryptoDailyRiskState({
      accountScope:"ASTER_FUTURES",
      utcDay:new Date(now).toISOString().slice(0,10),
      strategyIds:[...SHARED_CRYPTO_STRATEGIES],
      lossPct:0,maximumLossPct:7.5,tripped:false,updatedAt:now,
      realizedPnl:0,unrealizedPnl:0,fees:0,funding:0,netDailyPnl:0,
      referenceEquity:1000,sourceComplete:true,
    }),
    ddState:initialPortfolioDdGovernor(now,1000),
    marginGuard:{stage:"HEALTHY",ordersAllowed:true,checkedAt:now},
    killSwitch:{configuredPaths:["/var/lib/disdex/shared/kill-switch.json"],active:hold,
      ...(hold?{scope:"GLOBAL" as const,action:"HOLD_PROTECTED" as const}:{})},
  };
}
function lease(now:number):AccountLockHandle{
  const doc={schema:"disdex-account-lock/v1" as const,accountScope:"ASTER_FUTURES",
    ownerId:"test",leaseId:"lease",acquiredAt:now-1000,
    expiresAt:now+120_000,reservations:[]};
  return {ownerId:doc.ownerId,leaseId:doc.leaseId,acquiredAt:doc.acquiredAt,
    renewalIntervalMs:1000,document:async()=>({...doc}),
    renew:async()=>({...doc}),reserve:async()=>{throw Error("RESERVE_TEST_DISABLED")},
    releaseReservation:async()=>{},release:async()=>{}};
}
function fixture(options:{
  now?:number;state?:H48ExecutionJournal;venue?:H48SignedVenueSnapshot;
  stop?:ReturnType<typeof makeH48Stop8Intent>|null;
  hold?:boolean;denyRoot?:boolean;
}={}){
  const now=options.now??E+1000;
  let state=options.state??newH48ExecutionJournal(SOURCE_SHA),saves=0,rootCalls=0,handoffs=0;
  const venue=options.venue??{
    source:"ASTER_SIGNED_READ_ONLY" as const,observedAt:now,
    positions:[],openOrders:[],
  };
  const stop=options.stop??null;
  const coordinator=new H48NativeStop8Coordinator({
    sourceSha:SOURCE_SHA,planSha256:PLAN,
    lease:lease(now),
    store:{
      load:async()=>structuredClone(state),
      save:async(before,after)=>{
        assert.deepEqual(before,state);
        assertH48JournalTransition(before,after);
        state=structuredClone(after);saves++;
        return state;
      },
    },
    signedVenue:async()=>venue,stop8:async()=>stop,stopRetirement:async()=>null,
    root:{attestPosition:async({contract:c,quantity})=>{
      rootCalls++;
      if(options.denyRoot)throw Error("OWNER_SIGNED_STOP8_ROOT_CERT_MISSING");
      return {
        schema:"disdex-h48-stop8-position-policy-evidence/v1" as const,
        policy:"H48_R4_RESIDENT_STOP8" as const,
        runtimeSha:SOURCE_SHA,planSha256:PLAN,
        positionId:c.positionId,logicalEntryTs:c.logicalEntryTs,logicalExitTs:c.logicalExitTs,
        quantity,certificateSha256:"c".repeat(64),
        validatedAt:now-100,expiresAt:now+60_000,
      };
    }},
    readAllRunnerRisk:async()=>risk(now,venue,options.hold),
    order:{submitPrepared:async()=>{handoffs++;
      assert.equal(state.pending?.stage,"PREPARED");
      return {status:"SUBMITTED_RECONCILIATION_REQUIRED" as const,
        clientOrderId:state.pending.clientOrderId,ordersAttempted:1 as const};
    }},
    now:()=>now,
  });
  return {coordinator,getState:()=>state,getSaves:()=>saves,
    getRootCalls:()=>rootCalls,getHandoffs:()=>handoffs};
}
test("native coordinator checkpoints BASE-first H48 grid and prepares signed STOP8 entry before any order seam",async()=>{
  const x=fixture();
  const result=await x.coordinator.tick({...bars(),requestedQuantity:2});
  assert.equal(result.status,"ORDER_HANDOFF");
  assert.equal(result.orderOutcome?.status,"SUBMITTED_RECONCILIATION_REQUIRED");
  assert.equal(x.getRootCalls(),1);
  assert.equal(x.getHandoffs(),1);
  assert.equal(x.getSaves(),2);
  assert.equal(x.getState().mode,"ENTRY_PENDING");
  assert.equal(x.getState().pending?.phase,"ENTRY");
});
test("GLOBAL HOLD or missing Root STOP8 signature cannot lead to native ENTRY execution",async()=>{
  const held=fixture({hold:true});
  const a=await held.coordinator.tick({...bars(),requestedQuantity:2});
  assert.equal(a.status,"HOLD_PROTECTED");
  assert.equal(held.getHandoffs(),0);
  assert.equal(held.getRootCalls(),0);
  const unsigned=fixture({denyRoot:true});
  await assert.rejects(unsigned.coordinator.tick({...bars(),requestedQuantity:2}),
    /OWNER_SIGNED_STOP8_ROOT_CERT_MISSING/);
  assert.equal(unsigned.getHandoffs(),0);
});
test("OPEN with exact signed owned STOP8 triggers protected 48h EXIT intent only at time boundary",async()=>{
  const now=E+48*H+1000;
  const state:H48ExecutionJournal={
    ...newH48ExecutionJournal(SOURCE_SHA),revision:3,mode:"OPEN",
    research:{schema:"disdex-h48-r4-wsig-research-sequence/v1",sourceSha:SOURCE_SHA,
      lastEvaluatedEntryTs:E+42*H,nextBaseEligibleTs:E+48*H},
    position:{contract,quantity:2,entryPrice:110,entryClientOrderId:entryId,observedAt:E+1500},
  };
  const stop={...makeH48Stop8Intent({
    sourceSha:SOURCE_SHA,planSha256:PLAN,
    positionId:contract.positionId,entryClientOrderId:entryId,
    entryPrice:110,quantity:2,tickSize:0.1,now:now-4000,
  }),stage:"CONFIRMED" as const,submittedAt:now-3000,confirmedAt:now-2000};
  const venue:H48SignedVenueSnapshot={source:"ASTER_SIGNED_READ_ONLY",observedAt:now,
    positions:[{symbol:"HYPEUSDT",quantity:2,entryPrice:110,markPrice:112,
      notionalUsd:224,unrealizedPnl:4,pnlPct:0.01,
      positionSide:"BOTH",leverage:5,updatedAt:now}],
    openOrders:[{symbol:"HYPEUSDT",clientOrderId:stop.stopClientOrderId,
      side:"SELL",type:"STOP_MARKET",status:"NEW",stopPrice:stop.stopPrice,
      reduceOnly:true,quantity:2,executedQuantity:0}],
  };
  const x=fixture({now,state,venue,stop});
  const result=await x.coordinator.tick({exitBoundary:{
    openTs:E+48*H,open:112,observedAt:now-500,
  }});
  assert.equal(result.status,"ORDER_HANDOFF");
  assert.equal(x.getHandoffs(),1);
  assert.equal(x.getState().mode,"EXIT_PENDING");
  assert.equal(x.getState().pending?.phase,"EXIT");
  assert.equal(x.getState().pending?.referencePrice,112);
});
test("OPEN without signed resident STOP8 cannot execute time exit or enter fresh H48",async()=>{
  const now=E+48*H+1000;
  const state:H48ExecutionJournal={...newH48ExecutionJournal(SOURCE_SHA),
    revision:2,mode:"OPEN",research:{schema:"disdex-h48-r4-wsig-research-sequence/v1",
      sourceSha:SOURCE_SHA,lastEvaluatedEntryTs:E+42*H,nextBaseEligibleTs:E+48*H},
    position:{contract,quantity:2,entryPrice:110,entryClientOrderId:entryId,observedAt:E+1500}};
  const venue:H48SignedVenueSnapshot={source:"ASTER_SIGNED_READ_ONLY",observedAt:now,
    positions:[{symbol:"HYPEUSDT",quantity:2,entryPrice:110,markPrice:111,
      notionalUsd:222,pnlPct:0.01,unrealizedPnl:2,
      positionSide:"BOTH",leverage:5,updatedAt:now}],openOrders:[]};
  const x=fixture({now,state,venue});
  const result=await x.coordinator.tick({exitBoundary:{openTs:E+48*H,open:111,observedAt:now-100}});
  assert.equal(result.status,"HOLD_PROTECTED");
  assert.equal(x.getHandoffs(),0);
});
