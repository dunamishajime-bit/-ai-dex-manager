import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { IDLE_RESIDUAL_LONG_POLICY, IDLE_RESIDUAL_LONG_STRATEGY, type IdleResidualLongSymbol } from "../config/idleResidualLongPolicy";
import type { IdleResidualLongRuntime } from "../config/idleResidualLongRuntime";
import type { IdlePriorityShortRuntime } from "../config/idlePriorityShortRuntime";
import type { AsterV3Client } from "./aster-v3-client";
import type { AsterDirectTradeExecutor, DirectOpenOrder, DirectPosition, DirectTradeResult } from "./direct-trade-executor";
import type { V12AsterLiveAdapter } from "./v12-aster-live-adapter";
import type { FileAccountOrderLock, AccountLockHandle } from "./disdex-account-order-lock";
import { aggregatePendingExposure, readPendingExposureRegistry } from "./disdex-pending-exposure-registry";
import { readSharedCryptoDailyRisk } from "./disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "./disdex-shared-kill-switch";
import { buildBaselineAdmissionEvidence } from "./idle-priority-short-baseline-admission";
import { coreAndSidecarExposure } from "./idle-priority-short-runner";
import { evaluateIdleGenericCandidate, evaluateIdlePriorityShort, computeIdlePriorityFeatures } from "./idle-priority-short-signal";
import { readIdleState } from "./idle-priority-short-state";
import type { IdlePriorityMarketSnapshot } from "./idle-priority-short-market-data";
import { chooseIdleResidualLong, evaluateIdleResidualLong, type IdleResidualLongSignal } from "./idle-residual-long-signal";
import { FileIdleResidualLongStateStore, type IdleResidualLongPending, type IdleResidualLongPosition, type IdleResidualLongState } from "./idle-residual-long-state";
import { readAndAssertIdleResidualLongParityCert } from "./idle-residual-long-parity-cert";

const EPS=1e-9;
const CRYPTO_CAP=3.0;
const TOTAL_CAP=4.25;
const ACTIVE_ORDER_STATUSES=new Set(["NEW","PARTIALLY_FILLED","PENDING_NEW"]);

export type IdleResidualLongTickResult={
  status:"disabled"|"locked"|"shadow"|"held"|"no-change"|"completed"|"manual-review";
  message:string;
  symbol?:string;
  ordersSent:number;
  cancelsSent:number;
  positionChangesSent:number;
};

export type IdleResidualLongRunnerDependencies={
  marketData:{load():Promise<IdlePriorityMarketSnapshot>};
  executor:AsterDirectTradeExecutor;
  adapter:V12AsterLiveAdapter;
  client:AsterV3Client;
  stateStore:FileIdleResidualLongStateStore;
  lock:FileAccountOrderLock;
  runtime:IdleResidualLongRuntime;
  coreRuntime:IdlePriorityShortRuntime;
  now?:()=>number;
};

function activePosition(positions:readonly DirectPosition[],symbol:string){
  return positions.find((p)=>p.symbol.toUpperCase()===symbol.toUpperCase()&&Math.abs(p.quantity)>EPS);
}
function activeOrder(order:DirectOpenOrder){return ACTIVE_ORDER_STATUSES.has(String(order.status||"").toUpperCase());}
function sameQuantity(a:number,b:number){return Math.abs(a-b)<=Math.max(1e-9,Math.abs(b)*0.01);}
function freshQuote(q:{updatedAt:number},now:number){return q.updatedAt>0&&q.updatedAt<=now&&now-q.updatedAt<=5*60_000;}
function id(parts:unknown[],prefix:string){return `${prefix}-${createHash("sha256").update(parts.join("|")).digest("hex").slice(0,25)}`.slice(0,36);}
function sidecarPending(entries:Awaited<ReturnType<typeof readPendingExposureRegistry>>){
  let baseline=0,nonBaseline=0;
  for(const row of entries.entries){
    if(!["PENDING","SUBMITTED","UNKNOWN"].includes(row.status))continue;
    const owner=row.strategyId.toUpperCase();
    if(owner.includes("HYPE")||owner.includes("ZEC")||owner===IDLE_RESIDUAL_LONG_STRATEGY)nonBaseline+=Number(row.gross||0);
    else baseline+=Number(row.gross||0);
  }
  return {baseline,nonBaseline};
}

