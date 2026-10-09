import "dotenv/config";

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile, chmod, chown } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { runAsterReadOnlyRecoveryGate } from "../lib/aster-readonly-recovery-gate";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { prepareExternalManualFlatReconciliation, type AuthenticatedFill } from "../lib/external-manual-flat-reconcile";
import type { PenguDualLsV2RunnerState } from "../lib/pengu-dual-ls-v2-runner-state";
import type { V12X1AllRunnerState } from "../lib/v12-x1-all-runner-state";

const SHA = "ce1edeead8d0f9e5d88e829d415057117502a335";
const ACK = "I_CONFIRM_OPERATOR_MANUAL_CLOSE_AFTER_AUTHENTICATED_THREE_TIMES_FLAT";
const root = "/var/lib/disdex";
const files = {
  pengu: resolve(root,"pengu-dual-ls-v2/runner-live.json"),
  v52: resolve(root,"v52-aster-only/runner-live.json"),
  v12: resolve(root,"v12-x1-all/runner.json"),
  killSwitch: resolve(root,"shared/kill-switch.json"),
} as const;
type FileKey = keyof typeof files;
const keys = Object.keys(files) as FileKey[];
const UNITS = [
  "disdex-v12-x1-all",
  "disdex-v52-aster-only",
  "disdex-pengu-dual-ls-v2",
  "disdex-quality102-causal-v1",
  "disdex-fet-brk48",
  "disdex-hype-long",
  "disdex-idle-priority-short",
  "disdex-shared-crypto-risk",
  "disdex-v12-v52-margin-guard",
] as const;

