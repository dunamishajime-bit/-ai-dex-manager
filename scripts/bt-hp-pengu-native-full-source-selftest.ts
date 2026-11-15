import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {SyntheticMarket5m,type MarketCandle5m} from "../lib/bt-verification/synthetic-market";
import {inspectNativePenguAt,probeNativePenguSyntheticAt}
 from "../lib/bt-verification/pinned-native-pengu/probe";
import {
 evaluatePenguDualLsV2Decision,targetGrossForAtr,
 buildPenguDualLsV2EvaluationSeries
} from "../lib/bt-verification/pinned-native-pengu/pengu-dual-ls-v2";
import {evaluateRecoveryV8Entry}
 from "../lib/bt-verification/pinned-native-pengu/pengu-recovery-v8";
import {PENGU_RECOVERY_V8}
 from "../lib/bt-verification/pinned-native-pengu/penguRecoveryV8";

const dir=join(process.cwd(),"lib","bt-verification","pinned-native-pengu");
const expected=[
 ["pengu-dual-ls-v2.ts","a72123d76e0c5783553cafa5a452664274d4450e06a5afb17ecf1738b5ad6546",[
  ["./penguDualLsV2Runtime","@/config/penguDualLsV2Runtime"],
  ["./penguRecoveryV8","@/config/penguRecoveryV8"],
  ["./disdex-v35-candle-type","@/lib/disdex-v35-signal-engine"],
  ["./pengu-short-v20","@/lib/pengu-short-v20"],
  ["./pengu-recovery-v8","@/lib/pengu-recovery-v8"],
  ['import("./pengu-protection-types").StopLedger','import("./resident-stop-ledger").StopLedger'],
  ['import("./pengu-protection-types").ResidentStopProtection','import("./venue-resident-stop").ResidentStopProtection']
 ]],
 ["pengu-short-v20.ts","fce39b4ff1c6b5c7e62438e9a974a9479c0ecf5b5a1b41a91a5f2edf78caee65",[
  ["./penguDualLsV2Runtime","@/config/penguDualLsV2Runtime"],["./pengu-dual-ls-v2","@/lib/pengu-dual-ls-v2"]
 ]],
 ["pengu-recovery-v8.ts","9ede7042755f594025537d3e7ede365e6c6156f99ebb76aafb6f15d43833790d",[
  ["./penguRecoveryV8","@/config/penguRecoveryV8"],["./pengu-dual-ls-v2","@/lib/pengu-dual-ls-v2"]
 ]],
 ["penguDualLsV2Runtime.ts","4dfd88c27caa430bbbe02c04d70656241cc080fd79118e5c021987cc1786aac2",[]],
 ["penguRecoveryV8.ts","053f4578390ce3cd8547669c01142b70517969e837391608948206a672d088d8",[]],
 ["integratedProductionRiskPolicy.ts","634ee196b267e3ec55e195f1fec9527669157926b191e473ab0aa1adb042c633",[]],
 ["sharedCryptoRiskPolicy.ts","a83611274a909616031c9c94faa25e44fa1d07436e09c044d2053aa88f6a7494",[]],
 ["q102FamilySideGross.json","61901ee765b8ce5202ebbdc16561c806f78acc16a157b1197e0f92ee3e9c3450",[]],
 ["v52V50Runtime.json","16c24ec472df9141bbde60b993120fb0a9b9bc3739a0bb8251c6371119e3390c",[]]
] as const;
for(const [filename,sha,imports] of expected){
 let body=readFileSync(join(dir,filename),"utf8");
 for(const [current,original] of imports){
   assert.equal(body.split(current).length,2,"Single reversible source import: "+filename+" "+current);
   body=body.replace(current,original);
 }
 const restoredRaw=body.split(String.fromCharCode(13,10))
     .join(String.fromCharCode(10))
     .split(String.fromCharCode(10)).join(String.fromCharCode(13,10));
 assert.equal(createHash("sha256").update(restoredRaw).digest("hex"),sha,
   "Full native PENGU source SHA must match exactly except import/EOL: "+filename);
}

const now=Date.parse("2025-10-15T20:00:00Z"),hour=3600000;
function syntheticBars(symbol:"BTCUSDT"|"PENGUUSDT",length:number,price:number):MarketCandle5m[]{
 return Array.from({length},(_,i)=>{
   const open=now-(length-i)*hour;
   return {symbol,category:"crypto",openTime:new Date(open).toISOString(),
     closedAt:new Date(open+hour).toISOString(),open:price,high:price*1.001,
     low:price*.999,close:price,volume:100,ticks:12,partialSession:false};
 });
}
const preWarm=inspectNativePenguAt(new Date(now).toISOString(),
 syntheticBars("PENGUUSDT",179,.02),syntheticBars("BTCUSDT",179,100000));