export class IdleResidualLongRunner{
  private readonly now:()=>number;
  constructor(private readonly d:IdleResidualLongRunnerDependencies){this.now=d.now||Date.now;}

  private async manual(state:IdleResidualLongState,reason:string):Promise<IdleResidualLongTickResult>{
    state.manualReview=reason;
    state.failures=[...state.failures,{message:reason,occurredAt:this.now()}].slice(-100);
    await this.d.stateStore.save(state);
    return {status:"manual-review",message:reason,ordersSent:0,cancelsSent:0,positionChangesSent:0};
  }

  private async marginHealthy(){
    try{
      const x=JSON.parse(await readFile(this.d.coreRuntime.marginPath,"utf8")) as {stage?:unknown;ordersAllowed?:unknown;checkedAt?:unknown;updatedAt?:unknown};
      const ts=Number(x.checkedAt??x.updatedAt);
      return x.stage==="HEALTHY"&&x.ordersAllowed===true&&Number.isFinite(ts)&&ts>0&&ts<=this.now()&&this.now()-ts<=this.d.coreRuntime.marginMaxAgeMs;
    }catch{return false;}
  }

  private async verifyVenueFiveXCross(symbol:string){
    const rows=await this.d.client.getPositions(symbol);
    const matching=rows.filter((row)=>row.symbol.toUpperCase()===symbol.toUpperCase());
    if(!matching.length)return false;
    for(const row of matching){
      if(Math.abs(Number(row.positionAmt))>EPS)return false;
      const margin=String(row.marginType||"").toLowerCase();
      const cross=margin==="cross"||margin==="crossed"||row.isolated===false;
      if(Number(row.leverage)!==5||!cross)return false;
    }
    return (await this.d.client.getOpenOrders(symbol)).length===0;
  }

  private protectionPlan(symbol:IdleResidualLongSymbol,signalTs:number,entryPrice:number,quantity:number){
    const stopPrice=entryPrice*(1-IDLE_RESIDUAL_LONG_POLICY.emergencyStopPct/100);
    const takeProfitPrice=entryPrice*(1+IDLE_RESIDUAL_LONG_POLICY.emergencyTakeProfitPct/100);
    return {
      stopPrice,takeProfitPrice,
      stopClientOrderId:id([IDLE_RESIDUAL_LONG_STRATEGY,"STOP",symbol,signalTs],"res-stop"),
      takeProfitClientOrderId:id([IDLE_RESIDUAL_LONG_STRATEGY,"TP",symbol,signalTs],"res-tp"),
      quantity,
    };
  }

  private async installProtection(pending:IdleResidualLongPending,actual:DirectPosition):Promise<IdleResidualLongPosition>{
    const quantity=Math.abs(actual.quantity);
    const plan=this.protectionPlan(pending.symbol,pending.signalTs,actual.entryPrice,quantity);
    const stop=await this.d.adapter.normalizeStopPrice(pending.symbol,plan.stopPrice);
    const tp=await this.d.adapter.normalizeStopPrice(pending.symbol,plan.takeProfitPrice);
    try{
      await this.d.adapter.placeStopMarket({symbol:pending.symbol,side:"SELL",quantity,stopPrice:stop.price,clientOrderId:plan.stopClientOrderId,reduceOnly:true});
      await this.d.adapter.placeTakeProfit({symbol:pending.symbol,side:"SELL",quantity,stopPrice:tp.price,clientOrderId:plan.takeProfitClientOrderId,reduceOnly:true});
      const orders=(await this.d.adapter.openOrders(pending.symbol)).filter((o)=>ACTIVE_ORDER_STATUSES.has(String(o.status||"").toUpperCase()));
      const so=orders.find((o)=>o.clientOrderId===plan.stopClientOrderId);
      const to=orders.find((o)=>o.clientOrderId===plan.takeProfitClientOrderId);
      if(!so||!to||so.reduceOnly!==true||to.reduceOnly!==true||String(so.side).toUpperCase()!=="SELL"||String(to.side).toUpperCase()!=="SELL"||
         !sameQuantity(so.quantity,quantity)||!sameQuantity(to.quantity,quantity))throw new Error("PROTECTION_READBACK_FAILED");
    }catch(error){throw new Error(`IDLE_RESIDUAL_PROTECTION_INSTALL_FAILED:${error instanceof Error?error.message:String(error)}`);}
    return {
      symbol:pending.symbol,route:pending.route,side:"LONG",signalTs:pending.signalTs,entryTs:this.now(),exitTs:this.now()+12*3_600_000,
      entryPrice:actual.entryPrice,quantity,gross:1,stopPrice:stop.price,takeProfitPrice:tp.price,
      stopClientOrderId:plan.stopClientOrderId,takeProfitClientOrderId:plan.takeProfitClientOrderId,protectionVerified:true,
    };
  }

