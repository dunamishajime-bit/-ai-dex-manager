import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import fixture from "./fixtures/v12-v4-native-route-20261009.json";
import {V4ExecutionStore} from "../lib/v12-v4-execution-store";
import {V4DurableOrderDispatcher} from "../lib/v12-v4-durable-orders";
import {V4OrderCycle} from "../lib/v12-v4-order-cycle";
import {adaptProductionCandidates} from "../lib/v12-v4-production-features";
import {planProductionEntry,applyProductionEvent} from "../lib/v12-v4-production-lifecycle";
test("signed resident STOP fill synthesizes durable exit request then closes owned leg once",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-resident-stop-"));
 try{
  const sha="a".repeat(40),store=new V4ExecutionStore(join(dir,"state.json"),sha);
  store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
  const candidate=adaptProductionCandidates({...fixture,source:{...fixture.source,
   side:"SHORT",sourceEngine:"buildV12Signals"}}).candidates[0];
  const ts=candidate.eligibleEntryTs;
  const normalize:any={normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p})};
  const reserved=await planProductionEntry(store.read().state,{candidate,ts,eventId:"reserve",referencePrice:100,
   minimumOrderNotionalUsd:5,quantityNormalizer:normalize});
  const id=reserved.leg.id,qty=reserved.leg.requestedQty;
  let state=applyProductionEvent(store.read().state,reserved);
  state=applyProductionEvent(state,{type:"ENTRY_FILL",eventId:"entry",ts:ts+1,id,qty,price:100,feeUsd:0});
  state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",eventId:"filled",ts:ts+2,id});
  const d=store.read();store.commit(d.revision,{...d,state});
  const side=candidate.effectiveSide==="LONG"?"SELL":"BUY",price=90;
  const gateway:any={
   placeStopMarket:async()=>({acknowledged:true,orderId:"88"}),
   queryOrderSameId:async(symbol:string,cid:string)=>({
    symbol,clientOrderId:cid,orderId:88,status:"FILLED",type:"STOP_MARKET",
    side,reduceOnly:true,quantity:qty,executedQuantity:qty,averagePrice:price,quoteQuantity:qty*price
   }),
  };
  const dispatcher=new V4DurableOrderDispatcher(store,gateway,{
   assertAuthority:async()=>{},assertAccountLease:async()=>{},reserveShared:async()=>{},
  });
  const command={legId:id,action:"STOP" as const,sequence:0,symbol:candidate.symbol,
   positionSide:candidate.effectiveSide,quantity:qty,price:110,signalTs:ts};
  const cid=dispatcher.prepare(command,ts+3);
  await dispatcher.submit(cid,ts+3);
  const client:any={
   getUserTrades:async()=>[{symbol:candidate.symbol,id:99,orderId:88,side,
    price:String(price),qty:String(qty),commission:"0",commissionAsset:"USDT",time:ts+4}],
   getIncomeHistory:async()=>[],
  };
  const cycle=new V4OrderCycle(store,dispatcher,{} as any,client);
  const first=await cycle.reconcileExit(cid,ts+5,ts+5);
  assert.equal(first.state.legs[id].status,"CLOSED");
  assert.equal(first.state.legs[id].qty,0);
  assert.equal(first.state.journal.filter(x=>x.type==="EXIT_REQUEST").length,1);
  assert.equal(first.state.journal.filter(x=>x.type==="EXIT_FILL").length,1);
  const repeated=await cycle.reconcileExit(cid,ts+6,ts+6);
  assert.equal(repeated.state.legs[id].status,"CLOSED");
  assert.equal(repeated.state.journal.filter(x=>x.type==="EXIT_FILL").length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