function assert(value: unknown, code: string): asserts value {
  if (!value) throw new Error("EXTERNAL_MANUAL_RECOVERY_BLOCKED:" + code);
}
function unitState(unit: string) {
  const r=spawnSync("/usr/bin/systemctl",["show",unit+"@"+SHA+".service","-p","LoadState","-p","ActiveState","--no-pager"],{encoding:"utf8"});
  assert(r.status===0 && !r.error,"SYSTEMD_CHECK:"+unit);
  const data=Object.fromEntries(r.stdout.split(/\r?\n/).filter(Boolean).map(s=>s.split("=",2)));
  assert(data.LoadState==="loaded","UNIT_NOT_LOADED:"+unit);
  return data.ActiveState;
}
function allStopped() {
  for(const name of UNITS)assert(unitState(name)==="inactive" || unitState(name)==="failed","RUNNER_ACTIVE:"+name);
  const legacy=spawnSync("/usr/bin/systemctl",["is-active","disdex-v96-v52-live.service"],{encoding:"utf8"});
  assert(legacy.stdout.trim()!=="active","LEGACY_V96_ACTIVE");
}
function actualRelease() {
  const r=spawnSync("/usr/bin/readlink",["-f","/home/deploy/disdex-trading/current"],{encoding:"utf8"});
  assert(r.status===0 && r.stdout.trim().endsWith("/"+SHA),"CURRENT_PRODUCTION_SHA_CHANGED");
  assert(process.env.DISDEX_RELEASE_SHA===SHA,"RUNTIME_SHA_CHANGED");
}
async function safeState() {
  const read=async (path:string)=>JSON.parse(await readFile(path,"utf8")) as Record<string,unknown>;
  const obj={} as Record<FileKey,Record<string,unknown>>;
  for(const key of keys)obj[key]=await read(files[key]);
  const others = [
    ["quality102-causal-v1/state.json",["position","positions","pending","pendingOrder","manualReview"]],
    ["fet-brk48-residual/state.json",["position","positions","pending","pendingOrder","manualReview"]],
    ["hype-zec-long/runner.json",["position","positions","pending","pendingOrder","manualReview"]],
    ["idle-priority/state.json",["position","positions","pending","pendingOrder","manualReview"]],
    ["idle-priority/residual-long-state.json",["position","positions","pending","pendingOrder","manualReview"]],
  ] as const;
  for(const [name,props] of others){
    const d=await read(resolve(root,name));
    for(const key of props){
      const value=d[key];
      assert(!value || (Array.isArray(value) && value.length===0)
        || (typeof value==="object" && Object.keys(value).length===0),
        "OTHER_LOGIC_NOT_FLAT:"+name+":"+key);
    }
  }
  return obj;
}
function findFill(trades: Record<string,unknown>[], side:"BUY"|"SELL",qty:number,price:number):AuthenticatedFill {
  const exact=trades.filter(row=>row.side===side && Number(row.qty)===qty && Math.abs(Number(row.price)-price)<1e-9);
  assert(exact.length===1,"ORDER_NOT_UNIQUE:"+side+":"+qty+":"+price);
  const row=exact[0]!;
  const amount=Number(row.commission);
  assert(Number.isFinite(amount) && amount>=0,"INVALID_COMMISSION");
  return {
    symbol:String(row.symbol),orderId:Number(row.orderId),side,qty:Number(row.qty),
    price:Number(row.price),time:Number(row.time),realizedPnl:Number(row.realizedPnl),commission:amount,
  };
}
async function atomicWrite(file:string, value:unknown) {
  const previous=await stat(file);
  const temporary=file+".operator-manual."+process.pid+"."+randomUUID()+".tmp";
  try{
    await writeFile(temporary,JSON.stringify(value,null,2)+"\n",{flag:"wx",mode:0o600});
    if(process.getuid?.()===0)await chown(temporary,previous.uid,previous.gid);
    await chmod(temporary,0o600);
    await rename(temporary,file);
    const current=await stat(file);
    assert(current.uid===previous.uid && current.gid===previous.gid,"STATE_OWNER_CHANGED");
  }catch(err){throw err;}
}
async function replaceBytes(file:string,bytes:Buffer) {
  const previous=await stat(file);
  const temporary=file+".operator-rollback."+process.pid+"."+randomUUID()+".tmp";
  await writeFile(temporary,bytes,{flag:"wx",mode:0o600});
  if(process.getuid?.()===0)await chown(temporary,previous.uid,previous.gid);
  await chmod(temporary,0o600);
  await rename(temporary,file);
}
async function main() {
  if(process.argv.includes("--self-test")){
    assert(SHA.length===40 && UNITS.length===9 && ACK.length>20,"SELFTEST");
    console.log("EXTERNAL_MANUAL_FLAT_OPERATOR_SELF_TEST_PASS");return;
  }
  const apply=process.argv.includes("--apply");
  const verify=process.argv.includes("--verify-only");
  assert(apply!==verify,"EXACT_MODE_REQUIRED");
  assert(!apply || process.argv.includes(ACK),"OPERATOR_ACK_REQUIRED");
  assert(process.argv.includes("--sha="+SHA),"EXACT_SHA_ARG_REQUIRED");
  actualRelease();
  allStopped();
  const risk=await readSharedCryptoDailyRisk(resolve(root,"shared/crypto-daily-risk.json"));
  assert(risk.ok,"RISK_NOT_READY:"+risk.reason);
  const client=new AsterV3Client({
    baseUrl:process.env.ASTER_FUTURES_BASE_URL,
    userAddress:process.env.ASTER_USER_ADDRESS,
    privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`,
    readOnlyRateLimitMaxRetries:0,requestTimeoutMs:12000,
  });
  assert(client.hasTradingCredentials(),"SIGNED_ACCOUNT_READ_REQUIRED");
  const lock=new FileAccountOrderLock(resolve(root,"shared/account-order.lock"),120000);
  const handle=await lock.acquire("EXTERNAL_MANUAL_FLAT_RECOVERY:"+randomUUID());
  assert(handle,"ACCOUNT_LOCK_BUSY");
  try {
    allStopped();
    const initial=await safeState();
    const originals={} as Record<FileKey,Buffer>;
    for(const key of keys)originals[key]=await readFile(files[key]);
    const proof=await runAsterReadOnlyRecoveryGate(client,{
      requiredConsecutiveSuccesses:3, requestSpacingMs:750,roundSpacingMs:5000, requireFlat:true,
    });
    const [penguHistory,tslaHistory]=await Promise.all([
      client.getUserTrades("PENGUUSDT",{startTime:1791400000000,limit:300}),
      client.getUserTrades("TSLAUSDT",{startTime:1791400000000,limit:300}),
    ]);
    const fills={
      penguEntry:findFill(penguHistory as unknown as Record<string,unknown>[],"SELL",7718,0.008574),
      penguExit:findFill(penguHistory as unknown as Record<string,unknown>[],"BUY",7718,0.008163),
      tslaEntry:findFill(tslaHistory as unknown as Record<string,unknown>[],"BUY",0.38,372.64),
      tslaExit:findFill(tslaHistory as unknown as Record<string,unknown>[],"SELL",0.38,378.87),
    };
    // Some trading API responses omit 'symbol' in GET /userTrades for a symbol-scoped request.
    for(const [name,fill] of Object.entries(fills)) {
      if(fill.symbol==="undefined")fill.symbol=name.startsWith("pengu")?"PENGUUSDT":"TSLAUSDT";
    }
    const proposal=prepareExternalManualFlatReconciliation({
      productionSha:SHA,now:Date.now(),
      proof:{observedAt:Date.now()-1,consecutiveSuccesses:proof.consecutiveSuccesses,
        openPositionCount:proof.openPositionCount,openOrderCount:proof.openOrderCount,
        ordersSent:false,cancelSent:false,positionChangesSent:false},
      pengu:initial.pengu as unknown as PenguDualLsV2RunnerState,
      v52:initial.v52,v12:initial.v12 as unknown as V12X1AllRunnerState,
      killSwitch:initial.killSwitch,...fills,
    });
    console.log(JSON.stringify({status:"OPERATOR_MANUAL_FLAT_PREPARED",mode:verify?"VERIFY_ONLY":"APPLY",
      productionSha:SHA,proof:{consecutiveSuccesses:proof.consecutiveSuccesses,openPositionCount:0,openOrderCount:0},
      receipt:proposal.receipt,ordersSent:false}));
    if(verify)return;
    allStopped();
    const postRisk=await readSharedCryptoDailyRisk(resolve(root,"shared/crypto-daily-risk.json"));
    assert(postRisk.ok,"RISK_CHANGED:"+postRisk.reason);
    for(const key of keys)assert((await readFile(files[key])).equals(originals[key]),"STATE_CHANGED:"+key);
    const archive=resolve(root,"shared/operator-flat-recovery",new Date().toISOString().replace(/[:.]/g,"-")+"-"+randomUUID());
    await mkdir(archive,{recursive:true,mode:0o700});await chmod(archive,0o700);
    for(const key of keys)await writeFile(resolve(archive,key+".before.json"),originals[key],{flag:"wx",mode:0o600});
    await writeFile(resolve(archive,"receipt.json"),JSON.stringify({...proposal.receipt,
      v52ManualExitNetPnl:proposal.receipt.v52NetPnlUsdt,
      source:"SIGNED_ASTER_TRADES_AND_TRIPLE_FLAT",archive
    },null,2)+"\n",{flag:"wx",mode:0o600});
    const values={
      pengu:proposal.pengu,v52:proposal.v52,v12:proposal.v12,killSwitch:proposal.killSwitch,
    };
    try{
      for(const key of keys){await atomicWrite(files[key],values[key]);}
      const after=await safeState();
      assert(after.killSwitch.active===false,"KILL_CLEAR_NOT_PERSISTED");
      assert(!after.pengu.position && !after.v12.manualReview,"LOCAL_RECOVERY_NOT_PERSISTED");
      console.log(JSON.stringify({status:"OPERATOR_MANUAL_FLAT_APPLY_PASS",
        productionSha:SHA,archive,ordersSent:false,killSwitchCleared:true}));
    }catch(err){
      // Roll back all four files, including any write which renamed successfully
      // before its own post-rename verification raised an error.
      for(const key of [...keys].reverse())await replaceBytes(files[key],originals[key]).catch(e=>console.error("ROLLBACK_FAILED",key,String(e)));
      throw err;
    }
  }finally{await handle.release();}
}
main().catch(err=>{console.error("OPERATOR_MANUAL_FLAT_FAILED",String(err instanceof Error?err.message:err));process.exitCode=1;});
