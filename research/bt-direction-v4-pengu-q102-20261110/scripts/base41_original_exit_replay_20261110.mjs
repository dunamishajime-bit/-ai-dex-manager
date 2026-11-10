/**
 * Replay original Base41 catalog exits for emitted pre-V2 first-match candidates.
 * Explicitly excludes V2 repair exit overrides and later four-rule overlays.
 * Target labels are written for later falsification but not summarized by route.
 */
import {readFileSync,writeFileSync,createWriteStream,existsSync} from "node:fs";
import {join,resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {pathToFileURL} from "node:url";
import {once} from "node:events";
import {createHash} from "node:crypto";
const ROOT=resolve(process.env.DISDEX_BT_ROOT??"C:/tmp/disdex-bt-20251001-20261001"),PIN=join(ROOT,"pinned-source","V4");
const DIR=join(ROOT,"DIRECTION_RESEARCH_20261109","NATIVE_CAUSAL_SOURCE_REPLAY_20261110"),FWD=join(ROOT,"FORWARD_HOLDOUT_20261001_20261108","aster-h1");
const {evaluateNativeProductionExit}=await import(pathToFileURL(join(PIN,"lib","v12-v4-production-lifecycle.ts")).href);
const H=3600000,T0=Date.parse("2025-10-01T00:00:00Z");
const rows=readFileSync(join(DIR,"base41-first-match-pre-v2-candidates.jsonl"),"utf8").trim().split("\n").map(x=>JSON.parse(x));
if(rows.filter(x=>x.period==="pre").length!==738||rows.filter(x=>x.period==="target").length!==1662)throw Error("BASE41_COUNT_DRIFT");
const syms=[...new Set(rows.map(x=>x.sourceSymbol))],bars={},offset={};
for(const symbol of syms){
 const bufs=[
  readFileSync(join(ROOT,"aster-public-v3-h1-early",symbol+"-1h-20250301-20250924.jsonl.gz")),
  readFileSync(join(ROOT,"aster-public-v3-h1",symbol+"-1h-20250924-20261001.jsonl.gz"))
 ];
 const fp=join(FWD,symbol+"-1h-20261001-20261108T20.jsonl.gz");if(existsSync(fp))bufs.push(readFileSync(fp));
 const map=new Map();
 for(const b of bufs)for(const line of gunzipSync(b).toString("utf8").trim().split("\n")){
  const r=JSON.parse(line),t=Number(r[0]);
  map.set(t,{ts:t,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4])});
 }
 const a=[...map.values()].sort((x,y)=>x.ts-y.ts);
 // One known corrupt PRE BTC H1 is retained in source but no emitted candidate
 // whose exit stream needs bar range validation may silently use it.
 bars[symbol]=a;offset[symbol]=a[0].ts;
}
function hbar(symbol,ts){
 const a=bars[symbol],i=(ts-offset[symbol])/H;
 return Number.isInteger(i)&&i>=0&&i<a.length?a[i]:null;
}
function policySpec(p){
 if(p==="INHERIT_V12_STATE_EXIT")return {kind:"NATIVE",hours:46};
 let m=/^(?:TIME_(\d+)H(?:_FIXED_REFINED)?|(?:REV|ORIG)_D\d+_T(\d+))$/.exec(p);
 if(m)return {kind:"TIME",hours:Number(m[1]??m[2])};
 m=/^(?:(?:REV|ORIG)_D\d+_)?TP([\d.]+)_SL([\d.]+)_H(\d+)$/.exec(p);
 if(m)return {kind:"ATR",tp:Number(m[1]),sl:Number(m[2]),hours:Number(m[3])};
 throw Error("UNSUPPORTED_BASE_POLICY:"+p);
}
function validBar(b){
 return b&&[b.open,b.high,b.low,b.close].every(x=>Number.isFinite(x)&&x>0)&&
  b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close)&&b.low<=b.high;
}
function simulate(c){
 const symbol=c.sourceSymbol,side=c.effectiveSide,entry=Number(c.eligibleEntryTs),b0=hbar(symbol,entry);
 if(!validBar(b0))return {status:"DATA_INVALID_ENTRY_OR_H1",at:entry};
 const ep=b0.open,sg=side==="LONG"?1:-1,A=Number(c.featureAtr14),spec=policySpec(c.plannedExitPolicy);
 if(!(A>0))throw Error("BAD_ENTRY_ATR");
 if(spec.kind==="NATIVE"){
  const leg={entryTs:entry,entryAtr:A,nativeExitEvidence:"WR60_BASELINE_1978_PARITY",entryNotional:ep,qty:1,status:"OPEN",
    candidate:{route:"REC_G3_LATE_BTC_REL",effectiveSide:side}};
  let decision=null;
  for(let ts=entry;ts<entry+46*H;ts+=H){
   const b=hbar(symbol,ts),next=hbar(symbol,ts+H);
   if(!validBar(b))return {status:"DATA_INVALID_EXIT_H1",at:ts};
   const n=evaluateNativeProductionExit(leg,{openTs:b.ts,open:b.open,high:b.high,low:b.low,close:b.close},ts+H,
     next?{ts:ts+H,price:next.open}:undefined);
   leg.nativeStop=n.stop;leg.nativePeak=n.peak;leg.previousExitBar={openTs:b.ts,open:b.open,high:b.high,low:b.low,close:b.close};
   if(n.decision){decision=n.decision;break;}
  }
  if(!decision)return {status:"RIGHT_CENSORED_NATIVE"};
  return {status:"MODELED_COMPLETE_BASE41",entryPrice:ep,exitPrice:decision.price,exitTs:decision.exitTs,exitReason:"BASE_NATIVE_"+decision.reason};
 }
 const end=entry+spec.hours*H;
 if(spec.kind==="ATR"){
  const stop=ep-sg*spec.sl*A,tp=ep+sg*spec.tp*A;
  for(let ts=entry;ts<end;ts+=H){
   const b=hbar(symbol,ts);if(!validBar(b))return {status:"DATA_INVALID_EXIT_H1",at:ts};
   if(sg===1?b.low<=stop:b.high>=stop)
    return {status:"MODELED_COMPLETE_BASE41",entryPrice:ep,exitPrice:sg===1?Math.min(stop,b.open):Math.max(stop,b.open),exitTs:ts+H,exitReason:"BASE_STOP"};
   if(sg===1?b.high>=tp:b.low<=tp)
    return {status:"MODELED_COMPLETE_BASE41",entryPrice:ep,exitPrice:tp,exitTs:ts+H,exitReason:"BASE_TP"};
  }
 }
 const nb=hbar(symbol,end);
 if(!nb)return {status:"RIGHT_CENSORED_TIME",at:end};
 return {status:"MODELED_COMPLETE_BASE41",entryPrice:ep,exitPrice:nb.open,exitTs:end,exitReason:"BASE_TIME"};
}
const outp=join(DIR,"base41-first-match-original-exits.jsonl"),out=createWriteStream(outp,{encoding:"utf8"});
const count={pre:{complete:0,invalid:0,censored:0},target:{complete:0,invalid:0,censored:0}};
let preWin10=0,preWin30=0,preSum10=0,preSum30=0;
for(const c of rows){
 const z=simulate(c),period=c.period;
 if(z.status==="MODELED_COMPLETE_BASE41"){
  count[period].complete++;
  const sg=c.effectiveSide==="LONG"?1:-1,gross=sg*(z.exitPrice/z.entryPrice-1),n10=gross-.001,n30=gross-.003;
  if(period==="pre"){if(n10>0)preWin10++;if(n30>0)preWin30++;preSum10+=n10;preSum30+=n30;}
  out.write(JSON.stringify({...c,...z,grossDirectionalReturn:gross,net10bpsNoFunding:n10,net30bpsNoFunding:n30})+"\n");
 }else{
  if(z.status.startsWith("DATA_INVALID"))count[period].invalid++;else count[period].censored++;
  out.write(JSON.stringify({...c,...z})+"\n");
 }
}
out.end();await once(out,"finish");
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex"),preN=count.pre.complete;
const summary={status:"BASE41_ORIGINAL_CATALOG_EXIT_REPLAY_NO_V2_REPAIRS_NO_FOUR_RULE",count,
 preOnlySummary:{n:preN,winRate10:preWin10/preN,winRate30:preWin30/preN,mean10:preSum10/preN,mean30:preSum30/preN},
 outputSha256:sha(outp),candidateSha256:sha(join(DIR,"base41-first-match-pre-v2-candidates.jsonl")),
 caveats:["Target route/outcome metrics intentionally not summarized before PRE-only ranking is frozen.","No funding in standalone PRE score labels.","Route catalog itself is 2026 research-derived.","Later V2 exit repairs and four-rule policy deliberately excluded."]};
writeFileSync(join(DIR,"base41_original_exit_replay_summary.json"),JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
