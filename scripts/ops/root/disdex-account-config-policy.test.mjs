import {test} from "node:test";
import assert from "node:assert/strict";
import {configurationPlan} from "./disdex-account-config-policy.mjs";
const row=(x={})=>({symbol:"FILUSDT",positionAmt:"0",leverage:"20",marginType:"cross",...x});
test("flat wrong leverage corrected",()=>assert.deepEqual(configurationPlan(["FILUSDT"],[row()],[]),[{symbol:"FILUSDT",marginChange:false,leverageChange:true}]));
test("healthy no changes",()=>assert.deepEqual(configurationPlan(["FILUSDT"],[row({leverage:"5"})],[]),[]));
test("live exposure forbids changes",()=>assert.throws(()=>configurationPlan(["FILUSDT"],[row({positionAmt:"1"})],[]),/EXPOSURE/));
test("pending exchange order forbids changes",()=>assert.throws(()=>configurationPlan(["FILUSDT"],[row()],[{symbol:"FILUSDT"}]),/EXPOSURE/));
test("hedge opposite exposure forbids changes",()=>assert.throws(()=>configurationPlan(["FILUSDT"],[row(),row({positionAmt:"-1",leverage:"5"})],[]),/EXPOSURE/));
test("missing symbol forbids guessing",()=>assert.throws(()=>configurationPlan(["FILUSDT"],[],[]),/MISSING/));
test("invalid position forbids guessing",()=>assert.throws(()=>configurationPlan(["FILUSDT"],[row({positionAmt:"NaN"})],[]),/INVALID/));
test("isolated explicit conversion only when flat",()=>assert.deepEqual(configurationPlan(["FILUSDT"],[row({leverage:"5",marginType:"isolated"})],[]),[{symbol:"FILUSDT",marginChange:true,leverageChange:false}]));

for (const value of [null,""," ",undefined]) test("unknown position "+String(value)+" fails closed",()=>assert.throws(()=>configurationPlan(["FILUSDT"],[row({positionAmt:value})],[]),/INVALID/));
for (const value of [null,""," ",undefined,0,-1]) test("invalid leverage "+String(value)+" fails closed",()=>assert.throws(()=>configurationPlan(["FILUSDT"],[row({leverage:value})],[]),/INVALID/));

import {hasUnresolvedIntent} from "./disdex-account-config-policy.mjs";
const reg=(status="RELEASED")=>({schema:"disdex-pending-exposure/v1",accountScope:"ASTER_FUTURES",entries:[{status}]});
for(const status of ["PENDING","SUBMITTED","UNKNOWN"]) test(status+" prevents configuration",()=>assert.equal(hasUnresolvedIntent(reg(status),[]),true));
test("released intents allow configuration",()=>assert.equal(hasUnresolvedIntent(reg(),[{pending:null}]),false));
test("nested runner pending prevents configuration",()=>assert.equal(hasUnresolvedIntent(reg(),[{position:{pendingOrder:{phase:"submitted"}}}]),true));
test("manual review prevents configuration",()=>assert.equal(hasUnresolvedIntent(reg(),[{manualReview:true}]),true));
test("malformed registry fails closed",()=>assert.throws(()=>hasUnresolvedIntent({},[]),/INVALID/));

for(const value of [false,true,[],[0],{}]) test("nonnumeric type "+JSON.stringify(value)+" rejects amount and leverage",()=>{assert.throws(()=>configurationPlan(["FILUSDT"],[row({positionAmt:value})],[]),/INVALID/);assert.throws(()=>configurationPlan(["FILUSDT"],[row({leverage:value})],[]),/INVALID/);});
