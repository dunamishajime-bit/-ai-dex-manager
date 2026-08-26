from pathlib import Path

SOURCE = Path("scripts/research_pengu_v56_v20_diagnostics.ts")
OUTPUT = Path(".pengu-current/scripts/.research_pengu_v57.generated.ts")

src = SOURCE.read_text()
src = src.replace(
    'type LongMode = "EDGE" | "RAW_REENTRY";',
    'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_BYPASS_BREAKOUT18" | "V57_BYPASS_REGIME72" | "V57_BYPASS_RETURN24";',
)
src = src.replace(
    'const longSignal = options.longMode === "RAW_REENTRY" ? rows[index].longRaw : rows[index].longSignal;',
    'const longSignal = longSignalForMode(rows, index, options.longMode);',
)

marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
const v57BypassGate: Partial<Record<LongMode, LongGate>> = {
  V57_BYPASS_BREAKOUT18: "breakout18",
  V57_BYPASS_REGIME72: "regime72",
  V57_BYPASS_RETURN24: "return24",
};

function longRawForMode(row: PenguDualLsV2EvaluationRow, mode: LongMode) {
  if (!row.features) return false;
  if (mode === "EDGE" || mode === "RAW_REENTRY") return row.longRaw;
  const bypass = v57BypassGate[mode];
  assert(bypass, `missing bypass gate for ${mode}`);
  const passes = longGatePasses(row.features);
  return longGateOrder.every((gate) => gate === bypass || passes[gate]);
}

function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {
  if (mode === "EDGE") return rows[index].longSignal;
  if (mode === "RAW_REENTRY") return rows[index].longRaw;
  const current = longRawForMode(rows[index], mode);
  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;
  return current && !previous;
}

function pfAtLeast(candidate: ReturnType<typeof metrics>, baseline: ReturnType<typeof metrics>, multiple: number) {
  if (baseline.profitFactor === null) return candidate.profitFactor === null || (candidate.profitFactor ?? 0) > 0;
  return (candidate.profitFactor ?? 0) + 1e-9 >= baseline.profitFactor * multiple;
}

