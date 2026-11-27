import test from "node:test";import assert from "node:assert/strict";
import {assertIdleR26EntryCertificate,IDLE_R26_ENTRY_CERT_SCHEMA} from "../lib/idle-r26-entry-certificate";
const sha="a".repeat(40);
const c={schema:IDLE_R26_ENTRY_CERT_SCHEMA,approvedSha:sha,ownerAcknowledgement:"APPROVE_IDLE_R26_AT_EXACT_SHA",
policy:"IDLE_R26_REMOVE_RENDER_TAO12H_JUP_REL24_VOL",candidateRegenerated:849,eligibleReference:197,
nativeMarketSourceParity:true,historicalDataCoverageVerified:true,
fullAccount10And30BpsVerified:true,syntheticNativeReplayVerified:true,
dd30AndStopProtectionVerified:true,rootReviewApproved:true,signedIssuerEvidenceSha256:"b".repeat(64)};
test("R26 requires all independent approvals and pinned source",()=>{
 assert.equal(assertIdleR26EntryCertificate(c,sha).approvedSha,sha);
 for(const field of Object.keys(c)){
  const copy={...c,[field]:field==="approvedSha"?"f".repeat(40):false};
  assert.throws(()=>assertIdleR26EntryCertificate(copy,sha),/NOT_FORMALLY_PROVEN/);
 }
});
test("no certification by ordinary SHA, mutable contents, missing validation",()=>{
 assert.throws(()=>assertIdleR26EntryCertificate(c,"broken"),/INVALID/);
 assert.throws(()=>assertIdleR26EntryCertificate({},sha),/NOT_FORMALLY_PROVEN/);
});
