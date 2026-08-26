from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

old_type = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V58_ONE_FAIL_CORE" | "V58_ONE_OR_TWO_FAIL_CORE" | "V58_ONE_OR_TWO_FAIL_ELITE";'
new_type = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V58_ONE_FAIL_CORE" | "V58_ONE_OR_TWO_FAIL_CORE" | "V58_ONE_OR_TWO_FAIL_ELITE" | "V58B_REENTRY_ONE_FAIL" | "V58B_REENTRY_CORE" | "V58B_REENTRY_ELITE";'
if old_type not in src:
    raise SystemExit('V58 LongMode marker missing')
src = src.replace(old_type, new_type, 1)

marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
const v58bModes: LongMode[] = [
  "V58B_REENTRY_ONE_FAIL",
  "V58B_REENTRY_CORE",
  "V58B_REENTRY_ELITE",
];

function v58bUnderlyingMode(mode: LongMode): LongMode {
  if (mode === "V58B_REENTRY_ONE_FAIL") return "V58_ONE_FAIL_CORE";
  if (mode === "V58B_REENTRY_CORE") return "V58_ONE_OR_TWO_FAIL_CORE";
  if (mode === "V58B_REENTRY_ELITE") return "V58_ONE_OR_TWO_FAIL_ELITE";
  return mode;
}

function v58bRecoveryFailureCount(row: PenguDualLsV2EvaluationRow, mode: LongMode) {
  if (!row.features || !v58bModes.includes(mode)) return null;
  const failures = v58RecoveryFailureCount(row.features, v58bUnderlyingMode(mode));
  return failures === 1 || failures === 2 ? failures : null;
}

function v58bSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {
  assert(v58bModes.includes(mode), `not a V58b mode: ${mode}`);
  const row = rows[index];
  if (!row.features) return false;
  const nativeCurrent = v57BreakoutRawFromFeatures(row.features);
  const nativePrevious = index > 0 && rows[index - 1].features
    ? v57BreakoutRawFromFeatures(rows[index - 1].features!)
    : false;
  if (nativeCurrent) return !nativePrevious;
  return v58bRecoveryFailureCount(row, mode) !== null;
}

function v58bRequestedGross(f: PenguDualLsV2Features, mode: LongMode, baseGross: number) {
  if (!v58bModes.includes(mode)) return baseGross;
  const failures = v58RecoveryFailureCount(f, v58bUnderlyingMode(mode));
  if (failures === 1) return Math.min(baseGross, 0.625);
  if (failures === 2) return Math.min(baseGross, 0.375);
  return baseGross;
}

