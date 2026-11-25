import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { DirectPosition, DirectTradeResult, DirectOpenOrder } from "../lib/direct-trade-executor";
import { createHypeH48TimeOnlyContract } from "../lib/hype-stable4-time-only-contract";
import {
  newH48ExecutionJournal, validateH48ExecutionJournal,
  checkpointH48ResearchGrid,prepareH48EntryIntent,prepareH48ExitIntent,
  markH48OrderAttempted,reconcileH48Attempt,assertH48JournalTransition,type H48ExecutionJournal,
  type H48SignedVenueSnapshot,
} from "../lib/hype-h48-execution-journal";
import { advanceH48ResearchSequence } from "../lib/hype-h48-research-sequence";

const SHA="4786f600ae7bf86ffca948f1412956a9113cb20d", E=Date.UTC(2026,10,24,0), H=3600000;
const contract=createHypeH48TimeOnlyContract({positionId:"H48|HYPEUSDT|"+E,sourceSha:SHA,logicalEntryTs:E});
const evidence=(now:number)=>({
  policy:"H48_TIME_ONLY" as const,runtimeSha:SHA,positionId:contract.positionId,
  logicalEntryTs:E,logicalExitTs:E+48*H,quantity:2,
  certificateSha256:"a".repeat(64),validatedAt:now,expiresAt:now+60_000,
});
function start(){
  const s=newH48ExecutionJournal(SHA);
  const t=E-H;
  const closedH=Array.from({length:25},(_,i)=>({openTs:t-(24-i)*H,close:i<=12?100+i*.25:103}));
  const closedB=Array.from({length:25},(_,i)=>({openTs:t-(24-i)*H,close:100+i*2/24}));
  const observed=advanceH48ResearchSequence({
    state:s.research,runtimeSha:SHA,now:E+1000,
    entry:{openTs:E,open:110,observedAt:E+100},hypeClosed:closedH,
    btcClosed:closedB,existingHypePosition:false,
  });
  assert.equal(observed.decision.status,"RESEARCH_CANDIDATE");
  const advanced=checkpointH48ResearchGrid(s,observed);
  const planned=prepareH48EntryIntent(advanced,{status:"H48_ENTRY_ATTESTED_READ_ONLY",contract,evidence:evidence(E+1000)},{
    quantity:2,referencePrice:110,now:E+1000,
  });
  return planned;
}
function fakeResult(p:H48ExecutionJournal,status:DirectTradeResult["status"],executedQuantity:number,side:"BUY"|"SELL",overrides:Partial<DirectTradeResult>={}):DirectTradeResult{
  if(!p.pending)throw Error("missing pending");
  return {
    requestId:p.pending.clientOrderId,clientOrderId:p.pending.clientOrderId,
    symbol:"HYPEUSDT",side,status,requestedQuantity:p.pending.quantity,
    submittedQuantity:p.pending.quantity,executedQuantity,averagePrice:110,
    quoteQuantity:executedQuantity*110,
    reduceOnly:side==="SELL",executionUnknown:false,reconciled:true,
    ...overrides,
  };
}
function snapshot(now:number,qty=0,orders:DirectOpenOrder[]=[]):H48SignedVenueSnapshot{
  const positions:DirectPosition[]=qty?[{
    symbol:"HYPEUSDT",quantity:qty,entryPrice:110,markPrice:111,unrealizedPnl:2,
    pnlPct:0.01,notionalUsd:qty*110,positionSide:"BOTH",leverage:5,updatedAt:now,
  }]:[];
  return {source:"ASTER_SIGNED_READ_ONLY",observedAt:now,positions,openOrders:orders};
}
function entered(){
  const attempted=markH48OrderAttempted(start(),E+1500);
  const state=reconcileH48Attempt(attempted,{result:fakeResult(attempted,"FILLED",2,"BUY"),
    venue:snapshot(E+1600,2),now:E+1700});
  assert.equal(state.mode,"OPEN");
  return state;
}

