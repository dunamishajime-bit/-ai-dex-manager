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

test("route-sized 0.25x, capacity-limited 0.63x and 0.75x use their own venue step",()=>{
  for(const target of [0.25,0.63,0.75]){
    const qty=target*500;
    const out=evaluateIdleOneStepFloor({
      symbol:"RENDERUSDT",equityUsd:1000,referencePrice:2,
      normalizedQuantity:qty,normalizedNotional:qty*2,
      minQuantity:0.1,maxQuantity:100000,quantityStep:0.1,minNotional:5,requiredGross:target
    });
    assert.equal(out.accepted,true,JSON.stringify(out));
    assert.equal(out.requiredGross,target);
    assert.ok(Math.abs((out.actualGross??0)-target)<1e-8);
    const fake=evaluateIdleOneStepFloor({
      symbol:"RENDERUSDT",equityUsd:1000,referencePrice:2,
      normalizedQuantity:qty+0.1,normalizedNotional:(qty+0.1)*2,
      minQuantity:0.1,maxQuantity:100000,quantityStep:0.1,minNotional:5,requiredGross:target
    });
    assert.equal(fake.accepted,false);
  }
});
test("unsupported greater-than-1x authorization does not silently bypass order cap",()=>{
  assert.equal(evaluateIdleOneStepFloor({...render,requiredGross:5}).code,"INPUT_INVALID");
});
