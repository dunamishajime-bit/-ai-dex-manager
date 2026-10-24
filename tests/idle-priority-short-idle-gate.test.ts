import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIdlePriorityAdmission } from "../lib/idle-priority-short-idle-gate";

const ok={baselineOpenPositions:0,baselineAcceptedThisTimestamp:0,baselinePendingExposure:0,nonBaselineCryptoExposure:0,nonBaselinePendingExposure:0,sharedSafetyPass:true,fullGrossAvailable:1,venueFiveXCrossConfirmed:true};

test("baseline five win a same-timestamp acceptance",()=>assert.equal(evaluateIdlePriorityAdmission({...ok,baselineAcceptedThisTimestamp:1}).reason,"BASELINE_ACCEPTED_SAME_TIMESTAMP"));
test("baseline positions and pending exposure are not standalone admission stops",()=>assert.equal(evaluateIdlePriorityAdmission({...ok,baselineOpenPositions:1,baselinePendingExposure:0.1}).accepted,true));
test("non-baseline exposure remains eligible when gross capacity is available",()=>assert.equal(evaluateIdlePriorityAdmission({...ok,nonBaselineCryptoExposure:0.1}).accepted,true));
test("legacy gate still rejects insufficient full gross when no allocator result is supplied",()=>assert.deepEqual(evaluateIdlePriorityAdmission({...ok,fullGrossAvailable:0.5}),{accepted:false,reason:"FULL_1X_CAPACITY_UNAVAILABLE",gross:0}));
test("5x Cross readback is mandatory",()=>assert.equal(evaluateIdlePriorityAdmission({...ok,venueFiveXCrossConfirmed:false}).accepted,false));
test("clean idle state admits exactly 1.00x",()=>assert.deepEqual(evaluateIdlePriorityAdmission(ok),{accepted:true,reason:"IDLE_ADMISSION_ACCEPTED",gross:1}));