  private async finalizeEntry(state:IdleResidualLongState,pending:IdleResidualLongPending,result:DirectTradeResult,lock:AccountLockHandle):Promise<IdleResidualLongTickResult>{
    if(!(["FILLED","PARTIALLY_FILLED"].includes(result.status))||result.executedQuantity<=EPS){
      state.pending=null;await this.d.stateStore.save(state);
      if(pending.reservationId)await lock.releaseReservation(pending.reservationId);
      return {status:"held",message:`IDLE_RESIDUAL_ENTRY_${result.status}_NO_EXPOSURE`,symbol:pending.symbol,ordersSent:0,cancelsSent:0,positionChangesSent:0};
    }
    const actual=activePosition(await this.d.executor.getPositions(),pending.symbol);
    if(!actual||actual.quantity<0||actual.positionSide==="SHORT")return this.manual(state,`IDLE_RESIDUAL_ENTRY_POSITION_MISMATCH:${pending.symbol}`);
    let owned:IdleResidualLongPosition;
    try{owned=await this.installProtection(pending,actual);}
    catch(error){
      const quote=await this.d.executor.getMarketQuote(pending.symbol);
      try{
        const closeId=id([pending.clientOrderId,"UNPROTECTED_CLOSE"],"res-safe");
        await this.d.executor.executeMarket({requestId:closeId,clientOrderId:closeId,symbol:pending.symbol,side:"SELL",positionSide:"BOTH",quantity:Math.abs(actual.quantity),reduceOnly:true,expectedPrice:quote.bidPrice,maxSlippageBps:this.d.runtime.maximumSlippageBps,reason:"IDLE_RESIDUAL_UNPROTECTED_SAFETY_CLOSE"});
      }catch{}
      return this.manual(state,`IDLE_RESIDUAL_PROTECTION_FAILED:${error instanceof Error?error.message:String(error)}`);
    }
    state.position=owned;state.pending=null;
    state.lastDecision={decisionTs:pending.decisionTs,symbol:pending.symbol,route:pending.route,accepted:true,reason:"IDLE_RESIDUAL_ENTRY_FILLED"};
    await this.d.stateStore.save(state);
    if(pending.reservationId)await lock.releaseReservation(pending.reservationId);
    await lock.document();
    if(result.status==="PARTIALLY_FILLED")return this.manual(state,"IDLE_RESIDUAL_PARTIAL_FILL_REQUIRES_REVIEW");
    return {status:"completed",message:`IDLE_RESIDUAL_ENTRY_COMPLETED:${pending.symbol}`,symbol:pending.symbol,ordersSent:1,cancelsSent:0,positionChangesSent:1};
  }

  private async reconcilePending(state:IdleResidualLongState,lock:AccountLockHandle):Promise<IdleResidualLongTickResult|undefined>{
    const p=state.pending;if(!p)return undefined;
    const result=await this.d.executor.reconcileOrder(p.symbol,p.clientOrderId);
    if(result.status==="UNKNOWN"||result.executionUnknown)return this.manual(state,`IDLE_RESIDUAL_PENDING_UNKNOWN:${p.clientOrderId}`);
    if(p.action==="ENTRY")return this.finalizeEntry(state,p,result,lock);
    if(activePosition(await this.d.executor.getPositions(),p.symbol))return this.manual(state,`IDLE_RESIDUAL_EXIT_POSITION_REMAINS:${p.symbol}`);
    const owned=state.position;
    if(owned){
      await this.d.adapter.cancel(owned.stopClientOrderId).catch(()=>undefined);
      await this.d.adapter.cancel(owned.takeProfitClientOrderId).catch(()=>undefined);
    }
    state.position=null;state.pending=null;await this.d.stateStore.save(state);await lock.document();
    return {status:"completed",message:`IDLE_RESIDUAL_EXIT_RECONCILED:${p.symbol}`,symbol:p.symbol,ordersSent:0,cancelsSent:2,positionChangesSent:1};
  }

