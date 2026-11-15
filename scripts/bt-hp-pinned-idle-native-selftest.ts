import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {SyntheticMarket5m,type MarketCandle5m} from "../lib/bt-verification/synthetic-market";
import {inspectNativeIdleAt,probeSyntheticIdleAt,IDLE_RESEARCH_CANDIDATE_FILTERS} from "../lib/bt-verification/pinned-native-idle/probe";
import {computeIdlePriorityFeatures,evaluateIdlePriorityShort,evaluateIdleGenericCandidate}
 from "../lib/bt-verification/pinned-native-idle/idle-priority-short-signal";
import type {IdlePrioritySymbol} from "../lib/bt-verification/pinned-native-idle/idlePriorityShortPolicy";
const root=join(process.cwd(),"lib","bt-verification","pinned-native-idle");
const sha=(x:string|Uint8Array)=>createHash("sha256").update(x).digest("hex");
const orig=readFileSync(join(root,"idle-priority-short-signal.ts"),"utf8")
  .replace('from "./idlePriorityShortPolicy"','from "../config/idlePriorityShortPolicy"');
assert.equal(sha(orig),"76f68ba1ec78f5adb34c68718a28b199f58bd29dd6651a404631326906c2f827");
assert.equal(sha(readFileSync(join(root,"idlePriorityShortPolicy.ts"))),
 "4faf0c02fcfad787305da17b75ca4ae8cfc9144681cea631cdfa7b340f8fe760");
const H=3600000,at=Date.parse("2025-10-08T05:00:00Z"),asOf=new Date(at).toISOString();
function rows(symbol:"BTCUSDT"|IdlePrioritySymbol,mode:"base"|"jup"|"jupWeak"|"jupVol"|"tao"|"dot"){
 return Array.from({length:73},(_,i):MarketCandle5m=>{
  const start=at-(73-i)*H,signal=i===72;
  let close=100,high=101,low=mode.startsWith("jup")||mode==="dot"?94:99,vol=100;
  if(mode==="jup"&&signal){close=97;vol=200}
  if(mode==="jupWeak"&&signal){close=95;vol=200}
  if(mode==="jupVol"&&signal){close=97;vol=90}
  if(mode==="tao"&&signal){close=95;low=94;vol=200}
  if(mode==="dot"){
    if(i===48)close=97; // lookback close at decision-25h
    if(i===60)close=100; // close at decision-13h
    if(signal){close=96;vol=200}
  }
  return {symbol:symbol as MarketCandle5m["symbol"],category:"crypto",
    openTime:new Date(start).toISOString(),
    closedAt:new Date(start+H).toISOString(),
    open:100,high,low,close,volume:vol,ticks:12,partialSession:false};
 });
}
const btc=rows("BTCUSDT","base");
const jup=rows("JUPUSDT","jup");
const p=inspectNativeIdleAt("JUPUSDT",asOf,jup,btc);
assert.equal(p.status,"RESEARCH_PRELIMINARY_PASSED");
assert.ok(p.nativeSignal?.accepted);
assert.equal(p.nativeSignal?.route,"IDLE_JUP_RELATIVE_SHORT");
assert.equal(p.nativeSignal?.side,"SHORT");
assert.equal(p.nativeSignal?.holdHours,12);
assert.ok(Math.abs(p.nativeFeatures!.rel24+.03)<1e-12);
assert.equal(p.nativeFeatures?.volumeRatio,2);
const rawJup=computeIdlePriorityFeatures(at,jup.map(x=>({
  ts:Date.parse(x.openTime),open:x.open,high:x.high,low:x.low,close:x.close,quoteVolume:x.volume
})),btc.map(x=>({
  ts:Date.parse(x.openTime),open:x.open,high:x.high,low:x.low,close:x.close,quoteVolume:x.volume
})));
assert.deepEqual(p.nativeSignal,evaluateIdlePriorityShort("JUPUSDT",rawJup,evaluateIdleGenericCandidate(rawJup)),
 "Adapter uses genuine pinned pure IDLE native function");
