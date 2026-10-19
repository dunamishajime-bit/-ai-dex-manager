import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateIdleLiveAdmission } from "../lib/idle-priority-short-live";

const baseline = () => ({
    symbol: "TAOUSDT" as const,
    runtimeMode: "LIVE" as const,
    operatorArmed: true,
    candidateAccepted: true,
    candidateSide: "SHORT" as const,
    decisionTs: 1_792_410_000_000,
    baselineDecisionTs: 1_792_410_000_000,
    baselineFresh: true,
    baselineSourceComplete: true,
    baselineOpenPositions: 0,
    baselinePendingExposure: 0,
    baselineAcceptedThisTimestamp: 0,
    nonBaselineCryptoExposure: 0,
    nonBaselinePendingExposure: 0,
    sharedRiskHealthy: true,
    marginGuardHealthy: true,
    killSwitchActive: false,
    venueFiveXCrossConfirmed: true,
    fullCryptoGrossAvailable: 1,
    fullTotalGrossAvailable: 1,
    sameSymbolIdleActive: false,
    allowPartialGross: true,
    minimumPartialGross: 0.25,
});
test("ATR25 version admits 0.5x residual capacity instead of rejecting all",()=>{
    const v=evaluateIdleLiveAdmission({...baseline(),fullCryptoGrossAvailable:0.5});
    assert.equal(v.accepted,true);assert.equal(v.gross,0.5);
    assert.equal(v.reason,"IDLE_LIVE_ADMISSION_PARTIAL_CAPACITY");
});
test("original admission without opt-in remains strict full-1x",()=>{
    const {allowPartialGross,minimumPartialGross,...x}=baseline();
    const v=evaluateIdleLiveAdmission({...x,fullCryptoGrossAvailable:0.5});
    assert.equal(v.accepted,false);assert.equal(v.gross,0);
});
test("less than 0.25x cannot be rounded up and is rejected",()=>{
    const v=evaluateIdleLiveAdmission({...baseline(),fullCryptoGrossAvailable:0.249});
    assert.equal(v.accepted,false);assert.equal(v.gross,0);
});
test("baseline ownership veto still blocks new version",()=>{
    const v=evaluateIdleLiveAdmission({...baseline(),fullCryptoGrossAvailable:0.5,baselineOpenPositions:1});
    assert.equal(v.accepted,false);assert.equal(v.reason,"BASELINE_OPEN_OR_PENDING");
});
test("shared loss-risk latch still blocks before partial capacity",()=>{
    const v=evaluateIdleLiveAdmission({...baseline(),fullCryptoGrossAvailable:0.5,sharedRiskHealthy:false});
    assert.equal(v.accepted,false);assert.equal(v.reason,"SHARED_RISK_NOT_HEALTHY");
});
test("sidecar exposure veto remains intact",()=>{
    const v=evaluateIdleLiveAdmission({...baseline(),fullCryptoGrossAvailable:0.5,nonBaselineCryptoExposure:0.3});
    assert.equal(v.accepted,false);assert.equal(v.reason,"NON_BASELINE_SIDECAR_EXPOSURE");
});
test("same timestamp acceptance veto stays intact",()=>{
    const v=evaluateIdleLiveAdmission({...baseline(),baselineAcceptedThisTimestamp:1});
    assert.equal(v.accepted,false);assert.equal(v.reason,"BASELINE_ACCEPTED_SAME_TIMESTAMP");
});
