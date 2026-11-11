import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";

const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const PRE=ROOT+"/PREPERIOD_TRAIN_20250301_20251001/IDLE_ALL_BINANCE_PROXY";
const PIN=ROOT+"/pinned-source/IDLE";
const H=3600000,M5=300000;
const START=Date.parse("2025-03-22T00:00:00Z"),END=Date.parse("2025-10-01T00:00:00Z");
const sig=await import(pathToFileURL(PIN+"/lib/idle-priority-short-signal.ts").href);
const pol=(await import(pathToFileURL(PIN+"/config/idlePriorityShortPolicy.ts").href)).IDLE_PRIORITY_SHORT_POLICY;
const {applyIdleProfitTrailBar}=await import(pathToFileURL(PIN+"/lib/disdex-exit-overlay-contract.ts").href);
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

function load(sym,iv){
 const p=PRE+"/"+sym+"-"+iv+"-20250301-20251001.jsonl.gz";
 const rows=zlib.gunzipSync(fs.readFileSync(p)).toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse).map(z=>({
   ts:+z[0],open:+z[1],high:+z[2],low:+z[3],close:+z[4],volume:+z[5],quoteVolume:+z[7]
 }));
 const step=iv==="1h"?H:M5;
 for(let i=1;i<rows.length;i++)if(rows[i].ts-rows[i-1].ts!==step)throw Error("GAP:"+sym+":"+iv+":"+i);
 return {p,rows,map:new Map(rows.map((x,i)=>[x.ts,i]))};
}
const btc=load("BTCUSDT","1h");
const syms=Object.keys(pol.routes),h1={},m5={};
for(const s of syms){h1[s]=load(s,"1h");m5[s]=load(s,"5m");}