  private async exit(state:IdleResidualLongState,owned:IdleResidualLongPosition,actual:DirectPosition,lock:AccountLockHandle,reason:string):Promise<IdleResidualLongTickResult>{
    const quote=await this.d.executor.getMarketQuote(owned.symbol);
    if(!freshQuote(quote,this.now()))return {status:"held",message:`IDLE_RESIDUAL_EXIT_QUOTE_STALE:${owned.symbol}`,symbol:owned.symbol,ordersSent:0,cancelsSent:0,positionChangesSent:0};
    const clientOrderId=id([IDLE_RESIDUAL_LONG_STRATEGY,"EXIT",owned.symbol,owned.signalTs,reason],"res-exit");
    const pending:IdleResidualLongPending={action:"EXIT",phase:"planned",symbol:owned.symbol,route:owned.route,clientOrderId,idempotencyKey:clientOrderId,quantity:Math.abs(actual.quantity),expectedPrice:quote.bidPrice,signalTs:owned.signalTs,decisionTs:this.now(),createdAt:this.now(),updatedAt:this.now(),reason};
    state.pending=pending;await this.d.stateStore.save(state);
    state.pending.phase="submitted";await this.d.stateStore.save(state);
    let result:DirectTradeResult;
    try{result=await this.d.executor.executeMarket({requestId:clientOrderId,clientOrderId,symbol:owned.symbol,side:"SELL",positionSide:"BOTH",quantity:Math.abs(actual.quantity),reduceOnly:true,expectedPrice:quote.bidPrice,maxSlippageBps:this.d.runtime.maximumSlippageBps,reason:`IDLE_RESIDUAL_LONG_EXIT:${reason}`});}
    catch(error){return this.manual(state,`IDLE_RESIDUAL_EXIT_ERROR:${error instanceof Error?error.message:String(error)}`);}
    if(result.status==="UNKNOWN"||result.executionUnknown)return this.manual(state,`IDLE_RESIDUAL_EXIT_UNKNOWN:${clientOrderId}`);
    if(activePosition(await this.d.executor.getPositions(),owned.symbol))return this.manual(state,`IDLE_RESIDUAL_EXIT_POSITION_REMAINS:${owned.symbol}`);
    await this.d.adapter.cancel(owned.stopClientOrderId).catch(()=>undefined);
    await this.d.adapter.cancel(owned.takeProfitClientOrderId).catch(()=>undefined);
    state.position=null;state.pending=null;
    state.lastDecision={decisionTs:this.now(),symbol:owned.symbol,route:owned.route,accepted:true,reason:`EXIT:${reason}`};
    await this.d.stateStore.save(state);await lock.document();
    return {status:"completed",message:`IDLE_RESIDUAL_EXIT_COMPLETED:${owned.symbol}:${reason}`,symbol:owned.symbol,ordersSent:1,cancelsSent:2,positionChangesSent:1};
  }

  private coreIdleSignal(market:IdlePriorityMarketSnapshot,coreState:Awaited<ReturnType<typeof readIdleState>>){
    const cooldownMs=12*3_600_000;
    for(const [symbol,rows] of Object.entries(market.symbols) as Array<[keyof typeof market.symbols,typeof market.symbols[keyof typeof market.symbols]]>){
      const features=computeIdlePriorityFeatures(market.decisionTs,rows,market.btc);
      const generic=evaluateIdleGenericCandidate(features);
      const signal=evaluateIdlePriorityShort(symbol,features,generic);
      const last=Number(coreState.lastAcceptedBySymbol[symbol]||0);
      const cooldownAllowed=last<=0||market.decisionTs-last>=cooldownMs;
      if(signal.accepted&&cooldownAllowed)return signal;
    }
    return undefined;
  }

