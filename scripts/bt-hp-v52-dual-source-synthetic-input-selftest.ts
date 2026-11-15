import assert from "node:assert/strict";
import {
 createV52ModeledDualSourceTrace,V52_NATIVE_STOCK_UNIVERSE
} from "./bt-hp-v52-dual-source-synthetic-input";
const first=createV52ModeledDualSourceTrace(20261115,"rotation");
const repeat=createV52ModeledDualSourceTrace(20261115,"rotation");
const alternate=createV52ModeledDualSourceTrace(20261116,"rotation");
assert.deepEqual(first,repeat,"Identical seed and scenario must reproduce full modeled source time series");
assert.notDeepEqual(first,alternate,"Different seed must not silently reuse candidate artifacts");
assert.equal(first.schema,"disdex-bt-v52-dual-source-input-v1");
assert.equal(first.feed,"synthetic-v1-23-symbol");
assert.equal(first.sessionCalendar,"NY_WEEKDAY_RTH_ONLY_NO_HOLIDAYS");
assert.equal(first.venueTruth,false);
assert.equal(first.stockReferenceTruth,false);
assert.equal(first.fills,0);
assert.equal(first.fullV52Parity,false);
assert.equal(V52_NATIVE_STOCK_UNIVERSE.length,5);
assert.equal(first.inputs.length,39,"13 NY weekdays x 3 windows in the selected fictional period");
const durations=new Map<string,number>();
let prior=0,midSeparation=0;
for(const x of first.inputs){
 assert.ok(x.captureAtMs>prior);prior=x.captureAtMs;
 assert.equal(x.captureAtMs-Date.parse(x.lastObserved5m),295000);
 assert.equal(x.decisionAtMs-x.captureAtMs,10000);
 assert.equal(x.pairs.length,5);
 const symbols=x.pairs.map(p=>p.symbol);
 assert.deepEqual(symbols,[...V52_NATIVE_STOCK_UNIVERSE]);
 assert.ok(["11:30","12:30","13:30"].includes(x.window));
 durations.set(x.window,(durations.get(x.window)??0)+1);
 for(const p of x.pairs){
   for(const [quote,at] of [[p.capture,x.captureAtMs],[p.decision,x.decisionAtMs]] as const){
      assert.ok(quote.referencePrice>0&&quote.asterMid>0);
      assert.ok(quote.asterBid<quote.asterMid&&quote.asterMid<quote.asterAsk);
      assert.ok(quote.depthUsd>0&&quote.spreadBps>0);
      assert.ok(quote.roundTripCostBps>0);
      assert.ok(at-quote.asterReceivedMs>=0&&at-quote.asterReceivedMs<=1500);
      assert.ok(at-quote.referenceReceivedMs>=0&&at-quote.referenceReceivedMs<=1500);
   }
   assert.notEqual(p.capture.referencePrice,p.decision.referencePrice,
      "Capture and decision must be separately sampled market source inputs");
   if(p.capture.asterMid!==p.capture.referencePrice)midSeparation++;
 }
}
assert.deepEqual([...durations.entries()].sort(),[
 ["11:30",13],["12:30",13],["13:30",13]
]);
assert.ok(midSeparation>100);
assert.ok(first.warning.includes("artificial"));
console.log("PASS modeled V52 two-source synthetic 39 windows, 195 books, 10s source chronology, no lookahead, deterministic and no fills");
