from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

old = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL";'
new = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V64_DYNAMIC";'
if old not in src:
    raise SystemExit('LongMode marker missing')
src = src.replace(old, new, 1)

old = '  if (mode === "V57_REGIME72_BREAKOUT") return breakoutStrong;'
new = '  if (mode === "V57_REGIME72_BREAKOUT" || mode === "V64_DYNAMIC") return breakoutStrong;'
if old not in src:
    raise SystemExit('V57 breakout alias marker missing')
src = src.replace(old, new, 1)

old = '    const requestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);'
new = '''    let requestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);\n    if (side === "L" && options.longMode === "V64_DYNAMIC" && !rows[index].longRaw) {\n      requestedGross = v64SupplementalGross(features, requestedGross);\n    }'''
if old not in src:
    raise SystemExit('requestedGross marker missing')
src = src.replace(old, new, 1)

marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
type V64FeatureName =
  | "relativeReturn24h" | "breakoutAtrScore" | "penguReturn24h" | "penguReturn72h"
  | "btcReturn24h" | "rsi14" | "volumeRatio6OverPrior36" | "atr24Ratio"
  | "ema72Distance" | "ema168Distance";
type V64Rule = { feature:V64FeatureName; op:"gte"|"lte"; threshold:number };
type V64Config = { rule:V64Rule; lowGross:number; trainScore:number; label:string };
let v64ActiveConfig:V64Config|null=null;

function v64FeatureValue(f:PenguDualLsV2Features, feature:V64FeatureName) {
  switch(feature) {
    case "breakoutAtrScore": return breakoutAtrScore(f);
    case "ema72Distance": return f.close/Math.max(1e-12,f.ema72)-1;
    case "ema168Distance": return f.close/Math.max(1e-12,f.ema168)-1;
    default: return Number(f[feature]);
  }
}
const v64FeatureNames:V64FeatureName[]=[
  "relativeReturn24h","breakoutAtrScore","penguReturn24h","penguReturn72h","btcReturn24h",
  "rsi14","volumeRatio6OverPrior36","atr24Ratio","ema72Distance","ema168Distance"
];
function v64RulePass(f:PenguDualLsV2Features, rule:V64Rule) {
  const value=v64FeatureValue(f,rule.feature);
  return rule.op==="gte"?value>=rule.threshold:value<=rule.threshold;
}
function v64SupplementalGross(f:PenguDualLsV2Features, baseGross:number) {
  if(!v64ActiveConfig) return baseGross;
  return v64RulePass(f,v64ActiveConfig.rule)?baseGross:Math.min(baseGross,v64ActiveConfig.lowGross);
}
function v64SupplementalTrade(t:RichTrade) {
  return t.side==="L" && !longGatePasses(t.entryFeatures).regime72;
}
function v64ThresholdCandidates(trades:RichTrade[]) {
  const out:Array<{rule:V64Rule;lowGross:number;label:string}>=[];
  const lows=[0.1875,0.25,0.375,0.5,0.625,0.75];
  for(const feature of v64FeatureNames) {
    const vals=[...new Set(trades.map(t=>v64FeatureValue(t.entryFeatures,feature)).filter(Number.isFinite))].sort((a,b)=>a-b);
    for(let i=0;i<vals.length-1;i+=1) {
      const threshold=(vals[i]+vals[i+1])/2;
      for(const op of ["gte","lte"] as const) for(const lowGross of lows) {
        out.push({rule:{feature,op,threshold},lowGross,label:`${feature}_${op}_${threshold.toFixed(8)}_LOW${lowGross}`});
      }
    }
  }
  return out;
}

