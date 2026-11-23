from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

old = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V64_DYNAMIC";'
new = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V64_DYNAMIC" | "V65_DYNAMIC";'
if old not in src:
    raise SystemExit('V64 LongMode marker missing')
src = src.replace(old, new, 1)

old = '  if (mode === "V57_REGIME72_BREAKOUT" || mode === "V64_DYNAMIC") return breakoutStrong;'
new = '  if (mode === "V57_REGIME72_BREAKOUT" || mode === "V64_DYNAMIC" || mode === "V65_DYNAMIC") return breakoutStrong;'
if old not in src:
    raise SystemExit('V64 breakout alias marker missing')
src = src.replace(old, new, 1)

old = '''    let requestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);
    if (side === "L" && options.longMode === "V64_DYNAMIC" && !rows[index].longRaw) {
      requestedGross = v64SupplementalGross(features, requestedGross);
    }'''
new = '''    let requestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);
    if (side === "L" && (options.longMode === "V64_DYNAMIC" || options.longMode === "V65_DYNAMIC") && !rows[index].longRaw) {
      requestedGross = v64SupplementalGross(features, requestedGross);
    }'''
if old not in src:
    raise SystemExit('V64 sizing marker missing')
src = src.replace(old, new, 1)

old = '''    const hold = side === "L" ? PENGU_DUAL_LS_V2.long.maxHoldHours : PENGU_DUAL_LS_V2.short.maxHoldHours;
    const last = Math.min(rows.length - 1, entryIndex + hold - 1);'''
new = '''    const v65Supplemental = side === "L" && options.longMode === "V65_DYNAMIC" && !rows[index].longRaw;
    const v65ExitConfig = v65Supplemental ? v65ActiveConfig : null;
    const hold = side === "L"
      ? (v65ExitConfig?.maxHoldHours ?? PENGU_DUAL_LS_V2.long.maxHoldHours)
      : PENGU_DUAL_LS_V2.short.maxHoldHours;
    const last = Math.min(rows.length - 1, entryIndex + hold - 1);'''
if old not in src:
    raise SystemExit('replay hold marker missing')
src = src.replace(old, new, 1)

old = '''      const evaluation = evaluatePenguDualLsV2PositionBar(position, f);
      position = evaluation.updatedPosition;
      if (evaluation.exit) {'''
new = '''      const evaluation = v65ExitConfig && side === "L"
        ? evaluateV65LongPositionBar(position, f, v65ExitConfig)
        : evaluatePenguDualLsV2PositionBar(position, f);
      position = evaluation.updatedPosition;
      if (evaluation.exit) {'''
if old not in src:
    raise SystemExit('replay evaluation marker missing')
src = src.replace(old, new, 1)

marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
type V65Config = {
  label:string;
  hardStopPct:number;
  trailingActivationPct:number;
  trailingRetracePct:number;
  maxHoldHours:number;
  trainScore:number;
};
type V65LongExitEvaluation = {
  exit?: {
    side:-1;
    reason:"LONG_HARD_STOP"|"LONG_TRAILING_STOP"|"LONG_MAX_HOLD";
    stopPrice?:number;
    updatedPosition:PenguDualLsV2Position;
  };
  updatedPosition:PenguDualLsV2Position;
};
let v65ActiveConfig:V65Config|null=null;

const v65Profiles:Array<Omit<V65Config,"trainScore">> = [
  {label:"FAST",hardStopPct:0.04,trailingActivationPct:0.05,trailingRetracePct:0.02,maxHoldHours:36},
  {label:"BALANCED",hardStopPct:0.05,trailingActivationPct:0.07,trailingRetracePct:0.025,maxHoldHours:48},
  {label:"WIDE",hardStopPct:0.06,trailingActivationPct:0.08,trailingRetracePct:0.025,maxHoldHours:72},
  {label:"BASE_EXIT_72",hardStopPct:0.08,trailingActivationPct:0.10,trailingRetracePct:0.03,maxHoldHours:72},
  {label:"BASE_EXIT_96",hardStopPct:0.08,trailingActivationPct:0.10,trailingRetracePct:0.03,maxHoldHours:96},
  {label:"BASELINE_120",hardStopPct:0.08,trailingActivationPct:0.10,trailingRetracePct:0.03,maxHoldHours:120},
];

