from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

old='type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL";'
modes=[
'V62_MOMENTUM_RESET_FAST','V62_MOMENTUM_RESET_BALANCED','V62_MOMENTUM_RESET_WIDE',
'V62_CONTRACTION_FAST','V62_CONTRACTION_BALANCED','V62_CONTRACTION_WIDE',
'V62_RESET_OR_CONTRACTION_FAST','V62_RESET_OR_CONTRACTION_BALANCED','V62_RESET_OR_CONTRACTION_WIDE']
new='type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | ' + ' | '.join(f'"{m}"' for m in modes) + ';'
if old not in src: raise SystemExit('LongMode marker missing')
src=src.replace(old,new,1)

marker='\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert=r'''
const v62Modes: LongMode[] = [
  "V62_MOMENTUM_RESET_FAST","V62_MOMENTUM_RESET_BALANCED","V62_MOMENTUM_RESET_WIDE",
  "V62_CONTRACTION_FAST","V62_CONTRACTION_BALANCED","V62_CONTRACTION_WIDE",
  "V62_RESET_OR_CONTRACTION_FAST","V62_RESET_OR_CONTRACTION_BALANCED","V62_RESET_OR_CONTRACTION_WIDE",
];
type V62Family = "MOMENTUM_RESET" | "CONTRACTION" | "RESET_OR_CONTRACTION";
type V62ExitName = "FAST" | "BALANCED" | "WIDE";
interface V62ExitProfile { name:V62ExitName; hard:number; activation:number; retrace:number; hold:number }
const v62ExitProfiles: Record<V62ExitName,V62ExitProfile> = {
  FAST:{name:"FAST",hard:0.04,activation:0.05,retrace:0.02,hold:36},
  BALANCED:{name:"BALANCED",hard:0.05,activation:0.07,retrace:0.025,hold:48},
  WIDE:{name:"WIDE",hard:0.06,activation:0.08,retrace:0.025,hold:72},
};
function v62Spec(mode:LongMode) {
  const text=String(mode);
  if(!text.startsWith("V62_")) return null;
  const exitName=(text.endsWith("_FAST")?"FAST":text.endsWith("_BALANCED")?"BALANCED":"WIDE") as V62ExitName;
  const family=(text.includes("RESET_OR_CONTRACTION")?"RESET_OR_CONTRACTION":text.includes("MOMENTUM_RESET")?"MOMENTUM_RESET":"CONTRACTION") as V62Family;
  return {family,profile:v62ExitProfiles[exitName]};
}
function v62TrendBackbone(row:PenguDualLsV2EvaluationRow) {
  const f=row.features; if(!f) return false;
  const r=PENGU_DUAL_LS_V2.long;
  return f.penguReturn72h>=r.regimeReturn72hMinimum && f.close>f.ema168 && f.ema72>f.ema168
    && f.relativeReturn24h>=r.relativeReturn24hMinimum && f.btcReturn24h>=r.btcReturn24hMinimum
    && f.rsi14>=r.rsiMinimum && f.rsi14<=r.rsiMaximum
    && f.volumeRatio6OverPrior36>=r.volumeRatioMinimum && f.volumeRatio6OverPrior36<=r.volumeRatioMaximum
    && f.atr24Ratio<=r.atr24RatioMaximum;
}
function v62MomentumResetRaw(rows:PenguDualLsV2EvaluationRow[],index:number) {
  if(index<1) return false;
  const f=rows[index].features,p=rows[index-1].features; if(!f||!p||!v62TrendBackbone(rows[index])) return false;
  if(longRawForMode(rows[index],"V57_REGIME72_BREAKOUT")) return false;
  const r=PENGU_DUAL_LS_V2.long;
  return p.penguReturn24h<r.penguReturn24hMinimum && f.penguReturn24h>=0 && f.close>p.high && f.close>f.ema72;
}
function v62ContractionRaw(rows:PenguDualLsV2EvaluationRow[],index:number) {
  if(index<3) return false;
  const f=rows[index].features,p1=rows[index-1].features,p2=rows[index-2].features,p3=rows[index-3].features;
  if(!f||!p1||!p2||!p3||!v62TrendBackbone(rows[index])) return false;
  if(longRawForMode(rows[index],"V57_REGIME72_BREAKOUT")) return false;
  const r1=p1.high-p1.low,r2=p2.high-p2.low,r3=p3.high-p3.low;
  return r3>=r2 && r2>=r1 && f.close>Math.max(p1.high,p2.high,p3.high) && f.close>f.ema72 && f.penguReturn24h>0;
}
function v62RescueRaw(rows:PenguDualLsV2EvaluationRow[],index:number,mode:LongMode) {
  const s=v62Spec(mode); if(!s) return false;
  const a=v62MomentumResetRaw(rows,index),b=v62ContractionRaw(rows,index);
  return s.family==="MOMENTUM_RESET"?a:s.family==="CONTRACTION"?b:(a||b);
}
function v62NativeEdge(rows:PenguDualLsV2EvaluationRow[],index:number) {
  const cur=longRawForMode(rows[index],"V57_REGIME72_BREAKOUT");
  const prev=index>0?longRawForMode(rows[index-1],"V57_REGIME72_BREAKOUT"):false;
  return cur&&!prev;
}
function v62SignalForMode(rows:PenguDualLsV2EvaluationRow[],index:number,mode:LongMode) {
  if(v62NativeEdge(rows,index)) return true;
  if(longRawForMode(rows[index],"V57_REGIME72_BREAKOUT")) return false;
  const cur=v62RescueRaw(rows,index,mode),prev=index>0?v62RescueRaw(rows,index-1,mode):false;
  return cur&&!prev;
}
function v62RequestedGross(rows:PenguDualLsV2EvaluationRow[],index:number,mode:LongMode,base:number) {
  if(v62NativeEdge(rows,index)||longRawForMode(rows[index],"V57_REGIME72_BREAKOUT")) return base;
  return v62RescueRaw(rows,index,mode)?Math.min(base,0.375):base;
}
function evaluateV62(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],baselineV56Normal:RichTrade[]) {
  const d=deriveV57Thresholds(baselineV56Normal); v57Thresholds=d.thresholds;
  const incN=replay(rows,funding,{mode:"normal",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const incS=replay(rows,funding,{mode:"stress",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const sl=(x:RichTrade[],side:Side|undefined,a:number,b:number)=>sliceByTime(side?x.filter(t=>t.side===side):x,a,b);
  const bLT=sl(incN,"L",EVAL_START,HOLDOUT_CUTOFF), bAT=sl(incN,undefined,EVAL_START,HOLDOUT_CUTOFF), bLH=sl(incN,"L",HOLDOUT_CUTOFF,EVAL_END), bAH=sl(incN,undefined,HOLDOUT_CUTOFF,EVAL_END), bLSH=sl(incS,"L",HOLDOUT_CUTOFF,EVAL_END), bASH=sl(incS,undefined,HOLDOUT_CUTOFF,EVAL_END);
  const base={longTrain:metrics(bLT),allTrain:metrics(bAT),longHoldout:metrics(bLH),allHoldout:metrics(bAH),longStressHoldout:metrics(bLSH),allStressHoldout:metrics(bASH),fullNormal:metrics(incN),fullStress:metrics(incS)};
  const winners=bLT.filter(t=>t.accountReturn>0);
  const candidates=v62Modes.map(mode=>{
    const n=replay(rows,funding,{mode:"normal",longMode:mode}).trades,s=replay(rows,funding,{mode:"stress",longMode:mode}).trades;
    const lt=sl(n,"L",EVAL_START,HOLDOUT_CUTOFF),at=sl(n,undefined,EVAL_START,HOLDOUT_CUTOFF),lh=sl(n,"L",HOLDOUT_CUTOFF,EVAL_END),ah=sl(n,undefined,HOLDOUT_CUTOFF,EVAL_END),lsh=sl(s,"L",HOLDOUT_CUTOFF,EVAL_END),ash=sl(s,undefined,HOLDOUT_CUTOFF,EVAL_END);
    const audit=winnerReplacementAudit(winners,lt),ids=new Set(lt.map(t=>t.signalTs));
    const exact=winners.every(t=>ids.has(t.signalTs));
    const economic=exact||audit.replacements.every(x=>x.replacementAccountReturn!==null&&x.replacementAccountReturn+1e-12>=x.baselineAccountReturn);
    const m={longTrain:metrics(lt),allTrain:metrics(at),longHoldout:metrics(lh),allHoldout:metrics(ah),longStressHoldout:metrics(lsh),allStressHoldout:metrics(ash),fullNormal:metrics(n),fullStress:metrics(s)};
    const trainingEligible=economic && m.longTrain.trades>base.longTrain.trades && m.longTrain.returnPct>base.longTrain.returnPct+1e-9
      && pfAtLeast(m.longTrain,base.longTrain,0.95) && m.longTrain.maxDrawdownPct>=base.longTrain.maxDrawdownPct-0.75
      && m.allTrain.returnPct>base.allTrain.returnPct+1e-9 && pfAtLeast(m.allTrain,base.allTrain,0.98) && m.allTrain.maxDrawdownPct>=base.allTrain.maxDrawdownPct-0.75;
    return {mode,spec:v62Spec(mode),economicallyPreserves:economic,replacementAudit:audit,trainingEligible,metrics:m,deltas:{longTrainTrades:m.longTrain.trades-base.longTrain.trades,longTrainReturnPct:m.longTrain.returnPct-base.longTrain.returnPct,allTrainReturnPct:m.allTrain.returnPct-base.allTrain.returnPct,longHoldoutTrades:m.longHoldout.trades-base.longHoldout.trades,longHoldoutReturnPct:m.longHoldout.returnPct-base.longHoldout.returnPct,fullLongTrades:m.fullNormal.longTrades-base.fullNormal.longTrades,fullNormalReturnPct:m.fullNormal.returnPct-base.fullNormal.returnPct,fullStressReturnPct:m.fullStress.returnPct-base.fullStress.returnPct}};
  });
  const eligible=candidates.filter(x=>x.trainingEligible).sort((a,b)=>b.deltas.allTrainReturnPct-a.deltas.allTrainReturnPct||b.deltas.longTrainReturnPct-a.deltas.longTrainReturnPct);
  const selected=eligible[0]??null;
  if(!selected)return{schema:"pengu-v62-rescue-exit/v1",incumbentMode:"V57_REGIME72_BREAKOUT",baseline:base,candidates,selectedMode:null,trainingSelectionPass:false,frequencyImproves:false,frequencyGoalPass:false,normalHoldoutPositive:false,stressHoldoutPositive:false,stressRobust:false,fullNormalImproves:false,strictPass:false,decision:"KEEP_V57_RESEARCH_CANDIDATE",reason:"No V62 entry/exit pair improved training under winner/PF/DD guards."};
  const m=selected.metrics;
  const frequencyImproves=m.fullNormal.longTrades>base.fullNormal.longTrades,frequencyGoalPass=m.fullNormal.longTrades>=20;
  const normalHoldoutPositive=m.longHoldout.trades>base.longHoldout.trades&&m.longHoldout.returnPct>base.longHoldout.returnPct+1e-9&&m.allHoldout.returnPct>base.allHoldout.returnPct+1e-9&&pfAtLeast(m.allHoldout,base.allHoldout,0.95)&&m.allHoldout.maxDrawdownPct>=base.allHoldout.maxDrawdownPct-0.75;
  const stressHoldoutPositive=m.longStressHoldout.trades>base.longStressHoldout.trades&&m.longStressHoldout.returnPct>base.longStressHoldout.returnPct+1e-9&&m.allStressHoldout.returnPct>base.allStressHoldout.returnPct+1e-9&&pfAtLeast(m.allStressHoldout,base.allStressHoldout,0.95)&&m.allStressHoldout.maxDrawdownPct>=base.allStressHoldout.maxDrawdownPct-0.75;
  const stressRobust=m.fullStress.returnPct>=base.fullStress.returnPct-1e-9&&pfAtLeast(m.fullStress,base.fullStress,0.98)&&m.fullStress.maxDrawdownPct>=base.fullStress.maxDrawdownPct-0.75;
  const fullNormalImproves=m.fullNormal.returnPct>base.fullNormal.returnPct+1e-9&&pfAtLeast(m.fullNormal,base.fullNormal,0.98)&&m.fullNormal.maxDrawdownPct>=base.fullNormal.maxDrawdownPct-0.75;
  const strictPass=frequencyImproves&&normalHoldoutPositive&&stressHoldoutPositive&&stressRobust&&fullNormalImproves;
  return{schema:"pengu-v62-rescue-exit/v1",incumbentMode:"V57_REGIME72_BREAKOUT",baseline:base,candidates,selectedMode:selected.mode,selectedByTrainingOnly:true,selectedTraining:selected,trainingSelectionPass:true,frequencyImproves,frequencyGoalPass,normalHoldoutPositive,stressHoldoutPositive,stressRobust,fullNormalImproves,strictPass,decision:strictPass?"ADOPT_V62_RESEARCH_CANDIDATE":"KEEP_V57_RESEARCH_CANDIDATE",reason:strictPass?"V62 rescue pair survived untouched holdout/stress.":"Training-selected V62 failed holdout or robustness."};
}
'''
if marker not in src: raise SystemExit('diagnostic marker missing')
src=src.replace(marker,insert+marker,1)

raw_old='''  if (mode === "V57_REGIME72_DUAL") return relativeStrong && breakoutStrong;\n  return false;'''
raw_new='''  if (mode === "V57_REGIME72_DUAL") return relativeStrong && breakoutStrong;\n  if (v62Modes.includes(mode)) return row.longRaw;\n  return false;'''
if raw_old not in src: raise SystemExit('raw tail missing')
src=src.replace(raw_old,raw_new,1)
sig_old='''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {\n  if (mode === "EDGE") return rows[index].longSignal;\n  if (mode === "RAW_REENTRY") return rows[index].longRaw;\n  const current = longRawForMode(rows[index], mode);\n  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;\n  return current && !previous;\n}'''
sig_new='''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {\n  if (mode === "EDGE") return rows[index].longSignal;\n  if (mode === "RAW_REENTRY") return rows[index].longRaw;\n  if (v62Modes.includes(mode)) return v62SignalForMode(rows,index,mode);\n  const current = longRawForMode(rows[index], mode);\n  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;\n  return current && !previous;\n}'''
if sig_old not in src: raise SystemExit('signal marker missing')
src=src.replace(sig_old,sig_new,1)

gross_old='    const requestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);'
gross_new='''    const baseRequestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);\n    const rescueEntry = side === "L" && v62Modes.includes(options.longMode) && v62RescueRaw(rows,index,options.longMode) && !v62NativeEdge(rows,index);\n    const requestedGross = rescueEntry ? v62RequestedGross(rows,index,options.longMode,baseRequestedGross) : baseRequestedGross;'''
if gross_old not in src: raise SystemExit('gross marker missing')
src=src.replace(gross_old,gross_new,1)

hold_old='''    const initialShortState = position.shortV20 ? { ...position.shortV20 } : undefined;\n    const hold = side === "L" ? PENGU_DUAL_LS_V2.long.maxHoldHours : PENGU_DUAL_LS_V2.short.maxHoldHours;\n    const last = Math.min(rows.length - 1, entryIndex + hold - 1);\n    let exitIndex = last;\n    let exitPrice = rows[last].candle.close;\n    let engineExitReason = side === "L" ? "LONG_MAX_HOLD" : "SHORT_MAX_HOLD";'''
hold_new='''    const initialShortState = position.shortV20 ? { ...position.shortV20 } : undefined;\n    const rescueProfile = rescueEntry ? v62Spec(options.longMode)!.profile : null;\n    const hold = rescueProfile ? rescueProfile.hold : side === "L" ? PENGU_DUAL_LS_V2.long.maxHoldHours : PENGU_DUAL_LS_V2.short.maxHoldHours;\n    const last = Math.min(rows.length - 1, entryIndex + hold - 1);\n    let exitIndex = last;\n    let exitPrice = rows[last].candle.close;\n    let engineExitReason = rescueProfile ? "V62_RESCUE_MAX_HOLD" : side === "L" ? "LONG_MAX_HOLD" : "SHORT_MAX_HOLD";'''
if hold_old not in src: raise SystemExit('hold marker missing')
src=src.replace(hold_old,hold_new,1)

eval_old='''      const evaluation = evaluatePenguDualLsV2PositionBar(position, f);\n      position = evaluation.updatedPosition;\n      if (evaluation.exit) {\n        exitIndex = cursor;\n        exitPrice = evaluation.exit.stopPrice ?? rows[cursor].candle.close;\n        engineExitReason = evaluation.exit.reason;\n        exitReason = evaluation.exit.reason.includes("HARD") ? "hard" : evaluation.exit.reason.includes("TRAILING") ? "trail" : "time";\n        break;\n      }'''
eval_new='''      if (rescueProfile && side === "L") {\n        const hardPrice = entry.open * (1 - rescueProfile.hard);\n        const previousBest = Math.max(entry.open, position.highWaterMark);\n        if (f.low <= hardPrice) {\n          exitIndex = cursor; exitPrice = hardPrice; engineExitReason = "V62_RESCUE_HARD_STOP"; exitReason = "hard"; break;\n        }\n        const armed = previousBest / entry.open - 1 >= rescueProfile.activation;\n        const trailPrice = previousBest * (1 - rescueProfile.retrace);\n        if (armed && f.low <= trailPrice) {\n          exitIndex = cursor; exitPrice = trailPrice; engineExitReason = "V62_RESCUE_TRAILING_STOP"; exitReason = "trail"; break;\n        }\n        position = { ...position, highWaterMark: Math.max(previousBest, f.high), lowWaterMark: Math.min(position.lowWaterMark, f.low) };\n      } else {\n        const evaluation = evaluatePenguDualLsV2PositionBar(position, f);\n        position = evaluation.updatedPosition;\n        if (evaluation.exit) {\n          exitIndex = cursor;\n          exitPrice = evaluation.exit.stopPrice ?? rows[cursor].candle.close;\n          engineExitReason = evaluation.exit.reason;\n          exitReason = evaluation.exit.reason.includes("HARD") ? "hard" : evaluation.exit.reason.includes("TRAILING") ? "trail" : "time";\n          break;\n        }\n      }'''
if eval_old not in src: raise SystemExit('evaluation marker missing')
src=src.replace(eval_old,eval_new,1)

start=src.index('  const v57 = evaluateV57Conditional('); end=src.index('\n}\n\nmain().catch',start)
tail=r'''  const d=deriveV57Thresholds(baselineNormal); v57Thresholds=d.thresholds;
  const v62=evaluateV62(rows,funding,baselineNormal);
  const selectedMode=(v62.selectedMode??"V57_REGIME72_BREAKOUT") as LongMode;
  const selectedNormal=replay(rows,funding,{mode:"normal",longMode:selectedMode}).trades,selectedStress=replay(rows,funding,{mode:"stress",longMode:selectedMode}).trades;
  const incumbentNormal=replay(rows,funding,{mode:"normal",longMode:"V57_REGIME72_BREAKOUT"}).trades,incumbentStress=replay(rows,funding,{mode:"stress",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const resultPayload={status:"PASS_RESEARCH_ONLY",period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true},source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},longDiagnostics:longDiag,v62,final:{promoted:v62.strictPass,longMode:v62.strictPass?selectedMode:"V57_REGIME72_BREAKOUT",normal:metrics(v62.strictPass?selectedNormal:incumbentNormal),stress:metrics(v62.strictPass?selectedStress:incumbentStress)},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  const baseLedger={schema:"pengu-dual-ls-v2-aster-ledger/v1",strategyId:PENGU_DUAL_LS_V2.id,shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",currentProductionSourceSha:SOURCE_SHA,researchOnly:true,period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},data:{penguRows:pengu.length,btcRows:btc.length,fundingRows:funding.length,availableStart:new Date(pengu[0].openTime).toISOString(),availableEndExclusive:new Date(pengu.at(-1)!.openTime+HOUR).toISOString(),requestedStart:new Date(EVAL_START).toISOString(),requestedEndExclusive:new Date(EVAL_END).toISOString(),coverageNote:"No pre-listing PENGU data is synthesized."},safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  const candidate={...baseLedger,longVariant:`PENGU_DUAL_LS_V2_FINAL_${selectedMode}`,researchCandidate:{promoted:v62.strictPass,longMode:selectedMode,shortVeto:null,diagnosticsSchema:"pengu-v62-rescue-exit/v1"},integrity:{noOverlap:selectedNormal.every((t,i)=>i===0||t.entryTs>selectedNormal[i-1].exitTs),maximumRequestedGross:Math.max(...selectedNormal.map(t=>t.requestedGross))},modes:{normal:{metrics:metrics(selectedNormal),trades:selectedNormal.map(publicTrade)},stress:{metrics:metrics(selectedStress),trades:selectedStress.map(publicTrade)}}};
  const incumbent={...baseLedger,longVariant:"PENGU_DUAL_LS_V2_FINAL_V57_REGIME72_BREAKOUT",researchCandidate:{promoted:false,longMode:"V57_REGIME72_BREAKOUT",shortVeto:null,diagnosticsSchema:"pengu-v62-incumbent-v57/v1"},integrity:{noOverlap:incumbentNormal.every((t,i)=>i===0||t.entryTs>incumbentNormal[i-1].exitTs),maximumRequestedGross:Math.max(...incumbentNormal.map(t=>t.requestedGross))},modes:{normal:{metrics:metrics(incumbentNormal),trades:incumbentNormal.map(publicTrade)},stress:{metrics:metrics(incumbentStress),trades:incumbentStress.map(publicTrade)}}};
  assert.equal(candidate.integrity.noOverlap,true); assert.equal(incumbent.integrity.noOverlap,true);
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v62-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"candidate-pengu-ledger.json"),JSON.stringify(candidate,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"incumbent-v57-pengu-ledger.json"),JSON.stringify(incumbent,null,2)+"\n","utf8");
  console.log("V62_RESULT="+JSON.stringify({decision:v62.decision,selectedMode:v62.selectedMode,trainingSelectionPass:v62.trainingSelectionPass,frequencyImproves:v62.frequencyImproves,frequencyGoalPass:v62.frequencyGoalPass,normalHoldoutPositive:v62.normalHoldoutPositive,stressHoldoutPositive:v62.stressHoldoutPositive,stressRobust:v62.stressRobust,fullNormalImproves:v62.fullNormalImproves,strictPass:v62.strictPass},null,2));
'''
src=src[:start]+tail+src[end:]
TARGET.write_text(src)
print(f'PATCHED_V62={TARGET} bytes={TARGET.stat().st_size}')
