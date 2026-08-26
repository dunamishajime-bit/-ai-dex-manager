from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

old_type = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL";'
new_type = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V60_EMA72_TOUCH_BOUNCE" | "V60_EMA72_RECLAIM" | "V60_MOMENTUM_RESET_RECLAIM";'
if old_type not in src:
    raise SystemExit('V57 LongMode marker missing')
src = src.replace(old_type, new_type, 1)

marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
const v60Modes: LongMode[] = [
  "V60_EMA72_TOUCH_BOUNCE",
  "V60_EMA72_RECLAIM",
  "V60_MOMENTUM_RESET_RECLAIM",
];

function v60TrendBackbone(row: PenguDualLsV2EvaluationRow) {
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

function v60PullbackOnlyRaw(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {
  if (!v60Modes.includes(mode) || index < 1) return false;
  const current = rows[index];
  const previous = rows[index - 1];
  const f = current.features;
  const p = previous.features;
  if (!f || !p || !v60TrendBackbone(current) || !v60TrendBackbone(previous)) return false;
  if (longRawForMode(current, "V57_REGIME72_BREAKOUT")) return false;
  const r = PENGU_DUAL_LS_V2.long;
  if (mode === "V60_EMA72_TOUCH_BOUNCE") {
    return p.low <= p.ema72 && f.close > f.ema72 && f.close > p.close;
  }
  if (mode === "V60_EMA72_RECLAIM") {
    return p.close <= p.ema72 && f.close > f.ema72 && f.close > p.high;
  }
  if (mode === "V60_MOMENTUM_RESET_RECLAIM") {
    return p.penguReturn24h < r.penguReturn24hMinimum
      && f.penguReturn24h >= 0
      && f.close > p.high
      && f.close > f.ema72;
  }
  return false;
}

function v60SignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {
  const nativeCurrent = longRawForMode(rows[index], "V57_REGIME72_BREAKOUT");
  const nativePrevious = index > 0 ? longRawForMode(rows[index - 1], "V57_REGIME72_BREAKOUT") : false;
  if (nativeCurrent && !nativePrevious) return true;
  if (nativeCurrent) return false;
  const current = v60PullbackOnlyRaw(rows, index, mode);
  const previous = index > 0 ? v60PullbackOnlyRaw(rows, index - 1, mode) : false;
  return current && !previous;
}

function v60RequestedGross(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode, baseGross: number) {
  if (!v60Modes.includes(mode)) return baseGross;
  if (longRawForMode(rows[index], "V57_REGIME72_BREAKOUT")) return baseGross;
  return v60PullbackOnlyRaw(rows,index,mode) ? Math.min(baseGross,0.5) : baseGross;
}

function evaluateV60Pullback(
  rows: PenguDualLsV2EvaluationRow[],
  funding: FundingPoint[],
  baselineV56Normal: RichTrade[],
) {
  const derivation = deriveV57Thresholds(baselineV56Normal);
  v57Thresholds = derivation.thresholds;
  const incumbentNormal = replay(rows,funding,{mode:"normal",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const incumbentStress = replay(rows,funding,{mode:"stress",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const bLongTrain = sliceByTime(incumbentNormal.filter((t)=>t.side==="L"),EVAL_START,HOLDOUT_CUTOFF);
  const bAllTrain = sliceByTime(incumbentNormal,EVAL_START,HOLDOUT_CUTOFF);
  const bLongHold = sliceByTime(incumbentNormal.filter((t)=>t.side==="L"),HOLDOUT_CUTOFF,EVAL_END);
  const bAllHold = sliceByTime(incumbentNormal,HOLDOUT_CUTOFF,EVAL_END);
  const bLongStressHold = sliceByTime(incumbentStress.filter((t)=>t.side==="L"),HOLDOUT_CUTOFF,EVAL_END);
  const bAllStressHold = sliceByTime(incumbentStress,HOLDOUT_CUTOFF,EVAL_END);
  const base = {
    longTrain:metrics(bLongTrain), allTrain:metrics(bAllTrain),
    longHoldout:metrics(bLongHold), allHoldout:metrics(bAllHold),
    longStressHoldout:metrics(bLongStressHold), allStressHoldout:metrics(bAllStressHold),
    fullNormal:metrics(incumbentNormal), fullStress:metrics(incumbentStress),
  };
  const candidates = v60Modes.map((mode)=>{
    const normal = replay(rows,funding,{mode:"normal",longMode:mode}).trades;
    const stress = replay(rows,funding,{mode:"stress",longMode:mode}).trades;
    const cLongTrain = sliceByTime(normal.filter((t)=>t.side==="L"),EVAL_START,HOLDOUT_CUTOFF);
    const cAllTrain = sliceByTime(normal,EVAL_START,HOLDOUT_CUTOFF);
    const cLongHold = sliceByTime(normal.filter((t)=>t.side==="L"),HOLDOUT_CUTOFF,EVAL_END);
    const cAllHold = sliceByTime(normal,HOLDOUT_CUTOFF,EVAL_END);
    const cLongStressHold = sliceByTime(stress.filter((t)=>t.side==="L"),HOLDOUT_CUTOFF,EVAL_END);
    const cAllStressHold = sliceByTime(stress,HOLDOUT_CUTOFF,EVAL_END);
    const replacementAudit = winnerReplacementAudit(bLongTrain.filter((t)=>t.accountReturn>0),cLongTrain);
    const ids = new Set(cLongTrain.map((t)=>t.signalTs));
    const exactPreserves = bLongTrain.filter((t)=>t.accountReturn>0).every((t)=>ids.has(t.signalTs));
    const economicallyPreserves = exactPreserves || replacementAudit.replacements.every((x)=>
      x.replacementAccountReturn !== null && x.replacementAccountReturn + 1e-12 >= x.baselineAccountReturn
    );
    const m = {
      longTrain:metrics(cLongTrain),allTrain:metrics(cAllTrain),
      longHoldout:metrics(cLongHold),allHoldout:metrics(cAllHold),
      longStressHoldout:metrics(cLongStressHold),allStressHoldout:metrics(cAllStressHold),
      fullNormal:metrics(normal),fullStress:metrics(stress),
    };
    const trainingEligible = economicallyPreserves
      && m.longTrain.trades >= base.longTrain.trades + 2
      && m.longTrain.returnPct > base.longTrain.returnPct + 1e-9
      && pfAtLeast(m.longTrain,base.longTrain,0.95)
      && m.longTrain.maxDrawdownPct >= base.longTrain.maxDrawdownPct - 0.75
      && m.allTrain.returnPct > base.allTrain.returnPct + 1e-9
      && pfAtLeast(m.allTrain,base.allTrain,0.98)
      && m.allTrain.maxDrawdownPct >= base.allTrain.maxDrawdownPct - 0.75;
    return {mode,economicallyPreserves,replacementAudit,trainingEligible,metrics:m,deltas:{
      longTrainTrades:m.longTrain.trades-base.longTrain.trades,
      longTrainReturnPct:m.longTrain.returnPct-base.longTrain.returnPct,
      allTrainReturnPct:m.allTrain.returnPct-base.allTrain.returnPct,
      longHoldoutTrades:m.longHoldout.trades-base.longHoldout.trades,
      longHoldoutReturnPct:m.longHoldout.returnPct-base.longHoldout.returnPct,
      fullLongTrades:m.fullNormal.longTrades-base.fullNormal.longTrades,
      fullNormalReturnPct:m.fullNormal.returnPct-base.fullNormal.returnPct,
      fullStressReturnPct:m.fullStress.returnPct-base.fullStress.returnPct,
    }};
  });
  const eligible = candidates.filter((x)=>x.trainingEligible).sort((a,b)=>
    b.deltas.allTrainReturnPct-a.deltas.allTrainReturnPct || b.deltas.longTrainTrades-a.deltas.longTrainTrades
  );
  const selected = eligible[0] ?? null;
  if (!selected) return {
    schema:"pengu-v60-independent-pullback/v1",incumbentMode:"V57_REGIME72_BREAKOUT",baseline:base,candidates,
    selectedMode:null,trainingSelectionPass:false,frequencyImproves:false,frequencyGoalPass:false,
    normalHoldoutPositive:false,stressHoldoutPositive:false,stressRobust:false,fullNormalImproves:false,
    strictPass:false,decision:"KEEP_V57_RESEARCH_CANDIDATE",
    reason:"No independent pullback candidate improved training while preserving V57 winners and PF/DD guards.",
  };
  const m = selected.metrics;
  const frequencyImproves = m.fullNormal.longTrades > base.fullNormal.longTrades;
  const frequencyGoalPass = m.fullNormal.longTrades >= 20;
  const normalHoldoutPositive = m.longHoldout.trades > base.longHoldout.trades
    && m.longHoldout.returnPct > base.longHoldout.returnPct + 1e-9
    && m.allHoldout.returnPct > base.allHoldout.returnPct + 1e-9
    && pfAtLeast(m.allHoldout,base.allHoldout,0.95)
    && m.allHoldout.maxDrawdownPct >= base.allHoldout.maxDrawdownPct - 0.75;
  const stressHoldoutPositive = m.longStressHoldout.trades > base.longStressHoldout.trades
    && m.longStressHoldout.returnPct > base.longStressHoldout.returnPct + 1e-9
    && m.allStressHoldout.returnPct > base.allStressHoldout.returnPct + 1e-9
    && pfAtLeast(m.allStressHoldout,base.allStressHoldout,0.95)
    && m.allStressHoldout.maxDrawdownPct >= base.allStressHoldout.maxDrawdownPct - 0.75;
  const stressRobust = m.fullStress.returnPct >= base.fullStress.returnPct - 1e-9
    && pfAtLeast(m.fullStress,base.fullStress,0.98)
    && m.fullStress.maxDrawdownPct >= base.fullStress.maxDrawdownPct - 0.75;
  const fullNormalImproves = m.fullNormal.returnPct > base.fullNormal.returnPct + 1e-9
    && pfAtLeast(m.fullNormal,base.fullNormal,0.98)
    && m.fullNormal.maxDrawdownPct >= base.fullNormal.maxDrawdownPct - 0.75;
  const strictPass = frequencyImproves && normalHoldoutPositive && stressHoldoutPositive && stressRobust && fullNormalImproves;
  return {
    schema:"pengu-v60-independent-pullback/v1",incumbentMode:"V57_REGIME72_BREAKOUT",baseline:base,candidates,
    selectedMode:selected.mode,selectedByTrainingOnly:true,selectedTraining:selected,trainingSelectionPass:true,
    frequencyImproves,frequencyGoalPass,normalHoldoutPositive,stressHoldoutPositive,stressRobust,fullNormalImproves,strictPass,
    decision:strictPass?"ADOPT_V60_RESEARCH_CANDIDATE":"KEEP_V57_RESEARCH_CANDIDATE",
    reason:strictPass?"Independent pullback engine increased Long frequency and survived untouched Normal/Stress holdout.":"Training-selected pullback failed frequency, holdout, or robustness requirements.",
  };
}
'''
if marker not in src:
    raise SystemExit('longDiagnostics marker missing')
src = src.replace(marker, insert + marker, 1)

old_raw_tail = '''  if (mode === "V57_REGIME72_DUAL") return relativeStrong && breakoutStrong;\n  return false;'''
new_raw_tail = '''  if (mode === "V57_REGIME72_DUAL") return relativeStrong && breakoutStrong;\n  if (v60Modes.includes(mode)) return row.longRaw;\n  return false;'''
if old_raw_tail not in src:
    raise SystemExit('longRawForMode tail marker missing')
src = src.replace(old_raw_tail,new_raw_tail,1)

old_signal = '''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {\n  if (mode === "EDGE") return rows[index].longSignal;\n  if (mode === "RAW_REENTRY") return rows[index].longRaw;\n  const current = longRawForMode(rows[index], mode);\n  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;\n  return current && !previous;\n}'''
new_signal = '''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {\n  if (mode === "EDGE") return rows[index].longSignal;\n  if (mode === "RAW_REENTRY") return rows[index].longRaw;\n  if (v60Modes.includes(mode)) return v60SignalForMode(rows,index,mode);\n  const current = longRawForMode(rows[index], mode);\n  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;\n  return current && !previous;\n}'''
if old_signal not in src:
    raise SystemExit('longSignalForMode marker missing')
src = src.replace(old_signal,new_signal,1)

old_gross = '    const requestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);'
new_gross = '''    const baseRequestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);\n    const requestedGross = side === "L" && v60Modes.includes(options.longMode)\n      ? v60RequestedGross(rows,index,options.longMode,baseRequestedGross)\n      : baseRequestedGross;'''
if old_gross not in src:
    raise SystemExit('requestedGross marker missing')
src = src.replace(old_gross,new_gross,1)

start = src.index('  const v57 = evaluateV57Conditional(')
end = src.index('\n}\n\nmain().catch', start)
new_tail = r'''  const derivation = deriveV57Thresholds(baselineNormal);
  v57Thresholds = derivation.thresholds;
  const v60 = evaluateV60Pullback(rows,funding,baselineNormal);
  const selectedMode=(v60.selectedMode ?? "V57_REGIME72_BREAKOUT") as LongMode;
  const selectedNormal=replay(rows,funding,{mode:"normal",longMode:selectedMode}).trades;
  const selectedStress=replay(rows,funding,{mode:"stress",longMode:selectedMode}).trades;
  const incumbentNormal=replay(rows,funding,{mode:"normal",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const incumbentStress=replay(rows,funding,{mode:"stress",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const resultPayload={
    status:"PASS_RESEARCH_ONLY",
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true},
    source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},
    longDiagnostics:longDiag,v60,
    final:{promoted:v60.strictPass,longMode:v60.strictPass?selectedMode:"V57_REGIME72_BREAKOUT",normal:metrics(v60.strictPass?selectedNormal:incumbentNormal),stress:metrics(v60.strictPass?selectedStress:incumbentStress)},
    safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };
  const ledgerBase={
    schema:"pengu-dual-ls-v2-aster-ledger/v1",strategyId:PENGU_DUAL_LS_V2.id,
    shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",currentProductionSourceSha:SOURCE_SHA,researchOnly:true,
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},
    costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},
    data:{penguRows:pengu.length,btcRows:btc.length,fundingRows:funding.length,availableStart:new Date(pengu[0].openTime).toISOString(),availableEndExclusive:new Date(pengu.at(-1)!.openTime+HOUR).toISOString(),requestedStart:new Date(EVAL_START).toISOString(),requestedEndExclusive:new Date(EVAL_END).toISOString(),coverageNote:"No pre-listing PENGU data is synthesized."},
    safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };
  const candidateLedgerPayload={...ledgerBase,
    longVariant:`PENGU_DUAL_LS_V2_FINAL_${selectedMode}`,
    researchCandidate:{promoted:v60.strictPass,longMode:selectedMode,shortVeto:null,diagnosticsSchema:"pengu-v60-independent-pullback/v1"},
    integrity:{noOverlap:selectedNormal.every((t,i)=>i===0||t.entryTs>selectedNormal[i-1].exitTs),maximumRequestedGross:Math.max(...selectedNormal.map((t)=>t.requestedGross))},
    modes:{normal:{metrics:metrics(selectedNormal),trades:selectedNormal.map(publicTrade)},stress:{metrics:metrics(selectedStress),trades:selectedStress.map(publicTrade)}},
  };
  const incumbentLedgerPayload={...ledgerBase,
    longVariant:"PENGU_DUAL_LS_V2_FINAL_V57_REGIME72_BREAKOUT",
    researchCandidate:{promoted:false,longMode:"V57_REGIME72_BREAKOUT",shortVeto:null,diagnosticsSchema:"pengu-v60-incumbent-v57/v1"},
    integrity:{noOverlap:incumbentNormal.every((t,i)=>i===0||t.entryTs>incumbentNormal[i-1].exitTs),maximumRequestedGross:Math.max(...incumbentNormal.map((t)=>t.requestedGross))},
    modes:{normal:{metrics:metrics(incumbentNormal),trades:incumbentNormal.map(publicTrade)},stress:{metrics:metrics(incumbentStress),trades:incumbentStress.map(publicTrade)}},
  };
  assert.equal(candidateLedgerPayload.integrity.noOverlap,true);
  assert.equal(incumbentLedgerPayload.integrity.noOverlap,true);
  assert.ok(selectedNormal.filter((t)=>t.side==="S").every((t)=>t.requestedGross<=0.75+1e-12));
  assert.ok(selectedNormal.filter((t)=>t.side==="L").every((t)=>t.requestedGross<=0.9375+1e-12));
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v60-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"candidate-pengu-ledger.json"),JSON.stringify(candidateLedgerPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"incumbent-v57-pengu-ledger.json"),JSON.stringify(incumbentLedgerPayload,null,2)+"\n","utf8");
  console.log("V60_RESULT="+JSON.stringify({decision:v60.decision,selectedMode:v60.selectedMode,trainingSelectionPass:v60.trainingSelectionPass,frequencyImproves:v60.frequencyImproves,frequencyGoalPass:v60.frequencyGoalPass,normalHoldoutPositive:v60.normalHoldoutPositive,stressHoldoutPositive:v60.stressHoldoutPositive,stressRobust:v60.stressRobust,fullNormalImproves:v60.fullNormalImproves,strictPass:v60.strictPass},null,2));
'''
src=src[:start]+new_tail+src[end:]
TARGET.write_text(src)
print(f'PATCHED_V60={TARGET} bytes={TARGET.stat().st_size}')
