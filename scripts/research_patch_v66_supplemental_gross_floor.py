from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

old = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V64_DYNAMIC";'
new = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V64_DYNAMIC" | "V66_DYNAMIC";'
if old not in src:
    raise SystemExit('V64 LongMode marker missing')
src = src.replace(old, new, 1)

old = '  if (mode === "V57_REGIME72_BREAKOUT" || mode === "V64_DYNAMIC") return breakoutStrong;'
new = '  if (mode === "V57_REGIME72_BREAKOUT" || mode === "V64_DYNAMIC" || mode === "V66_DYNAMIC") return breakoutStrong;'
if old not in src:
    raise SystemExit('V64 breakout alias marker missing')
src = src.replace(old, new, 1)

old = '    if (side === "L" && options.longMode === "V64_DYNAMIC" && !rows[index].longRaw) {'
new = '    if (side === "L" && (options.longMode === "V64_DYNAMIC" || options.longMode === "V66_DYNAMIC") && !rows[index].longRaw) {'
if old not in src:
    raise SystemExit('V64 sizing application marker missing')
src = src.replace(old, new, 1)

marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
type V66Config = {
  lowGross:number;
  label:string;
  trainScore:number;
};
const v66CandidateGrosses=[0.125,0.15625,0.1875] as const;

function v66TradeIdentityEqual(a:RichTrade[],b:RichTrade[]) {
  return a.length===b.length && a.every((t,i)=>t.side===b[i].side&&t.signalTs===b[i].signalTs&&t.entryTs===b[i].entryTs&&t.exitTs===b[i].exitTs);
}
function v66Metrics(rows:RichTrade[],a:number,b:number) { return metrics(sliceByTime(rows,a,b)); }

