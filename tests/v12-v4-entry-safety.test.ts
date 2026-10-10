import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildSharedCryptoDailyRiskState} from "../lib/disdex-shared-crypto-daily-risk";
import {assertV4EntrySafety} from "../lib/v12-v4-entry-safety";

function setup(now:number){
 const dir=mkdtempSync(join(tmpdir(),"v4-entry-safe-"));
 const risk=join(dir,"risk.json"),margin=join(dir,"margin.json"),kill=join(dir,"kill.json");
 const state=buildSharedCryptoDailyRiskState({
  accountScope:"ASTER_FUTURES",utcDay:new Date(now).toISOString().slice(0,10),
  strategyIds:["V12_X1.00_ALL","PENGU_DUAL_LS_V2_FINAL","QUALITY102_CAUSAL_V1","FET_BRK48_RESIDUAL","HYPE_LONG","IDLE_PRIORITY_SHORT"],
  lossPct:0,maximumLossPct:5,tripped:false,updatedAt:now,
  realizedPnl:0,unrealizedPnl:0,fees:0,funding:0,netDailyPnl:0,referenceEquity:1000,sourceComplete:true,
 });
 writeFileSync(risk,JSON.stringify(state));
 writeFileSync(margin,JSON.stringify({stage:"HEALTHY",ordersAllowed:true,checkedAt:now}));
 writeFileSync(kill,JSON.stringify({active:false}));
 return {risk,margin,kill};
}
test("V4 new-entry global controls require fresh risk, margin and inactive kill switch",async()=>{
 const now=Date.parse("2026-10-11T00:00:00Z"),x=setup(now);
 const env={...process.env,DISDEX_SHARED_KILL_SWITCH_FILE:x.kill};
 await assert.doesNotReject(()=>assertV4EntrySafety({now,env,dailyRiskPath:x.risk,marginPath:x.margin}));
 writeFileSync(x.kill,JSON.stringify({active:true,action:"HOLD_PROTECTED",reason:"TEST"}));
 await assert.rejects(()=>assertV4EntrySafety({now,env,dailyRiskPath:x.risk,marginPath:x.margin}),/KILL_SWITCH_ACTIVE/);
});
test("stale or unhealthy shared risk and margin fail closed",async()=>{
 const now=Date.parse("2026-10-11T00:00:00Z"),x=setup(now);
 const env={...process.env,DISDEX_SHARED_KILL_SWITCH_FILE:x.kill};
 writeFileSync(x.margin,JSON.stringify({stage:"HEALTHY",ordersAllowed:true,checkedAt:now-400000}));
 await assert.rejects(()=>assertV4EntrySafety({now,env,dailyRiskPath:x.risk,marginPath:x.margin}),/MARGIN_GUARD_BLOCK/);
 const y=setup(now);
 const stale=JSON.parse(require("node:fs").readFileSync(y.risk,"utf8"));
 stale.updatedAt=now-180000; delete stale.stateHash;
 writeFileSync(y.risk,JSON.stringify(stale));
 await assert.rejects(()=>assertV4EntrySafety({now,env:{...process.env,DISDEX_SHARED_KILL_SWITCH_FILE:y.kill},dailyRiskPath:y.risk,marginPath:y.margin}),/DAILY_RISK_BLOCK/);
});
