import assert from "node:assert/strict";
import test from "node:test";
import {stable4UniPeerAdmissionView} from "../lib/stable4-uni-owner-evidence";
import type {V4PeerSource} from "../lib/v12-v4-peer-state-owners";
import {STABLE4_OPPORTUNITY_MODEL_VERSION} from "../lib/stable4-opportunity-corpus";

const sha="a".repeat(40),record={strategy:"Q102" as const,positionId:"native",sourceSha:sha,symbol:"UNIUSDT",side:"SHORT" as const,entryTs:1000,capturedAt:2000,score:.03,modelVersion:STABLE4_OPPORTUNITY_MODEL_VERSION};
function source():V4PeerSource{return{kind:"Q102",programSha:sha,raw:{position:undefined,pending:{reduceOnly:false,phase:"submitted",symbol:"UNIUSDT",side:"SELL",clientOrderId:"uni-cid",idempotencyKey:"native",referenceTs:1000,quantity:1,reason:"STABLE4_Q102_UNI_ONLINE_RECOVERY:PORTFOLIO_DD_GOVERNOR:NORMAL",entryOpportunity:record}}};}
test("pre-submit owner view excludes only exact own immutable unsent UNI pending without mutating durable view",()=>{
 const input=source(),foreign={...source(),kind:"FET" as const};
 const result=stable4UniPeerAdmissionView([input,foreign],record,"uni-cid");
 assert.equal(result[0].raw.pending,undefined);assert.ok(input.raw.pending);assert.equal(result[1],foreign);
});
test("foreign CIDs, modified scores, source mismatch, submitted position and ambiguous work never become empty owners",()=>{
 for(const patch of [{phase:"manual_review"},{clientOrderId:"foreign"},{reduceOnly:true},{referenceTs:2000},{quantity:"1"},{lastError:"HTTP_TIMEOUT"},{entryOpportunity:{...record,score:99}}]){
  const s=source();Object.assign(s.raw.pending,patch);assert.throws(()=>stable4UniPeerAdmissionView([s],record,"uni-cid"),/CONFLICT/);
 }
 for(const s of [{...source(),programSha:"b".repeat(40)},{...source(),raw:{...source().raw,position:{symbol:"UNIUSDT"}}}])assert.throws(()=>stable4UniPeerAdmissionView([s],record,"uni-cid"),/CONFLICT/);
});
