/**
 * V12 V4 tick engine. Supports deterministic dry-run or explicitly authorized
 * entry/exit transport through the durable per-account lease. Never fabricates
 * missing signed positions or assumes an ACK means an executed fill.
 */
import type {AsterV3Client,AsterBalanceRow,AsterPositionRiskRow,AsterOrderResponse} from "./aster-v3-client";
import type {AccountLockHandle,FileAccountOrderLock} from "./disdex-account-order-lock";
import {readPendingExposureRegistry,type PendingExposureRegistry} from "./disdex-pending-exposure-registry";
import {V4ExecutionStore,advanceV4Protection,advanceV4Intent,type V4ExecutionDocument,type V4OrderIntent,type V4ProtectionPhase} from "./v12-v4-execution-store";
import {V4SharedReservations,bindV4SharedDispatchGuards} from "./v12-v4-shared-reservations";
import {V4DurableOrderDispatcher,createV4AsterOrderGateway,type V4DurableOrderCommand} from "./v12-v4-durable-orders";
import type {V12AsterLiveAdapter} from "./v12-aster-live-adapter";
import {V4OrderCycle} from "./v12-v4-order-cycle";
import {verifyV4ResidentStops} from "./v12-v4-resident-stop-owners";
import {planV4RetiredStops} from "./v12-v4-stop-retirement";
import {appendV4ClosedExitBars,type V4ExitFeed} from "./v12-v4-live-exit-feed";
import {createV4FourRuleState,desiredV4FourRuleStop} from "./v12-v4-four-rule-policy";
import {applyProductionEvent,planProductionEntry,productionExitSpec,nativeEvidenceForProductionRoute,type EntryPlanInput} from "./v12-v4-production-lifecycle";
import {buildV4AccountMark,type V4SignedMark} from "./v12-v4-peer-account-mark";
import type {V4PeerSource,V4PeerLineageMode} from "./v12-v4-peer-state-owners";
import type {V4LiveDecisionSnapshot} from "./v12-v4-live-candidate-builder";
export type V4PreparedDecision =
 | {kind:"READY";preparedAtMs:number;decision:V4LiveDecisionSnapshot}
 | {kind:"FAILED";preparedAtMs:number;reason:string};

export type V4TickResult={status:"locked"|"observing"|"blocked"|"submitted"|"exited";reason:string;
 eventTs:number;candidateCount:number;orderEnabled:boolean};
export function isReconciliableV4EntryIntent(intent:Pick<V4OrderIntent,"action"|"stage">):boolean{
 return intent.action==="ENTRY"&&intent.stage!=="TERMINAL";
}
export function hasUnresolvedV4EntryLifecycle(doc: Pick<V4ExecutionDocument,"intents"|"state">): boolean {
 return Object.values(doc.intents).some(isReconciliableV4EntryIntent)||
  Object.values(doc.state.legs).some(leg=>leg.status==="PENDING_ENTRY"||leg.reservationUsd>1e-12);
}
function safeDecisionFailureReason(error:unknown){
 const raw=error instanceof Error?error.message:"NON_ERROR_DECISION_FAILURE";
 return raw.replace(/\b(0x[a-fA-F0-9]{40,64})\b/g,"[REDACTED]")
  .replace(/(secret|private.?key|signature|token|api.?key)=?[^\s,;]+/ig,"$1=[REDACTED]")
  .replace(/[\r\n\t]+/g," ").replace(/\s{2,}/g," ").slice(0,180)||"DECISION_SOURCE_UNAVAILABLE";
}
export function classifyV4RecoverableExitFeedFailure(error:unknown,eventTs=Date.now()):V4TickResult|undefined{
 const reason=safeDecisionFailureReason(error);
 if(!/^V4_EXIT_FEED_(?:M5_)?GAP:/.test(reason))return;
 return {status:"blocked",reason:"V4_EXIT_FEED_GAP_RETRY:"+reason,eventTs,
  candidateCount:0,orderEnabled:false};
}
export function v4ExitFeedWindow(entryTs:number,durationHours:number,now:number){
 if(!Number.isFinite(entryTs)||!Number.isFinite(durationHours)||durationHours<=0||
   !Number.isFinite(now)||now<entryTs)throw Error("V4_EXIT_FEED_WINDOW_INVALID");
 return {fromTs:entryTs,untilTs:Math.min(now,entryTs+durationHours*3600000)};
}
export interface V4RunnerDependencies{
 store:V4ExecutionStore;accountLock:FileAccountOrderLock;
 adapter:V12AsterLiveAdapter;
 client:Pick<AsterV3Client,"getBalances"|"getPositions"|"getOpenOrders"|"getUserTrades"|"getIncomeHistory">;
 pendingRegistryPath:string;
 fetchDecision:()=>Promise<V4LiveDecisionSnapshot>;
 fetchExitFeed:(symbol:string,fromTs?:number,untilTs?:number)=>Promise<V4ExitFeed>;
 fetchPeers:()=>Promise<V4PeerSource[]>;
 assertAuthority:(cmd:V4DurableOrderCommand)=>Promise<void>;
 assertSourceParity:(decision:V4LiveDecisionSnapshot)=>Promise<void>;
 assertEntrySafety:()=>Promise<void>;
 requiredResidentStop:(input:{route:string;symbol:string;side:"LONG"|"SHORT";entryPrice:number;atr14:number})=>Promise<number>;
 quantityNormalizer:EntryPlanInput["quantityNormalizer"];
 referencePrice:(symbol:string)=>Promise<number>;
 minimumVenueOrderNotional:(symbol:string,price:number)=>Promise<number>;
 canaryEntry?:{maxNotionalUsd:number};
 peerLineageMode?:V4PeerLineageMode;
 now?:()=>number;
}
export class V4RunnerEngine{
 readonly now:()=>number;
 constructor(readonly deps:V4RunnerDependencies){this.now=deps.now??Date.now;}
 private commitEvent(event:Parameters<typeof applyProductionEvent>[1]){
  const d=this.deps.store.read(),next=applyProductionEvent(d.state,event);
  if(next===d.state)return d;
  return this.deps.store.commit(d.revision,{...d,state:next});
 }
 private commitProtection(legId:string,phase:V4ProtectionPhase,protectedQty=0,stopClientOrderId?:string){
  const d=this.deps.store.read();
  const next=advanceV4Protection(d,legId,phase,this.now(),protectedQty,stopClientOrderId);
  return this.deps.store.commit(d.revision,next);
 }

