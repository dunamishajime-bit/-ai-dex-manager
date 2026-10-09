/**
 * V12 V4 tick engine. Supports deterministic dry-run or explicitly authorized
 * entry/exit transport through the durable per-account lease. Never fabricates
 * missing signed positions or assumes an ACK means an executed fill.
 */
import type {AsterV3Client,AsterBalanceRow,AsterPositionRiskRow,AsterOrderResponse} from "./aster-v3-client";
import type {AccountLockHandle,FileAccountOrderLock} from "./disdex-account-order-lock";
import {readPendingExposureRegistry,type PendingExposureRegistry} from "./disdex-pending-exposure-registry";
import {V4ExecutionStore,type V4ExecutionDocument} from "./v12-v4-execution-store";
import {V4SharedReservations,bindV4SharedDispatchGuards} from "./v12-v4-shared-reservations";
import {V4DurableOrderDispatcher,createV4AsterOrderGateway,type V4DurableOrderCommand} from "./v12-v4-durable-orders";
import type {V12AsterLiveAdapter} from "./v12-aster-live-adapter";
import {V4OrderCycle} from "./v12-v4-order-cycle";
import {appendV4ClosedExitBars,type V4ExitFeed} from "./v12-v4-live-exit-feed";
import {applyProductionEvent,planProductionEntry,productionExitSpec,type EntryPlanInput} from "./v12-v4-production-lifecycle";
import {buildV4AccountMark,type V4SignedMark} from "./v12-v4-peer-account-mark";
import type {V4PeerSource} from "./v12-v4-peer-state-owners";
import type {V4LiveDecisionSnapshot} from "./v12-v4-live-candidate-builder";
export type V4TickResult={status:"locked"|"observing"|"blocked"|"submitted"|"exited";reason:string;
 eventTs:number;candidateCount:number;orderEnabled:boolean};
export interface V4RunnerDependencies{
 store:V4ExecutionStore;accountLock:FileAccountOrderLock;
 adapter:V12AsterLiveAdapter;
 client:Pick<AsterV3Client,"getBalances"|"getPositions"|"getOpenOrders"|"getUserTrades"|"getIncomeHistory">;
 pendingRegistryPath:string;
 fetchDecision:()=>Promise<V4LiveDecisionSnapshot>;
 fetchExitFeed:(symbol:string)=>Promise<V4ExitFeed>;
 fetchPeers:()=>Promise<V4PeerSource[]>;
 assertAuthority:(cmd:V4DurableOrderCommand)=>Promise<void>;
 assertSourceParity:(decision:V4LiveDecisionSnapshot)=>Promise<void>;
 requiredResidentStop:(input:{route:string;symbol:string;side:"LONG"|"SHORT";entryPrice:number;atr14:number})=>Promise<number>;
 quantityNormalizer:EntryPlanInput["quantityNormalizer"];
 referencePrice:(symbol:string)=>Promise<number>;
 minimumVenueOrderNotional:(symbol:string,price:number)=>Promise<number>;
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