function evaluateV58bReentry(
  rows: PenguDualLsV2EvaluationRow[],
  funding: FundingPoint[],
  baselineV56Normal: RichTrade[],
) {
  const derivation = deriveV57Thresholds(baselineV56Normal);
  v57Thresholds = derivation.thresholds;
  const incumbentNormal = replay(rows, funding, {mode:"normal", longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const incumbentStress = replay(rows, funding, {mode:"stress", longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const bLongTrain = sliceByTime(incumbentNormal.filter((t)=>t.side==="L"), EVAL_START, HOLDOUT_CUTOFF);
  const bAllTrain = sliceByTime(incumbentNormal, EVAL_START, HOLDOUT_CUTOFF);
  const bLongHold = sliceByTime(incumbentNormal.filter((t)=>t.side==="L"), HOLDOUT_CUTOFF, EVAL_END);
  const bAllHold = sliceByTime(incumbentNormal, HOLDOUT_CUTOFF, EVAL_END);
  const bLongStressHold = sliceByTime(incumbentStress.filter((t)=>t.side==="L"), HOLDOUT_CUTOFF, EVAL_END);
  const bAllStressHold = sliceByTime(incumbentStress, HOLDOUT_CUTOFF, EVAL_END);
  const base = {
    longTrain:metrics(bLongTrain), allTrain:metrics(bAllTrain),
    longHoldout:metrics(bLongHold), allHoldout:metrics(bAllHold),
    longStressHoldout:metrics(bLongStressHold), allStressHoldout:metrics(bAllStressHold),
    fullNormal:metrics(incumbentNormal), fullStress:metrics(incumbentStress),
  };

  const candidates = v58bModes.map((mode) => {
    const normal = replay(rows, funding, {mode:"normal", longMode:mode}).trades;
    const stress = replay(rows, funding, {mode:"stress", longMode:mode}).trades;
    const longTrainTrades=sliceByTime(normal.filter((t)=>t.side==="L"),EVAL_START,HOLDOUT_CUTOFF);
    const allTrainTrades=sliceByTime(normal,EVAL_START,HOLDOUT_CUTOFF);
    const longHoldoutTrades=sliceByTime(normal.filter((t)=>t.side==="L"),HOLDOUT_CUTOFF,EVAL_END);
    const allHoldoutTrades=sliceByTime(normal,HOLDOUT_CUTOFF,EVAL_END);
    const longStressHoldoutTrades=sliceByTime(stress.filter((t)=>t.side==="L"),HOLDOUT_CUTOFF,EVAL_END);
    const allStressHoldoutTrades=sliceByTime(stress,HOLDOUT_CUTOFF,EVAL_END);
    const replacementAudit=winnerReplacementAudit(bLongTrain.filter((t)=>t.accountReturn>0),longTrainTrades);
    const exactIds=new Set(longTrainTrades.map((t)=>t.signalTs));
    const exactPreserves=bLongTrain.filter((t)=>t.accountReturn>0).every((t)=>exactIds.has(t.signalTs));
    const economicallyPreserves=exactPreserves || replacementAudit.replacements.every((x)=>
      x.replacementAccountReturn!==null && x.replacementAccountReturn+1e-12>=x.baselineAccountReturn
    );
    const m={
      longTrain:metrics(longTrainTrades),allTrain:metrics(allTrainTrades),
      longHoldout:metrics(longHoldoutTrades),allHoldout:metrics(allHoldoutTrades),
      longStressHoldout:metrics(longStressHoldoutTrades),allStressHoldout:metrics(allStressHoldoutTrades),
      fullNormal:metrics(normal),fullStress:metrics(stress),
    };
    const trainingEligible=
      economicallyPreserves
      && m.longTrain.trades>=base.longTrain.trades+2
      && m.longTrain.returnPct>base.longTrain.returnPct+1e-9
      && pfAtLeast(m.longTrain,base.longTrain,0.90)
      && m.longTrain.maxDrawdownPct>=base.longTrain.maxDrawdownPct-0.75
      && m.allTrain.returnPct>base.allTrain.returnPct+1e-9
      && pfAtLeast(m.allTrain,base.allTrain,0.95)
      && m.allTrain.maxDrawdownPct>=base.allTrain.maxDrawdownPct-0.75;
    return {mode,economicallyPreserves,replacementAudit,trainingEligible,metrics:m,deltas:{
      longTrainTrades:m.longTrain.trades-base.longTrain.trades,
      longTrainReturnPct:m.longTrain.returnPct-base.longTrain.returnPct,
      allTrainReturnPct:m.allTrain.returnPct-base.allTrain.returnPct,
      fullLongTrades:m.fullNormal.longTrades-base.fullNormal.longTrades,
      fullNormalReturnPct:m.fullNormal.returnPct-base.fullNormal.returnPct,
      fullStressReturnPct:m.fullStress.returnPct-base.fullStress.returnPct,
    }};
  });
  const eligible=candidates.filter((x)=>x.trainingEligible).sort((a,b)=>
    b.deltas.allTrainReturnPct-a.deltas.allTrainReturnPct || b.deltas.longTrainTrades-a.deltas.longTrainTrades
  );
  const selected=eligible[0]??null;
  if(!selected) return {
    schema:"pengu-v58b-recovery-reentry/v1",derivation,incumbentMode:"V57_REGIME72_BREAKOUT",baseline:base,candidates,
    selectedMode:null,trainingSelectionPass:false,frequencyGoalPass:false,normalHoldoutPositive:false,stressHoldoutPositive:false,
    stressRobust:false,fullNormalImproves:false,strictPass:false,decision:"KEEP_V57_RESEARCH_CANDIDATE",
    reason:"No Recovery-only causal re-entry mode improved training while preserving V57 economics and PF/DD guards.",
  };
  const m=selected.metrics;
  const frequencyGoalPass=m.fullNormal.longTrades>=20;
  const normalHoldoutPositive=
    m.longHoldout.trades>base.longHoldout.trades
    && m.longHoldout.returnPct>base.longHoldout.returnPct+1e-9
    && m.allHoldout.returnPct>base.allHoldout.returnPct+1e-9
    && pfAtLeast(m.allHoldout,base.allHoldout,0.90)
    && m.allHoldout.maxDrawdownPct>=base.allHoldout.maxDrawdownPct-0.75;
  const stressHoldoutPositive=
    m.longStressHoldout.trades>base.longStressHoldout.trades
    && m.longStressHoldout.returnPct>base.longStressHoldout.returnPct+1e-9
    && m.allStressHoldout.returnPct>base.allStressHoldout.returnPct+1e-9
    && pfAtLeast(m.allStressHoldout,base.allStressHoldout,0.90)
    && m.allStressHoldout.maxDrawdownPct>=base.allStressHoldout.maxDrawdownPct-0.75;
  const stressRobust=
    m.fullStress.returnPct>=base.fullStress.returnPct-1e-9
    && pfAtLeast(m.fullStress,base.fullStress,0.95)
    && m.fullStress.maxDrawdownPct>=base.fullStress.maxDrawdownPct-0.75;
  const fullNormalImproves=
    m.fullNormal.returnPct>base.fullNormal.returnPct+1e-9
    && pfAtLeast(m.fullNormal,base.fullNormal,0.95)
    && m.fullNormal.maxDrawdownPct>=base.fullNormal.maxDrawdownPct-0.75;
  const strictPass=frequencyGoalPass&&normalHoldoutPositive&&stressHoldoutPositive&&stressRobust&&fullNormalImproves;
  return {
    schema:"pengu-v58b-recovery-reentry/v1",derivation,incumbentMode:"V57_REGIME72_BREAKOUT",baseline:base,candidates,
    selectedMode:selected.mode,selectedByTrainingOnly:true,selectedTraining:selected,trainingSelectionPass:true,frequencyGoalPass,
    normalHoldoutPositive,stressHoldoutPositive,stressRobust,fullNormalImproves,strictPass,
    decision:strictPass?"ADOPT_V58B_RESEARCH_CANDIDATE":"KEEP_V57_RESEARCH_CANDIDATE",
    reason:strictPass?"Recovery-only causal re-entry reached frequency target and survived untouched Normal/Stress holdout.":"Training-selected re-entry failed frequency, holdout, or robustness requirements.",
  };
}
'''
if marker not in src:
    raise SystemExit('longDiagnostics marker missing')
src = src.replace(marker, insert + marker, 1)

old_signal = '''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {\n  if (mode === "EDGE") return rows[index].longSignal;\n  if (mode === "RAW_REENTRY") return rows[index].longRaw;\n  const current = longRawForMode(rows[index], mode);\n  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;\n  return current && !previous;\n}'''
new_signal = '''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {\n  if (mode === "EDGE") return rows[index].longSignal;\n  if (mode === "RAW_REENTRY") return rows[index].longRaw;\n  if (v58bModes.includes(mode)) return v58bSignalForMode(rows, index, mode);\n  const current = longRawForMode(rows[index], mode);\n  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;\n  return current && !previous;\n}'''
if old_signal not in src:
    raise SystemExit('longSignalForMode marker missing')
src = src.replace(old_signal, new_signal, 1)

old_gross = '''    const baseRequestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);\n    const requestedGross = side === "L" ? requestedGrossForLongMode(features, options.longMode, baseRequestedGross) : baseRequestedGross;'''
new_gross = '''    const baseRequestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);\n    const requestedGross = side === "L"\n      ? (v58bModes.includes(options.longMode) ? v58bRequestedGross(features, options.longMode, baseRequestedGross) : requestedGrossForLongMode(features, options.longMode, baseRequestedGross))\n      : baseRequestedGross;'''
if old_gross not in src:
    raise SystemExit('V58 requested gross marker missing')
src = src.replace(old_gross, new_gross, 1)

start = src.index('  const v58 = evaluateV58HigherFrequency(')
end = src.index('\n}\n\nmain().catch', start)
new_tail = r'''  const v58b = evaluateV58bReentry(rows, funding, baselineNormal);
  const selectedMode = (v58b.strictPass ? v58b.selectedMode : "V57_REGIME72_BREAKOUT") as LongMode;
  const candidateNormal = replay(rows, funding, {mode:"normal", longMode:selectedMode}).trades;
  const candidateStress = replay(rows, funding, {mode:"stress", longMode:selectedMode}).trades;
  const finalNormalMetrics=metrics(candidateNormal),finalStressMetrics=metrics(candidateStress);
  const resultPayload={
    status:"PASS_RESEARCH_ONLY",
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true},
    source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},
    longDiagnostics:longDiag,v58b,
    final:{promoted:v58b.strictPass,longMode:selectedMode,normal:finalNormalMetrics,stress:finalStressMetrics},
    safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };
  const ledgerPayload={
    schema:"pengu-dual-ls-v2-aster-ledger/v1",strategyId:PENGU_DUAL_LS_V2.id,
    longVariant:`PENGU_DUAL_LS_V2_FINAL_${selectedMode}`,shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",
    currentProductionSourceSha:SOURCE_SHA,researchOnly:true,
    researchCandidate:{promoted:v58b.strictPass,longMode:selectedMode,shortVeto:null,diagnosticsSchema:"pengu-v58b-recovery-reentry/v1"},
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},
    costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},
    data:{penguRows:pengu.length,btcRows:btc.length,fundingRows:funding.length,availableStart:new Date(pengu[0].openTime).toISOString(),availableEndExclusive:new Date(pengu.at(-1)!.openTime+HOUR).toISOString(),requestedStart:new Date(EVAL_START).toISOString(),requestedEndExclusive:new Date(EVAL_END).toISOString(),coverageNote:"No pre-listing PENGU data is synthesized."},
    integrity:{noOverlap:candidateNormal.every((t,i)=>i===0||t.entryTs>candidateNormal[i-1].exitTs),maximumRequestedGross:Math.max(...candidateNormal.map((t)=>t.requestedGross))},
    modes:{normal:{metrics:finalNormalMetrics,trades:candidateNormal.map(publicTrade)},stress:{metrics:finalStressMetrics,trades:candidateStress.map(publicTrade)}},
    safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };
  assert.equal(ledgerPayload.integrity.noOverlap,true);
  assert.ok(candidateNormal.filter((t)=>t.side==="S").every((t)=>t.requestedGross<=0.75+1e-12));
  assert.ok(candidateNormal.filter((t)=>t.side==="L").every((t)=>t.requestedGross<=0.9375+1e-12));
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v58b-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"candidate-pengu-ledger.json"),JSON.stringify(ledgerPayload,null,2)+"\n","utf8");
  console.log("V58B_RESULT="+JSON.stringify({decision:v58b.decision,selectedMode:v58b.selectedMode,strictPass:v58b.strictPass,frequencyGoalPass:v58b.frequencyGoalPass,normalHoldoutPositive:v58b.normalHoldoutPositive,stressHoldoutPositive:v58b.stressHoldoutPositive,stressRobust:v58b.stressRobust,finalNormal:finalNormalMetrics,finalStress:finalStressMetrics},null,2));
'''
src = src[:start] + new_tail + src[end:]

TARGET.write_text(src)
print(f'PATCHED_V58B={TARGET} bytes={TARGET.stat().st_size}')
