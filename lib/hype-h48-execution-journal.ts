/**
 * Fail-closed H48-only order INTENT journal. Pure state transitions; no
 * exchange request, STOP cancellation, or persistence side effect.
 *
 * A caller must persist a SUBMITTED intent BEFORE invoking the real venue
 * order API, and re-read signed venue order/position data on restart.
 * UNKNOWN/partial/contradictory fills remain MANUAL_REVIEW, never retried.
 *
 * This journal is not wired into LIVE: pending-exposure registration, Shared
 * Risk, Margin Guard, writer exclusivity, STOP governance and fresh Root
 * approval are separate mandatory production gates.
 */
import { createHash } from "node:crypto";
import type { DirectTradeResult, DirectPosition, DirectOpenOrder } from "./direct-trade-executor";
import type { HypeH48TimeOnlyContract, HypeH48PolicyEvidence } from "./hype-stable4-time-only-contract";
import { validateHypeH48TimeOnlyContract, validateHypeH48PolicyEvidence } from "./hype-stable4-time-only-contract";
import { validateH48ResearchSequence, createH48ResearchSequence, type H48ResearchSequence, type H48ResearchSequenceDecision } from "./hype-h48-research-sequence";

type Phase = "ENTRY"|"EXIT";
type Stage = "PREPARED"|"SUBMITTED";
export interface H48OrderIntent {
  phase:Phase;
  stage:Stage;
  clientOrderId:string;
  contract:HypeH48TimeOnlyContract;
  quantity:number;
  referencePrice:number;
  certificateSha256:string;
  authorizationExpiresAt:number;
  preparedAt:number;
  submittedAt:number|null;
}
export interface H48OpenPosition {
  contract:HypeH48TimeOnlyContract;
  quantity:number;
  entryPrice:number;
  entryClientOrderId:string;
  observedAt:number;
}
export interface H48ExecutionJournal {
  schema:"disdex-h48-native-execution-journal/v1";
  sourceSha:string;
  revision:number;
  mode:"FLAT"|"ENTRY_PENDING"|"OPEN"|"EXIT_PENDING"|"MANUAL_REVIEW";
  research:H48ResearchSequence;
  pending:H48OrderIntent|null;
  position:H48OpenPosition|null;
  reviewReason:string|null;
}
export type H48SignedVenueSnapshot={
  source:"ASTER_SIGNED_READ_ONLY";
  observedAt:number;
  positions:ReadonlyArray<DirectPosition>;
  openOrders:ReadonlyArray<DirectOpenOrder>;
};
const fail=(reason:string):never=>{throw Error("HYPE_H48_JOURNAL_"+reason);};
const positive=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n)&&n>0;
const timestamp=(n:unknown):n is number=>positive(n)&&Number.isSafeInteger(n);
const exact=(v:unknown,keys:readonly string[])=>{
  if(!v||typeof v!=="object"||Array.isArray(v))return false;
  const names=Reflect.ownKeys(v);
  return names.length===keys.length&&names.every(k=>typeof k==="string"&&keys.includes(k));
};
function validateContract(c:HypeH48TimeOnlyContract,sourceSha:string){
  const contract=validateHypeH48TimeOnlyContract(c,c);
  if(contract.sourceSha!==sourceSha)fail("SOURCE_CONTRACT_MISMATCH");
  return contract;
}
function validIntent(p:H48OrderIntent,sourceSha:string){
  if(!exact(p,["phase","stage","clientOrderId","contract","quantity","referencePrice","certificateSha256","authorizationExpiresAt","preparedAt","submittedAt"])
    ||!["ENTRY","EXIT"].includes(p.phase)||!["PREPARED","SUBMITTED"].includes(p.stage)
    ||typeof p.clientOrderId!=="string"||!/^(h48e|h48x)-[0-9a-f]{30}$/.test(p.clientOrderId)
    ||(p.phase==="ENTRY"?!p.clientOrderId.startsWith("h48e-"):!p.clientOrderId.startsWith("h48x-"))
    ||!positive(p.quantity)||!positive(p.referencePrice)||typeof p.certificateSha256!=="string"||!/^[0-9a-f]{64}$/.test(p.certificateSha256)
    ||!timestamp(p.preparedAt)||!timestamp(p.authorizationExpiresAt)
    ||p.authorizationExpiresAt<=p.preparedAt
    ||(p.stage==="PREPARED" ? p.submittedAt!==null :
      !timestamp(p.submittedAt)||p.submittedAt<p.preparedAt||p.submittedAt>=p.authorizationExpiresAt))fail("INTENT_INVALID");
  validateContract(p.contract,sourceSha);
}
function validPosition(p:H48OpenPosition,sourceSha:string){
  if(!exact(p,["contract","quantity","entryPrice","entryClientOrderId","observedAt"])
      ||!positive(p.quantity)||!positive(p.entryPrice)
      ||typeof p.entryClientOrderId!=="string"||!/^h48e-[0-9a-f]{30}$/.test(p.entryClientOrderId)
      ||!timestamp(p.observedAt))fail("POSITION_INVALID");
  validateContract(p.contract,sourceSha);
}
export function validateH48ExecutionJournal(raw:unknown,expectedSha:string):H48ExecutionJournal {
  if(!exact(raw,["schema","sourceSha","revision","mode","research","pending","position","reviewReason"]))fail("STATE_FIELDS");
  const state=raw as H48ExecutionJournal;
  if(state.schema!=="disdex-h48-native-execution-journal/v1"||state.sourceSha!==expectedSha
     ||!Number.isSafeInteger(state.revision)||state.revision<0
     ||!["FLAT","ENTRY_PENDING","OPEN","EXIT_PENDING","MANUAL_REVIEW"].includes(state.mode))fail("STATE_HEADER");
  validateH48ResearchSequence(state.research,expectedSha);
  if(state.pending!==null)validIntent(state.pending,expectedSha);
  if(state.position!==null)validPosition(state.position,expectedSha);
  const hasPending=state.pending!==null,hasPos=state.position!==null,review=state.reviewReason;
  if(state.mode==="FLAT"&&(hasPending||hasPos||review!==null)
      ||state.mode==="ENTRY_PENDING"&&(!hasPending||hasPos||state.pending?.phase!=="ENTRY"||review!==null)
      ||state.mode==="OPEN"&&(!hasPos||hasPending||review!==null)
      ||state.mode==="EXIT_PENDING"&&(!hasPos||!hasPending||state.pending?.phase!=="EXIT"||review!==null)
      ||state.mode==="MANUAL_REVIEW"&&(typeof review!=="string"||!review.startsWith("H48_")||review.length>180))fail("STATE_INVARIANT");
  if(state.pending&&state.position&&state.pending.contract.positionId!==state.position.contract.positionId)fail("CONTRACT_MISMATCH");
  if(state.pending&&state.position&&state.pending.quantity!==state.position.quantity)fail("QUANTITY_MISMATCH");
  return structuredClone(state);
}
export function newH48ExecutionJournal(sourceSha:string):H48ExecutionJournal {
  const research=createH48ResearchSequence(sourceSha);
  return {schema:"disdex-h48-native-execution-journal/v1",sourceSha,revision:0,mode:"FLAT",research,pending:null,position:null,reviewReason:null};
}
const next=(s:H48ExecutionJournal,overrides:Partial<H48ExecutionJournal>)=>{
  const r={...s,...overrides,revision:s.revision+1};
  return validateH48ExecutionJournal(r,s.sourceSha);
};