 /**
  * Cold market-data work is moved outside the shared account mutex only if this
  * V4 store is completely flat and has no durable order intents. Any open,
  * unknown, or recovery-required intent retains the original priority:
  * acquire the lock first, reconcile fills, and check resident protection.
  *
  * This fetch reads completed venue candles only; no signed account state or
  * order mutation may be hoisted out of the protected section.
  */
 async prepareFlatMarketDecision():Promise<V4PreparedDecision|undefined>{
  const local=this.deps.store.read();
  if(Object.keys(local.intents).length>0||
    Object.values(local.state.legs).some(leg=>leg.qty>0||leg.status==="PENDING_ENTRY"))return;
  const preparedAtMs=this.now();
  try{
   return {kind:"READY",preparedAtMs,decision:await this.deps.fetchDecision()};
  }catch(error){
   return {kind:"FAILED",preparedAtMs,
    reason:safeDecisionFailureReason(error)};
  }
 }
 async tick(prepared?:V4PreparedDecision):Promise<V4TickResult>{
  const at=this.now();
  const lease=await this.deps.accountLock.acquire("V12_V4_RUNNER");
  if(!lease)return {status:"locked",reason:"SHARED_ACCOUNT_LOCK_BUSY",eventTs:at,candidateCount:0,orderEnabled:false};
   let renewalError=false;
   const renewalTimer=setInterval(()=>{
    void lease.renew().catch(()=>{renewalError=true;});
   },lease.renewalIntervalMs);
   try{
    // Renew immediately so a lease acquired after a short-lived contention
    // window has a fresh deadline before signed reconciliation begins.
    await lease.renew();
    const result=await this.underLease(lease,prepared);
    if(renewalError)throw Error("V4_ACCOUNT_LEASE_RENEWAL_FAILED");
    return result;
   }finally{
    clearInterval(renewalTimer);
    await lease.release();
   }
 }
 private abandonPreparedEntry(cid:string){
  const at=this.now(),doc=this.deps.store.read(),intent=doc.intents[cid];
  if(!intent||intent.action!=="ENTRY"||intent.stage!=="PREPARED")return;
  const leg=doc.state.legs[intent.legId];
  if(!leg||leg.qty>0)throw Error("V4_PREPARED_ENTRY_STATE_CONFLICT:"+cid);
  let next=doc;
  if(leg.status==="PENDING_ENTRY")next={...next,state:applyProductionEvent(next.state,{type:"ENTRY_TERMINAL",eventId:"recovery-unsent-entry:"+cid,ts:at,id:leg.id})};
  next=advanceV4Intent(next,cid,"TERMINAL",at);
  this.deps.store.commit(doc.revision,next);
  this.commitProtection(intent.legId,"CLOSED",0);
 }
 private async ensureResidentProtection(legId:string,dispatcher:V4DurableOrderDispatcher,cycle:V4OrderCycle):Promise<boolean>{
  const d=this.deps;let doc=d.store.read(),leg=doc.state.legs[legId];
  if(!leg||leg.qty<=0||leg.status==="CLOSED"||leg.status==="CANCELLED")return true;
  if(!(leg.entryNotional>0)||!(leg.entryAtr&&leg.entryAtr>0))throw Error("V4_PROTECTION_RECOVERY_ENTRY_EVIDENCE_MISSING:"+legId);
  const average=leg.entryNotional/leg.qty;
  const approvedRaw=await d.requiredResidentStop({route:leg.candidate.route,symbol:leg.candidate.symbol,side:leg.candidate.effectiveSide,entryPrice:average,atr14:leg.entryAtr});
  const policyRaw=desiredV4FourRuleStop({route:leg.candidate.route,side:leg.candidate.effectiveSide,
   fill:average,state:leg.fourRuleState??createV4FourRuleState()});
  if(policyRaw!==undefined&&leg.candidate.effectiveSide==="LONG"&&policyRaw<approvedRaw)
   throw Error("V4_FOUR_RULE_STOP_LOOSENS_APPROVED_PROTECTION:"+legId);
  const raw=policyRaw===undefined?approvedRaw:policyRaw;
  if(!(raw>0)||!Number.isFinite(raw)||(leg.candidate.effectiveSide==="LONG"?raw>=average:raw<=average))throw Error("V4_PROTECTION_RECOVERY_STOP_INVALID:"+legId);
  const normalized=await d.adapter.normalizeStopPrice(leg.candidate.symbol,raw),desired=normalized.price;
  if(!(desired>0)||!Number.isFinite(desired))throw Error("V4_PROTECTION_RECOVERY_STOP_NORMALIZATION_INVALID:"+legId);
  const stopIntents=Object.values(doc.intents).filter(i=>i.legId===legId&&i.action==="STOP");
  let open=await d.client.getOpenOrders(leg.candidate.symbol);
  for(const intent of stopIntents.filter(i=>open.some(o=>o.clientOrderId===i.clientOrderId))){
   await dispatcher.reconcile(intent.clientOrderId,this.now());
  }
  doc=d.store.read();leg=doc.state.legs[legId];
  const same=Object.values(doc.state.legs).filter(l=>l.qty>0&&l.candidate.symbol===leg.candidate.symbol);
  const sides=new Set(same.map(l=>l.candidate.effectiveSide));
  if(sides.size!==1)throw Error("V4_PROTECTION_RECOVERY_OPPOSING_VIRTUAL_LEGS:"+leg.candidate.symbol);
  const expected=same.reduce((n,l)=>n+l.qty*(l.candidate.effectiveSide==="LONG"?1:-1),0);
  const positions=await d.client.getPositions(leg.candidate.symbol);
  const actual=positions.filter(p=>String(p.symbol).toUpperCase()===leg.candidate.symbol).reduce((n,p)=>n+Number(p.positionAmt),0);
  if(!Number.isFinite(actual)||Math.abs(actual-expected)>Math.max(1e-8,Math.abs(expected)*1e-7)){
   for(const intent of Object.values(doc.intents).filter(i=>i.legId===legId&&["STOP","TAKE_PROFIT","EXIT"].includes(i.action)&&i.stage!=="PREPARED")){
    const proof=await dispatcher.reconcile(intent.clientOrderId,this.now());
    if(proof&&["FILLED","PARTIALLY_FILLED"].includes(String(proof.status).toUpperCase()))return false;
   }
   throw Error("V4_PROTECTION_RECOVERY_VENUE_QTY_DRIFT:"+leg.candidate.symbol);
  }
  open=await d.client.getOpenOrders(leg.candidate.symbol);
  const active=Object.values(doc.intents).filter(i=>i.legId===legId&&i.action==="STOP"&&open.some(o=>o.clientOrderId===i.clientOrderId));
  const matches=active.filter(i=>{
   const o=open.find(x=>x.clientOrderId===i.clientOrderId)!;const c=i.command as V4DurableOrderCommand|undefined;
   const remaining=Number(o.origQty)-Number(o.executedQty);
   return c&&o.type==="STOP_MARKET"&&o.reduceOnly===true&&String(o.status).toUpperCase()==="NEW"&&
    Math.abs(Number(o.stopPrice)-desired)<=Math.max(1e-12,desired*1e-10)&&
    Math.abs(remaining-leg.qty)<=Math.max(1e-8,leg.qty*1e-7)&&
    Math.abs(c.price-desired)<=Math.max(1e-12,desired*1e-10)&&
    Math.abs(c.quantity-leg.qty)<=Math.max(1e-8,leg.qty*1e-7);
  });
  let targetCid:string;
  if(matches.length){
   if(matches.length!==1)throw Error("V4_PROTECTION_RECOVERY_DUPLICATE_MATCHING_STOPS:"+legId);
   targetCid=matches[0].clientOrderId;
  }else{
   const sequence=Object.values(doc.intents).filter(i=>i.legId===legId&&i.action==="STOP").reduce((n,i)=>Math.max(n,i.sequence+1),0);
   const command:V4DurableOrderCommand={legId,action:"STOP",sequence,symbol:leg.candidate.symbol,positionSide:leg.candidate.effectiveSide,quantity:leg.qty,price:desired,signalTs:leg.entryTs};
   await d.assertAuthority(command);
   targetCid=dispatcher.prepare(command,this.now());
   this.commitProtection(legId,"STOP_SENT_UNKNOWN",0,targetCid);
   const intent=d.store.read().intents[targetCid];
   let proof;
   if(intent.stage==="PREPARED"){await dispatcher.submit(targetCid,this.now());proof=await dispatcher.reconcile(targetCid,this.now());}
   else proof=await dispatcher.recoverReductionSameId(targetCid,this.now());
   if(!proof)proof=await dispatcher.recoverReductionSameId(targetCid,this.now());
   if(!proof)throw Error("V4_PROTECTION_RECOVERY_READBACK_MISSING:"+targetCid);
   if(["FILLED","PARTIALLY_FILLED"].includes(String(proof.status).toUpperCase()))return false;
   const remaining=Number(proof.quantity)-Number(proof.executedQuantity);
   if(proof.type!=="STOP_MARKET"||proof.reduceOnly!==true||String(proof.status).toUpperCase()!=="NEW"||
    Math.abs(remaining-leg.qty)>Math.max(1e-8,leg.qty*1e-7)||
    Math.abs(Number(proof.stopPrice)-desired)>Math.max(1e-12,desired*1e-10))throw Error("V4_PROTECTION_RECOVERY_CONFIRMATION_INVALID:"+targetCid);
  }
  this.commitProtection(legId,"STOP_CONFIRMED",leg.qty,targetCid);
  const confirmed=await d.client.getOpenOrders(leg.candidate.symbol);
  if(!confirmed.some(o=>o.clientOrderId===targetCid))throw Error("V4_PROTECTION_RECOVERY_CONFIRMED_STOP_NOT_OPEN:"+targetCid);
  const old=Object.values(d.store.read().intents).filter(i=>i.legId===legId&&i.action==="STOP"&&i.clientOrderId!==targetCid&&confirmed.some(o=>o.clientOrderId===i.clientOrderId));
  for(const intent of old)await d.adapter.cancel(intent.clientOrderId);
  if(old.length){
   const readback=await d.client.getOpenOrders(leg.candidate.symbol);
   if(old.some(i=>readback.some(o=>o.clientOrderId===i.clientOrderId))||!readback.some(o=>o.clientOrderId===targetCid))throw Error("V4_PROTECTION_RECOVERY_SUPERSEDE_NOT_CONFIRMED:"+legId);
  }
  return true;
 }
 private async reconcileEntriesAndProtection(dispatcher:V4DurableOrderDispatcher,cycle:V4OrderCycle){
  const d=this.deps;
  for(const snapshot of Object.values(d.store.read().intents).filter(isReconciliableV4EntryIntent)){
   let intent=d.store.read().intents[snapshot.clientOrderId];
   if(intent.stage==="PREPARED"){this.abandonPreparedEntry(intent.clientOrderId);continue;}
   const currentProtection=d.store.read().protections[intent.legId];
   if(!currentProtection||currentProtection.phase==="ENTRY_PREPARED")this.commitProtection(intent.legId,"ENTRY_SENT",0);
   const proof=await dispatcher.reconcile(intent.clientOrderId,this.now());
   if(!proof)throw Error("V4_ENTRY_ORDER_ID_UNRESOLVED:"+intent.clientOrderId);
   await cycle.reconcileEntry(intent.clientOrderId,this.now());
   const leg=d.store.read().state.legs[intent.legId];
   if(!leg)throw Error("V4_ENTRY_RECOVERY_LEG_MISSING:"+intent.legId);
   if(leg.status==="CANCELLED"){this.commitProtection(leg.id,"CLOSED",0);continue;}
   if(leg.qty<=0)continue;
   const terminal=["FILLED","CANCELED","EXPIRED","REJECTED"].includes(String(proof.status).toUpperCase());
   this.commitProtection(leg.id,terminal?"ENTRY_FILLED_STOP_PENDING":"ENTRY_PARTIALLY_FILLED",0);
   await this.ensureResidentProtection(leg.id,dispatcher,cycle);
  }
 }
 private async reconcileReductions(dispatcher:V4DurableOrderDispatcher,cycle:V4OrderCycle){
  const d=this.deps;
  for(const snapshot of Object.values(d.store.read().intents).filter(i=>i.action!=="ENTRY")){
   let intent=d.store.read().intents[snapshot.clientOrderId];
   let proof;
   if(intent.stage==="PREPARED"){await dispatcher.submit(intent.clientOrderId,this.now());proof=await dispatcher.reconcile(intent.clientOrderId,this.now());}
   else proof=await dispatcher.reconcile(intent.clientOrderId,this.now());
   if(!proof&&intent.stage!=="TERMINAL")proof=await dispatcher.recoverReductionSameId(intent.clientOrderId,this.now());
   if(!proof)continue;
   if(["FILLED","PARTIALLY_FILLED"].includes(String(proof.status).toUpperCase())){
    const before=d.store.read().state.legs[intent.legId];
    if(before&&before.qty>0&&before.status==="OPEN")this.commitProtection(intent.legId,"EXIT_PENDING",before.qty,d.store.read().protections[intent.legId]?.stopClientOrderId);
    await cycle.reconcileExit(intent.clientOrderId,this.now(),this.now());
    const after=d.store.read().state.legs[intent.legId];
    if(after?.status==="CLOSED"||after?.qty===0)this.commitProtection(intent.legId,"CLOSED",0);
   }
  }
 }
 private async underLease(lease:AccountLockHandle,prepared?:V4PreparedDecision):Promise<V4TickResult>{
  const at=this.now(), d=this.deps;
  const reserv=new V4SharedReservations(d.store,lease,d.pendingRegistryPath,this.now);
  const dispatcher=new V4DurableOrderDispatcher(d.store,createV4AsterOrderGateway(d.adapter),
   bindV4SharedDispatchGuards(reserv,d.assertAuthority));
  const cycle=new V4OrderCycle(d.store,dispatcher,reserv,d.client);
  // Protection recovery runs before ordinary account/market reads. A newly
  // reconciled ENTRY fill is never allowed to reach signal processing without
  // first attempting to establish its resident STOP.
  await this.reconcileEntriesAndProtection(dispatcher,cycle);
  // Funding for an in-flight or stop-closed position must be signed and
  // journalled before applying a venue close to the virtual owner.
  await cycle.reconcileFundingUpTo(this.now());
  await this.reconcileReductions(dispatcher,cycle);
  // A partial ENTRY may have accumulated additional fills while reduction
  // reconciliation was running. Re-evaluate exact STOP quantity/trigger.
  await this.reconcileEntriesAndProtection(dispatcher,cycle);
  let [positions,openOrders,balances,peers,registry]=await Promise.all([
   d.client.getPositions(),d.client.getOpenOrders(),d.client.getBalances(),
   d.fetchPeers(),readPendingExposureRegistry(d.pendingRegistryPath),
  ]);
  // After a crash between signed EXIT fill and STOP cancellation, retire only
  // the proven CLOSED leg's reduce-only STOP while preserving all surviving
  // same-symbol virtual legs and their independently verified STOPs.
  const toRetire=planV4RetiredStops({state:d.store.read().state,
   intents:d.store.read().intents,openOrders,positions});
  if(toRetire.length){
   for(const cid of toRetire)await d.adapter.cancel(cid);
   const refreshed=await Promise.all([
    d.client.getPositions(),d.client.getOpenOrders(),d.client.getBalances(),
    d.fetchPeers(),readPendingExposureRegistry(d.pendingRegistryPath),
   ]);
   [positions,openOrders,balances,peers,registry]=refreshed;
   if(toRetire.some(cid=>openOrders.some(o=>o.clientOrderId===cid)))
    throw Error("V4_RETIRED_STOP_CANCEL_NOT_CONFIRMED");
  }
  // Account reads can be delayed by the shared Aster rate budget. Refresh the
  // peer systemd/state attestation immediately before the signed account mark
  // so a valid peer is not rejected only because the earlier concurrent read
  // completed more than the 15-second observation window ago. This does not
  // relax the freshness gate: the refreshed attestation must still be active,
  // exact-SHA, and fresh when v4PeerOwners validates it.
  peers=await d.fetchPeers();
  const usdt=balances.find(b=>b.asset==="USDT");
  const walletUsd=Number(usdt?.balance);
  let unrealizedUsd=0;
  for(const p of positions)if(Math.abs(Number(p.positionAmt))>1e-12){
   const pnl=p.unRealizedProfit??p.unrealizedProfit;
   if(pnl===undefined||!Number.isFinite(Number(pnl)))throw Error("V4_SIGNED_UNREALIZED_PNL_REQUIRED");
   unrealizedUsd+=Number(pnl);
  }
  const equityUsd=walletUsd+unrealizedUsd;
  if(!(equityUsd>0)||!Number.isFinite(Number(usdt?.availableBalance)))
   throw Error("V4_SIGNED_USDT_ACCOUNT_UNAVAILABLE");
  const mark:V4SignedMark={capturedAt:this.now(),equityUsd,
   positions:positions.map(p=>({symbol:String(p.symbol).toUpperCase(),
    quantity:Number(p.positionAmt),markPrice:Number(p.markPrice)}))};
  const base=d.store.read(),accountMark=buildV4AccountMark({sources:peers,venue:mark,
   registry,state:base.state,expectedPeerSha:base.releaseSha,now:mark.capturedAt,
   eventId:"signed-account:"+mark.capturedAt,peerLineageMode:d.peerLineageMode});
  this.commitEvent(accountMark.event);
  const current=d.store.read();
  // Each virtual leg must own exactly one signed Aster resident STOP. Merely
  // finding one symbol-level aggregate STOP misses unprotected sub-legs.
  verifyV4ResidentStops(current.state,current.intents,openOrders);
  const exit=await this.processExitBars(dispatcher,cycle);
  if(exit)return exit;
  const afterExit=d.store.read();
  if(hasUnresolvedV4EntryLifecycle(afterExit))
   return {status:"blocked",reason:"V4_ENTRY_RECONCILIATION_REQUIRED",eventTs:this.now(),candidateCount:0,orderEnabled:false};
  // Recheck the actual H2 boundary after waiting and after all signed account
  // and protective STOP reconciliation. Never carry a pre-lock candidate across
  // an H2 boundary or a newly nonflat/unknown V4 state.
  const boundary=(ms:number)=>Math.floor(ms/7_200_000);
  const stillFlat=Object.keys(d.store.read().intents).length===0&&
   Object.values(d.store.read().state.legs).every(leg=>leg.qty<=0&&leg.status!=="PENDING_ENTRY");
  const reusable=Boolean(prepared&&stillFlat&&prepared.preparedAtMs<=this.now()&&
   boundary(prepared.preparedAtMs)===boundary(this.now()));
  if(reusable&&prepared?.kind==="FAILED")return {status:"observing",
   reason:"V4_MARKET_DATA_UNAVAILABLE:"+prepared.reason,eventTs:this.now(),candidateCount:0,orderEnabled:false};
  let decision:V4LiveDecisionSnapshot;
  try{
   decision=reusable&&prepared?.kind==="READY"?prepared.decision:await d.fetchDecision();
  }catch(error){
   return {status:"observing",reason:"V4_MARKET_DATA_UNAVAILABLE:"+safeDecisionFailureReason(error),
    eventTs:this.now(),candidateCount:0,orderEnabled:false};
  }
  if(decision.orderEnabled!==false||decision.tradingMutation!==0||
   decision.realOrderEnabledV4!==0)
   throw Error("V4_CANDIDATE_SOURCE_UNTRUSTED");
  if(decision.errors.length)return {status:"observing",
   reason:"V4_MARKET_DATA_UNAVAILABLE:"+safeDecisionFailureReason(new Error(decision.errors.slice(0,3).join(";"))),
   eventTs:this.now(),candidateCount:0,orderEnabled:false};
  if(this.now()-decision.capturedAtMs>135*60000||decision.capturedAtMs>this.now())
   return {status:"observing",reason:"V4_MARKET_DATA_UNAVAILABLE:V4_DECISION_SNAPSHOT_STALE",
    eventTs:this.now(),candidateCount:0,orderEnabled:false};
  if(!decision.candidates.length)
   return {status:"observing",reason:"NO_NATIVE_ENTRY_CANDIDATES",eventTs:this.now(),candidateCount:0,orderEnabled:false};
  return await this.tryCandidate(decision,dispatcher,cycle);
 }
 private async processExitBars(dispatcher:V4DurableOrderDispatcher,cycle:V4OrderCycle):Promise<V4TickResult|null>{
  const d=this.deps;
  const opens=Object.values(d.store.read().state.legs)
   .filter(l=>l.status==="OPEN"&&l.qty>0);
  for(const old of opens){
   if(!old.plannedExit){
   const spec=productionExitSpec(old.candidate.route);
   const window=v4ExitFeedWindow(old.entryTs,spec.hours,this.now());
   const feed=await d.fetchExitFeed(old.candidate.symbol,window.fromTs,window.untilTs);
    const current=d.store.read(),updated=appendV4ClosedExitBars(current.state,old.id,feed,this.now());
    if(updated!==current.state)d.store.commit(current.revision,{...current,state:updated});
    const afterPolicy=d.store.read().state.legs[old.id];
    if(afterPolicy&&afterPolicy.status==="OPEN"&&!afterPolicy.plannedExit)
     await this.ensureResidentProtection(old.id,dispatcher,cycle);
   }
   const leg=d.store.read().state.legs[old.id];
   if(!leg.plannedExit)continue;
   const at=this.now();
   if(at-leg.plannedExit.exitTs>15*60000)throw Error("V4_STALE_EXIT_DECISION_REQUIRES_REVIEW:"+old.id);
   const same=Object.values(d.store.read().state.legs)
    .filter(l=>l.candidate.symbol===leg.candidate.symbol&&l.qty>0);
   if(same.some(x=>x.candidate.effectiveSide!==leg.candidate.effectiveSide))
    throw Error("V4_SHARED_SYMBOL_OPPOSING_EXIT_NOT_CERTIFIED");
   // Other legs keep independent exact stop order ownership throughout.
   // Broker one-way-mode signed quantity is verified again after the
   // current leg has fully filled and its own stop is removed.
   const price=await d.referencePrice(leg.candidate.symbol);
   const cmd:V4DurableOrderCommand={legId:leg.id,action:"EXIT",sequence:0,
    symbol:leg.candidate.symbol,positionSide:leg.candidate.effectiveSide,
    quantity:leg.qty,price,signalTs:leg.entryTs};
   await d.assertAuthority(cmd);
   this.commitEvent({type:"EXIT_REQUEST",eventId:"route-exit:"+leg.id,ts:at,id:leg.id,qty:leg.qty});
   this.commitProtection(leg.id,"EXIT_PENDING",leg.qty,d.store.read().protections[leg.id]?.stopClientOrderId);
   const cid=dispatcher.prepare(cmd,this.now());
   await dispatcher.submit(cid,this.now());
   await cycle.reconcileExit(cid,this.now(),this.now());
   if(d.store.read().state.legs[leg.id].qty>1e-10)
    throw Error("V4_EXIT_RESIDUAL_POSITION_REQUIRES_REVIEW");
   const after=d.store.read();
   // Never cancel protection based only on an EXIT ACK or a local fill ledger.
   // Reconcile the actual net position and all surviving same-symbol STOPs
   // *before* retiring this leg's STOP, under the account lease.
   const otherRemaining=Object.values(after.state.legs).filter(l=>l.qty>0&&
    l.candidate.symbol===leg.candidate.symbol);
   const expected=otherRemaining.reduce((sum,l)=>sum+l.qty*
    (l.candidate.effectiveSide==="LONG"?1:-1),0);
   const assertNet=(positions:Awaited<ReturnType<typeof d.client.getPositions>>)=>{
    const actual=positions.filter(p=>p.symbol===leg.candidate.symbol)
     .reduce((sum,p)=>sum+Number(p.positionAmt),0);
    if(!Number.isFinite(actual)||Math.abs(expected-actual)>Math.max(1e-8,Math.abs(expected)*1e-7))
     throw Error("V4_SHARED_SYMBOL_EXIT_VENUE_QTY_DRIFT");
   };
   const [beforePositions,beforeOrders]=await Promise.all([
    d.client.getPositions(),d.client.getOpenOrders()]);
   assertNet(beforePositions);
   const activeStops=Object.values(after.intents).filter(i=>i.legId===leg.id&&i.action==="STOP"&&
    beforeOrders.some(o=>o.clientOrderId===i.clientOrderId));
   if(activeStops.length!==1)throw Error("V4_COMPLETED_EXIT_STOP_IDENTITY_UNCERTAIN");
   const stopCid=activeStops[0].clientOrderId;
   const pendingRetire=planV4RetiredStops({state:after.state,intents:after.intents,
    openOrders:beforeOrders,positions:beforePositions});
   if(beforeOrders.some(o=>o.clientOrderId===stopCid)){
    if(!pendingRetire.includes(stopCid))throw Error("V4_EXIT_STOP_RETIREMENT_NOT_ATTESTED");
    await d.adapter.cancel(stopCid);
   }
   // A missing retired STOP is safe only after verifying that all surviving
   // legs are still protected and the exchange net position is unchanged.
   const [venuePositions,readbackOrders]=await Promise.all([
    d.client.getPositions(),d.client.getOpenOrders()]);
   if(readbackOrders.some(o=>o.clientOrderId===stopCid))
    throw Error("V4_RESIDENT_STOP_CANCEL_NOT_CONFIRMED");
   assertNet(venuePositions);
   verifyV4ResidentStops(after.state,after.intents,readbackOrders);
   this.commitProtection(leg.id,"CLOSED",0);
   return {status:"exited",reason:"ROUTE_EXIT_SIGNED_FILL_AND_STOP_REMOVED",
    eventTs:this.now(),candidateCount:0,orderEnabled:true};
  }
  return null;
 }
 private async tryCandidate(decision:V4LiveDecisionSnapshot,dispatcher:V4DurableOrderDispatcher,
  cycle:V4OrderCycle):Promise<V4TickResult>{
  const d=this.deps,now=this.now();
  // Existing positions are reconciled and exited before this point. These
  // global controls gate new ENTRY only and therefore never strand protection.
  await d.assertEntrySafety();
  // This is a source-level *independent* proof, not the shadow boolean.
  await d.assertSourceParity(decision);
  // A Production canary is deliberately one-entry-only. Historical durable
  // ENTRY intents remain the consumption marker even after the canary closes.
  if(d.canaryEntry&&Object.values(d.store.read().intents).some(i=>i.action==="ENTRY"))
   return {status:"blocked",reason:"PRODUCTION_CANARY_ALREADY_CONSUMED",
    eventTs:this.now(),candidateCount:decision.candidateCount,orderEnabled:false};
  const ranked=[...decision.candidates].sort((a,b)=>a.rank-b.rank||
   a.eligibleEntryTs-b.eligibleEntryTs||a.symbol.localeCompare(b.symbol));
  for(const candidate of ranked){
   if(candidate.eligibleEntryTs>now||now-candidate.eligibleEntryTs>15*60000)continue;
   const legId=[candidate.symbol,candidate.route,candidate.effectiveSide,candidate.eligibleEntryTs].join(":");
   if(d.store.read().state.legs[legId])continue;
   const key=[candidate.symbol,candidate.route,candidate.effectiveSide,candidate.eligibleEntryTs].join("|");
   const atr14=decision.entryAtrByCandidate[key];
   if(!(atr14>0)||!Number.isFinite(atr14))throw Error("V4_ENTRY_ATR_SOURCE_MISSING:"+key);
   const price=await d.referencePrice(candidate.symbol);
   const min=await d.minimumVenueOrderNotional(candidate.symbol,price);
   if(!(price>0)||!(min>0))throw Error("V4_LIVE_QUOTE_OR_MINIMUM_INVALID");
   const stop=await d.requiredResidentStop({route:candidate.route,symbol:candidate.symbol,
    side:candidate.effectiveSide,entryPrice:price,atr14});
   if(!Number.isFinite(stop)||!(stop>0)||
    (candidate.effectiveSide==="LONG"?stop>=price:stop<=price))
    throw Error("V4_RESIDENT_STOP_BLUEPRINT_INVALID");
   const state=d.store.read().state;
   const baseInput={ts:candidate.eligibleEntryTs,
    observedAtMs:this.now(),eventId:"reserve-live:"+legId,referencePrice:price,
    minimumOrderNotionalUsd:min,entryAtr:atr14,
    nativeExitEvidence:nativeEvidenceForProductionRoute(candidate.route),
    quantityNormalizer:d.quantityNormalizer};
   // The natural candidate must be admissible under ordinary strategy/risk rules.
   // Canary mode changes only size, never route eligibility or ownership rules.
   const ordinaryPlan=await planProductionEntry(state,{candidate,...baseInput});
   let plan=ordinaryPlan;
   if(d.canaryEntry){
    if(min>d.canaryEntry.maxNotionalUsd+1e-8)
     throw Error("V4_CANARY_VENUE_MINIMUM_EXCEEDS_CAP");
    const minimumGross=min/state.equityUsd;
    if(!(minimumGross>0)||minimumGross>1)
     throw Error("V4_CANARY_MINIMUM_GROSS_INVALID");
    const canaryCandidate={...candidate,requestedGross:minimumGross};
    plan=await planProductionEntry(state,{candidate:canaryCandidate,...baseInput});
    if(plan.leg.reservationUsd>d.canaryEntry.maxNotionalUsd+1e-8)
     throw Error("V4_CANARY_RESERVATION_EXCEEDS_CAP");
   }
   const command:V4DurableOrderCommand={legId:plan.leg.id,action:"ENTRY",sequence:0,
    symbol:candidate.symbol,positionSide:candidate.effectiveSide,
    quantity:plan.leg.requestedQty,price,signalTs:candidate.eligibleEntryTs};
   await d.assertAuthority(command);
   this.commitEvent(plan);
   this.commitProtection(plan.leg.id,"ENTRY_PREPARED",0);
   const cid=dispatcher.prepare(command,this.now());
   await dispatcher.submit(cid,this.now());
   this.commitProtection(plan.leg.id,"ENTRY_SENT",0);
   await cycle.reconcileEntry(cid,this.now());
   const proof=await dispatcher.reconcile(cid,this.now());
   if(!proof)throw Error("V4_ENTRY_ORDER_ID_UNRESOLVED:"+cid);
   const latest=d.store.read().state.legs[legId];
   if(latest.qty>0){
    const terminal=["FILLED","CANCELED","EXPIRED","REJECTED"].includes(String(proof.status).toUpperCase());
    this.commitProtection(legId,terminal?"ENTRY_FILLED_STOP_PENDING":"ENTRY_PARTIALLY_FILLED",0);
    const protectedNow=await this.ensureResidentProtection(legId,dispatcher,cycle);
    if(!protectedNow)throw Error("V4_ENTRY_FILLED_BEFORE_STOP_RECOVERY_REQUIRED:"+legId);
   }else if(latest.status==="CANCELLED")this.commitProtection(legId,"CLOSED",0);
   return {status:"submitted",reason:d.canaryEntry?
    "DURABLE_PRODUCTION_CANARY_WITH_RESIDENT_STOP":"DURABLE_ENTRY_WITH_RESIDENT_STOP",
    eventTs:this.now(),candidateCount:decision.candidateCount,orderEnabled:true};
  }
  return {status:"observing",reason:"NO_FRESH_NON_DUPLICATE_CANDIDATE",
   eventTs:this.now(),candidateCount:decision.candidateCount,orderEnabled:false};
 }
}
