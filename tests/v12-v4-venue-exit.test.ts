import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/v12-v4-native-route-20261009.json";
import {adaptProductionCandidates} from "../lib/v12-v4-production-features";
import {createProductionState,applyProductionEvent,planProductionEntry} from "../lib/v12-v4-production-lifecycle";
import {reconcileV4ExitTrades} from "../lib/v12-v4-venue-exit";
async function setup(){
 const candidate={...adaptProductionCandidates({...fixture,source:{...fixture.source,side:"SHORT",sourceEngine:"buildV12Signals"}}).candidates[0],requestedGross:.5};
 let state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
 const entry=await planProductionEntry(state,{candidate,ts:candidate.eligibleEntryTs,eventId:"reserve",referencePrice:100,minimumOrderNotionalUsd:5,
  quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,quantityText:String(q),notional:q*p})} as any});
 state=applyProductionEvent(state,entry);
 const id=entry.leg.id,ts=entry.ts;
 state=applyProductionEvent(state,{type:"ENTRY_FILL",eventId:"fill",ts:ts+1,id,qty:5,price:100,feeUsd:.5});
 state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",eventId:"terminal",ts:ts+2,id});
 state=applyProductionEvent(state,{type:"EXIT_REQUEST",eventId:"exit",ts:ts+3,id,qty:5});
 return {state,id,ts,symbol:candidate.symbol};
}
test("verified venue reduction closes only owned leg",async()=>{
 const {state,id,ts,symbol}=await setup();
 const order:any={symbol,clientOrderId:"exit-cid",orderId:7,status:"FILLED",side:"BUY",reduceOnly:true,
  quantity:5,executedQuantity:5,averagePrice:90,quoteQuantity:450};
 const trades=[{symbol,id:10,orderId:7,side:"BUY",price:"90",qty:"5",commission:".3",commissionAsset:"USDT",time:ts+4}];
 const result=reconcileV4ExitTrades(state,id,"exit-cid",order,trades,ts+5,ts+5);
 assert.equal(result.state.legs[id].status,"CLOSED");
 assert.equal(result.state.legs[id].qty,0);
 assert.equal(result.requiresReview,false);
 assert.throws(()=>reconcileV4ExitTrades(state,id,"exit-cid",{...order,reduceOnly:false},trades,ts+5,ts+5),/V4_EXIT_IDENTITY/);
});
test("partial fills reconcile cumulatively without double booking, including after restart",async()=>{
 const {state,id,ts,symbol}=await setup();
 const base:any={symbol,clientOrderId:"cid",orderId:51,side:"BUY",reduceOnly:true,quantity:5};
 const a={symbol,id:1,orderId:51,side:"BUY",price:"90",qty:"2",commission:".2",commissionAsset:"USDT",time:ts+4};
 const b={symbol,id:2,orderId:51,side:"BUY",price:"90",qty:"3",commission:".3",commissionAsset:"USDT",time:ts+6};
 const partial=reconcileV4ExitTrades(state,id,"cid",{...base,status:"PARTIALLY_FILLED",executedQuantity:2,
  averagePrice:90,quoteQuantity:180},[a],ts+5,ts+86400000);
 assert.equal(partial.state.legs[id].qty,3);
 assert.equal(partial.state.legs[id].status,"PENDING_EXIT");
 const done=reconcileV4ExitTrades(partial.state,id,"cid",{...base,status:"FILLED",executedQuantity:5,
  averagePrice:90,quoteQuantity:450},[a,b],ts+7,ts+86400000);
 assert.equal(done.state.legs[id].qty,0);
 assert.equal(done.state.journal.filter(e=>e.type==="EXIT_FILL").length,2);
 const again=reconcileV4ExitTrades(done.state,id,"cid",{...base,status:"FILLED",executedQuantity:5,
  averagePrice:90,quoteQuantity:450},[a,b],ts+8,ts+86400000);
 assert.deepEqual(again.state,done.state);
});
test("ACK with missing signed trades fails without state mutation",async()=>{
 const {state,id,ts,symbol}=await setup();
 const order:any={symbol,clientOrderId:"cid",orderId:51,status:"FILLED",side:"BUY",reduceOnly:true,
  quantity:5,executedQuantity:5,averagePrice:90,quoteQuantity:450};
 assert.throws(()=>reconcileV4ExitTrades(state,id,"cid",order,[],ts+5,ts+86400000),/HISTORY_INCOMPLETE/);
 assert.equal(state.legs[id].qty,5);
});
