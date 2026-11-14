import {strict as assert} from "node:assert";
import {bracketExitOnBars,compareModeledExit,validateHistoricalM5} from "./bt-hp-native-hype-exit-contract-audit";

const base=Date.parse("2026-02-21T12:00:00Z");
const bar=(offset:number,open:number,high:number,low:number,close:number)=>
 ({time:base+offset*300_000,open,high,low,close});
let tests=0;
function test(label:string,fn:()=>void){fn();tests++;}

test("stop occurs before take profit in a single 5m bar",()=>{
 const x=bracketExitOnBars([bar(0,100,108,90,101)],base,95,105,168);
 assert.equal(x.reason,"HARD_STOP");assert.equal(x.price,95);assert.equal(x.ambiguous,true);
});
test("adverse stop gap fills at bar open",()=>{
 const x=bracketExitOnBars([bar(0,93,98,90,94)],base,95,105,168);
 assert.equal(x.price,93);assert.equal(x.reason,"HARD_STOP");
});
test("take profit occurs at the modeled fixed TP",()=>{
 const x=bracketExitOnBars([bar(0,100,106,98,102)],base,95,105,168);
 assert.equal(x.reason,"TAKE_PROFIT");assert.equal(x.price,105);
});
test("favorable TP gap accepts bar open as proxy",()=>{
 const x=bracketExitOnBars([bar(0,107,109,106,108)],base,95,105,168);
 assert.equal(x.price,107);
});
test("no forward data at end stays unknown",()=>{
 const x=bracketExitOnBars([bar(0,100,102,98,100)],base,95,105,168);
 assert.equal(x.reason,"INCOMPLETE_HISTORY");assert.equal(x.time,null);
});
test("M5 max hold does not pretend venue execution",()=>{
 const x=bracketExitOnBars([bar(0,100,102,98,100),bar(12,101,102,99,101)],
    base,95,105,1);
 assert.equal(x.reason,"MAX_HOLD_M5_OPEN_PROXY");
 assert.equal(x.price,101);
});
test("entry time suppresses earlier M5 bars",()=>{
 const x=bracketExitOnBars([bar(0,100,102,93,98),bar(1,100,102,98,101)],
    base+300_000,95,105,1);
 assert.equal(x.reason,"INCOMPLETE_HISTORY");
});
function modeled(exitTime:number,exitPrice:number,exitReason:string) {
 return {exit_ts_ms:exitTime,exit_price:exitPrice,exit_reason:exitReason} as
  Parameters<typeof compareModeledExit>[0];
}
test("archive exit UTC uses end-of-five-minute bar",()=>{
 const x=compareModeledExit(modeled(base+300_000,95,"PINNED_HYPE_HARD_STOP"),
    {time:base,price:95,reason:"HARD_STOP"});
 assert.deepEqual(x,{timeMatch:true,priceMatch:true,reasonMatch:true});
});
test("archive start-of-bar as if end-of-bar is rejected",()=>{
 const x=compareModeledExit(modeled(base,95,"PINNED_HYPE_HARD_STOP"),
    {time:base,price:95,reason:"HARD_STOP"});
 assert.equal(x.timeMatch,false);
});
test("exit price mismatch is visible",()=>{
 const x=compareModeledExit(modeled(base+300_000,95,"PINNED_HYPE_HARD_STOP"),
    {time:base,price:94.6,reason:"HARD_STOP"});
 assert.equal(x.priceMatch,false);
});
test("exit reason mismatch is visible",()=>{
 const x=compareModeledExit(modeled(base+300_000,95,"PINNED_HYPE_TAKE_PROFIT"),
    {time:base,price:95,reason:"HARD_STOP"});
 assert.equal(x.reasonMatch,false);
});
test("HYPE M5 identity must match",()=>{
 assert.throws(()=>validateHistoricalM5({symbol:"BTCUSDT",timeframeMs:300_000,rows:[]}),
   /M5_SOURCE_INVALID/);
});
test("wrong timeframe rejected",()=>{
 assert.throws(()=>validateHistoricalM5({symbol:"HYPEUSDT",timeframeMs:60_000,rows:[]}),
   /M5_SOURCE_INVALID/);
});
test("bar interval and source completeness mandatory",()=>{
 assert.throws(()=>validateHistoricalM5({symbol:"HYPEUSDT",timeframeMs:300_000,
  rows:[[base,100,101,99,100,1],[base+600_000,100,101,99,100,1]]}),
  /M5_GAP_OR_PRICE_INVALID/);
});
test("invalid high and low rejected",()=>{
 assert.throws(()=>validateHistoricalM5({symbol:"HYPEUSDT",timeframeMs:300_000,
  rows:[[base,100,99,98,100,1]]}),/M5_GAP_OR_PRICE_INVALID/);
});
console.log(JSON.stringify({status:"PASS",tests}));
