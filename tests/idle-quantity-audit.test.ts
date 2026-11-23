import test from "node:test";
import assert from "node:assert/strict";
import {buildIdleQuantityAudit} from "../lib/idle-quantity-audit";
const base={symbol:"RENDERUSDT",equityUsd:100,price:2,requestedQuantity:50,quantity:49.9,notional:99.8,stepSize:0.1,minQuantity:0.1,maxQuantity:1000,minNotional:5,priceTickSize:0.001,pricePrecision:3};
test("RENDER exact 1x misses because venue rounds downward without enlarging lot",()=>{
 const a=buildIdleQuantityAudit(base);
 assert.equal(a.reasons.includes("MARKET_LOT_STEP_ROUNDING"),true);
 assert.equal(a.grossAfterRounding,0.998);
 assert.equal(a.exchangeFilters.quantityStep,0.1);
 assert.equal(a.orderMutation,0);
});
test("TIA classification records venue minimum notional and quantity separately",()=>{
 const a=buildIdleQuantityAudit({...base,symbol:"TIAUSDT",minNotional:110,minQuantity:100});
 assert.deepEqual(a.reasons.filter(x=>x.startsWith("VENUE_")),["VENUE_MIN_QTY","VENUE_MIN_NOTIONAL"]);
});
test("max lot and price tick alignment are reported, not mutated",()=>{
 const a=buildIdleQuantityAudit({...base,requestedQuantity:1500,maxQuantity:100,quantity:100,notional:200,price:2.0005});
 assert.ok(a.reasons.includes("VENUE_MAX_QTY"));
 assert.ok(a.reasons.includes("PRICE_TICK_ALIGNMENT"));
});
test("exact 1x is no warning and neither changes sizing",()=>{
 const a=buildIdleQuantityAudit({...base,quantity:50,notional:100});
 assert.deepEqual(a.reasons,[]);
 assert.equal(a.normalizedQuantity,50);
});
