import test from "node:test";
import assert from "node:assert/strict";
import {PRODUCTION_EXIT_CATALOG} from "../lib/v12-v4-production-lifecycle";
import {V12_V4_TIME_EMERGENCY_RESEARCH_ID} from "../lib/v12-v4-time-emergency-stop-research";
import {approvedV4TimeStopQuote,validateV4TimeApproval,readV4TimeStopApproval} from "../lib/v12-v4-time-stop-approval";
test("exact SHA and operator acknowledgement are mandatory; no implicit research activation",()=>{
 const sha="a".repeat(40),time=new Date().toISOString();
 const value={schema:"disdex-v12-v4-time-stop-approval/v1",
 approvedSha:sha,approvedAt:time,routeCount:37,policyId:V12_V4_TIME_EMERGENCY_RESEARCH_ID,
 operatorAcknowledgement:"I_APPROVE_V12_V4_TIME37_FIXED8_EMERGENCY_STOP"};
 assert.throws(()=>validateV4TimeApproval({...value,operatorAcknowledgement:""},sha),/APPROVAL_REQUIRED/);
 assert.throws(()=>validateV4TimeApproval(value,"b".repeat(40)),/APPROVAL_REQUIRED/);
 assert.throws(()=>validateV4TimeApproval({...value,routeCount:36},sha),/APPROVAL_REQUIRED/);
 const approved=validateV4TimeApproval(value,sha);
 for(const e of PRODUCTION_EXIT_CATALOG){
  if(e.spec.kind==="TIME"){
   assert.equal(approvedV4TimeStopQuote({approval:approved,route:e.route,side:"LONG",signedAverageEntryFill:100}),92);
   assert.equal(approvedV4TimeStopQuote({approval:approved,route:e.route,side:"SHORT",signedAverageEntryFill:100}),108);
  }else assert.throws(()=>approvedV4TimeStopQuote({approval:approved,route:e.route,
   side:"LONG",signedAverageEntryFill:100}),/CONTRACT_INVALID/);
 }
});
test("cannot redirect operator approval to an untrusted file",async()=>{
 await assert.rejects(()=>readV4TimeStopApproval("a".repeat(40),"/tmp/unapproved.json"),/PATH_INVALID/);
});
