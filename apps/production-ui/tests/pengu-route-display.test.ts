import assert from "node:assert/strict";
import test from "node:test";
import {deriveTradeHistoryAttribution} from "../lib/trade-history-attribution";
import {routeFromFillEvidence} from "../lib/server/fill-lineage-evidence";
const reason="PENGU V8 Short: SHORT_FIRST priority over V64 Dynamic Long/Recovery.";
test("actual SHORT_FIRST entry reason never becomes Dynamic Long",()=>{
 assert.equal(deriveTradeHistoryAttribution({source:"local-ledger",strategyId:"PENGU_DUAL_LS_V2_FINAL",reason}).routeLabel,"Short V20");
 assert.equal(routeFromFillEvidence({strategyId:"PENGU_DUAL_LS_V2_FINAL",side:"SELL",reason}),"Short V20");
});
test("explicit short entry version outranks mentions of recovery and dynamic long",()=>{
 assert.equal(routeFromFillEvidence({entryVersion:"SHORT_V20",reason:"Recovery V8 / V64 Dynamic Long"}),"Short V20");
});
test("explicit long entry version outranks unrelated short commentary",()=>{
 assert.equal(routeFromFillEvidence({entryVersion:"V64_DYNAMIC_LONG",reason}),"V64 Dynamic Long");
});
test("true long and recovery routes retain their labels",()=>{
 assert.equal(routeFromFillEvidence({reason:"PENGU V8 V64 Dynamic Long: ordinary Long or regime72-only breakout recovery edge passed."}),"V64 Dynamic Long");
 assert.equal(routeFromFillEvidence({entryVersion:"RECOVERY_V8",reason}),"Recovery V8");
});
