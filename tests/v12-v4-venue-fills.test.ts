import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/v12-v4-native-route-20261009.json";
import {adaptProductionCandidates} from "../lib/v12-v4-production-features";
import {createProductionState,planProductionEntry,applyProductionEvent} from "../lib/v12-v4-production-lifecycle";
import type {V4EntryFillProof} from "../lib/v12-v4-venue-fills";
import {reconcileV4EntryTrades} from "../lib/v12-v4-venue-fills";
async function setup(){
 const candidate={...adaptProductionCandidates({...fixture,source:{...fixture.source,side:"SHORT",sourceEngine:"buildV12Signals"}}).candidates[0],requestedGross:.5};
 let state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
 const event=await planProductionEntry(state,{candidate,ts:candidate.eligibleEntryTs,eventId:"reserve",referencePrice:100,minimumOrderNotionalUsd:5,
 quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,quantityText:String(q),notional:q*p})} as any});
 state=applyProductionEvent(state,event);
 return {state,id:event.leg.id,ts:event.ts,symbol:candidate.symbol};
}
test("signed entry trades are idempotent across restart, with actual commissions and terminal proof",async()=>{
 const {state,id,ts,symbol}=await setup();
 const proof:V4EntryFillProof={order:{symbol,clientOrderId:"v12-v4-example",orderId:42,status:"FILLED",side:"SELL",quantity:5,executedQuantity:5,averagePrice:100,quoteQuantity:500},
 trades:[{symbol,id:7,orderId:42,side:"SELL",price:"100",qty:"2",commission:"0.2",commissionAsset:"USDT",time:ts},
 {symbol,id:8,orderId:42,side:"SELL",price:"100",qty:"3",commission:"0.3",commissionAsset:"USDT",time:ts}]};
 const next=reconcileV4EntryTrades(state,id,"v12-v4-example",proof,ts+1);
 assert.equal(next.legs[id].qty,5);assert.equal(next.legs[id].feesUsd,.5);assert.equal(next.legs[id].status,"OPEN");
 assert.deepEqual(reconcileV4EntryTrades(next,id,"v12-v4-example",proof,ts+2),next);
});
test("terminal ACK without complete trade history cannot release reservation",async()=>{
 const {state,id,ts,symbol}=await setup();
 const proof:V4EntryFillProof={order:{symbol,clientOrderId:"cid",orderId:42,status:"FILLED",side:"SELL",quantity:5,executedQuantity:5,averagePrice:100,quoteQuantity:500},
 trades:[{symbol,id:7,orderId:42,side:"SELL",price:"100",qty:"2",commission:"0.2",commissionAsset:"USDT",time:ts}]};
 assert.throws(()=>reconcileV4EntryTrades(state,id,"cid",proof,ts+1),/TRADE_HISTORY_INCOMPLETE/);
 assert.equal(state.legs[id].qty,0);assert.equal(state.legs[id].reservationUsd,500);
});
test("a trade belonging to another order never enters the V4 leg",async()=>{
 const {state,id,ts,symbol}=await setup();
 const proof:V4EntryFillProof={order:{symbol,clientOrderId:"cid",orderId:42,status:"PARTIALLY_FILLED",side:"SELL",quantity:5,executedQuantity:2,averagePrice:100,quoteQuantity:200},
 trades:[{symbol,id:7,orderId:43,side:"SELL",price:"100",qty:"2",commission:"0.2",commissionAsset:"USDT",time:ts}]};
 assert.throws(()=>reconcileV4EntryTrades(state,id,"cid",proof,ts+1),/TRADE_ORDER_IDENTITY/);
});
