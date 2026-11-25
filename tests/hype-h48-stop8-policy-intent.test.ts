import {strict as assert} from "node:assert";
import {test} from "node:test";
import {createHypeH48TimeOnlyContract} from "../lib/hype-stable4-time-only-contract";
import {newH48ExecutionJournal,type H48ExecutionJournal} from "../lib/hype-h48-execution-journal";
import {
  prepareH48Stop8Entry,prepareH48Stop8TimeExit,
  type H48Stop8RootPositionEvidence,
} from "../lib/hype-h48-stop8-policy-intent";
import type {H48ProtectedRestartResult} from "../lib/hype-h48-protected-restart";
const SHA="4786f600ae7bf86ffca948f1412956a9113cb20d",PLAN="b".repeat(64);
const E=Date.UTC(2026,10,24,0),H=3_600_000,ENTRY_AT=E+1000,EXIT_AT=E+48*H+1000;
const contract=createHypeH48TimeOnlyContract({sourceSha:SHA,
  positionId:"H48|HYPEUSDT|"+E,logicalEntryTs:E});
const rootEvidence=(now:number,over:Partial<H48Stop8RootPositionEvidence>={})=>({
  schema:"disdex-h48-stop8-position-policy-evidence/v1" as const,
  policy:"H48_R4_RESIDENT_STOP8" as const,runtimeSha:SHA,planSha256:PLAN,
  positionId:contract.positionId,logicalEntryTs:E,logicalExitTs:E+48*H,
  quantity:2,certificateSha256:"c".repeat(64),
  validatedAt:now-300,expiresAt:now+60_000,...over,
});
const flat=():H48ExecutionJournal=>({...newH48ExecutionJournal(SHA),
  revision:1,research:{schema:"disdex-h48-r4-wsig-research-sequence/v1",
    sourceSha:SHA,lastEvaluatedEntryTs:E,nextBaseEligibleTs:E+48*H}});
const open=():H48ExecutionJournal=>({...flat(),revision:3,mode:"OPEN",
  position:{contract,quantity:2,entryPrice:100,
    entryClientOrderId:"h48e-"+"a".repeat(30),observedAt:E+2000}});
const protectedStatus:H48ProtectedRestartResult={decision:"OPEN_STOP8_VERIFIED_READ_ONLY",
  reason:"HYPE_POSITION_AND_STOP8_SIGNED_READBACK_MATCH",ordersSent:0,cancelsSent:0};

test("Root STOP8 evidence prepares one deterministic H48 entry with exact SHA and certificate",()=>{
  const s=prepareH48Stop8Entry({state:flat(),contract,evidence:rootEvidence(ENTRY_AT),
    planSha256:PLAN,quantity:2,referencePrice:100,now:ENTRY_AT});
  assert.equal(s.mode,"ENTRY_PENDING");
  assert.equal(s.pending?.phase,"ENTRY");
  assert.match(s.pending?.clientOrderId||"",/^h48e-[a-f0-9]{30}$/);
  assert.equal(s.pending?.certificateSha256,"c".repeat(64));
  assert.equal(s.pending?.authorizationExpiresAt,ENTRY_AT+60_000);
});
test("TIME_ONLY or wrong-plan/expired evidence cannot prepare a STOP8 entry",()=>{
  for(const overrides of [
    {policy:"H48_TIME_ONLY" as never},
    {planSha256:"f".repeat(64)},
    {runtimeSha:"f".repeat(40)},
    {quantity:1},
    {expiresAt:ENTRY_AT-1},
    {validatedAt:ENTRY_AT-120_000},
  ])assert.throws(()=>prepareH48Stop8Entry({
    state:flat(),contract,evidence:rootEvidence(ENTRY_AT,overrides),
    planSha256:PLAN,quantity:2,referencePrice:100,now:ENTRY_AT,
  }),/H48_STOP8_PREPARE_BLOCKED/);
});
test("STOP8 TIME48 exit requires protected live position and exact next-open boundary",()=>{
  const result=prepareH48Stop8TimeExit({
    state:open(),contract,evidence:rootEvidence(EXIT_AT),
    planSha256:PLAN,signedProtectedRestart:protectedStatus,
    exitBoundary:{openTs:E+48*H,open:108,observedAt:EXIT_AT-500},now:EXIT_AT,
  });
  assert.equal(result.mode,"EXIT_PENDING");
  assert.equal(result.pending?.phase,"EXIT");
  assert.equal(result.pending?.referencePrice,108);
  assert.match(result.pending?.clientOrderId||"",/^h48x-[a-f0-9]{30}$/);
});
test("NO STOP or stale/wrong TIME48 event cannot prepare protected reduce-only exit",()=>{
  const base={
    state:open(),contract,evidence:rootEvidence(EXIT_AT),
    planSha256:PLAN,signedProtectedRestart:protectedStatus,
    exitBoundary:{openTs:E+48*H,open:108,observedAt:EXIT_AT-500},now:EXIT_AT,
  };
  assert.throws(()=>prepareH48Stop8TimeExit({...base,signedProtectedRestart:{
    ...protectedStatus,decision:"HOLD_PROTECTED_RECONCILIATION",
  }}),/EXIT_NOT_PROTECTED/);
  assert.throws(()=>prepareH48Stop8TimeExit({...base,exitBoundary:{
    ...base.exitBoundary,openTs:E+47*H,
  }}),/HYPE_H48_BOUNDARY_OPEN_UNVERIFIED/);
  assert.throws(()=>prepareH48Stop8TimeExit({...base,now:EXIT_AT+125_000}),
    /EXIT_POSITION_OR_DEADLINE/);
  assert.throws(()=>prepareH48Stop8TimeExit({...base,evidence:rootEvidence(EXIT_AT,{policy:"H48_TIME_ONLY" as never})}),
    /H48_STOP8_PREPARE_BLOCKED/);
});
