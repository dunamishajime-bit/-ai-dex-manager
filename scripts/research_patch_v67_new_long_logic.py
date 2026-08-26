from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

old = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V64_DYNAMIC";'
new = 'type LongMode = "EDGE" | "RAW_REENTRY" | "V57_REGIME72_RELATIVE" | "V57_REGIME72_BREAKOUT" | "V57_REGIME72_DUAL" | "V64_DYNAMIC" | "V67_PULLBACK_CONTINUATION" | "V67_BREAKOUT_CONFIRMATION" | "V67_OVERSOLD_REVERSAL";'
if old not in src:
    raise SystemExit('V64 LongMode marker missing')
src = src.replace(old, new, 1)

old = '''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {
  if (mode === "EDGE") return rows[index].longSignal;
  if (mode === "RAW_REENTRY") return rows[index].longRaw;
  const current = longRawForMode(rows[index], mode);
  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;
  return current && !previous;
}'''
new = '''function longSignalForMode(rows: PenguDualLsV2EvaluationRow[], index: number, mode: LongMode) {
  if (mode === "EDGE") return rows[index].longSignal;
  if (mode === "RAW_REENTRY") return rows[index].longRaw;
  if (v67FamilyForMode(mode) !== null) {
    return v67IncumbentEdge(rows, index) || v67NewLongSignal(rows, index, mode);
  }
  const current = longRawForMode(rows[index], mode);
  const previous = index > 0 ? longRawForMode(rows[index - 1], mode) : false;
  return current && !previous;
}'''
if old not in src:
    raise SystemExit('V57 longSignalForMode marker missing')
src = src.replace(old, new, 1)

old = '''    let requestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);
    if (side === "L" && options.longMode === "V64_DYNAMIC" && !rows[index].longRaw) {
      requestedGross = v64SupplementalGross(features, requestedGross);
    }'''
new = '''    let requestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);
    const v67Mode = v67FamilyForMode(options.longMode) !== null;
    const v67IncumbentLong = side === "L" && v67Mode && v67IncumbentEdge(rows, index);
    const v67NewLong = side === "L" && v67Mode && v67NewLongSignal(rows, index, options.longMode);
    if (side === "L" && ((options.longMode === "V64_DYNAMIC" && !rows[index].longRaw) || (v67IncumbentLong && !rows[index].longRaw))) {
      requestedGross = v64SupplementalGross(features, requestedGross);
    }
    if (v67NewLong && !v67IncumbentLong) requestedGross = Math.min(requestedGross, 0.5);'''
if old not in src:
    raise SystemExit('V64 requestedGross marker missing')
src = src.replace(old, new, 1)

marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
type V67Family = "PULLBACK_CONTINUATION" | "BREAKOUT_CONFIRMATION" | "OVERSOLD_REVERSAL";
const V67_NEW_LONG = "V67_NEW_LONG";
const V67_FROZEN_V64_CONFIG:V64Config={
  rule:{feature:"penguReturn72h",op:"lte",threshold:0.12049482888834451},
  lowGross:0.1875,
  label:"penguReturn72h_lte_0.12049483_LOW0.1875",
  trainScore:31.7010356792032,
};
const V67_MODES:LongMode[]=["V67_PULLBACK_CONTINUATION","V67_BREAKOUT_CONFIRMATION","V67_OVERSOLD_REVERSAL"];

