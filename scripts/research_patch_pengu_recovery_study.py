from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()
marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
type RecoveryFold = "FOLD1" | "FOLD2" | "FOLD3";
type RecoveryEvent = {
  triggerPct:number; signalIndex:number; signalTs:number; entryIndex:number; entryTs:number; entryPrice:number;
  troughIndex:number; troughTs:number; troughClose:number; troughAgeHours:number; fold:RecoveryFold;
  coverage:OpportunityCoverage; target8:boolean; target10:boolean; target8Ts:number|null; target10Ts:number|null;
  maxClose96PctFromTrough:number; entryMfe96Pct:number; entryMae96Pct:number; entryMaeTo8Pct:number|null; entryMaeTo10Pct:number|null;
  inMissed8Wave:boolean; inMissed10Wave:boolean; shortOverlap8Wave:boolean; shortOverlap10Wave:boolean;
  features:Record<string,number>;
};
const RECOVERY_TRIGGERS=[2,3,5] as const;
const RECOVERY_LOOKBACK=72;
const RECOVERY_MAX_TROUGH_AGE=48;
const RECOVERY_LABEL_HORIZON=96;
function recoveryFold(ts:number):RecoveryFold {const span=EVAL_END-EVAL_START,a=EVAL_START+Math.floor(span/3),b=EVAL_START+Math.floor(span*2/3);return ts<a?"FOLD1":ts<b?"FOLD2":"FOLD3";}
function safeRet(a:number,b:number){return Number.isFinite(a)&&Number.isFinite(b)&&b>0?a/b-1:Number.NaN;}
function meanNumber(a:number[]){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:Number.NaN;}
function rollingCloseMinIndex(rows:PenguDualLsV2EvaluationRow[],endExclusive:number,lookback:number){let best=-1,bestClose=Infinity;const start=Math.max(0,endExclusive-lookback);for(let j=start;j<endExclusive;j++){const c=rows[j].candle.close;if(c<=bestClose){bestClose=c;best=j;}}return best;}
function rollingCloseMax(rows:PenguDualLsV2EvaluationRow[],start:number,endInclusive:number){let m=-Infinity;for(let j=Math.max(0,start);j<=Math.min(rows.length-1,endInclusive);j++)m=Math.max(m,rows[j].candle.close);return m;}
function rollingMeanVolume(rows:PenguDualLsV2EvaluationRow[],endInclusive:number,length:number){const start=endInclusive-length+1;if(start<0)return Number.NaN;let s=0;for(let j=start;j<=endInclusive;j++)s+=rows[j].candle.volume;return s/length;}
function rowFeature(rows:PenguDualLsV2EvaluationRow[],i:number,key:keyof PenguDualLsV2Features){const f=rows[i]?.features;return f?Number(f[key]):Number.NaN;}
function rsiDelta(rows:PenguDualLsV2EvaluationRow[],i:number,h:number){return rowFeature(rows,i,"rsi14")-rowFeature(rows,i-h,"rsi14");}
function emaDistance(rows:PenguDualLsV2EvaluationRow[],i:number,span:"ema72"|"ema168"){const f=rows[i]?.features;return f?safeRet(f.close,Number(f[span])):Number.NaN;}
function pctWindowReturn(rows:PenguDualLsV2EvaluationRow[],i:number,h:number,btc=false){if(i-h<0)return Number.NaN;const a=btc?rows[i].btcCandle.close:rows[i].candle.close,b=btc?rows[i-h].btcCandle.close:rows[i-h].candle.close;return safeRet(a,b);}
function recoveryFeatures(rows:PenguDualLsV2EvaluationRow[],i:number,troughIndex:number,troughClose:number,triggerPct:number){
  const f=rows[i].features!;const preHigh24=rollingCloseMax(rows,troughIndex-24,troughIndex),preHigh72=rollingCloseMax(rows,troughIndex-72,troughIndex);
  const v3=rollingMeanVolume(rows,i,3),v12=rollingMeanVolume(rows,i-3,12),v6=rollingMeanVolume(rows,i,6),v36=rollingMeanVolume(rows,i-6,36);
  const r1=pctWindowReturn(rows,i,1),r3=pctWindowReturn(rows,i,3),r6=pctWindowReturn(rows,i,6),r12=pctWindowReturn(rows,i,12);
  const b3=pctWindowReturn(rows,i,3,true),b6=pctWindowReturn(rows,i,6,true),b12=pctWindowReturn(rows,i,12,true);
  let green=0,body=0;for(let j=Math.max(0,i-2);j<=i;j++){if(rows[j].candle.close>rows[j].candle.open)green++;body+=safeRet(rows[j].candle.close,rows[j].candle.open);}
  const atr6=rowFeature(rows,i-6,"atr24Ratio");const ed168=emaDistance(rows,i,"ema168"),ed168p3=emaDistance(rows,i-3,"ema168"),ed72=emaDistance(rows,i,"ema72"),ed72p3=emaDistance(rows,i-3,"ema72");
  const passes=longGatePasses(f);const failed=longGateOrder.filter(g=>!passes[g]).length;
  return {
    triggerPct,recoveryFromTroughPct:safeRet(f.close,troughClose)*100,troughAgeHours:i-troughIndex,recoveryVelocityPctPerHour:(safeRet(f.close,troughClose)*100)/Math.max(1,i-troughIndex),
    washoutDepth24Pct:safeRet(troughClose,preHigh24)*100,washoutDepth72Pct:safeRet(troughClose,preHigh72)*100,
    penguReturn1hPct:r1*100,penguReturn3hPct:r3*100,penguReturn6hPct:r6*100,penguReturn12hPct:r12*100,penguReturn24hPct:f.penguReturn24h*100,penguReturn72hPct:f.penguReturn72h*100,
    btcReturn3hPct:b3*100,btcReturn6hPct:b6*100,btcReturn12hPct:b12*100,btcReturn24hPct:f.btcReturn24h*100,
    relative3hPct:(r3-b3)*100,relative6hPct:(r6-b6)*100,relative12hPct:(r12-b12)*100,relative24hPct:f.relativeReturn24h*100,
    momentumAcceleration6v24Pct:(r6-f.penguReturn24h/4)*100,relativeAcceleration6v24Pct:((r6-b6)-f.relativeReturn24h/4)*100,
    volume3OverPrior12:Number.isFinite(v3)&&v12>0?v3/v12:Number.NaN,volume6OverPrior36:Number.isFinite(v6)&&v36>0?v6/v36:f.volumeRatio6OverPrior36,
    atr24Pct:f.atr24Ratio*100,atr24Change6hPct:(f.atr24Ratio-atr6)*100,rsi14:f.rsi14,rsiDelta3:rsiDelta(rows,i,3),rsiDelta6:rsiDelta(rows,i,6),
    ema72DistancePct:ed72*100,ema72Recovery3hPct:(ed72-ed72p3)*100,ema168DistancePct:ed168*100,ema168Recovery3hPct:(ed168-ed168p3)*100,
    btcEma168DistancePct:f.btcEma168Distance*100,greenBars3:green,bodyReturn3Pct:body*100,failedLongGateCount:failed,
    shortSignal:rows[i].shortSignal?1:0,shortSetupActive:rows[i].shortSetupActive?1:0,shortSetupArmed:rows[i].shortSetupArmed?1:0,longRaw:rows[i].longRaw?1:0,longSignal:rows[i].longSignal?1:0,
  };
}
function maeUntil(rows:PenguDualLsV2EvaluationRow[],entryIndex:number,lastIndex:number,entryPrice:number){let low=entryPrice;for(let j=entryIndex;j<=lastIndex;j++)low=Math.min(low,rows[j].candle.low);return safeRet(low,entryPrice)*100;}
function findTargetTs(rows:PenguDualLsV2EvaluationRow[],entryIndex:number,lastIndex:number,troughClose:number,targetPct:number){const level=troughClose*(1+targetPct/100);for(let j=entryIndex;j<=lastIndex;j++)if(rows[j].candle.close>=level)return j;return -1;}
function eventInWave(e:RecoveryEvent,w:any){return e.signalTs>=w.troughTs&&e.signalTs<=w.peakTs;}
function buildRecoveryEvents(rows:PenguDualLsV2EvaluationRow[],v64Trades:RichTrade[]){
  const missed8=directionalUpWaves(rows,8,v64Trades).filter(w=>!w.longOverlap),missed10=directionalUpWaves(rows,10,v64Trades).filter(w=>!w.longOverlap);
  const out:RecoveryEvent[]=[];const lastByTrigger:Record<string,number>={};
  for(let i=Math.max(250,RECOVERY_LOOKBACK);i<rows.length-2;i++){
    const f=rows[i].features;if(!f||f.referenceTs<EVAL_START||f.referenceTs>=EVAL_END)continue;
    const troughIndex=rollingCloseMinIndex(rows,i,RECOVERY_LOOKBACK);if(troughIndex<0)continue;const troughClose=rows[troughIndex].candle.close,troughAge=i-troughIndex;if(troughAge<1||troughAge>RECOVERY_MAX_TROUGH_AGE)continue;
    for(const trigger of RECOVERY_TRIGGERS){const level=troughClose*(1+trigger/100);if(rows[i-1].candle.close>=level||rows[i].candle.close<level)continue;if(i-(lastByTrigger[String(trigger)]??-9999)<6)continue;lastByTrigger[String(trigger)]=i;
      const entryIndex=i+1,entry=rows[entryIndex].candle,last=Math.min(rows.length-1,entryIndex+RECOVERY_LABEL_HORIZON-1);let maxClose=entry.open,maxHigh=entry.open,minLow=entry.open;
      for(let j=entryIndex;j<=last;j++){maxClose=Math.max(maxClose,rows[j].candle.close);maxHigh=Math.max(maxHigh,rows[j].candle.high);minLow=Math.min(minLow,rows[j].candle.low);}
      const t8i=findTargetTs(rows,entryIndex,last,troughClose,8),t10i=findTargetTs(rows,entryIndex,last,troughClose,10);
      const dummy:any={triggerPct:trigger,signalIndex:i,signalTs:rows[i].candle.openTime,entryIndex,entryTs:entry.openTime,entryPrice:entry.open,troughIndex,troughTs:rows[troughIndex].candle.openTime,troughClose,troughAgeHours:troughAge,fold:recoveryFold(entry.openTime),coverage:opportunityCoverage(entry.openTime,v64Trades),target8:t8i>=0,target10:t10i>=0,target8Ts:t8i>=0?rows[t8i].candle.openTime:null,target10Ts:t10i>=0?rows[t10i].candle.openTime:null,maxClose96PctFromTrough:safeRet(maxClose,troughClose)*100,entryMfe96Pct:safeRet(maxHigh,entry.open)*100,entryMae96Pct:safeRet(minLow,entry.open)*100,entryMaeTo8Pct:t8i>=0?maeUntil(rows,entryIndex,t8i,entry.open):null,entryMaeTo10Pct:t10i>=0?maeUntil(rows,entryIndex,t10i,entry.open):null,inMissed8Wave:false,inMissed10Wave:false,shortOverlap8Wave:false,shortOverlap10Wave:false,features:recoveryFeatures(rows,i,troughIndex,troughClose,trigger)};
      const w8=missed8.find(w=>eventInWave(dummy,w)),w10=missed10.find(w=>eventInWave(dummy,w));dummy.inMissed8Wave=Boolean(w8);dummy.inMissed10Wave=Boolean(w10);dummy.shortOverlap8Wave=Boolean(w8?.shortOverlap);dummy.shortOverlap10Wave=Boolean(w10?.shortOverlap);out.push(dummy as RecoveryEvent);
    }
  }
  return out;
}
function eventStats(events:RecoveryEvent[],label:"target8"|"target10"){
  const yes=events.filter(e=>e[label]),no=events.filter(e=>!e[label]);
  const featureKeys=Object.keys(events[0]?.features??{});const sep:any={};
  for(const k of featureKeys){const y=yes.map(e=>e.features[k]).filter(Number.isFinite),n=no.map(e=>e.features[k]).filter(Number.isFinite);if(!y.length||!n.length)continue;const ym=meanNumber(y),nm=meanNumber(n),all=[...y,...n],am=meanNumber(all),sd=Math.sqrt(meanNumber(all.map(v=>(v-am)*(v-am))));sep[k]={yesP50:quantileNumber(y,.5),noP50:quantileNumber(n,.5),medianGap:(quantileNumber(y,.5)??0)-(quantileNumber(n,.5)??0),standardizedMeanGap:sd>1e-12?(ym-nm)/sd:null};}
  return {count:events.length,success:yes.length,fake:no.length,successRatePct:events.length?yes.length/events.length*100:0,successEntryMfe96:numericDist(yes.map(e=>e.entryMfe96Pct)),fakeEntryMfe96:numericDist(no.map(e=>e.entryMfe96Pct)),successEntryMae96:numericDist(yes.map(e=>e.entryMae96Pct)),fakeEntryMae96:numericDist(no.map(e=>e.entryMae96Pct)),featureSeparation:sep};
}
function compactRecoveryEvent(e:RecoveryEvent){return {...e,signalTs:new Date(e.signalTs).toISOString(),entryTs:new Date(e.entryTs).toISOString(),troughTs:new Date(e.troughTs).toISOString(),target8Ts:e.target8Ts?new Date(e.target8Ts).toISOString():null,target10Ts:e.target10Ts?new Date(e.target10Ts).toISOString():null};}
function analyzeRecoveryStudy(rows:PenguDualLsV2EvaluationRow[],v64Trades:RichTrade[]){const events=buildRecoveryEvents(rows,v64Trades),byTrigger:any={};for(const t of RECOVERY_TRIGGERS){const et=events.filter(e=>e.triggerPct===t),folds:any={};for(const fold of ["FOLD1","FOLD2","FOLD3"] as const){const ef=et.filter(e=>e.fold===fold);folds[fold]={target8:eventStats(ef,"target8"),target10:eventStats(ef,"target10"),missed8Wave:ef.filter(e=>e.inMissed8Wave).length,missed10Wave:ef.filter(e=>e.inMissed10Wave).length,shortConflict8Wave:ef.filter(e=>e.shortOverlap8Wave).length,shortConflict10Wave:ef.filter(e=>e.shortOverlap10Wave).length};}byTrigger[String(t)]={all:{target8:eventStats(et,"target8"),target10:eventStats(et,"target10"),missed8Wave:et.filter(e=>e.inMissed8Wave).length,missed10Wave:et.filter(e=>e.inMissed10Wave).length,byCoverage:Object.fromEntries((["FREE_MISSED","SHORT_CONFLICT","LONG_ALREADY_CAPTURED"] as const).map(c=>[c,et.filter(e=>e.coverage===c).length]))},folds};}
  return {schema:"pengu-recovery-study/v1",causality:{candidateGeneration:"signal bar and prior bars only; 72h rolling close trough; first close crossing +2/+3/+5%; trough age <=48h; repeated same-trigger events >=6h apart",entry:"next 1h open",labels:"future 96h close path is used only for target8/target10 labels; no future feature enters candidate generation",targetDefinition:"future close reaches 8% or 10% above identified trough within 96h",featureTiming:"all features computed no later than signal close"},parameters:{lookbackHours:RECOVERY_LOOKBACK,maxTroughAgeHours:RECOVERY_MAX_TROUGH_AGE,labelHorizonHours:RECOVERY_LABEL_HORIZON,triggersPct:RECOVERY_TRIGGERS},byTrigger,events:events.map(compactRecoveryEvent),safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};}
'''
if marker not in src:
    raise SystemExit('longDiagnostics marker missing for recovery study')
src = src.replace(marker, insert + marker, 1)
old = '  analysis.directionalWaves=analyzeDirectionalWaves(rows,v64Trades);'
new = '  analysis.directionalWaves=analyzeDirectionalWaves(rows,v64Trades);\n  analysis.recoveryStudy=analyzeRecoveryStudy(rows,v64Trades);'
if old not in src:
    raise SystemExit('directional analysis assignment missing for recovery study')
src = src.replace(old, new, 1)
TARGET.write_text(src)
print(f'PATCHED_RECOVERY_STUDY={TARGET}')
