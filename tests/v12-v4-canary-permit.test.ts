import test from "node:test";
import assert from "node:assert/strict";
import {V12_V4_V2_POLICY} from "../lib/v12-v4-v2-shadow";
import {validateV4CanaryPermit,assertV4CanaryOrderAuthority} from "../lib/v12-v4-canary-permit";

const sha="a".repeat(40),now=Date.parse("2026-10-10T14:00:00Z");
const permit={
 schema:"disdex-v12-v4-production-canary-permit/v1" as const,
 approvedSha:sha,policyId:V12_V4_V2_POLICY,
 approvedAt:"2026-10-10T13:50:00Z",validUntil:"2026-10-10T16:00:00Z",
 maxEntries:1 as const,sizing:"VENUE_MINIMUM_ONLY" as const,
 absoluteNotionalCapUsd:25,
 operatorAcknowledgement:"I_AUTHORIZE_ONE_V12_V4_PRODUCTION_CANARY_AT_VENUE_MINIMUM" as const,
};

test("canary permit is exact-SHA, short-lived, one-entry and capped",()=>{
 assert.equal(validateV4CanaryPermit(permit,sha,now).maxEntries,1);
 assert.throws(()=>validateV4CanaryPermit({...permit,approvedSha:"b".repeat(40)},sha,now),/INVALID/);
 assert.throws(()=>validateV4CanaryPermit({...permit,maxEntries:2},sha,now),/INVALID/);
 assert.throws(()=>validateV4CanaryPermit({...permit,absoluteNotionalCapUsd:26},sha,now),/NOTIONAL_CAP/);
 assert.throws(()=>validateV4CanaryPermit({...permit,validUntil:"2026-10-12T16:00:00Z"},sha,now),/EXPIRED_OR_FUTURE/);
});

test("canary entry cannot exceed absolute cap; owned protection remains possible after permit expiry",()=>{
 const entry:any={action:"ENTRY",legId:"l1",symbol:"ETHUSDT",positionSide:"LONG",
  quantity:.1,price:200,sequence:0,signalTs:now};
 assert.deepEqual(assertV4CanaryOrderAuthority({sha,command:entry,permit,now}),
  {authorizedCanaryEntry:true});
 assert.throws(()=>assertV4CanaryOrderAuthority({sha,command:{...entry,quantity:.2},permit,now}),/NOTIONAL_CAP/);
 const doc:any={releaseSha:sha,state:{legs:{l1:{id:"l1",status:"OPEN",qty:.1,
  candidate:{symbol:"ETHUSDT",effectiveSide:"LONG"}}}}};
 const expired=Date.parse("2026-10-11T00:00:00Z");
 assert.deepEqual(assertV4CanaryOrderAuthority({sha,command:{...entry,action:"STOP"},permit,ownedDocument:doc,now:expired}),
  {authorizedCanaryReduction:true});
 assert.deepEqual(assertV4CanaryOrderAuthority({sha,command:{...entry,action:"EXIT"},permit,ownedDocument:doc,now:expired}),
  {authorizedCanaryReduction:true});
});
