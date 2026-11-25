import {strict as assert} from "node:assert";
import {test} from "node:test";
import {
  evaluateOwnerStable4HardGross,
  OWNER_STABLE4_GROSS_HARD_CAP_CANDIDATE,
} from "../lib/stable4-dd30-owner-hard-gross-candidate";

const zero=()=>({currentCrypto:0,currentStock:0,currentHype:0,
  pendingCrypto:0,pendingStock:0,pendingHype:0,
  requestedCrypto:0,requestedStock:0,requestedHype:0});
test("Owner approved absolute Gross 3.0/4.0/4.25/HYPE1.5 is never traded from a math helper",()=>{
  assert.deepEqual(OWNER_STABLE4_GROSS_HARD_CAP_CANDIDATE,
    {crypto:3,stock:4,total:4.25,hype:1.5});
  const ok=evaluateOwnerStable4HardGross({
    ...zero(),currentCrypto:2,currentStock:1,
    requestedCrypto:0.5,requestedHype:0.5,
  });
  assert.equal(ok.status,"WITHIN_ABSOLUTE_CAPS_NOT_AUTHORIZED");
  assert.equal(ok.tradingAuthorization,false);
  assert.equal(ok.headroom.total,0.75);
});
test("TWR, profit tier or margin cannot override absolute hard caps",()=>{
  for(const input of [
    {...zero(),currentCrypto:3,requestedCrypto:0.01},
    {...zero(),currentStock:4,requestedStock:0.01},
    {...zero(),currentCrypto:3,currentStock:1.25,requestedCrypto:0.01},
    {...zero(),currentCrypto:1.5,currentHype:1.5,
      requestedCrypto:0.01,requestedHype:0.01},
  ]){
    const decision=evaluateOwnerStable4HardGross(input);
    assert.equal(decision.status,"OVER_ABSOLUTE_CAP");
    assert.ok(decision.reasons.length);
    assert.equal(decision.tradingAuthorization,false);
  }
});
test("pending UNKNOWN exposure is counted and never discarded to create entry headroom",()=>{
  const v=evaluateOwnerStable4HardGross({
    ...zero(),currentCrypto:2.5,pendingCrypto:0.6,requestedCrypto:0.1,
  });
  assert.equal(v.status,"OVER_ABSOLUTE_CAP");
  assert.ok(v.reasons.includes("OWNER_GROSS_HARD_CAP_CRYPTO"));
  assert.equal(v.headroom.crypto,0);
});
test("gross calculations reject NaN, negatives and HYPE misclassified as outside crypto",()=>{
  assert.throws(()=>evaluateOwnerStable4HardGross({...zero(),currentCrypto:NaN}),
    /STABLE4_OWNER_GROSS_MATH_INVALID/);
  assert.throws(()=>evaluateOwnerStable4HardGross({...zero(),requestedStock:-1}),
    /STABLE4_OWNER_GROSS_MATH_INVALID/);
  assert.throws(()=>evaluateOwnerStable4HardGross({...zero(),currentHype:1,currentCrypto:0}),
    /HYPE_NOT_SUBSET_OF_CRYPTO/);
});
