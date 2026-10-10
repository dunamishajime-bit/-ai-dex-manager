import type {AsterV3Client} from "./aster-v3-client";
import {readPendingExposureRegistry} from "./disdex-pending-exposure-registry";
import {recordV12ConfirmedExitBatch} from "./v12-dd1296-live-policy";
import type {V12AsterLiveAdapter} from "./v12-aster-live-adapter";
import {FileV12X1AllRunnerStateStore,type V12ActivePositionState} from "./v12-x1-all-runner-state";
import {V12_X1_ALL} from "../config/v12X1AllRuntime";

const EPS=1e-12;
const ALLOWED_REVIEW=["V12_POSITION_SIDE_OR_QTY_MISMATCH","V12_STATE_ONLY_POSITION_MISMATCH"];

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
 await recordV12ConfirmedExitBatch({client:input.client} as unknown as V12AsterLiveAdapter,state,owned,now);

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