test("H48 journal records BEFORE any attempted venue call and reconstructs full entry/exit",()=>{
  const initial=start();assert.equal(initial.mode,"ENTRY_PENDING");
  assert.equal(initial.pending?.stage,"PREPARED");
  assert.equal(initial.pending?.clientOrderId.length,35);
  assert.equal(initial.research.nextBaseEligibleTs,E+48*H);
  const attempted=markH48OrderAttempted(initial,E+1500);
  assert.equal(attempted.pending?.stage,"SUBMITTED");
  const open=entered();
  assert.equal(open.position?.quantity,2);
  assert.equal(open.position?.contract.logicalExitTs,E+48*H);
  const t=E+48*H+10_000;
  const exit=prepareH48ExitIntent(open,{
    status:"H48_EXIT_ATTESTED_READ_ONLY",contract,evidence:evidence(t),
    boundary:{due:true,reason:"HYPE_REDESIGN_TIME48_NEXTOPEN",logicalExitTs:E+48*H,referenceOpen:120},
  },t);
  assert.equal(exit.pending?.phase,"EXIT");
  assert.notEqual(exit.pending?.clientOrderId,attempted.pending?.clientOrderId);
  const sent=markH48OrderAttempted(exit,t+100);
  const finished=reconcileH48Attempt(sent,{result:fakeResult(sent,"FILLED",2,"SELL"),
    venue:snapshot(t+200),now:t+300});
  assert.equal(finished.mode,"FLAT");
  assert.equal(finished.position,null);
  assert.equal(finished.pending,null);
  assert.equal(finished.research.nextBaseEligibleTs,E+48*H);
});

test("UNKNOWN and partial entry fills freeze journal without resubmission",()=>{
  for(const [status,qty] of [["UNKNOWN",0],["PARTIALLY_FILLED",1]] as const){
    const sent=markH48OrderAttempted(start(),E+1500);
    const state=reconcileH48Attempt(sent,{
      result:fakeResult(sent,status,qty,"BUY",{executionUnknown:status==="UNKNOWN"}),
      venue:snapshot(E+1600,qty),now:E+1700});
    assert.equal(state.mode,"MANUAL_REVIEW");
    assert.equal(state.pending?.stage,"SUBMITTED");
    assert.throws(()=>markH48OrderAttempted(state,E+1800),/HYPE_H48_JOURNAL_ATTEMPT_NOT_ALLOWED/);
    assert.throws(()=>prepareH48EntryIntent(state,{status:"H48_ENTRY_ATTESTED_READ_ONLY",contract,evidence:evidence(E+1900)},
      {quantity:2,referencePrice:110,now:E+1900}),/HYPE_H48_JOURNAL_ENTRY_NOT_ELIGIBLE/);
  }
});

test("canceled entry is FLAT only with signed zero-exposure venue proof",()=>{
  const sent=markH48OrderAttempted(start(),E+1500);
  const flat=reconcileH48Attempt(sent,{result:fakeResult(sent,"CANCELED",0,"BUY"),
    venue:snapshot(E+1600),now:E+1700});
  assert.equal(flat.mode,"FLAT");
  assert.equal(flat.research.nextBaseEligibleTs,E+48*H);
  const uncertain=reconcileH48Attempt(sent,{result:fakeResult(sent,"CANCELED",0,"BUY"),
    venue:snapshot(E+1600,1),now:E+1700});
  assert.equal(uncertain.mode,"MANUAL_REVIEW");
});

test("stale, forged or unmanaged venue inventory never confirms execution",()=>{
  const sent=markH48OrderAttempted(start(),E+1500);
  for(const venue of [
    snapshot(E-500,2),
    snapshot(E+1550,2,[{clientOrderId:"external",symbol:"HYPEUSDT",quantity:1,executedQuantity:0}]),
    snapshot(E+1000,2),
  ]){
    const attempt=reconcileH48Attempt(sent,{result:fakeResult(sent,"FILLED",2,"BUY"),venue,now:E+125_000});
    assert.equal(attempt.mode,"MANUAL_REVIEW");
  }
  const beforeRequest=reconcileH48Attempt(sent,{result:fakeResult(sent,"FILLED",2,"BUY"),
    venue:snapshot(E+1400,2),now:E+1700});
  assert.equal(beforeRequest.mode,"MANUAL_REVIEW");
  const forged=reconcileH48Attempt(sent,{result:fakeResult(sent,"FILLED",2,"BUY",{clientOrderId:"other"}),
    venue:snapshot(E+1600,2),now:E+1700});
  assert.equal(forged.mode,"MANUAL_REVIEW");
});

