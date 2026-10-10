import test from "node:test";
import assert from "node:assert/strict";
import {PRODUCTION_EXIT_CATALOG} from "../lib/v12-v4-production-lifecycle";
import {V12_V4_V2_POLICY} from "../lib/v12-v4-v2-shadow";
import {validateV4ProductionCertificate,readV4ProductionCertificate,assertV4CertifiedOrder} from "../lib/v12-v4-certified-gates";
const sha="a".repeat(40),proof="b".repeat(64),now=Date.parse("2026-10-10T02:00:00Z");
const valid={
 schema:"disdex-v12-v4-production-certification/v2",approvedSha:sha,
 policyId:V12_V4_V2_POLICY,approvedAt:"2026-10-10T01:00:00Z",validUntil:"2026-10-11T01:00:00Z",
 verifiedRoutes:PRODUCTION_EXIT_CATALOG.map(x=>x.route),evidence:{
  sourceParitySha256:proof,exitParitySha256:proof,tradeExecutionSha256:proof,
  portfolioRiskSha256:proof,protectedSameSymbolSha256:proof,independentForwardSha256:proof,
  venueLifecycle:{mode:"AUTHENTIC_PRODUCTION_HISTORY",signedOrdersSha256:proof,
   signedPositionsSha256:proof,restartRecoverySha256:proof,sameSymbolRaceSha256:proof,
   realVenueObserved:true,simulatedOnly:false},
 },approvedGross:{v12:3,crypto:3.5,total:4.75,recovery:2.5},
 forwardUnderperformanceAcknowledged:true,
 operatorAcknowledgement:"I_AUTHORIZE_CERTIFIED_V12_V4_REAL_ORDERS",
};
test("certificate validation accepts only exact 41-route, SHA-bound and current independent proof metadata",()=>{
 assert.equal(validateV4ProductionCertificate(valid,sha,now).approvedSha,sha);
 assert.throws(()=>validateV4ProductionCertificate({...valid,approvedSha:"c".repeat(40)},sha,now),/CERTIFICATE_INVALID/);
 assert.throws(()=>validateV4ProductionCertificate({...valid,verifiedRoutes:valid.verifiedRoutes.slice(1)},sha,now),/41_ROUTE/);
 assert.throws(()=>validateV4ProductionCertificate({...valid,evidence:{...valid.evidence,sourceParitySha256:""}},sha,now),/INDEPENDENT_CERT/);
 assert.throws(()=>validateV4ProductionCertificate({...valid,evidence:{...valid.evidence,venueLifecycle:undefined}},sha,now),/REAL_VENUE_LIFECYCLE/);
 assert.throws(()=>validateV4ProductionCertificate({...valid,evidence:{...valid.evidence,venueLifecycle:{...valid.evidence.venueLifecycle,mode:"SIMULATION"}}},sha,now),/REAL_VENUE_LIFECYCLE/);
 assert.throws(()=>validateV4ProductionCertificate({...valid,evidence:{...valid.evidence,venueLifecycle:{...valid.evidence.venueLifecycle,realVenueObserved:false}}},sha,now),/REAL_VENUE_LIFECYCLE/);
 assert.doesNotThrow(()=>validateV4ProductionCertificate({...valid,evidence:{...valid.evidence,venueLifecycle:{...valid.evidence.venueLifecycle,mode:"ASTER_TESTNET"}}},sha,now));
 assert.doesNotThrow(()=>validateV4ProductionCertificate({...valid,evidence:{...valid.evidence,venueLifecycle:{...valid.evidence.venueLifecycle,mode:"CONTROLLED_PRODUCTION_CANARY"}}},sha,now));
 assert.throws(()=>validateV4ProductionCertificate({...valid,forwardUnderperformanceAcknowledged:false},sha,now),/CERTIFICATE_INVALID/);
 assert.throws(()=>validateV4ProductionCertificate({...valid,approvedGross:{...valid.approvedGross,v12:2}},sha,now),/RISK_CAP/);
 assert.throws(()=>validateV4ProductionCertificate(valid,sha,now+10*86400000),/EXPIRED/);
});
test("no application data can replace protected root operator approval path",async()=>{
 await assert.rejects(()=>readV4ProductionCertificate(sha,"/tmp/fake.json"),/PATH_OVERRIDE_DENIED/);
});

test("missing or expired ENTRY certificate cannot trap already signed existing position",async()=>{
 const doc:any={releaseSha:sha,state:{legs:{l1:{id:"l1",status:"OPEN",qty:3,
  candidate:{symbol:"ETHUSDT",effectiveSide:"LONG"}}}}};
 const exit:any={action:"EXIT",legId:"l1",symbol:"ETHUSDT",positionSide:"LONG",
  quantity:3,price:200,sequence:0,signalTs:now};
 assert.deepEqual(await assertV4CertifiedOrder(sha,exit,doc),{authorizedReduction:true});
 assert.deepEqual(await assertV4CertifiedOrder(sha,{...exit,action:"STOP"},doc),{authorizedReduction:true});
 await assert.rejects(()=>assertV4CertifiedOrder(sha,{...exit,action:"ENTRY"},doc));
 await assert.rejects(()=>assertV4CertifiedOrder(sha,{...exit,quantity:4},doc),/QUANTITY_MISMATCH/);
 await assert.rejects(()=>assertV4CertifiedOrder(sha,{...exit,symbol:"BTCUSDT"},doc),/QUANTITY_MISMATCH/);
 await assert.rejects(()=>assertV4CertifiedOrder(sha,exit,undefined),/SIGNED_V4_OWNERSHIP/);
});
