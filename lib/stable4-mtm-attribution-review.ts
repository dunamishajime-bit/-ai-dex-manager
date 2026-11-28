/** Offline reconciliation only. No authentication, account access, or order authority.
 * Callers must independently prove completeness and ownership; a successful
 * review never manufactures a signed RunnerDdObservation or resets DD history.
 */
import {RUNNER_DD_IDS,type RunnerDdId} from "./disdex-runner-cumulative-dd";
export type MtmEvent={id:string;symbol:string;atMs:number;kind:"REALIZED_PNL"|"COMMISSION"|"FUNDING_FEE";usd:number};
export type OwnerEvidence={eventId:string;symbol:string;runner:RunnerDdId;proofId:string};
export type MtmMark={positionId:string;symbol:string;runner:RunnerDdId;unrealizedUsd:number;proofId:string};
export type MtmReviewInput={
 fromMs:number;toMs:number;priorEquityUsd:number;equityUsd:number;externalNetFlowUsd:number;
 events:readonly MtmEvent[];owners:readonly OwnerEvidence[];
 priorMarks:readonly MtmMark[];marks:readonly MtmMark[];
 coverage:{incomeComplete:boolean;priorPositionsComplete:boolean;positionsComplete:boolean;externalFlowsComplete:boolean;ownerLedgerComplete:boolean};
};
const finite=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n);
const positive=(n:unknown)=>finite(n)&&n>0;
const id=(s:unknown):s is string=>typeof s==="string"&&s.trim()===s&&s.length>0&&s.length<=200;
const symbol=(s:unknown)=>typeof s==="string"&&/^[A-Z0-9]+(?:USDT|USDC)$/.test(s);
const validRunner=(v:unknown):v is RunnerDdId=>RUNNER_DD_IDS.includes(v as RunnerDdId);
export function reviewMtmAttribution(input:MtmReviewInput){
 const reasons=new Set<string>();
 const fail=(r:string)=>reasons.add(r);
 const blocked=()=>({status:"BLOCKED" as const,blockers:[...reasons].sort(),orderAuthority:false as const,signedObservationIssued:false as const});
 if(!input||!Number.isSafeInteger(input.fromMs)||!Number.isSafeInteger(input.toMs)||input.fromMs<=0||input.toMs<=input.fromMs||
   !positive(input.priorEquityUsd)||!positive(input.equityUsd)||!finite(input.externalNetFlowUsd)){
   fail("INVALID_ACCOUNT_OR_INTERVAL");return blocked();
 }
 for(const k of ["incomeComplete","priorPositionsComplete","positionsComplete","externalFlowsComplete","ownerLedgerComplete"] as const)
  if(input.coverage?.[k]!==true)fail("INCOMPLETE_"+k);
 if(![input.events,input.owners,input.priorMarks,input.marks].every(Array.isArray)){
  fail("MISSING_LEDGER");return blocked();
 }
 const totals=Object.fromEntries(RUNNER_DD_IDS.map(k=>[k,0])) as Record<RunnerDdId,number>;
 const byEvent=new Map<string,OwnerEvidence>();
 for(const row of input.owners){
  if(!row||!id(row.eventId)||!symbol(row.symbol)||!validRunner(row.runner)||!id(row.proofId)){
   fail("INVALID_OWNER_EVIDENCE");continue;
  }
  if(byEvent.has(row.eventId)){fail("DUPLICATE_OR_CONFLICTING_OWNER_EVIDENCE");continue;}
  byEvent.set(row.eventId,row);
 }
 const seen=new Set<string>();
 for(const e of input.events){
  if(!e||!id(e.id)||!symbol(e.symbol)||!Number.isSafeInteger(e.atMs)||e.atMs<=input.fromMs||e.atMs>input.toMs||
   !["REALIZED_PNL","COMMISSION","FUNDING_FEE"].includes(e.kind)||!finite(e.usd)||
   (e.kind==="COMMISSION"&&e.usd>0)){fail("INVALID_INCOME_EVENT");continue;}
  if(seen.has(e.id)){fail("DUPLICATE_INCOME_EVENT");continue;}
  seen.add(e.id);
  const owner=byEvent.get(e.id);
  if(!owner||owner.symbol!==e.symbol){fail("UNATTRIBUTED_INCOME_EVENT");continue;}
  totals[owner.runner]+=e.usd;
 }
 for(const key of byEvent.keys())if(!seen.has(key))fail("ORPHAN_OWNER_EVIDENCE");
 const prior=new Map<string,MtmMark>();
 const addMarks=(rows:readonly MtmMark[],sign:number)=>{
  const keys=new Set<string>();
  for(const m of rows){
   if(!m||!id(m.positionId)||!symbol(m.symbol)||!validRunner(m.runner)||!finite(m.unrealizedUsd)||!id(m.proofId)){
    fail("INVALID_POSITION_MARK");continue;
   }
   if(keys.has(m.positionId)){fail("DUPLICATE_POSITION_MARK");continue;}
   keys.add(m.positionId);
   if(sign<0)prior.set(m.positionId,m);
   else {
    const old=prior.get(m.positionId);
    if(old&&(old.symbol!==m.symbol||old.runner!==m.runner))fail("POSITION_OWNER_CHANGED_WITHOUT_LINEAGE");
   }
   totals[m.runner]+=sign*m.unrealizedUsd;
  }
 };
 addMarks(input.priorMarks,-1);addMarks(input.marks,1);
 const accountDelta=input.equityUsd-input.priorEquityUsd-input.externalNetFlowUsd;
 const attributed=RUNNER_DD_IDS.reduce((sum,k)=>sum+totals[k],0);
 if(!finite(accountDelta)||!finite(attributed)||Math.abs(accountDelta-attributed)>Math.max(1e-5,1e-8*Math.max(input.equityUsd,input.priorEquityUsd)))
  fail("ACCOUNT_MTM_RECONCILIATION_FAILED");
 if(reasons.size)return blocked();
 return {status:"RECONCILED_OFFLINE_NOT_AUTHORIZED" as const,blockers:[],runnerNetMtmDeltaUsd:totals,accountDeltaUsd:accountDelta,
  orderAuthority:false as const,signedObservationIssued:false as const};
}
