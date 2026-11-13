import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  validateRunnerTick,
  buildSupervisorHeartbeat,
  atomicJson,
  validateSafetySnapshots,
  unsupportedEvidenceResult,
} from "../scripts/ops/root/disdex-runner-health-snapshot-v2.mjs";

const SHA="4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81";
const ROOT="/home/deploy/disdex-trading/releases/"+SHA;
const UNIT="disdex-v52-aster-only@"+SHA+".service";
const NOW=1_793_573_600_000;
const PID=512995;

function tick(){
  return {
    schema:"disdex-runner-tick/v1",
    runnerId:"V52",
    runtimeSha:SHA,
    expectedSha:SHA,
    serviceUnit:UNIT,
    mainPid:PID,
    workingDirectory:ROOT,
    tickCompletedAt:NOW-2_000,
    outcome:"DECISION_CYCLE_COMPLETED",
    newOrdersAllowed:true,
  };
}
const pin={
  sha:SHA,releaseRoot:ROOT,serviceUnit:UNIT,evidenceMode:"heartbeat_v1",
  statePath:"/var/lib/disdex/v52-aster-only/runner-live.json",
  healthPath:"/var/lib/disdex/runner-health/heartbeats/v52.json",
  tickPath:"/var/lib/disdex/runner-health/ticks/v52.json",
};

test("supervisor heartbeat separates heartbeatAt from runner lastTickAt",()=>{
  const validated=validateRunnerTick(tick(),{runnerId:"V52",pin,pid:PID,cwd:ROOT,now:NOW});
  const hb=buildSupervisorHeartbeat({
    runnerId:"V52",pin,pid:PID,cwd:ROOT,now:NOW,
    tick:validated,safetyState:"HEALTHY",healthReason:"",
  });
  assert.equal(hb.heartbeatAt,NOW);
  assert.equal(hb.lastTickAt,NOW-2_000);
  assert.notEqual(hb.heartbeatAt,hb.lastTickAt);
  assert.equal(hb.runtimeSha,SHA);
  assert.equal(hb.serviceUnit,UNIT);
  assert.equal(hb.mainPid,PID);
});

test("wrong sha, service, pid, cwd, stale and future ticks fail closed",()=>{
  const cases=[
    ["runtimeSha","9".repeat(40)],
    ["expectedSha","9".repeat(40)],
    ["serviceUnit","wrong.service"],
    ["mainPid",PID+1],
    ["workingDirectory","/wrong"],
    ["tickCompletedAt",NOW-300_001],
    ["tickCompletedAt",NOW+10_001],
  ];
  for(const [field,value] of cases){
    const bad={...tick(),[field]:value};
    assert.throws(()=>validateRunnerTick(bad,{runnerId:"V52",pin,pid:PID,cwd:ROOT,now:NOW}),/TICK_/);
  }
});

test("wrong runner and missing tick fail closed",()=>{
  assert.throws(()=>validateRunnerTick({...tick(),runnerId:"PENGU_V8"},{runnerId:"V52",pin,pid:PID,cwd:ROOT,now:NOW}),/TICK_/);
  assert.throws(()=>validateRunnerTick(null,{runnerId:"V52",pin,pid:PID,cwd:ROOT,now:NOW}),/TICK_/);
});

test("atomic heartbeat write leaves no temp file",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"health-v2-"));
  try{
    const file=path.join(dir,"v52.json");
    await atomicJson(file,{a:1});
    assert.deepEqual(JSON.parse(await fs.readFile(file,"utf8")),{a:1});
    assert.deepEqual((await fs.readdir(dir)).sort(),["v52.json"]);
  } finally {
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test("shared safety requires current 7.5% UTC risk, healthy margin and no pending",()=>{
  const now=Date.UTC(2026,10,2,10,0,0);
  const current={
    kill:{active:false},
    risk:{sourceComplete:true,tripped:false,utcDay:"2026-11-02",updatedAt:now-1000,maximumLossPct:7.5},
    margin:{stage:"HEALTHY",ordersAllowed:true,checkedAt:now-1000},
    pending:{schema:"disdex-pending-exposure/v1",entries:[{status:"RELEASED"}]},
  };
  assert.equal(validateSafetySnapshots(current,now),true);
  for(const row of [
    {kill:{active:true}},
    {risk:{...current.risk,utcDay:"2026-11-01"}},
    {risk:{...current.risk,updatedAt:now-900001}},
    {risk:{...current.risk,maximumLossPct:8}},
    {risk:{...current.risk,maximumLossPct:undefined}},
    {risk:{...current.risk,tripped:null}},
    {margin:{...current.margin,checkedAt:now+5000}},
    {margin:{...current.margin,ordersAllowed:false}},
    {pending:{...current.pending,entries:[{status:"ACTIVE"}]}},
    {pending:{...current.pending,entries:[null]}},
  ]) {
    assert.throws(()=>validateSafetySnapshots({...current,...row},now),/RISK|MARGIN|PENDING|KILL/);
  }
});

test("concurrent atomic heartbeat writes never corrupt the destination",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"health-v2-atomic-"));
  try{
    const file=path.join(dir,"v52.json");
    await Promise.all(Array.from({length:80},(_,i)=>atomicJson(file,{i,data:"x".repeat(128)})));
    const final=JSON.parse(await fs.readFile(file,"utf8"));
    assert.ok(Number.isInteger(final.i) && final.i>=0 && final.i<80);
    assert.equal(final.data.length,128);
    assert.deepEqual(await fs.readdir(dir),["v52.json"]);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test("runner with failed shared safety cannot be shown LIVE or order-ready",()=>{
  const v=validateRunnerTick(tick(),{runnerId:"V52",pin,pid:PID,cwd:ROOT,now:NOW});
  const hb=buildSupervisorHeartbeat({runnerId:"V52",pin,pid:PID,cwd:ROOT,now:NOW,
    tick:v,safetyState:"BLOCKED",healthReason:"SHARED_RISK_STALE"});
  assert.equal(hb.safetyState,"BLOCKED");
  assert.equal(hb.liveEnabled,false);
  assert.equal(hb.mode,"BLOCKED");
  assert.equal(hb.newOrdersAllowed,false);
  assert.equal(hb.lastTickAt,NOW-2_000);
});

test("unsupported legacy evidence is BLOCKED, never a successful LIVE audit",()=>{
  const result=unsupportedEvidenceResult("V12_V4");
  assert.equal(result.status,"BLOCKED");
  assert.equal(result.reason,"RUNNER_TICK_EVIDENCE_NOT_SUPPORTED");
  assert.equal(result.newOrdersAllowed,false);
  assert.equal(result.tradingMutation,0);
});
