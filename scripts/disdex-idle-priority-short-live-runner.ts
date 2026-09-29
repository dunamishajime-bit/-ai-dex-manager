import { resolveIdlePriorityShortRuntime } from "../config/idlePriorityShortRuntime";
import { readIdleParityCertificate } from "../lib/idle-priority-short-parity-cert";
import { readIdleState } from "../lib/idle-priority-short-state";

async function main(){
 const runtime=resolveIdlePriorityShortRuntime();
 const state=await readIdleState(runtime.statePath,runtime.runtimeSha);
 if(state.manualReview) throw new Error("IDLE_MANUAL_REVIEW_ACTIVE");
 if(runtime.mode==="LIVE") readIdleParityCertificate(runtime.parityCertificatePath,runtime.runtimeSha);
 if(process.argv.includes("--self-test")){
  console.log(JSON.stringify({event:"idle-priority-short-selftest",status:"PASS",mode:runtime.mode,enabled:runtime.enabled,parityRequired:runtime.mode==="LIVE",liveOrders:0,cancelOrders:0,positionChanges:0}));
  return;
 }
 if(!runtime.enabled){console.log(JSON.stringify({event:"idle-priority-short-runtime",status:"disabled",mode:runtime.mode,liveOrders:0,cancelOrders:0,positionChanges:0}));return;}
 // Deliberately no order path until deterministic 495→63→61 portfolio replay is certified.
 // This keeps SHADOW observability deployable while making premature LIVE mutation impossible.
 if(runtime.mode==="LIVE") throw new Error("IDLE_LIVE_ORDER_PATH_NOT_CERTIFIED");
 console.log(JSON.stringify({event:"idle-priority-short-shadow",status:"ready",ownedPositions:state.positions.length,liveOrders:0,cancelOrders:0,positionChanges:0}));
}
main().catch(e=>{console.error(JSON.stringify({level:"fatal",event:"idle-priority-short-runner",message:e instanceof Error?e.message:String(e),liveOrders:0,cancelOrders:0,positionChanges:0}));process.exitCode=1;});
