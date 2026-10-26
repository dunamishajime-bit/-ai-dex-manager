/**
 * One-shot, explicitly authorized V4 reduction for already-owned legs.
 *
 * This command never grants entry authority. It allows only the single
 * AAVEUSDT REC_X06 leg to exit while preserving the NEARUSDT REC_X02 leg
 * and its resident STOP. It rejects mismatched quantities, changed planned
 * exits, wrong orders and any unexpected active legs. The production daemon
 * does not use this path. This is a one-time incident recovery command.
 */
import {buildV4ProductionRuntime} from "./v12-v4-production-runner";
import type {V4OperatorExitAuthorizationInput} from "../lib/v12-v4-runner-engine";

const OPERATOR_ACK="I_AUTHORIZE_V4_OPERATOR_EXIT_AAVE_NEAR";
const TARGET_SYMBOLS=new Set(["AAVEUSDT"]);
const AAVE_LEG_ID="AAVEUSDT:REC_X06_TIME_12H:SHORT:1792980000000";
const NEAR_LEG_ID="NEARUSDT:REC_X02_TIME_36H:SHORT:1792980000000";
const AAVE_PLANNED_REASON="V4_SHORT_INITIAL_ADVERSE_CANDIDATE";
const NEAR_STOP_ID="v12-v4-50ef46933e7018db365535fa70fd";
const AAVE_STOP_ID="v12-v4-951af02fc439551f9aa47801d2db";
const SHA=/^[a-f0-9]{40}$/;

