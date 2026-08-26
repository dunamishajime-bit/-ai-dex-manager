from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

old_type = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL";'
new_type = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V58_ONE_FAIL_CORE" | "V58_ONE_OR_TWO_FAIL_CORE" | "V58_ONE_OR_TWO_FAIL_ELITE";'
if old_type not in src:
    raise SystemExit('V57 LongMode marker missing')
src = src.replace(old_type, new_type, 1)

old_iface = '''interface V57Thresholds {\n  relativeReturn24hFloor: number;\n  breakoutAtrFloor: number;\n}'''
new_iface = '''interface V57Thresholds {\n  relativeReturn24hFloor: number;\n  relativeReturn24hEliteFloor: number;\n  breakoutAtrFloor: number;\n  penguReturn24hFloor: number;\n  penguReturn72hFloor: number;\n}'''
if old_iface not in src:
    raise SystemExit('V57Thresholds marker missing')
src = src.replace(old_iface, new_iface, 1)

old_derive = '''  const rel = trainingWinners.map((t) => t.entryFeatures.relativeReturn24h).filter(Number.isFinite);\n  const breakout = trainingWinners.map((t) => breakoutAtrScore(t.entryFeatures)).filter(Number.isFinite);\n  const relativeReturn24hFloor = quantile(rel, 0.25);\n  const breakoutAtrFloor = quantile(breakout, 0.25);\n  assert(relativeReturn24hFloor !== null && breakoutAtrFloor !== null);\n  return {\n    thresholds: { relativeReturn24hFloor, breakoutAtrFloor },'''
new_derive = '''  const rel = trainingWinners.map((t) => t.entryFeatures.relativeReturn24h).filter(Number.isFinite);\n  const breakout = trainingWinners.map((t) => breakoutAtrScore(t.entryFeatures)).filter(Number.isFinite);\n  const ret24 = trainingWinners.map((t) => t.entryFeatures.penguReturn24h).filter(Number.isFinite);\n  const ret72 = trainingWinners.map((t) => t.entryFeatures.penguReturn72h).filter(Number.isFinite);\n  const relativeReturn24hFloor = quantile(rel, 0.25);\n  const relativeReturn24hEliteFloor = quantile(rel, 0.50);\n  const breakoutAtrFloor = quantile(breakout, 0.25);\n  const penguReturn24hFloor = quantile(ret24, 0.25);\n  const penguReturn72hFloor = quantile(ret72, 0.25);\n  assert(relativeReturn24hFloor !== null && relativeReturn24hEliteFloor !== null && breakoutAtrFloor !== null && penguReturn24hFloor !== null && penguReturn72hFloor !== null);\n  return {\n    thresholds: { relativeReturn24hFloor, relativeReturn24hEliteFloor, breakoutAtrFloor, penguReturn24hFloor, penguReturn72hFloor },'''
if old_derive not in src:
    raise SystemExit('threshold derivation marker missing')
src = src.replace(old_derive, new_derive, 1)

marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
const v58Modes: LongMode[] = [
  "V58_ONE_FAIL_CORE",
  "V58_ONE_OR_TWO_FAIL_CORE",
  "V58_ONE_OR_TWO_FAIL_ELITE",
];
const v58CoreGates: LongGate[] = ["regime72", "breakout18", "return24"];
const v58NonCoreGates: LongGate[] = longGateOrder.filter((g) => !v58CoreGates.includes(g));

function v57BreakoutRawFromFeatures(f: PenguDualLsV2Features) {
  assert(v57Thresholds, "V57 thresholds required");
  const passes = longGatePasses(f);
  if (longGateOrder.every((g) => passes[g])) return true;
  const allExceptRegime = longGateOrder.every((g) => g === "regime72" || passes[g]);
  return allExceptRegime && !passes.regime72 && breakoutAtrScore(f) >= v57Thresholds.breakoutAtrFloor;
}

function v58TwoFailStrongCore(f: PenguDualLsV2Features) {
  assert(v57Thresholds, "V57 thresholds required");
  const passes = longGatePasses(f);
  const passingCore = v58CoreGates.filter((g) => passes[g]);
  if (passingCore.length !== 1) return false;
  const gate = passingCore[0];
  if (gate === "regime72") return f.penguReturn72h >= v57Thresholds.penguReturn72hFloor;
  if (gate === "return24") return f.penguReturn24h >= v57Thresholds.penguReturn24hFloor;
  return breakoutAtrScore(f) >= v57Thresholds.breakoutAtrFloor;
}