  private async baselineContext(positions:DirectPosition[],equity:number,decisionTs:number,ownedSymbols:ReadonlySet<string>){
    const exposure=coreAndSidecarExposure(positions,equity,ownedSymbols);
    const pendingRegistry=await readPendingExposureRegistry(this.d.coreRuntime.pendingExposurePath);
    const owners=sidecarPending(pendingRegistry);
    const baseline=await buildBaselineAdmissionEvidence({
      runtimeSha:this.d.coreRuntime.runtimeSha,decisionTs,now:this.now(),
      baselineOpenPositions:exposure.baselineOpenPositions,baselinePendingExposure:owners.baseline,
      decisionPath:this.d.coreRuntime.decisionPath,v12Path:this.d.coreRuntime.v12DecisionPath,q102Path:this.d.coreRuntime.q102DecisionPath,
      penguPath:this.d.coreRuntime.penguStatePath,fetPath:this.d.coreRuntime.fetStatePath,v52Path:this.d.coreRuntime.v52StatePath,
    });
    return {exposure,pendingRegistry,owners,baseline};
  }

  private async reconcileProtectiveFill(state:IdleResidualLongState,positions:DirectPosition[],openOrders:DirectOpenOrder[]){
    const owned=state.position;if(!owned)return false;
    if(activePosition(positions,owned.symbol))return false;
    const [stop,tp]=await Promise.all([
      this.d.executor.reconcileOrder(owned.symbol,owned.stopClientOrderId),
      this.d.executor.reconcileOrder(owned.symbol,owned.takeProfitClientOrderId),
    ]);
    const stopFilled=stop.status==="FILLED"&&stop.executedQuantity>EPS;
    const tpFilled=tp.status==="FILLED"&&tp.executedQuantity>EPS;
    if(!stopFilled&&!tpFilled)return false;
    const sibling=stopFilled?owned.takeProfitClientOrderId:owned.stopClientOrderId;
    if(openOrders.some((o)=>o.clientOrderId===sibling&&activeOrder(o)))await this.d.adapter.cancel(sibling).catch(()=>undefined);
    state.position=null;
    state.lastDecision={decisionTs:this.now(),symbol:owned.symbol,route:owned.route,accepted:true,reason:`EXIT:${stopFilled?"HARD_STOP":"TAKE_PROFIT"}_VENUE_RECONCILED`};
    await this.d.stateStore.save(state);
    return true;
  }