function evaluateV65LongPositionBar(
  position:PenguDualLsV2Position,
  features:PenguDualLsV2Features,
  config:V65Config,
):V65LongExitEvaluation {
  const previousBest=Math.max(position.entryPrice,position.highWaterMark);
  const hard=position.entryPrice*(1-config.hardStopPct);
  if(features.low<=hard) {
    return {exit:{side:-1,reason:"LONG_HARD_STOP",stopPrice:hard,updatedPosition:position},updatedPosition:position};
  }
  const trailing=previousBest*(1-config.trailingRetracePct);
  if(previousBest/position.entryPrice-1>=config.trailingActivationPct && features.low<=trailing) {
    return {exit:{side:-1,reason:"LONG_TRAILING_STOP",stopPrice:trailing,updatedPosition:position},updatedPosition:position};
  }
  const updated={...position,highWaterMark:Math.max(previousBest,features.high)};
  if(features.referenceTs>=position.entryTs+(config.maxHoldHours-1)*HOUR) {
    return {exit:{side:-1,reason:"LONG_MAX_HOLD",updatedPosition:updated},updatedPosition:updated};
  }
  return {updatedPosition:updated};
}

function v65TradeIdentityEqual(a:RichTrade[],b:RichTrade[]) {
  return a.length===b.length && a.every((t,i)=>t.side===b[i].side && t.signalTs===b[i].signalTs);
}
function v65SizingEqual(a:RichTrade[],b:RichTrade[]) {
  return a.length===b.length && a.every((t,i)=>Math.abs(t.requestedGross-b[i].requestedGross)<=1e-12);
}
function v65SupplementalTrade(t:RichTrade) {
  return t.side==="L" && !longGatePasses(t.entryFeatures).regime72;
}

