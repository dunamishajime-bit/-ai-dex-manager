import test from "node:test";
import assert from "node:assert/strict";
import {reviewMtmAttribution,type MtmReviewInput} from "../lib/stable4-mtm-attribution-review";
const base=():MtmReviewInput=>({fromMs:1000,toMs:2000,priorEquityUsd:1000,equityUsd:1017,externalNetFlowUsd:10,
 events:[{id:"e1",symbol:"BTCUSDT",atMs:1500,kind:"REALIZED_PNL",usd:9},{id:"e2",symbol:"BTCUSDT",atMs:1500,kind:"COMMISSION",usd:-1},{id:"e3",symbol:"ETHUSDT",atMs:1600,kind:"FUNDING_FEE",usd:-1}],
 owners:[{eventId:"e1",symbol:"BTCUSDT",runner:"V4",proofId:"a"},{eventId:"e2",symbol:"BTCUSDT",runner:"V4",proofId:"b"},{eventId:"e3",symbol:"ETHUSDT",runner:"Q102",proofId:"c"}],
 priorMarks:[{positionId:"p1",symbol:"ETHUSDT",runner:"Q102",unrealizedUsd:4,proofId:"d"}],
 marks:[{positionId:"p1",symbol:"ETHUSDT",runner:"Q102",unrealizedUsd:4,proofId:"e"}],
 coverage:{incomeComplete:true,priorPositionsComplete:true,positionsComplete:true,externalFlowsComplete:true,ownerLedgerComplete:true}});
test("account flow neutralized; owner-specific income and marks reconcile without authorization",()=>{
 const b=base();const r=reviewMtmAttribution(b);
 assert.equal(r.status,"RECONCILED_OFFLINE_NOT_AUTHORIZED");assert.equal(r.orderAuthority,false);assert.equal(r.signedObservationIssued,false);
 if(r.status==="RECONCILED_OFFLINE_NOT_AUTHORIZED"){assert.equal(r.accountDeltaUsd,7);assert.equal(r.runnerNetMtmDeltaUsd.V4,8);assert.equal(r.runnerNetMtmDeltaUsd.Q102,-1);}
});
test("unattributed events and ambiguous duplicates never become zero PnL",()=>{
 const b=base();
 for(const x of [{...b,owners:b.owners.slice(1)},{...b,owners:[...b.owners,b.owners[0]]},{...b,events:[...b.events,b.events[0]]}]){
  const r=reviewMtmAttribution(x);assert.equal(r.status,"BLOCKED");assert.ok(!("runnerNetMtmDeltaUsd" in r));
 }
});
test("missing income, flows, position inventory or ownership coverage blocks",()=>{
 const b=base();
 for(const k of Object.keys(b.coverage))assert.equal(reviewMtmAttribution({...b,coverage:{...b.coverage,[k]:false}}).status,"BLOCKED");
});
test("mark changes require account reconciliation and unchanged position owner",()=>{
 const b=base();const m={...b.marks[0],unrealizedUsd:6};
 assert.equal(reviewMtmAttribution({...b,marks:[m]}).status,"BLOCKED");
 assert.equal(reviewMtmAttribution({...b,marks:[{...m,runner:"V4"}],equityUsd:1019}).status,"BLOCKED");
 assert.equal(reviewMtmAttribution({...b,marks:[m],equityUsd:1019}).status,"RECONCILED_OFFLINE_NOT_AUTHORIZED");
});
test("future or overlapping intervals and missing numeric data block",()=>{
 const b=base();
 for(const atMs of [1000,2001,NaN])assert.equal(reviewMtmAttribution({...b,events:[{...b.events[0],atMs},...b.events.slice(1)]}).status,"BLOCKED");
 assert.equal(reviewMtmAttribution({...b,events:[{...b.events[0],usd:NaN},...b.events.slice(1)]}).status,"BLOCKED");
});
