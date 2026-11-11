import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";

const ROOT="C:/tmp/disdex-bt-20251001-20261001";
const PRE=ROOT+"/PREPERIOD_TRAIN_20250101_20251001/PENGU_V20_BINANCE_PROXY";
const PIN=ROOT+"/pinned-source/PENGU";
const HOUR=3600000;
const BEGIN=Date.parse("2025-01-01T00:00:00Z");
const END=Date.parse("2025-10-01T00:00:00Z");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const assert=(c,m)=>{if(!c)throw Error(m)};

const dual=await import(pathToFileURL(PIN+"/lib/pengu-dual-ls-v2.ts").href);
const recovery=await import(pathToFileURL(PIN+"/lib/pengu-recovery-v8.ts").href);
const recCfg=(await import(pathToFileURL(PIN+"/config/penguRecoveryV8.ts").href)).PENGU_RECOVERY_V8;

function loadH1(sym){
  const p=PRE+"/"+sym+"-1h-20250101-20251001.jsonl.gz";
  const gz=fs.readFileSync(p);
  const raw=zlib.gunzipSync(gz).toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  const rows=raw.map(v=>({openTime:+v[0],closeTime:+v[6],open:+v[1],high:+v[2],low:+v[3],close:+v[4],volume:+v[5]}));
  for(let i=1;i<rows.length;i++)assert(rows[i].openTime-rows[i-1].openTime===HOUR,"H1_GAP_"+sym+"_"+i);
  return {rows,path:p,sha256:sha(gz)};
}
const P=loadH1("PENGUUSDT"),B=loadH1("BTCUSDT");
assert(P.rows.length===B.rows.length,"H1_LENGTH_MISMATCH");
for(let i=0;i<P.rows.length;i++)assert(P.rows[i].openTime===B.rows[i].openTime,"H1_TS_MISMATCH_"+i);
const history={pengu1h:P.rows,btc1h:B.rows,penguFunding:[]};
const evalRows=dual.buildPenguDualLsV2EvaluationSeries(history,END);
assert(evalRows.length===P.rows.length,"EVAL_LENGTH");
const byTs=new Map(P.rows.map(x=>[x.openTime,x]));
const candidates=[],unresolved=[],reasonCounts={};

function nextOpen(ts){const b=byTs.get(ts);return b?b.open:undefined}

