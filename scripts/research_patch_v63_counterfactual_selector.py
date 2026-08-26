from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

old='type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL";'
new='type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V63_SELECTOR_TOP1" | "V63_SELECTOR_TOP2";'
if old not in src: raise SystemExit('LongMode marker missing')
src=src.replace(old,new,1)

marker='\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert=r'''
type V63FeatureName =
  | "penguReturn72h" | "penguReturn24h" | "relativeReturn24h" | "btcReturn24h"
  | "rsi14" | "volumeRatio6OverPrior36" | "atr24Ratio"
  | "ema72Distance" | "ema168Distance" | "breakoutDistance"
  | "momentumResetFlag" | "contractionFlag";
type V63Rule = { feature:V63FeatureName; op:"gte"|"lte"; threshold:number; separation:number; winnerMedian:number; loserMedian:number };
const v63Modes:LongMode[]=["V63_SELECTOR_TOP1","V63_SELECTOR_TOP2"];
let v63RulesByMode:Record<string,V63Rule[]>={};

function v63TrendBackbone(row:PenguDualLsV2EvaluationRow) {
  const f=row.features; if(!f) return false;
  const r=PENGU_DUAL_LS_V2.long;
  return f.penguReturn72h>=r.regimeReturn72hMinimum && f.close>f.ema168 && f.ema72>f.ema168
    && f.relativeReturn24h>=r.relativeReturn24hMinimum && f.btcReturn24h>=r.btcReturn24hMinimum
    && f.rsi14>=r.rsiMinimum && f.rsi14<=r.rsiMaximum
    && f.volumeRatio6OverPrior36>=r.volumeRatioMinimum && f.volumeRatio6OverPrior36<=r.volumeRatioMaximum
    && f.atr24Ratio<=r.atr24RatioMaximum;
}
function v63MomentumResetRaw(rows:PenguDualLsV2EvaluationRow[],index:number) {
  if(index<1) return false;
  const f=rows[index].features,p=rows[index-1].features; if(!f||!p||!v63TrendBackbone(rows[index])) return false;
  if(longRawForMode(rows[index],"V57_REGIME72_BREAKOUT")) return false;
  const r=PENGU_DUAL_LS_V2.long;
  return p.penguReturn24h<r.penguReturn24hMinimum && f.penguReturn24h>=0 && f.close>p.high && f.close>f.ema72;
}
function v63ContractionRaw(rows:PenguDualLsV2EvaluationRow[],index:number) {
  if(index<3) return false;
  const f=rows[index].features,p1=rows[index-1].features,p2=rows[index-2].features,p3=rows[index-3].features;
  if(!f||!p1||!p2||!p3||!v63TrendBackbone(rows[index])) return false;
  if(longRawForMode(rows[index],"V57_REGIME72_BREAKOUT")) return false;
  const r1=p1.high-p1.low,r2=p2.high-p2.low,r3=p3.high-p3.low;
  return r3>=r2 && r2>=r1 && f.close>Math.max(p1.high,p2.high,p3.high) && f.close>f.ema72 && f.penguReturn24h>0;
}
function v63RescueBaseRaw(rows:PenguDualLsV2EvaluationRow[],index:number) {
  return v63MomentumResetRaw(rows,index)||v63ContractionRaw(rows,index);
}
function v63RescueBaseEdge(rows:PenguDualLsV2EvaluationRow[],index:number) {
  const cur=v63RescueBaseRaw(rows,index),prev=index>0?v63RescueBaseRaw(rows,index-1):false;
  return cur&&!prev;
}
function v63FeatureValue(rows:PenguDualLsV2EvaluationRow[],index:number,feature:V63FeatureName) {
  const f=rows[index].features!;
  switch(feature) {
    case "ema72Distance": return f.close/Math.max(1e-12,f.ema72)-1;
    case "ema168Distance": return f.close/Math.max(1e-12,f.ema168)-1;
    case "breakoutDistance": return f.close/Math.max(1e-12,f.priorHigh18h)-1;
    case "momentumResetFlag": return v63MomentumResetRaw(rows,index)?1:0;
    case "contractionFlag": return v63ContractionRaw(rows,index)?1:0;
    default: return Number(f[feature]);
  }
}
const v63FeatureNames:V63FeatureName[]=["penguReturn72h","penguReturn24h","relativeReturn24h","btcReturn24h","rsi14","volumeRatio6OverPrior36","atr24Ratio","ema72Distance","ema168Distance","breakoutDistance","momentumResetFlag","contractionFlag"];
function v63RulePass(rows:PenguDualLsV2EvaluationRow[],index:number,rule:V63Rule) {
  const value=v63FeatureValue(rows,index,rule.feature);
  return rule.op==="gte"?value>=rule.threshold:value<=rule.threshold;
}
function v63SelectorPass(rows:PenguDualLsV2EvaluationRow[],index:number,mode:LongMode) {
  const rules=v63RulesByMode[String(mode)]??[];
  return rules.length>0 && rules.every(rule=>v63RulePass(rows,index,rule));
}
function v63SelectedRescueEdge(rows:PenguDualLsV2EvaluationRow[],index:number,mode:LongMode) {
  return v63RescueBaseEdge(rows,index)&&v63SelectorPass(rows,index,mode);
}
function v63NativeEdge(rows:PenguDualLsV2EvaluationRow[],index:number) {
  const cur=longRawForMode(rows[index],"V57_REGIME72_BREAKOUT");
  const prev=index>0?longRawForMode(rows[index-1],"V57_REGIME72_BREAKOUT"):false;
  return cur&&!prev;
}
function v63SignalForMode(rows:PenguDualLsV2EvaluationRow[],index:number,mode:LongMode) {
  if(v63NativeEdge(rows,index)) return true;
  if(longRawForMode(rows[index],"V57_REGIME72_BREAKOUT")) return false;
  return v63SelectedRescueEdge(rows,index,mode);
}

