import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";

const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const PRE=ROOT+"/PREPERIOD_TRAIN_20250501_20251001/HYPE_BINANCE_PROXY";
const PIN=ROOT+"/pinned-source/HYPE";
const H=3600000,M5=300000;
const END=Date.parse("2025-10-01T00:00:00Z");
const sig=await import(pathToFileURL(PIN+"/lib/hype-trend-long-signal.ts").href);
const policy=(await import(pathToFileURL(PIN+"/config/hypeTrendLongPolicy.ts").href)).HYPE_TREND_LONG_POLICY;
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const assert=(c,m)=>{if(!c)throw Error(m)};

function load(sym,iv){
 const p=PRE+"/"+sym+"-"+iv+"-20250501-20251001.jsonl.gz";
 const gz=fs.readFileSync(p);
 const a=zlib.gunzipSync(gz).toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse).map(z=>({
  openTime:+z[0],open:+z[1],high:+z[2],low:+z[3],close:+z[4],volume:+z[5],quoteVolume:+z[7]
 }));
 const step=iv==="1h"?H:M5;
 for(let i=1;i<a.length;i++)assert(a[i].openTime-a[i-1].openTime===step,"GAP_"+sym+"_"+iv+"_"+i);
 return {a,p,sha256:sha(gz),map:new Map(a.map((x,i)=>[x.openTime,i]))};
}
const hype=load("HYPEUSDT","1h"),btc=load("BTCUSDT","1h"),h5=load("HYPEUSDT","5m");
const btcBy=new Map(btc.a.map((x,i)=>[x.openTime,i]));
const candidates=[],unresolved=[],reasons={};

function ret(closeNow,openTime,hours){
 const j=hype.map.get(openTime-hours*H); if(j===undefined)return null;
 return closeNow/hype.a[j].close-1;
}
function btcRet(openTime,hours){
 const now=btcBy.get(openTime),old=btcBy.get(openTime-hours*H);
 if(now===undefined||old===undefined)return null;
 return btc.a[now].close/btc.a[old].close-1;
}
function modelExit(entryTs,ep,atr,gross){
 const stopDistance=atr*policy.stopAtrMultiple;
 const takeProfitDistance=atr*policy.trailingAtrMultiple;
 const walletMove=Math.max(0,0.02/gross-0.003);
 const walletStopPrice=ep*(1-walletMove);
 const stop=Math.max(ep-stopDistance,walletStopPrice);
 const tp=ep+takeProfitDistance;
 const start=h5.map.get(entryTs);
 if(start===undefined)return {error:"ENTRY_M5_MISSING"};
 const end=entryTs+policy.maximumHoldHours*H;
 for(let i=start;i<h5.a.length;i++){
  const b=h5.a[i],t=b.openTime;
  if(t>=end){
   return {entryPrice:ep,exitTs:t,exitPrice:b.open,exitReason:"PINNED_HYPE_MAX_HOLD",
    stopDistance,takeProfitDistance,walletStopPrice,effectiveStopPrice:stop,effectiveTakeProfitPrice:tp};
  }
  if(b.low<=stop)return {entryPrice:ep,exitTs:t+M5,exitPrice:Math.min(b.open,stop),exitReason:"PINNED_HYPE_HARD_STOP",
    stopDistance,takeProfitDistance,walletStopPrice,effectiveStopPrice:stop,effectiveTakeProfitPrice:tp};
  if(b.high>=tp)return {entryPrice:ep,exitTs:t+M5,exitPrice:Math.max(b.open,tp),exitReason:"PINNED_HYPE_TAKE_PROFIT",
    stopDistance,takeProfitDistance,walletStopPrice,effectiveStopPrice:stop,effectiveTakeProfitPrice:tp};
 }
 return {error:"EXIT_M5_EXHAUSTED"};
}