const weak=inspectNativeIdleAt("JUPUSDT",asOf,rows("JUPUSDT","jupWeak"),btc);
assert.equal(weak.nativeSignal?.accepted,true);
assert.equal(weak.status,"RESEARCH_JUP_CAUSAL_BLOCK");
const vol=inspectNativeIdleAt("JUPUSDT",asOf,rows("JUPUSDT","jupVol"),btc);
assert.equal(vol.nativeSignal?.accepted,true);
assert.equal(vol.status,"RESEARCH_JUP_CAUSAL_BLOCK");
const tao=inspectNativeIdleAt("TAOUSDT",asOf,rows("TAOUSDT","tao"),btc);
assert.equal(tao.status,"TAO_SENSOR_ONLY");
assert.equal(tao.nativeSignal?.accepted,true);
assert.equal(tao.nativeSignal?.route,"IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2");
const render=inspectNativeIdleAt("RENDERUSDT",asOf,rows("RENDERUSDT","jup"),btc);
assert.equal(render.nativeSignal?.accepted,true);
assert.equal(render.status,"RESEARCH_RENDER_WAIT");
const dot=inspectNativeIdleAt("DOTUSDT",asOf,rows("DOTUSDT","dot"),btc);
assert.equal(dot.nativeSignal?.accepted,true);
assert.equal(dot.status,"RESEARCH_PRELIMINARY_PASSED");
assert.equal(dot.nativeSignal?.route,"IDLE_DOT_MOMENTUM_SHORT_BTCREL");
assert.equal(inspectNativeIdleAt("TIAUSDT",asOf,[],btc).status,"MISSING_SYMBOL",
 "Missing synthetic IDLE TIA must not silently become neutral/flat");
assert.equal(inspectNativeIdleAt("JUPUSDT",asOf,jup.slice(1),btc).status,"HISTORY_INSUFFICIENT");
const future=structuredClone(jup);future[72].closedAt=new Date(at+H).toISOString();
assert.equal(inspectNativeIdleAt("JUPUSDT",asOf,future,btc).status,"INVALID_MARKET_SOURCE");
const gap=structuredClone(jup);gap[20].openTime=new Date(Date.parse(gap[20].openTime)+H).toISOString();
assert.equal(inspectNativeIdleAt("JUPUSDT",asOf,gap,btc).status,"INVALID_MARKET_SOURCE");
assert.equal(IDLE_RESEARCH_CANDIDATE_FILTERS.taoRiskOffHours,12);
const feed=new SyntheticMarket5m(1,"down",{
 start:"2025-10-01T00:00:00Z",endExclusive:"2025-10-10T00:00:00Z"
});
let ready=0,blocked=0,sourceProblems=0,tiaBlock=0;
while(true){
 const step=feed.step();if(!step)break;
 if(step.completedH1.some(x=>x.symbol==="BTCUSDT")){
   const all=probeSyntheticIdleAt(feed,step.observedAt);
   assert.equal(all.length,5);
   for(const result of all){
     assert.equal(result.noOrdersEver,true);
     if(result.symbol==="TIAUSDT"){
       assert.equal(result.status,"MISSING_SYMBOL");tiaBlock++;continue;
     }
     if(result.status==="RESEARCH_PRELIMINARY_PASSED"||result.status==="RESEARCH_JUP_CAUSAL_BLOCK"||
        result.status==="TAO_SENSOR_ONLY"||result.status==="RESEARCH_RENDER_WAIT")ready++;
     if(result.status==="NATIVE_REJECTED")blocked++;
     if(result.status==="INVALID_MARKET_SOURCE")sourceProblems++;
   }
 }
}
assert.ok(ready+blocked>200);
assert.equal(sourceProblems,0);
assert.ok(tiaBlock>200);
console.log("PASS frozen IDLE pure entry source SHA, JUP filters, TAO sensor, RENDER wait, DOT, missing TIA fail-closed and synthetic source H1",JSON.stringify({
 nativeCandidates:ready,nativeRejected:blocked,sourceProblems,tiaBlock
}));
