import test from "node:test";
import assert from "node:assert/strict";
import {DISDEX_STABLE4_OPPORTUNITY} from "../config/disdexStable4Opportunity";
import {assertStable4EntryGrossAdmission} from "../lib/stable4-entry-gross-guard";
import {emptyPendingExposureRegistry} from "../lib/disdex-pending-exposure-registry";
test("operator approved original research gross contract",()=>{
 assert.equal(DISDEX_STABLE4_OPPORTUNITY.productionRisk.stockGrossCap,4);
 assert.equal(DISDEX_STABLE4_OPPORTUNITY.productionRisk.totalGrossCap,4.25);
 assert.equal((DISDEX_STABLE4_OPPORTUNITY.productionRisk as any).v4TotalGrossCap,4.75);
});
test("V4-only total exception cannot expand ordinary entries",()=>{
 const now=Date.now(),input={now,account:{equityUsd:100,observedAt:now},positions:[{symbol:"NVDAUSDT",quantity:3.5,markPrice:100,observedAt:now}],pending:emptyPendingExposureRegistry(now),candidate:{symbol:"SOLUSDT",notionalUsd:125}};
 assert.throws(()=>assertStable4EntryGrossAdmission(input),/TOTAL_CAP/);
 assert.equal(assertStable4EntryGrossAdmission({...input,candidate:{...input.candidate,v4ReservationVerified:true}} as any).after.totalGross,4.75);
 assert.throws(()=>assertStable4EntryGrossAdmission({...input,candidate:{...input.candidate,notionalUsd:125.01,v4ReservationVerified:true}} as any),/TOTAL_CAP/);
});