function v67FamilyForMode(mode:LongMode):V67Family|null {
  if(mode==="V67_PULLBACK_CONTINUATION") return "PULLBACK_CONTINUATION";
  if(mode==="V67_BREAKOUT_CONFIRMATION") return "BREAKOUT_CONFIRMATION";
  if(mode==="V67_OVERSOLD_REVERSAL") return "OVERSOLD_REVERSAL";
  return null;
}
function v67IncumbentRaw(row:PenguDualLsV2EvaluationRow) {
  return longRawForMode(row,"V64_DYNAMIC");
}
function v67IncumbentEdge(rows:PenguDualLsV2EvaluationRow[],index:number) {
  const current=v67IncumbentRaw(rows[index]);
  const previous=index>0?v67IncumbentRaw(rows[index-1]):false;
  return current&&!previous;
}
function v67OneHourReturn(rows:PenguDualLsV2EvaluationRow[],index:number) {
  if(index<=0) return 0;
  return rows[index].candle.close/Math.max(1e-12,rows[index-1].candle.close)-1;
}
function v67FamilyRaw(rows:PenguDualLsV2EvaluationRow[],index:number,family:V67Family) {
  if(index<2) return false;
  const row=rows[index], f=row.features;
  if(!f || row.shortSignal || v67IncumbentRaw(row)) return false;
  const r1=v67OneHourReturn(rows,index), prevR1=v67OneHourReturn(rows,index-1);
  if(family==="PULLBACK_CONTINUATION") return (
    f.penguReturn72h>=0.04 && f.penguReturn24h>=0.01 && f.relativeReturn24h>=0
    && f.close>f.ema72 && f.btcReturn24h>=-0.01
    && f.volumeRatio6OverPrior36>=0.80 && f.rsi14>=45 && f.rsi14<=68
    && prevR1<=-0.003 && r1>=0.002
  );
  if(family==="BREAKOUT_CONFIRMATION") return (
    f.close>f.priorHigh18h && f.penguReturn72h>=0.02 && f.penguReturn24h>=0.01
    && f.relativeReturn24h>=0.005 && f.close>f.ema72
    && f.volumeRatio6OverPrior36>=1.05 && f.btcReturn24h>=-0.01
    && f.rsi14>=50 && f.rsi14<=78 && r1>=0.001
  );
  return (
    f.penguReturn24h<=-0.03 && f.penguReturn72h>=-0.12
    && f.btcReturn24h>=-0.02 && f.volumeRatio6OverPrior36>=1.0
    && f.rsi14>=28 && f.rsi14<=46
    && prevR1<=-0.004 && r1>=0.004
  );
}
function v67NewLongSignal(rows:PenguDualLsV2EvaluationRow[],index:number,mode:LongMode) {
  const family=v67FamilyForMode(mode); if(!family) return false;
  if(v67IncumbentRaw(rows[index])) return false;
  const current=v67FamilyRaw(rows,index,family);
  const previous=index>0?v67FamilyRaw(rows,index-1,family):false;
  return current&&!previous;
}
function v67TradeId(t:RichTrade) { return `${t.side}:${t.signalTs}`; }
function v67AddedTrades(candidate:RichTrade[],incumbent:RichTrade[]) {
  const base=new Set(incumbent.map(v67TradeId));
  return candidate.filter(t=>!base.has(v67TradeId(t)));
}
function v67IdentityPreserved(candidate:RichTrade[],incumbent:RichTrade[]) {
  const ids=new Set(candidate.map(v67TradeId));
  return incumbent.every(t=>ids.has(v67TradeId(t)));
}