export function checkpointH48ResearchGrid(s:H48ExecutionJournal,input:{state:H48ResearchSequence;decision:H48ResearchSequenceDecision}):H48ExecutionJournal{
  const current=validateH48ExecutionJournal(s,s.sourceSha);
  const sequence=validateH48ResearchSequence(input.state,current.sourceSha);
  if(sequence.lastEvaluatedEntryTs===null||current.research.lastEvaluatedEntryTs!==null
    && sequence.lastEvaluatedEntryTs!==current.research.lastEvaluatedEntryTs+6*3_600_000)fail("RESEARCH_GRID_TRANSITION_INVALID");
  if(current.mode==="MANUAL_REVIEW")fail("MANUAL_REVIEW_BLOCKED");
  if(input.decision.entryTs!==sequence.lastEvaluatedEntryTs)fail("RESEARCH_DECISION_MISMATCH");
  if(input.decision.status==="RESEARCH_CANDIDATE"
      && (sequence.nextBaseEligibleTs!==input.decision.entryTs+48*3_600_000
       ||input.decision.signal.contract.sourceSha!==current.sourceSha))fail("RESEARCH_CONTRACT_MISMATCH");
  // The research window advances even when this Owner account cannot enter.
  return next(current,{research:sequence});
}

export function prepareH48EntryIntent(s:H48ExecutionJournal,attested:{
  status:"H48_ENTRY_ATTESTED_READ_ONLY";contract:HypeH48TimeOnlyContract;evidence:HypeH48PolicyEvidence;
},input:{quantity:number;referencePrice:number;now:number}):H48ExecutionJournal{
  const current=validateH48ExecutionJournal(s,s.sourceSha);
  if(current.mode!=="FLAT"||!positive(input.quantity)||!positive(input.referencePrice)||!timestamp(input.now))fail("ENTRY_NOT_ELIGIBLE");
  const c=validateContract(attested.contract,current.sourceSha);
  if(current.research.lastEvaluatedEntryTs!==c.logicalEntryTs
     ||current.research.nextBaseEligibleTs!==c.logicalExitTs
     ||input.now<c.logicalEntryTs||input.now-c.logicalEntryTs>120_000)fail("ENTRY_RESEARCH_WINDOW_INVALID");
  const proof=validateHypeH48PolicyEvidence(attested.evidence,{contract:c,quantity:input.quantity,now:input.now});
  const id="h48e-"+createHash("sha256").update([current.sourceSha,c.positionId,"ENTRY"].join("|")).digest("hex").slice(0,30);
  return next(current,{mode:"ENTRY_PENDING",pending:{
    phase:"ENTRY",stage:"PREPARED",clientOrderId:id,contract:c,
    quantity:input.quantity,referencePrice:input.referencePrice,
    certificateSha256:proof.certificateSha256,authorizationExpiresAt:proof.expiresAt,
    preparedAt:input.now,submittedAt:null,
  }});
}

