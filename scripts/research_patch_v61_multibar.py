from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

old_type = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL";'
new_type = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V61_BREAKOUT_RETEST" | "V61_HIGHER_LOW_RESUME" | "V61_CONTRACTION_BREAK";'
if old_type not in src:
    raise SystemExit('V57 LongMode marker missing')
src = src.replace(old_type, new_type, 1)

marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
const v61Modes: LongMode[] = [
  "V61_BREAKOUT_RETEST",
  "V61_HIGHER_LOW_RESUME",
  "V61_CONTRACTION_BREAK",
];

function v61TrendBackbone(row: PenguDualLsV2EvaluationRow) {
  const f = row.features;
  if (!f) return false;
  const r = PENGU_DUAL_LS_V2.long;
  return f.penguReturn72h >= r.regimeReturn72hMinimum
    && f.close > f.ema168
    && f.ema72 > f.ema168
    && f.relativeReturn24h >= r.relativeReturn24hMinimum
    && f.btcReturn24h >= r.btcReturn24hMinimum
    && f.rsi14 >= r.rsiMinimum
    && f.rsi14 <= r.rsiMaximum
    && f.volumeRatio6OverPrior36 >= r.volumeRatioMinimum
    && f.volumeRatio6OverPrior36 <= r.volumeRatioMaximum
    && f.atr24Ratio <= r.atr24RatioMaximum;
}

function v61NativeSignal(rows: PenguDualLsV2EvaluationRow[], index: number) {
  if (index < 0) return false;
  const current = longRawForMode(rows[index], "V57_REGIME72_BREAKOUT");
  const previous = index > 0 ? longRawForMode(rows[index - 1], "V57_REGIME72_BREAKOUT") : false;
  return current && !previous;
}

function v61RecentNativeSignalIndex(rows: PenguDualLsV2EvaluationRow[], index: number, hours=12) {
  for (let j=index-2; j>=Math.max(1,index-hours); j-=1) if (v61NativeSignal(rows,j)) return j;
  return -1;
}

