import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  validateRunnerTick,
  buildSupervisorHeartbeat,
  atomicJson,
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
