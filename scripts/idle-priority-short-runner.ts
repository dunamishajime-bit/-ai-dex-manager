import {IDLE_PRIORITY_SHORT_POLICY} from "../config/idlePriorityShortPolicy";
import {readIdleState} from "../lib/idle-priority-short-state";
const sha=(process.env.DISDEX_RUNTIME_SHA||process.env.GIT_SHA||"").trim();
const statePath=process.env.IDLE_PRIORITY_SHORT_STATE_PATH||"/var/lib/disdex/idle-priority-short/state.json";
const shadow=(process.env.IDLE_PRIORITY_SHORT_MODE||"SHADOW").toUpperCase();
if(!/^[0-9a-f]{40}$/i.test(sha))throw new Error("IDLE_RUNTIME_SHA_REQUIRED");
if(!["SHADOW","LIVE"].includes(shadow))throw new Error("IDLE_RUNTIME_MODE_INVALID");
async function main(){const state=await readIdleState(statePath,sha);if(state.manualReview)throw new Error("IDLE_MANUAL_REVIEW_REQUIRED");
if(shadow==="LIVE")throw new Error("IDLE_LIVE_EXECUTION_NOT_ARMED_UNTIL_CODEX_COMPLETES_PARITY_AND_EXECUTION_ADAPTER");
console.log(JSON.stringify({strategy:"IDLE_PRIORITY_SHORT",mode:shadow,runtimeSha:sha,statePath,symbols:Object.keys(IDLE_PRIORITY_SHORT_POLICY.routes),status:"READY_SHADOW_FAIL_CLOSED"}));
setInterval(()=>{},60_000);}
main().catch(e=>{console.error(e instanceof Error?e.stack:e);process.exit(1)});
