#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SYSTEMCTL="/usr/bin/systemctl";
const SHA_RE=/^[0-9a-f]{40}$/;
const MAX_TICK_AGE_MS=300_000;
const FUTURE_GRACE_MS=10_000;

function fail(reason){ throw new Error(reason); }

export function validateRunnerTick(value,{runnerId,pin,pid,cwd,now}){
  if(!value||typeof value!=="object"||Array.isArray(value)) fail("TICK_INVALID");
  if(value.schema!=="disdex-runner-tick/v1") fail("TICK_SCHEMA");
  if(value.runnerId!==runnerId) fail("TICK_RUNNER_MISMATCH");
  if(value.runtimeSha!==pin.sha||value.expectedSha!==pin.sha) fail("TICK_SHA_MISMATCH");
  if(value.serviceUnit!==pin.serviceUnit) fail("TICK_SERVICE_MISMATCH");
  if(value.mainPid!==pid) fail("TICK_PID_MISMATCH");
  if(value.workingDirectory!==cwd||cwd!==pin.releaseRoot) fail("TICK_CWD_MISMATCH");
  if(typeof value.tickCompletedAt!=="number"||!Number.isFinite(value.tickCompletedAt)||value.tickCompletedAt<=0)
    fail("TICK_TIMESTAMP_INVALID");
  if(value.tickCompletedAt>now+FUTURE_GRACE_MS) fail("TICK_FUTURE");
  if(now-value.tickCompletedAt>MAX_TICK_AGE_MS) fail("TICK_STALE");
  if(typeof value.outcome!=="string"||!value.outcome.trim()) fail("TICK_OUTCOME_INVALID");
  if(typeof value.newOrdersAllowed!=="boolean") fail("TICK_PERMISSION_INVALID");
  return {
    tickCompletedAt:value.tickCompletedAt,
    outcome:value.outcome.trim(),
    newOrdersAllowed:value.newOrdersAllowed,
  };
}

export function buildSupervisorHeartbeat({runnerId,pin,pid,cwd,now,tick,safetyState,healthReason}){
  if(!["HEALTHY","BLOCKED"].includes(safetyState)) fail("HEARTBEAT_SAFETY_STATE_INVALID");
  return {
    schema:"disdex-runner-heartbeat/v1",
    runnerId,
    serviceUnit:pin.serviceUnit,
    runtimeSha:pin.sha,
    expectedSha:pin.sha,
    workingDirectory:cwd,
    mode:"LIVE",
    liveEnabled:true,
    safetyState,
    newOrdersAllowed:safetyState==="HEALTHY"&&tick.newOrdersAllowed===true,
    heartbeatAt:now,
    lastTickAt:tick.tickCompletedAt,
    mainPid:pid,
    healthReason:String(healthReason||""),
    tickOutcome:tick.outcome,
  };
}

