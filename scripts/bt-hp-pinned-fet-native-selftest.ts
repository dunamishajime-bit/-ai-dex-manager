import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {FET_BRK48_RESIDUAL} from "../lib/bt-verification/pinned-native-fet/fetBrk48Runtime";
import {buildFetBrk48Signal} from "../lib/bt-verification/pinned-native-fet/fet-brk48-signal";
import {runFrozenFetSignalAt,probeSyntheticFet,toFrozenFetNativeBars}
 from "../lib/bt-verification/pinned-native-fet/probe";
import {SyntheticMarket5m,type MarketCandle5m} from "../lib/bt-verification/synthetic-market";
const root=join(process.cwd(),"lib","bt-verification","pinned-native-fet");
const originalSignal=readFileSync(join(root,"fet-brk48-signal.ts"),"utf8")
 .replace('from "./fetBrk48Runtime"','from "@/config/fetBrk48Runtime"');
const originalConfig=readFileSync(join(root,"fetBrk48Runtime.ts"));
const sha=(x:string|Uint8Array)=>createHash("sha256").update(x).digest("hex");
assert.equal(sha(originalSignal.split(String.fromCharCode(13,10)).join(String.fromCharCode(10))),"91242302f27274450bcf72facad2b5126611cf9ad2d827af32c814ff23eabc65",
  "The only allowed native signal source change is the local config import");
assert.equal(sha(originalConfig.toString("utf8").split(String.fromCharCode(13,10)).join(String.fromCharCode(10))),"39151c4ae6950bd14e89410ccbf6ca0f411798da44639fe5eef9e3c987b518be",
  "Native FET config must remain source-byte-identical");
const HOUR=3600000,entryTs=Date.parse("2025-10-08T05:00:00Z");
const history:MarketCandle5m[]=Array.from({length:73},(_,i)=>{
 const start=entryTs-(73-i)*HOUR,end=start+HOUR,signal=i===72;
 return {symbol:"FETUSDT",category:"crypto",openTime:new Date(start).toISOString(),
  closedAt:new Date(end).toISOString(),open:signal?100:100,
  high:signal?103.2:100.5,low:99.5,close:signal?103:100,
  volume:signal?200:100,ticks:12,partialSession:false};
});
const good=runFrozenFetSignalAt(history,new Date(entryTs).toISOString());
assert.equal(good.status,"NATIVE_SIGNAL_PASSED");
assert.ok(good.candidate);
assert.equal(good.candidate?.symbol,"FETUSDT");
assert.equal(good.candidate?.strategyId,"FET_BRK48_RESIDUAL");
assert.equal(good.candidate?.entryTs,entryTs);
assert.equal(good.candidate?.entryPrice,103);
assert.ok(Math.abs(good.candidate!.return72h-.03)<1e-12);
assert.equal(good.candidate?.volumeRatio,2);
assert.ok(good.candidate!.hardStopPrice>0);
assert.equal(good.candidate?.exitTs,entryTs+24*HOUR);
const native=buildFetBrk48Signal(toFrozenFetNativeBars(history,entryTs),entryTs);
assert.deepEqual(good.candidate,native);
assert.equal(runFrozenFetSignalAt(history.slice(1),new Date(entryTs).toISOString()).status,"INSUFFICIENT_HISTORY");
assert.equal(runFrozenFetSignalAt(history,new Date(entryTs+1*HOUR).toISOString()).status,"NOT_DECISION_HOUR");
const future=structuredClone(history);future[72].closedAt=new Date(entryTs+HOUR).toISOString();
assert.equal(runFrozenFetSignalAt(future,new Date(entryTs).toISOString()).status,"ASOF_GAP_OR_INVALID");
const gap=structuredClone(history);gap[24].openTime=new Date(Date.parse(gap[24].openTime)+HOUR).toISOString();
assert.equal(runFrozenFetSignalAt(gap,new Date(entryTs).toISOString()).status,"ASOF_GAP_OR_INVALID");
const lowVol=structuredClone(history);lowVol[72].volume=105;
assert.equal(runFrozenFetSignalAt(lowVol,new Date(entryTs).toISOString()).status,"NATIVE_SIGNAL_REJECTED");
const noBreak=structuredClone(history);noBreak[72].high=100.5;noBreak[72].close=100;
assert.equal(runFrozenFetSignalAt(noBreak,new Date(entryTs).toISOString()).status,"NATIVE_SIGNAL_REJECTED");
const lowRet=structuredClone(history);lowRet[0].close=102;lowRet[0].high=103;
assert.equal(runFrozenFetSignalAt(lowRet,new Date(entryTs).toISOString()).status,"NATIVE_SIGNAL_REJECTED");
assert.equal(FET_BRK48_RESIDUAL.decisionEntryHourModulo,4);
assert.equal(FET_BRK48_RESIDUAL.decisionEntryHourRemainder,1);
const market=new SyntheticMarket5m(1,"trend",{
 start:"2025-10-01T00:00:00Z",endExclusive:"2025-10-10T00:00:00Z"});
let decisionHours=0,warmup=0,rejected=0,passed=0,invalid=0;
while(true){
 const x=market.step();if(!x)break;
 if(x.completedH1.some(c=>c.symbol==="FETUSDT")){
  const p=probeSyntheticFet(market,x.observedAt);
  if(p.status==="INSUFFICIENT_HISTORY")warmup++;
  if(p.status==="NATIVE_SIGNAL_REJECTED")rejected++;
  if(p.status==="NATIVE_SIGNAL_PASSED")passed++;
  if(p.status==="ASOF_GAP_OR_INVALID")invalid++;
  if(p.status!=="NOT_DECISION_HOUR")decisionHours++;
  if(p.candidate)assert.ok(p.candidate.referenceTs<Date.parse(x.observedAt));
 }
}
assert.equal(invalid,0);
assert.ok(warmup>0&&rejected>0&&decisionHours>10);
console.log("PASS FET frozen native entry source SHA, 73 H1 input, artificial as-of streaming, genuine synthetic candidates",JSON.stringify({
  decisionHours,warmup,rejected,passed,invalid,pinnedSource:"9118eeaa6",
  nativeEntryOnly:true
}));