export function prepareH48ExitIntent(s:H48ExecutionJournal,attested:{
  status:"H48_EXIT_ATTESTED_READ_ONLY";contract:HypeH48TimeOnlyContract;evidence:HypeH48PolicyEvidence;
  boundary:{due:true;reason:"HYPE_REDESIGN_TIME48_NEXTOPEN";logicalExitTs:number;referenceOpen:number};
},now:number):H48ExecutionJournal{
  const current=validateH48ExecutionJournal(s,s.sourceSha);
  if(current.mode!=="OPEN"||!current.position||!timestamp(now))fail("EXIT_NOT_ELIGIBLE");
  const pos=current.position!,c=validateContract(attested.contract,current.sourceSha);
  if(c.positionId!==pos.contract.positionId||now<c.logicalExitTs
    ||now-c.logicalExitTs>120_000
    ||attested.boundary.due!==true||attested.boundary.logicalExitTs!==c.logicalExitTs
    ||attested.boundary.reason!=="HYPE_REDESIGN_TIME48_NEXTOPEN"
    ||!positive(attested.boundary.referenceOpen))fail("EXIT_BOUNDARY_INVALID");
  const proof=validateHypeH48PolicyEvidence(attested.evidence,{contract:c,quantity:pos.quantity,now});
  const id="h48x-"+createHash("sha256").update([current.sourceSha,c.positionId,"EXIT"].join("|")).digest("hex").slice(0,30);
  return next(current,{mode:"EXIT_PENDING",pending:{
    phase:"EXIT",stage:"PREPARED",clientOrderId:id,contract:c,
    quantity:pos.quantity,referencePrice:attested.boundary.referenceOpen,
    certificateSha256:proof.certificateSha256,authorizationExpiresAt:proof.expiresAt,
    preparedAt:now,submittedAt:null,
  }});
}

