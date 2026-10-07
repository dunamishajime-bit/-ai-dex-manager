import assert from "node:assert/strict";
import test from "node:test";
import * as live from "../lib/idle-priority-short-live";
import type { NormalizedOrderQuantity } from "../lib/direct-trade-executor";
const equity=66.12791313, price=8.83, step=.01;
function normalized(quantity=Math.floor(equity/price/step)*step): NormalizedOrderQuantity {
 return {symbol:"AVAXUSDT",quantity,quantityText:String(quantity),minQuantity:.01,maxQuantity:10000,stepSize:step,minNotional:5,notional:quantity*price};
}
function evaluate(n=normalized(), e=equity, p=price): any {
 return (live as any).evaluateIdleNormalizedQuantity?.({equity:e,referencePrice:p,normalized:n});
}
test("lot-step floor of a full 1x target is executable and reserves actual notional",()=>{
 const n=normalized();
 assert.ok(n.notional/equity<1-1e-6,"reproduces yesterday's strict rounding hold");
 const result=evaluate(n);
 assert.equal(result?.accepted,true);
 assert.equal(result.notionalUsd,n.notional);
 assert.equal(result.gross,n.notional/equity);
});
test("an exactly realizable one gross target is accepted",()=>{
 assert.equal(evaluate(normalized(7),7*price)?.accepted,true);
});
for (const [name,n] of [
 ["one extra lot omitted",normalized(normalized().quantity-step)],
 ["quantity increased above target",normalized(normalized().quantity+step)],
 ["off-grid quantity",normalized(normalized().quantity-.003)],
 ["min notional not met",{...normalized(),minNotional:100}],
 ["max quantity exceeded",{...normalized(),maxQuantity:1}],
 ["inconsistent normalized notional",{...normalized(),notional:equity}],
 ["missing step",{...normalized(),stepSize:0}],
 ["non-finite quantity",{...normalized(),quantity:NaN}],
] as const) {
 test(name+" fails closed",()=>assert.equal(evaluate(n)?.accepted,false));
}
test("zero or non-finite equity and reference price fail closed",()=>{
 for(const [e,p] of [[0,price],[Infinity,price],[equity,0],[equity,NaN]])
  assert.equal(evaluate(normalized(),e,p)?.accepted,false);
});

test("wire quantity inconsistent with numeric quantity fails closed",()=>assert.equal(evaluate({...normalized(),quantityText:"1"})?.accepted,false));
