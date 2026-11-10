import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";

const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const PRE=ROOT+"/PREPERIOD_TRAIN_20250101_20251001/PENGU_V20_BINANCE_PROXY";
const PIN=ROOT+"/pinned-source/PENGU";
const OUT=PRE;
const HOUR=3600000;
const BEGIN=Date.parse("2025-01-01T00:00:00Z");
const END=Date.parse("2025-10-01T00:00:00Z");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const assert=(c,m)=>{if(!c)throw Error(m)};

const dual=await import(pathToFileURL(PIN+"/lib/pengu-dual-ls-v2.ts").href);
const v20=await import(pathToFileURL(PIN+"/lib/pengu-short-v20.ts").href);
const cfg=(await import(pathToFileURL(PIN+"/config/penguDualLsV2Runtime.ts").href)).PENGU_DUAL_LS_V2;

function loadH1(sym){
  const p=PRE+"/"+sym+"-1h-20250101-20251001.jsonl.gz";
  const gz=fs.readFileSync(p);
  const raw=zlib.gunzipSync(gz).toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  const rows=raw.map(v=>({openTime:+v[0],closeTime:+v[6],open:+v[1],high:+v[2],low:+v[3],close:+v[4],volume:+v[5]}));
  for(let i=1;i<rows.length;i++)assert(rows[i].openTime-rows[i-1].openTime===HOUR,"H1_GAP_"+sym+"_"+i);
  return {rows,path:p,sha256:sha(gz)};
}
const P=loadH1("PENGUUSDT"),B=loadH1("BTCUSDT");
const history={pengu1h:P.rows,btc1h:B.rows,penguFunding:[]};
const evalRows=dual.buildPenguDualLsV2EvaluationSeries(history,END);
assert(evalRows.length===P.rows.length,"EVAL_LENGTH");
const byTs=new Map(P.rows.map(x=>[x.openTime,x]));
const candidates=[],unresolved=[],reasonCounts={};

function nextOpen(ts){const b=byTs.get(ts);return b?b.open:undefined}
function finalModelPrice(reason,exit,observationTs){
  if(exit?.stopPrice!==undefined && (reason.includes("HARD_STOP")||reason.includes("TRAILING_STOP")))
    return {price:+exit.stopPrice,kind:"RESIDENT_STOP_PRICE_MODEL"};
  const causal=nextOpen(observationTs+HOUR);
  return causal>0?{price:causal,kind:"CAUSAL_NEXT_H1_OPEN"}:undefined;
}

for(let i=180;i<evalRows.length;i++){
  const row=evalRows[i],f=row.features;
  if(!f||!row.shortSignal)continue;
  const signalTs=+f.referenceTs,entryTs=signalTs+HOUR;
  if(entryTs<BEGIN||entryTs>=END)continue;
  const entryBar=byTs.get(entryTs);
  if(!entryBar){unresolved.push({signalTs,entryTs,reason:"ENTRY_BAR_MISSING"});continue}
  const ep=entryBar.open,gross=cfg.fixedEntryGross;
  let pos={
    side:-1,entryTs,entryPrice:ep,quantity:1,gross,
    highWaterMark:ep,lowWaterMark:ep,entryVersion:"SHORT_V20",
    shortV20:v20.createPenguShortV20State({
      entryPrice:ep,requestedGross:gross,entryAtr24Ratio:f.atr24Ratio,
      btcEma168Distance:f.btcEma168Distance,btcReturn24h:f.btcReturn24h,
    })
  };
  let final=null,failure=null;
  for(let j=i+1;j<evalRows.length;j++){
    const er=evalRows[j],ef=er.features;
    if(!ef)continue;
    if(ef.referenceTs<entryTs)continue;
    if(ef.referenceTs+HOUR>END){failure="EXIT_AFTER_PREPERIOD";break}
    const r=dual.evaluatePenguDualLsV2PositionBar(pos,ef);
    pos=r.updatedPosition;
    if(r.exit){
      const fm=finalModelPrice(r.exit.reason,r.exit,ef.referenceTs);
      if(!fm){failure="FINAL_PRICE_MISSING";break}
      final={exitTs:ef.referenceTs+HOUR,decisionReferenceTs:ef.referenceTs,
        exitPrice:fm.price,exitPriceKind:fm.kind,exitReason:r.exit.reason,
        sourceModelPrice:r.exit.stopPrice!==undefined?+r.exit.stopPrice:undefined};
      break;
    }
  }
  if(!final){unresolved.push({signalTs,entryTs,reason:failure||"NO_EXIT"});continue}
  const rawReturn=-(final.exitPrice/ep-1);
  const z={
    id:"PRE_V20_"+String(candidates.length+1).padStart(5,"0"),
    source:"BINANCE_UM_PRETARGET_PROXY_CURRENT_PIN_PURE_FUNCTION_REPLAY",
    sourceRuntimeSha:"1657e173d250ad58f53e62f7bb0a3428fb405496",
    signalTs,entryTs,symbol:"PENGUUSDT",side:"SHORT",route:"SHORT_V20",
    requestedGross:gross,entryPrice:ep,...final,rawReturn,
    features:{
      penguReturn24h:f.penguReturn24h,penguReturn72h:f.penguReturn72h,
      btcReturn24h:f.btcReturn24h,relativeReturn24h:f.relativeReturn24h,
      btcEma168Distance:f.btcEma168Distance,volumeRatio6OverPrior36:f.volumeRatio6OverPrior36,
      atr24Ratio:f.atr24Ratio,rsi14:f.rsi14,close:f.close,ema72:f.ema72,ema168:f.ema168
    }
  };
  candidates.push(z);
  reasonCounts[final.exitReason]=(reasonCounts[final.exitReason]||0)+1;
}
const out=OUT+"/pengu-v20-preperiod-proxy-candidates-with-native-exits.jsonl";
const body=candidates.map(x=>JSON.stringify(x)).join("\n")+(candidates.length?"\n":"");
fs.writeFileSync(out,body);
fs.writeFileSync(OUT+"/pengu-v20-preperiod-proxy-unresolved.jsonl",unresolved.map(x=>JSON.stringify(x)).join("\n")+(unresolved.length?"\n":""));
const byMonth={};
for(const x of candidates){const m=new Date(x.entryTs).toISOString().slice(0,7);byMonth[m]=(byMonth[m]||0)+1}
const summary={
  status:"CAUSAL_PRETARGET_BINANCE_PROXY_CURRENT_PIN_REPLAY_NOT_ASTER_PARITY",
  scope:{begin:new Date(BEGIN).toISOString(),endExclusive:new Date(END).toISOString()},
  candidateN:candidates.length,unresolvedN:unresolved.length,byMonth,byExitReason:reasonCounts,
  inputs:{penguSha256:P.sha256,btcSha256:B.sha256},
  outputSha256:sha(Buffer.from(body)),
  fixedEntryGross:cfg.fixedEntryGross,
  limitations:[
    "Binance UM H1 candles are a pre-target proxy, not historical Aster candles.",
    "No historical signed venue fills; resident hard/trailing exits use configured stop price, other exits use causal next-H1-open.",
    "Candidate-quality research only: portfolio ownership/cooldown/shared-risk admission is not applied here.",
    "Funding is intentionally excluded from candidate rawReturn, matching the prior PENGU gate research convention."
  ]
};
fs.writeFileSync(OUT+"/pengu-v20-preperiod-proxy-summary.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
