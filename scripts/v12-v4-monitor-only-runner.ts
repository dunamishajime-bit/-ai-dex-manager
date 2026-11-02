import "dotenv/config";
import { lstat, readFile, mkdir, rename, writeFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { AsterV3Client } from "../lib/aster-v3-client";
import { loadV4ClosedCandles, buildV4LiveDecisionBatch } from "../lib/v12-v4-live-candidate-builder";
import { attachV4NativeCoreCandidates } from "../lib/v12-v4-core-candidate";
import { assertV4EntrySafety } from "../lib/v12-v4-entry-safety";
import { assertV4MonitorRateBudget, blockedV4MonitorRead, createV4MonitorFetch, evaluateV4MonitorCompletedDecision, runV4MonitorCycle, type V4MonitorResult } from "../lib/v12-v4-monitor-only";
import { writeRunnerTickHeartbeat } from "../lib/disdex-runner-tick-heartbeat";

type JsonRecord=Record<string,any>;
const SHA_RE=/^[0-9a-f]{40}$/i;

function releaseSha(){
 const value=String(process.env.DISDEX_RELEASE_SHA||process.env.DISDEX_RUNTIME_COMMIT_SHA||"").trim().toLowerCase();
 if(!SHA_RE.test(value))throw Error("V4_MONITOR_RELEASE_SHA_INVALID");
 return value;
}
async function trustedJson(path:string){
 const st=await lstat(path);
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o002)!==0)throw Error("V4_MONITOR_SHARED_STATE_UNTRUSTED:"+path);
 return JSON.parse(await readFile(path,"utf8"));
}
async function atomicJson(path:string,value:unknown){
 await mkdir(dirname(path),{recursive:true,mode:0o750});
 const tmp=path+"."+process.pid+"."+Date.now()+"."+randomUUID()+".tmp";
 try{
  await writeFile(tmp,JSON.stringify(value,null,2)+"\n",{encoding:"utf8",mode:0o640,flag:"wx"});
  await rename(tmp,path);
 }catch(error){await unlink(tmp).catch(()=>undefined);throw error;}
}
function safeReason(error:unknown){
 return (error instanceof Error?error.message:String(error))
  .replace(/(secret|private.?key|signature|token|api.?key)=?[^\s,;]+/ig,"$1=[REDACTED]")
  .replace(/[\r\n\t]+/g," ").slice(0,180)||"MONITOR_READ_FAILED";
}
async function decision(client:AsterV3Client,now:number){
 const bars=await loadV4ClosedCandles(client,now);
 let value=buildV4LiveDecisionBatch(bars,now);
 if(value.nativeCoreEvents.length){
  const refs=new Map<string,number>();
  for(const event of value.nativeCoreEvents){
   const raw=await client.getKlines(event.symbol+"USDT","1h",3);
   const opened=raw.find(row=>Number(row[0])===event.entry_ts_ms);
   if(!opened||Number(opened[0])>now||!(Number(opened[1])>0))throw Error("V4_NATIVE_CORE_ENTRY_H1_OPEN_MISSING");
   refs.set(event.symbol+"|"+event.entry_ts_ms,Number(opened[1]));
  }
  value=attachV4NativeCoreCandidates(value,bars,refs);
 }
 return value;
}
async function cycle(now=Date.now()){
 const sha=releaseSha();
 assertV4MonitorRateBudget(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH,process.env.DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET,sha);
 const client=new AsterV3Client({
  baseUrl:process.env.ASTER_FUTURES_BASE_URL,userAddress:process.env.ASTER_USER_ADDRESS,
  privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`|undefined,
  requestTimeoutMs:10000,fetchImpl:createV4MonitorFetch(fetch),userAgent:"DisDex-V12-V4-Monitor/"+sha.slice(0,12),
 });
 if(!client.hasTradingCredentials())throw Error("V4_SIGNED_VENUE_CREDENTIALS_REQUIRED");
 const entrySafetyError=await assertV4EntrySafety().then(()=>null,(error)=>safeReason(error));
 const [risk,margin,killSwitch,pending,positions,openOrders,market]=await Promise.all([
  trustedJson(process.env.DISDEX_V4_DYNAMIC_SHARED_RISK_PATH||"/var/lib/disdex/shared/crypto-daily-risk.json"),
  trustedJson(process.env.DISDEX_V4_DYNAMIC_MARGIN_PATH||"/var/lib/disdex/shared/margin-risk/guard-live.json"),
  trustedJson(process.env.DISDEX_V4_DYNAMIC_KILL_SWITCH_PATH||"/var/lib/disdex/shared/kill-switch.json"),
  trustedJson(process.env.DISDEX_PENDING_EXPOSURE_REGISTRY_PATH||"/var/lib/disdex/shared/pending-exposure.json"),
  client.getPositions(),client.getOpenOrders(),decision(client,now),
 ]);
 return {sha,result:evaluateV4MonitorCompletedDecision({
  now,risk,margin,killSwitch,pending,
  positions:positions as unknown as JsonRecord[],openOrders:openOrders as unknown as JsonRecord[],
  decision:market as unknown as JsonRecord,
 },entrySafetyError)};
}
async function health(sha:string,result:V4MonitorResult,at:number,lastTickAt:number|null){
 const path=String(process.env.V12_V4_MONITOR_HEALTH_STATE_PATH||"/var/lib/disdex/v12-v4/monitor/heartbeat.json");
 if(!path.startsWith("/var/lib/disdex/v12-v4/monitor/"))throw Error("V4_MONITOR_HEALTH_PATH_INVALID");
 await atomicJson(path,{schema:"disdex-v12-v4-monitor-heartbeat/v1",runnerId:"V12_V4_MONITOR",
  serviceUnit:`disdex-v12-v4-monitor@${sha}.service`,expectedSha:sha,runtimeSha:sha,
  workingDirectory:String(process.env.DISDEX_RELEASE_ROOT||process.cwd()),mainPid:process.pid,
  heartbeatAt:at,lastTickAt,mode:"MONITOR_ONLY",liveEnabled:false,
  safetyState:result.status==="blocked"?"BLOCKED":"OBSERVING",newOrdersAllowed:false,
  status:result.status,reason:result.reason,candidateCount:result.candidateCount,
  positionCount:result.positionCount,openOrderCount:result.openOrderCount,pendingCount:result.pendingCount});
}
async function main(){
 const daemon=process.argv.includes("--daemon"),once=process.argv.includes("--once");
 if(daemon===once)throw Error("V4_MONITOR_REQUIRES_EXACTLY_ONE_MODE");
 let stop=false;let lastTickAt:number|null=null;process.once("SIGINT",()=>{stop=true});process.once("SIGTERM",()=>{stop=true});
 do{
  const sha=releaseSha();
  const outcome=await runV4MonitorCycle({
   collect:async started=>(await cycle(started)).result,
   onError:(error,at)=>blockedV4MonitorRead(safeReason(error),at),
   publishTick:async (result,started,completed)=>{await writeRunnerTickHeartbeat({runnerId:"V12_V4_MONITOR",runtimeSha:sha,
    serviceUnit:`disdex-v12-v4-monitor@${sha}.service`,tickStartedAt:started,tickCompletedAt:completed,
    status:result.status,reason:result.reason,newOrdersAllowed:false,
    ordersSent:0,cancelsSent:0,positionChangesSent:0});},
   publishHealth:async (result,at,last)=>health(sha,result,at,last),clock:Date.now,lastTickAt,
  });
  lastTickAt=outcome.lastTickAt;const result=outcome.result;
  console.log(JSON.stringify({sha,mode:"MONITOR_ONLY",...result,ordersSent:0,cancelsSent:0,positionChangesSent:0}));
  if(!daemon||stop)break;
  await new Promise<void>(done=>setTimeout(done,Math.max(15000,Number(process.env.V12_V4_MONITOR_INTERVAL_MS||60000))));
 }while(!stop);
}
main().catch(error=>{console.error(JSON.stringify({status:"V4_MONITOR_FAILED_CLOSED",error:safeReason(error),
 ordersSent:0,cancelsSent:0,positionChangesSent:0}));process.exitCode=2;});