function value(name:string){
 const index=process.argv.indexOf(name);
 if(index<0||!process.argv[index+1])throw Error("V4_OPERATOR_EXIT_ARGUMENT_MISSING:"+name);
 return process.argv[index+1];
}
function values(name:string){
 return process.argv.flatMap((arg,index)=>arg===name&&process.argv[index+1]?[process.argv[index+1]]:[]);
}
function qtyMap(raw:string[],symbols:string[]){
 const result=new Map<string,number>();
 for(const item of raw){
  const [symbol,rawQty]=item.split("=",2),quantity=Number(rawQty);
  if(!TARGET_SYMBOLS.has(symbol)||!(quantity>0)||!Number.isFinite(quantity)||result.has(symbol))
   throw Error("V4_OPERATOR_EXIT_EXPECTED_QTY_INVALID");
  result.set(symbol,quantity);
 }
 if(result.size!==symbols.length||symbols.some(symbol=>!result.has(symbol)))throw Error("V4_OPERATOR_EXIT_EXPECTED_QTY_INCOMPLETE");
 return result;
}
function sameQuantity(actual:number,expected:number){
 return Math.abs(actual-expected)<=Math.max(1e-8,Math.abs(expected)*1e-7);
}
function samePrice(actual:number,expected:number){
 return Math.abs(actual-expected)<=Math.max(1e-8,Math.abs(expected)*1e-7);
}
function legSummary(leg:any){
 return {id:leg.id,symbol:leg.candidate.symbol,side:leg.candidate.effectiveSide,
  route:leg.candidate.route,qty:leg.qty,status:leg.status,
  plannedExit:leg.plannedExit??null};
}
function activeLegs(runtime:any){
 return Object.values(runtime.store.read().state.legs as Record<string,any>)
  .filter((leg:any)=>leg.qty>0&&leg.status==="OPEN") as any[];
}
function assertProtectedStop(runtime:any,legId:string,expectedQty:number,expectedStopId:string){
 const state=runtime.store.read();
 const protection=state.protections[legId];
 if(!protection||protection.phase!=="STOP_CONFIRMED"||
  !sameQuantity(Number(protection.protectedQty),expectedQty)||
  protection.stopClientOrderId!==expectedStopId)
  throw Error("V4_OPERATOR_EXIT_STOP_PROTECTION_DRIFT:"+legId);
 const intent=state.intents[expectedStopId];
 if(!intent||intent.legId!==legId||intent.action!=="STOP"||intent.stage!=="ACKNOWLEDGED"||
  !sameQuantity(Number(intent.command?.quantity),expectedQty))
  throw Error("V4_OPERATOR_EXIT_STOP_INTENT_DRIFT:"+legId);
}
function assertRequestedState(runtime:any,expectedQty:Map<string,number>,expectedNearQty:number,
 expectedExitTs:number,expectedExitPrice:number){
 const active=activeLegs(runtime);
 if(active.length!==2||new Set(active.map(x=>x.id)).size!==2||
  !active.some(x=>x.id===AAVE_LEG_ID)||!active.some(x=>x.id===NEAR_LEG_ID))
  throw Error("V4_OPERATOR_EXIT_ACTIVE_LEG_SET_CHANGED");
 const aave=active.find(x=>x.id===AAVE_LEG_ID)!;
 const near=active.find(x=>x.id===NEAR_LEG_ID)!;
 if(aave.candidate.symbol!=="AAVEUSDT"||aave.candidate.route!=="REC_X06_TIME_12H"||
  aave.candidate.effectiveSide!=="SHORT"||
  !sameQuantity(Number(aave.qty),expectedQty.get("AAVEUSDT")!))
  throw Error("V4_OPERATOR_EXIT_AAVE_LEG_CHANGED");
 const planned=aave.plannedExit;
 if(!planned||planned.reason!==AAVE_PLANNED_REASON||planned.priceModelOnly!==true||
  Number(planned.exitTs)!==expectedExitTs||!samePrice(Number(planned.price),expectedExitPrice))
  throw Error("V4_OPERATOR_EXIT_AAVE_PLANNED_EXIT_CHANGED");
 if(near.candidate.symbol!=="NEARUSDT"||near.candidate.route!=="REC_X02_TIME_36H"||
  near.candidate.effectiveSide!=="SHORT"||
  !sameQuantity(Number(near.qty),expectedNearQty)||near.plannedExit)
  throw Error("V4_OPERATOR_EXIT_PRESERVED_NEAR_LEG_CHANGED");
 assertProtectedStop(runtime,AAVE_LEG_ID,expectedQty.get("AAVEUSDT")!,AAVE_STOP_ID);
 assertProtectedStop(runtime,NEAR_LEG_ID,expectedNearQty,NEAR_STOP_ID);
 const unresolvedReductions=Object.values(runtime.store.read().intents as Record<string,any>)
  .filter((intent:any)=>["EXIT","TAKE_PROFIT"].includes(intent.action)&&intent.stage!=="TERMINAL");
 if(unresolvedReductions.length)throw Error("V4_OPERATOR_EXIT_UNRESOLVED_REDUCTION_EXISTS");
}
function assertRemainingState(runtime:any,expectedNearQty:number){
 const active=activeLegs(runtime);
 if(active.length!==1||active[0].id!==NEAR_LEG_ID||
  active[0].candidate.symbol!=="NEARUSDT"||active[0].candidate.route!=="REC_X02_TIME_36H"||
  active[0].candidate.effectiveSide!=="SHORT"||
  !sameQuantity(Number(active[0].qty),expectedNearQty))
  throw Error("V4_OPERATOR_EXIT_PRESERVED_NEAR_STATE_CHANGED");
 assertProtectedStop(runtime,NEAR_LEG_ID,expectedNearQty,NEAR_STOP_ID);
}