function evaluateV66(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],baselineV56Normal:RichTrade[]) {
  const v64=evaluateV64(rows,funding,baselineV56Normal);
  const selectedV64=v64.selectedConfig as V64Config|null;
  assert(v64.strictPass===true&&selectedV64,'V66 requires formally-passing V64 incumbent');
  assert(selectedV64.rule.feature==='penguReturn72h','V66 is pinned to the V64 penguReturn72h rule');
  assert(selectedV64.rule.op==='lte','V66 is pinned to the V64 lte pass-side rule');
  assert(Math.abs(selectedV64.lowGross-0.1875)<1e-12,'V66 expects V64 lowGross 0.1875');
  assert(selectedV64.rule.threshold>0.11&&selectedV64.rule.threshold<0.13,'V64 threshold drift outside V66 preregistered range');

  v64ActiveConfig=selectedV64;
  const incN=replay(rows,funding,{mode:'normal',longMode:'V64_DYNAMIC'}).trades;
  const incS=replay(rows,funding,{mode:'stress',longMode:'V64_DYNAMIC'}).trades;
  const base={
    trainNormal:v66Metrics(incN,EVAL_START,HOLDOUT_CUTOFF),
    trainStress:v66Metrics(incS,EVAL_START,HOLDOUT_CUTOFF),
    holdoutNormal:v66Metrics(incN,HOLDOUT_CUTOFF,EVAL_END),
    holdoutStress:v66Metrics(incS,HOLDOUT_CUTOFF,EVAL_END),
    fullNormal:metrics(incN),fullStress:metrics(incS),
  };

  const evaluated:Array<any>=[];
  for(const lowGross of v66CandidateGrosses) {
    const cfg:V66Config={lowGross,label:`V64_RULE_LOW_GROSS_${lowGross}`,trainScore:0};
    v64ActiveConfig={...selectedV64,lowGross,label:`${selectedV64.label}__V66_LOW${lowGross}`};
    const n=replay(rows,funding,{mode:'normal',longMode:'V66_DYNAMIC'}).trades;
    const s=replay(rows,funding,{mode:'stress',longMode:'V66_DYNAMIC'}).trades;
    const nt=v66Metrics(n,EVAL_START,HOLDOUT_CUTOFF),st=v66Metrics(s,EVAL_START,HOLDOUT_CUTOFF);
    const sameTrainIdentity=v66TradeIdentityEqual(sliceByTime(n,EVAL_START,HOLDOUT_CUTOFF),sliceByTime(incN,EVAL_START,HOLDOUT_CUTOFF))
      &&v66TradeIdentityEqual(sliceByTime(s,EVAL_START,HOLDOUT_CUTOFF),sliceByTime(incS,EVAL_START,HOLDOUT_CUTOFF));
    const nd=nt.returnPct-base.trainNormal.returnPct,sd=st.returnPct-base.trainStress.returnPct;
    const npf=nt.profitFactor-base.trainNormal.profitFactor,spf=st.profitFactor-base.trainStress.profitFactor;
    const ndd=nt.maxDrawdownPct-base.trainNormal.maxDrawdownPct,sdd=st.maxDrawdownPct-base.trainStress.maxDrawdownPct;
    const trainingEligible=lowGross<selectedV64.lowGross-1e-12
      &&sameTrainIdentity
      &&nd>1e-9&&sd>1e-9
      &&pfAtLeast(nt,base.trainNormal,1.0)&&pfAtLeast(st,base.trainStress,1.0)
      &&ndd>=-1e-9&&sdd>=-1e-9;
    const trainScore=nd+sd*.5+Math.max(0,npf)*2+Math.max(0,spf)+Math.max(0,ndd)*.25+Math.max(0,sdd)*.125;
    evaluated.push({config:{...cfg,trainScore},trainingEligible,sameTrainIdentity,metrics:{trainNormal:nt,trainStress:st},deltas:{normalReturnPct:nd,stressReturnPct:sd,normalPf:npf,stressPf:spf,normalDdPctPoint:ndd,stressDdPctPoint:sdd}});
  }
  const eligible=evaluated.filter(x=>x.trainingEligible).sort((a,b)=>b.config.trainScore-a.config.trainScore||b.config.lowGross-a.config.lowGross);
  const selectedTrain=eligible[0]??null;
  if(!selectedTrain) {
    v64ActiveConfig=selectedV64;
    return {
      schema:'pengu-v66-supplemental-gross-floor/v1',v64Incumbent:v64,incumbent:base,
      candidateCount:evaluated.length,eligibleCount:0,topTraining:evaluated.sort((a,b)=>b.config.trainScore-a.config.trainScore),
      selectedConfig:null,trainingEligible:false,sameFrequency:false,normalHoldoutPositive:false,stressHoldoutPositive:false,
      stressRobust:false,fullNormalImproves:false,strictPass:false,decision:'KEEP_V64_RESEARCH_CANDIDATE',
      reason:'No lower gross floor improved the already-selected V64 rule on Train under exact identity, Normal/Stress PF, and DD guards.',
    };
  }

  const chosen=selectedTrain.config as V66Config;
  v64ActiveConfig={...selectedV64,lowGross:chosen.lowGross,label:`${selectedV64.label}__V66_LOW${chosen.lowGross}`};
  const n=replay(rows,funding,{mode:'normal',longMode:'V66_DYNAMIC'}).trades;
  const s=replay(rows,funding,{mode:'stress',longMode:'V66_DYNAMIC'}).trades;
  const hn=v66Metrics(n,HOLDOUT_CUTOFF,EVAL_END),hs=v66Metrics(s,HOLDOUT_CUTOFF,EVAL_END),fn=metrics(n),fs=metrics(s);
  const sameFrequency=v66TradeIdentityEqual(n,incN)&&v66TradeIdentityEqual(s,incS);
  const normalHoldoutPositive=hn.returnPct>=base.holdoutNormal.returnPct-1e-9&&pfAtLeast(hn,base.holdoutNormal,.995)&&hn.maxDrawdownPct>=base.holdoutNormal.maxDrawdownPct-1e-9;
  const stressHoldoutPositive=hs.returnPct>=base.holdoutStress.returnPct-1e-9&&pfAtLeast(hs,base.holdoutStress,.995)&&hs.maxDrawdownPct>=base.holdoutStress.maxDrawdownPct-1e-9;
  const fullNormalImproves=fn.returnPct>base.fullNormal.returnPct+1e-9&&pfAtLeast(fn,base.fullNormal,1.0)&&fn.maxDrawdownPct>=base.fullNormal.maxDrawdownPct-1e-9;
  const stressRobust=fs.returnPct>base.fullStress.returnPct+1e-9&&pfAtLeast(fs,base.fullStress,1.0)&&fs.maxDrawdownPct>=base.fullStress.maxDrawdownPct-1e-9;
  const strictPass=selectedTrain.trainingEligible&&sameFrequency&&normalHoldoutPositive&&stressHoldoutPositive&&fullNormalImproves&&stressRobust;
  return {
    schema:'pengu-v66-supplemental-gross-floor/v1',v64Incumbent:v64,incumbent:base,
    candidateCount:evaluated.length,eligibleCount:eligible.length,topTraining:eligible,
    selectedConfig:chosen,selectedTraining:selectedTrain,trainingEligible:true,sameFrequency,
    metrics:{holdoutNormal:hn,holdoutStress:hs,fullNormal:fn,fullStress:fs},
    normalHoldoutPositive,stressHoldoutPositive,stressRobust,fullNormalImproves,strictPass,
    decision:strictPass?'ADOPT_V66_RESEARCH_CANDIDATE':'KEEP_V64_RESEARCH_CANDIDATE',
    reason:strictPass
      ?'Train-selected lower gross floor for the unchanged V64 supplemental rule survived untouched Normal/Stress holdout.'
      :'The Train-selected V66 gross floor failed untouched holdout, exact identity, or full robustness guards; retain V64.',
  };
}
'''
if marker not in src:
    raise SystemExit('longDiagnostics marker missing')
src = src.replace(marker, insert + marker, 1)

start = src.index('  const v64 = evaluateV64(rows,funding,baselineNormal);')
end = src.index('\n}\n\nmain().catch', start)
tail = r'''  const v66=evaluateV66(rows,funding,baselineNormal);
  const selectedV64=v66.v64Incumbent.selectedConfig as V64Config;
  const selectedV66=v66.selectedConfig as V66Config|null;

  v64ActiveConfig=selectedV64;
  const incumbentNormal=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  const incumbentStress=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;

  if(selectedV66) v64ActiveConfig={...selectedV64,lowGross:selectedV66.lowGross,label:`${selectedV64.label}__V66_LOW${selectedV66.lowGross}`};
  const candidateNormal=selectedV66?replay(rows,funding,{mode:"normal",longMode:"V66_DYNAMIC"}).trades:incumbentNormal;
  const candidateStress=selectedV66?replay(rows,funding,{mode:"stress",longMode:"V66_DYNAMIC"}).trades:incumbentStress;
  const finalNormal=v66.strictPass?candidateNormal:incumbentNormal;
  const finalStress=v66.strictPass?candidateStress:incumbentStress;
  const resultPayload={
    status:"PASS_RESEARCH_ONLY",
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true},
    source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},
    longDiagnostics:longDiag,v66,
    final:{promoted:v66.strictPass,longMode:v66.strictPass?"V66_DYNAMIC":"V64_DYNAMIC",normal:metrics(finalNormal),stress:metrics(finalStress)},
    safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };
  function mkV66Ledger(tradesN:RichTrade[],tradesS:RichTrade[],variant:string,v66Config:V66Config|null) { return {
    schema:"pengu-dual-ls-v2-aster-ledger/v1",
    strategyId:PENGU_DUAL_LS_V2.id,
    longVariant:variant,
    shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",
    currentProductionSourceSha:SOURCE_SHA,
    researchOnly:true,
    researchCandidate:{longMode:variant,v64SizingConfig:selectedV64,v66GrossFloorConfig:v66Config,diagnosticsSchema:"pengu-v66-supplemental-gross-floor/v1"},
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},
    costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},
    data:{penguRows:pengu.length,btcRows:btc.length,fundingRows:funding.length,availableStart:new Date(pengu[0].openTime).toISOString(),availableEndExclusive:new Date(pengu.at(-1)!.openTime+HOUR).toISOString(),requestedStart:new Date(EVAL_START).toISOString(),requestedEndExclusive:new Date(EVAL_END).toISOString(),coverageNote:"No pre-listing PENGU data is synthesized."},
    integrity:{noOverlap:tradesN.every((t,i)=>i===0||t.entryTs>tradesN[i-1].exitTs),maximumRequestedGross:Math.max(...tradesN.map(t=>t.requestedGross))},
    modes:{normal:{metrics:metrics(tradesN),trades:tradesN.map(publicTrade)},stress:{metrics:metrics(tradesS),trades:tradesS.map(publicTrade)}},
    safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };}
  const incumbentLedger=mkV66Ledger(incumbentNormal,incumbentStress,"V64_DYNAMIC",null);
  const candidateLedger=mkV66Ledger(candidateNormal,candidateStress,selectedV66?"V66_DYNAMIC":"V64_DYNAMIC",selectedV66);
  assert.equal(incumbentLedger.integrity.noOverlap,true);
  assert.equal(candidateLedger.integrity.noOverlap,true);
  assert.equal(candidateNormal.length,incumbentNormal.length);
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v66-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"incumbent-v64-pengu-ledger.json"),JSON.stringify(incumbentLedger,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"candidate-pengu-ledger.json"),JSON.stringify(candidateLedger,null,2)+"\n","utf8");
  console.log(JSON.stringify(resultPayload,null,2));'''
src = src[:start] + tail + src[end:]
TARGET.write_text(src)
print('V66_SUPPLEMENTAL_GROSS_FLOOR_PATCH_APPLIED=PASS')
