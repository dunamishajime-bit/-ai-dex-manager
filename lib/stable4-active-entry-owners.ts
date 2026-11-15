import {v4PeerOwners,type V4PeerSource} from "./v12-v4-peer-state-owners";
import type {V4ExecutionDocument} from "./v12-v4-execution-store";
import {validateStable4EntryOpportunityBook,type Stable4EntryOpportunityBook,type Stable4EntryOpportunityRecord,type Stable4ActiveEntryOwner,type Stable4EntryOpportunityStrategy} from "./stable4-entry-opportunity-book";

export interface Stable4ActiveEntryOwnersInput{
 now:number;observedAt:number;peerSources:V4PeerSource[];expectedPeerSha:string;
 v4:{releaseSha:string;document:V4ExecutionDocument};book:Stable4EntryOpportunityBook;
}
export interface Stable4ActiveEntryOwnersSnapshot{
 complete:boolean;observedAt:number;positions:Stable4ActiveEntryOwner[];
 reason:"COMPLETE"|"ACTIVE_SCORE_UNBOUND"|"UNMODELED_ACTIVE_OWNER";
}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const timestamp=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
const positive=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>0;
const symbol=(v:unknown)=>{if(typeof v!=="string"||!/^[A-Z0-9]+$/.test(v))throw Error("STABLE4_OWNER_SYMBOL_INVALID");return v.endsWith("USDT")?v:v+"USDT";};
const side=(v:unknown):"LONG"|"SHORT"=>{if(v===1||v==="LONG"||v==="BUY")return"LONG";if(v===-1||v==="SHORT"||v==="SELL")return"SHORT";throw Error("STABLE4_OWNER_SIDE_INVALID");};
const key=(r:{strategy:string;positionId:string})=>JSON.stringify([r.strategy,r.positionId]);

/** Caller must read V4 through its pinned replay-compatible store; this pure adapter
 * adds entry-score bindings. Signed account reconciliation is a separate final gate.
 * Scheduled/research exit times never decide current ownership here.
 */
