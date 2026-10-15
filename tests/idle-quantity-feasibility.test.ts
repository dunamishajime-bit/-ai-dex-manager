import assert from "node:assert/strict";
import test from "node:test";
import {evaluateIdleOneStepFloor, type IdleNormalizedLot} from "../lib/idle-quantity-feasibility";
const render:IdleNormalizedLot={symbol:"RENDERUSDT",equityUsd:68.682151,referencePrice:1.902,
  normalizedQuantity:36.1,normalizedNotional:36.1*1.902,minQuantity:0.1,
  maxQuantity:200000,quantityStep:0.1,minNotional:5};
const tia:IdleNormalizedLot={symbol:"TIAUSDT",equityUsd:68.682151,referencePrice:0.5467,
  normalizedQuantity:125,normalizedNotional:125*0.5467,minQuantity:1,
  maxQuantity:300000,quantityStep:1,minNotional:5};
test("RENDER exchange tick floor permits <1x without increasing order quantity",()=>{
  const r=evaluateIdleOneStepFloor(render);
  assert.equal(r.accepted,true);assert.equal(r.code,"VENUE_STEP_ROUNDING_OK");
  assert.equal(r.orderQuantity,36.1);assert.equal(r.sideEffects,0);
});
test("TIA exchange integer lot floor permits <1x without rounding up",()=>{
  const r=evaluateIdleOneStepFloor(tia);
  assert.equal(r.accepted,true);assert.equal(r.orderQuantity,125);assert.ok((r.actualGross??0)<1);
});
test("reject any quantity over one 1x gross",()=>{
  assert.equal(evaluateIdleOneStepFloor({...tia,normalizedQuantity:126,normalizedNotional:126*0.5467}).accepted,false);
});
test("reject manipulative underfills beyond the strict one-step venue floor",()=>{
  assert.equal(evaluateIdleOneStepFloor({...tia,normalizedQuantity:124,normalizedNotional:124*0.5467}).code,"QUANTITY_NOT_ONE_STEP_FLOOR");
});
test("reject minimum venue constraints independently",()=>{
  assert.equal(evaluateIdleOneStepFloor({...tia,minNotional:80}).code,"VENUE_MIN_NOTIONAL");
  assert.equal(evaluateIdleOneStepFloor({...tia,minQuantity:140}).code,"VENUE_MIN_QTY");
});
test("reject rounding shortfall greater than 1%, even when step-valid",()=>{
  const r=evaluateIdleOneStepFloor({...tia,equityUsd:5.46,normalizedQuantity:9,normalizedNotional:9*0.5467,minNotional:1});
  assert.equal(r.accepted,false);
});
test("inconsistent notional and non-finite inputs fail closed",()=>{
  assert.equal(evaluateIdleOneStepFloor({...render,normalizedNotional:50}).code,"QUANTITY_NOT_ONE_STEP_FLOOR");
  assert.equal(evaluateIdleOneStepFloor({...render,referencePrice:NaN}).code,"INPUT_INVALID");
});
