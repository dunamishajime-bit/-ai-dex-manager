import test from "node:test";
import assert from "node:assert/strict";
import {assertRenderLegacyAdverseCert,RENDER_LEGACY_ADVERSE_CERT_SCHEMA} from "../lib/render-legacy-adverse-cert";
const sha="abcdef0123456789abcdef0123456789abcdef01";
const cert={
 schema:RENDER_LEGACY_ADVERSE_CERT_SCHEMA, approvedSha:sha,
 route:"IDLE_RENDER_RELATIVE_SHORT",
 adverseTouchPct:-1,watchMinutes:120,maxFavorableExcursionPct:.25,
 entryFillTimestampVerified:true,firstClosedM5CompletenessVerified:true,
 preEntryAndPartialFillMfeCoverageVerified:true,protectedReduceOnlyCloseVerified:true,
 stopAndTakeProfitUnchangedVerified:true,restartPersistenceVerified:true,
 operatorApproval:"APPROVE_RENDER_LEGACY_ADVERSE_AT_BOUND_SHA"
};
test("legacy adverse cert requires exact bound SHA and all venue proofs",()=>{
 assert.doesNotThrow(()=>assertRenderLegacyAdverseCert(cert,sha));
 assert.throws(()=>assertRenderLegacyAdverseCert(cert,"ffffffffffffffffffffffffffffffffffffffff"),/UNPROVEN/);
 for(const k of ["entryFillTimestampVerified","firstClosedM5CompletenessVerified",
  "preEntryAndPartialFillMfeCoverageVerified","protectedReduceOnlyCloseVerified",
  "stopAndTakeProfitUnchangedVerified","restartPersistenceVerified"] as const){
  assert.throws(()=>assertRenderLegacyAdverseCert({...cert,[k]:false},sha),/UNPROVEN/,k);
 }
});
test("a forged or route-confused legacy certificate cannot activate",()=>{
 assert.throws(()=>assertRenderLegacyAdverseCert({...cert,watchMinutes:60},sha),/UNPROVEN/);
 assert.throws(()=>assertRenderLegacyAdverseCert({...cert,route:"INDEPENDENT_RENDER"},sha),/UNPROVEN/);
 assert.throws(()=>assertRenderLegacyAdverseCert(null,sha),/MALFORMED/);
});