function evaluateV65(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],baselineV56Normal:RichTrade[]) {
  const v64=evaluateV64(rows,funding,baselineV56Normal);
  const selectedV64=v64.selectedConfig as V64Config|null;
  assert(v64.strictPass===true && selectedV64,"V65 requires formally-passing V64 incumbent");
  v64ActiveConfig=selectedV64;
  v65ActiveConfig=null;
  const incN=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  const incS=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
  const sl=(x:RichTrade[],a:number,b:number)=>sliceByTime(x,a,b);
  const incNT=sl(incN,EVAL_START,HOLDOUT_CUTOFF),incST=sl(incS,EVAL_START,HOLDOUT_CUTOFF);
  const incNH=sl(incN,HOLDOUT_CUTOFF,EVAL_END),incSH=sl(incS,HOLDOUT_CUTOFF,EVAL_END);
  const base={
    allTrain:metrics(incNT),allStressTrain:metrics(incST),
    allHoldout:metrics(incNH),allStressHoldout:metrics(incSH),
    fullNormal:metrics(incN),fullStress:metrics(incS),
    supplementalTrain:metrics(incNT.filter(v65SupplementalTrade)),
    supplementalHoldout:metrics(incNH.filter(v65SupplementalTrade)),
  };

  const evaluated:Array<any>=[];
  for(const p of v65Profiles) {
    const cfg:V65Config={...p,trainScore:0};
    v65ActiveConfig=cfg;
    const n=replay(rows,funding,{mode:"normal",longMode:"V65_DYNAMIC"}).trades;
    const s=replay(rows,funding,{mode:"stress",longMode:"V65_DYNAMIC"}).trades;
    const nt=sl(n,EVAL_START,HOLDOUT_CUTOFF),st=sl(s,EVAL_START,HOLDOUT_CUTOFF);
    const m={allTrain:metrics(nt),allStressTrain:metrics(st),supplementalTrain:metrics(nt.filter(v65SupplementalTrade))};
    const sameTrainIdentity=v65TradeIdentityEqual(nt,incNT)&&v65TradeIdentityEqual(st,incST);
    const sameTrainSizing=v65SizingEqual(nt,incNT)&&v65SizingEqual(st,incST);
    const normalReturnDelta=m.allTrain.returnPct-base.allTrain.returnPct;
    const stressReturnDelta=m.allStressTrain.returnPct-base.allStressTrain.returnPct;
    const normalDdDelta=m.allTrain.maxDrawdownPct-base.allTrain.maxDrawdownPct;
    const stressDdDelta=m.allStressTrain.maxDrawdownPct-base.allStressTrain.maxDrawdownPct;
    const trainingEligible=sameTrainIdentity&&sameTrainSizing
      && normalReturnDelta>1e-9
      && stressReturnDelta>=-1e-9
      && pfAtLeast(m.allTrain,base.allTrain,.995)
      && pfAtLeast(m.allStressTrain,base.allStressTrain,.995)
      && normalDdDelta>=-1e-9
      && stressDdDelta>=-1e-9;
    const trainScore=normalReturnDelta+stressReturnDelta*.5+Math.max(0,normalDdDelta)*.25+Math.max(0,stressDdDelta)*.125;
    evaluated.push({
      config:{...cfg,trainScore},trainingEligible,sameTrainIdentity,sameTrainSizing,metrics:m,
      deltas:{normalReturnPct:normalReturnDelta,stressReturnPct:stressReturnDelta,normalDdPctPoint:normalDdDelta,stressDdPctPoint:stressDdDelta},
    });
  }
  const eligible=evaluated.filter(x=>x.trainingEligible).sort((a,b)=>
    b.config.trainScore-a.config.trainScore
    || b.deltas.normalReturnPct-a.deltas.normalReturnPct
    || a.config.maxHoldHours-b.config.maxHoldHours
  );
  const selectedTrain=eligible[0]??null;
  if(!selectedTrain) {
    v65ActiveConfig=null;
    return {
      schema:"pengu-v65-supplemental-exit/v1",v64Incumbent:v64,incumbent:base,
      candidateCount:evaluated.length,eligibleCount:0,topTraining:evaluated.sort((a,b)=>b.config.trainScore-a.config.trainScore),
      selectedConfig:null,trainingEligible:false,sameFrequency:false,normalHoldoutPositive:false,stressHoldoutPositive:false,
      stressRobust:false,fullNormalImproves:false,strictPass:false,decision:"KEEP_V64_RESEARCH_CANDIDATE",
      reason:"No preregistered supplemental-Long exit profile improved V64 on Train under Normal/Stress PF/DD and identity guards.",
    };
  }

  v65ActiveConfig=selectedTrain.config;
  const n=replay(rows,funding,{mode:"normal",longMode:"V65_DYNAMIC"}).trades;
  const s=replay(rows,funding,{mode:"stress",longMode:"V65_DYNAMIC"}).trades;
  const nh=sl(n,HOLDOUT_CUTOFF,EVAL_END),sh=sl(s,HOLDOUT_CUTOFF,EVAL_END);
  const m={
    allHoldout:metrics(nh),allStressHoldout:metrics(sh),
    fullNormal:metrics(n),fullStress:metrics(s),
    supplementalHoldout:metrics(nh.filter(v65SupplementalTrade)),
  };
  const sameFrequency=v65TradeIdentityEqual(n,incN)&&v65TradeIdentityEqual(s,incS)&&v65SizingEqual(n,incN)&&v65SizingEqual(s,incS);
  const normalHoldoutPositive=v65TradeIdentityEqual(nh,incNH)
    && m.allHoldout.returnPct>=base.allHoldout.returnPct-1e-9
    && pfAtLeast(m.allHoldout,base.allHoldout,.995)
    && m.allHoldout.maxDrawdownPct>=base.allHoldout.maxDrawdownPct-1e-9;
  const stressHoldoutPositive=v65TradeIdentityEqual(sh,incSH)
    && m.allStressHoldout.returnPct>=base.allStressHoldout.returnPct-1e-9
    && pfAtLeast(m.allStressHoldout,base.allStressHoldout,.995)
    && m.allStressHoldout.maxDrawdownPct>=base.allStressHoldout.maxDrawdownPct-1e-9;
  const stressRobust=m.fullStress.returnPct>base.fullStress.returnPct+1e-9
    && pfAtLeast(m.fullStress,base.fullStress,.995)
    && m.fullStress.maxDrawdownPct>=base.fullStress.maxDrawdownPct-1e-9;
  const fullNormalImproves=m.fullNormal.returnPct>base.fullNormal.returnPct+1e-9
    && pfAtLeast(m.fullNormal,base.fullNormal,.995)
    && m.fullNormal.maxDrawdownPct>=base.fullNormal.maxDrawdownPct-1e-9;
  const strictPass=selectedTrain.trainingEligible&&sameFrequency&&normalHoldoutPositive&&stressHoldoutPositive&&stressRobust&&fullNormalImproves;
  return {
    schema:"pengu-v65-supplemental-exit/v1",v64Incumbent:v64,incumbent:base,
    candidateCount:evaluated.length,eligibleCount:eligible.length,topTraining:eligible.slice(0,6),
    selectedConfig:selectedTrain.config,selectedTraining:selectedTrain,trainingEligible:true,sameFrequency,
    metrics:m,normalHoldoutPositive,stressHoldoutPositive,stressRobust,fullNormalImproves,strictPass,
    decision:strictPass?"ADOPT_V65_RESEARCH_CANDIDATE":"KEEP_V64_RESEARCH_CANDIDATE",
    reason:strictPass
      ?"Train-selected supplemental-Long exit profile improved V64 and survived untouched Normal/Stress holdout."
      :"Train-selected V65 exit profile failed untouched holdout, identity, or full robustness guards; retain V64.",
  };
}
'''
if marker not in src:
    raise SystemExit('longDiagnostics marker missing')
src = src.replace(marker, insert + marker, 1)

start = src.index('  const v64 = evaluateV64(rows,funding,baselineNormal);')
end = src.index('\n}\n\nmain().catch', start)
tail = r'''  const v65=evaluateV65(rows,funding,baselineNormal);
  const selectedV64=v65.v64Incumbent.selectedConfig as V64Config;
  const selectedV65=v65.selectedConfig as V65Config|null;

  v64ActiveConfig=selectedV64;
  v65ActiveConfig=null;
  const incumbentNormal=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  const incumbentStress=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;

  if(selectedV65) v65ActiveConfig=selectedV65;
  const candidateNormal=selectedV65?replay(rows,funding,{mode:"normal",longMode:"V65_DYNAMIC"}).trades:incumbentNormal;
  const candidateStress=selectedV65?replay(rows,funding,{mode:"stress",longMode:"V65_DYNAMIC"}).trades:incumbentStress;
  const finalNormal=v65.strictPass?candidateNormal:incumbentNormal;
  const finalStress=v65.strictPass?candidateStress:incumbentStress;
  const finalNormalMetrics=metrics(finalNormal),finalStressMetrics=metrics(finalStress);
  const resultPayload={
    status:"PASS_RESEARCH_ONLY",
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true},
    source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},
    longDiagnostics:longDiag,
    v65,
    final:{promoted:v65.strictPass,longMode:v65.strictPass?"V65_DYNAMIC":"V64_DYNAMIC",normal:finalNormalMetrics,stress:finalStressMetrics},
    safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };
  function mkV65Ledger(tradesN:RichTrade[],tradesS:RichTrade[],variant:string,exitConfig:V65Config|null) { return {
    schema:"pengu-dual-ls-v2-aster-ledger/v1",
    strategyId:PENGU_DUAL_LS_V2.id,
    longVariant:variant,
    shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",
    currentProductionSourceSha:SOURCE_SHA,
    researchOnly:true,
    researchCandidate:{
      longMode:variant,
      v64SizingConfig:selectedV64,
      v65ExitConfig:exitConfig,
      diagnosticsSchema:"pengu-v65-supplemental-exit/v1",
    },
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},
    costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},
    data:{
      penguRows:pengu.length,btcRows:btc.length,fundingRows:funding.length,
      availableStart:new Date(pengu[0].openTime).toISOString(),
      availableEndExclusive:new Date(pengu.at(-1)!.openTime+HOUR).toISOString(),
      requestedStart:new Date(EVAL_START).toISOString(),
      requestedEndExclusive:new Date(EVAL_END).toISOString(),
      coverageNote:"No pre-listing PENGU data is synthesized.",
    },
    integrity:{
      noOverlap:tradesN.every((t,i)=>i===0||t.entryTs>tradesN[i-1].exitTs),
      maximumRequestedGross:Math.max(...tradesN.map(t=>t.requestedGross)),
    },
    modes:{
      normal:{metrics:metrics(tradesN),trades:tradesN.map(publicTrade)},
      stress:{metrics:metrics(tradesS),trades:tradesS.map(publicTrade)},
    },
    safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };}

  const incumbentLedger=mkV65Ledger(incumbentNormal,incumbentStress,"V64_DYNAMIC",null);
  const candidateLedger=mkV65Ledger(candidateNormal,candidateStress,selectedV65?"V65_DYNAMIC":"V64_DYNAMIC",selectedV65);
  assert.equal(incumbentLedger.integrity.noOverlap,true);
  assert.equal(candidateLedger.integrity.noOverlap,true);
  assert.ok(candidateNormal.filter(t=>t.side==="S").every(t=>t.requestedGross<=0.75+1e-12));
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v65-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"incumbent-v64-pengu-ledger.json"),JSON.stringify(incumbentLedger,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"candidate-pengu-ledger.json"),JSON.stringify(candidateLedger,null,2)+"\n","utf8");
  console.log(JSON.stringify(resultPayload,null,2));'''
src = src[:start] + tail + src[end:]
TARGET.write_text(src)
print('V65_SUPPLEMENTAL_EXIT_PATCH_APPLIED=PASS')