export async function atomicJson(filePath,value){
  const parent=dirname(filePath);
  const parentStat=await lstat(parent);
  if(!parentStat.isDirectory()||parentStat.isSymbolicLink()) fail("HEARTBEAT_PARENT_UNSAFE");
  try{
    const current=await lstat(filePath);
    if(!current.isFile()||current.isSymbolicLink()) fail("HEARTBEAT_TARGET_UNSAFE");
  }catch(error){
    if(error?.code!=="ENOENT") throw error;
  }
  const temp=`${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp,JSON.stringify(value)+"\n",{encoding:"utf8",mode:0o640,flag:"wx"});
  try{
    await rename(temp,filePath);
  }finally{
    await unlink(temp).catch((error)=>{if(error?.code!=="ENOENT") throw error;});
  }
}

function parseProps(raw){
  return Object.fromEntries(String(raw).split(/\r?\n/).filter((line)=>line.includes("=")).map((line)=>{
    const at=line.indexOf("=");return [line.slice(0,at),line.slice(at+1)];
  }));
}

async function serviceIdentity(pin){
  const {stdout}=await execFile(SYSTEMCTL,[
    "show",pin.serviceUnit,"--no-pager",
    "--property=ActiveState,SubState,MainPID,WorkingDirectory,Result,NRestarts",
  ],{encoding:"utf8",timeout:5000,maxBuffer:32768});
  const p=parseProps(stdout);
  const pid=Number(p.MainPID||0);
  if(p.ActiveState!=="active"||p.SubState!=="running"||!Number.isInteger(pid)||pid<=0)
    fail("SERVICE_NOT_RUNNING");
  const cwd=await readlink(`/proc/${pid}/cwd`);
  if(cwd!==pin.releaseRoot) fail("SERVICE_CWD_MISMATCH");
  if(p.WorkingDirectory&&p.WorkingDirectory!==pin.releaseRoot) fail("SYSTEMD_CWD_MISMATCH");
  return {pid,cwd,nRestarts:Number(p.NRestarts||0),result:String(p.Result||"")};
}

async function validateRelease(pin){
  if(!SHA_RE.test(pin.sha)) fail("PIN_SHA_INVALID");
  if(pin.releaseRoot!==`/home/deploy/disdex-trading/releases/${pin.sha}`) fail("PIN_ROOT_INVALID");
  const marker=`${pin.releaseRoot}/.disdex-release-sha`;
  const stat=await lstat(marker);
  if(!stat.isFile()||stat.isSymbolicLink()) fail("RELEASE_MARKER_UNSAFE");
  if((await readFile(marker,"utf8")).trim()!==pin.sha) fail("RELEASE_MARKER_MISMATCH");
}

async function loadManifest(filePath){
  const stat=await lstat(filePath);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)
    fail("RUNNER_PIN_MANIFEST_UNTRUSTED");
  const value=JSON.parse(await readFile(filePath,"utf8"));
  if(value?.schema!=="disdex-runner-pin-manifest/v2"
      ||value?.target!=="professional-dismanager.net"
      ||value?.operatorTarget!=="DD1296_FINAL_ALLIN_10BPS"
      ||!value.runners||typeof value.runners!=="object") fail("RUNNER_PIN_MANIFEST_INVALID");
  return value;
}

async function observeRunner(runnerId,pin,now){
  await validateRelease(pin);
  const service=await serviceIdentity(pin);
  const tickRaw=JSON.parse(await readFile(pin.tickPath,"utf8"));
  const tick=validateRunnerTick(tickRaw,{runnerId,pin,pid:service.pid,cwd:service.cwd,now});
  return buildSupervisorHeartbeat({
    runnerId,pin,pid:service.pid,cwd:service.cwd,now,tick,
    safetyState:"HEALTHY",healthReason:"",
  });
}

export async function runSnapshot({manifestPath="/etc/disdex/runner-pins.json",now=Date.now(),write=true}={}){
  const manifest=await loadManifest(manifestPath);
  const results=[];
  for(const [runnerId,pin] of Object.entries(manifest.runners)){
    if(pin.evidenceMode!=="heartbeat_v1"){
      results.push({runnerId,status:"LEGACY_SKIPPED",tradingMutation:0});
      continue;
    }
    try{
      const heartbeat=await observeRunner(runnerId,pin,now);
      if(write) await atomicJson(pin.healthPath,heartbeat);
      results.push({
        runnerId,status:"HEALTHY",heartbeatAt:heartbeat.heartbeatAt,lastTickAt:heartbeat.lastTickAt,
        tradingMutation:0,
      });
    }catch(error){
      results.push({
        runnerId,status:"BLOCKED",reason:error instanceof Error?error.message:String(error),
        tradingMutation:0,
      });
    }
  }
  return {
    schema:"disdex-runner-health-snapshot/v2",
    checkedAt:now,
    target:manifest.target,
    operatorTarget:manifest.operatorTarget,
    results,
    tradingMutation:0,
    ordersSent:0,
    cancelsSent:0,
    positionChangesSent:0,
  };
}

async function main(){
  const args=new Set(process.argv.slice(2));
  const dryRun=args.has("--dry-run");
  const selfTest=args.has("--self-test");
  if(selfTest){
    const pin={
      sha:"a".repeat(40),
      releaseRoot:"/home/deploy/disdex-trading/releases/"+"a".repeat(40),
      serviceUnit:"disdex-v52-aster-only@"+"a".repeat(40)+".service",
    };
    const now=1000000,pid=123,cwd=pin.releaseRoot;
    const tick=validateRunnerTick({
      schema:"disdex-runner-tick/v1",runnerId:"V52",runtimeSha:pin.sha,expectedSha:pin.sha,
      serviceUnit:pin.serviceUnit,mainPid:pid,workingDirectory:cwd,tickCompletedAt:now-1000,
      outcome:"NO_SIGNAL",newOrdersAllowed:false,
    },{runnerId:"V52",pin,pid,cwd,now});
    const hb=buildSupervisorHeartbeat({runnerId:"V52",pin,pid,cwd,now,tick,safetyState:"HEALTHY",healthReason:""});
    if(hb.heartbeatAt!==now||hb.lastTickAt!==now-1000) fail("SELFTEST_TIME_SPLIT");
    console.log("DISDEX_RUNNER_HEALTH_SNAPSHOT_V2_SELFTEST_PASS");
    return;
  }
  const result=await runSnapshot({write:!dryRun});
  console.log(JSON.stringify(result));
  if(result.results.some((row)=>row.status==="BLOCKED")) process.exitCode=1;
}

if(import.meta.url===`file://${process.argv[1]}`){
  main().catch((error)=>{console.error(error);process.exitCode=2;});
}
