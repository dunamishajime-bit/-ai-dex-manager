import test from "node:test";
import assert from "node:assert/strict";
import * as module from "../lib/causal-history-memo";
const candle=()=>({timestampMs:3600000,open:100,high:101,low:99,close:100,baseVolume:10,quoteVolume:1000});
test("causal memo reuses equal training windows and detects even in-place past corrections",()=>{
 const C=(module as any).CausalHistoryMemo;assert.equal(typeof C,"function");const cache=new C(2);
 let calls=0;const rows=[candle()],compute=()=>({value:++calls});
 assert.equal(cache.get("month",rows,compute).value,1);
 const returned=cache.get("month",[{...rows[0]}],compute);assert.equal(returned.value,1);returned.value=99;
 assert.equal(cache.get("month",rows,compute).value,1,"callers cannot mutate cached selection");
 rows[0].close=100.5;assert.equal(cache.get("month",rows,compute).value,2);
 rows[0].baseVolume=20;assert.equal(cache.get("month",rows,compute).value,3);
 assert.equal(calls,3);
});
test("undefined selections are cached and bounded eviction recomputes honestly",()=>{
 const C=(module as any).CausalHistoryMemo;const cache=new C(1),rows=[candle()];let calls=0;
 cache.get("empty",rows,()=>{calls++;return undefined;});cache.get("empty",rows,()=>{calls++;return 1;});assert.equal(calls,1);
 cache.get("other",rows,()=>2);assert.equal(cache.get("empty",rows,()=>{calls++;return 3;}),3);assert.equal(calls,2);
});
