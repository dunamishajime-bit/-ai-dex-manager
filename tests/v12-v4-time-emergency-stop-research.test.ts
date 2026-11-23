import test from "node:test";
import assert from "node:assert/strict";
import {PRODUCTION_EXIT_CATALOG} from "../lib/v12-v4-production-lifecycle";
import {previewV4TimeEmergencyStop,V12_V4_TIME_EMERGENCY_RESEARCH_ID} from "../lib/v12-v4-time-emergency-stop-research";
test("all and only the 37 TIME routes have research-only 8% preview",()=>{
 const t=PRODUCTION_EXIT_CATALOG.filter(x=>x.spec.kind==="TIME");
 assert.equal(t.length,37);assert.equal(PRODUCTION_EXIT_CATALOG.length,41);
 for(const row of t){
  const short=previewV4TimeEmergencyStop({
   route:row.route,symbol:"BTCUSDT",side:"SHORT",entryFillPrice:100,policyId:V12_V4_TIME_EMERGENCY_RESEARCH_ID});
  const long=previewV4TimeEmergencyStop({
   route:row.route,symbol:"BTCUSDT",side:"LONG",entryFillPrice:100,policyId:V12_V4_TIME_EMERGENCY_RESEARCH_ID});
  assert.equal(short.tentativeStopPrice,108);
  assert.equal(long.tentativeStopPrice,92);
  assert.equal(short.orderEnabled,false);
  assert.equal(long.protectiveOrderPermitted,false);
 }
 for(const row of PRODUCTION_EXIT_CATALOG.filter(x=>x.spec.kind!=="TIME")){
  assert.throws(()=>previewV4TimeEmergencyStop({route:row.route,symbol:"BTCUSDT",side:"LONG",
   entryFillPrice:100,policyId:V12_V4_TIME_EMERGENCY_RESEARCH_ID}),/NOT_TIME_ROUTE/);
 }
});
test("an invalid or unapproved policy string cannot generate a research STOP quote",()=>{
 const route=PRODUCTION_EXIT_CATALOG.find(x=>x.spec.kind==="TIME")!.route;
 assert.throws(()=>previewV4TimeEmergencyStop({
  route,symbol:"BTCUSDT",side:"LONG",entryFillPrice:100,policyId:"UNAPPROVED" as any
 }),/NOT_RESEARCH_V1/);
 assert.throws(()=>previewV4TimeEmergencyStop({
  route,symbol:"BTCUSDT",side:"LONG",entryFillPrice:0,policyId:V12_V4_TIME_EMERGENCY_RESEARCH_ID
 }),/SIGNED_FILL_REQUIRED/);
});
