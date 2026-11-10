/**
 * Emit causal V12 entry-state features for PRE+TARGET native source signals.
 * Uses only bars through the decision H2 boundary. No outcome labels.
 */
import {readFileSync,writeFileSync,createWriteStream} from "node:fs";
import {join,resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {pathToFileURL} from "node:url";
import {once} from "node:events";
import {createHash} from "node:crypto";
const ROOT=resolve(process.env.DISDEX_BT_ROOT??"C:/tmp/disdex-bt-20251001-20261001"),PIN=join(ROOT,"pinned-source","V4");
const DIR=join(ROOT,"DIRECTION_RESEARCH_20261109","NATIVE_CAUSAL_SOURCE_REPLAY_20261110");
const {resampleV12H1ToH2,buildV12Signals,buildV12WinRateGateFeatures}=await import(pathToFileURL(join(PIN,"lib","v12-x1-all.ts")).href);
const {V12_X1_ALL}=await import(pathToFileURL(join(PIN,"config","v12X1AllRuntime.ts")).href);
const H=3600000,T0=Date.parse("2025-10-01T00:00:00Z"),T1=Date.parse("2026-10-01T00:00:00Z");
const syms=[...V12_X1_ALL.universe],h1={},h2={};
for(const s of syms){
 const fn=s+"USDT-1h-";
 const rows=[
  readFileSync(join(ROOT,"aster-public-v3-h1-early",fn+"20250301-20250924.jsonl.gz")),
  readFileSync(join(ROOT,"aster-public-v3-h1",fn+"20250924-20261001.jsonl.gz"))
 ].flatMap(b=>gunzipSync(b).toString("utf8").trim().split("\n")).map(x=>JSON.parse(x));
 h1[s]=rows.map(r=>({ts:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closed:true}));
 h2[s]=resampleV12H1ToH2(h1[s]);
}
const source=readFileSync(join(DIR,"asof-native-v12-source-signals.jsonl"),"utf8").trim().split("\n").map(x=>JSON.parse(x));
const smap=new Map(source.map(x=>[[x.decisionTs,x.symbol,x.side].join("|"),x]));
if(smap.size!==2980)throw Error("SOURCE_KEY_COUNT");
const outp=join(DIR,"asof-native-v12-causal-entry-state-features.jsonl"),out=createWriteStream(outp,{encoding:"utf8"});
let n=0,pre=0,target=0,mis=0;
for(let i=120;i<h2.BTC.length;i++){
 const t=h2.BTC[i].endTs;if(t>=T1)break;
 const period=t<T0?"pre":"target";
 const u=Object.fromEntries(syms.map(s=>[s,h2[s].slice(0,i+1)]));
 const sigs=buildV12Signals(u,i);
 for(const sig of sigs){
  const key=[t,sig.symbol+"USDT",sig.side].join("|"),base=smap.get(key);
  if(!base){mis++;continue}
  const f=buildV12WinRateGateFeatures(u,i,sig);
  const sg=sig.side==="LONG"?1:-1;
  const row={period,decisionTs:t,symbol:sig.symbol+"USDT",side:sig.side,rank:sig.rank,regime:sig.regime,
   entryGateReason:sig.entryGateReason,entryQualityClass:sig.entryQualityClass??"STANDARD",
   score:sig.score,atr:sig.atr,volumeRatio:sig.volumeRatio,momentum:sig.momentum,
   ret6h:f.ret6h,ret24h:f.ret24h,btc12h:f.btc12h,btc24h:f.btc24h,
   btcEr12:f.btcEr12,btcEr24:f.btcEr24,rel24h:f.rel24h,previousVolumeRatio:f.previousVolumeRatio,
   signedRet6:sg*f.ret6h,signedRet24:sg*f.ret24h,signedBtc12:sg*f.btc12h,signedBtc24:sg*f.btc24h,
   signedRel24:sg*f.rel24h,sideRegimeAligned:(sig.regime===sig.side),sourceKey:key};
  out.write(JSON.stringify(row)+"\n");n++;if(period==="pre")pre++;else target++;
 }
}
out.end();await once(out,"finish");
if(n!==2980||pre!==962||target!==2018||mis!==0)throw Error("COUNT_DRIFT:"+JSON.stringify({n,pre,target,mis}));
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const summary={status:"CAUSAL_ENTRY_STATE_FEATURES_NO_OUTCOME_LABELS",n,pre,target,mis,
 sourceSha256:sha(join(DIR,"asof-native-v12-source-signals.jsonl")),featureSha256:sha(outp),
 featureNames:["regime","ret6h","ret24h","btc12h","btc24h","btcEr12","btcEr24","rel24h","previousVolumeRatio","signedRet6","signedRet24","signedBtc12","signedBtc24","signedRel24"],
 caveat:"Frozen 2026 V12 source policy is retrospectively replayed; feature computation itself uses only bars through decision boundary."};
writeFileSync(join(DIR,"native_v12_causal_entry_state_feature_summary.json"),JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
