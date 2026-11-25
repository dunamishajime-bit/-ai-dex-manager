import test from "node:test";
import assert from "node:assert/strict";
import {displayEnvironment,monitorEvidencePath,validateMonitorEvidence} from "../lib/server/pinned-runtime-display";
import type {RunnerPin} from "../lib/server/runner-pin-manifest";

const sha="a".repeat(40);
const pin:RunnerPin={sha,releaseRoot:"/home/deploy/disdex-trading/releases/"+sha,
 serviceUnit:"disdex-v12-v4@"+sha+".service",evidenceMode:"legacy",statePath:"",healthPath:"",tickPath:""};
const now=1800000000000;
test("only allowlisted process configuration is parsed",()=>{
 const env=displayEnvironment(Buffer.from(["CRYPTO_GROSS_CAP=3.0","STOCK_GROSS_CAP=4.0","TOTAL_GROSS_CAP=4.25","ASTER_API_SECRET=not-for-output","PENGU_GROSS_CAP=bad","V12_V4_OPERATION_MODE=MONITOR_ONLY"].join("\0")));
 assert.deepEqual(env,{CRYPTO_GROSS_CAP:"3.0",STOCK_GROSS_CAP:"4.0",TOTAL_GROSS_CAP:"4.25",V12_V4_OPERATION_MODE:"MONITOR_ONLY"});
});
test("monitor scope is derived from verified pinned process; old path rejected",()=>{
 const prefix="/var/lib/disdex/stable4-dd30-monitor/"+sha;
 assert.equal(monitorEvidencePath("PENGU_V8",pin,{PENGU_DUAL_LS_V2_MODE:"SHADOW",PENGU_DUAL_LS_V2_MONITOR_TICK_PATH:prefix+"/pengu/monitor-tick.json"}),prefix+"/pengu/monitor-tick.json");
 assert.equal(monitorEvidencePath("PENGU_V8",pin,{PENGU_DUAL_LS_V2_MODE:"SHADOW",PENGU_DUAL_LS_V2_MONITOR_TICK_PATH:"/var/lib/disdex/pengu-dual-ls-v2/runner-live.json"}),undefined);
});
test("fresh pinned monitor accepts only matching identity and no mutation",()=>{
 const raw={runtimeSha:sha,expectedSha:sha,mainPid:123,serviceUnit:pin.serviceUnit,workingDirectory:pin.releaseRoot,mode:"MONITOR_ONLY",updatedAt:now-1000,newOrdersAllowed:false,ordersSent:0};
 assert.equal(validateMonitorEvidence("V12_V4",pin,123,raw,now),now-1000);
 for(const patch of [{runtimeSha:"b".repeat(40)},{mainPid:456},{updatedAt:now-301000},{newOrdersAllowed:true},{ordersSent:1},{mode:"LIVE"}]){
  assert.throws(()=>validateMonitorEvidence("V12_V4",pin,123,{...raw,...patch},now));
 }
});
test("FET monitor scope is bound to pinned process before accepting untagged state",()=>{
 const path="/var/lib/disdex/stable4-dd30-monitor/"+sha+"/fet/shadow.json";
 assert.equal(monitorEvidencePath("FET_BRK48_RESIDUAL",pin,{FET_BRK48_SHADOW_STATE_PATH:path,DISDEX_Q102_RUNTIME_SHA:sha}),path);
 assert.equal(monitorEvidencePath("FET_BRK48_RESIDUAL",pin,{FET_BRK48_SHADOW_STATE_PATH:path,DISDEX_Q102_RUNTIME_SHA:"b".repeat(40)}),undefined);
 assert.equal(validateMonitorEvidence("FET_BRK48_RESIDUAL",pin,123,{schema:"fet-brk48-shadow/v1",mode:"SHADOW",updatedAt:now-1,ordersSent:0},now),now-1);
});
