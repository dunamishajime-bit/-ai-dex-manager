import test from "node:test";
import assert from "node:assert/strict";
import {certifyV4Production,V4_RANKING_CUTOFF_EXCLUSIVE_MS as cut} from "../lib/v12-v4-production-certification";
test("forward frozen ranking is temporally valid while observed PF and execution blockers still prevent promotion",()=>{
 const c=certifyV4Production({policyId:"V2_M150_D05_CORE_NATIVE",evaluatedAtMs:cut+1000,signalEntryTimesMs:[cut]});
 assert.equal(c.policyTemporalCausal,true);
 assert.ok(c.blockers.includes("OBSERVED_EXTERNAL_Y06_PF_FAILED"));
 assert.ok(!c.blockers.some(x=>x.startsWith("OBSERVED_DEVELOPMENT_DD_OVER")));
 assert.ok(c.blockers.includes("HOLD_PROTECTED_OR_HOLD_STATUS_UNKNOWN"));
 assert.equal(c.orderEnabled,false);assert.equal(c.realOrderEnabledV4,0);
});
test("replaying past entries at a present decision time retains full-year lookahead",()=>{
 const c=certifyV4Production({policyId:"V2_M150_D05_CORE_NATIVE",evaluatedAtMs:cut+1e9,signalEntryTimesMs:[cut-1]});
 assert.equal(c.policyTemporalCausal,false);
 assert.ok(c.blockers.includes("HISTORICAL_FULL_YEAR_RANKING_LOOKAHEAD_OR_NO_FORWARD_SIGNALS"));
});
test("1978 H1 native matches certify the price model only",()=>{
 const c=certifyV4Production({policyId:"V2_M150_D05_CORE_NATIVE",evaluatedAtMs:cut+1000,signalEntryTimesMs:[cut],
  nativeExitProof:{sourceRows:1978,matching:1978,mismatches:0,priceModelOnly:true}});
 assert.ok(!c.blockers.includes("NATIVE_EXIT_1978_EVENT_PARITY_NOT_VERIFIED"));
 assert.ok(c.blockers.includes("H1_PRICE_MODEL_IS_NOT_VENUE_EXIT_CERTIFICATION"));
});
test("stale account and payload flags cannot authorize orders; malformed evidence fails closed",()=>{
 const c=certifyV4Production({policyId:"V2_M150_D05_CORE_NATIVE",evaluatedAtMs:cut+60000,signalEntryTimesMs:[cut],
  account:{capturedAtMs:cut,holdProtected:true,pendingReconciled:true,ownerInventoryVerified:true,
    protectedPenguQty:7718,protectedTslaQty:.38,releaseCoherent:true,quoteFresh:true}});
 assert.ok(c.blockers.includes("FRESH_ACCOUNT_READBACK_REQUIRED"));
 assert.ok(c.blockers.includes("HOLD_PROTECTED_OR_HOLD_STATUS_UNKNOWN"));
 assert.ok(c.blockers.includes("SEPARATE_OPERATOR_ACTIVATION_REQUIRED"));
 assert.equal(c.tradingMutation,0);
 assert.throws(()=>certifyV4Production({policyId:"OTHER"} as any),/INVALID_CERTIFICATION_EVIDENCE/);
});

test("missing, nonfinite, fractional and nonnumeric sample counts retain proof blockers",()=>{
 for(const samples of [undefined,NaN,Infinity,-Infinity,"2",null,0,-1,1.5]) {
  const c=certifyV4Production({policyId:"V2_M150_D05_CORE_NATIVE",evaluatedAtMs:cut+1000,signalEntryTimesMs:[cut],
   nativeSignalProof:{sourceSha:"a".repeat(40),reportSha256:"b".repeat(64),samples,mismatches:0},
   venueQuantityAndFillProof:{reportSha256:"c".repeat(64),samples,mismatches:0,l2Verified:true}} as any);
  assert.ok(c.blockers.includes("NATIVE_SIGNAL_SOURCE_PARITY_NOT_CERTIFIED"),String(samples));
  assert.ok(c.blockers.includes("VENUE_QUANTITY_FILL_AND_L2_PARITY_REQUIRED"),String(samples));
 }
 const c=certifyV4Production({policyId:"V2_M150_D05_CORE_NATIVE",evaluatedAtMs:cut+1000,signalEntryTimesMs:[cut],
  nativeSignalProof:{sourceSha:"a".repeat(40),reportSha256:"b".repeat(64),samples:1,mismatches:0},
  venueQuantityAndFillProof:{reportSha256:"c".repeat(64),samples:1,mismatches:0,l2Verified:true}});
 assert.ok(!c.blockers.includes("NATIVE_SIGNAL_SOURCE_PARITY_NOT_CERTIFIED"));
 assert.ok(!c.blockers.includes("VENUE_QUANTITY_FILL_AND_L2_PARITY_REQUIRED"));
 assert.equal(c.orderEnabled,false);
});
test("offline proof payload cannot replace actual journal entry times or evaluation clock",async()=>{
 const {evaluateOfflineInput}=await import("../scripts/v12-v4-production-offline");
 const {createProductionState,planProductionEntry}=await import("../lib/v12-v4-production-lifecycle");
 const {evaluateV12V4Routes}=await import("../lib/v12-multilogic-v4-shadow");
 const initial={equityUsd:1000,foreign:[],holdProtected:false},ts=cut-2*3600000;
 const candidate=evaluateV12V4Routes({symbol:"ETHUSDT",sourceSide:"SHORT",sourceSignalTs:ts,age:2,volRatio:.5,er24:.5})
  .find(c=>c.route==="REC_X01_TIME_24H")!;
 const normalizer:any={normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p,stepSize:.01})};
 const r=await planProductionEntry(createProductionState(initial),{candidate,ts,eventId:"historical-reserve",referencePrice:100,
   minimumOrderNotionalUsd:5,quantityNormalizer:normalizer});
 const out=await evaluateOfflineInput({initial,journal:[r],certificationEvidence:{
  policyId:"V2_M150_D05_CORE_NATIVE",evaluatedAtMs:cut+1e9,signalEntryTimesMs:[cut],
  account:{capturedAtMs:cut+1e9,holdProtected:false,pendingReconciled:true,ownerInventoryVerified:true,
    protectedPenguQty:7718,protectedTslaQty:.38,releaseCoherent:true,quoteFresh:true}}});
 assert.equal(out.certification.policyTemporalCausal,false);
 assert.equal(out.certification.evaluatedAtMs,ts);
 assert.deepEqual(out.certification.signalEntryTimesMs,[ts]);
 assert.ok(out.certification.blockers.includes("FRESH_ACCOUNT_READBACK_REQUIRED"));
 assert.equal(out.certification.orderEnabled,false);
 const empty=await evaluateOfflineInput({initial,certificationEvidence:{
  policyId:"V2_M150_D05_CORE_NATIVE",evaluatedAtMs:cut+1e9,signalEntryTimesMs:[cut]}});
 assert.equal(empty.certification.policyTemporalCausal,false);
 assert.deepEqual(empty.certification.signalEntryTimesMs,[]);
});
