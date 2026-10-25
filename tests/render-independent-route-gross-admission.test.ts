import test from "node:test";
import assert from "node:assert/strict";
import {evaluateIdleLiveAdmission, idleRouteRequestedGross} from "../lib/idle-priority-short-live";
import {RENDER_INDEPENDENT_ROUTE, RENDER_ENTRY_POLICY} from "../lib/render-highwr-and-legacy-stop";
import {independentRenderProtectionPlan,independentRenderExitAt} from "../lib/render-independent-execution-contract";

const t=Date.UTC(2026,9,26,3,0,0);
function input(){
 return {symbol:"RENDERUSDT" as const,route:RENDER_INDEPENDENT_ROUTE,runtimeMode:"LIVE" as const,
 operatorArmed:true,candidateAccepted:true,candidateSide:"SHORT" as const,decisionTs:t,baselineDecisionTs:t,
 baselineFresh:true,baselineSourceComplete:true,baselineOpenPositions:0,baselinePendingExposure:0,
 baselineAcceptedThisTimestamp:0,nonBaselineCryptoExposure:0,nonBaselinePendingExposure:0,
 sharedRiskHealthy:true,marginGuardHealthy:true,killSwitchActive:false,venueFiveXCrossConfirmed:true,
 fullCryptoGrossAvailable:3,fullTotalGrossAvailable:4.25,sameSymbolIdleActive:false};
}
test("independent real settings are 0.75 gross, 5x cross, 6h, TP2.5%, SL2%",()=>{
 assert.equal(RENDER_ENTRY_POLICY.independentRequestedGross,.75);
 assert.equal(RENDER_ENTRY_POLICY.independentVenueLeverage,5);
 assert.equal(RENDER_ENTRY_POLICY.independentRealMaxMinutes,360);
 const p=independentRenderProtectionPlan({symbol:"RENDERUSDT",route:RENDER_INDEPENDENT_ROUTE,signalTs:t,entryPrice:100,quantity:5});
 assert.equal(p.stopPrice,102);assert.equal(p.takeProfitPrice,97.5);
 assert.equal(independentRenderExitAt(t),t+21_600_000);
});
test("independent admission requires 0.75 free capacity, while legacy stays 0.25",()=>{
 assert.equal(idleRouteRequestedGross("RENDERUSDT",RENDER_INDEPENDENT_ROUTE),.75);
 assert.equal(idleRouteRequestedGross("RENDERUSDT","IDLE_RENDER_RELATIVE_SHORT"),.25);
 assert.deepEqual(evaluateIdleLiveAdmission(input()),{accepted:true,reason:"IDLE_LIVE_ADMISSION_ACCEPTED",gross:.75});
 const reduced=evaluateIdleLiveAdmission({...input(),fullCryptoGrossAvailable:.63});
 assert.deepEqual(reduced,{accepted:true,reason:"IDLE_RENDER_INDEPENDENT_CAPACITY_REDUCED",gross:.63});
 const noRoom=evaluateIdleLiveAdmission({...input(),fullCryptoGrossAvailable:.24});
 assert.equal(noRoom.accepted,false);assert.match(noRoom.reason,/GROSS_CAPACITY_UNAVAILABLE/);
 assert.equal(evaluateIdleLiveAdmission({...input(),route:"IDLE_RENDER_RELATIVE_SHORT",fullCryptoGrossAvailable:.30}).accepted,true);
});
test("new independent never overrides owner, same-H1 baseline accepted, risk or 5x",()=>{
 const cases=[
  {sameSymbolIdleActive:true}, {baselineOpenPositions:1}, {baselineAcceptedThisTimestamp:1},
  {sharedRiskHealthy:false}, {marginGuardHealthy:false}, {killSwitchActive:true},
  {venueFiveXCrossConfirmed:false}, {operatorArmed:false}
 ];
 for (const update of cases){
  assert.equal(evaluateIdleLiveAdmission({...input(),...update}).accepted,false,JSON.stringify(update));
 }
});
