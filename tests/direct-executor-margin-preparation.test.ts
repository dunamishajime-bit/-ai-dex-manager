import test from "node:test";
import assert from "node:assert/strict";
import {AsterDirectTradeExecutor} from "../lib/direct-trade-executor";
import {MarketPreSubmitEntryError} from "../lib/market-pre-submit-entry-error";
function fixture(leverage="5",marginType="cross"){
 const calls={margin:0,leverage:0,orders:0};
 const rows=[{symbol:"BNBUSDT",positionAmt:"-0.02",leverage,marginType}];
 const client:any={getPositions:async()=>rows,getOpenOrders:async()=>[{symbol:"BNBUSDT",type:"STOP_MARKET",reduceOnly:true}],setMarginType:async()=>{calls.margin++;},setLeverage:async()=>{calls.leverage++;},placeMarketOrder:async()=>{calls.orders++;}};
 return{calls,rows,executor:new AsterDirectTradeExecutor(client)};
}
test("already verified 5x cross permits existing protected same-symbol inventory without venue mutations",async()=>{
 const h=fixture();await h.executor.prepareVenueMargin5xCross("BNBUSDT");assert.deepEqual(h.calls,{margin:0,leverage:0,orders:0});
});
test("existing inventory with wrong leverage or margin still blocks all setting changes",async()=>{
 for(const [leverage,margin]of [["4","cross"],["5","isolated"]]){const h=fixture(leverage,margin);await assert.rejects(h.executor.prepareVenueMargin5xCross("BNBUSDT"),/NON_ZERO_POSITION/);assert.deepEqual(h.calls,{margin:0,leverage:0,orders:0});}
});
test("new-entry margin rejection is bound to the unsent client order, never execution-unknown",async()=>{
 const h=fixture("4");
 await assert.rejects(h.executor.executeMarket({requestId:"r",clientOrderId:"entry-cid",symbol:"BNBUSDT",side:"SELL",quantity:.02,expectedPrice:590,maxSlippageBps:20,reason:"test",requireVenueMargin5xCross:true}),
  (e:unknown)=>e instanceof MarketPreSubmitEntryError&&e.stage==="MARGIN_PREPARATION"&&e.symbol==="BNBUSDT"&&e.clientOrderId==="entry-cid"&&e.reduceOnly===false);
 assert.deepEqual(h.calls,{margin:0,leverage:0,orders:0});
});
