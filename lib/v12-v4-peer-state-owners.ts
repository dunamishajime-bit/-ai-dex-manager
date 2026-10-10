import type {ForeignExposure} from "./v12-v4-production-lifecycle";
export type V4PeerKind="V12"|"PENGU"|"Q102"|"V52"|"FET"|"HYPE_LONG"|"IDLE"|"RESIDUAL";
import type {V4ServiceObservation} from "./v12-v4-peer-service-attestation";
export type V4PeerSource={kind:V4PeerKind;programSha:string;raw:Record<string,any>;
 service?:V4ServiceObservation};
export type V4PeerLineageMode="UNIFIED_RELEASE"|"ATTEST_EACH_PEER";
export function v4PeerOwners(sources:V4PeerSource[],expectedSha:string,now:number,
 lineageMode:V4PeerLineageMode="UNIFIED_RELEASE"):ForeignExposure[]{
 const kinds:V4PeerKind[]=["V12","PENGU","Q102","V52","FET","HYPE_LONG","IDLE","RESIDUAL"];
 if(sources.length!==8||kinds.some(k=>sources.filter(s=>s.kind===k).length!==1))
  throw Error("ALL_EIGHT_PEER_SOURCES_REQUIRED");
 const owners:ForeignExposure[]=[];
 const sym=(s:string)=>String(s).toUpperCase().replace(/USDT$/,"")+"USDT";
 const side=(s:any):"LONG"|"SHORT"=>{
  if(["LONG","BUY",1,"1"].includes(s))return "LONG";
  if(["SHORT","SELL",-1,"-1"].includes(s))return "SHORT";
  throw Error("PEER_SIDE_UNKNOWN");
 };
 const add=(kind:V4PeerKind,s:string,sg:any,q:number)=>{
  const symbol=sym(s);
  if(owners.some(o=>o.symbol===symbol))throw Error("MULTIPLE_POSITION_OWNERS");
  if(!(q>0)||!Number.isFinite(q))throw Error("INVALID_PEER_QUANTITY");
  owners.push({owner:kind,symbol,side:side(sg),qty:q,gross:0,pendingGross:0,crypto:kind!=="V52"});
 };
 for(const s of sources){
  const r=s.raw;
  if(!/^[a-f0-9]{40}$/.test(s.programSha))throw Error("PEER_PROGRAM_SHA_INVALID");
  const retired=s.kind==="V12"&&s.service?.retiredV12===true&&!s.service.active;
  const attestedSha=lineageMode==="ATTEST_EACH_PEER"?s.programSha:expectedSha;
  if(retired){
   // Legacy V12 is intentionally stopped before V4 cutover; its last state
   // must be flat, with no pending work, and its own release SHA attested.
   if(!/^[a-f0-9]{40}$/.test(s.programSha)||
      s.programSha!==(r.runtimeCommitSha??r.runtimeSha)||
      (r.activePositions?.length??0)>0||r.active||r.pending||
      r.dd1296UnaccountedExits?.length||r.manualReview)
    throw Error("V4_RETIRED_V12_NOT_SIGNED_FLAT");
  }else if(
   (lineageMode==="UNIFIED_RELEASE"&&s.programSha!==expectedSha)||
   (r.runtimeCommitSha&&r.runtimeCommitSha!==attestedSha)||
   (r.runtimeSha&&r.runtimeSha!==attestedSha))
   throw Error("PEER_PROGRAM_LINEAGE_MISMATCH");
  const obs=s.service;
  const liveObservation=obs&&obs.active&&obs.mainPid>0&&
   obs.observedAt<=now&&now-obs.observedAt<=15000&&
   obs.unit.endsWith("@"+attestedSha+".service");
  const retiredObservation=retired&&obs?.observedAt!==undefined&&
   obs.observedAt<=now&&now-obs.observedAt<=15000;
  const age=now-r.updatedAt;
  if(!Number.isFinite(r.updatedAt)||age<0||
    (age>120000&&!(
      (liveObservation&&age<=6*3600000)||
      retiredObservation
    )))throw Error("STALE_PEER_OWNER_SNAPSHOT");
  if(r.pending||r.pendingOrder||r.manualReview||r.manualReviewReason||
     r.executionReview||r.bootstrapRequired)throw Error("PEER_PENDING_OR_MANUAL_REVIEW:"+s.kind);
  if(s.kind==="V12"){
   if(r.schema!=="v12-x1-all-runner-state/v2"||
      r.strategyId!=="V12_X1.00_ALL"||r.mode!=="LIVE"||
      (r.activePositions!==undefined&&!Array.isArray(r.activePositions)))
      throw Error("UNKNOWN_V12_OWNER_SCHEMA");
   for(const p of (r.activePositions??(r.active?[r.active]:[])))add(s.kind,p.symbol,p.side,Number(p.quantity));
  }else if(["PENGU","Q102","FET","RESIDUAL"].includes(s.kind)){
   const knownFlatWithoutPosition=!r.position&&!r.pending&&(
    s.kind==="Q102"&&r.version===1&&r.strategyId==="QUALITY102_CAUSAL_V1"||
    s.kind==="FET"&&r.schema==="fet-brk48-residual-state/v1"&&r.strategyId==="FET_BRK48_RESIDUAL"||
    s.kind==="RESIDUAL"&&r.schema==="disdex-idle-residual-long-state/v1"||
    s.kind==="PENGU"&&r.version===2&&r.strategyId==="PENGU_DUAL_LS_V2_FINAL"&&r.mode==="LIVE"
   );
   if(!("position" in r)&&!knownFlatWithoutPosition)throw Error("UNKNOWN_PEER_OWNER_SCHEMA");
   if(r.position)add(s.kind,s.kind==="PENGU"?"PENGU":r.position.symbol,r.position.side,Number(r.position.quantity));
  }else if(s.kind==="V52"){
   if(!r.positions||typeof r.positions!=="object")throw Error("UNKNOWN_V52_OWNER_SCHEMA");
   for(const p of Object.values(r.positions) as any[])if(p)add(s.kind,p.symbol,p.asterOpenSide??p.side,Number(p.asterQty??p.quantity));
  }else{
   const validFlatHype=s.kind==="HYPE_LONG"&&
    r.schema==="disdex-hype-zec-long/v1"&&r.mode==="LIVE"&&r.positions===undefined;
   if(!Array.isArray(r.positions)&&!validFlatHype)throw Error("UNKNOWN_PEER_POSITIONS_SCHEMA");
   for(const p of (r.positions??[]))if(s.kind!=="HYPE_LONG"||p.strategy==="HYPE_LONG")
    add(s.kind,p.symbol,p.side,Number(p.quantity));
  }
 }
 return owners;
}
