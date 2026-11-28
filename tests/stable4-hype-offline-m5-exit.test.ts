import test from "node:test";
import assert from "node:assert/strict";
import {replayHypeModeledM5Exit,HYPE_M5_MS} from "../lib/stable4-hype-offline-m5-exit";
const t=Date.UTC(2026,5,1);
const x=(arr:any[],hours=1)=>replayHypeModeledM5Exit({entryTs:t,entryPrice:100,stopPrice:95,takeProfitPrice:110,maxHoldHours:hours,barAt:i=>arr.find(z=>z.ts===i)});
test("completed M5 STOP timestamp and worse gap price, no venue authority",()=>{
 const z=x([{ts:t,open:94,high:100,low:90,close:99}]);
 assert.equal(z.reason,"PINNED_HYPE_HARD_STOP");assert.equal(z.ts,t+HYPE_M5_MS);
 assert.equal(z.price,94);assert.equal(z.orderAuthority,false);
});
test("STOP before profit in ambiguous same M5",()=>{
 const z=x([{ts:t,open:100,high:111,low:90,close:99}]);
 assert.equal(z.reason,"PINNED_HYPE_HARD_STOP");
 assert.equal(z.stopAndTargetBothTouched,true);
});
test("take profit on next fully confirmed bar",()=>{
 const bars=[{ts:t,open:100,high:101,low:99,close:100},
 {ts:t+HYPE_M5_MS,open:112,high:114,low:111,close:113}];
 const z=x(bars);assert.equal(z.reason,"PINNED_HYPE_TAKE_PROFIT");assert.equal(z.ts,t+2*HYPE_M5_MS);assert.equal(z.price,112);
});
test("gap or future-bar substitution fails closed",()=>{
 assert.throws(()=>x([{ts:t+HYPE_M5_MS,open:100,high:101,low:99,close:100}]),/INCOMPLETE/);
 assert.throws(()=>x([{ts:t,open:100,high:99,low:101,close:100}]),/INVALID/);
});
test("fixed hold can close at actual next bar open only",()=>{
 const candles=Array.from({length:13},(_,i)=>({ts:t+i*HYPE_M5_MS,open:100,high:101,low:99,close:100}));
 const z=x(candles);assert.equal(z.reason,"PINNED_HYPE_MAX_HOLD");assert.equal(z.ts,t+3600000);assert.equal(z.price,100);
});
