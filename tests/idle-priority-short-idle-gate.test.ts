import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIdlePriorityAdmission } from "../lib/idle-priority-short-idle-gate";

const ok={baselineOpenPositions:0,baselineAcceptedThisTimestamp:0,baselinePendingExposure:0,nonBaselineCryptoExposure:0,nonBaselinePendingExposure:0,sharedSafetyPass:true,fullGrossAvailable:1,venueFiveXCrossConfirmed:true};

test("baseline five win a same-timestamp acceptance",()=>assert.equal(evaluateIdlePriorityAdmission({...ok,baselineAcceptedThisTimestamp:1}).reason,"BASELINE_ACCEPTED_SAME_TIMESTAMP"));
test("open baseline position means account is not idle",()=>assert.equal(evaluateIdlePriorityAdmission({...ok,baselineOpenPositions:1}).accepted,false));
test("baseline pending exposure fails closed",()=>assert.equal(evaluateIdlePriorityAdmission({...ok,baselinePendingExposure:0.1}).accepted,false));
test("HYPE or other non-baseline crypto sidecar blocks new Idle",()=>assert.equal(evaluateIdlePriorityAdmission({...ok,nonBaselineCryptoExposure:0.1}).reason,"NON_BASELINE_SIDECAR_EXPOSURE"));
test("0.5 residual capacity skips instead of partial sizing",()=>assert.deepEqual(evaluateIdlePriorityAdmission({...ok,fullGrossAvailable:0.5}),{accepted:false,reason:"FULL_1X_CAPACITY_UNAVAILABLE",gross:0}));
test("5x Cross readback is mandatory",()=>assert.equal(evaluateIdlePriorityAdmission({...ok,venueFiveXCrossConfirmed:false}).accepted,false));
test("clean idle state admits exactly 1.00x",()=>assert.deepEqual(evaluateIdlePriorityAdmission(ok),{accepted:true,reason:"IDLE_ADMISSION_ACCEPTED",gross:1}));
