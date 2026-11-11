import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";

const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const FWD=ROOT+"/FORWARD_HOLDOUT_20261001_20261108";
const TARGET=ROOT+"/aster-public-v3-h1";
const PIN=ROOT+"/PREPERIOD_TRAIN_20250501_20251001/HYPE_BINANCE_PROXY/isolated-pin-runtime";
const OUT=FWD+"/HYPE_FORWARD_REPLAY";
fs.mkdirSync(OUT,{recursive:true});
const H=3600000,M5=300000;
const START=Date.parse("2026-10-01T00:00:00Z");
const sig=await import(pathToFileURL(PIN+"/lib/hype-trend-long-signal.ts").href);
const policy=(await import(pathToFileURL(PIN+"/config/hypeTrendLongPolicy.ts").href)).HYPE_TREND_LONG_POLICY;
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const assert=(c,m)=>{if(!c)throw Error(m)};

function loadGz(p){
 const gz=fs.readFileSync(p);
 const rows=zlib.gunzipSync(gz).toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
 const a=rows.map(z=>({openTime:+z[0],open:+z[1],high:+z[2],low:+z[3],close:+z[4],volume:+z[5],quoteVolume:+z[7]}));
 return {a,sha256:sha(gz),path:p};
}
function mergeBars(...groups){
 const m=new Map();
 for(const g of groups) for(const x of g) m.set(x.openTime,x);
 return [...m.values()].sort((a,b)=>a.openTime-b.openTime);
}
function assertStep(a,step,label){
 for(let i=1;i<a.length;i++)assert(a[i].openTime-a[i-1].openTime===step,"GAP_"+label+"_"+i+"_"+a[i-1].openTime+"_"+a[i].openTime);
}
const ht=loadGz(TARGET+"/HYPEUSDT-1h-20250924-20261001.jsonl.gz");
const bt=loadGz(TARGET+"/BTCUSDT-1h-20250924-20261001.jsonl.gz");
const hf=loadGz(FWD+"/aster-h1/HYPEUSDT-1h-20261001-20261108T20.jsonl.gz");
const bf=loadGz(FWD+"/aster-h1/BTCUSDT-1h-20261001-20261108T20.jsonl.gz");
const h5f=loadGz(FWD+"/aster-m5/HYPEUSDT-5m-20261001-20261108T20.jsonl.gz");
const hype=mergeBars(ht.a,hf.a), btc=mergeBars(bt.a,bf.a), h5=h5f.a;
assertStep(hype,H,"HYPE_H1");assertStep(btc,H,"BTC_H1");assertStep(h5,M5,"HYPE_M5_FORWARD");
const hypeMap=new Map(hype.map((x,i)=>[x.openTime,i]));
const btcMap=new Map(btc.map((x,i)=>[x.openTime,i]));
const h5Map=new Map(h5.map((x,i)=>[x.openTime,i]));
const finalM5End=h5.at(-1).openTime+M5;
const candidates=[],unresolved=[],reasons={};

