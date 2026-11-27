import test from "node:test";
import assert from "node:assert/strict";
import {replayFetBrk48ModeledM5,FET_M5_MS} from "../lib/stable4-fet-offline-m5-exit";
const t=Date.UTC(2026,4,1);
const bar=(ts:number,open:number,high:number,low:number,close:number)=>({ts,open,high,low,close});
const replay=(xs:any[])=>replayFetBrk48ModeledM5({entryTs:t,entryPrice:100,barAt:q=>xs.find(z=>z.ts===q)});
test("STOP at confirmed M5 close, worse gap execution, no order authority",()=>{
 const z=replay([bar(t,94,99,90,97)]);
 assert.deepEqual(z,{reason:"FET_PROTECTED_STOP",ts:t+FET_M5_MS,price:94,barOpenTs:t,orderAuthority:false});
});
test("profit floor set after completed +5%, not retroactive into same bar",()=>{
 const z=replay([
 bar(t,100,108,99,106),
 bar(t+FET_M5_MS,106,106,102,103)
 ]);
 assert.equal(z.reason,"FET_PROTECTED_STOP");
 assert.equal(z.ts,t+2*FET_M5_MS);
 assert.equal(z.price,103);
});
test("source 8% trailing gives back four points, only after prior close",()=>{
 const z=replay([
 bar(t,100,110,99,109),
 bar(t+FET_M5_MS,109,110,103,104)
 ]);
 assert.equal(z.reason,"FET_PROTECTED_STOP");
 assert.equal(z.price,105);
});
test("missing or malformed M5 fails closed",()=>{
 assert.throws(()=>replay([bar(t+FET_M5_MS,100,101,99,100)]),/GAP_OR_INVALID/);
 assert.throws(()=>replay([bar(t,100,99,101,100)]),/GAP_OR_INVALID/);
});
test("24h time exit uses next confirmed bar opening rather than future candle close",()=>{
 const xs=Array.from({length:289},(_,i)=>bar(t+i*FET_M5_MS,100,101,99,100));
 const z=replay(xs);
 assert.equal(z.reason,"MAX_HOLD");
 assert.equal(z.ts,t+24*3600000);
 assert.equal(z.price,100);
});