test("partial, non-reduce-only or not-flat exit cannot clear owned H48 position",()=>{
  const open=entered(),t=E+48*H+10_000;
  const planned=prepareH48ExitIntent(open,{status:"H48_EXIT_ATTESTED_READ_ONLY",contract,
    evidence:evidence(t),boundary:{due:true,reason:"HYPE_REDESIGN_TIME48_NEXTOPEN",logicalExitTs:E+48*H,referenceOpen:120},
  },t);
  const sent=markH48OrderAttempted(planned,t+10);
  for(const [result,venue] of [
    [fakeResult(sent,"PARTIALLY_FILLED",1,"SELL"),snapshot(t+15,1)],
    [fakeResult(sent,"FILLED",2,"SELL",{reduceOnly:false}),snapshot(t+15)],
    [fakeResult(sent,"FILLED",2,"SELL"),snapshot(t+15,2)],
  ] as const){
    const out=reconcileH48Attempt(sent,{result,venue,now:t+30});
    assert.equal(out.mode,"MANUAL_REVIEW");
    assert.equal(out.position?.quantity,2);
  }
});

test("expired H48 root policy evidence cannot mark an order as attempted",()=>{
  const s=start();
  assert.ok(s.pending?.authorizationExpiresAt===E+61_000);
  assert.throws(()=>markH48OrderAttempted(s,E+61_000),/HYPE_H48_JOURNAL_ATTEMPT_NOT_ALLOWED/);
  assert.throws(()=>markH48OrderAttempted(s,E+140_000),/HYPE_H48_JOURNAL_ATTEMPT_NOT_ALLOWED/);
});

test("journal rejects unknown fields, invalid source, wrong pending/position mode",()=>{
  const s=start();
  assert.equal(validateH48ExecutionJournal(JSON.parse(JSON.stringify(s)),SHA).mode,"ENTRY_PENDING");
  for(const raw of [
    {...s,sourceSha:"f".repeat(40)},
    {...s,pending:null},
    {...s,mode:"OPEN"},
    {...s,permissionOverride:true},
    {...s,revision:-1},
  ])assert.throws(()=>validateH48ExecutionJournal(raw,SHA),/HYPE_H48_JOURNAL_/);
  assert.throws(()=>markH48OrderAttempted(s,E-1000),/HYPE_H48_JOURNAL_/);
  assert.throws(()=>markH48OrderAttempted(markH48OrderAttempted(s,E+1000),E+1500),/HYPE_H48_JOURNAL_/);
});

test("journal transition firewall refuses fabricated OPEN, FLAT or review resets",()=>{
  const planned=start();
  const sent=markH48OrderAttempted(planned,E+1500);
  assert.doesNotThrow(()=>assertH48JournalTransition(planned,sent));
  const open=reconcileH48Attempt(sent,{result:fakeResult(sent,"FILLED",2,"BUY"),
    venue:snapshot(E+1600,2),now:E+1700});
  assert.doesNotThrow(()=>assertH48JournalTransition(sent,open));
  const directToFlat={...sent,mode:"FLAT" as const,pending:null,position:null,revision:sent.revision+1};
  assert.throws(()=>assertH48JournalTransition(planned,directToFlat),/HYPE_H48_JOURNAL_/);
  const fabricatedFlat={...open,mode:"FLAT" as const,position:null,revision:open.revision+1};
  assert.throws(()=>assertH48JournalTransition(open,fabricatedFlat),/HYPE_H48_JOURNAL_TRANSITION_/);
  const fabricatedReview={...open,mode:"MANUAL_REVIEW" as const,
    reviewReason:"H48_FAKE_RECONCILIATION",revision:open.revision+1};
  assert.throws(()=>assertH48JournalTransition(open,fabricatedReview),/HYPE_H48_JOURNAL_TRANSITION_/);
  const stale={...open,revision:open.revision+1};
  assert.throws(()=>assertH48JournalTransition(open,stale),/HYPE_H48_JOURNAL_TRANSITION_/);
});