 async tick():Promise<V4TickResult>{
  const at=this.now();
  const lease=await this.deps.accountLock.acquire("V12_V4_RUNNER");
  if(!lease)return {status:"locked",reason:"SHARED_ACCOUNT_LOCK_BUSY",eventTs:at,candidateCount:0,orderEnabled:false};
  try{return await this.underLease(lease);}
  finally{await lease.release();}
 }
 private async underLease(lease:AccountLockHandle):Promise<V4TickResult>{
  const at=this.now(), d=this.deps;
  const reserv=new V4SharedReservations(d.store,lease,d.pendingRegistryPath,this.now);
  const dispatcher=new V4DurableOrderDispatcher(d.store,createV4AsterOrderGateway(d.adapter),
   bindV4SharedDispatchGuards(reserv,d.assertAuthority));
  const cycle=new V4OrderCycle(d.store,dispatcher,reserv,d.client);
  // Funding for an in-flight or stop-closed position must be signed and
  // journalled *before* the venue close changes its owner status.
  await cycle.reconcileFundingUpTo(this.now());
  // Resolve existing network outcomes before making an admission.
  for(const [cid,intent] of Object.entries(d.store.read().intents)){
   if(intent.stage==="PREPARED")throw Error("V4_PREPARED_INTENT_REQUIRES_OPERATOR_REVIEW:"+cid);
   if(intent.action==="ENTRY"){
    const proof=await dispatcher.reconcile(cid,this.now());
    if(!proof)throw Error("V4_ENTRY_ORDER_ID_UNRESOLVED:"+cid);
    await cycle.reconcileEntry(cid,this.now());
   }else{
    const proof=await dispatcher.reconcile(cid,this.now());
    if(!proof)throw Error("V4_PROTECTIVE_ORDER_ID_UNRESOLVED:"+cid);
    if(["FILLED","PARTIALLY_FILLED"].includes(proof.status))
     await cycle.reconcileExit(cid,this.now(),this.now());
   }
  }
  const [positions,openOrders,balances,peers,registry]=await Promise.all([
   d.client.getPositions(),d.client.getOpenOrders(),d.client.getBalances(),
   d.fetchPeers(),readPendingExposureRegistry(d.pendingRegistryPath),
  ]);
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
   eventId:"signed-account:"+mark.capturedAt});
  this.commitEvent(accountMark.event);
  const current=d.store.read();
  const v4Owned=Object.values(current.state.legs).filter(l=>l.qty>0);
  const v4BySymbol=new Map<string,{side:string;qty:number}>();
  for(const l of v4Owned){
   const symbol=l.candidate.symbol,side=l.candidate.effectiveSide;
   const prev=v4BySymbol.get(symbol);
   if(prev&&prev.side!==side)throw Error("V4_OPPOSING_VIRTUAL_OWNERSHIP");
   v4BySymbol.set(symbol,{side,qty:(prev?.qty??0)+l.qty});
  }
  for(const [symbol,owned] of v4BySymbol){
   const stops=openOrders.filter(o=>o.symbol===symbol&&o.reduceOnly===true&&
    o.side===(owned.side==="LONG"?"SELL":"BUY")&&
    o.type==="STOP_MARKET"&&["NEW","PARTIALLY_FILLED"].includes(String(o.status).toUpperCase()));
   if(stops.length!==1||Number(stops[0].origQty)<owned.qty-1e-8)
    throw Error("V4_RESIDENT_STOP_OWNERSHIP_MISSING:"+symbol);
  }
  const exit=await this.processExitBars(dispatcher,cycle);
  if(exit)return exit;
  const decision=await d.fetchDecision();
  if(decision.orderEnabled!==false||decision.tradingMutation!==0||
   decision.realOrderEnabledV4!==0||decision.errors.length)
   throw Error("V4_CANDIDATE_SOURCE_UNTRUSTED");
  if(this.now()-decision.capturedAtMs>135*60000||decision.capturedAtMs>this.now())
   throw Error("V4_DECISION_SNAPSHOT_STALE");
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
    const feed=await d.fetchExitFeed(old.candidate.symbol);
    const current=d.store.read(),updated=appendV4ClosedExitBars(current.state,old.id,feed,this.now());
    if(updated!==current.state)d.store.commit(current.revision,{...current,state:updated});
   }
   const leg=d.store.read().state.legs[old.id];
   if(!leg.plannedExit)continue;
   const at=this.now();
   if(at-leg.plannedExit.exitTs>15*60000)throw Error("V4_STALE_EXIT_DECISION_REQUIRES_REVIEW:"+old.id);
   const same=Object.values(d.store.read().state.legs)
    .filter(l=>l.candidate.symbol===leg.candidate.symbol&&l.qty>0);
   if(same.length!==1)throw Error("V4_SHARED_SYMBOL_STOP_RESIZE_NOT_CERTIFIED");
   const price=await d.referencePrice(leg.candidate.symbol);
   const cmd:V4DurableOrderCommand={legId:leg.id,action:"EXIT",sequence:0,
    symbol:leg.candidate.symbol,positionSide:leg.candidate.effectiveSide,
    quantity:leg.qty,price,signalTs:leg.entryTs};
   await d.assertAuthority(cmd);
   this.commitEvent({type:"EXIT_REQUEST",eventId:"route-exit:"+leg.id,ts:at,id:leg.id,qty:leg.qty});
   const cid=dispatcher.prepare(cmd,this.now());
   await dispatcher.submit(cid,this.now());
   await cycle.reconcileExit(cid,this.now(),this.now());
   if(d.store.read().state.legs[leg.id].qty>1e-10)
    throw Error("V4_EXIT_RESIDUAL_POSITION_REQUIRES_REVIEW");
   const stop=Object.values(d.store.read().intents).filter(i=>i.legId===leg.id&&i.action==="STOP");
   if(stop.length!==1)throw Error("V4_COMPLETED_EXIT_STOP_IDENTITY_UNCERTAIN");
   await d.adapter.cancel(stop[0].clientOrderId);
   const remaining=await d.client.getOpenOrders(leg.candidate.symbol);
   if(remaining.some(o=>o.clientOrderId===stop[0].clientOrderId))
    throw Error("V4_RESIDENT_STOP_CANCEL_NOT_CONFIRMED");
   return {status:"exited",reason:"ROUTE_EXIT_SIGNED_FILL_AND_STOP_REMOVED",
    eventTs:this.now(),candidateCount:0,orderEnabled:true};
  }
  return null;
 }
 private async tryCandidate(decision:V4LiveDecisionSnapshot,dispatcher:V4DurableOrderDispatcher,
  cycle:V4OrderCycle):Promise<V4TickResult>{
  const d=this.deps,now=this.now();
  // This is a source-level *independent* proof, not the shadow boolean.
  await d.assertSourceParity(decision);
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
   const plan=await planProductionEntry(state,{candidate,ts:candidate.eligibleEntryTs,
    observedAtMs:this.now(),eventId:"reserve-live:"+legId,referencePrice:price,
    minimumOrderNotionalUsd:min,entryAtr:atr14,
    nativeExitEvidence:candidate.route==="FAILED_BREAK_REV_SHORT_6H"?"WR60_BASELINE_1978_PARITY":undefined,
    quantityNormalizer:d.quantityNormalizer});
   const command:V4DurableOrderCommand={legId:plan.leg.id,action:"ENTRY",sequence:0,
    symbol:candidate.symbol,positionSide:candidate.effectiveSide,
    quantity:plan.leg.requestedQty,price,signalTs:candidate.eligibleEntryTs};
   await d.assertAuthority(command);
   this.commitEvent(plan);
   const cid=dispatcher.prepare(command,this.now());
   await dispatcher.submit(cid,this.now());
   await cycle.reconcileEntry(cid,this.now());
   const latest=d.store.read().state.legs[legId];
   if(latest.qty>0){
    const signedAverageFill=latest.entryNotional/latest.qty;
    if(!(signedAverageFill>0)||!Number.isFinite(signedAverageFill))
     throw Error("V4_SIGNED_AVERAGE_ENTRY_FILL_MISSING");
    // The quote used for reservation is not the executed price. Recompute
    // venue STOP from independently reconciled fills, never from stale quote.
    const signedStop=await d.requiredResidentStop({route:candidate.route,symbol:candidate.symbol,
     side:candidate.effectiveSide,entryPrice:signedAverageFill,atr14});
    if(!Number.isFinite(signedStop)||!(signedStop>0)||
     (candidate.effectiveSide==="LONG"?signedStop>=signedAverageFill:signedStop<=signedAverageFill))
      throw Error("V4_SIGNED_FILL_RESIDENT_STOP_INVALID");
    const protective:V4DurableOrderCommand={...command,action:"STOP",sequence:0,
     quantity:latest.qty,price:signedStop};
    await d.assertAuthority(protective);
    const stopCid=dispatcher.prepare(protective,this.now());
    await dispatcher.submit(stopCid,this.now());
    const proof=await dispatcher.reconcile(stopCid,this.now());
    if(!proof||proof.reduceOnly!==true||proof.type!=="STOP_MARKET")
     throw Error("V4_RESIDENT_STOP_NOT_VENUE_CONFIRMED");
   }
   return {status:"submitted",reason:"DURABLE_ENTRY_WITH_RESIDENT_STOP",
    eventTs:this.now(),candidateCount:decision.candidateCount,orderEnabled:true};
  }
  return {status:"observing",reason:"NO_FRESH_NON_DUPLICATE_CANDIDATE",
   eventTs:this.now(),candidateCount:decision.candidateCount,orderEnabled:false};
 }
}
