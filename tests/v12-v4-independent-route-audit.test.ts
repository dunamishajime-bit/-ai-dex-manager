import assert from "node:assert/strict";
import test from "node:test";
import {identifyFallbacks,evaluateIndependentV4RoutesReadOnly,type IndependentRouteVerdict} from "../lib/v12-v4-independent-route-audit";
const make=(route:string,qualified:boolean,deferred=false):IndependentRouteVerdict=>({
 route,qualified,deferred,admission:qualified?"PASSED_ROUTE_REPAIRS":"FIRST_PASS_REPAIR_FILTER",
 symbol:"BTCUSDT",eligibleEntryTs:0,sourceEngine:"buildV12Signals",
});
test("independent route audit exposes fallback after first rejected route",()=>{
 const r=identifyFallbacks([make("REC_X01_TIME_24H",false),make("REC_X02_TIME_36H",true),make("REC_X03_TIME_12H",true)],"REC_X01_TIME_24H");
 assert.equal(r.initialRejected,true);assert.equal(r.potentialFallbackCount,2);
 assert.deepEqual(r.viableFallbackRoutes,["REC_X02_TIME_36H","REC_X03_TIME_12H"]);
 assert.equal(r.actualOrderEligible,false);
});
test("qualified first route must not cause invented fallback",()=>{
 assert.equal(identifyFallbacks([make("A",true),make("B",true)],"A").potentialFallbackCount,0);
});
test("deferred first candidate is not a repair failure",()=>{
 assert.equal(identifyFallbacks([make("A",false,true),make("B",true)],"A").initialRejected,false);
});
const H=3600000;
const ts=480*H;
const series=Array.from({length:480},(_,i)=>{
 const v=100+i*0.025;
 return {openTs:i*H,open:v,high:v+0.2,low:v-0.2,close:v+0.01,
   volume:500,quoteVolume:v*500};
});
const source={
 symbol:"BTCUSDT",side:"LONG" as const,eligibleSourceEntryTs:ts,
 decisionTs:ts,momentumConditionAgeHours:0,
 sourceEngine:"buildV12Signals" as const,sourceParityVerified:true,
};
test("all 41 routes are individually checked with no orders from H2 source boundary",()=>{
 const d=evaluateIndependentV4RoutesReadOnly({source,decisionTs:ts,symbolBars:series,
   btcBars:series,activeRunnerSinceMs:ts-2*H});
 assert.equal(d.registeredRoutes,41);assert.equal(d.independentlyEvaluatedRoutes,41);
 assert.equal(d.verdicts.length,41);assert.equal(new Set(d.verdicts.map(x=>x.route)).size,41);
 assert.equal(d.tradingMutation,0);assert.equal(d.orderEnabled,false);
});
test("runner startup and downtime windows excluded from actual evaluation denominator",()=>{
 const before=evaluateIndependentV4RoutesReadOnly({source,decisionTs:ts,symbolBars:[],
   btcBars:[],activeRunnerSinceMs:ts+1});
 assert.equal(before.independentlyEvaluatedRoutes,0);
 const halted=evaluateIndependentV4RoutesReadOnly({source,decisionTs:ts,symbolBars:[],
   btcBars:[],activeRunnerSinceMs:0,excludedDowntime:[{fromMs:ts-1,toMs:ts+1}]});
 assert.equal(halted.independentlyEvaluatedRoutes,0);
});
test("H1 timestamps not aligned to the completed V4 H2 boundary fail closed",()=>{
 assert.throws(()=>evaluateIndependentV4RoutesReadOnly({source,decisionTs:ts+H,
  symbolBars:series,btcBars:series,activeRunnerSinceMs:0}),/V4_AUDIT_INVALID_H2_BOUNDARY/);
});