/** Must be durably saved BEFORE the venue client receives an order request. */
export function markH48OrderAttempted(s:H48ExecutionJournal,now:number):H48ExecutionJournal{
  const current=validateH48ExecutionJournal(s,s.sourceSha);
  if(!["ENTRY_PENDING","EXIT_PENDING"].includes(current.mode)||!current.pending
     ||current.pending.stage!=="PREPARED"||!timestamp(now)||now<current.pending.preparedAt
     ||now>=current.pending.authorizationExpiresAt||now-current.pending.preparedAt>120_000
     ||now-(current.pending.phase==="ENTRY"?current.pending.contract.logicalEntryTs:current.pending.contract.logicalExitTs)>120_000)fail("ATTEMPT_NOT_ALLOWED");
  return next(current,{pending:{...current.pending!,stage:"SUBMITTED",submittedAt:now}});
}

function signedSnapshot(v:H48SignedVenueSnapshot,now:number){
  if(!v||v.source!=="ASTER_SIGNED_READ_ONLY"||!timestamp(v.observedAt)||!timestamp(now)
    ||v.observedAt>now||now-v.observedAt>120_000||!Array.isArray(v.positions)||!Array.isArray(v.openOrders))fail("SIGNED_READ_UNVERIFIED");
  for(const p of v.positions)if(!p||typeof p.symbol!=="string"||!Number.isFinite(p.quantity)||!Number.isFinite(p.entryPrice))fail("VENUE_POSITION_INVALID");
  for(const o of v.openOrders)if(!o||typeof o.symbol!=="string")fail("VENUE_ORDER_INVALID");
  if(v.openOrders.some(x=>x.symbol.toUpperCase()==="HYPEUSDT"))fail("UNMANAGED_HYPE_ORDER");
  return v.positions.filter(x=>x.symbol.toUpperCase()==="HYPEUSDT"&&Math.abs(x.quantity)>1e-9);
}
function review(s:H48ExecutionJournal,reason:string){return next(s,{mode:"MANUAL_REVIEW",reviewReason:"H48_"+reason});}
/**
 * State-store transition firewall. A structurally valid JSON object is NOT
 * enough to turn a submitted order into FLAT, or discard an open position.
 * Journal persistence must reject unauthorized phase jumps and stale
 * revisions, even when a caller constructs a forged replacement object.
 */
export function assertH48JournalTransition(before:H48ExecutionJournal,after:H48ExecutionJournal):void {
  const old=validateH48ExecutionJournal(before,before.sourceSha);
  const nextState=validateH48ExecutionJournal(after,old.sourceSha);
  if(nextState.revision!==old.revision+1)fail("TRANSITION_REVISION_INVALID");
  if(old.mode==="MANUAL_REVIEW")fail("MANUAL_REVIEW_REQUIRES_OPERATOR");
  const eq=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  const sameResearch=eq(old.research,nextState.research);
  const oldPending=old.pending,newPending=nextState.pending;
  if(old.mode===nextState.mode){
    if((old.mode==="FLAT"||old.mode==="OPEN")
       &&eq(old.position,nextState.position)&&eq(oldPending,newPending)
       &&!sameResearch&&nextState.research.lastEvaluatedEntryTs!==null
       &&(old.research.lastEvaluatedEntryTs===null
         ||nextState.research.lastEvaluatedEntryTs===old.research.lastEvaluatedEntryTs+6*3_600_000)
       &&nextState.research.nextBaseEligibleTs>=old.research.nextBaseEligibleTs)return;
    if((old.mode==="ENTRY_PENDING"||old.mode==="EXIT_PENDING")
       &&oldPending?.stage==="PREPARED"&&newPending?.stage==="SUBMITTED"
       &&sameResearch&&eq(old.position,nextState.position)
       &&eq({...oldPending,stage:"SUBMITTED",submittedAt:newPending.submittedAt},newPending))return;
    fail("TRANSITION_ILLEGAL_IN_PLACE");
  }
  if(!sameResearch)fail("TRANSITION_UNEXPECTED_RESEARCH_EDIT");
  if(old.mode==="FLAT"&&nextState.mode==="ENTRY_PENDING"&&newPending?.stage==="PREPARED"
      &&newPending.phase==="ENTRY"&&nextState.position===null
      &&old.research.lastEvaluatedEntryTs===newPending.contract.logicalEntryTs
      &&old.research.nextBaseEligibleTs===newPending.contract.logicalExitTs)return;
  if(old.mode==="ENTRY_PENDING"&&oldPending?.stage==="SUBMITTED"){
    if(nextState.mode==="OPEN"&&nextState.position
       &&nextState.pending===null
       &&eq(oldPending.contract,nextState.position.contract)
       &&oldPending.quantity===nextState.position.quantity
       &&oldPending.clientOrderId===nextState.position.entryClientOrderId
       &&nextState.position.observedAt>=(oldPending.submittedAt??0))return;
    if(nextState.mode==="FLAT"&&nextState.position===null&&nextState.pending===null)return;
  }
  if(old.mode==="OPEN"&&nextState.mode==="EXIT_PENDING"
     &&newPending?.stage==="PREPARED"&&newPending.phase==="EXIT"
     &&eq(old.position,nextState.position)
     &&newPending.contract.positionId===old.position?.contract.positionId
     &&newPending.quantity===old.position?.quantity
     &&newPending.preparedAt>=newPending.contract.logicalExitTs)return;
  if(old.mode==="EXIT_PENDING"&&oldPending?.stage==="SUBMITTED"
     &&nextState.mode==="FLAT"&&nextState.position===null&&nextState.pending===null)return;
  if((old.mode==="ENTRY_PENDING"||old.mode==="EXIT_PENDING")
      &&oldPending?.stage==="SUBMITTED"&&nextState.mode==="MANUAL_REVIEW"
      &&eq(oldPending,newPending)&&eq(old.position,nextState.position))return;
  fail("TRANSITION_NOT_PERMITTED");
}