function simulateV63Opportunity(rows:PenguDualLsV2EvaluationRow[],index:number,funding:FundingPoint[]) {
  const entryIndex=index+1; if(entryIndex>=rows.length) return null;
  const entry=rows[entryIndex].candle; const last=Math.min(rows.length-1,entryIndex+36-1);
  let highWater=entry.open,exitIndex=last,exitPrice=rows[last].candle.close,reason="time";
  for(let cursor=entryIndex;cursor<=last;cursor+=1) {
    const f=rows[cursor].features; if(!f) return null;
    const hard=entry.open*0.96;
    if(f.low<=hard) {exitIndex=cursor;exitPrice=hard;reason="hard";break;}
    const armed=highWater/entry.open-1>=0.05;
    const trail=highWater*0.98;
    if(armed&&f.low<=trail) {exitIndex=cursor;exitPrice=trail;reason="trail";break;}
    highWater=Math.max(highWater,f.high);
  }
  const exitTs=rows[exitIndex].candle.openTime;
  const raw=exitPrice/entry.open-1;
  const fundingUnit=-fundingBetween(funding,entry.openTime,exitTs);
  const net=raw+fundingUnit-2*BASE_FEE_PER_SIDE;
  return {signalTs:rows[index].candle.openTime,entryTs:entry.openTime,exitTs,accountReturn:0.375*net,reason};
}
function deriveV63Selectors(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[]) {
  const opportunities:Array<{index:number;accountReturn:number;reason:string;features:Record<string,number>}>=[];
  for(let index=250;index<rows.length-2;index+=1) {
    const ts=rows[index].candle.openTime;
    if(ts<EVAL_START||ts>=HOLDOUT_CUTOFF||!v63RescueBaseEdge(rows,index)) continue;
    const sim=simulateV63Opportunity(rows,index,funding); if(!sim||sim.entryTs>=HOLDOUT_CUTOFF) continue;
    const features=Object.fromEntries(v63FeatureNames.map(name=>[name,v63FeatureValue(rows,index,name)])) as Record<string,number>;
    opportunities.push({index,accountReturn:sim.accountReturn,reason:sim.reason,features});
  }
  const winners=opportunities.filter(x=>x.accountReturn>0),losers=opportunities.filter(x=>x.accountReturn<=0);
  if(opportunities.length<6||!winners.length||!losers.length) return {opportunities,winners:winners.length,losers:losers.length,rules:[],rulesByMode:{}};
  const rules:V63Rule[]=[];
  for(const feature of v63FeatureNames) {
    const win=winners.map(x=>x.features[feature]).filter(Number.isFinite),lose=losers.map(x=>x.features[feature]).filter(Number.isFinite);
    const wm=quantile(win,.5),lm=quantile(lose,.5); if(wm===null||lm===null) continue;
    const all=opportunities.map(x=>x.features[feature]).filter(Number.isFinite);
    const lo=Math.min(...all),hi=Math.max(...all),range=Math.max(1e-12,hi-lo);
    if(Math.abs(wm-lm)<1e-12) continue;
    rules.push({feature,op:wm>lm?"gte":"lte",threshold:(wm+lm)/2,separation:Math.abs(wm-lm)/range,winnerMedian:wm,loserMedian:lm});
  }
  rules.sort((a,b)=>b.separation-a.separation||a.feature.localeCompare(b.feature));
  const top1=rules.slice(0,1),top2=rules.slice(0,2);
  const rulesByMode:Record<string,V63Rule[]>={V63_SELECTOR_TOP1:top1,V63_SELECTOR_TOP2:top2};
  return {opportunities,winners:winners.length,losers:losers.length,rules:rules.slice(0,8),rulesByMode};
}

