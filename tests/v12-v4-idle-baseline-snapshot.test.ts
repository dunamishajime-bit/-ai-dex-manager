import assert from "node:assert/strict";
import test from "node:test";
import {buildV4IdleBaselineSnapshot,buildV4RealtimeDecisionTelemetry,buildV4GateTelemetry} from "../scripts/v12-v4-production-runner";

const SHA="b".repeat(40);

test("V4 telemetry joins base observations and quote-qualified execution candidates without changing decisions",()=>{
 const candidate={symbol:"INJUSDT",effectiveSide:"SHORT",rank:24,route:"TEST_ROUTE"};
 const filtered={symbol:"AVAXUSDT",effectiveSide:"LONG",rank:7};
 const decision={decisionTs:1_700_000_000_000,capturedAtMs:1_700_000_010_000,
  candidateCount:1,filteredCount:1,sourceCount:1,sourceFingerprint:"f".repeat(64),
  candidates:[candidate],filtered:[filtered],
  observedCandidates:[{symbol:"INJ",side:"LONG",portfolioRank:1,score:0.3,signalReason:"ALLOW_STANDARD"}],
  nativeSources:[{source:{symbol:"INJUSDT",side:"LONG"},rank:1,score:0.3,entryGateReason:"ALLOW_STANDARD"}]};
 const before=JSON.stringify(decision);
 const prepared={kind:"READY" as const,preparedAtMs:decision.capturedAtMs,decision:decision as any};
 const result={status:"observing" as const,reason:"NO_FRESH_NON_DUPLICATE_CANDIDATE",eventTs:decision.capturedAtMs,candidateCount:1,orderEnabled:false};
 const telemetry=buildV4GateTelemetry(SHA,"FULL_LIVE",prepared,result) as any;
 assert.deepEqual(telemetry.symbols.map((row:any)=>row.symbol),["AVAXUSDT","INJUSDT"]);
 const inj=telemetry.symbols.find((row:any)=>row.symbol==="INJUSDT");
 assert.equal(inj.nativeSide,"LONG");
 assert.equal(inj.sourceEligible,true);
 assert.equal(inj.portfolioRank,1);
 assert.equal(inj.nativeScore,0.3);
 assert.equal(JSON.stringify(decision),before);
 const realtime=buildV4RealtimeDecisionTelemetry(SHA,"FULL_LIVE",prepared,result) as any;
 assert.deepEqual(realtime.candidates,[candidate]);
 assert.equal(realtime.candidates[0].effectiveSide,"SHORT");
 assert.deepEqual(realtime.filtered,[filtered]);
});

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

test("V4 realtime telemetry is fresh and pinned to the current runner SHA",()=>{
 const decision={schema:"v12-v4-live-decision/v1" as const,policyId:"V2_M150_D05_CORE_NATIVE" as any,
  decisionTs:1_700_000_000_000,capturedAtMs:1_700_000_010_000,sourceFingerprint:"f".repeat(64),
  candidateCount:1,filteredCount:0,sourceCount:1,nativeCoreEvents:[],entryAtrByCandidate:{},errors:[],
  orderEnabled:false as const,realOrderEnabledV4:0 as const,tradingMutation:0 as const,candidates:[{} as any],filtered:[]};
 const prepared={kind:"READY" as const,preparedAtMs:decision.capturedAtMs,decision};
 const result={status:"observing" as const,reason:"NO_NATIVE_ENTRY_CANDIDATES",eventTs:decision.capturedAtMs, candidateCount:1,orderEnabled:false};
 const sha="c".repeat(40);
 const realtime=buildV4RealtimeDecisionTelemetry(sha,"CANARY",prepared,result,decision.capturedAtMs+1_000);
 const gates=buildV4GateTelemetry(sha,"CANARY",prepared,result,decision.capturedAtMs+1_000);
 assert.equal(realtime.releaseSha,sha);
 assert.equal(realtime.sourceRuntimeSha,sha);
 assert.equal(realtime.stale,false);
 assert.equal(realtime.status,"observing");
 assert.equal(gates.releaseSha,sha);
 assert.equal(gates.activeRunnerSha,sha);
 assert.equal(gates.stale,false);
 assert.equal(gates.telemetryFresh,true);
});