  private async enter(state:IdleResidualLongState,signal:IdleResidualLongSignal,positions:DirectPosition[],equity:number,lock:AccountLockHandle,pendingAggregate:ReturnType<typeof aggregatePendingExposure>):Promise<IdleResidualLongTickResult>{
    if(this.d.coreRuntime.mode!=="LIVE")return {status:"shadow",message:`IDLE_RESIDUAL_SHADOW_ENTRY:${signal.symbol}`,symbol:signal.symbol,ordersSent:0,cancelsSent:0,positionChangesSent:0};
    if(!this.d.runtime.operatorArmed)return {status:"held",message:"IDLE_RESIDUAL_OPERATOR_NOT_ARMED",ordersSent:0,cancelsSent:0,positionChangesSent:0};
    await readAndAssertIdleResidualLongParityCert(this.d.runtime.parityCertificatePath,this.d.runtime.runtimeSha);
    const coreState=await readIdleState(this.d.coreRuntime.statePath,this.d.coreRuntime.runtimeSha);
    if(coreState.positions.length||coreState.pending)return {status:"held",message:"IDLE_RESIDUAL_BLOCKED_BY_IDLE_SHORT_STATE",ordersSent:0,cancelsSent:0,positionChangesSent:0};
    const context=await this.baselineContext(positions,equity,signal.features.decisionTs,new Set());
    if(context.baseline.baselineAcceptedThisTimestamp>0||context.baseline.baselineOpenPositions>EPS||context.baseline.baselinePendingExposure>EPS){
      return {status:"held",message:"IDLE_RESIDUAL_BLOCKED_BY_FORMAL_BASELINE",ordersSent:0,cancelsSent:0,positionChangesSent:0};
    }
    if(context.exposure.nonBaselineCryptoExposure>EPS||context.owners.nonBaseline>EPS)return {status:"held",message:"IDLE_RESIDUAL_BLOCKED_BY_SIDECAR",ordersSent:0,cancelsSent:0,positionChangesSent:0};
    const kill=await readSharedKillSwitch(process.env);
    const risk=await readSharedCryptoDailyRisk(this.d.coreRuntime.riskPath,this.now());
    if(kill.active||!risk.ok||!(await this.marginHealthy()))return {status:"held",message:"IDLE_RESIDUAL_SHARED_SAFETY_BLOCK",ordersSent:0,cancelsSent:0,positionChangesSent:0};
    const fullCrypto=CRYPTO_CAP-context.exposure.cryptoGross-pendingAggregate.cryptoGross;
    const fullTotal=TOTAL_CAP-context.exposure.totalGross-pendingAggregate.cryptoGross-pendingAggregate.stockGross;
    if(fullCrypto<1-EPS||fullTotal<1-EPS)return {status:"held",message:"IDLE_RESIDUAL_FULL_1X_CAPACITY_UNAVAILABLE",ordersSent:0,cancelsSent:0,positionChangesSent:0};

    const quote=await this.d.executor.getMarketQuote(signal.symbol);
    if(!freshQuote(quote,this.now()))return {status:"held",message:`IDLE_RESIDUAL_ENTRY_QUOTE_STALE:${signal.symbol}`,symbol:signal.symbol,ordersSent:0,cancelsSent:0,positionChangesSent:0};
    await this.d.executor.prepareVenueMargin5xCross(signal.symbol);
    if(!(await this.verifyVenueFiveXCross(signal.symbol)))return {status:"held",message:`IDLE_RESIDUAL_5X_CROSS_READBACK_FAILED:${signal.symbol}`,symbol:signal.symbol,ordersSent:0,cancelsSent:0,positionChangesSent:0};
    const normalized=await this.d.executor.normalizeMarketQuantity(signal.symbol,equity/quote.askPrice,quote.askPrice);
    if(normalized.notional/equity<1-1e-6)return {status:"held",message:`IDLE_RESIDUAL_FULL_1X_NOT_REALIZABLE:${signal.symbol}`,symbol:signal.symbol,ordersSent:0,cancelsSent:0,positionChangesSent:0};
    const clientOrderId=id([IDLE_RESIDUAL_LONG_STRATEGY,"ENTRY",signal.symbol,signal.features.signalTs],"res-entry");
    const reservation=await lock.reserve({strategyId:IDLE_RESIDUAL_LONG_STRATEGY,symbol:signal.symbol,side:"LONG",gross:1,notionalUsd:equity});
    const pending:IdleResidualLongPending={action:"ENTRY",phase:"planned",symbol:signal.symbol,route:signal.route,clientOrderId,idempotencyKey:clientOrderId,reservationId:reservation.reservationId,quantity:normalized.quantity,expectedPrice:quote.askPrice,signalTs:signal.features.signalTs,decisionTs:signal.features.decisionTs,createdAt:this.now(),updatedAt:this.now(),reason:signal.reason};
    state.pending=pending;state.lastDecision={decisionTs:signal.features.decisionTs,symbol:signal.symbol,route:signal.route,accepted:true,reason:"IDLE_RESIDUAL_ENTRY_PLANNED"};await this.d.stateStore.save(state);
    state.pending.phase="submitted";await this.d.stateStore.save(state);
    try{
      const result=await this.d.executor.executeMarket({requestId:clientOrderId,clientOrderId,symbol:signal.symbol,side:"BUY",positionSide:"BOTH",quantity:normalized.quantity,expectedPrice:quote.askPrice,maxSlippageBps:this.d.runtime.maximumSlippageBps,reason:`IDLE_RESIDUAL_LONG_ENTRY:${signal.route}`,requireVenueMargin5xCross:true});
      return this.finalizeEntry(state,pending,result,lock);
    }catch(error){return this.manual(state,`IDLE_RESIDUAL_ENTRY_ERROR:${error instanceof Error?error.message:String(error)}`);}
  }

