import test from "node:test";
import assert from "node:assert/strict";
import {reviewIncomeWindow} from "../lib/stable4-mtm-income-window-review";
import type {AsterIncomeRow} from "../lib/aster-v3-client";
const row:AsterIncomeRow={symbol:"NEARUSDT",incomeType:"REALIZED_PNL",income:"-0.216",asset:"USDT",time:1500,tranId:"123"};
test("explicit bounded GET window; valid rows do not prove completeness or authority",async()=>{
 const result=await reviewIncomeWindow(async r=>{assert.deepEqual(r,{startTime:1001,endTime:2000,limit:1000});return [row]},1000,2000,2000);
 assert.equal(result.status,"ROWS_PARSED_NOT_COMPLETENESS_PROOF");
 assert.equal(result.events[0].usd,-.216);assert.equal(result.historyCompletenessProven,false);assert.equal(result.orderAuthority,false);
});
test("observed Aster rebate must not silently disappear from accounting",async()=>{
 const r=await reviewIncomeWindow(async()=>[row,{...row,incomeType:"APOLLOX_DEX_REBATE_RECOMMENDED",income:"0.01"}],1000,2000,2000);
 assert.equal(r.status,"BLOCKED");assert.ok(r.blockers.includes("UNCLASSIFIED_INCOME:APOLLOX_DEX_REBATE_RECOMMENDED"));assert.deepEqual(r.events,[]);
});
test("non-USDT asset, malformed amount, missing identity, duplicate and boundary violation block",async()=>{
 for(const rows of [[{...row,asset:"ASTER"}],[{...row,income:""}],[{...row,tranId:undefined}],[row,row],[{...row,time:1000}],[{...row,time:2001}]]){
  const r=await reviewIncomeWindow(async()=>rows,1000,2000,2000);assert.equal(r.status,"BLOCKED");assert.deepEqual(r.events,[]);
 }
});
test("empty response remains unproven; saturated, invalid and unavailable window fail closed",async()=>{
 const empty=await reviewIncomeWindow(async()=>[],1000,2000,2000);assert.equal(empty.historyCompletenessProven,false);assert.equal(empty.rowCount,0);
 const capped=await reviewIncomeWindow(async()=>Array.from({length:1000},(_,i)=>({...row,tranId:i})),1000,2000,2000);
 assert.ok(capped.blockers.includes("INCOME_WINDOW_POSSIBLY_TRUNCATED"));
 const bad=await reviewIncomeWindow(async()=>{throw Error("network")},1000,2000,2000);assert.equal(bad.status,"BLOCKED");
 const future=await reviewIncomeWindow(async()=>{throw Error("must not call")},1000,2001,2000);assert.ok(future.blockers.includes("INVALID_BOUNDED_WINDOW"));
});