function ret(closeNow,openTime,hours){
 const j=hypeMap.get(openTime-hours*H); if(j===undefined)return null;
 return closeNow/hype[j].close-1;
}
function btcRet(openTime,hours){
 const now=btcMap.get(openTime),old=btcMap.get(openTime-hours*H);
 if(now===undefined||old===undefined)return null;
 return btc[now].close/btc[old].close-1;
}
function modelExit(entryTs,ep,atr,gross){
 const stopDistance=atr*policy.stopAtrMultiple;
 const takeProfitDistance=atr*policy.trailingAtrMultiple;
 const walletMove=Math.max(0,0.02/gross-0.003);
 const walletStopPrice=ep*(1-walletMove);
 const stop=Math.max(ep-stopDistance,walletStopPrice);
 const tp=ep+takeProfitDistance;
 const start=h5Map.get(entryTs);
 if(start===undefined)return {error:"ENTRY_M5_MISSING"};
 const end=entryTs+policy.maximumHoldHours*H;
 if(end>finalM5End)return {error:"FORWARD_FULL_LIFECYCLE_NOT_AVAILABLE"};
 for(let i=start;i<h5.length;i++){
  const b=h5[i],t=b.openTime;
  if(t>=end)return {entryPrice:ep,exitTs:t,exitPrice:b.open,exitReason:"PINNED_HYPE_MAX_HOLD",stopDistance,takeProfitDistance,walletStopPrice,effectiveStopPrice:stop,effectiveTakeProfitPrice:tp};
  if(b.low<=stop)return {entryPrice:ep,exitTs:t+M5,exitPrice:Math.min(b.open,stop),exitReason:"PINNED_HYPE_HARD_STOP",stopDistance,takeProfitDistance,walletStopPrice,effectiveStopPrice:stop,effectiveTakeProfitPrice:tp};
  if(b.high>=tp)return {entryPrice:ep,exitTs:t+M5,exitPrice:Math.max(b.open,tp),exitReason:"PINNED_HYPE_TAKE_PROFIT",stopDistance,takeProfitDistance,walletStopPrice,effectiveStopPrice:stop,effectiveTakeProfitPrice:tp};
 }
 return {error:"EXIT_M5_EXHAUSTED"};
}
for(let i=240;i<hype.length;i++){
 const last=hype[i],now=last.openTime+H;
 if(now<START)continue;
 if(now>=finalM5End)break;
 const bi=btcMap.get(last.openTime);
 if(bi===undefined)continue;
 const s=sig.buildHypeTrendSignal({btc:btc.slice(0,bi+1),hype:hype.slice(0,i+1),now});
 reasons[s.reason]=(reasons[s.reason]||0)+1;
 if(!s.accepted)continue;
 const ei=hypeMap.get(now);
 if(ei===undefined){unresolved.push({signalTs:+s.signalTsMs,entryTs:now,reason:"ENTRY_H1_MISSING"});continue}
 const ep=hype[ei].open;
 const stopDistance=s.atr*policy.stopAtrMultiple;
 const gross=Math.min(policy.maximumGross,policy.riskPct/100/(stopDistance/ep+0.003));
 const ex=modelExit(now,ep,s.atr,gross);
 if(ex.error){unresolved.push({signalTs:+s.signalTsMs,entryTs:now,reason:ex.error});continue}
 const close=last.close;
 const feat={
  regimeSlopeBps:s.regimeSlopeBps,breakoutBps:s.breakoutBps,atrRatio:s.atr/close,
  distanceSlowBps:(close/s.slowEma-1)*10000,fastSlowBps:(s.fastEma/s.slowEma-1)*10000,
  regimeDistanceBps:(close/s.regimeEma-1)*10000,hypeRet24:ret(close,last.openTime,24),
  hypeRet72:ret(close,last.openTime,72),btcRet24:btcRet(last.openTime,24)
 };
 candidates.push({id:"FWD_HYPE_"+String(candidates.length+1).padStart(5,"0"),source:"ASTER_TRUE_FORWARD_EXACT_7688_SIGNAL_VALIDATED_EXIT_MODEL",signalTs:+s.signalTsMs,entryTs:now,entryPrice:ep,symbol:"HYPEUSDT",side:"LONG",route:"HYPE_TREND_LONG_PINNED",requestedGross:gross,signalAtr:s.atr,...ex,rawReturn:ex.exitPrice/ep-1,features:feat});
}
const body=candidates.map(x=>JSON.stringify(x)).join("\n")+(candidates.length?"\n":"");
const unbody=unresolved.map(x=>JSON.stringify(x)).join("\n")+(unresolved.length?"\n":"");
fs.writeFileSync(OUT+"/hype-forward-candidates-with-m5-exits.jsonl",body);
fs.writeFileSync(OUT+"/hype-forward-unresolved.jsonl",unbody);
const byMonth={},exitReasons={},unresolvedReasons={};
for(const x of candidates){const m=new Date(x.entryTs).toISOString().slice(0,7);byMonth[m]=(byMonth[m]||0)+1;exitReasons[x.exitReason]=(exitReasons[x.exitReason]||0)+1}
for(const x of unresolved)unresolvedReasons[x.reason]=(unresolvedReasons[x.reason]||0)+1;
const summary={status:"TRUE_ASTER_FORWARD_HYPE_EXACT_SIGNAL_VALIDATED_EXIT_MODEL_RESEARCH_ONLY",start:new Date(START).toISOString(),dataEnd:new Date(finalM5End).toISOString(),candidateN:candidates.length,unresolvedN:unresolved.length,byMonth,signalReasons:reasons,exitReasons,unresolvedReasons,sourcePin:"7688ed7c93a1918d8b44837339b7da5584a868f5",inputs:{hypeTargetH1:ht.sha256,btcTargetH1:bt.sha256,hypeForwardH1:hf.sha256,btcForwardH1:bf.sha256,hypeForwardM5:h5f.sha256},outputSha256:sha(Buffer.from(body)),limitations:["Forward data is Aster public price-bar replay, not signed live fills.","No funding included in candidate-quality gate validation.","Candidates lacking full maximum-hold observation are excluded as unresolved."]};
fs.writeFileSync(OUT+"/hype-forward-summary.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
