/**
 * One-shot, explicitly authorized V4 reduction for already-owned legs.
 *
 * This command never grants entry authority. It accepts exactly two legs from
 * the operator request (AAVEUSDT and NEARUSDT), validates the durable state
 * and expected quantities, and then lets V4RunnerEngine perform the normal
 * signed reconciliation, durable EXIT dispatch, fill reconciliation, and
 * resident STOP retirement. The production daemon does not use this path.
 */
import {buildV4ProductionRuntime} from "./v12-v4-production-runner";
import type {V4OperatorExitAuthorizationInput} from "../lib/v12-v4-runner-engine";

const OPERATOR_ACK="I_AUTHORIZE_V4_OPERATOR_EXIT_AAVE_NEAR";
const TARGET_SYMBOLS=new Set(["AAVEUSDT","NEARUSDT"]);
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
function assertRequestedState(runtime:any,ids:string[],expectedQty:Map<string,number>,expectedExitTs:number,expectedExitPrice:number){
 const active=activeLegs(runtime);
 const activeIds=new Set(active.map((leg:any)=>leg.id));
 if(active.length!==ids.length||ids.some(id=>!activeIds.has(id)))throw Error("V4_OPERATOR_EXIT_ACTIVE_LEG_SET_CHANGED");
 for(const leg of active){
  const symbol=String(leg.candidate.symbol).toUpperCase();
  if(!TARGET_SYMBOLS.has(symbol)||leg.candidate.effectiveSide!=="SHORT")throw Error("V4_OPERATOR_EXIT_TARGET_SIDE_INVALID");
  if(!sameQuantity(Number(leg.qty),expectedQty.get(symbol)!))throw Error("V4_OPERATOR_EXIT_QUANTITY_CHANGED:"+symbol);
  if(symbol==="AAVEUSDT"){
   const planned=leg.plannedExit;
   if(!planned||planned.reason!=="TIME"||planned.priceModelOnly!==true||
    Number(planned.exitTs)!==expectedExitTs||!samePrice(Number(planned.price),expectedExitPrice))
    throw Error("V4_OPERATOR_EXIT_AAVE_PLANNED_EXIT_CHANGED");
  }
 }
 const unresolvedReductions=Object.values(runtime.store.read().intents as Record<string,any>)
  .filter((intent:any)=>["EXIT","TAKE_PROFIT"].includes(intent.action)&&intent.stage!=="TERMINAL");
 if(unresolvedReductions.length)throw Error("V4_OPERATOR_EXIT_UNRESOLVED_REDUCTION_EXISTS");
}
function assertRemainingState(runtime:any,ids:string[],expectedQty:Map<string,number>){
 for(const leg of activeLegs(runtime)){
  const symbol=String(leg.candidate.symbol).toUpperCase();
  if(!ids.includes(leg.id)||!TARGET_SYMBOLS.has(symbol)||leg.candidate.effectiveSide!=="SHORT"||
   !sameQuantity(Number(leg.qty),expectedQty.get(symbol)!))throw Error("V4_OPERATOR_EXIT_REMAINING_STATE_CHANGED");
 }
}

async function main(){
 const expectedSha=value("--expected-sha").toLowerCase();
 if(!SHA.test(expectedSha)||String(process.env.DISDEX_RELEASE_SHA??"").toLowerCase()!==expectedSha||
  String(process.env.V12_V4_LIVE_ACK??"").toLowerCase()!==expectedSha)
  throw Error("V4_OPERATOR_EXIT_RELEASE_ACK_MISMATCH");
 const ids=values("--leg-id");
 if(ids.length<1||ids.length>2||new Set(ids).size!==ids.length)throw Error("V4_OPERATOR_EXIT_REQUIRES_ONE_OR_TWO_LEGS");
 const symbols=ids.map(id=>id.split(":",1)[0].toUpperCase());
 if(new Set(symbols).size!==ids.length||symbols.some(symbol=>!TARGET_SYMBOLS.has(symbol)))
  throw Error("V4_OPERATOR_EXIT_TARGET_SYMBOL_SET_INVALID");
 if(value("--ack")!==OPERATOR_ACK)throw Error("V4_OPERATOR_EXIT_ACK_INVALID");
 const expectedQty=qtyMap(values("--expected-qty"),symbols);
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
   if(!planned||planned.reason!=="TIME"||planned.priceModelOnly!==true||
    Number(planned.exitTs)!==expectedExitTs||!samePrice(Number(planned.price),expectedExitPrice))
    throw Error("V4_OPERATOR_EXIT_AAVE_PLANNED_EXIT_AUTHORIZATION_INVALID");
  }
  const current=runtime.store.read().state.legs[input.legId];
  if(!current||current.status!=="OPEN"||current.qty<=0||current.candidate.symbol!==input.symbol||
   !sameQuantity(Number(current.qty),expectedQty.get(input.symbol)!))
   throw Error("V4_OPERATOR_EXIT_AUTHORIZATION_LEG_CHANGED");
 };
 runtime=await buildV4ProductionRuntime({operatorExitLegIds:new Set(ids),authorizeOperatorExit:authorize});
 assertRequestedState(runtime,ids,expectedQty,expectedExitTs,expectedExitPrice);
 const before=activeLegs(runtime).map(legSummary);
 if(!apply){
  console.log(JSON.stringify({status:"V4_OPERATOR_EXIT_PREFLIGHT_PASS",releaseSha:expectedSha,
   applyRequired:true,targets:before,ordersSent:0,cancelsSent:0}));
  return;
 }
 const results:any[]=[];
 for(let attempt=0;attempt<ids.length;attempt++){
  const remaining=activeLegs(runtime);
  if(!remaining.length)break;
  const result=await runtime.engine.tick();
  results.push({status:result.status,reason:result.reason,eventTs:result.eventTs,orderEnabled:result.orderEnabled});
  const after=activeLegs(runtime);
  if(!after.length)break;
  if(result.status!=="exited")throw Error("V4_OPERATOR_EXIT_INCOMPLETE:"+result.reason);
  assertRemainingState(runtime,ids,expectedQty);
 }
 const after=activeLegs(runtime);
 if(after.length)throw Error("V4_OPERATOR_EXIT_REMAINING_ACTIVE_LEGS");
 const finalState=runtime.store.read().state;
 console.log(JSON.stringify({status:"V4_OPERATOR_EXIT_SUCCESS",releaseSha:expectedSha,
  targets:before,results,remainingActiveLegs:[],closedLegIds:ids,
  journalEvents:finalState.journal.length}));
}

main().catch(error=>{
 console.error(JSON.stringify({status:"V4_OPERATOR_EXIT_FAILED",error:error instanceof Error?error.message:String(error)}));
 process.exitCode=1;
});