function evaluateV67(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],baselineV56Normal:RichTrade[]) {
  const derivation=deriveV57Thresholds(baselineV56Normal); v57Thresholds=derivation.thresholds;
  v64ActiveConfig=V67_FROZEN_V64_CONFIG;
  const incN=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  const incS=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
  const incNM=metrics(incN),incSM=metrics(incS);
  assert.equal(incNM.trades,41,`V64 incumbent trade drift: ${JSON.stringify(incNM)}`);
  assert.equal(incNM.longTrades,13); assert.equal(incNM.shortTrades,28);
  const sl=(x:RichTrade[],a:number,b:number)=>sliceByTime(x,a,b);
  const incNT=sl(incN,EVAL_START,HOLDOUT_CUTOFF),incST=sl(incS,EVAL_START,HOLDOUT_CUTOFF);
  const incNH=sl(incN,HOLDOUT_CUTOFF,EVAL_END),incSH=sl(incS,HOLDOUT_CUTOFF,EVAL_END);
  const base={trainNormal:metrics(incNT),trainStress:metrics(incST),holdoutNormal:metrics(incNH),holdoutStress:metrics(incSH),fullNormal:incNM,fullStress:incSM};
  const candidates:Array<any>=[];
  for(const mode of V67_MODES) {
    v64ActiveConfig=V67_FROZEN_V64_CONFIG;
    const n=replay(rows,funding,{mode:"normal",longMode:mode}).trades;
    const s=replay(rows,funding,{mode:"stress",longMode:mode}).trades;
    const nt=sl(n,EVAL_START,HOLDOUT_CUTOFF),st=sl(s,EVAL_START,HOLDOUT_CUTOFF);
    const addedNT=v67AddedTrades(nt,incNT),addedST=v67AddedTrades(st,incST);
    const incumbentIdentityPreservedTrain=v67IdentityPreserved(nt,incNT)&&v67IdentityPreserved(st,incST);
    const onlyAddsLong=addedNT.every(t=>t.side==="L")&&addedST.every(t=>t.side==="L");
    const m={trainNormal:metrics(nt),trainStress:metrics(st)};
    const trainingEligible=incumbentIdentityPreservedTrain&&onlyAddsLong
      && addedNT.length>=2&&addedST.length>=2
      && m.trainNormal.returnPct>base.trainNormal.returnPct+1e-9
      && m.trainStress.returnPct>base.trainStress.returnPct+1e-9
      && pfAtLeast(m.trainNormal,base.trainNormal,.995)
      && pfAtLeast(m.trainStress,base.trainStress,.995)
      && m.trainNormal.maxDrawdownPct>=base.trainNormal.maxDrawdownPct-.5
      && m.trainStress.maxDrawdownPct>=base.trainStress.maxDrawdownPct-.5;
    const trainScore=(m.trainNormal.returnPct-base.trainNormal.returnPct)+.5*(m.trainStress.returnPct-base.trainStress.returnPct);
    candidates.push({mode,family:v67FamilyForMode(mode),trainingEligible,incumbentIdentityPreservedTrain,onlyAddsLong,addedLongTrades:{normal:addedNT.length,stress:addedST.length},metrics:m,deltas:{normalReturnPct:m.trainNormal.returnPct-base.trainNormal.returnPct,stressReturnPct:m.trainStress.returnPct-base.trainStress.returnPct},trainScore});
  }
  const eligible=candidates.filter(x=>x.trainingEligible).sort((a,b)=>b.trainScore-a.trainScore||b.deltas.normalReturnPct-a.deltas.normalReturnPct);
  const selected=eligible[0]??null;
  if(!selected) return {schema:"pengu-v67-independent-new-long/v1",incumbent:base,frozenV64Config:V67_FROZEN_V64_CONFIG,candidateCount:candidates.length,eligibleCount:0,candidates,selectedMode:null,selectedFamily:null,trainingEligible:false,incumbentIdentityPreserved:false,holdoutAddedLongTrades:{normal:0,stress:0},normalHoldoutPositive:false,stressHoldoutPositive:false,stressRobust:false,fullNormalImproves:false,materialIntegratedGain:null,strictPass:false,decision:"KEEP_V64_RESEARCH_CANDIDATE",reason:"No fixed independent Long family improved Train while preserving the V64 incumbent identities and Normal/Stress PF/DD guards."};
  v64ActiveConfig=V67_FROZEN_V64_CONFIG;
  const n=replay(rows,funding,{mode:"normal",longMode:selected.mode}).trades;
  const s=replay(rows,funding,{mode:"stress",longMode:selected.mode}).trades;
  const nh=sl(n,HOLDOUT_CUTOFF,EVAL_END),sh=sl(s,HOLDOUT_CUTOFF,EVAL_END);
  const addedNH=v67AddedTrades(nh,incNH),addedSH=v67AddedTrades(sh,incSH);
  const addedN=v67AddedTrades(n,incN),addedS=v67AddedTrades(s,incS);
  const incumbentIdentityPreserved=v67IdentityPreserved(n,incN)&&v67IdentityPreserved(s,incS);
  const onlyAddsLong=addedN.every(t=>t.side==="L")&&addedS.every(t=>t.side==="L");
  const m={holdoutNormal:metrics(nh),holdoutStress:metrics(sh),fullNormal:metrics(n),fullStress:metrics(s)};
  const holdoutAddedLongTrades={normal:addedNH.filter(t=>t.side==="L").length,stress:addedSH.filter(t=>t.side==="L").length};
  const normalHoldoutPositive=holdoutAddedLongTrades.normal>=2
    && m.holdoutNormal.returnPct>base.holdoutNormal.returnPct+1e-9
    && pfAtLeast(m.holdoutNormal,base.holdoutNormal,1.0)
    && m.holdoutNormal.maxDrawdownPct>=base.holdoutNormal.maxDrawdownPct-.5;
  const stressHoldoutPositive=holdoutAddedLongTrades.stress>=2
    && m.holdoutStress.returnPct>base.holdoutStress.returnPct+1e-9
    && pfAtLeast(m.holdoutStress,base.holdoutStress,1.0)
    && m.holdoutStress.maxDrawdownPct>=base.holdoutStress.maxDrawdownPct-.5;
  const fullNormalImproves=m.fullNormal.returnPct>base.fullNormal.returnPct+1e-9
    && pfAtLeast(m.fullNormal,base.fullNormal,1.0)
    && m.fullNormal.maxDrawdownPct>=base.fullNormal.maxDrawdownPct-.5;
  const stressRobust=m.fullStress.returnPct>base.fullStress.returnPct+1e-9
    && pfAtLeast(m.fullStress,base.fullStress,1.0)
    && m.fullStress.maxDrawdownPct>=base.fullStress.maxDrawdownPct-.5;
  const strictPass=incumbentIdentityPreserved&&onlyAddsLong&&normalHoldoutPositive&&stressHoldoutPositive&&fullNormalImproves&&stressRobust;
  return {schema:"pengu-v67-independent-new-long/v1",incumbent:base,frozenV64Config:V67_FROZEN_V64_CONFIG,candidateCount:candidates.length,eligibleCount:eligible.length,candidates,selectedMode:selected.mode,selectedFamily:selected.family,selectedTraining:selected,trainingEligible:true,incumbentIdentityPreserved,onlyAddsLong,addedLongTrades:{normal:addedN.length,stress:addedS.length},holdoutAddedLongTrades,metrics:m,normalHoldoutPositive,stressHoldoutPositive,stressRobust,fullNormalImproves,materialIntegratedGain:null,strictPass,decision:strictPass?"ADOPT_V67_NEW_LONG_RESEARCH_CANDIDATE":"KEEP_V64_RESEARCH_CANDIDATE",reason:strictPass?"Train-selected fixed independent Long family added real Holdout trades and improved Normal/Stress without removing any V64 incumbent trade.":"Train-selected independent Long family failed untouched Holdout, identity, PF/DD, or full-period robustness guards."};
}
'''
if marker not in src:
    raise SystemExit('longDiagnostics marker missing')
src = src.replace(marker, insert + marker, 1)

start = src.index('  const v64 = evaluateV64(rows,funding,baselineNormal);')
end = src.index('\n}\n\nmain().catch', start)
tail = r'''  const v67=evaluateV67(rows,funding,baselineNormal);
  v64ActiveConfig=V67_FROZEN_V64_CONFIG;
  const incumbentNormal=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  const incumbentStress=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
  const selectedMode=(v67.selectedMode??"V64_DYNAMIC") as LongMode;
  const candidateNormal=v67.selectedMode?replay(rows,funding,{mode:"normal",longMode:selectedMode}).trades:incumbentNormal;
  const candidateStress=v67.selectedMode?replay(rows,funding,{mode:"stress",longMode:selectedMode}).trades:incumbentStress;
  const finalNormal=v67.strictPass?candidateNormal:incumbentNormal;
  const finalStress=v67.strictPass?candidateStress:incumbentStress;
  const resultPayload={status:"PASS_RESEARCH_ONLY",period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true,requiresActualAddedLongTrades:true},source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},longDiagnostics:longDiag,v67,final:{promoted:v67.strictPass,longMode:v67.strictPass?selectedMode:"V64_DYNAMIC",normal:metrics(finalNormal),stress:metrics(finalStress)},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  function mkLedger(tradesN:RichTrade[],tradesS:RichTrade[],variant:string,family:V67Family|null) { return {
    schema:"pengu-dual-ls-v2-aster-ledger/v1",strategyId:PENGU_DUAL_LS_V2.id,longVariant:variant,shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",currentProductionSourceSha:SOURCE_SHA,researchOnly:true,
    researchCandidate:{longMode:variant,newLongClass:family?V67_NEW_LONG:null,selectedFamily:family,frozenV64Config:V67_FROZEN_V64_CONFIG,diagnosticsSchema:"pengu-v67-independent-new-long/v1"},period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},
    data:{penguRows:pengu.length,btcRows:btc.length,fundingRows:funding.length,availableStart:new Date(pengu[0].openTime).toISOString(),availableEndExclusive:new Date(pengu.at(-1)!.openTime+HOUR).toISOString(),requestedStart:new Date(EVAL_START).toISOString(),requestedEndExclusive:new Date(EVAL_END).toISOString(),coverageNote:"No pre-listing PENGU data is synthesized."},
    integrity:{noOverlap:tradesN.every((t,i)=>i===0||t.entryTs>tradesN[i-1].exitTs),maximumRequestedGross:Math.max(...tradesN.map(t=>t.requestedGross))},modes:{normal:{metrics:metrics(tradesN),trades:tradesN.map(publicTrade)},stress:{metrics:metrics(tradesS),trades:tradesS.map(publicTrade)}},safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}
  }; }
  const incumbentLedger=mkLedger(incumbentNormal,incumbentStress,"PENGU_DUAL_LS_V2_FINAL_V64_FROZEN",null);
  const candidateLedger=mkLedger(candidateNormal,candidateStress,v67.selectedMode?`PENGU_DUAL_LS_V2_FINAL_${v67.selectedFamily}`:"PENGU_DUAL_LS_V2_FINAL_V64_FROZEN",v67.selectedFamily as V67Family|null);
  assert.equal(incumbentLedger.integrity.noOverlap,true); assert.equal(candidateLedger.integrity.noOverlap,true);
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v67-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"incumbent-v64-pengu-ledger.json"),JSON.stringify(incumbentLedger,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"candidate-pengu-ledger.json"),JSON.stringify(candidateLedger,null,2)+"\n","utf8");
  console.log("V67_RESULT="+JSON.stringify({decision:v67.decision,selectedFamily:v67.selectedFamily,trainingEligible:v67.trainingEligible,incumbentIdentityPreserved:v67.incumbentIdentityPreserved,holdoutAddedLongTrades:v67.holdoutAddedLongTrades,normalHoldoutPositive:v67.normalHoldoutPositive,stressHoldoutPositive:v67.stressHoldoutPositive,stressRobust:v67.stressRobust,fullNormalImproves:v67.fullNormalImproves,materialIntegratedGain:v67.materialIntegratedGain,strictPass:v67.strictPass}));
'''
src = src[:start] + tail + src[end:]
TARGET.write_text(src)
print(f'PATCHED_V67={TARGET} bytes={TARGET.stat().st_size}')
