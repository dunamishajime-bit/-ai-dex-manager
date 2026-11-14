/** Offline QAON7 feature and chronological selection parity; no orders. */
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {deriveStable4AvaxFeatures,Stable4Q102OnlineEngine} from "../lib/disdex-quality102-stable4-online";
import {modelStable4Q102Outcome} from "../lib/stable4-q102-shadow-outcome";
const H=3600000,root=process.env.DISDEX_STABLE4_RESEARCH_DATA_ROOT||"C:/tmp/disdex-bt-20251001-20261001";
function load(symbol:string){
 const map=new Map<number,any>();
 for(const file of [`aster-public-v3-h1-early/${symbol}-1h-20250301-20250924.jsonl.gz`,`aster-public-v3-h1/${symbol}-1h-20250924-20261001.jsonl.gz`,`FORWARD_HOLDOUT_20261001_20261108/aster-h1/${symbol}-1h-20261001-20261108T20.jsonl.gz`]){
  for(const line of gunzipSync(readFileSync(join(root,file))).toString("utf8").trim().split(/\r?\n/)){
   const z=JSON.parse(line);map.set(+z[0],{timestampMs:+z[0],open:+z[1],high:+z[2],low:+z[3],close:+z[4],baseVolume:+z[5],quoteVolume:+z[7]});
  }
 }
 return{map,rows:[...map.values()].sort((a,b)=>a.timestampMs-b.timestampMs)};
}
const av=load("AVAXUSDT"),btc=load("BTCUSDT");
const history=(t:number)=>({candlesBySymbol:{AVAXUSDT:av.rows.filter(b=>b.timestampMs>=t-169*H&&b.timestampMs<t),BTCUSDT:btc.rows.filter(b=>b.timestampMs>=t-169*H&&b.timestampMs<t)},entryOpenBySymbol:{AVAXUSDT:{timestampMs:t,open:av.map.get(t)!.open},BTCUSDT:{timestampMs:t,open:btc.map.get(t)!.open}}});
const raw=readFileSync("config/stable4/q102-avax-knn-seed-20261114.json"),seed=JSON.parse(raw.toString("utf8"));
const featureFailures:any[]=[];
for(const row of seed.rows){const actual=deriveStable4AvaxFeatures(history(row.entryTs));if(!actual||actual.f.some((x,i)=>Math.abs(x-row.f[i])>1e-10))featureFailures.push({entryTs:row.entryTs,expected:row.f,actual:actual?.f});}
const referencePath=join(root,"DIRECTION_RESEARCH_20261109/q102_avax_qaon7_local_jitter_v1_20261113.json"),referenceRaw=readFileSync(referencePath),reference=JSON.parse(referenceRaw.toString("utf8"));
const selected=reference.grid.find((x:any)=>Math.abs(x.threshold-.013)<1e-12&&Math.abs(x.agree-.65)<1e-12).targetRows;
const m5=new Map<number,any>();
for(const path of ["aster-public-v3-5m-prefix/AVAXUSDT-5m-20250924-20260803.jsonl.gz","aster-public-v3-5m-suffix/AVAXUSDT-5m-20260803-20261001.jsonl.gz"]){
 for(const line of gunzipSync(readFileSync(join(root,path))).toString("utf8").trim().split(/\r?\n/)){
  const z=JSON.parse(line);m5.set(+z[0],{timestampMs:+z[0],open:+z[1],high:+z[2],low:+z[3],close:+z[4],quoteVolume:+z[7]});
 }
}
const outcomeFailures:any[]=[];
for(const row of selected){
 const now=row.exitTs+H,bars=[];for(let t=row.entryTs;t+300000<=now;t+=300000){const b=m5.get(t);if(b)bars.push(b);}
 try{
  const out=modelStable4Q102Outcome({entryTs:row.entryTs,entryPrice:row.entryPrice,side:row.side,family:"MR",hardStop:.05,maxHoldHours:24,exitPolicy:"STABLE4_STOP5_TP3_H24",now,fiveMinute:bars,hourly:[],funding:{from:row.entryTs,through:now,capturedAt:now,rows:[]}});
  if(!out||out.exitTs!==row.exitTs||Math.abs(out.exitPrice-row.exitPrice)>1e-9||Math.abs(out.rawReturn-row.signed)>1e-9)outcomeFailures.push({entryTs:row.entryTs,expected:row,actual:out});
 }catch(error){outcomeFailures.push({entryTs:row.entryTs,error:error instanceof Error?error.message:String(error)});}
}
const directory=mkdtempSync(join(tmpdir(),"stable4-avax-parity-")),actual:any[]=[];
try{
 const engine=new Stable4Q102OnlineEngine({mode:"SHADOW",recoverySeedPath:"config/stable4/q102-online-recovery-seed-20261114.json",avaxSeedPath:"config/stable4/q102-avax-knn-seed-20261114.json",statePath:join(directory,"state.json"),nativeSignalBuilder:(_,t)=>({strategyId:"QUALITY102_CAUSAL_V1",side:0,referenceTs:t,requestedGross:0,dataCutoffTs:t-H,reason:"INDEPENDENT_QAON7_PARITY",brkEnabled:true})});
 const start=Date.UTC(2025,9,1),end=Date.UTC(2026,9,1);
 for(const row of seed.rows){if(row.entryTs<start||row.entryTs>=end)continue;const h=history(row.entryTs),proposal=engine.propose(h);if(proposal?.kind==="AVAX_KNN")actual.push({entryTs:row.entryTs,side:proposal.signal.side===1?"LONG":"SHORT"});engine.observe(h,row.entryTs);}
 const expected=selected.map((x:any)=>({entryTs:x.entryTs,side:x.side}));
 const selectionMatches=JSON.stringify(actual)===JSON.stringify(expected);
 console.log(JSON.stringify({status:!featureFailures.length&&!outcomeFailures.length&&selectionMatches?"QAON7_FEATURE_SELECTION_AND_OUTCOME_PARITY_PASS":"QAON7_PARITY_FAILED",featureSamples:seed.rows.length,featureFailures:featureFailures.slice(0,5),referenceSelected:expected.length,actualSelected:actual.length,selectionMatches,outcomeSamples:selected.length,outcomeFailures:outcomeFailures.slice(0,5),fundingParityIncluded:false,unexpected:actual.filter(x=>!expected.some((y:any)=>x.entryTs===y.entryTs&&x.side===y.side)),missing:expected.filter((x:any)=>!actual.some(y=>x.entryTs===y.entryTs&&x.side===y.side)),seedSha256:createHash("sha256").update(raw).digest("hex"),referenceSha256:createHash("sha256").update(referenceRaw).digest("hex"),ordersSent:0},null,2));
 if(featureFailures.length||outcomeFailures.length||!selectionMatches)process.exitCode=1;
}finally{rmSync(directory,{recursive:true,force:true});}
