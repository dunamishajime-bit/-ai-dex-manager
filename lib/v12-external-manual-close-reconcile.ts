import type {AsterV3Client} from "./aster-v3-client";
import {readPendingExposureRegistry} from "./disdex-pending-exposure-registry";
import {recordSideExit,type SideLossLedger} from "./dd1296-entry-policy";
import {FileV12X1AllRunnerStateStore,type V12ActivePositionState} from "./v12-x1-all-runner-state";
import {V12_X1_ALL} from "../config/v12X1AllRuntime";

const EPS=1e-12;
const ALLOWED_REVIEW=["V12_POSITION_SIDE_OR_QTY_MISMATCH","V12_STATE_ONLY_POSITION_MISMATCH"];


async function getExternalManualCloseEvidence(
 client:Pick<AsterV3Client,"getOrder"|"getUserTrades"|"getIncomeHistory">,
 position:V12ActivePositionState,now:number){
 const entry=await client.getOrder(position.symbol,position.positionId);
 const entryQty=Number(entry?.executedQty);
 if(!entry?.orderId||!(entryQty>0))throw Error("V12_EXTERNAL_CLOSE_ENTRY_FILL_MISSING");
 const tol=Math.max(1e-8,entryQty*1e-6);
 if(Math.abs(entryQty-Number(position.quantity))>tol)
  throw Error("V12_EXTERNAL_CLOSE_ENTRY_STATE_QTY_MISMATCH");
 const trades=await client.getUserTrades(position.symbol,{startTime:position.entrySignalTs,endTime:now,limit:1000});
 if(!trades.length||trades.length>=1000)throw Error("V12_EXTERNAL_CLOSE_TRADE_COVERAGE_UNPROVEN");
 const entryFills=trades.filter(r=>String(r.orderId)===String(entry.orderId));
 if(!entryFills.length)throw Error("V12_EXTERNAL_CLOSE_ENTRY_TRADES_MISSING");
 const first=Math.min(...entryFills.map(r=>Number(r.time)));
 const minId=entryFills.reduce((min,r)=>BigInt(String(r.id))<min?BigInt(String(r.id)):min,
  BigInt(String(entryFills[0].id)));
 const fills=trades.filter(r=>Number(r.time)>=first&&Number(r.time)<=now&&r.id!==undefined&&
  BigInt(String(r.id))>=minId).sort((a,b)=>Number(a.time)-Number(b.time)||
   (BigInt(String(a.id))<BigInt(String(b.id))?-1:1));
 const openingSide=position.side==="LONG"?"BUY":"SELL";
 const sideSign=(side:string)=>side==="BUY"?1:-1;
 const openingSigned=(position.side==="LONG"?1:-1)*entryQty;
 const unique=new Set<string>();
 let opened=0,signedQty=0,net=0,last=0,entryComplete=false,flat=false;
 for(const r of fills){
  if(r.id===undefined||r.symbol!==position.symbol||!["BUY","SELL"].includes(r.side||"")||
    !Number.isFinite(Number(r.realizedPnl))||!Number.isFinite(Number(r.commission))||
    r.commissionAsset!=="USDT"||!(Number(r.qty)>0)||!(Number(r.time)>0))
   throw Error("V12_EXTERNAL_CLOSE_FILL_INVALID");
  if(unique.has(String(r.id)))continue;unique.add(String(r.id));
  const qty=Number(r.qty);
  if(!entryComplete){
   if(String(r.orderId)!==String(entry.orderId)||r.side!==openingSide)
    throw Error("V12_EXTERNAL_CLOSE_FOREIGN_FILL_BEFORE_ENTRY_COMPLETE");
   opened+=qty;
   if(opened>entryQty+tol)throw Error("V12_EXTERNAL_CLOSE_ENTRY_OVERFILL");
   signedQty+=sideSign(String(r.side))*qty;
   if(Math.abs(opened-entryQty)<=tol){
    entryComplete=true;
    if(Math.abs(signedQty-openingSigned)>tol)
     throw Error("V12_EXTERNAL_CLOSE_ENTRY_SIGNED_QTY_MISMATCH");
   }
  }else{
   signedQty+=sideSign(String(r.side))*qty;
   // A manual close may briefly cross through flat (e.g. 0.028 short -> 0.008 long)
   // before a correcting fill. It must never create a larger opposite exposure
   // than the strategy position being reconciled.
   if(Math.abs(signedQty)>entryQty+tol)
    throw Error("V12_EXTERNAL_CLOSE_REVERSAL_EXCEEDS_ENTRY");
  }
  net+=Number(r.realizedPnl)-Number(r.commission);
  last=Math.max(last,Number(r.time));
  if(entryComplete&&Math.abs(signedQty)<=tol){flat=true;break;}
 }
 if(!entryComplete||!flat)throw Error("V12_EXTERNAL_CLOSE_NET_FLAT_UNPROVEN");
 const income=await client.getIncomeHistory({symbol:position.symbol,incomeType:"FUNDING_FEE",
  startTime:first,endTime:last,limit:1000});
 if(income.length>=1000)throw Error("V12_EXTERNAL_CLOSE_FUNDING_COVERAGE_UNPROVEN");
 const seen=new Set<string>();
 for(const r of income){
  if(r.asset!=="USDT"||!Number.isFinite(Number(r.income))||r.incomeType!=="FUNDING_FEE"||
    r.symbol!==position.symbol)throw Error("V12_EXTERNAL_CLOSE_FUNDING_INVALID");
  const id=String(r.tranId||`${r.time}|${r.income}`);
  if(!seen.has(id)){net+=Number(r.income);seen.add(id);}
 }
 return {id:position.positionId,side:position.side,netPnl:net,exitTs:last};
}

