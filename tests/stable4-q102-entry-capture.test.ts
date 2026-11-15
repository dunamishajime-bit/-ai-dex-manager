import assert from "node:assert/strict";
import test from "node:test";
import {stable4Q102EntryCapture} from "../lib/stable4-q102-entry-capture";
import type {Quality102CausalV1Signal} from "../lib/disdex-quality102-causal-v1-signal";
const now=1800000000000,H=3600000;
const rows=Array.from({length:400},(_,i)=>({timestampMs:now-(400-i)*H,open:1,high:i===399?2:1,low:1,close:i===399?2:1,quoteVolume:100,baseVolume:100}));
const signal:Quality102CausalV1Signal={strategyId:"QUALITY102_CAUSAL_V1",referenceTs:now,side:-1,symbol:"UNIUSDT",family:"MR",variant:"MR72_Z1.5_H24",layer:"S3",requestedGross:.75,reason:"STABLE4_Q102_UNI_ONLINE_RECOVERY",dataCutoffTs:now-H,maxHoldHours:24,brkEnabled:false};
const input=()=>({signal,history:{candlesBySymbol:{UNIUSDT:rows},entryOpenBySymbol:{UNIUSDT:{timestampMs:now,open:2}}},sourceSha:"a".repeat(40),positionId:"native-cid",capturedAt:now+1});
test("Q102 entry capture recomputes causal native S34 features, preserving route and logical reference",()=>{
 const c=stable4Q102EntryCapture(input());
 assert.equal(c.route,"UNI|MR72_Z1.5_H24");assert.equal(c.logicalEntryTs,now);assert.equal(c.nativePositionId,"native-cid");assert.equal(c.gross,.75);
 assert.equal((c.entrySnapshot as any).ret14,1);assert.ok((c.entrySnapshot as any).strength>1.5);
 assert.throws(()=>stable4Q102EntryCapture({...input(),signal:{...signal,side:1}}),/NATIVE_SIGNAL_CONFLICT/);
});
test("independent AVAX and high-vol preserve their exact native routes without fabricated S34 features",()=>{
 const c=stable4Q102EntryCapture({...input(),signal:{...signal,symbol:"AVAXUSDT",variant:"STABLE4_ONLINE_KNN_Q01365",reason:"STABLE4_Q102_AVAX_ONLINE_KNN"}});
 assert.equal(c.route,"Q102_AVAX_ONLINE_KNN_STOP5_TP3_Q01365");assert.deepEqual(c.entrySnapshot,{});
 const h=stable4Q102EntryCapture({...input(),signal:{...signal,symbol:"APTUSDT",family:"HIGH_VOL"}});assert.equal(h.route,"HIGH_VOL|APTUSDT");assert.deepEqual(h.entrySnapshot,{});
});
