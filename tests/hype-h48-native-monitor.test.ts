import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { AccountLockHandle } from "../lib/disdex-account-order-lock";
import type { DirectTradeExecutor,DirectPosition } from "../lib/direct-trade-executor";
import { newH48ExecutionJournal,type H48ExecutionJournal } from "../lib/hype-h48-execution-journal";
import { createHypeH48TimeOnlyContract } from "../lib/hype-stable4-time-only-contract";
import { H48NativeReadOnlyMonitor } from "../lib/hype-h48-native-monitor";

const SHA="4786f600ae7bf86ffca948f1412956a9113cb20d",H=3600000;
const E=Date.UTC(2026,10,24,0);
function source(e=E) {
  const t=e-H;
  return {
    entry:{openTs:e,open:110,observedAt:e+500},
    hypeClosed:Array.from({length:25},(_,i)=>({
      openTs:t-(24-i)*H,close:i<=12?100+i*.25:103,
    })),
    btcClosed:Array.from({length:25},(_,i)=>({
      openTs:t-(24-i)*H,close:100+i*2/24,
    })),
  };
}
function fixture(params:{now?:number;journal?:H48ExecutionJournal;positions?:DirectPosition[];throwRead?:boolean}={}){
  const now=params.now??E+1000;
  let state=params.journal??newH48ExecutionJournal(SHA),writes=0,orderCalls=0;
  const store={
    load:async()=>JSON.parse(JSON.stringify(state)) as H48ExecutionJournal,
    save:async(_:H48ExecutionJournal,replacement:H48ExecutionJournal)=>{
      writes++;state=replacement;return replacement;
    },
  };
  const executor:Pick<DirectTradeExecutor,"getPositions"|"getOpenOrders"|"getAccountSnapshot"> & {executeMarket:()=>never}={
    getPositions:async()=>{if(params.throwRead)throw Error("HTTP502");return params.positions??[];},
    getOpenOrders:async()=>[],
    getAccountSnapshot:async()=>({
      asset:"USDT",walletBalance:200,availableBalance:200,updatedAt:now,
    }),
    executeMarket:()=>{orderCalls++;throw Error("UNEXPECTED_REAL_ORDER")},
  };
  const lease={document:async()=>({
    schema:"disdex-account-lock/v1" as const,accountScope:"ASTER_FUTURES",
    ownerId:"h48-monitor-test",leaseId:"writer",acquiredAt:now-100,
    expiresAt:now+30000,reservations:[],
  })} as AccountLockHandle;
  const monitor=new H48NativeReadOnlyMonitor({runtimeSha:SHA,store,executor,lease,now:()=>now});
  return {monitor,getState:()=>state,getWrites:()=>writes,getOrders:()=>orderCalls};
}

test("H48 monitor records research candidate at exact 6h open without executing an order",async()=>{
  const a=fixture();
  const result=await a.monitor.tick(source());
  assert.deepEqual(result,{
    status:"RESEARCH_RECORDED",reason:"RESEARCH_CANDIDATE",
    candidate:true,ordersSent:0,
  });
  assert.equal(a.getState().mode,"FLAT");
  assert.equal(a.getState().research.lastEvaluatedEntryTs,E);
  assert.equal(a.getState().research.nextBaseEligibleTs,E+48*H);
  assert.equal(a.getWrites(),1);
  assert.equal(a.getOrders(),0);
  await assert.rejects(a.monitor.tick(source()),/H48_SEQUENCE_MISSING_OR_REPEATED_GRID/);
});

test("H48 monitor requires authenticated account read before mutating journal",async()=>{
  const bad=fixture({throwRead:true});
  await assert.rejects(bad.monitor.tick(source()),/HTTP502/);
  assert.equal(bad.getWrites(),0);
  assert.equal(bad.getOrders(),0);
  const notFlat=fixture({positions:[{
    symbol:"HYPEUSDT",quantity:1,entryPrice:110,markPrice:112,
    unrealizedPnl:2,pnlPct:0.01,notionalUsd:112,positionSide:"BOTH",
    leverage:5,updatedAt:E+1000,
  }]});
  const result=await notFlat.monitor.tick(source());
  assert.equal(result.status,"HOLD");
  assert.equal(notFlat.getWrites(),0);
  assert.equal(notFlat.getOrders(),0);
});

test("H48 monitor observes exactly due 48h exit and refuses trading",async()=>{
  const contract=createHypeH48TimeOnlyContract({
    positionId:"H48|HYPEUSDT|"+E,sourceSha:SHA,logicalEntryTs:E,
  });
  const state:H48ExecutionJournal={
    ...newH48ExecutionJournal(SHA),revision:3,mode:"OPEN",
    research:{schema:"disdex-h48-r4-wsig-research-sequence/v1",sourceSha:SHA,
      lastEvaluatedEntryTs:E+42*H,nextBaseEligibleTs:E+48*H},
    position:{contract,quantity:2,entryPrice:110,
      entryClientOrderId:"h48e-"+"a".repeat(30),observedAt:E+1000},
  };
  const now=E+48*H+1000;
  const a=fixture({now,journal:state,positions:[{
    symbol:"HYPEUSDT",quantity:2,entryPrice:110,markPrice:114,
    unrealizedPnl:8,pnlPct:3.636,notionalUsd:228,
    positionSide:"BOTH",leverage:5,updatedAt:now,
  }]});
  const result=await a.monitor.tick({exitBoundary:{
    openTs:E+48*H,open:114,observedAt:now-500,
  }});
  assert.equal(result.status,"EXIT_DUE_NOT_AUTHORIZED");
  assert.equal(a.getWrites(),0);
  assert.equal(a.getOrders(),0);
  assert.equal(a.getState().mode,"OPEN");
});

test("H48 monitor blocks missing H1 data and never skips an unobserved grid",async()=>{
  const a=fixture();
  const result=await a.monitor.tick({entry:{openTs:E,open:110,observedAt:E+500}});
  assert.equal(result.status,"HOLD");
  assert.equal(a.getWrites(),0);
  assert.equal(a.getOrders(),0);
});