async function recordExternalManualCloseBatch(
 client:Pick<AsterV3Client,"getOrder"|"getUserTrades"|"getIncomeHistory">,
 state:Awaited<ReturnType<FileV12X1AllRunnerStateStore["load"]>>,
 positions:readonly V12ActivePositionState[],now:number){
 const ledger:SideLossLedger=state.sideLossLedger ||= {initializedAt:now};
 const events=[];const seen=new Set<string>();
 for(const p of positions){
  if(ledger.completed?.includes(p.positionId)||seen.has(p.positionId))continue;
  seen.add(p.positionId);
  events.push(await getExternalManualCloseEvidence(client,p,now));
 }
 events.sort((a,b)=>a.exitTs-b.exitTs||a.id.localeCompare(b.id));
 for(const event of events)recordSideExit(ledger,event);
}

function actives(state:Awaited<ReturnType<FileV12X1AllRunnerStateStore["load"]>>):V12ActivePositionState[]{
 return state.activePositions?.length?[...state.activePositions]:(state.active?[state.active]:[]);
}
function allowedReview(reason:unknown){
 const text=String(reason||"").trim();
 return ALLOWED_REVIEW.some(prefix=>text===prefix||text.startsWith(prefix+":"));
}

export async function reconcileV12ExternalManualClose(input:{
 stateStore:FileV12X1AllRunnerStateStore;
 client:Pick<AsterV3Client,"getPositions"|"getOpenOrders"|"getOrder"|"getUserTrades"|"getIncomeHistory">;
 pendingRegistryPath:string;
 expectedStateSha:string;
 now?:number;
}){
 const now=input.now??Date.now();
 if(!/^[a-f0-9]{40}$/.test(input.expectedStateSha))throw Error("V12_EXTERNAL_CLOSE_EXPECTED_SHA_INVALID");
 const state=await input.stateStore.load();
 if(state.runtimeCommitSha!==input.expectedStateSha)throw Error("V12_EXTERNAL_CLOSE_STATE_SHA_MISMATCH");
 if(state.pending)throw Error("V12_EXTERNAL_CLOSE_PENDING_PRESENT");
 if(!allowedReview(state.manualReview)&&!(state.killSwitch?.active&&allowedReview(state.killSwitch.reason)))
  throw Error("V12_EXTERNAL_CLOSE_REVIEW_REASON_NOT_ELIGIBLE");
 const owned=actives(state);
 if(!owned.length)throw Error("V12_EXTERNAL_CLOSE_STATE_ALREADY_FLAT");
 const registry=await readPendingExposureRegistry(input.pendingRegistryPath);
 const activeReservations=registry.entries.filter(row=>row.status!=="RELEASED"&&
  (row.strategyId.toUpperCase()==="V12"||row.strategyId.toUpperCase().includes("V12_")));
 if(activeReservations.length)throw Error("V12_EXTERNAL_CLOSE_SHARED_PENDING_PRESENT");

 for(const position of owned){
  const rows=await input.client.getPositions(position.symbol);
  const actual=rows.filter(row=>String(row.symbol).toUpperCase()===position.symbol.toUpperCase()&&
   Math.abs(Number(row.positionAmt))>EPS);
  if(actual.length)throw Error("V12_EXTERNAL_CLOSE_VENUE_POSITION_REMAINS:"+position.symbol);
  const orders=await input.client.getOpenOrders(position.symbol);
  const ownedIds=new Set([position.protection.stopClientOrderId,position.protection.takeProfitClientOrderId].filter(Boolean));
  if(orders.some(order=>ownedIds.has(String(order.clientOrderId||""))))
   throw Error("V12_EXTERNAL_CLOSE_PROTECTION_ORDER_REMAINS:"+position.symbol);
 }
 await recordExternalManualCloseBatch(input.client,state,owned,now);

 state.active=undefined;
 state.activePositions=undefined;
 state.pending=undefined;
 state.manualReview=undefined;
 if(state.killSwitch?.active&&allowedReview(state.killSwitch.reason))state.killSwitch=undefined;
 state.reconciliationStatus="PASS";
 state.cooldownUntilTs=Math.max(Number(state.cooldownUntilTs||0),
  Number(state.lastReferenceTs||now)+V12_X1_ALL.cooldownBars*V12_X1_ALL.timeframeHours*3_600_000);
 await input.stateStore.save(state);
 const readback=await input.stateStore.load();
 if(actives(readback).length||readback.pending||readback.manualReview||readback.killSwitch?.active)
  throw Error("V12_EXTERNAL_CLOSE_STATE_READBACK_NOT_FLAT");
 return {
  status:"V12_EXTERNAL_MANUAL_CLOSE_RECONCILED" as const,
  positionsReconciled:owned.map(row=>({symbol:row.symbol,positionId:row.positionId,quantity:row.quantity,side:row.side})),
  stateRuntimeSha:readback.runtimeCommitSha,
  reconciliationStatus:readback.reconciliationStatus,
  cooldownUntilTs:readback.cooldownUntilTs,
  tradingMutation:0 as const,
 };
}
