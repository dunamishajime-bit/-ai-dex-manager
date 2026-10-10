import test from "node:test";
import assert from "node:assert/strict";
import {createProductionState} from "../lib/v12-v4-production-lifecycle";
import {verifyV4ResidentStops} from "../lib/v12-v4-resident-stop-owners";
test("two overlapping same-symbol virtual legs each own exact venue STOP quantity",()=>{
 const state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false}) as any;
 state.legs={
  l1:{id:"l1",qty:2,candidate:{symbol:"ADAUSDT",effectiveSide:"LONG"},status:"OPEN"},
  l2:{id:"l2",qty:3,candidate:{symbol:"ADAUSDT",effectiveSide:"LONG"},status:"OPEN"},
 };
 const intents:any={
  cid1:{legId:"l1",action:"STOP",stage:"ACKNOWLEDGED",clientOrderId:"cid1"},
  cid2:{legId:"l2",action:"STOP",stage:"ACKNOWLEDGED",clientOrderId:"cid2"},
 };
 const orders:any=[
  {symbol:"ADAUSDT",clientOrderId:"cid1",status:"NEW",type:"STOP_MARKET",
   reduceOnly:true,side:"SELL",origQty:"2",executedQty:"0"},
  {symbol:"ADAUSDT",clientOrderId:"cid2",status:"NEW",type:"STOP_MARKET",
   reduceOnly:true,side:"SELL",origQty:"3",executedQty:"0"},
 ];
 assert.deepEqual(verifyV4ResidentStops(state,intents,orders),
  {verifiedLegs:2,uniqueStopOrders:2,ready:true});
 assert.throws(()=>verifyV4ResidentStops(state,intents,[orders[0]]),/OWNER_MISSING/);
 assert.throws(()=>verifyV4ResidentStops(state,intents,
  [orders[0],{...orders[1],origQty:"1"}]),/QUANTITY_MISMATCH/);
 assert.throws(()=>verifyV4ResidentStops(state,intents,[...orders,
  {...orders[0],clientOrderId:"unknown"}]),/UNATTRIBUTED_RESIDENT_STOP/);
 assert.throws(()=>verifyV4ResidentStops(state,intents,[orders[0],
  {...orders[1],reduceOnly:false}]),/IDENTITY_INVALID/);
});
