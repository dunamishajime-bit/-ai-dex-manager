from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

old_type = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL";'
new_type = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V59_RSI_HIGH_RECOVERY" | "V59_VOLUME_HIGH_RECOVERY" | "V59_RSI_OR_VOLUME_RECOVERY";'
if old_type not in src:
    raise SystemExit('V57 LongMode marker missing')
src = src.replace(old_type, new_type, 1)

marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
const v59Modes: LongMode[] = [
  "V59_RSI_HIGH_RECOVERY",
  "V59_VOLUME_HIGH_RECOVERY",
  "V59_RSI_OR_VOLUME_RECOVERY",
];

function v59GateAllowed(mode: LongMode, gate: LongGate) {
  if (mode === "V59_RSI_HIGH_RECOVERY") return gate === "rsiMax";
  if (mode === "V59_VOLUME_HIGH_RECOVERY") return gate === "volumeMax";
  return mode === "V59_RSI_OR_VOLUME_RECOVERY" && (gate === "rsiMax" || gate === "volumeMax");
}

function v59RecoveryOnlyRaw(row: PenguDualLsV2EvaluationRow, mode: LongMode) {
  if (!row.features || !v59Modes.includes(mode)) return false;
  const passes = longGatePasses(row.features);
  const failed = longGateOrder.filter((g) => !passes[g]);
  return failed.length === 1 && v59GateAllowed(mode, failed[0]);
}

function v59SignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {
  assert(v59Modes.includes(mode), `not V59 mode: ${mode}`);
  const nativeCurrent = longRawForMode(rows[index], "V57_REGIME72_BREAKOUT");
  const nativePrevious = index > 0 ? longRawForMode(rows[index - 1], "V57_REGIME72_BREAKOUT") : false;
  if (nativeCurrent && !nativePrevious) return true;
  if (nativeCurrent) return false;
  const recoveryCurrent = v59RecoveryOnlyRaw(rows[index], mode);
  const recoveryPrevious = index > 0 ? v59RecoveryOnlyRaw(rows[index - 1], mode) : false;
  return recoveryCurrent && !recoveryPrevious;
}

function v59RequestedGross(row: PenguDualLsV2EvaluationRow, mode: LongMode, baseGross: number) {
  if (!v59Modes.includes(mode)) return baseGross;
  if (longRawForMode(row, "V57_REGIME72_BREAKOUT")) return baseGross;
  return v59RecoveryOnlyRaw(row, mode) ? Math.min(baseGross, 0.375) : baseGross;
}

