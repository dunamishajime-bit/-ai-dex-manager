import test from "node:test";
import assert from "node:assert/strict";
import {createProductionState} from "../lib/v12-v4-production-lifecycle";
import {planV4RetiredStops} from "../lib/v12-v4-stop-retirement";
test("only retired leg STOP is cancelable; surviving same-symbol leg keeps signed STOP and net position",()=>{
 const state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false}) as any;
 state.legs={
  retired:{id:"retired",qty:0,status:"CLOSED",candidate:{symbol:"ETHUSDT",effectiveSide:"LONG"}},
  survivor:{id:"survivor",qty:3,status:"OPEN",candidate:{symbol:"ETHUSDT",effectiveSide:"LONG"}},
 };
 const intents:any={
  oldStop:{legId:"retired",action:"STOP",clientOrderId:"oldStop",stage:"ACKNOWLEDGED"},
  kept:{legId:"survivor",action:"STOP",clientOrderId:"kept",stage:"ACKNOWLEDGED"}
 };
 const orders:any=[
  {clientOrderId:"oldStop",symbol:"ETHUSDT",side:"SELL",type:"STOP_MARKET",
   reduceOnly:true,origQty:"2",executedQty:"0",status:"NEW"},
  {clientOrderId:"kept",symbol:"ETHUSDT",side:"SELL",type:"STOP_MARKET",
   reduceOnly:true,origQty:"3",executedQty:"0",status:"NEW"}
 ];
 const args={state,intents,openOrders:orders,positions:[{symbol:"ETHUSDT",positionAmt:"3"}]} as any;
 assert.deepEqual(planV4RetiredStops(args),["oldStop"]);
 assert.deepEqual(planV4RetiredStops({...args,openOrders:[orders[1]]}),[]);
 assert.throws(()=>planV4RetiredStops({...args,positions:[{symbol:"ETHUSDT",positionAmt:"5"}]}),/EXPOSURE_CONFLICT/);
 assert.throws(()=>planV4RetiredStops({...args,openOrders:[orders[0]]}),/NOT_PROTECTED/);
 assert.throws(()=>planV4RetiredStops({...args,openOrders:[{...orders[0],executedQty:"1"},orders[1]]}),/NOT_SAFE_TO_CANCEL/);
});