assert.equal(preWarm.status,"INSUFFICIENT_180H");
const invalid=syntheticBars("PENGUUSDT",200,.02);
invalid[199].closedAt=new Date(now+hour).toISOString();
assert.equal(inspectNativePenguAt(new Date(now).toISOString(),
 invalid,syntheticBars("BTCUSDT",200,100000)).status,"SOURCE_INVALID_OR_GAP");
const gap=syntheticBars("PENGUUSDT",200,.02);
gap[100].openTime=new Date(Date.parse(gap[100].openTime)+hour).toISOString();
assert.equal(inspectNativePenguAt(new Date(now).toISOString(),
 gap,syntheticBars("BTCUSDT",200,100000)).status,"SOURCE_INVALID_OR_GAP");

const f={
 referenceTs:now-hour,open:120,high:121,low:119,close:120,
 previousLow:118,priorHigh18h:110,
 penguReturn24h:.16,penguReturn72h:.3,btcReturn24h:.025,relativeReturn24h:.14,
 ema72:115,ema168:105,btcEma168Distance:.02,volumeRatio6OverPrior36:2,
 atr24Ratio:.025,rsi14:65
};
const long=evaluatePenguDualLsV2Decision(f,false,false);
assert.equal(long.side,1,"Pinned native Long source accepts an engineered bullish feature scenario");
const short=evaluatePenguDualLsV2Decision(f,true,false);
assert.equal(short.side,-1,"Pinned native priority SHORT overrides simultaneous Long");
assert.ok(targetGrossForAtr(.035)>0);
const recoveryRow={
 index:201,referenceTs:now-hour,close:103,low:102,high:105,previousClose:102.5,
 troughIndex:190,troughClose:100,troughAgeHours:11,
 rsiDelta6:8.5,ema168DistancePct:-2,btcReturn6hPct:.35,
 ordinaryLongEligible:false,ordinaryShortEligible:false,recoveryCross:true
};
const recovery=evaluateRecoveryV8Entry(recoveryRow);
assert.equal(recovery.kind,"RECOVERY_V8","Native Recovery V8 entry uses exact frozen 3% cross");
assert.equal(recovery.gross,PENGU_RECOVERY_V8.initialGross);
assert.equal(evaluateRecoveryV8Entry({...recoveryRow,ordinaryShortEligible:true}).kind,"NONE");
assert.equal(evaluateRecoveryV8Entry({...recoveryRow,recoveryCross:false}).kind,"NONE");

const feed=new SyntheticMarket5m(20261115,"rotation",{
 start:"2025-10-01T00:00:00Z",endExclusive:"2025-10-18T00:00:00Z",version:"v3"});
let checks=0,warm=0,valid=0,errors=0,longCandidates=0,shortCandidates=0,recoveryCandidates=0;
const sampled:string[]=[];
while(true){
 const item=feed.step();
 if(!item)break;
 if(!item.completedH1.some(x=>x.symbol==="BTCUSDT"))continue;
 const result=probeNativePenguSyntheticAt(feed,item);
 checks++;
 assert.equal(result.noOrder,true);
 assert.equal(result.noGross,true);
 assert.equal(result.noPnL,true);
 if(result.status==="INSUFFICIENT_180H")warm++;
 if(result.status==="SOURCE_INVALID_OR_GAP")errors++;
 if(result.status==="NATIVE_ENTRY_CANDIDATE"||result.status==="NATIVE_NO_CANDIDATE"){
   valid++;sampled.push(result.nativeSide);
   assert.ok(result.evaluatedBars>0);
   assert.ok(result.nativeTargetGross>=0);
 }
 if(result.status==="NATIVE_ENTRY_CANDIDATE"){
   if(result.nativeSide==="SHORT")shortCandidates++;
   if(result.nativeSide==="LONG")longCandidates++;
   if(result.nativeEntryVersion==="RECOVERY_V8")recoveryCandidates++;
 }
}
assert.equal(checks,17*24);
assert.ok(warm>=179);
assert.equal(errors,0);
assert.ok(valid>=190,"At least 190 truly native source evaluations after warmup");
assert.equal(valid+warm,checks,"No unknown/undocumented source state");
console.log("PASS immutable PENGU V2/ShortV20/RecoveryV8 pure entry source, synthetic as-of H1",JSON.stringify({
 hours:checks,warmup:warm,nativeEvaluations:valid,
 longCandidates,shortCandidates,recoveryCandidates,sourceErrors:errors,
 orders:0,pnl:false
}));