export function reconcileH48Attempt(s:H48ExecutionJournal,input:{
  result:DirectTradeResult;venue:H48SignedVenueSnapshot;now:number;
}):H48ExecutionJournal{
  const current=validateH48ExecutionJournal(s,s.sourceSha);
  const p=current.pending!;
  if(!p||!["ENTRY_PENDING","EXIT_PENDING"].includes(current.mode)
    ||p.stage!=="SUBMITTED")fail("NO_SUBMITTED_INTENT");
  // Inconsistent order identity can never be used to release a reservation,
  // open another position or re-submit the same client ID.
  const r=input.result;
  if(!r||r.clientOrderId!==p!.clientOrderId||typeof r.symbol!=="string"||r.symbol.toUpperCase()!=="HYPEUSDT"
     ||r.side!==(p.phase==="ENTRY"?"BUY":"SELL")||!Number.isFinite(r.executedQuantity)
     ||r.executedQuantity<0) return review(current,"ORDER_IDENTITY_OR_QUANTITY_UNKNOWN");
  let positions:DirectPosition[];
  try {
    positions=signedSnapshot(input.venue,input.now);
    if(input.venue.observedAt<(p.submittedAt??0))fail("VENUE_READ_PRECEDES_SUBMISSION");
  }catch{return review(current,"VENUE_READ_OR_OPEN_ORDER_INVALID");}
  if(r.executionUnknown||r.status==="UNKNOWN"||r.status==="PARTIALLY_FILLED"
     ||r.status==="NEW"||r.executedQuantity>p.quantity) return review(current,"AMBIGUOUS_EXECUTION");
  if(p.phase==="ENTRY"){
    if(r.status==="FILLED"&&r.executedQuantity===p.quantity
       &&positive(r.averagePrice)&&positions.length===1
       &&positions[0].quantity===p.quantity&&["BOTH","LONG"].includes(positions[0].positionSide)){
      return next(current,{mode:"OPEN",pending:null,position:{
        contract:p.contract,quantity:p.quantity,entryPrice:r.averagePrice,
        entryClientOrderId:p.clientOrderId,observedAt:input.venue.observedAt,
      }});
    }
    if(["REJECTED","CANCELED","EXPIRED"].includes(r.status)
       &&r.executedQuantity===0&&positions.length===0){
      // The BASE research sequence remains occupied for 48h even if no
      // order filled; don't silently resume with a later WSIG candidate.
      return next(current,{mode:"FLAT",pending:null});
    }
    return review(current,"ENTRY_POSITION_NOT_PROVEN");
  }
  if(r.status==="FILLED"&&r.reduceOnly===true&&r.executedQuantity===p.quantity
     &&positions.length===0) return next(current,{mode:"FLAT",pending:null,position:null});
  return review(current,"EXIT_FLAT_NOT_PROVEN");
}