function v58RecoveryFailureCount(f: PenguDualLsV2Features, mode: LongMode): number | null {
  if (!v58Modes.includes(mode)) return null;
  if (v57BreakoutRawFromFeatures(f)) return 0;
  const passes = longGatePasses(f);
  if (!v58NonCoreGates.every((g) => passes[g])) return null;
  const failures = v58CoreGates.filter((g) => !passes[g]).length;
  if (failures === 1) {
    return f.relativeReturn24h >= v57Thresholds!.relativeReturn24hFloor ? 1 : null;
  }
  if (failures !== 2 || mode === "V58_ONE_FAIL_CORE") return null;
  const relFloor = mode === "V58_ONE_OR_TWO_FAIL_ELITE"
    ? v57Thresholds!.relativeReturn24hEliteFloor
    : v57Thresholds!.relativeReturn24hFloor;
  if (f.relativeReturn24h < relFloor) return null;
  return v58TwoFailStrongCore(f) ? 2 : null;
}

function v58RawForMode(row: PenguDualLsV2EvaluationRow, mode: LongMode) {
  if (!row.features) return false;
  return v58RecoveryFailureCount(row.features, mode) !== null;
}

function requestedGrossForLongMode(f: PenguDualLsV2Features, mode: LongMode, baseGross: number) {
  if (!v58Modes.includes(mode)) return baseGross;
  const failures = v58RecoveryFailureCount(f, mode);
  if (failures === 1) return Math.min(baseGross, 0.625);
  if (failures === 2) return Math.min(baseGross, 0.375);
  return baseGross;
}