const candidates=[],errors={};
for(let t=START;t<END;t+=H){
 const bi=btc.map.get(t);
 if(bi===undefined)continue;
 const br=btc.rows.slice(Math.max(0,bi-160),bi);
 for(const s of syms){
  try{
   const si=h1[s].map.get(t);if(si===undefined)throw Error("ENTRY_H1_MISSING:"+s);
   const sr=h1[s].rows.slice(Math.max(0,si-160),si);
   const f=sig.computeIdlePriorityFeatures(t,sr,br);
   const g=sig.evaluateIdleGenericCandidate(f);
   const d=sig.evaluateIdlePriorityShort(s,f,g);
   if(d.accepted)candidates.push({
    strategy_id:"IDLE",source_runtime_sha:"7688ed7c93a1918d8b44837339b7da5584a868f5",
    source:"BINANCE_UM_PRETARGET_PROXY_EXACT_PINNED_SIGNAL",entryTs:t,signalTs:f.signalTs,
    symbol:s,side:"SHORT",route:d.route,requestedGross:pol.routes[s].gross,
    holdHours:d.holdHours,features:f,genericArchetype:g.archetype,genericReason:g.reason,reason:d.reason
   });
  }catch(e){const k=String(e?.message||e);errors[k]=(errors[k]||0)+1;}
 }
}
function exitModel(c){
 const m=m5[c.symbol],idx=m.map.get(c.entryTs);if(idx===undefined)throw Error("ENTRY_M5_MISSING:"+c.symbol+":"+c.entryTs);
 const price=m.rows[idx].open,maxExit=c.entryTs+c.holdHours*H,tp=price*.75;let stop=price*1.10,trailState;
 for(let i=idx;i<m.rows.length;i++){
  const b=m.rows[i];
  if(b.ts>=maxExit)return {entryPrice:price,exitTs:b.ts,exitPrice:b.open,exitReason:"MAX_HOLD"};
  if(b.high>=stop)return {entryPrice:price,exitTs:b.ts+M5,exitPrice:Math.max(b.open,stop),exitReason:"IDLE_HARD_STOP"};
  if(b.low<=tp)return {entryPrice:price,exitTs:b.ts+M5,exitPrice:Math.min(b.open,tp),exitReason:"IDLE_TAKE_PROFIT"};
  if(c.symbol==="DOTUSDT"||c.symbol==="RENDERUSDT"){
   const q=applyIdleProfitTrailBar({side:"SHORT",entryPrice:price,state:trailState,bar:{timestampMs:b.ts,open:b.open,high:b.high,low:b.low,close:b.close}});
   if(q.stopHit)return {entryPrice:price,exitTs:b.ts+M5,exitPrice:q.triggerPrice,exitReason:"IDLE_NATIVE_TRAIL"};
   trailState=q.state;if(q.state?.stopPrice!==undefined)stop=Math.min(stop,q.state.stopPrice);
  }
 }
 throw Error("EXIT_M5_EXHAUSTED:"+c.symbol+":"+c.entryTs);
}
const out=[],unresolved=[];
for(const c of candidates){
 try{
  const e=exitModel(c);
  if(e.exitTs>END){unresolved.push({...c,unresolved:"EXIT_AFTER_PRETARGET_END",modeledExit:e});continue;}
  out.push({...c,id:"PRE_IDLE_"+String(out.length+1).padStart(6,"0"),...e,
   grossReturn:-(e.exitPrice/e.entryPrice-1),
   semantics:"Exact pinned IDLE signal on Binance UM pretarget proxy + pinned M5 stop/tp/max-hold/trail semantics"});
 }catch(e){
  if(String(e?.message||e).startsWith("EXIT_M5_EXHAUSTED:")){unresolved.push({...c,unresolved:"EXIT_M5_EXHAUSTED"});continue;}
  throw e;
 }
}
const p=PRE+"/idle-all-preperiod-proxy-candidates-with-m5-exits.jsonl";
fs.writeFileSync(PRE+"/idle-all-preperiod-proxy-unresolved.jsonl",unresolved.map(x=>JSON.stringify(x)).join("\n")+(unresolved.length?"\n":""));
fs.writeFileSync(p,out.map(x=>JSON.stringify(x)).join("\n")+(out.length?"\n":""));
function met(a,bps=30){
 const v=a.map(x=>x.grossReturn-bps/10000),gp=v.filter(x=>x>0).reduce((a,b)=>a+b,0),gl=-v.filter(x=>x<0).reduce((a,b)=>a+b,0);
 return {n:v.length,wr:v.length?v.filter(x=>x>0).length/v.length:null,mean:v.length?v.reduce((a,b)=>a+b,0)/v.length:null,
  sum:v.reduce((a,b)=>a+b,0),pf:gl?gp/gl:(gp?999:null)};
}
const bySymbol={},byRoute={},recentCut=END-90*86400000;
for(const s of syms){
 const a=out.filter(x=>x.symbol===s);bySymbol[s]={all30:met(a),recent90_30:met(a.filter(x=>x.entryTs>=recentCut&&x.exitTs<=END))};
}
for(const r of [...new Set(out.map(x=>x.route))]){
 const a=out.filter(x=>x.route===r);byRoute[r]={all30:met(a),recent90_30:met(a.filter(x=>x.entryTs>=recentCut&&x.exitTs<=END))};
}
const inputHashes={btcH1:sha(btc.p)};
for(const s of syms){inputHashes[s]={h1:sha(h1[s].p),m5:sha(m5[s].p)};}
const summary={status:"IDLE_ALL_BINANCE_PRETARGET_PROXY_EXACT_PINNED_SIGNAL_EXIT_MODEL",period:[new Date(START).toISOString(),new Date(END).toISOString()],
 candidateN:out.length,unresolvedN:unresolved.length,bySymbol,byRoute,errors,inputHashes,outputSha256:sha(p),
 limitations:["Binance UM is a pre-target venue proxy, not Aster.","No portfolio capacity/cooldown admission; candidate-quality research only.","Modeled M5 protection, not signed venue fills."]};
fs.writeFileSync(PRE+"/IDLE_ALL_PRETARGET_PROXY_SUMMARY.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