async function main(){
 const expectedSha=value("--expected-sha").toLowerCase();
 if(!SHA.test(expectedSha)||String(process.env.DISDEX_RELEASE_SHA??"").toLowerCase()!==expectedSha||
  String(process.env.V12_V4_LIVE_ACK??"").toLowerCase()!==expectedSha)
  throw Error("V4_OPERATOR_EXIT_RELEASE_ACK_MISMATCH");
 const ids=values("--leg-id");
 if(ids.length!==1||ids[0]!==AAVE_LEG_ID)throw Error("V4_OPERATOR_EXIT_AAVE_ONLY_EXACT_LEG_REQUIRED");
 const symbols=ids.map(id=>id.split(":",1)[0].toUpperCase());
 if(new Set(symbols).size!==ids.length||symbols.some(symbol=>!TARGET_SYMBOLS.has(symbol)))
  throw Error("V4_OPERATOR_EXIT_TARGET_SYMBOL_SET_INVALID");
 if(value("--ack")!==OPERATOR_ACK)throw Error("V4_OPERATOR_EXIT_ACK_INVALID");
 const expectedQty=qtyMap(values("--expected-qty"),symbols);
 const expectedNearQty=Number(value("--expected-near-qty"));
 if(!sameQuantity(expectedNearQty,2))throw Error("V4_OPERATOR_EXIT_EXPECTED_NEAR_QTY_CHANGED");
 const expectedExitTs=Number(value("--expected-aave-exit-ts"));
 const expectedExitPrice=Number(value("--expected-aave-exit-price"));
 if(!Number.isSafeInteger(expectedExitTs)||!(expectedExitPrice>0)||!Number.isFinite(expectedExitPrice))
  throw Error("V4_OPERATOR_EXIT_EXPECTED_AAVE_EXIT_INVALID");
 const apply=process.argv.includes("--apply");
 let runtime:any;
 const authorize=async(input:V4OperatorExitAuthorizationInput)=>{
  if(!ids.includes(input.legId)||!TARGET_SYMBOLS.has(input.symbol)||input.positionSide!=="SHORT"||
   !sameQuantity(input.quantity,expectedQty.get(input.symbol)!))throw Error("V4_OPERATOR_EXIT_AUTHORIZATION_SCOPE_INVALID");
  if(input.symbol==="AAVEUSDT"){
   const planned=input.plannedExit;
   if(!planned||planned.reason!==AAVE_PLANNED_REASON||planned.priceModelOnly!==true||
    Number(planned.exitTs)!==expectedExitTs||!samePrice(Number(planned.price),expectedExitPrice))
    throw Error("V4_OPERATOR_EXIT_AAVE_PLANNED_EXIT_AUTHORIZATION_INVALID");
  }
  const current=runtime.store.read().state.legs[input.legId];
  if(!current||current.status!=="OPEN"||current.qty<=0||current.candidate.symbol!==input.symbol||
   !sameQuantity(Number(current.qty),expectedQty.get(input.symbol)!))
   throw Error("V4_OPERATOR_EXIT_AUTHORIZATION_LEG_CHANGED");
 };
 runtime=await buildV4ProductionRuntime({operatorExitLegIds:new Set(ids),authorizeOperatorExit:authorize});
 assertRequestedState(runtime,expectedQty,expectedNearQty,expectedExitTs,expectedExitPrice);
 const before=activeLegs(runtime).map(legSummary);
 if(!apply){
  console.log(JSON.stringify({status:"V4_OPERATOR_EXIT_PREFLIGHT_PASS",releaseSha:expectedSha,
   applyRequired:true,targets:before,ordersSent:0,cancelsSent:0}));
  return;
 }
 const result=await runtime.engine.tick();
 if(result.status!=="exited")throw Error("V4_OPERATOR_EXIT_INCOMPLETE:"+result.reason);
 assertRemainingState(runtime,expectedNearQty);
 const finalState=runtime.store.read().state;
 console.log(JSON.stringify({status:"V4_OPERATOR_EXIT_SUCCESS",releaseSha:expectedSha,
  targets:before,results:[{status:result.status,reason:result.reason,eventTs:result.eventTs,
   orderEnabled:result.orderEnabled}],remainingActiveLegs:activeLegs(runtime).map(legSummary),
  closedLegIds:[AAVE_LEG_ID],preservedLegId:NEAR_LEG_ID,
  journalEvents:finalState.journal.length}));
}

main().catch(error=>{
 console.error(JSON.stringify({status:"V4_OPERATOR_EXIT_FAILED",error:error instanceof Error?error.message:String(error)}));
 process.exitCode=1;
});
