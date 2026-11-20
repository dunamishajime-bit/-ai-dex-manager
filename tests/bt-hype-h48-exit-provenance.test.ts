import test from "node:test";
import assert from "node:assert/strict";
import {safeStandaloneH48ExitComparison} from "../lib/bt-verification/hype-exit-provenance";
import source from "../docs/research-results/BT_HYPE_H48_TIME_ONLY_STANDALONE_COUNTERFACTUAL_20261119_UNCERTIFIED.json";

test("only independent 27-candidate H48 exit evidence may display",()=>{
 const rows=safeStandaloneH48ExitComparison(source);
 assert.equal(rows?.length,2);
 assert.deepEqual(rows?.map(x=>x.researchStopCount),[6,6]);
 assert.ok(rows?.every(x=>x.worstDeltaPctPoints<0));
});
test("no false presentation of actual fills or certification",()=>{
 assert.equal(safeStandaloneH48ExitComparison({...source,production_bt_parity_certified:true}),null);
 assert.equal(safeStandaloneH48ExitComparison({...source,actual_execution_count_verified:true}),null);
 assert.equal(safeStandaloneH48ExitComparison({...source,max_drawdown_computed:true}),null);
});
test("incoherent stopped research candidate counts fail closed",()=>{
 const copy=structuredClone(source);
 copy.scenarios["10"].old_model_stop_count=5;
 assert.equal(safeStandaloneH48ExitComparison(copy),null);
});
test("unreviewed new candidate row fails closed",()=>{
 const copy=structuredClone(source);
 copy.scenarios["30"].rows[0].old_model_exit_reason="LIVE_FILLED";
 assert.equal(safeStandaloneH48ExitComparison(copy),null);
});
