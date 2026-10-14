import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {V12_X1_ALL} from "../config/v12X1AllRuntime";
import {buildV4RunnerGateTelemetry} from "../lib/v12-v4-gate-telemetry";
import type {V4VenueH1Bar,V4LiveDecisionSnapshot} from "../lib/v12-v4-live-candidate-builder";
const H=3600000, H2=2*H, SHA="e8cc2e73f8d3981d708ee52f013241597c038b10";
const decisionTs=H2*260000, capturedAtMs=decisionTs+120000, first=decisionTs-500*H;
function fixture(){
 const bars:Record<string,V4VenueH1Bar[]>={};
 V12_X1_ALL.universe.forEach((symbol,si)=>{
  bars[symbol]=Array.from({length:500},(_,i)=>{
   const open=100+si*5+0.02*i,close=open+(si%2===0?0.03:-0.02);
   return {openTs:first+i*H,open,high:Math.max(open,close)+0.2,low:Math.min(open,close)-0.2,
     close,volume:100+i%8,quoteVolume:(100+i%8)*close};
  });
 });
 return bars;
}
function decision():V4LiveDecisionSnapshot{
 return {schema:"v12-v4-live-decision/v1",policyId:"V2_M150_D05_CORE_NATIVE" as V4LiveDecisionSnapshot["policyId"],
  decisionTs,capturedAtMs,sourceFingerprint:"a".repeat(64),candidateCount:0,filteredCount:0,sourceCount:0,
  nativeCoreEvents:[],entryAtrByCandidate:{},errors:[],candidates:[],filtered:[],
  orderEnabled:false,realOrderEnabledV4:0,tradingMutation:0};
}
test("exact production native gate functions create 14 read-only symbol observations",()=>{
 const result=buildV4RunnerGateTelemetry(fixture(),decision(),SHA,capturedAtMs+500);
 assert.equal(result.symbolCount,V12_X1_ALL.universe.length);
 assert.equal(result.symbols.length,14);
 assert.equal(result.activeRunnerSha,SHA);
 assert.equal(result.sourceFingerprint,"a".repeat(64));
 assert.equal(result.readOnly,true);assert.equal(result.tradingMutation,0);assert.equal(result.orderEnabled,false);
 assert.equal(result.symbols[0].symbol,"BTCUSDT");
 for(const row of result.symbols) {
  assert.equal(row.gates.length,5);
  assert.ok(row.gates.slice(0,4).every(g=>g.state==="PASS"||g.state==="BLOCK"));
  assert.equal(row.routeGate.state,"NOT_EVALUATED");
  assert.equal(row.sourceEligible===true||row.sourceEligible===false,true);
 }
});
test("stale/source mismatch and missing symbol fail closed without fake Gate results",()=>{
 const d=decision();d.decisionTs-=H2;
 assert.throws(()=>buildV4RunnerGateTelemetry(fixture(),d,SHA,capturedAtMs+500),/CLOCK_MISMATCH/);
 const missing=fixture();delete missing.ETH;
 assert.throws(()=>buildV4RunnerGateTelemetry(missing,decision(),SHA,capturedAtMs+500),/H1_MISSING/);
});
test("live execution's existing decision path remains untouched and observer failure is nonblocking",()=>{
 const runner=readFileSync("scripts/v12-v4-production-runner.ts","utf8");
 assert.match(runner,/cache=\{boundary,value\};/);
 assert.match(runner,/try\{await writeV4GateObserverArtifacts\(releaseSha,bars,value\);\}/);
 assert.match(runner,/catch\(error\)\{console\.error/);
 assert.doesNotMatch(runner,/writeV4GateObserverArtifacts\([\s\S]*?\.sendOrder\(/);
});
