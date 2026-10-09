/**
 * Concrete V4 binding to the existing cross-strategy pending exposure registry.
 * All writes require the existing account lease. Reservation identity is the
 * persisted client ID, independent of lease/restart; no venue calls occur here.
 */
import {open,lstat} from "node:fs/promises";
import {dirname} from "node:path";
import type {AccountLockHandle} from "./disdex-account-order-lock";
import {readPendingExposureRegistry,upsertPendingExposure,releasePendingExposure,type PendingExposureEntry} from "./disdex-pending-exposure-registry";
import {V4ExecutionStore,type V4ExecutionDocument} from "./v12-v4-execution-store";
import type {V4DurableOrderCommand,V4DispatchGuards} from "./v12-v4-durable-orders";
import {productionGross} from "./v12-v4-production-lifecycle";
import {V12_V4_MAXIMUM_DRAWDOWN} from "../config/v12V4AdoptionRiskPolicy";
export const V4_SHARED_OWNER="V12_V4";
const active=(x:PendingExposureEntry)=>x.status!=="RELEASED";
function bucket(symbol:string,side:string,crypto:boolean){return [symbol,side,crypto?"CRYPTO":"STOCK"].join("|");}
// One complete registry read/write transaction at a time for a held account lease.
// Different processes cannot hold that lease concurrently; different managers
// in this process share this queue rather than racing read-modify-write.
const leaseTails=new WeakMap<AccountLockHandle,Promise<void>>();
function underLease<T>(lease:AccountLockHandle,task:()=>Promise<T>):Promise<T>{
 const previous=leaseTails.get(lease)??Promise.resolve();
 const run=previous.then(task,task),tail=run.then(()=>undefined,()=>undefined);
 leaseTails.set(lease,tail);
 void tail.then(()=>{if(leaseTails.get(lease)===tail)leaseTails.delete(lease);});
 return run;
}
export class V4SharedReservations{
 constructor(readonly store:V4ExecutionStore,readonly lease:AccountLockHandle,readonly path:string,readonly now:()=>number=Date.now){}
 async assertAccountLease(){
  const doc=await this.lease.document();
  if(doc.accountScope!=="ASTER_FUTURES"||doc.ownerId!==this.lease.ownerId||doc.leaseId!==this.lease.leaseId||doc.expiresAt<=Date.now())throw Error("V4_ACCOUNT_LEASE_INVALID");
 }
 private identity(doc:V4ExecutionDocument,cid:string){
  const intent=doc.intents[cid],leg=intent&&doc.state.legs[intent.legId];
  if(!intent||intent.action!=="ENTRY"||!leg)throw Error("V4_RESERVATION_LEG_IDENTITY");
  return {intent,leg};
 }
 private verifyRow(row:PendingExposureEntry,doc:V4ExecutionDocument,cid:string){
  const {leg}=this.identity(doc,cid);
  if(row.reservationId!==cid||row.idempotencyKey!==cid||row.strategyId!==V4_SHARED_OWNER||row.sleeve!=="CRYPTO"||
    row.symbol!==leg.candidate.symbol||row.side!==leg.candidate.effectiveSide||row.runtimeSha!==doc.releaseSha)throw Error("V4_SHARED_RESERVATION_IDENTITY_CONFLICT");
 }
 private async flush(){
  const stat=await lstat(this.path);if(stat.isSymbolicLink()||!stat.isFile())throw Error("V4_SHARED_PATH_UNSAFE");
  const file=await open(this.path,"r+");try{await file.sync();}finally{await file.close();}
  if(process.platform!=="win32"){
   const directory=await open(dirname(this.path),"r");try{await directory.sync();}finally{await directory.close();}
  }
  await this.assertAccountLease();
 }
 async reserve(cid:string,command:V4DurableOrderCommand){return underLease(this.lease,()=>this.reserveUnderLease(cid,command));}
 private async reserveUnderLease(cid:string,command:V4DurableOrderCommand){
  await this.assertAccountLease();
  const doc=this.store.read(),{intent,leg}=this.identity(doc,cid),now=this.now();
  if(intent.stage!=="PREPARED"||JSON.stringify(intent.command)!==JSON.stringify(command)||
    leg.status!=="PENDING_ENTRY"||leg.qty!==0||command.symbol!==leg.candidate.symbol||command.positionSide!==leg.candidate.effectiveSide||
    Math.abs(command.quantity-leg.requestedQty)>1e-12||command.signalTs!==leg.entryTs)throw Error("V4_SHARED_RESERVATION_COMMAND_CONFLICT");
  const mark=[...doc.state.journal].reverse().find(x=>x.type==="ACCOUNT_MARK");
  if(!mark||mark.ts>now||now-mark.ts>30000)throw Error("FRESH_SHARED_ACCOUNT_LEDGER_REQUIRED");
  if(doc.state.initial.holdProtected||doc.state.executionReview||doc.state.maxDrawdown>V12_V4_MAXIMUM_DRAWDOWN+1e-12)throw Error("V4_SHARED_RESERVATION_HOLD");
  const registry=await readPendingExposureRegistry(this.path);
  if(registry.accountScope!=="ASTER_FUTURES")throw Error("V4_SHARED_ACCOUNT_SCOPE_CONFLICT");
  const peers=new Map<string,number>(),covered=new Map<string,number>();
  for(const row of registry.entries.filter(active)){
   if(row.strategyId===V4_SHARED_OWNER){
    this.verifyRow(row,doc,row.reservationId);
    if(row.reservationId!==cid&&row.notionalUsd>doc.state.legs[doc.intents[row.reservationId].legId].reservationUsd+1e-8)
     throw Error("OWN_RESERVATION_NOT_IN_ACCOUNT_LEDGER");
   }else{
    const k=bucket(row.symbol,row.side,row.sleeve==="CRYPTO");peers.set(k,(peers.get(k)??0)+row.notionalUsd);
   }
  }
  for(const row of doc.state.foreign){
   const k=bucket(row.symbol,row.side,row.crypto);
   covered.set(k,(covered.get(k)??0)+row.pendingGross*doc.state.foreignBasisEquityUsd);
  }
  for(const [k,notional]of peers)if((covered.get(k)??0)+1e-8<notional)throw Error("PEER_RESERVATION_NOT_IN_ACCOUNT_LEDGER:"+k);
  const gross=productionGross(doc.state);
  if(gross.recovery>2.5+1e-12||gross.v12>3+1e-12||gross.crypto>3.5+1e-12||gross.total>4.75+1e-12)throw Error("V4_SHARED_GROSS_CAP");
  const prior=registry.entries.find(x=>x.reservationId===cid);
  if(prior){
   this.verifyRow(prior,doc,cid);
   if(prior.status==="RELEASED"||Math.abs(prior.notionalUsd-leg.reservationUsd)>1e-8)throw Error("V4_SHARED_RESERVATION_ALREADY_RETIRED_OR_CHANGED");
   await this.assertAccountLease();return prior;
  }
  const row=await upsertPendingExposure({reservationId:cid,idempotencyKey:cid,strategyId:V4_SHARED_OWNER,
   sleeve:"CRYPTO",symbol:command.symbol,side:command.positionSide,notionalUsd:leg.reservationUsd,
   gross:leg.reservationUsd/doc.state.equityUsd,createdAt:now,runtimeSha:doc.releaseSha},this.path);
  await this.flush();return row;
 }
 async synchronize(cid:string){return underLease(this.lease,()=>this.synchronizeUnderLease(cid));}
 private async synchronizeUnderLease(cid:string){
  await this.assertAccountLease();
  const doc=this.store.read(),{intent,leg}=this.identity(doc,cid);
  const registry=await readPendingExposureRegistry(this.path);
  if(registry.accountScope!=="ASTER_FUTURES")throw Error("V4_SHARED_ACCOUNT_SCOPE_CONFLICT");
  const row=registry.entries.find(x=>x.reservationId===cid);
  if(!row)throw Error("V4_SHARED_RESERVATION_MISSING");this.verifyRow(row,doc,cid);
  if(intent.stage==="TERMINAL"){
   const terminal=doc.state.journal.find(x=>x.type==="ENTRY_TERMINAL"&&x.id===leg.id&&
    x.eventId==="venue-terminal:"+leg.candidate.symbol+":"+intent.venueOrderId);
   if(!intent.venueOrderId||!terminal||leg.status==="PENDING_ENTRY"||leg.reservationUsd!==0)throw Error("VERIFIED_TERMINAL_FILL_JOURNAL_REQUIRED");
   if(row.status!=="RELEASED"){await releasePendingExposure(cid,this.path);await this.flush();}
   return;
  }
  if(row.status==="RELEASED")throw Error("V4_SHARED_RESERVATION_RELEASED_BEFORE_TERMINAL");
  // Ambiguous submissions retain the larger outstanding amount until order/trade reconciliation.
  const unknown=intent.stage==="UNKNOWN"||intent.stage==="SUBMITTING";
  const notional=unknown?Math.max(row.notionalUsd,leg.reservationUsd):leg.reservationUsd;
  await upsertPendingExposure({...row,notionalUsd:notional,gross:notional/doc.state.equityUsd,
   status:unknown?"UNKNOWN":intent.stage==="PREPARED"?"PENDING":"SUBMITTED",updatedAt:this.now()},this.path);
  await this.flush();
 }
}

/** Production wiring reuses the existing account lease; this does not grant authority. */
export function bindV4SharedDispatchGuards(reservations:V4SharedReservations,assertAuthority:V4DispatchGuards["assertAuthority"]):V4DispatchGuards{
 return {assertAuthority,assertAccountLease:()=>reservations.assertAccountLease(),reserveShared:async(cid,command)=>{await reservations.reserve(cid,command);}};
}