export function buildStable4ActiveEntryOwners(input:Stable4ActiveEntryOwnersInput):Stable4ActiveEntryOwnersSnapshot{
 if(!input||!timestamp(input.now)||!timestamp(input.observedAt)||input.observedAt>input.now||input.now-input.observedAt>120000||!/^[a-f0-9]{40}$/.test(input.expectedPeerSha))throw Error("STABLE4_OWNER_INPUT_INVALID");
 const book=validateStable4EntryOpportunityBook(input.book),records=new Map(book.records.map(r=>[key(r),r]));
 if(!Array.isArray(input.peerSources))throw Error("STABLE4_OWNER_PEERS_MISSING");
 for(const s of input.peerSources){
  if(!object(s.raw)||!s.service||!timestamp(s.service.observedAt)||s.service.observedAt>input.now||input.now-s.service.observedAt>15000||
   (!s.service.retiredV12&&!s.service.disabled&&(!s.service.active||!positive(s.service.mainPid))))throw Error("STABLE4_OWNER_SERVICE_UNATTESTED");
  const r=s.raw;
  const valid=s.kind==="Q102"?r.version===1&&r.strategyId==="QUALITY102_CAUSAL_V1":
   s.kind==="PENGU"?r.version===2&&r.strategyId==="PENGU_DUAL_LS_V2_FINAL":
   s.kind==="FET"?r.schema==="fet-brk48-residual-state/v1"&&r.strategyId==="FET_BRK48_RESIDUAL":
   s.kind==="HYPE_LONG"?r.schema==="disdex-hype-zec-long/v1":
   s.kind==="IDLE"?r.schema==="disdex-idle-priority-state/v2":
   s.kind==="RESIDUAL"?r.schema==="disdex-idle-residual-long-state/v1":
   s.kind==="V12"?r.schema==="v12-x1-all-runner-state/v2":s.kind==="V52"&&object(r.positions);
  if(!valid)throw Error("STABLE4_OWNER_SCHEMA_INVALID:"+s.kind);
 }
 v4PeerOwners(input.peerSources,input.expectedPeerSha,input.now,"ATTEST_EACH_PEER");
 const doc=input.v4?.document;
 if(!/^[a-f0-9]{40}$/.test(input.v4?.releaseSha)||!doc||doc.schema!==2||doc.releaseSha!==input.v4.releaseSha||!object(doc.state)||!object(doc.state.legs)||!object(doc.intents)||!object(doc.protections)||doc.state.executionReview)throw Error("STABLE4_OWNER_V4_DOCUMENT_INVALID");
 if(Object.values(doc.intents).some(i=>i.action==="ENTRY"&&i.stage!=="TERMINAL"))throw Error("STABLE4_OWNER_V4_ENTRY_UNRESOLVED");
 const positions:Stable4ActiveEntryOwner[]=[];let reason:Stable4ActiveEntryOwnersSnapshot["reason"]="COMPLETE";
 const add=(strategy:Stable4EntryOpportunityStrategy,p:Record<string,any>,sym:unknown,sg:unknown,qty:unknown,observedEntryTs:unknown,logicalExact=false,nativeId?:string)=>{
  if(!positive(qty)||!timestamp(observedEntryTs)||observedEntryTs>input.now)throw Error("STABLE4_OWNER_ACTIVE_NUMERIC_INVALID");
  const symbolValue=symbol(sym),sideValue=side(sg);
  if(p.entryOpportunity===undefined){if(reason==="COMPLETE")reason="ACTIVE_SCORE_UNBOUND";return;}
  const entry=validateStable4EntryOpportunityBook({schemaVersion:1,records:[p.entryOpportunity]}).records[0];
  if(entry.strategy!==strategy||entry.symbol!==symbolValue||entry.side!==sideValue||entry.entryTs>observedEntryTs||
   (logicalExact&&entry.entryTs!==observedEntryTs)||(nativeId!==undefined&&entry.positionId!==nativeId)||entry.capturedAt>input.observedAt)throw Error("STABLE4_OWNER_ENTRY_BINDING_INVALID");
  const central=records.get(key(entry));
  if(!central||Object.keys(entry).some(k=>entry[k as keyof Stable4EntryOpportunityRecord]!==central[k as keyof Stable4EntryOpportunityRecord]))throw Error("STABLE4_OWNER_CENTRAL_RECORD_CONFLICT");
  positions.push({strategy,positionId:entry.positionId,symbol:symbolValue,side:sideValue,entryTs:entry.entryTs,quantity:qty});
 };
 for(const s of input.peerSources){
  const r=s.raw;
  if(s.kind==="V12"){
   if((r.activePositions?.length??0)>0||r.active)reason="UNMODELED_ACTIVE_OWNER";
  }else if(s.kind==="HYPE_LONG"){
   for(const p of r.positions??[]){
    if(p.strategy!=="HYPE_LONG"){reason="UNMODELED_ACTIVE_OWNER";continue;}
    add("HYPE",p,p.symbol,p.side,p.quantity,p.entryTs,false,p.positionId);
   }
  }else if(s.kind==="V52"){
   for(const p of Object.values(r.positions) as Record<string,any>[]){
    if(!p)continue;
    if(typeof p.positionId!=="string"||!p.positionId||p.entryClientOrderId!==p.positionId)throw Error("STABLE4_OWNER_V52_IDENTITY_INVALID");
    add("V52",p,p.symbol,p.asterOpenSide??p.side,p.asterQty??p.quantity,p.openedAt,false,p.positionId);
   }
  }else if(s.kind==="IDLE"){
   for(const p of r.positions)add("IDLE",p,p.symbol,p.side,p.quantity,p.entryTs);
  }else if(s.kind==="RESIDUAL"){
   if(r.position)reason="UNMODELED_ACTIVE_OWNER";
  }else if(r.position){
   const p=r.position,strategy=s.kind as "Q102"|"PENGU"|"FET";
   add(strategy,p,s.kind==="PENGU"?"PENGUUSDT":p.symbol,p.side,p.quantity,p.entryTs,s.kind==="PENGU"||s.kind==="FET");
  }
 }
 for(const [id,leg]of Object.entries(doc.state.legs)){
  if(typeof leg.qty!=="number"||!Number.isFinite(leg.qty)||leg.qty<0)throw Error("STABLE4_OWNER_V4_QUANTITY_INVALID");
  if(leg.qty===0){if(leg.status!=="CLOSED"&&leg.status!=="CANCELLED")throw Error("STABLE4_OWNER_V4_ZERO_LIFECYCLE_INVALID");continue;}
  const protection=doc.protections[id],stop=doc.intents[protection?.stopClientOrderId??""];
  if(leg.id!==id||leg.status!=="OPEN"||leg.plannedExit||protection?.phase!=="STOP_CONFIRMED"||protection.legId!==id||protection.protectedQty!==leg.qty||stop?.action!=="STOP"||stop.stage!=="ACKNOWLEDGED"||stop.legId!==id)throw Error("STABLE4_OWNER_V4_PROTECTION_INVALID");
  add("V4",leg,leg.candidate.symbol,leg.candidate.effectiveSide,leg.qty,leg.entryTs,true,id);
 }
 const seen=new Set<string>();for(const p of positions){if(seen.has(key(p)))throw Error("STABLE4_OWNER_DUPLICATE_NATIVE_ID");seen.add(key(p));}
 return{complete:reason==="COMPLETE",observedAt:input.observedAt,positions,reason};
}
