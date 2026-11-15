import assert from "node:assert/strict";
import {SyntheticMarket5m,type MarketCandle5m} from "../lib/bt-verification/synthetic-market";
import {evaluatePenguPretargetAt,probeSyntheticPenguAt,STABLE4_PENGU_RESEARCH_PRETARGET}
 from "../lib/bt-verification/stable4-pengu-research-gates";

const H=3600_000,at=Date.parse("2025-10-08T06:00:00Z"),asOf=new Date(at).toISOString();
function bars(symbol:"PENGUUSDT"|"BTCUSDT",count:number,finalClose:number):MarketCandle5m[]{
 return Array.from({length:count},(_,i)=>{
  const start=at-(count-i)*H,last=i===count-1;
  const close=last?finalClose:100;
  return {symbol,category:"crypto" as const,openTime:new Date(start).toISOString(),
   closedAt:new Date(start+H).toISOString(),open:100,
   high:Math.max(101,close),low:Math.min(99,close),
   close,volume:100,ticks:12,partialSession:false};
 });
}
const btc=bars("BTCUSDT",25,98),pengu=bars("PENGUUSDT",73,94);
const accepted=evaluatePenguPretargetAt(asOf,btc,pengu);
assert.equal(accepted.shortV20.status,"PRETARGET_PASS_NO_CANDIDATE");
assert.equal(accepted.recoveryV8.status,"PRETARGET_PASS_NO_CANDIDATE");
assert.equal(accepted.candidateSourceAvailable,false);
assert.equal(accepted.admittedPositions,0);
assert.ok(Math.abs(accepted.btc24h!+.02)<1e-10);
assert.ok(Math.abs(accepted.pengu72h!+.06)<1e-10);
const noTrend=evaluatePenguPretargetAt(asOf,bars("BTCUSDT",25,100),pengu);
assert.equal(noTrend.shortV20.status,"PRETARGET_BLOCK");
assert.equal(noTrend.recoveryV8.status,"PRETARGET_PASS_NO_CANDIDATE");
const bullish=evaluatePenguPretargetAt(asOf,bars("BTCUSDT",25,102),pengu);
assert.equal(bullish.shortV20.conditionPass,false);
assert.equal(bullish.recoveryV8.conditionPass,false);
const notDown=evaluatePenguPretargetAt(asOf,btc,bars("PENGUUSDT",73,96));
assert.equal(notDown.shortV20.conditionPass,false);
assert.equal(notDown.recoveryV8.conditionPass,true);
const insufficient=evaluatePenguPretargetAt(asOf,btc,pengu.slice(1));
assert.equal(insufficient.shortV20.status,"SOURCE_INSUFFICIENT");
const gap=structuredClone(pengu);
gap[24].closedAt=new Date(Date.parse(gap[24].closedAt)+H).toISOString();
assert.equal(evaluatePenguPretargetAt(asOf,btc,gap).shortV20.status,"SOURCE_NOT_CAUSAL");
const future=structuredClone(btc);
future[24].closedAt=new Date(at+H).toISOString();
assert.equal(evaluatePenguPretargetAt(asOf,future,pengu).shortV20.status,"SOURCE_NOT_CAUSAL");
assert.equal(STABLE4_PENGU_RESEARCH_PRETARGET.shortV20Btc24hMax,-0.010836782776818987);
assert.equal(STABLE4_PENGU_RESEARCH_PRETARGET.shortV20Pengu72hMax,-0.05237466490617382);
assert.equal(STABLE4_PENGU_RESEARCH_PRETARGET.recoveryV8Btc24hMax,0.011611625094354983);
const feed=new SyntheticMarket5m(1,"down",{
 start:"2025-10-01T00:00:00Z",endExclusive:"2025-10-10T00:00:00Z"
});
let checks=0,passes=0,notReady=0;
while(true){
 const s=feed.step();if(!s)break;
 if(s.completedH1.some(x=>x.symbol==="BTCUSDT")){
  const x=probeSyntheticPenguAt(feed,s.observedAt);
  checks++;
  assert.equal(x.candidateSourceAvailable,false);
  assert.equal(x.admittedPositions,0);
  if(x.shortV20.conditionPass)passes++;
  if(x.shortV20.status==="SOURCE_INSUFFICIENT")notReady++;
  if(x.btc24h!==null){
   assert.ok(Number.isFinite(x.btc24h));
   assert.ok(x.pengu72h!==null&&Number.isFinite(x.pengu72h));
  }
 }
}
assert.equal(checks,216);
assert.ok(notReady>=72);
console.log("PASS causal PENGU ShortV20/RecoveryV8 frozen pretarget gates, missing/future H1 fail closed, synthetic samples",JSON.stringify({
 checks,passes,notReady,entryCandidates:false
}));
