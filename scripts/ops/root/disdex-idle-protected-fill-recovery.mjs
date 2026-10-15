/** Notification-only bridge for approved, protected Idle entry records.
 * No exchange requests, trading API calls, trading-state writes, or order mutations.
 * Remove once every live Idle process has its normal fill enqueue enabled.
 */
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {open,readFile,realpath} from "node:fs/promises";
import {basename} from "node:path";

export const INBOX="/var/lib/disdex/shared/trade-fill-notifications/inbox.jsonl";
export const IDLE_STATE="/var/lib/disdex/idle-priority/state.json";
export const CURRENT="/home/deploy/disdex-trading/current";

const orderId=(action,symbol,ts)=>"idle-"+action.toLowerCase()+"-"+
 createHash("sha256").update(["IDLE_PRIORITY_SHORT",action,symbol,ts].join("|")).digest("hex").slice(0,22);

export function candidateFromProtectedIdle(row) {
  const x=row??{};
  if (x.side!=="SHORT" || x.protectionVerified!==true ||
      !/^[A-Z0-9]+USDT$/.test(String(x.symbol||"")) ||
      ![x.entryPrice,x.quantity,x.signalTs,x.entryTs].every(Number.isFinite) ||
      x.entryPrice<=0 || x.quantity<=0 || x.signalTs<=0 || x.entryTs<=0 ||
      x.entryTs<x.signalTs || x.entryTs>Date.now()+60_000 ||
      x.stopClientOrderId!==orderId("STOP",x.symbol,x.signalTs) ||
      x.takeProfitClientOrderId!==orderId("TP",x.symbol,x.signalTs)) return null;
  return {
    schemaVersion:1,strategyId:"IDLE_PRIORITY_SHORT",eventType:"ENTRY_FILL",
    symbol:x.symbol,side:"SELL",reduceOnly:false,status:"FILLED",
    clientOrderId:orderId("ENTRY",x.symbol,x.signalTs),
    executedQuantity:x.quantity,averagePrice:x.entryPrice,
    quoteQuantity:x.quantity*x.entryPrice,executedAt:new Date(x.entryTs).toISOString(),
    reason:"遅延通知：実約定後に保護STOPが検証された建玉台帳から復元（表示時刻は保護完了時刻）",
    metadata:{recoveredFrom:"IDLE_PROTECTED_POSITION_LEDGER",delayed:true}
  };
}
const truthy=x=>/^(1|true|yes|on)$/i.test(String(x||"").trim());
function activeLiveIdleWithEnqueue(sha) {
  const unit="disdex-idle-priority-short@"+sha+".service";
  let pid;
  try {pid=Number(execFileSync("systemctl",["show",unit,"-p","MainPID","--value"],{encoding:"utf8",timeout:2000}).trim());}
  catch {return {active:false,hasNativeEnqueue:false};}
  if (!(pid>1))return {active:false,hasNativeEnqueue:false};
  try {
    const vars=execFileSync("cat",["/proc/"+pid+"/environ"],{encoding:"utf8",timeout:2000}).split("\0");
    const env=Object.fromEntries(vars.filter(z=>z.includes("=")).map(z=>[z.slice(0,z.indexOf("=")),z.slice(z.indexOf("=")+1)]));
    return {active:true,hasNativeEnqueue:truthy(env.DISDEX_TRADE_FILL_NOTIFICATION_ENABLED)&&String(env.DISDEX_TRADE_FILL_NOTIFICATION_MODE||"").toLowerCase()==="live"};
  } catch {return {active:false,hasNativeEnqueue:false};}
}
export async function recoverProtectedIdleEntryNotifications({write=false}={}) {
  const release=await realpath(CURRENT),sha=basename(release);
  if(!/^[a-f0-9]{40}$/.test(sha))throw Error("CURRENT_RELEASE_NOT_SHA");
  const runner=activeLiveIdleWithEnqueue(sha);
  if(!runner.active)return {status:"RUNNER_NOT_ACTIVE",queued:0};
  if(runner.hasNativeEnqueue)return {status:"NATIVE_ENQUEUE_ALREADY_ACTIVE",queued:0};
  const state=JSON.parse(await readFile(IDLE_STATE,"utf8"));
  if(state.runtimeSha!==sha || state.pending || state.manualReview)throw Error("IDLE_LEDGER_NOT_CERTIFIED_SETTLED");
  if(!Array.isArray(state.positions))throw Error("IDLE_POSITIONS_NOT_ARRAY");
  const contents=await readFile(INBOX,"utf8");
  if(contents && !contents.endsWith("\n"))throw Error("INCOMPLETE_INBOX_RECORD");
  const present=new Set();
  for(const line of contents.split("\n").filter(Boolean)){
    const entry=JSON.parse(line);
    if(entry?.strategyId==="IDLE_PRIORITY_SHORT"&&entry.eventType==="ENTRY_FILL"&&entry.clientOrderId)present.add(entry.clientOrderId);
  }
  const pending=[];
  for(const row of state.positions){
    const event=candidateFromProtectedIdle(row);
    if(!event || present.has(event.clientOrderId))continue;
    present.add(event.clientOrderId);pending.push(event);
  }
  if(write&&pending.length){
    const file=await open(INBOX,"a",0o600);
    try {for(const event of pending)await file.writeFile(JSON.stringify(event)+"\n","utf8");await file.sync();}
    finally {await file.close();}
  }
  return {status:write?"ENQUEUED":"DRY_RUN",queued:write?pending.length:0,
    wouldQueue:pending.length,alreadySeen:state.positions.length-pending.length,
    ordersSent:0,cancelsSent:0,venueCalls:0};
}
const main=process.argv[1]?.endsWith("disdex-idle-protected-fill-recovery.mjs");
if(main){
  const write=process.argv.includes("--enqueue");
  recoverProtectedIdleEntryNotifications({write}).then(r=>{console.log(JSON.stringify({component:"idle-fill-queue-bridge",...r}));})
  .catch(e=>{console.error(JSON.stringify({component:"idle-fill-queue-bridge",status:"ERROR",error:String(e.message??e)}));process.exitCode=1;});
}
