import assert from "node:assert/strict";
import test from "node:test";
import {assertStable4UniFinalAdmission} from "../lib/stable4-uni-final-admission";
import {STABLE4_OPPORTUNITY_MODEL_VERSION} from "../lib/stable4-opportunity-corpus";

const now=1800000000000,sha="a".repeat(40);
const candidate={strategy:"Q102" as const,positionId:"native-uni",sourceSha:sha,symbol:"UNIUSDT",side:"SHORT" as const,entryTs:now-1000,capturedAt:now,score:.0376,modelVersion:STABLE4_OPPORTUNITY_MODEL_VERSION};
const baseline={...candidate,strategy:"V52" as const,positionId:"actual-nvda",symbol:"NVDAUSDT",side:"LONG" as const,score:.0113};
const snapshot=()=>({book:{schemaVersion:1 as const,records:[baseline]},owners:{complete:true,observedAt:now,positions:[{strategy:baseline.strategy,positionId:baseline.positionId,symbol:baseline.symbol,side:baseline.side,entryTs:baseline.entryTs,quantity:1}]}});
const signed=[{symbol:"NVDAUSDT",quantity:1}];
test("final UNI admission reads actual active entry book and compares fresh full signed positions",async()=>{
 let reads=0;
 await assertStable4UniFinalAdmission({candidate,readOwners:async()=>{reads++;return snapshot();}}, {sourceSha:sha,symbol:"UNIUSDT",side:"SELL",now:()=>now,positionsObservedAt:now,positions:signed});
 assert.equal(reads,1);
 await assert.rejects(assertStable4UniFinalAdmission({candidate:{...candidate,score:.0113},readOwners:async()=>snapshot()}, {sourceSha:sha,symbol:"UNIUSDT",side:"SELL",now:()=>now,positionsObservedAt:now,positions:signed}),/CANDIDATE_NOT_STRICTLY_BETTER/);
});
test("missing active provenance, foreign inventory, wrong order identity and stale signed reads block before send",async()=>{
 const context={sourceSha:sha,symbol:"UNIUSDT",side:"SELL" as const,now:()=>now,positionsObservedAt:now,positions:signed};
 for(const evidence of [{...snapshot(),owners:{...snapshot().owners,complete:false}},{...snapshot(),book:{schemaVersion:1 as const,records:[]}}])await assert.rejects(assertStable4UniFinalAdmission({candidate,readOwners:async()=>evidence},context),/STABLE4_UNI_FINAL/);
 for(const patch of [{symbol:"BTCUSDT"},{sourceSha:"b".repeat(40)},{side:"BUY" as const},{positionsObservedAt:now-120001},{positions:[...signed,{symbol:"ETHUSDT",quantity:-1}]}])await assert.rejects(assertStable4UniFinalAdmission({candidate,readOwners:async()=>snapshot()},{...context,...patch}),/STABLE4_UNI_FINAL/);
});
test("slow owner replay cannot redate the SDK's earlier signed snapshot",async()=>{
 let clock=now;
 await assert.rejects(assertStable4UniFinalAdmission({candidate,readOwners:async()=>{clock+=120001;return{...snapshot(),owners:{...snapshot().owners,observedAt:clock}};}},{sourceSha:sha,symbol:"UNIUSDT",side:"SELL",now:()=>clock,positionsObservedAt:now,positions:signed}),/SIGNED_STALE/);
});