function evaluateV64(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],baselineV56Normal:RichTrade[]) {
  const d=deriveV57Thresholds(baselineV56Normal); v57Thresholds=d.thresholds;
  v64ActiveConfig=null;
  const incN=replay(rows,funding,{mode:"normal",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const incS=replay(rows,funding,{mode:"stress",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const sl=(x:RichTrade[],side:Side|undefined,a:number,b:number)=>sliceByTime(side?x.filter(t=>t.side===side):x,a,b);
  const incLT=sl(incN,"L",EVAL_START,HOLDOUT_CUTOFF),incAT=sl(incN,undefined,EVAL_START,HOLDOUT_CUTOFF),incLST=sl(incS,"L",EVAL_START,HOLDOUT_CUTOFF),incAST=sl(incS,undefined,EVAL_START,HOLDOUT_CUTOFF);
  const incLH=sl(incN,"L",HOLDOUT_CUTOFF,EVAL_END),incAH=sl(incN,undefined,HOLDOUT_CUTOFF,EVAL_END),incLSH=sl(incS,"L",HOLDOUT_CUTOFF,EVAL_END),incASH=sl(incS,undefined,HOLDOUT_CUTOFF,EVAL_END);
  const base={
    longTrain:metrics(incLT),allTrain:metrics(incAT),longStressTrain:metrics(incLST),allStressTrain:metrics(incAST),
    longHoldout:metrics(incLH),allHoldout:metrics(incAH),longStressHoldout:metrics(incLSH),allStressHoldout:metrics(incASH),
    fullNormal:metrics(incN),fullStress:metrics(incS),
  };
  const supplemental=incLT.filter(v64SupplementalTrade);
  const wins=supplemental.filter(t=>t.accountReturn>0),losses=supplemental.filter(t=>t.accountReturn<=0);
  assert(supplemental.length>=4,"insufficient V57 supplemental train trades for sizing research");
  assert(wins.length>=2&&losses.length>=1,"V57 supplemental train cohort lacks both winners and losers");
  const rawCandidates=v64ThresholdCandidates(supplemental);
  const evaluated:Array<any>=[];
  for(const cfg0 of rawCandidates) {
    const cfg:V64Config={...cfg0,trainScore:0}; v64ActiveConfig=cfg;
    const n=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
    const s=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
    const lt=sl(n,"L",EVAL_START,HOLDOUT_CUTOFF),at=sl(n,undefined,EVAL_START,HOLDOUT_CUTOFF),lst=sl(s,"L",EVAL_START,HOLDOUT_CUTOFF),ast=sl(s,undefined,EVAL_START,HOLDOUT_CUTOFF);
    const m={longTrain:metrics(lt),allTrain:metrics(at),longStressTrain:metrics(lst),allStressTrain:metrics(ast)};
    const sameFrequency=m.longTrain.trades===base.longTrain.trades&&m.allTrain.trades===base.allTrain.trades;
    const trainingEligible=sameFrequency
      && m.longTrain.returnPct>base.longTrain.returnPct+1e-9
      && m.allTrain.returnPct>base.allTrain.returnPct+1e-9
      && m.longStressTrain.returnPct>=base.longStressTrain.returnPct-1e-9
      && m.allStressTrain.returnPct>=base.allStressTrain.returnPct-1e-9
      && pfAtLeast(m.longTrain,base.longTrain,1.0)
      && pfAtLeast(m.allTrain,base.allTrain,1.0)
      && pfAtLeast(m.allStressTrain,base.allStressTrain,.995)
      && m.longTrain.maxDrawdownPct>=base.longTrain.maxDrawdownPct-1e-9
      && m.allTrain.maxDrawdownPct>=base.allTrain.maxDrawdownPct-1e-9
      && m.allStressTrain.maxDrawdownPct>=base.allStressTrain.maxDrawdownPct-.25;
    const trainScore=(m.allTrain.returnPct-base.allTrain.returnPct)+(m.allStressTrain.returnPct-base.allStressTrain.returnPct)*.5;
    evaluated.push({config:{...cfg,trainScore},trainingEligible,metrics:m,deltas:{
      longTrainReturnPct:m.longTrain.returnPct-base.longTrain.returnPct,
      allTrainReturnPct:m.allTrain.returnPct-base.allTrain.returnPct,
      longStressTrainReturnPct:m.longStressTrain.returnPct-base.longStressTrain.returnPct,
      allStressTrainReturnPct:m.allStressTrain.returnPct-base.allStressTrain.returnPct,
    }});
  }
  const eligible=evaluated.filter(x=>x.trainingEligible).sort((a,b)=>b.config.trainScore-a.config.trainScore||b.deltas.allTrainReturnPct-a.deltas.allTrainReturnPct);
  const selectedTrain=eligible[0]??null;
  if(!selectedTrain) {
    v64ActiveConfig=null;
    return {schema:"pengu-v64-supplemental-sizing/v1",derivation:d,incumbent:base,supplementalTrain:{trades:supplemental.length,wins:wins.length,losses:losses.length},candidateCount:evaluated.length,eligibleCount:0,topTraining:evaluated.sort((a,b)=>b.config.trainScore-a.config.trainScore).slice(0,10),selectedConfig:null,trainingEligible:false,normalHoldoutPositive:false,stressHoldoutPositive:false,stressRobust:false,fullNormalImproves:false,strictPass:false,decision:"KEEP_V57_RESEARCH_CANDIDATE",reason:"No train-only supplemental sizing rule improved V57 under Normal/Stress PF/DD guards."};
  }
  v64ActiveConfig=selectedTrain.config;
  const n=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  const s=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
  const lh=sl(n,"L",HOLDOUT_CUTOFF,EVAL_END),ah=sl(n,undefined,HOLDOUT_CUTOFF,EVAL_END),lsh=sl(s,"L",HOLDOUT_CUTOFF,EVAL_END),ash=sl(s,undefined,HOLDOUT_CUTOFF,EVAL_END);
  const m={
    longHoldout:metrics(lh),allHoldout:metrics(ah),longStressHoldout:metrics(lsh),allStressHoldout:metrics(ash),
    fullNormal:metrics(n),fullStress:metrics(s),
  };
  const sameFrequency=m.fullNormal.trades===base.fullNormal.trades&&m.fullNormal.longTrades===base.fullNormal.longTrades&&m.fullNormal.shortTrades===base.fullNormal.shortTrades;
  const normalHoldoutPositive=m.longHoldout.returnPct>=base.longHoldout.returnPct-1e-9&&m.allHoldout.returnPct>=base.allHoldout.returnPct-1e-9&&pfAtLeast(m.allHoldout,base.allHoldout,.995)&&m.allHoldout.maxDrawdownPct>=base.allHoldout.maxDrawdownPct-1e-9;
  const stressHoldoutPositive=m.longStressHoldout.returnPct>=base.longStressHoldout.returnPct-1e-9&&m.allStressHoldout.returnPct>=base.allStressHoldout.returnPct-1e-9&&pfAtLeast(m.allStressHoldout,base.allStressHoldout,.995)&&m.allStressHoldout.maxDrawdownPct>=base.allStressHoldout.maxDrawdownPct-1e-9;
  const stressRobust=m.fullStress.returnPct>base.fullStress.returnPct+1e-9&&pfAtLeast(m.fullStress,base.fullStress,.995)&&m.fullStress.maxDrawdownPct>=base.fullStress.maxDrawdownPct-1e-9;
  const fullNormalImproves=m.fullNormal.returnPct>base.fullNormal.returnPct+1e-9&&pfAtLeast(m.fullNormal,base.fullNormal,.995)&&m.fullNormal.maxDrawdownPct>=base.fullNormal.maxDrawdownPct-1e-9;
  const strictPass=sameFrequency&&normalHoldoutPositive&&stressHoldoutPositive&&stressRobust&&fullNormalImproves;
  return {schema:"pengu-v64-supplemental-sizing/v1",derivation:d,incumbent:base,supplementalTrain:{trades:supplemental.length,wins:wins.length,losses:losses.length},candidateCount:evaluated.length,eligibleCount:eligible.length,topTraining:eligible.slice(0,10),selectedConfig:selectedTrain.config,selectedTraining:selectedTrain,trainingEligible:true,sameFrequency,metrics:m,normalHoldoutPositive,stressHoldoutPositive,stressRobust,fullNormalImproves,strictPass,decision:strictPass?"ADOPT_V64_RESEARCH_CANDIDATE":"KEEP_V57_RESEARCH_CANDIDATE",reason:strictPass?"Train-selected supplemental risk scaling improved V57 and survived untouched Normal/Stress holdout.":"Train-selected supplemental sizing failed untouched holdout and/or full robustness guards."};
}
'''
if marker not in src:
    raise SystemExit('longDiagnostics marker missing')
src = src.replace(marker, insert + marker, 1)

start = src.index('  const shortBaseline = baselineNormal.filter')
end = src.index('\n}\n\nmain().catch', start)
tail = r'''  const v64 = evaluateV64(rows,funding,baselineNormal);
  const selectedConfig=v64.selectedConfig as V64Config|null;
  v64ActiveConfig=null;
  const incumbentNormal=replay(rows,funding,{mode:"normal",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const incumbentStress=replay(rows,funding,{mode:"stress",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  if(selectedConfig) v64ActiveConfig=selectedConfig;
  const candidateNormal=selectedConfig?replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades:incumbentNormal;
  const candidateStress=selectedConfig?replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades:incumbentStress;
  const finalNormal=v64.strictPass?candidateNormal:incumbentNormal;
  const finalStress=v64.strictPass?candidateStress:incumbentStress;
  const finalNormalMetrics=metrics(finalNormal),finalStressMetrics=metrics(finalStress);
  const resultPayload={status:"PASS_RESEARCH_ONLY",period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true},source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},longDiagnostics:longDiag,v64,final:{promoted:v64.strictPass,longMode:v64.strictPass?"V64_DYNAMIC":"V57_REGIME72_BREAKOUT",normal:finalNormalMetrics,stress:finalStressMetrics},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  function mkLedger(tradesN:RichTrade[],tradesS:RichTrade[],variant:string,config:V64Config|null) { return {
    schema:"pengu-dual-ls-v2-aster-ledger/v1",strategyId:PENGU_DUAL_LS_V2.id,longVariant:variant,shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",currentProductionSourceSha:SOURCE_SHA,researchOnly:true,
    researchCandidate:{longMode:variant,selectedConfig:config,diagnosticsSchema:"pengu-v64-supplemental-sizing/v1"},period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},
    data:{penguRows:pengu.length,btcRows:btc.length,fundingRows:funding.length,availableStart:new Date(pengu[0].openTime).toISOString(),availableEndExclusive:new Date(pengu.at(-1)!.openTime+HOUR).toISOString(),requestedStart:new Date(EVAL_START).toISOString(),requestedEndExclusive:new Date(EVAL_END).toISOString(),coverageNote:"No pre-listing PENGU data is synthesized."},
    integrity:{noOverlap:tradesN.every((t,i)=>i===0||t.entryTs>tradesN[i-1].exitTs),maximumRequestedGross:Math.max(...tradesN.map(t=>t.requestedGross))},modes:{normal:{metrics:metrics(tradesN),trades:tradesN.map(publicTrade)},stress:{metrics:metrics(tradesS),trades:tradesS.map(publicTrade)}},safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}
  }; }
  const incumbentLedger=mkLedger(incumbentNormal,incumbentStress,"PENGU_DUAL_LS_V2_FINAL_V57_REGIME72_BREAKOUT",null);
  const candidateLedger=mkLedger(candidateNormal,candidateStress,selectedConfig?"PENGU_DUAL_LS_V2_FINAL_V64_DYNAMIC":"PENGU_DUAL_LS_V2_FINAL_V57_REGIME72_BREAKOUT",selectedConfig);
  assert.equal(incumbentLedger.integrity.noOverlap,true); assert.equal(candidateLedger.integrity.noOverlap,true);
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v64-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"incumbent-v57-pengu-ledger.json"),JSON.stringify(incumbentLedger,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"candidate-pengu-ledger.json"),JSON.stringify(candidateLedger,null,2)+"\n","utf8");
  console.log("V64_RESULT="+JSON.stringify({decision:v64.decision,selectedConfig:v64.selectedConfig,trainingEligible:v64.trainingEligible,normalHoldoutPositive:v64.normalHoldoutPositive,stressHoldoutPositive:v64.stressHoldoutPositive,stressRobust:v64.stressRobust,fullNormalImproves:v64.fullNormalImproves,strictPass:v64.strictPass}));
'''
src = src[:start] + tail + src[end:]
TARGET.write_text(src)
print(f'PATCHED_V64={TARGET} bytes={TARGET.stat().st_size}')