function evaluateV57(
  rows: PenguDualLsV2EvaluationRow[],
  funding: FundingPoint[],
  baselineNormal: RichTrade[],
  baselineStress: RichTrade[],
) {
  const modes: LongMode[] = [
    "V57_BYPASS_BREAKOUT18",
    "V57_BYPASS_REGIME72",
    "V57_BYPASS_RETURN24",
  ];
  const bLongTrain = sliceByTime(baselineNormal.filter((t) => t.side === "L"), EVAL_START, HOLDOUT_CUTOFF);
  const bAllTrain = sliceByTime(baselineNormal, EVAL_START, HOLDOUT_CUTOFF);
  const bLongHold = sliceByTime(baselineNormal.filter((t) => t.side === "L"), HOLDOUT_CUTOFF, EVAL_END);
  const bAllHold = sliceByTime(baselineNormal, HOLDOUT_CUTOFF, EVAL_END);
  const bLongStressHold = sliceByTime(baselineStress.filter((t) => t.side === "L"), HOLDOUT_CUTOFF, EVAL_END);
  const bAllStressHold = sliceByTime(baselineStress, HOLDOUT_CUTOFF, EVAL_END);
  const base = {
    longTrain: metrics(bLongTrain),
    allTrain: metrics(bAllTrain),
    longHoldout: metrics(bLongHold),
    allHoldout: metrics(bAllHold),
    longStressHoldout: metrics(bLongStressHold),
    allStressHoldout: metrics(bAllStressHold),
    fullNormal: metrics(baselineNormal),
    fullStress: metrics(baselineStress),
  };
  const protectedLongWinnerIds = new Set(
    bLongTrain.filter((t) => t.accountReturn > 0).map((t) => t.signalTs),
  );

  const candidates = modes.map((mode) => {
    const normal = replay(rows, funding, { mode: "normal", longMode: mode }).trades;
    const stress = replay(rows, funding, { mode: "stress", longMode: mode }).trades;
    const cLongTrainTrades = sliceByTime(normal.filter((t) => t.side === "L"), EVAL_START, HOLDOUT_CUTOFF);
    const cAllTrainTrades = sliceByTime(normal, EVAL_START, HOLDOUT_CUTOFF);
    const cLongHoldTrades = sliceByTime(normal.filter((t) => t.side === "L"), HOLDOUT_CUTOFF, EVAL_END);
    const cAllHoldTrades = sliceByTime(normal, HOLDOUT_CUTOFF, EVAL_END);
    const cLongStressHoldTrades = sliceByTime(stress.filter((t) => t.side === "L"), HOLDOUT_CUTOFF, EVAL_END);
    const cAllStressHoldTrades = sliceByTime(stress, HOLDOUT_CUTOFF, EVAL_END);
    const trainLongIds = new Set(cLongTrainTrades.map((t) => t.signalTs));
    const m = {
      longTrain: metrics(cLongTrainTrades),
      allTrain: metrics(cAllTrainTrades),
      longHoldout: metrics(cLongHoldTrades),
      allHoldout: metrics(cAllHoldTrades),
      longStressHoldout: metrics(cLongStressHoldTrades),
      allStressHoldout: metrics(cAllStressHoldTrades),
      fullNormal: metrics(normal),
      fullStress: metrics(stress),
    };
    const protectsTrainingWinners = [...protectedLongWinnerIds].every((id) => trainLongIds.has(id));
    const trainingEligible =
      protectsTrainingWinners
      && m.longTrain.trades > base.longTrain.trades
      && m.longTrain.returnPct > base.longTrain.returnPct + 1e-9
      && pfAtLeast(m.longTrain, base.longTrain, 0.95)
      && m.longTrain.maxDrawdownPct >= base.longTrain.maxDrawdownPct - 1.0
      && m.allTrain.returnPct > base.allTrain.returnPct + 1e-9
      && pfAtLeast(m.allTrain, base.allTrain, 0.98)
      && m.allTrain.maxDrawdownPct >= base.allTrain.maxDrawdownPct - 0.5;
    return {
      mode,
      bypassGate: v57BypassGate[mode],
      protectsTrainingWinners,
      trainingEligible,
      metrics: m,
      deltas: {
        longTrainReturnPct: m.longTrain.returnPct - base.longTrain.returnPct,
        allTrainReturnPct: m.allTrain.returnPct - base.allTrain.returnPct,
        longHoldoutReturnPct: m.longHoldout.returnPct - base.longHoldout.returnPct,
        allHoldoutReturnPct: m.allHoldout.returnPct - base.allHoldout.returnPct,
        allStressHoldoutReturnPct: m.allStressHoldout.returnPct - base.allStressHoldout.returnPct,
        fullNormalReturnPct: m.fullNormal.returnPct - base.fullNormal.returnPct,
        fullStressReturnPct: m.fullStress.returnPct - base.fullStress.returnPct,
      },
    };
  });

  const trainEligible = candidates
    .filter((x) => x.trainingEligible)
    .sort((a, b) =>
      b.deltas.allTrainReturnPct - a.deltas.allTrainReturnPct
      || b.deltas.longTrainReturnPct - a.deltas.longTrainReturnPct
    );
  const selected = trainEligible[0] ?? null;
  if (!selected) {
    return {
      schema: "pengu-v57-causal-gate-validation/v1",
      baseline: base,
      candidates,
      selectedMode: null,
      trainingSelectionPass: false,
      normalHoldoutPositive: false,
      stressHoldoutPositive: false,
      stressRobust: false,
      fullNormalImproves: false,
      strictPass: false,
      decision: "KEEP_V56",
      reason: "No preregistered causal single-gate bypass improved training under winner/PF/DD guards.",
    };
  }

  const m = selected.metrics;
  const normalHoldoutPositive =
    m.longHoldout.trades > base.longHoldout.trades
    && m.longHoldout.returnPct > base.longHoldout.returnPct + 1e-9
    && m.allHoldout.returnPct > base.allHoldout.returnPct + 1e-9
    && pfAtLeast(m.allHoldout, base.allHoldout, 0.95)
    && m.allHoldout.maxDrawdownPct >= base.allHoldout.maxDrawdownPct - 0.5;
  const stressHoldoutPositive =
    m.longStressHoldout.trades > base.longStressHoldout.trades
    && m.longStressHoldout.returnPct > base.longStressHoldout.returnPct + 1e-9
    && m.allStressHoldout.returnPct > base.allStressHoldout.returnPct + 1e-9
    && pfAtLeast(m.allStressHoldout, base.allStressHoldout, 0.95)
    && m.allStressHoldout.maxDrawdownPct >= base.allStressHoldout.maxDrawdownPct - 0.75;
  const stressRobust =
    m.fullStress.returnPct >= base.fullStress.returnPct - 1e-9
    && pfAtLeast(m.fullStress, base.fullStress, 0.98)
    && m.fullStress.maxDrawdownPct >= base.fullStress.maxDrawdownPct - 0.75;
  const fullNormalImproves =
    m.fullNormal.returnPct > base.fullNormal.returnPct + 1e-9
    && pfAtLeast(m.fullNormal, base.fullNormal, 0.98)
    && m.fullNormal.maxDrawdownPct >= base.fullNormal.maxDrawdownPct - 0.75;
  const strictPass = normalHoldoutPositive && stressHoldoutPositive && stressRobust && fullNormalImproves;
  return {
    schema: "pengu-v57-causal-gate-validation/v1",
    baseline: base,
    candidates,
    selectedMode: selected.mode,
    selectedByTrainingOnly: true,
    selectedTraining: selected,
    trainingSelectionPass: true,
    normalHoldoutPositive,
    stressHoldoutPositive,
    stressRobust,
    fullNormalImproves,
    strictPass,
    decision: strictPass ? "ADOPT_V57_RESEARCH_CANDIDATE" : "KEEP_V56",
    reason: strictPass
      ? "Selected causal gate bypass improved untouched chronological holdout in both Normal and Stress."
      : "Training winner did not produce positive untouched holdout improvement in both Normal and Stress under PF/DD guards.",
  };
}
'''
if marker not in src:
    raise SystemExit("longDiagnostics marker missing")
src = src.replace(marker, insert + marker, 1)

start = src.index("  const shortBaseline = baselineNormal.filter")
end = src.index("\n}\n\nmain().catch", start)
tail = r'''  const v57 = evaluateV57(rows, funding, baselineNormal, baselineStress);
  const selectedMode = (v57.selectedMode ?? "EDGE") as LongMode;
  const candidateNormalReplay = replay(rows, funding, {mode:"normal", longMode:selectedMode});
  const candidateStressReplay = replay(rows, funding, {mode:"stress", longMode:selectedMode});
  const candidateNormal = candidateNormalReplay.trades;
  const candidateStress = candidateStressReplay.trades;
  const promoted = v57.strictPass === true;
  const finalNormal = promoted ? candidateNormal : baselineNormal;
  const finalStress = promoted ? candidateStress : baselineStress;
  const finalNormalMetrics = metrics(finalNormal);
  const finalStressMetrics = metrics(finalStress);

  const resultPayload = {
    status:"PASS_RESEARCH_ONLY",
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true},
    source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},
    longDiagnostics:longDiag,
    v57,
    final:{promoted,longMode:promoted?selectedMode:"EDGE",normal:finalNormalMetrics,stress:finalStressMetrics},
    safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };
  const ledgerPayload = {
    schema:"pengu-dual-ls-v2-aster-ledger/v1",
    strategyId:PENGU_DUAL_LS_V2.id,
    longVariant:promoted ? `PENGU_DUAL_LS_V2_FINAL_${selectedMode}` : "PENGU_DUAL_LS_V2_FINAL_V56_SIDE_AWARE",
    shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",
    currentProductionSourceSha:SOURCE_SHA,
    researchOnly:true,
    researchCandidate:{promoted,longMode:promoted?selectedMode:"EDGE",shortVeto:null,diagnosticsSchema:"pengu-v57-causal-gate-validation/v1"},
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},
    costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},
    data:{penguRows:pengu.length,btcRows:btc.length,fundingRows:funding.length,availableStart:new Date(pengu[0].openTime).toISOString(),availableEndExclusive:new Date(pengu.at(-1)!.openTime+HOUR).toISOString(),requestedStart:new Date(EVAL_START).toISOString(),requestedEndExclusive:new Date(EVAL_END).toISOString(),coverageNote:"No pre-listing PENGU data is synthesized."},
    integrity:{noOverlap:finalNormal.every((t,i)=>i===0||t.entryTs>finalNormal[i-1].exitTs),maximumRequestedGross:Math.max(...finalNormal.map((t)=>t.requestedGross))},
    modes:{normal:{metrics:finalNormalMetrics,trades:finalNormal.map(publicTrade)},stress:{metrics:finalStressMetrics,trades:finalStress.map(publicTrade)}},
    safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };
  assert.equal(ledgerPayload.integrity.noOverlap,true);
  assert.ok(finalNormal.filter((t)=>t.side==="S").every((t)=>t.requestedGross<=0.75+1e-12));
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v57-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"candidate-pengu-ledger.json"),JSON.stringify(ledgerPayload,null,2)+"\n","utf8");
  console.log("V57_RESULT="+JSON.stringify({decision:v57.decision,selectedMode:v57.selectedMode,strictPass:v57.strictPass,normalHoldoutPositive:v57.normalHoldoutPositive,stressHoldoutPositive:v57.stressHoldoutPositive,stressRobust:v57.stressRobust,candidates:v57.candidates},null,2));'''
src = src[:start] + tail + src[end:]
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(src)
print(f"GENERATED={OUTPUT} bytes={OUTPUT.stat().st_size}")
