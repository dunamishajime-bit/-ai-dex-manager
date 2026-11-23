import test from "node:test";
import assert from "node:assert/strict";
import { evaluateV12V4DZeroGrossYield, type V4DYieldInput } from "../lib/v12-v4-d-tier-zero-gross-yield";

function data():V4DYieldInput {
 return {
  decisionTsMs:Date.UTC(2026,9,26,12),
  observedAtMs:Date.UTC(2026,9,26,12,5),
  higherCandidate:{
   strategyId:"Q102",route:"HIGH_VOL_SHORT",symbol:"SOLUSDT",priorityRank:3,
   requestedGross:.15,eligibleAfterAllNonCapacityGates:true,
   minVenueOrderFeasible:true,rankProven:true,blockedSolelyBySharedGross:true
  },
  shared:{applicableFreeGross:0,totalFreeGross:.25,strategyFreeGross:.5,
   fullyReconciledPendingAndOpenOrders:true,accountLeaseHeld:true,
   sharedRiskGreen:true,marginGuardGreen:true,killSwitchGreen:true,
   signedVenueSnapshot:true},
  protectedDLegs:[{
   legId:"AVAXUSDT:REC_G3_LATE_BTC_REL:SHORT:1",
   route:"REC_G3_LATE_BTC_REL",symbol:"AVAXUSDT",side:"SHORT",
   status:"OPEN",qty:10,acceptedGross:.25,priorityRank:38,
   entryTsMs:Date.UTC(2026,9,26,10),residentStopCertified:true,noPendingOrder:true
  }]
 };
}
test("zero shared Gross with all signed gates permits only a NO-ACTION proposal",()=>{
 const x=evaluateV12V4DZeroGrossYield(data());
 assert.equal(x.kind,"STAGED_HANDOFF_CANDIDATE_ONLY");
 if(x.kind==="STAGED_HANDOFF_CANDIDATE_ONLY"){
  assert.deepEqual(x.victimLegIds,["AVAXUSDT:REC_G3_LATE_BTC_REL:SHORT:1"]);
  assert.equal(x.estimatedGrossFreed,.25);
  assert.equal(x.venueMutationAuthorized,false);
 }
});
test("any positive applicable Gross, even 0.00001x, forbids a premature D close",()=>{
 for(const n of [.00001,.01,.14,.25]){
  const x=data();x.shared.applicableFreeGross=n;
  assert.deepEqual(evaluateV12V4DZeroGrossYield(x),{
   kind:"NO_YIELD",reason:"SHARED_GROSS_STILL_AVAILABLE",victimLegIds:[]});
 }
});
test("do not yield if entry is blocked by other non-capacity gates, expired or fails lot",()=>{
 const cases=[
  (x:V4DYieldInput)=>{x.higherCandidate.eligibleAfterAllNonCapacityGates=false},
  (x:V4DYieldInput)=>{x.higherCandidate.blockedSolelyBySharedGross=false},
  (x:V4DYieldInput)=>{x.higherCandidate.minVenueOrderFeasible=false},
  (x:V4DYieldInput)=>{x.higherCandidate.rankProven=false},
  (x:V4DYieldInput)=>{x.shared.strategyFreeGross=0},
  (x:V4DYieldInput)=>{x.shared.sharedRiskGreen=false},
  (x:V4DYieldInput)=>{x.shared.marginGuardGreen=false},
  (x:V4DYieldInput)=>{x.shared.killSwitchGreen=false},
  (x:V4DYieldInput)=>{x.shared.accountLeaseHeld=false},
  (x:V4DYieldInput)=>{x.shared.fullyReconciledPendingAndOpenOrders=false},
  (x:V4DYieldInput)=>{x.shared.signedVenueSnapshot=false},
  (x:V4DYieldInput)=>{x.observedAtMs=x.decisionTsMs+16*60000},
  (x:V4DYieldInput)=>{x.shared.totalFreeGross=-1},
  (x:V4DYieldInput)=>{x.shared.applicableFreeGross=.5}
 ];
 for(const edit of cases){
  const x=data();edit(x);
  const o=evaluateV12V4DZeroGrossYield(x);
  assert.equal(o.kind,"NO_YIELD");
  assert.deepEqual(o.victimLegIds,[]);
 }
});
test("only G3 X13 CONT are eligible lower-priority protected D victims",()=>{
 const routes=["REC_G3_LATE_BTC_REL","REC_X13_TP1.5_SL1_H24","CONT_SHORT_MID_AGE24_48"];
 for(const route of routes){
  const x=data();x.protectedDLegs[0].route=route;
  assert.equal(evaluateV12V4DZeroGrossYield(x).kind,"STAGED_HANDOFF_CANDIDATE_ONLY",route);
 }
 for(const route of ["REC_X14_TIME_48H","REC_Y15_REV_D0_T3","REC_Y18_REV_D2_T18","REC_X07_TIME_6H"]){
  const x=data();x.protectedDLegs[0].route=route;
  assert.equal(evaluateV12V4DZeroGrossYield(x).kind,"NO_YIELD",route);
 }
});
test("protect pending exit, STOP missing, opposing ownership and equal priority",()=>{
 const cases=[
  (x:V4DYieldInput)=>{x.protectedDLegs[0].residentStopCertified=false},
  (x:V4DYieldInput)=>{x.protectedDLegs[0].noPendingOrder=false},
  (x:V4DYieldInput)=>{x.protectedDLegs[0].status="PENDING_EXIT"},
  (x:V4DYieldInput)=>{x.protectedDLegs[0].symbol=x.higherCandidate.symbol},
  (x:V4DYieldInput)=>{x.protectedDLegs[0].priorityRank=x.higherCandidate.priorityRank},
  (x:V4DYieldInput)=>{x.protectedDLegs[0].qty=0},
  (x:V4DYieldInput)=>{x.protectedDLegs[0].entryTsMs=x.decisionTsMs}
 ];
 for(const change of cases){
  const x=data();change(x);
  assert.equal(evaluateV12V4DZeroGrossYield(x).kind,"NO_YIELD");
 }
});
test("insufficient eligible D capacity forbids forced sells; reject malformed wallet marks",()=>{
 const x=data();x.higherCandidate.requestedGross=.5;
 assert.equal(evaluateV12V4DZeroGrossYield(x).kind,"NO_YIELD");
 x.protectedDLegs=[...x.protectedDLegs,{...x.protectedDLegs[0],legId:"ETH2",acceptedGross:.30,symbol:"ETHUSDT",priorityRank:40}];
 const s=evaluateV12V4DZeroGrossYield(x);
 assert.equal(s.kind,"STAGED_HANDOFF_CANDIDATE_ONLY");
 if(s.kind==="STAGED_HANDOFF_CANDIDATE_ONLY")assert.deepEqual(s.victimLegIds,["ETH2",x.protectedDLegs[0].legId]);
});