  async tick():Promise<IdleResidualLongTickResult>{
    if(!this.d.runtime.enabled)return {status:"disabled",message:"IDLE_RESIDUAL_LONG_DISABLED",ordersSent:0,cancelsSent:0,positionChangesSent:0};
    const lock=await this.d.lock.acquire(`${IDLE_RESIDUAL_LONG_STRATEGY}:${process.pid}:${Date.now()}`);
    if(!lock)return {status:"locked",message:"IDLE_RESIDUAL_ACCOUNT_LOCK_BUSY",ordersSent:0,cancelsSent:0,positionChangesSent:0};
    try{
      const state=await this.d.stateStore.load();
      if(state.manualReview)return {status:"manual-review",message:state.manualReview,ordersSent:0,cancelsSent:0,positionChangesSent:0};
      const recovered=await this.reconcilePending(state,lock);if(recovered)return recovered;
      const [account,positions,openOrders,market]=await Promise.all([
        this.d.executor.getAccountSnapshot(),this.d.executor.getPositions(),this.d.executor.getOpenOrders(),this.d.marketData.load(),
      ]);
      await this.reconcileProtectiveFill(state,positions,openOrders);
      const freshPositions=await this.d.executor.getPositions();
      const equity=account.walletBalance+freshPositions.reduce((s,p)=>s+Number(p.unrealizedPnl||0),0);
      if(!(equity>0))return {status:"held",message:"IDLE_RESIDUAL_EQUITY_INVALID",ordersSent:0,cancelsSent:0,positionChangesSent:0};

      if(state.position){
        const owned=state.position;
        const actual=activePosition(freshPositions,owned.symbol);
        if(!actual)return this.manual(state,`IDLE_RESIDUAL_POSITION_MISSING:${owned.symbol}`);
        const coreState=await readIdleState(this.d.coreRuntime.statePath,this.d.coreRuntime.runtimeSha);
        let formalPriority=false;
        try{
          const context=await this.baselineContext(freshPositions,equity,market.decisionTs,new Set([owned.symbol]));
          formalPriority=context.baseline.baselineAcceptedThisTimestamp>0||context.baseline.baselineOpenPositions>EPS||context.baseline.baselinePendingExposure>EPS;
        }catch{formalPriority=true;}
        if(formalPriority)return this.exit(state,owned,actual,lock,"FORMAL_PRIORITY");
        if(coreState.positions.length||coreState.pending||this.coreIdleSignal(market,coreState))return this.exit(state,owned,actual,lock,"IDLE_SHORT_PRIORITY");
        const quote=await this.d.executor.getMarketQuote(owned.symbol);
        if(!freshQuote(quote,this.now()))return {status:"held",message:`IDLE_RESIDUAL_HELD_QUOTE_STALE:${owned.symbol}`,symbol:owned.symbol,ordersSent:0,cancelsSent:0,positionChangesSent:0};
        const reason=quote.bidPrice<=owned.stopPrice?"HARD_STOP":quote.askPrice>=owned.takeProfitPrice?"TAKE_PROFIT":this.now()>=owned.exitTs?"FIXED_HOLD_EXIT":undefined;
        if(reason)return this.exit(state,owned,actual,lock,reason);
        return {status:"held",message:`IDLE_RESIDUAL_POSITION_HELD:${owned.symbol}`,symbol:owned.symbol,ordersSent:0,cancelsSent:0,positionChangesSent:0};
      }

      const coreState=await readIdleState(this.d.coreRuntime.statePath,this.d.coreRuntime.runtimeSha);
      if(coreState.positions.length||coreState.pending||this.coreIdleSignal(market,coreState))return {status:"no-change",message:"IDLE_RESIDUAL_YIELDS_TO_IDLE_SHORT",ordersSent:0,cancelsSent:0,positionChangesSent:0};
      const signals=(Object.keys(market.residualSymbols) as IdleResidualLongSymbol[]).map((symbol)=>evaluateIdleResidualLong(symbol,market.decisionTs,market.residualSymbols[symbol],market.btc));
      const signal=chooseIdleResidualLong(signals);
      if(!signal){
        state.lastDecision={decisionTs:market.decisionTs,accepted:false,reason:"NO_IDLE_RESIDUAL_LONG_SIGNAL"};
        await this.d.stateStore.save(state);
        return {status:"no-change",message:"NO_IDLE_RESIDUAL_LONG_SIGNAL",ordersSent:0,cancelsSent:0,positionChangesSent:0};
      }
      const pendingAggregate=aggregatePendingExposure(await readPendingExposureRegistry(this.d.coreRuntime.pendingExposurePath));
      return this.enter(state,signal,freshPositions,equity,lock,pendingAggregate);
    }catch(error){
      const state=await this.d.stateStore.load().catch(()=>undefined);
      if(state)return this.manual(state,`IDLE_RESIDUAL_RUNNER_FAIL_CLOSED:${error instanceof Error?error.message:String(error)}`);
      throw error;
    }finally{await lock.release();}
  }
}
