import assert from "node:assert/strict";
import test from "node:test";
import { IDLE_PRIORITY_SHORT_POLICY } from "../config/idlePriorityShortPolicy";
import {
  evaluateIdleGenericCandidate,
  evaluateIdlePriorityShort,
  type IdleFeatures,
} from "../lib/idle-priority-short-signal";

const base:IdleFeatures={
  decisionTs:100,
  signalTs:99,
  ret12:-0.04,
  ret24:-0.05,
  btc24:-0.01,
  rel24:-0.04,
  atrRatio:0.008,
  volumeRatio:1.5,
  breakoutLong24:false,
  breakoutShort24:false,
  breakdown24:false,
};

test("production contract pins gross/leverage/cross/protection",()=>{
 assert.equal(IDLE_PRIORITY_SHORT_POLICY.gross,1);
 assert.equal(IDLE_PRIORITY_SHORT_POLICY.leverage,5);
 assert.equal(IDLE_PRIORITY_SHORT_POLICY.marginType,"cross");
 assert.equal(IDLE_PRIORITY_SHORT_POLICY.cooldownHours,12);
 assert.equal(IDLE_PRIORITY_SHORT_POLICY.emergencyStopPct,10);
 assert.equal(IDLE_PRIORITY_SHORT_POLICY.emergencyTakeProfitPct,25);
 assert.deepEqual(IDLE_PRIORITY_SHORT_POLICY.generic.priority,["BREAKOUT","RELATIVE","MOMENTUM"]);
});

test("generic priority is BREAKOUT then RELATIVE then MOMENTUM",()=>{
 const breakout=evaluateIdleGenericCandidate({...base,breakoutShort24:true});
 assert.equal(breakout.archetype,"BREAKOUT");
 assert.equal(breakout.side,"SHORT");

 const relative=evaluateIdleGenericCandidate({...base,breakoutShort24:false,ret12:-0.02});
 assert.equal(relative.archetype,"RELATIVE");
 assert.equal(relative.side,"SHORT");

 const momentum=evaluateIdleGenericCandidate({...base,breakoutShort24:false,ret24:-0.02,rel24:-0.01});
 assert.equal(momentum.archetype,"MOMENTUM");
 assert.equal(momentum.side,"SHORT");
});

test("all five selected routes remain SHORT with exact holds",()=>{
 const taoFeatures={...base,breakoutShort24:true,breakdown24:true,ret24:-0.05,rel24:-0.04,volumeRatio:1.5};
 const tiaFeatures={...base,breakoutShort24:true,breakdown24:true,ret24:-0.05,rel24:-0.01,volumeRatio:2};
 const dotFeatures={...base,breakoutShort24:false,ret12:-0.04,ret24:-0.02,rel24:-0.01,btc24:-0.01,volumeRatio:1.2};
 const jupFeatures={...base,breakoutShort24:false,ret12:-0.01,ret24:-0.05,rel24:-0.04,volumeRatio:1};
 const renderFeatures={...jupFeatures};

 for(const [symbol,features,hold] of [
  ["TAOUSDT",taoFeatures,12],
  ["TIAUSDT",tiaFeatures,24],
  ["DOTUSDT",dotFeatures,24],
  ["JUPUSDT",jupFeatures,12],
  ["RENDERUSDT",renderFeatures,12],
 ] as const){
  const generic=evaluateIdleGenericCandidate(features);
  const signal=evaluateIdlePriorityShort(symbol,features,generic);
  assert.equal(signal.accepted,true,symbol);
  assert.equal(signal.side,"SHORT");
  assert.equal(signal.holdHours,hold);
 }
});

test("generic archetype gates cannot be bypassed",()=>{
 assert.equal(evaluateIdleGenericCandidate({...base,ret12:-0.02,ret24:-0.01,rel24:-0.01}).accepted,false);
 assert.equal(evaluateIdleGenericCandidate({...base,volumeRatio:0.79}).accepted,false);
 assert.equal(evaluateIdleGenericCandidate({...base,atrRatio:0.0069}).accepted,false);
 assert.equal(evaluateIdleGenericCandidate({...base,breakoutShort24:true,ret24:-0.019,ret12:-0.02,rel24:-0.01}).archetype,null);
 assert.equal(evaluateIdleGenericCandidate({...base,ret12:-0.02,ret24:-0.014,rel24:-0.04}).archetype,null);
});

test("symbol filters remain additional to generic gates",()=>{
 const tao={...base,breakoutShort24:true,breakdown24:true,ret24:-0.05,rel24:-0.019,volumeRatio:1.5};
 assert.equal(evaluateIdlePriorityShort("TAOUSDT",tao,evaluateIdleGenericCandidate(tao)).accepted,false);

 const tia={...base,breakoutShort24:true,breakdown24:true,ret24:-0.05,rel24:-0.01,volumeRatio:100.01};
 assert.equal(evaluateIdlePriorityShort("TIAUSDT",tia,evaluateIdleGenericCandidate(tia)).accepted,false);

 const dot={...base,breakoutShort24:false,ret12:-0.04,ret24:-0.02,rel24:-0.01,btc24:0.01,volumeRatio:1.2};
 assert.equal(evaluateIdlePriorityShort("DOTUSDT",dot,evaluateIdleGenericCandidate(dot)).accepted,false);
});