function evaluateV63(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],baselineV56Normal:RichTrade[]) {
  const d=deriveV57Thresholds(baselineV56Normal); v57Thresholds=d.thresholds;
  const selector=deriveV63Selectors(rows,funding); v63RulesByMode=selector.rulesByMode;
  const incN=replay(rows,funding,{mode:"normal",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const incS=replay(rows,funding,{mode:"stress",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const sl=(x:RichTrade[],side:Side|undefined,a:number,b:number)=>sliceByTime(side?x.filter(t=>t.side===side):x,a,b);
  const bLT=sl(incN,"L",EVAL_START,HOLDOUT_CUTOFF),bAT=sl(incN,undefined,EVAL_START,HOLDOUT_CUTOFF),bLH=sl(incN,"L",HOLDOUT_CUTOFF,EVAL_END),bAH=sl(incN,undefined,HOLDOUT_CUTOFF,EVAL_END),bLSH=sl(incS,"L",HOLDOUT_CUTOFF,EVAL_END),bASH=sl(incS,undefined,HOLDOUT_CUTOFF,EVAL_END);
  const base={longTrain:metrics(bLT),allTrain:metrics(bAT),longHoldout:metrics(bLH),allHoldout:metrics(bAH),longStressHoldout:metrics(bLSH),allStressHoldout:metrics(bASH),fullNormal:metrics(incN),fullStress:metrics(incS)};
  const winners=bLT.filter(t=>t.accountReturn>0);
  const candidates=v63Modes.filter(mode=>(v63RulesByMode[String(mode)]??[]).length>0).map(mode=>{
    const n=replay(rows,funding,{mode:"normal",longMode:mode}).trades,s=replay(rows,funding,{mode:"stress",longMode:mode}).trades;
    const lt=sl(n,"L",EVAL_START,HOLDOUT_CUTOFF),at=sl(n,undefined,EVAL_START,HOLDOUT_CUTOFF),lh=sl(n,"L",HOLDOUT_CUTOFF,EVAL_END),ah=sl(n,undefined,HOLDOUT_CUTOFF,EVAL_END),lsh=sl(s,"L",HOLDOUT_CUTOFF,EVAL_END),ash=sl(s,undefined,HOLDOUT_CUTOFF,EVAL_END);
    const audit=winnerReplacementAudit(winners,lt),ids=new Set(lt.map(t=>t.signalTs));
    const exact=winners.every(t=>ids.has(t.signalTs));
    const economic=exact||audit.replacements.every(x=>x.replacementAccountReturn!==null&&x.replacementAccountReturn+1e-12>=x.baselineAccountReturn);
    const m={longTrain:metrics(lt),allTrain:metrics(at),longHoldout:metrics(lh),allHoldout:metrics(ah),longStressHoldout:metrics(lsh),allStressHoldout:metrics(ash),fullNormal:metrics(n),fullStress:metrics(s)};
    const trainingEligible=economic&&m.longTrain.trades>=base.longTrain.trades+2&&m.longTrain.returnPct>base.longTrain.returnPct+1e-9&&pfAtLeast(m.longTrain,base.longTrain,.95)&&m.longTrain.maxDrawdownPct>=base.longTrain.maxDrawdownPct-.75&&m.allTrain.returnPct>base.allTrain.returnPct+1e-9&&pfAtLeast(m.allTrain,base.allTrain,.98)&&m.allTrain.maxDrawdownPct>=base.allTrain.maxDrawdownPct-.75;
    return {mode,rules:v63RulesByMode[String(mode)],economicallyPreserves:economic,replacementAudit:audit,trainingEligible,metrics:m,deltas:{longTrainTrades:m.longTrain.trades-base.longTrain.trades,longTrainReturnPct:m.longTrain.returnPct-base.longTrain.returnPct,allTrainReturnPct:m.allTrain.returnPct-base.allTrain.returnPct,longHoldoutTrades:m.longHoldout.trades-base.longHoldout.trades,longHoldoutReturnPct:m.longHoldout.returnPct-base.longHoldout.returnPct,fullLongTrades:m.fullNormal.longTrades-base.fullNormal.longTrades,fullNormalReturnPct:m.fullNormal.returnPct-base.fullNormal.returnPct,fullStressReturnPct:m.fullStress.returnPct-base.fullStress.returnPct}};
  });
  const eligible=candidates.filter(x=>x.trainingEligible).sort((a,b)=>b.deltas.allTrainReturnPct-a.deltas.allTrainReturnPct||b.deltas.longTrainReturnPct-a.deltas.longTrainReturnPct);
  const selected=eligible[0]??null;
  if(!selected)return{schema:"pengu-v63-counterfactual-selector/v1",incumbentMode:"V57_REGIME72_BREAKOUT",selector:{opportunityCount:selector.opportunities.length,winners:selector.winners,losers:selector.losers,topRules:selector.rules,rulesByMode:selector.rulesByMode},baseline:base,candidates,selectedMode:null,trainingSelectionPass:false,frequencyImproves:false,frequencyGoalPass:false,normalHoldoutPositive:false,stressHoldoutPositive:false,stressRobust:false,fullNormalImproves:false,strictPass:false,decision:"KEEP_V57_RESEARCH_CANDIDATE",reason:"Train-only selector found no sequential candidate that beat V57 under PF/DD guards."};
  const m=selected.metrics;
  const frequencyImproves=m.fullNormal.longTrades>base.fullNormal.longTrades,frequencyGoalPass=m.fullNormal.longTrades>=20;
  const normalHoldoutPositive=m.longHoldout.trades>base.longHoldout.trades&&m.longHoldout.returnPct>base.longHoldout.returnPct+1e-9&&m.allHoldout.returnPct>base.allHoldout.returnPct+1e-9&&pfAtLeast(m.allHoldout,base.allHoldout,.95)&&m.allHoldout.maxDrawdownPct>=base.allHoldout.maxDrawdownPct-.75;
  const stressHoldoutPositive=m.longStressHoldout.trades>base.longStressHoldout.trades&&m.longStressHoldout.returnPct>base.longStressHoldout.returnPct+1e-9&&m.allStressHoldout.returnPct>base.allStressHoldout.returnPct+1e-9&&pfAtLeast(m.allStressHoldout,base.allStressHoldout,.95)&&m.allStressHoldout.maxDrawdownPct>=base.allStressHoldout.maxDrawdownPct-.75;
  const stressRobust=m.fullStress.returnPct>=base.fullStress.returnPct-1e-9&&pfAtLeast(m.fullStress,base.fullStress,.98)&&m.fullStress.maxDrawdownPct>=base.fullStress.maxDrawdownPct-.75;
  const fullNormalImproves=m.fullNormal.returnPct>base.fullNormal.returnPct+1e-9&&pfAtLeast(m.fullNormal,base.fullNormal,.98)&&m.fullNormal.maxDrawdownPct>=base.fullNormal.maxDrawdownPct-.75;
  const strictPass=frequencyImproves&&normalHoldoutPositive&&stressHoldoutPositive&&stressRobust&&fullNormalImproves;
  return{schema:"pengu-v63-counterfactual-selector/v1",incumbentMode:"V57_REGIME72_BREAKOUT",selector:{opportunityCount:selector.opportunities.length,winners:selector.winners,losers:selector.losers,topRules:selector.rules,rulesByMode:selector.rulesByMode},baseline:base,candidates,selectedMode:selected.mode,selectedByTrainingOnly:true,selectedTraining:selected,trainingSelectionPass:true,frequencyImproves,frequencyGoalPass,normalHoldoutPositive,stressHoldoutPositive,stressRobust,fullNormalImproves,strictPass,decision:strictPass?"ADOPT_V63_RESEARCH_CANDIDATE":"KEEP_V57_RESEARCH_CANDIDATE",reason:strictPass?"Train-only selector survived untouched Normal/Stress holdout.":"Training-selected selector failed untouched holdout or robustness."};
}
'''
if marker not in src: raise SystemExit('diagnostic marker missing')
src=src.replace(marker,insert+marker,1)

raw_old='''  if (mode === "V57_REGIME72_DUAL") return relativeStrong && breakoutStrong;\n  return false;'''
raw_new='''  if (mode === "V57_REGIME72_DUAL") return relativeStrong && breakoutStrong;\n  if (v63Modes.includes(mode)) return row.longRaw;\n  return false;'''
if raw_old not in src: raise SystemExit('raw marker missing')
src=src.replace(raw_old,raw_new,1)
sig_old='''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {\n  if (mode === "EDGE") return rows[index].longSignal;\n  if (mode === "RAW_REENTRY") return rows[index].longRaw;\n  const current = longRawForMode(rows[index], mode);\n  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;\n  return current && !previous;\n}'''
sig_new='''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {\n  if (mode === "EDGE") return rows[index].longSignal;\n  if (mode === "RAW_REENTRY") return rows[index].longRaw;\n  if (v63Modes.includes(mode)) return v63SignalForMode(rows,index,mode);\n  const current = longRawForMode(rows[index], mode);\n  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;\n  return current && !previous;\n}'''
if sig_old not in src: raise SystemExit('signal marker missing')
src=src.replace(sig_old,sig_new,1)

gross_old='    const requestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);'
gross_new='''    const baseRequestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);\n    const rescueEntry = side === "L" && v63Modes.includes(options.longMode) && v63SelectedRescueEdge(rows,index,options.longMode) && !v63NativeEdge(rows,index);\n    const requestedGross = rescueEntry ? Math.min(baseRequestedGross,0.375) : baseRequestedGross;'''
if gross_old not in src: raise SystemExit('gross marker missing')
src=src.replace(gross_old,gross_new,1)
hold_old='''    const initialShortState = position.shortV20 ? { ...position.shortV20 } : undefined;\n    const hold = side === "L" ? PENGU_DUAL_LS_V2.long.maxHoldHours : PENGU_DUAL_LS_V2.short.maxHoldHours;\n    const last = Math.min(rows.length - 1, entryIndex + hold - 1);\n    let exitIndex = last;\n    let exitPrice = rows[last].candle.close;\n    let engineExitReason = side === "L" ? "LONG_MAX_HOLD" : "SHORT_MAX_HOLD";'''
hold_new='''    const initialShortState = position.shortV20 ? { ...position.shortV20 } : undefined;\n    const hold = rescueEntry ? 36 : side === "L" ? PENGU_DUAL_LS_V2.long.maxHoldHours : PENGU_DUAL_LS_V2.short.maxHoldHours;\n    const last = Math.min(rows.length - 1, entryIndex + hold - 1);\n    let exitIndex = last;\n    let exitPrice = rows[last].candle.close;\n    let engineExitReason = rescueEntry ? "V63_RESCUE_MAX_HOLD" : side === "L" ? "LONG_MAX_HOLD" : "SHORT_MAX_HOLD";'''
if hold_old not in src: raise SystemExit('hold marker missing')
src=src.replace(hold_old,hold_new,1)
eval_old='''      const evaluation = evaluatePenguDualLsV2PositionBar(position, f);\n      position = evaluation.updatedPosition;\n      if (evaluation.exit) {\n        exitIndex = cursor;\n        exitPrice = evaluation.exit.stopPrice ?? rows[cursor].candle.close;\n        engineExitReason = evaluation.exit.reason;\n        exitReason = evaluation.exit.reason.includes("HARD") ? "hard" : evaluation.exit.reason.includes("TRAILING") ? "trail" : "time";\n        break;\n      }'''
eval_new='''      if (rescueEntry && side === "L") {\n        const hardPrice=entry.open*0.96;\n        const previousBest=Math.max(entry.open,position.highWaterMark);\n        if(f.low<=hardPrice) {exitIndex=cursor;exitPrice=hardPrice;engineExitReason="V63_RESCUE_HARD_STOP";exitReason="hard";break;}\n        const armed=previousBest/entry.open-1>=0.05;\n        const trailPrice=previousBest*0.98;\n        if(armed&&f.low<=trailPrice) {exitIndex=cursor;exitPrice=trailPrice;engineExitReason="V63_RESCUE_TRAILING_STOP";exitReason="trail";break;}\n        position={...position,highWaterMark:Math.max(previousBest,f.high),lowWaterMark:Math.min(position.lowWaterMark,f.low)};\n      } else {\n        const evaluation = evaluatePenguDualLsV2PositionBar(position, f);\n        position = evaluation.updatedPosition;\n        if (evaluation.exit) {\n          exitIndex = cursor;\n          exitPrice = evaluation.exit.stopPrice ?? rows[cursor].candle.close;\n          engineExitReason = evaluation.exit.reason;\n          exitReason = evaluation.exit.reason.includes("HARD") ? "hard" : evaluation.exit.reason.includes("TRAILING") ? "trail" : "time";\n          break;\n        }\n      }'''
if eval_old not in src: raise SystemExit('eval marker missing')
src=src.replace(eval_old,eval_new,1)

start=src.index('  const v57 = evaluateV57Conditional('); end=src.index('\n}\n\nmain().catch',start)
tail=r'''  const d=deriveV57Thresholds(baselineNormal); v57Thresholds=d.thresholds;
  const v63=evaluateV63(rows,funding,baselineNormal);
  const selectedMode=(v63.selectedMode??"V57_REGIME72_BREAKOUT") as LongMode;
  const selectedNormal=replay(rows,funding,{mode:"normal",longMode:selectedMode}).trades,selectedStress=replay(rows,funding,{mode:"stress",longMode:selectedMode}).trades;
  const incumbentNormal=replay(rows,funding,{mode:"normal",longMode:"V57_REGIME72_BREAKOUT"}).trades,incumbentStress=replay(rows,funding,{mode:"stress",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const resultPayload={status:"PASS_RESEARCH_ONLY",period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true},source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},longDiagnostics:longDiag,v63,final:{promoted:v63.strictPass,longMode:v63.strictPass?selectedMode:"V57_REGIME72_BREAKOUT",normal:metrics(v63.strictPass?selectedNormal:incumbentNormal),stress:metrics(v63.strictPass?selectedStress:incumbentStress)},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  const baseLedger={schema:"pengu-dual-ls-v2-aster-ledger/v1",strategyId:PENGU_DUAL_LS_V2.id,shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",currentProductionSourceSha:SOURCE_SHA,researchOnly:true,period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},data:{penguRows:pengu.length,btcRows:btc.length,fundingRows:funding.length,availableStart:new Date(pengu[0].openTime).toISOString(),availableEndExclusive:new Date(pengu.at(-1)!.openTime+HOUR).toISOString(),requestedStart:new Date(EVAL_START).toISOString(),requestedEndExclusive:new Date(EVAL_END).toISOString(),coverageNote:"No pre-listing PENGU data is synthesized."},safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  const candidate={...baseLedger,longVariant:`PENGU_DUAL_LS_V2_FINAL_${selectedMode}`,researchCandidate:{promoted:v63.strictPass,longMode:selectedMode,shortVeto:null,diagnosticsSchema:"pengu-v63-counterfactual-selector/v1"},integrity:{noOverlap:selectedNormal.every((t,i)=>i===0||t.entryTs>selectedNormal[i-1].exitTs),maximumRequestedGross:Math.max(...selectedNormal.map(t=>t.requestedGross))},modes:{normal:{metrics:metrics(selectedNormal),trades:selectedNormal.map(publicTrade)},stress:{metrics:metrics(selectedStress),trades:selectedStress.map(publicTrade)}}};
  const incumbent={...baseLedger,longVariant:"PENGU_DUAL_LS_V2_FINAL_V57_REGIME72_BREAKOUT",researchCandidate:{promoted:false,longMode:"V57_REGIME72_BREAKOUT",shortVeto:null,diagnosticsSchema:"pengu-v63-incumbent-v57/v1"},integrity:{noOverlap:incumbentNormal.every((t,i)=>i===0||t.entryTs>incumbentNormal[i-1].exitTs),maximumRequestedGross:Math.max(...incumbentNormal.map(t=>t.requestedGross))},modes:{normal:{metrics:metrics(incumbentNormal),trades:incumbentNormal.map(publicTrade)},stress:{metrics:metrics(incumbentStress),trades:incumbentStress.map(publicTrade)}}};
  assert.equal(candidate.integrity.noOverlap,true); assert.equal(incumbent.integrity.noOverlap,true);
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v63-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"candidate-pengu-ledger.json"),JSON.stringify(candidate,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"incumbent-v57-pengu-ledger.json"),JSON.stringify(incumbent,null,2)+"\n","utf8");
  console.log("V63_RESULT="+JSON.stringify({decision:v63.decision,selectedMode:v63.selectedMode,trainingSelectionPass:v63.trainingSelectionPass,frequencyImproves:v63.frequencyImproves,frequencyGoalPass:v63.frequencyGoalPass,normalHoldoutPositive:v63.normalHoldoutPositive,stressHoldoutPositive:v63.stressHoldoutPositive,stressRobust:v63.stressRobust,fullNormalImproves:v63.fullNormalImproves,strictPass:v63.strictPass,selector:v63.selector},null,2));
'''
src=src[:start]+tail+src[end:]
TARGET.write_text(src)
print(f'PATCHED_V63={TARGET} bytes={TARGET.stat().st_size}')
