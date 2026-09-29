import assert from "node:assert/strict";
import test from "node:test";
import { IDLE_PRIORITY_SHORT_POLICY } from "../config/idlePriorityShortPolicy";
import { evaluateIdlePriorityShort, type IdleFeatures } from "../lib/idle-priority-short-signal";

const base:IdleFeatures={decisionTs:100,signalTs:99,ret12:-0.04,ret24:-0.05,btc24:-0.01,rel24:-0.04,atrRatio:0.008,volumeRatio:1.5,breakdown24:true};

test("production contract pins gross/leverage/cross/protection",()=>{
 assert.equal(IDLE_PRIORITY_SHORT_POLICY.gross,1);
 assert.equal(IDLE_PRIORITY_SHORT_POLICY.leverage,5);
 assert.equal(IDLE_PRIORITY_SHORT_POLICY.marginType,"cross");
 assert.equal(IDLE_PRIORITY_SHORT_POLICY.cooldownHours,12);
 assert.equal(IDLE_PRIORITY_SHORT_POLICY.emergencyStopPct,10);
 assert.equal(IDLE_PRIORITY_SHORT_POLICY.emergencyTakeProfitPct,25);
});

test("all five routes are SHORT with exact holds",()=>{
 for(const [s,h] of [["TAOUSDT",12],["TIAUSDT",24],["DOTUSDT",24],["JUPUSDT",12],["RENDERUSDT",12]] as const){
  const x=evaluateIdlePriorityShort(s,base); assert.equal(x.accepted,true,s); assert.equal(x.side,"SHORT"); assert.equal(x.holdHours,h);
 }
});

test("generic archetype gates cannot be bypassed",()=>{
 assert.equal(evaluateIdlePriorityShort("TAOUSDT",{...base,volumeRatio:1.29}).accepted,false);
 assert.equal(evaluateIdlePriorityShort("DOTUSDT",{...base,volumeRatio:0.99}).accepted,false);
 assert.equal(evaluateIdlePriorityShort("JUPUSDT",{...base,volumeRatio:0.79}).accepted,false);
 assert.equal(evaluateIdlePriorityShort("RENDERUSDT",{...base,atrRatio:0.0069}).accepted,false);
});

test("symbol filters remain additional to generic gates",()=>{
 assert.equal(evaluateIdlePriorityShort("TAOUSDT",{...base,rel24:-0.019}).accepted,false);
 assert.equal(evaluateIdlePriorityShort("TIAUSDT",{...base,volumeRatio:100.01}).accepted,false);
 assert.equal(evaluateIdlePriorityShort("DOTUSDT",{...base,btc24:0.001}).accepted,false);
});