for(let i=240;i<hype.a.length;i++){
 const last=hype.a[i],now=last.openTime+H;
 if(now>=END)break;
 const bi=btcBy.get(last.openTime);
 if(bi===undefined)continue;
 const hr=hype.a.slice(0,i+1);
 const br=btc.a.slice(0,bi+1);
 const s=sig.buildHypeTrendSignal({btc:br,hype:hr,now});
 reasons[s.reason]=(reasons[s.reason]||0)+1;
 if(!s.accepted)continue;
 const entryTs=now,ei=hype.map.get(entryTs);
 if(ei===undefined){unresolved.push({signalTs:s.signalTsMs,entryTs,reason:"ENTRY_H1_MISSING"});continue}
 const ep=hype.a[ei].open;
 const stopDistance=s.atr*policy.stopAtrMultiple;
 const gross=Math.min(policy.maximumGross,policy.riskPct/100/(stopDistance/ep+0.003));
 const ex=modelExit(entryTs,ep,s.atr,gross);
 if(ex.error){unresolved.push({signalTs:s.signalTsMs,entryTs,reason:ex.error});continue}
 const close=last.close;
 const feat={
  regimeSlopeBps:s.regimeSlopeBps,breakoutBps:s.breakoutBps,atrRatio:s.atr/close,
  distanceSlowBps:(close/s.slowEma-1)*10000,fastSlowBps:(s.fastEma/s.slowEma-1)*10000,
  regimeDistanceBps:(close/s.regimeEma-1)*10000,
  hypeRet24:ret(close,last.openTime,24),hypeRet72:ret(close,last.openTime,72),
  btcRet24:btcRet(last.openTime,24)
 };
 candidates.push({
  id:"PRE_HYPE_"+String(candidates.length+1).padStart(5,"0"),
  source:"BINANCE_UM_PRETARGET_PROXY_EXACT_7688_SIGNAL_AND_VALIDATED_EXIT_MODEL",
  signalTs:+s.signalTsMs,entryTs,entryPrice:ep,symbol:"HYPEUSDT",side:"LONG",
  route:"HYPE_TREND_LONG_PINNED",requestedGross:gross,signalAtr:s.atr,
  ...ex,rawReturn:ex.exitPrice/ep-1,features:feat
 });
}
const out=PRE+"/hype-preperiod-proxy-candidates-with-m5-exits.jsonl";
const body=candidates.map(x=>JSON.stringify(x)).join("\n")+(candidates.length?"\n":"");
fs.writeFileSync(out,body);
fs.writeFileSync(PRE+"/hype-preperiod-proxy-unresolved.jsonl",unresolved.map(x=>JSON.stringify(x)).join("\n")+(unresolved.length?"\n":""));
const byMonth={},exitReasons={};
for(const x of candidates){const m=new Date(x.entryTs).toISOString().slice(0,7);byMonth[m]=(byMonth[m]||0)+1;exitReasons[x.exitReason]=(exitReasons[x.exitReason]||0)+1}
const summary={
 status:"CAUSAL_PRETARGET_BINANCE_PROXY_EXACT_SIGNAL_VALIDATED_EXIT_MODEL_NOT_ASTER_PARITY",
 candidateN:candidates.length,unresolvedN:unresolved.length,byMonth,signalReasons:reasons,exitReasons,
 sourcePin:"7688ed7c93a1918d8b44837339b7da5584a868f5",
 relevantSignalPolicyByteEquivalentToCandidatePinD6bcc:true,
 modelValidation:"Target-year formula and M5 replay matched 78/78 existing pinned candidates before pre-target use",
 inputs:{hypeH1:hype.sha256,btcH1:btc.sha256,hypeM5:h5.sha256},
 outputSha256:sha(Buffer.from(body)),
 limitations:["Binance UM is a pre-target proxy, not historical Aster.","No signed venue fills or funding.","Candidate-quality research only; portfolio admission is applied only after any rule is frozen."]
};
fs.writeFileSync(PRE+"/hype-preperiod-proxy-summary.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