for(let i=180;i<evalRows.length;i++){
  const row=evalRows[i],f=row.features;
  if(!f||!row.recoveryV8)continue;
  const signalTs=+f.referenceTs,entryTs=signalTs+HOUR;
  if(entryTs<BEGIN||entryTs>=END)continue;
  const v64=dual.isPenguV8V64DynamicLongSignal(evalRows,i);
  const rr={...row.recoveryV8,ordinaryLongEligible:v64,baseLongSignal:v64};
  const rec=dual.selectPenguRecoveryV8Entry(rr,true);
  if(row.shortSignal||v64||rec?.kind!=="RECOVERY_V8")continue;
  const entryBar=byTs.get(entryTs);
  if(!entryBar){unresolved.push({signalTs,entryTs,reason:"ENTRY_BAR_MISSING"});continue}
  const ep=entryBar.open,gross=rec.gross;
  let pos={
    version:"RECOVERY_V8",side:1,entryTs,entryPrice:ep,quantity:1,originalQuantity:1,
    originalGross:gross,remainingGross:gross,partialDefenseTriggered:false,highWaterMark:ep,
    logicalEntryPrice:ep,recoveryExecutionPrice:ep,protectionLifecycle:"FULL_HARD_STOP",
  };
  const partialEvents=[];
  let final=null,failure=null;
  for(let j=i+1;j<evalRows.length;j++){
    const er=evalRows[j],ef=er.features;
    if(!ef)continue;
    if(ef.referenceTs<entryTs)continue;
    if(ef.referenceTs+HOUR>END){failure="EXIT_AFTER_PREPERIOD";break}
    if(!er.recoveryV8){failure="RECOVERY_FEATURE_ROW_MISSING";break}
    const v64j=dual.isPenguV8V64DynamicLongSignal(evalRows,j);
    const rrj={...er.recoveryV8,ordinaryLongEligible:v64j,baseLongSignal:v64j};
    const beforeQty=pos.quantity;
    const r=recovery.evaluateRecoveryV8PositionBar(pos,rrj);
    if(r.events?.includes("PARTIAL_DEFENSE")){
      const partialQty=Number(r.partialQuantity??(beforeQty-r.updatedPosition.quantity));
      const ratio=beforeQty>0?partialQty/beforeQty:0;
      const px=+r.triggerPrice;
      if(!(ratio>0&&ratio<=1&&px>0)){failure="RECOVERY_PARTIAL_MODEL_INVALID";break}
      partialEvents.push({decisionReferenceTs:ef.referenceTs,eventTs:ef.referenceTs+HOUR,price:px,ratio});
    }
    pos={...pos,...r.updatedPosition};
    if(r.kind!=="NONE"&&r.kind!=="PARTIAL_DEFENSE"){
      let price,priceKind;
      if((r.kind==="HARD_STOP"||r.kind==="TRAILING_STOP")&&r.stopPrice!==undefined){
        price=+r.stopPrice; priceKind="RESIDENT_STOP_PRICE_MODEL";
      }else{
        price=nextOpen(ef.referenceTs+HOUR); priceKind="CAUSAL_NEXT_H1_OPEN";
      }
      if(!(price>0)){failure="RECOVERY_FINAL_PRICE_MISSING";break}
      final={exitTs:ef.referenceTs+HOUR,decisionReferenceTs:ef.referenceTs,exitPrice:price,
             exitReason:"RECOVERY_V8_"+r.kind,exitPriceKind:priceKind};
      break;
    }
  }
  if(!final){unresolved.push({signalTs,entryTs,reason:failure||"NO_EXIT"});continue}
  const rawReturn=final.exitPrice/ep-1;
  const z={
    id:"PRE_V8_"+String(candidates.length+1).padStart(5,"0"),
    source:"BINANCE_UM_PRETARGET_PROXY_CURRENT_PIN_PURE_FUNCTION_REPLAY",
    sourceRuntimeSha:"1657e173d250ad58f53e62f7bb0a3428fb405496",
    signalTs,entryTs,symbol:"PENGUUSDT",side:"LONG",route:"RECOVERY_V8",
    requestedGross:gross,entryPrice:ep,...final,rawReturn,
    partialEvents,remainingQuantityFraction:pos.quantity,
    features:{
      rsiDelta6:rr.rsiDelta6,
      ema168DistancePct:rr.ema168DistancePct,
      btcReturn6hPct:rr.btcReturn6hPct,
      troughAgeHours:rr.troughAgeHours,
      troughClose:rr.troughClose,
      recoveryCross:rr.recoveryCross,
      penguReturn24h:f.penguReturn24h,
      penguReturn72h:f.penguReturn72h,
      btcReturn24h:f.btcReturn24h,
      relativeReturn24h:f.relativeReturn24h,
      btcEma168Distance:f.btcEma168Distance,
      volumeRatio6OverPrior36:f.volumeRatio6OverPrior36,
      atr24Ratio:f.atr24Ratio,rsi14:f.rsi14,close:f.close,ema72:f.ema72,ema168:f.ema168
    }
  };
  candidates.push(z);
  reasonCounts[final.exitReason]=(reasonCounts[final.exitReason]||0)+1;
}

const body=candidates.map(x=>JSON.stringify(x)).join("\n")+(candidates.length?"\n":"");
const out=PRE+"/pengu-v8-preperiod-proxy-candidates-with-native-exits.jsonl";
fs.writeFileSync(out,body);
fs.writeFileSync(PRE+"/pengu-v8-preperiod-proxy-unresolved.jsonl",unresolved.map(x=>JSON.stringify(x)).join("\n")+(unresolved.length?"\n":""));
const byMonth={};
for(const x of candidates){const m=new Date(x.entryTs).toISOString().slice(0,7);byMonth[m]=(byMonth[m]||0)+1}
const summary={
  status:"CAUSAL_PRETARGET_BINANCE_PROXY_CURRENT_PIN_RECOVERY_V8_REPLAY_NOT_ASTER_PARITY",
  scope:{begin:new Date(BEGIN).toISOString(),endExclusive:new Date(END).toISOString()},
  candidateN:candidates.length,unresolvedN:unresolved.length,byMonth,byExitReason:reasonCounts,
  inputs:{penguSha256:P.sha256,btcSha256:B.sha256},
  outputSha256:sha(Buffer.from(body)),
  recoveryConfig:recCfg,
  limitations:[
    "Binance UM H1 candles are a pre-target proxy, not historical Aster candles.",
    "No historical signed venue fills; resident hard/trailing/partial exits use configured stop prices, other exits use causal next-H1-open.",
    "Candidate-quality research only: historical owned-position/cooldown/shared-risk admission is not applied.",
    "Funding is intentionally empty, matching the existing PENGU pretarget proxy convention; this can affect ordinary-route exclusion and is therefore proxy evidence only.",
    "rawReturn is final remaining-position directional return; partial-defense cashflow is recorded separately and not folded into rawReturn."
  ]
};
fs.writeFileSync(PRE+"/pengu-v8-preperiod-proxy-summary.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary));
