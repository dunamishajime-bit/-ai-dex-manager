import assert from "node:assert/strict";
import test from "node:test";
import { AsterDirectTradeExecutor } from "../lib/direct-trade-executor";
for(const [quantity,precision,step] of [[10,0,1],[300,0,1],[121000,0,1],[150,0,1],[10,3,.001],[10.5,3,.001],[.03,3,.001],[100.001,3,.001]]) {
 test("normalized wire quantity preserves "+quantity+" at precision "+precision,async()=>{
  const executor=new AsterDirectTradeExecutor({getExchangeInfo:async()=>({symbols:[{symbol:"JUPUSDT",status:"TRADING",quantityPrecision:precision,filters:[{filterType:"MARKET_LOT_SIZE",minQty:String(step),maxQty:"1000000",stepSize:String(step)},{filterType:"MIN_NOTIONAL",notional:"0"}]}]})} as any);
  const n=await executor.normalizeMarketQuantity("JUPUSDT",quantity,1);
  assert.equal(Number(n.quantityText),n.quantity);
  assert.equal(n.quantity,quantity);
 });
}
