import test from "node:test";
import assert from "node:assert/strict";
import {unmanagedHypeZecOrders} from "../lib/hype-zec-long-runner";
import {unmanagedCrossSleeveOpenOrders} from "../lib/pengu-dual-ls-v2-portfolio-runner";
const stop:any={
 symbol:"DOGEUSDT",clientOrderId:"v12-v4-98ded39746ed3502a4d7b0e26ef9",
 orderId:3161652232,type:"STOP_MARKET",side:"BUY",reduceOnly:true,
 status:"NEW",quantity:226,executedQuantity:0,stopPrice:0.08696
};
const position:any={symbol:"DOGEUSDT",quantity:-226,entryPrice:0.08052,notionalUsd:18};
test("HYPE recognizes exactly owned resident V4 STOP and does not block unrelated candidate",()=>{
 assert.equal(unmanagedHypeZecOrders([stop],[position]).length,0);
});
test("PENGU recognizes exactly owned resident V4 STOP and keeps trade-blocker for unknowns",()=>{
 assert.equal(unmanagedCrossSleeveOpenOrders([stop],[position]).length,0);
});
for(const [name,change] of [
 ["bad client ID",{clientOrderId:"v12-v4-tampered"}],
 ["wrong direction",{side:"SELL"}],
 ["1 unit underprotected",{quantity:225}],
 ["not reduce-only",{reduceOnly:false}],
 ["wrong type",{type:"LIMIT"}],
] as const){
 test("unknown orders remain blocked for both runners: "+name,()=>{
  const tampered={...stop,...change};
  assert.equal(unmanagedHypeZecOrders([tampered],[position]).length,1);
  assert.equal(unmanagedCrossSleeveOpenOrders([tampered],[position]).length,1);
 });
}
test("cancelled order is not treated as active by HYPE; PENGU remains conservative",()=>{
 const canceled={...stop,status:"CANCELED"};
 assert.equal(unmanagedHypeZecOrders([canceled],[position]).length,0);
 assert.equal(unmanagedCrossSleeveOpenOrders([canceled],[position]).length,1);
});
