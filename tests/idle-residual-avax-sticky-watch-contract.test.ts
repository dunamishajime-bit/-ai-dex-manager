import test from "node:test";
import assert from "node:assert/strict";
import {advanceAvaxSoftWatch} from "../lib/idle-residual-avax-policy";
const T=1793181600000;
function evaluate(bidPrice:number,now:number,firstTouchAtTs?:number,watchDeadlineTs?:number){
 return advanceAvaxSoftWatch({entryPrice:100,bidPrice,now,firstTouchAtTs,watchDeadlineTs});
}
test("touch negative 3.5, rebound, relapse at 2h must still exit",()=>{
 const touch=evaluate(96.4,T);
 assert.equal(touch.firstTouchAtTs,T);
 const rebound=evaluate(97,T+3_600_000,touch.firstTouchAtTs,touch.watchDeadlineTs);
 assert.equal(rebound.firstTouchAtTs,T);
 assert.equal(rebound.watchDeadlineTs,T+7200000);
 const relapse=evaluate(96.4,T+7200000,rebound.firstTouchAtTs,rebound.watchDeadlineTs);
 assert.equal(relapse.action,"SOFT_MINUS3P5_WATCH2H");
});
test("threshold touch and full recovery by deadline resets monitoring without exit",()=>{
 const touch=evaluate(96.4,T);
 const safe=evaluate(97,T+7200000,touch.firstTouchAtTs,touch.watchDeadlineTs);
 assert.equal(safe.action,undefined);
 assert.equal(safe.firstTouchAtTs,undefined);
});
test("no adverse threshold touch cannot arm",()=>{
 assert.equal(evaluate(97,T).firstTouchAtTs,undefined);
});
test("subsequent new adverse touch starts a fresh window only after original has expired with recovery",()=>{
 const touch=evaluate(96.4,T);
 const clear=evaluate(97,T+7200000,touch.firstTouchAtTs,touch.watchDeadlineTs);
 const another=evaluate(96.4,T+7300000,clear.firstTouchAtTs,clear.watchDeadlineTs);
 assert.equal(another.firstTouchAtTs,T+7300000);
});
test("invalid watch deadline fails closed",()=>{
 assert.throws(()=>evaluate(96.4,T+4000,T,T-1),/STATE_INVALID/);
});