function evaluateV59NearMiss(
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

  const candidates = v59Modes.map((mode) => {
    const normal = replay(rows, funding, {mode:"normal", longMode:mode}).trades;
    const stress = replay(rows, funding, {mode:"stress", longMode:mode}).trades;
    const cLongTrain = sliceByTime(normal.filter((t)=>t.side==="L"),EVAL_START,HOLDOUT_CUTOFF);
    const cAllTrain = sliceByTime(normal,EVAL_START,HOLDOUT_CUTOFF);
    const cLongHold = sliceByTime(normal.filter((t)=>t.side==="L"),HOLDOUT_CUTOFF,EVAL_END);
    const cAllHold = sliceByTime(normal,HOLDOUT_CUTOFF,EVAL_END);
    const cLongStressHold = sliceByTime(stress.filter((t)=>t.side==="L"),HOLDOUT_CUTOFF,EVAL_END);
    const cAllStressHold = sliceByTime(stress,HOLDOUT_CUTOFF,EVAL_END);
    const replacementAudit = winnerReplacementAudit(bLongTrain.filter((t)=>t.accountReturn>0), cLongTrain);
    const ids = new Set(cLongTrain.map((t)=>t.signalTs));
    const exactPreserves = bLongTrain.filter((t)=>t.accountReturn>0).every((t)=>ids.has(t.signalTs));
    const economicallyPreserves = exactPreserves || replacementAudit.replacements.every((x)=>
      x.replacementAccountReturn !== null && x.replacementAccountReturn + 1e-12 >= x.baselineAccountReturn
    );
    const m = {
      longTrain:metrics(cLongTrain), allTrain:metrics(cAllTrain),
      longHoldout:metrics(cLongHold), allHoldout:metrics(cAllHold),
      longStressHoldout:metrics(cLongStressHold), allStressHoldout:metrics(cAllStressHold),
      fullNormal:metrics(normal), fullStress:metrics(stress),
    };
    const trainingEligible =
      economicallyPreserves
      && m.longTrain.trades >= base.longTrain.trades + 2
      && m.longTrain.returnPct > base.longTrain.returnPct + 1e-9
      && pfAtLeast(m.longTrain,base.longTrain,0.90)
      && m.longTrain.maxDrawdownPct >= base.longTrain.maxDrawdownPct - 0.75
      && m.allTrain.returnPct > base.allTrain.returnPct + 1e-9
      && pfAtLeast(m.allTrain,base.allTrain,0.95)
      && m.allTrain.maxDrawdownPct >= base.allTrain.maxDrawdownPct - 0.75;
    return {mode,economicallyPreserves,replacementAudit,trainingEligible,metrics:m,deltas:{
      longTrainTrades:m.longTrain.trades-base.longTrain.trades,
      longTrainReturnPct:m.longTrain.returnPct-base.longTrain.returnPct,
      allTrainReturnPct:m.allTrain.returnPct-base.allTrain.returnPct,
      longHoldoutTrades:m.longHoldout.trades-base.longHoldout.trades,
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
    schema:"pengu-v59-rsi-volume-nearmiss/v1",derivation,incumbentMode:"V57_REGIME72_BREAKOUT",baseline:base,candidates,
    selectedMode:null,trainingSelectionPass:false,frequencyGoalPass:false,normalHoldoutPositive:false,stressHoldoutPositive:false,
    stressRobust:false,fullNormalImproves:false,strictPass:false,decision:"KEEP_V57_RESEARCH_CANDIDATE",
    reason:"RSI/volume near-miss recoveries did not improve training under winner/PF/DD guards.",
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
    schema:"pengu-v59-rsi-volume-nearmiss/v1",derivation,incumbentMode:"V57_REGIME72_BREAKOUT",baseline:base,candidates,
    selectedMode:selected.mode,selectedByTrainingOnly:true,selectedTraining:selected,trainingSelectionPass:true,frequencyGoalPass,
    normalHoldoutPositive,stressHoldoutPositive,stressRobust,fullNormalImproves,strictPass,
    decision:strictPass?"ADOPT_V59_RESEARCH_CANDIDATE":"KEEP_V57_RESEARCH_CANDIDATE",
    reason:strictPass?"V59 increased Long frequency and survived untouched Normal/Stress holdout.":"Training-selected V59 failed frequency, holdout, or robustness requirements.",
  };
}
'''
if marker not in src:
    raise SystemExit('longDiagnostics marker missing')
src = src.replace(marker, insert + marker, 1)

old_raw_tail = '''  if (mode === "V57_REGIME72_DUAL") return relativeStrong && breakoutStrong;\n  return false;'''
new_raw_tail = '''  if (mode === "V57_REGIME72_DUAL") return relativeStrong && breakoutStrong;\n  if (v59Modes.includes(mode)) return row.longRaw || v59RecoveryOnlyRaw(row, mode);\n  return false;'''
if old_raw_tail not in src:
    raise SystemExit('longRawForMode tail marker missing')
src = src.replace(old_raw_tail,new_raw_tail,1)

old_signal = '''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {\n  if (mode === "EDGE") return rows[index].longSignal;\n  if (mode === "RAW_REENTRY") return rows[index].longRaw;\n  const current = longRawForMode(rows[index], mode);\n  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;\n  return current && !previous;\n}'''
new_signal = '''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {\n  if (mode === "EDGE") return rows[index].longSignal;\n  if (mode === "RAW_REENTRY") return rows[index].longRaw;\n  if (v59Modes.includes(mode)) return v59SignalForMode(rows,index,mode);\n  const current = longRawForMode(rows[index], mode);\n  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;\n  return current && !previous;\n}'''
if old_signal not in src:
    raise SystemExit('longSignalForMode marker missing')
src = src.replace(old_signal,new_signal,1)

old_gross = '    const requestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);'
new_gross = '''    const baseRequestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);\n    const requestedGross = side === "L" && v59Modes.includes(options.longMode)\n      ? v59RequestedGross(rows[index], options.longMode, baseRequestedGross)\n      : baseRequestedGross;'''
if old_gross not in src:
    raise SystemExit('requestedGross marker missing')
src = src.replace(old_gross,new_gross,1)

start = src.index('  const v57 = evaluateV57Conditional(')
end = src.index('\n}\n\nmain().catch', start)
new_tail = r'''  const v59 = evaluateV59NearMiss(rows,funding,baselineNormal);
  const selectedMode=(v59.strictPass?v59.selectedMode:"V57_REGIME72_BREAKOUT") as LongMode;
  const candidateNormal=replay(rows,funding,{mode:"normal",longMode:selectedMode}).trades;
  const candidateStress=replay(rows,funding,{mode:"stress",longMode:selectedMode}).trades;
  const finalNormalMetrics=metrics(candidateNormal),finalStressMetrics=metrics(candidateStress);
  const resultPayload={
    status:"PASS_RESEARCH_ONLY",
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true},
    source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},
    longDiagnostics:longDiag,v59,
    final:{promoted:v59.strictPass,longMode:selectedMode,normal:finalNormalMetrics,stress:finalStressMetrics},
    safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };
  const ledgerPayload={
    schema:"pengu-dual-ls-v2-aster-ledger/v1",strategyId:PENGU_DUAL_LS_V2.id,
    longVariant:`PENGU_DUAL_LS_V2_FINAL_${selectedMode}`,shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",
    currentProductionSourceSha:SOURCE_SHA,researchOnly:true,
    researchCandidate:{promoted:v59.strictPass,longMode:selectedMode,shortVeto:null,diagnosticsSchema:"pengu-v59-rsi-volume-nearmiss/v1"},
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
  await fs.writeFile(path.join(OUTPUT_DIR,"v59-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"candidate-pengu-ledger.json"),JSON.stringify(ledgerPayload,null,2)+"\n","utf8");
  console.log("V59_RESULT="+JSON.stringify({decision:v59.decision,selectedMode:v59.selectedMode,strictPass:v59.strictPass,frequencyGoalPass:v59.frequencyGoalPass,normalHoldoutPositive:v59.normalHoldoutPositive,stressHoldoutPositive:v59.stressHoldoutPositive,stressRobust:v59.stressRobust,finalNormal:finalNormalMetrics,finalStress:finalStressMetrics},null,2));
'''
src=src[:start]+new_tail+src[end:]

TARGET.write_text(src)
print(f'PATCHED_V59={TARGET} bytes={TARGET.stat().st_size}')