function evaluateV58HigherFrequency(
  rows: PenguDualLsV2EvaluationRow[],
  funding: FundingPoint[],
  baselineV56Normal: RichTrade[],
) {
  const derivation = deriveV57Thresholds(baselineV56Normal);
  v57Thresholds = derivation.thresholds;
  const incumbentNormal = replay(rows, funding, {mode:"normal", longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const incumbentStress = replay(rows, funding, {mode:"stress", longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const bLongTrain = sliceByTime(incumbentNormal.filter((t) => t.side === "L"), EVAL_START, HOLDOUT_CUTOFF);
  const bAllTrain = sliceByTime(incumbentNormal, EVAL_START, HOLDOUT_CUTOFF);
  const bLongHold = sliceByTime(incumbentNormal.filter((t) => t.side === "L"), HOLDOUT_CUTOFF, EVAL_END);
  const bAllHold = sliceByTime(incumbentNormal, HOLDOUT_CUTOFF, EVAL_END);
  const bLongStressHold = sliceByTime(incumbentStress.filter((t) => t.side === "L"), HOLDOUT_CUTOFF, EVAL_END);
  const bAllStressHold = sliceByTime(incumbentStress, HOLDOUT_CUTOFF, EVAL_END);
  const base = {
    longTrain:metrics(bLongTrain), allTrain:metrics(bAllTrain),
    longHoldout:metrics(bLongHold), allHoldout:metrics(bAllHold),
    longStressHoldout:metrics(bLongStressHold), allStressHoldout:metrics(bAllStressHold),
    fullNormal:metrics(incumbentNormal), fullStress:metrics(incumbentStress),
  };

  const candidates = v58Modes.map((mode) => {
    const normal = replay(rows, funding, {mode:"normal", longMode:mode}).trades;
    const stress = replay(rows, funding, {mode:"stress", longMode:mode}).trades;
    const longTrainTrades = sliceByTime(normal.filter((t)=>t.side==="L"), EVAL_START, HOLDOUT_CUTOFF);
    const allTrainTrades = sliceByTime(normal, EVAL_START, HOLDOUT_CUTOFF);
    const longHoldoutTrades = sliceByTime(normal.filter((t)=>t.side==="L"), HOLDOUT_CUTOFF, EVAL_END);
    const allHoldoutTrades = sliceByTime(normal, HOLDOUT_CUTOFF, EVAL_END);
    const longStressHoldoutTrades = sliceByTime(stress.filter((t)=>t.side==="L"), HOLDOUT_CUTOFF, EVAL_END);
    const allStressHoldoutTrades = sliceByTime(stress, HOLDOUT_CUTOFF, EVAL_END);
    const replacementAudit = winnerReplacementAudit(bLongTrain.filter((t)=>t.accountReturn>0), longTrainTrades);
    const exactIds = new Set(longTrainTrades.map((t)=>t.signalTs));
    const exactPreserves = bLongTrain.filter((t)=>t.accountReturn>0).every((t)=>exactIds.has(t.signalTs));
    const economicallyPreserves = exactPreserves || replacementAudit.replacements.every((x)=>
      x.replacementAccountReturn !== null && x.replacementAccountReturn + 1e-12 >= x.baselineAccountReturn
    );
    const m = {
      longTrain:metrics(longTrainTrades), allTrain:metrics(allTrainTrades),
      longHoldout:metrics(longHoldoutTrades), allHoldout:metrics(allHoldoutTrades),
      longStressHoldout:metrics(longStressHoldoutTrades), allStressHoldout:metrics(allStressHoldoutTrades),
      fullNormal:metrics(normal), fullStress:metrics(stress),
    };
    const trainingEligible =
      economicallyPreserves
      && m.longTrain.trades >= base.longTrain.trades + 2
      && m.longTrain.returnPct > base.longTrain.returnPct + 1e-9
      && pfAtLeast(m.longTrain, base.longTrain, 0.90)
      && m.longTrain.maxDrawdownPct >= base.longTrain.maxDrawdownPct - 0.75
      && m.allTrain.returnPct > base.allTrain.returnPct + 1e-9
      && pfAtLeast(m.allTrain, base.allTrain, 0.95)
      && m.allTrain.maxDrawdownPct >= base.allTrain.maxDrawdownPct - 0.75;
    return {mode, economicallyPreserves, replacementAudit, trainingEligible, metrics:m,
      deltas:{
        longTrainTrades:m.longTrain.trades-base.longTrain.trades,
        longTrainReturnPct:m.longTrain.returnPct-base.longTrain.returnPct,
        allTrainReturnPct:m.allTrain.returnPct-base.allTrain.returnPct,
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
    schema:"pengu-v58-higher-frequency/v1", derivation, incumbentMode:"V57_REGIME72_BREAKOUT", baseline:base, candidates,
    selectedMode:null, trainingSelectionPass:false, frequencyGoalPass:false, normalHoldoutPositive:false,
    stressHoldoutPositive:false, stressRobust:false, fullNormalImproves:false, strictPass:false, decision:"KEEP_V57_RESEARCH_CANDIDATE",
    reason:"No V58 recovery mode increased training frequency and return while preserving incumbent V57 winners under PF/DD guards.",
  };
  const m=selected.metrics;
  const frequencyGoalPass = m.fullNormal.longTrades >= 20;
  const normalHoldoutPositive =
    m.longHoldout.trades > base.longHoldout.trades
    && m.longHoldout.returnPct > base.longHoldout.returnPct + 1e-9
    && m.allHoldout.returnPct > base.allHoldout.returnPct + 1e-9
    && pfAtLeast(m.allHoldout, base.allHoldout, 0.90)
    && m.allHoldout.maxDrawdownPct >= base.allHoldout.maxDrawdownPct - 0.75;
  const stressHoldoutPositive =
    m.longStressHoldout.trades > base.longStressHoldout.trades
    && m.longStressHoldout.returnPct > base.longStressHoldout.returnPct + 1e-9
    && m.allStressHoldout.returnPct > base.allStressHoldout.returnPct + 1e-9
    && pfAtLeast(m.allStressHoldout, base.allStressHoldout, 0.90)
    && m.allStressHoldout.maxDrawdownPct >= base.allStressHoldout.maxDrawdownPct - 0.75;
  const stressRobust =
    m.fullStress.returnPct >= base.fullStress.returnPct - 1e-9
    && pfAtLeast(m.fullStress, base.fullStress, 0.95)
    && m.fullStress.maxDrawdownPct >= base.fullStress.maxDrawdownPct - 0.75;
  const fullNormalImproves =
    m.fullNormal.returnPct > base.fullNormal.returnPct + 1e-9
    && pfAtLeast(m.fullNormal, base.fullNormal, 0.95)
    && m.fullNormal.maxDrawdownPct >= base.fullNormal.maxDrawdownPct - 0.75;
  const strictPass = frequencyGoalPass && normalHoldoutPositive && stressHoldoutPositive && stressRobust && fullNormalImproves;
  return {
    schema:"pengu-v58-higher-frequency/v1", derivation, incumbentMode:"V57_REGIME72_BREAKOUT", baseline:base, candidates,
    selectedMode:selected.mode, selectedByTrainingOnly:true, selectedTraining:selected, trainingSelectionPass:true,
    frequencyGoalPass, normalHoldoutPositive, stressHoldoutPositive, stressRobust, fullNormalImproves, strictPass,
    decision:strictPass ? "ADOPT_V58_RESEARCH_CANDIDATE" : "KEEP_V57_RESEARCH_CANDIDATE",
    reason:strictPass ? "V58 increased Long frequency to at least 20 and survived untouched Normal/Stress holdout." : "Training-selected V58 failed frequency, holdout, or robustness requirements.",
  };
}
'''
if marker not in src:
    raise SystemExit('longDiagnostics marker missing')
src = src.replace(marker, insert + marker, 1)

old_route = '''  if (row.longRaw) return true;\n  const passes = longGatePasses(row.features);'''
new_route = '''  if (row.longRaw) return true;\n  if (v58Modes.includes(mode)) return v58RawForMode(row, mode);\n  const passes = longGatePasses(row.features);'''
if old_route not in src:
    raise SystemExit('longRawForMode route marker missing')
src = src.replace(old_route, new_route, 1)

old_gross = '    const requestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);'
new_gross = '''    const baseRequestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);\n    const requestedGross = side === "L" ? requestedGrossForLongMode(features, options.longMode, baseRequestedGross) : baseRequestedGross;'''
if old_gross not in src:
    raise SystemExit('replay gross marker missing')
src = src.replace(old_gross, new_gross, 1)

start = src.index('  const v57 = evaluateV57Conditional(')
end = src.index('\n}\n\nmain().catch', start)
new_tail = r'''  const v58 = evaluateV58HigherFrequency(rows, funding, baselineNormal);
  const selectedMode = (v58.strictPass ? v58.selectedMode : "V57_REGIME72_BREAKOUT") as LongMode;
  const candidateNormal = replay(rows, funding, {mode:"normal", longMode:selectedMode}).trades;
  const candidateStress = replay(rows, funding, {mode:"stress", longMode:selectedMode}).trades;
  const finalNormalMetrics = metrics(candidateNormal), finalStressMetrics = metrics(candidateStress);
  const resultPayload = {
    status:"PASS_RESEARCH_ONLY",
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true},
    source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},
    longDiagnostics:longDiag,
    v58,
    final:{promoted:v58.strictPass,longMode:selectedMode,normal:finalNormalMetrics,stress:finalStressMetrics},
    safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };
  const ledgerPayload = {
    schema:"pengu-dual-ls-v2-aster-ledger/v1", strategyId:PENGU_DUAL_LS_V2.id,
    longVariant:`PENGU_DUAL_LS_V2_FINAL_${selectedMode}`,
    shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT", currentProductionSourceSha:SOURCE_SHA, researchOnly:true,
    researchCandidate:{promoted:v58.strictPass,longMode:selectedMode,shortVeto:null,diagnosticsSchema:"pengu-v58-higher-frequency/v1"},
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
  await fs.writeFile(path.join(OUTPUT_DIR,"v58-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"candidate-pengu-ledger.json"),JSON.stringify(ledgerPayload,null,2)+"\n","utf8");
  console.log("V58_RESULT="+JSON.stringify({
    decision:v58.decision, selectedMode:v58.selectedMode, strictPass:v58.strictPass,
    frequencyGoalPass:v58.frequencyGoalPass, normalHoldoutPositive:v58.normalHoldoutPositive,
    stressHoldoutPositive:v58.stressHoldoutPositive, stressRobust:v58.stressRobust,
    finalNormal:finalNormalMetrics, finalStress:finalStressMetrics,
  },null,2));
'''
src = src[:start] + new_tail + src[end:]

TARGET.write_text(src)
print(f'PATCHED_V58={TARGET} bytes={TARGET.stat().st_size}')
