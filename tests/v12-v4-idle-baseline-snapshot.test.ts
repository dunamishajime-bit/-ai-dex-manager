import assert from "node:assert/strict";
import test from "node:test";
import {buildV4IdleBaselineSnapshot} from "../scripts/v12-v4-production-runner";

const SHA="b".repeat(40);

test("V4 Idle baseline snapshot exposes current decision time and candidate acceptance",()=>{
 const decision={schema:"v12-v4-live-decision/v1" as const,policyId:"V2_M150_D05_CORE_NATIVE" as any,
  decisionTs:1_700_000_000_000,capturedAtMs:1_700_000_010_000,sourceFingerprint:"f".repeat(64),
  candidateCount:1,filteredCount:0,sourceCount:1,nativeCoreEvents:[],entryAtrByCandidate:{},errors:[],
  orderEnabled:false as const,realOrderEnabledV4:0 as const,tradingMutation:0 as const,candidates:[{} as any],filtered:[]};
 const snapshot=buildV4IdleBaselineSnapshot(SHA,{kind:"READY",preparedAtMs:decision.capturedAtMs,decision},decision.capturedAtMs+1_000);
 assert.equal(snapshot.sourceComplete,true);
 assert.equal(snapshot.decisionTs,decision.decisionTs);
 assert.equal(snapshot.candidateCount,1);
 assert.equal(snapshot.reason,"SIGNAL_AVAILABLE");
});

test("V4 Idle baseline snapshot fails closed when market preparation failed",()=>{
 const snapshot=buildV4IdleBaselineSnapshot(SHA,{kind:"FAILED",preparedAtMs:1_700_000_000_000,reason:"RATE_BUDGET"},1_700_000_001_000);
 assert.equal(snapshot.sourceComplete,false);
 assert.equal(snapshot.candidateCount,0);
 assert.equal(snapshot.decisionTs,undefined);
});
