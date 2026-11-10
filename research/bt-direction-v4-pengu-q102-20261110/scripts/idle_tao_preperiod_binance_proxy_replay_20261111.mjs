import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";

const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const PRE=ROOT+"/PREPERIOD_TRAIN_20250322_20251001/IDLE_TAO_BINANCE_PROXY";
const PIN=ROOT+"/pinned-source/IDLE";
const OUT=PRE;
const H=3600000, M5=300000;
const START=Date.parse("2025-03-22T00:00:00Z");
const END=Date.parse("2025-10-01T00:00:00Z");
const sig=await import(pathToFileURL(PIN+"/lib/idle-priority-short-signal.ts").href);
const pol=(await import(pathToFileURL(PIN+"/config/idlePriorityShortPolicy.ts").href)).IDLE_PRIORITY_SHORT_POLICY;
const sha=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

function load(sym,interval){
  const p=PRE+"/"+sym+"-"+interval+"-20250301-20251001.jsonl.gz";
  const rows=zlib.gunzipSync(fs.readFileSync(p)).toString("utf8").trim().split("\n").map(JSON.parse).map(z=>({
    ts:+z[0],open:+z[1],high:+z[2],low:+z[3],close:+z[4],volume:+z[5],closeTs:+z[6],quoteVolume:+z[7]
  }));
  const step=interval==="1h"?H:M5;
  for(let i=1;i<rows.length;i++)if(rows[i].ts-rows[i-1].ts!==step)throw Error("GAP:"+sym+":"+interval+":"+i);
  return {p,rows,first:rows[0].ts,map:new Map(rows.map((x,i)=>[x.ts,i]))};
}
const tao=load("TAOUSDT","1h"),btc=load("BTCUSDT","1h"),tao5=load("TAOUSDT","5m");
const candidates=[],errors={};
for(let t=START;t<END;t+=H){
  try{
    const si=tao.map.get(t),bi=btc.map.get(t);
    if(si===undefined||bi===undefined)throw Error("ENTRY_H1_MISSING");
    const sr=tao.rows.slice(Math.max(0,si-160),si);
    const br=btc.rows.slice(Math.max(0,bi-160),bi);
    const f=sig.computeIdlePriorityFeatures(t,sr,br);
    const g=sig.evaluateIdleGenericCandidate(f);
    const d=sig.evaluateIdlePriorityShort("TAOUSDT",f,g);
    if(d.accepted)candidates.push({
      strategy_id:"IDLE",source_runtime_sha:"7688ed7c93a1918d8b44837339b7da5584a868f5",
      source:"BINANCE_UM_PREPERIOD_PROXY_EXACT_PINNED_SIGNAL",entryTs:t,signalTs:f.signalTs,
      symbol:"TAOUSDT",side:"SHORT",route:d.route,requestedGross:pol.routes.TAOUSDT.gross,
      holdHours:d.holdHours,features:f,genericArchetype:g.archetype,genericReason:g.reason,reason:d.reason
    });
  }catch(e){const k=String(e?.message||e);errors[k]=(errors[k]||0)+1;}
}
function exitModel(c){
  const idx=tao5.map.get(c.entryTs); if(idx===undefined)throw Error("ENTRY_M5_MISSING:"+c.entryTs);
  const price=tao5.rows[idx].open,maxExit=c.entryTs+c.holdHours*H,tp=price*.75,stop=price*1.10;
  for(let i=idx;i<tao5.rows.length;i++){
    const b=tao5.rows[i];
    if(b.ts>=maxExit)return {entryPrice:price,exitTs:b.ts,exitPrice:b.open,exitReason:"MAX_HOLD"};
    if(b.high>=stop)return {entryPrice:price,exitTs:b.ts+M5,exitPrice:Math.max(b.open,stop),exitReason:"IDLE_HARD_STOP"};
    if(b.low<=tp)return {entryPrice:price,exitTs:b.ts+M5,exitPrice:Math.min(b.open,tp),exitReason:"IDLE_TAKE_PROFIT"};
  }
  throw Error("EXIT_M5_EXHAUSTED:"+c.entryTs);
}
const out=candidates.map((c,i)=>{
  const e=exitModel(c);
  return {...c,id:"PRE_TAO_"+String(i+1).padStart(5,"0"),...e,
    grossReturn:-(e.exitPrice/e.entryPrice-1),
    semantics:"Exact pinned TAO signal functions on Binance UM preperiod proxy + current IDLE M5 stop/tp/max-hold semantics"};
});
const p=OUT+"/idle-tao-preperiod-proxy-candidates-with-m5-exits.jsonl";
fs.writeFileSync(p,out.map(x=>JSON.stringify(x)).join("\n")+"\n");
const byReason={};for(const x of out)byReason[x.exitReason]=(byReason[x.exitReason]||0)+1;
const summary={
  status:"CAUSAL_PREPERIOD_PROXY_NOT_ASTER_VENUE_PARITY",
  scope:{start:"2025-03-22T00:00:00Z",endExclusive:"2025-10-01T00:00:00Z"},
  candidateN:out.length,exitReasons:byReason,errors,
  inputHashes:{taoH1:sha(tao.p),btcH1:sha(btc.p),taoM5:sha(tao5.p)},
  outputSha256:sha(p),
  limitations:[
    "Binance UM candles are a pre-target proxy, not historical Aster candles.",
    "M5 exit model reproduces current IDLE hard-stop/take-profit/max-hold semantics but not venue latency or signed fills.",
    "No portfolio admission/capacity/cooldown is applied; this is candidate-quality research only."
  ]
};
fs.writeFileSync(OUT+"/idle-tao-preperiod-proxy-summary.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