function v61ContinuationOnlyRaw(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {
  if (!v61Modes.includes(mode) || index < 4) return false;
  const f = rows[index].features;
  const p1 = rows[index-1].features;
  const p2 = rows[index-2].features;
  const p3 = rows[index-3].features;
  if (!f || !p1 || !p2 || !p3 || !v61TrendBackbone(rows[index])) return false;
  if (longRawForMode(rows[index], "V57_REGIME72_BREAKOUT")) return false;

  if (mode === "V61_BREAKOUT_RETEST") {
    const anchorIndex = v61RecentNativeSignalIndex(rows,index,12);
    if (anchorIndex < 0) return false;
    const anchor = rows[anchorIndex].features;
    if (!anchor) return false;
    const breakoutLevel = anchor.priorHigh18h;
    let retested = false;
    for (let j=anchorIndex+1;j<index;j+=1) {
      const x=rows[j].features;
      if (x && x.low <= breakoutLevel) { retested=true; break; }
    }
    return retested && f.close > breakoutLevel && f.close > p1.high && f.close > f.ema72;
  }

  if (mode === "V61_HIGHER_LOW_RESUME") {
    const pulledBack = p3.close > p2.close && p2.close >= p1.close;
    const resume = f.low > p1.low && f.close > p1.high && f.close > f.ema72;
    return pulledBack && resume && f.penguReturn24h > 0;
  }

  if (mode === "V61_CONTRACTION_BREAK") {
    const range1 = p1.high-p1.low, range2=p2.high-p2.low, range3=p3.high-p3.low;
    const contraction = range3 >= range2 && range2 >= range1;
    const priorMax = Math.max(p1.high,p2.high,p3.high);
    return contraction && f.close > priorMax && f.close > f.ema72 && f.penguReturn24h > 0;
  }
  return false;
}

function v61SignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {
  if (v61NativeSignal(rows,index)) return true;
  if (longRawForMode(rows[index],"V57_REGIME72_BREAKOUT")) return false;
  const current=v61ContinuationOnlyRaw(rows,index,mode);
  const previous=index>0?v61ContinuationOnlyRaw(rows,index-1,mode):false;
  return current && !previous;
}

function v61RequestedGross(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode, baseGross: number) {
  if (!v61Modes.includes(mode)) return baseGross;
  if (longRawForMode(rows[index],"V57_REGIME72_BREAKOUT")) return baseGross;
  return v61ContinuationOnlyRaw(rows,index,mode)?Math.min(baseGross,0.5):baseGross;
}

function evaluateV61(
  rows: PenguDualLsV2EvaluationRow[], funding: FundingPoint[], baselineV56Normal: RichTrade[],
) {
  const derivation=deriveV57Thresholds(baselineV56Normal); v57Thresholds=derivation.thresholds;
  const incumbentNormal=replay(rows,funding,{mode:"normal",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const incumbentStress=replay(rows,funding,{mode:"stress",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const slice=(trades:RichTrade[],side:Side|undefined,start:number,end:number)=>sliceByTime(side?trades.filter(t=>t.side===side):trades,start,end);
  const base={
    longTrain:metrics(slice(incumbentNormal,"L",EVAL_START,HOLDOUT_CUTOFF)), allTrain:metrics(slice(incumbentNormal,undefined,EVAL_START,HOLDOUT_CUTOFF)),
    longHoldout:metrics(slice(incumbentNormal,"L",HOLDOUT_CUTOFF,EVAL_END)), allHoldout:metrics(slice(incumbentNormal,undefined,HOLDOUT_CUTOFF,EVAL_END)),
    longStressHoldout:metrics(slice(incumbentStress,"L",HOLDOUT_CUTOFF,EVAL_END)), allStressHoldout:metrics(slice(incumbentStress,undefined,HOLDOUT_CUTOFF,EVAL_END)),
    fullNormal:metrics(incumbentNormal),fullStress:metrics(incumbentStress),
  };
  const baseTrainWinners=slice(incumbentNormal,"L",EVAL_START,HOLDOUT_CUTOFF).filter(t=>t.accountReturn>0);
  const candidates=v61Modes.map(mode=>{
    const normal=replay(rows,funding,{mode:"normal",longMode:mode}).trades;
    const stress=replay(rows,funding,{mode:"stress",longMode:mode}).trades;
    const cLT=slice(normal,"L",EVAL_START,HOLDOUT_CUTOFF), cAT=slice(normal,undefined,EVAL_START,HOLDOUT_CUTOFF);
    const cLH=slice(normal,"L",HOLDOUT_CUTOFF,EVAL_END), cAH=slice(normal,undefined,HOLDOUT_CUTOFF,EVAL_END);
    const cLSH=slice(stress,"L",HOLDOUT_CUTOFF,EVAL_END), cASH=slice(stress,undefined,HOLDOUT_CUTOFF,EVAL_END);
    const replacementAudit=winnerReplacementAudit(baseTrainWinners,cLT);
    const ids=new Set(cLT.map(t=>t.signalTs));
    const exact=baseTrainWinners.every(t=>ids.has(t.signalTs));
    const economicallyPreserves=exact||replacementAudit.replacements.every(x=>x.replacementAccountReturn!==null&&x.replacementAccountReturn+1e-12>=x.baselineAccountReturn);
    const m={longTrain:metrics(cLT),allTrain:metrics(cAT),longHoldout:metrics(cLH),allHoldout:metrics(cAH),longStressHoldout:metrics(cLSH),allStressHoldout:metrics(cASH),fullNormal:metrics(normal),fullStress:metrics(stress)};
    const trainingEligible=economicallyPreserves
      && m.longTrain.trades>=base.longTrain.trades+2
      && m.longTrain.returnPct>base.longTrain.returnPct+1e-9
      && pfAtLeast(m.longTrain,base.longTrain,0.95)
      && m.longTrain.maxDrawdownPct>=base.longTrain.maxDrawdownPct-0.75
      && m.allTrain.returnPct>base.allTrain.returnPct+1e-9
      && pfAtLeast(m.allTrain,base.allTrain,0.98)
      && m.allTrain.maxDrawdownPct>=base.allTrain.maxDrawdownPct-0.75;
    return {mode,economicallyPreserves,replacementAudit,trainingEligible,metrics:m,deltas:{
      longTrainTrades:m.longTrain.trades-base.longTrain.trades,longTrainReturnPct:m.longTrain.returnPct-base.longTrain.returnPct,allTrainReturnPct:m.allTrain.returnPct-base.allTrain.returnPct,
      longHoldoutTrades:m.longHoldout.trades-base.longHoldout.trades,longHoldoutReturnPct:m.longHoldout.returnPct-base.longHoldout.returnPct,fullLongTrades:m.fullNormal.longTrades-base.fullNormal.longTrades,
      fullNormalReturnPct:m.fullNormal.returnPct-base.fullNormal.returnPct,fullStressReturnPct:m.fullStress.returnPct-base.fullStress.returnPct}};
  });
  const eligible=candidates.filter(x=>x.trainingEligible).sort((a,b)=>b.deltas.allTrainReturnPct-a.deltas.allTrainReturnPct||b.deltas.longTrainTrades-a.deltas.longTrainTrades);
  const selected=eligible[0]??null;
  if(!selected)return{schema:"pengu-v61-multibar/v1",incumbentMode:"V57_REGIME72_BREAKOUT",baseline:base,candidates,selectedMode:null,trainingSelectionPass:false,frequencyImproves:false,frequencyGoalPass:false,normalHoldoutPositive:false,stressHoldoutPositive:false,stressRobust:false,fullNormalImproves:false,strictPass:false,decision:"KEEP_V57_RESEARCH_CANDIDATE",reason:"No V61 candidate improved training under winner/PF/DD guards."};
  const m=selected.metrics;
  const frequencyImproves=m.fullNormal.longTrades>base.fullNormal.longTrades, frequencyGoalPass=m.fullNormal.longTrades>=20;
  const normalHoldoutPositive=m.longHoldout.trades>base.longHoldout.trades&&m.longHoldout.returnPct>base.longHoldout.returnPct+1e-9&&m.allHoldout.returnPct>base.allHoldout.returnPct+1e-9&&pfAtLeast(m.allHoldout,base.allHoldout,0.95)&&m.allHoldout.maxDrawdownPct>=base.allHoldout.maxDrawdownPct-0.75;
  const stressHoldoutPositive=m.longStressHoldout.trades>base.longStressHoldout.trades&&m.longStressHoldout.returnPct>base.longStressHoldout.returnPct+1e-9&&m.allStressHoldout.returnPct>base.allStressHoldout.returnPct+1e-9&&pfAtLeast(m.allStressHoldout,base.allStressHoldout,0.95)&&m.allStressHoldout.maxDrawdownPct>=base.allStressHoldout.maxDrawdownPct-0.75;
  const stressRobust=m.fullStress.returnPct>=base.fullStress.returnPct-1e-9&&pfAtLeast(m.fullStress,base.fullStress,0.98)&&m.fullStress.maxDrawdownPct>=base.fullStress.maxDrawdownPct-0.75;
  const fullNormalImproves=m.fullNormal.returnPct>base.fullNormal.returnPct+1e-9&&pfAtLeast(m.fullNormal,base.fullNormal,0.98)&&m.fullNormal.maxDrawdownPct>=base.fullNormal.maxDrawdownPct-0.75;
  const strictPass=frequencyImproves&&normalHoldoutPositive&&stressHoldoutPositive&&stressRobust&&fullNormalImproves;
  return{schema:"pengu-v61-multibar/v1",incumbentMode:"V57_REGIME72_BREAKOUT",baseline:base,candidates,selectedMode:selected.mode,selectedByTrainingOnly:true,selectedTraining:selected,trainingSelectionPass:true,frequencyImproves,frequencyGoalPass,normalHoldoutPositive,stressHoldoutPositive,stressRobust,fullNormalImproves,strictPass,decision:strictPass?"ADOPT_V61_RESEARCH_CANDIDATE":"KEEP_V57_RESEARCH_CANDIDATE",reason:strictPass?"V61 survived untouched holdout and stress.":"Training-selected V61 failed holdout or robustness."};
}
'''
if marker not in src: raise SystemExit('longDiagnostics marker missing')
src=src.replace(marker,insert+marker,1)

old_raw='''  if (mode === "V57_REGIME72_DUAL") return relativeStrong && breakoutStrong;\n  return false;'''
new_raw='''  if (mode === "V57_REGIME72_DUAL") return relativeStrong && breakoutStrong;\n  if (v61Modes.includes(mode)) return row.longRaw;\n  return false;'''
if old_raw not in src: raise SystemExit('longRaw marker missing')
src=src.replace(old_raw,new_raw,1)
old_signal='''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {\n  if (mode === "EDGE") return rows[index].longSignal;\n  if (mode === "RAW_REENTRY") return rows[index].longRaw;\n  const current = longRawForMode(rows[index], mode);\n  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;\n  return current && !previous;\n}'''
new_signal='''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {\n  if (mode === "EDGE") return rows[index].longSignal;\n  if (mode === "RAW_REENTRY") return rows[index].longRaw;\n  if (v61Modes.includes(mode)) return v61SignalForMode(rows,index,mode);\n  const current = longRawForMode(rows[index], mode);\n  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;\n  return current && !previous;\n}'''
if old_signal not in src: raise SystemExit('signal marker missing')
src=src.replace(old_signal,new_signal,1)
old_gross='    const requestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);'
new_gross='''    const baseRequestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);\n    const requestedGross = side === "L" && v61Modes.includes(options.longMode) ? v61RequestedGross(rows,index,options.longMode,baseRequestedGross) : baseRequestedGross;'''
if old_gross not in src: raise SystemExit('gross marker missing')
src=src.replace(old_gross,new_gross,1)

start=src.index('  const v57 = evaluateV57Conditional('); end=src.index('\n}\n\nmain().catch',start)
new_tail=r'''  const derivation=deriveV57Thresholds(baselineNormal); v57Thresholds=derivation.thresholds;
  const v61=evaluateV61(rows,funding,baselineNormal);
  const selectedMode=(v61.selectedMode??"V57_REGIME72_BREAKOUT") as LongMode;
  const selectedNormal=replay(rows,funding,{mode:"normal",longMode:selectedMode}).trades, selectedStress=replay(rows,funding,{mode:"stress",longMode:selectedMode}).trades;
  const incumbentNormal=replay(rows,funding,{mode:"normal",longMode:"V57_REGIME72_BREAKOUT"}).trades, incumbentStress=replay(rows,funding,{mode:"stress",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const resultPayload={status:"PASS_RESEARCH_ONLY",period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true},source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},longDiagnostics:longDiag,v61,final:{promoted:v61.strictPass,longMode:v61.strictPass?selectedMode:"V57_REGIME72_BREAKOUT",normal:metrics(v61.strictPass?selectedNormal:incumbentNormal),stress:metrics(v61.strictPass?selectedStress:incumbentStress)},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  const baseLedger={schema:"pengu-dual-ls-v2-aster-ledger/v1",strategyId:PENGU_DUAL_LS_V2.id,shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",currentProductionSourceSha:SOURCE_SHA,researchOnly:true,period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},data:{penguRows:pengu.length,btcRows:btc.length,fundingRows:funding.length,availableStart:new Date(pengu[0].openTime).toISOString(),availableEndExclusive:new Date(pengu.at(-1)!.openTime+HOUR).toISOString(),requestedStart:new Date(EVAL_START).toISOString(),requestedEndExclusive:new Date(EVAL_END).toISOString(),coverageNote:"No pre-listing PENGU data is synthesized."},safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  const candidate={...baseLedger,longVariant:`PENGU_DUAL_LS_V2_FINAL_${selectedMode}`,researchCandidate:{promoted:v61.strictPass,longMode:selectedMode,shortVeto:null,diagnosticsSchema:"pengu-v61-multibar/v1"},integrity:{noOverlap:selectedNormal.every((t,i)=>i===0||t.entryTs>selectedNormal[i-1].exitTs),maximumRequestedGross:Math.max(...selectedNormal.map(t=>t.requestedGross))},modes:{normal:{metrics:metrics(selectedNormal),trades:selectedNormal.map(publicTrade)},stress:{metrics:metrics(selectedStress),trades:selectedStress.map(publicTrade)}}};
  const incumbent={...baseLedger,longVariant:"PENGU_DUAL_LS_V2_FINAL_V57_REGIME72_BREAKOUT",researchCandidate:{promoted:false,longMode:"V57_REGIME72_BREAKOUT",shortVeto:null,diagnosticsSchema:"pengu-v61-incumbent-v57/v1"},integrity:{noOverlap:incumbentNormal.every((t,i)=>i===0||t.entryTs>incumbentNormal[i-1].exitTs),maximumRequestedGross:Math.max(...incumbentNormal.map(t=>t.requestedGross))},modes:{normal:{metrics:metrics(incumbentNormal),trades:incumbentNormal.map(publicTrade)},stress:{metrics:metrics(incumbentStress),trades:incumbentStress.map(publicTrade)}}};
  assert.equal(candidate.integrity.noOverlap,true); assert.equal(incumbent.integrity.noOverlap,true);
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v61-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"candidate-pengu-ledger.json"),JSON.stringify(candidate,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"incumbent-v57-pengu-ledger.json"),JSON.stringify(incumbent,null,2)+"\n","utf8");
  console.log("V61_RESULT="+JSON.stringify({decision:v61.decision,selectedMode:v61.selectedMode,trainingSelectionPass:v61.trainingSelectionPass,frequencyImproves:v61.frequencyImproves,frequencyGoalPass:v61.frequencyGoalPass,normalHoldoutPositive:v61.normalHoldoutPositive,stressHoldoutPositive:v61.stressHoldoutPositive,stressRobust:v61.stressRobust,fullNormalImproves:v61.fullNormalImproves,strictPass:v61.strictPass},null,2));
'''
src=src[:start]+new_tail+src[end:]
TARGET.write_text(src)
print(f'PATCHED_V61={TARGET} bytes={TARGET.stat().st_size}')
