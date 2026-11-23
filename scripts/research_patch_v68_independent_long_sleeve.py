from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
type V68Family = "PULLBACK_CONTINUATION" | "BREAKOUT_CONFIRMATION" | "OVERSOLD_REVERSAL";
const V68_NEW_LONG_GROSS = 0.25;
const V68_MATERIAL_GAIN_MULTIPLE = 1.05;
const V68_NEW_LONG_SLEEVE = "PENGU_V68_NEW_LONG_SLEEVE";
const V68_FAMILIES:V68Family[]=["PULLBACK_CONTINUATION","BREAKOUT_CONFIRMATION","OVERSOLD_REVERSAL"];
const V68_FROZEN_V64_CONFIG:V64Config={
  rule:{feature:"penguReturn72h",op:"lte",threshold:0.12049482888834451},
  lowGross:0.1875,
  label:"penguReturn72h_lte_0.12049483_LOW0.1875",
  trainScore:31.7010356792032,
};

function v68OneHourReturn(rows:PenguDualLsV2EvaluationRow[],index:number) {
  if(index<=0) return 0;
  return rows[index].candle.close/Math.max(1e-12,rows[index-1].candle.close)-1;
}
function v68IncumbentRaw(row:PenguDualLsV2EvaluationRow) {
  return longRawForMode(row,"V64_DYNAMIC");
}
function v68FamilyRaw(rows:PenguDualLsV2EvaluationRow[],index:number,family:V68Family) {
  if(index<2) return false;
  const row=rows[index], f=row.features;
  if(!f || row.shortSignal || v68IncumbentRaw(row)) return false;
  const r1=v68OneHourReturn(rows,index), prevR1=v68OneHourReturn(rows,index-1);
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
function v68NewLongSignal(rows:PenguDualLsV2EvaluationRow[],index:number,family:V68Family) {
  const current=v68FamilyRaw(rows,index,family);
  const previous=index>0?v68FamilyRaw(rows,index-1,family):false;
  return current&&!previous;
}
function replayV68NewLongSleeve(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],mode:Mode,family:V68Family) {
  const trades:RichTrade[]=[];
  const costPerSide=BASE_FEE_PER_SIDE+(mode==="stress"?STRESS_ADVERSE_SLIPPAGE_PER_SIDE:0);
  let index=250, cooldown=-1;
  while(index<rows.length-2) {
    if(index<=cooldown) { index+=1; continue; }
    const features=rows[index].features;
    if(!features || !v68NewLongSignal(rows,index,family)) { index+=1; continue; }
    const entryIndex=index+1, entry=rows[entryIndex].candle;
    let position:PenguDualLsV2Position={
      side:1,entryTs:entry.openTime,entryPrice:entry.open,quantity:1,gross:V68_NEW_LONG_GROSS,
      highWaterMark:entry.open,lowWaterMark:entry.open,entryVersion:"LONG_V2_FINAL",
    };
    const hold=PENGU_DUAL_LS_V2.long.maxHoldHours;
    const last=Math.min(rows.length-1,entryIndex+hold-1);
    let exitIndex=last, exitPrice=rows[last].candle.close, engineExitReason="LONG_MAX_HOLD", exitReason:ExitGroup="time";
    let bestFavorable=0,worstAdverse=0;
    for(let cursor=entryIndex;cursor<=last;cursor+=1) {
      const f=rows[cursor].features; assert(f,`features missing at ${cursor}`);
      bestFavorable=Math.max(bestFavorable,f.high/entry.open-1);
      worstAdverse=Math.min(worstAdverse,f.low/entry.open-1);
      const evaluation=evaluatePenguDualLsV2PositionBar(position,f); position=evaluation.updatedPosition;
      if(evaluation.exit) {
        exitIndex=cursor; exitPrice=evaluation.exit.stopPrice??rows[cursor].candle.close;
        engineExitReason=evaluation.exit.reason;
        exitReason=evaluation.exit.reason.includes("HARD")?"hard":evaluation.exit.reason.includes("TRAILING")?"trail":"time";
        break;
      }
    }
    if(entry.openTime>=EVAL_START && entry.openTime<EVAL_END) {
      const exitTs=rows[exitIndex].candle.openTime;
      const rawUnitReturn=exitPrice/entry.open-1;
      const fundingRate=fundingBetween(funding,entry.openTime,exitTs);
      const fundingUnitReturn=-fundingRate;
      const costUnitReturn=-2*costPerSide;
      const netUnitReturn=rawUnitReturn+fundingUnitReturn+costUnitReturn;
      trades.push({side:"L",signalTs:rows[index].candle.openTime,entryTs:entry.openTime,exitTs,entryPrice:entry.open,exitPrice,
        requestedGross:V68_NEW_LONG_GROSS,rawUnitReturn,fundingUnitReturn,costUnitReturn,netUnitReturn,
        accountReturn:V68_NEW_LONG_GROSS*netUnitReturn,exitReason,engineExitReason,entryFeatures:{...features},mfeUnit:bestFavorable,maeUnit:worstAdverse});
    }
    cooldown=exitIndex+PENGU_DUAL_LS_V2.cooldownHours;
    index=exitIndex+1;
  }
  return trades;
}
function evaluateV68(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],baselineV56Normal:RichTrade[]) {
  const derivation=deriveV57Thresholds(baselineV56Normal); v57Thresholds=derivation.thresholds;
  v64ActiveConfig=V68_FROZEN_V64_CONFIG;
  const incN=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  const incS=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
  const incNM=metrics(incN),incSM=metrics(incS);
  assert.equal(incNM.trades,41,`V64 incumbent trade drift: ${JSON.stringify(incNM)}`);
  assert.equal(incNM.longTrades,13); assert.equal(incNM.shortTrades,28);
  assert.ok(Math.abs(incNM.returnPct-303.9903920953809)<1e-6,`V64 return drift: ${incNM.returnPct}`);
  const sl=(x:RichTrade[],a:number,b:number)=>sliceByTime(x,a,b);
  const candidates:Array<any>=[];
  for(const family of V68_FAMILIES) {
    const n=replayV68NewLongSleeve(rows,funding,"normal",family),s=replayV68NewLongSleeve(rows,funding,"stress",family);
    const nt=sl(n,EVAL_START,HOLDOUT_CUTOFF),st=sl(s,EVAL_START,HOLDOUT_CUTOFF);
    const mn=metrics(nt),ms=metrics(st);
    const trainingEligible=nt.length>=4&&st.length>=4
      && mn.returnPct>0&&ms.returnPct>0
      && (mn.profitFactor??0)>=1.20&&(ms.profitFactor??0)>=1.05
      && mn.maxDrawdownPct>=-15&&ms.maxDrawdownPct>=-18;
    const trainScore=mn.returnPct+.5*ms.returnPct+.2*(mn.profitFactor??0)+.1*(ms.profitFactor??0);
    candidates.push({family,trainingEligible,trainTrades:{normal:nt.length,stress:st.length},trainMetrics:{normal:mn,stress:ms},trainScore});
  }
  const eligible=candidates.filter(x=>x.trainingEligible).sort((a,b)=>b.trainScore-a.trainScore);
  const selected=eligible[0]??null;
  if(!selected) return {schema:"pengu-v68-independent-long-sleeve/v1",frozenV64Config:V68_FROZEN_V64_CONFIG,newLongGross:V68_NEW_LONG_GROSS,materialGainThresholdMultiple:V68_MATERIAL_GAIN_MULTIPLE,incumbent:{normal:incNM,stress:incSM},candidateCount:candidates.length,eligibleCount:0,candidates,selectedFamily:null,trainingEligible:false,holdoutTrades:{normal:0,stress:0},normalHoldoutPositive:false,stressHoldoutPositive:false,fullNormalPositive:false,stressRobust:false,strictPass:false,decision:"KEEP_V64_RESEARCH_CANDIDATE",reason:"No fixed 0.25x independent Long sleeve family was profitable and robust in Train under Normal/Stress."};
  const family=selected.family as V68Family;
  const n=replayV68NewLongSleeve(rows,funding,"normal",family),s=replayV68NewLongSleeve(rows,funding,"stress",family);
  const nh=sl(n,HOLDOUT_CUTOFF,EVAL_END),sh=sl(s,HOLDOUT_CUTOFF,EVAL_END);
  const hmN=metrics(nh),hmS=metrics(sh),fmN=metrics(n),fmS=metrics(s);
  const normalHoldoutPositive=nh.length>=2&&hmN.returnPct>0&&(hmN.profitFactor??0)>=1.0;
  const stressHoldoutPositive=sh.length>=2&&hmS.returnPct>0&&(hmS.profitFactor??0)>=1.0;
  const fullNormalPositive=fmN.trades>=6&&fmN.returnPct>0&&(fmN.profitFactor??0)>=1.10&&fmN.maxDrawdownPct>=-15;
  const stressRobust=fmS.trades>=6&&fmS.returnPct>0&&(fmS.profitFactor??0)>=1.0&&fmS.maxDrawdownPct>=-18;
  const strictPass=normalHoldoutPositive&&stressHoldoutPositive&&fullNormalPositive&&stressRobust;
  return {schema:"pengu-v68-independent-long-sleeve/v1",frozenV64Config:V68_FROZEN_V64_CONFIG,newLongGross:V68_NEW_LONG_GROSS,materialGainThresholdMultiple:V68_MATERIAL_GAIN_MULTIPLE,incumbent:{normal:incNM,stress:incSM},candidateCount:candidates.length,eligibleCount:eligible.length,candidates,selectedFamily:family,selectedTraining:selected,trainingEligible:true,holdoutTrades:{normal:nh.length,stress:sh.length},holdoutMetrics:{normal:hmN,stress:hmS},fullMetrics:{normal:fmN,stress:fmS},normalHoldoutPositive,stressHoldoutPositive,fullNormalPositive,stressRobust,strictPass,decision:strictPass?"ADOPT_V68_INDEPENDENT_LONG_SLEEVE_RESEARCH_CANDIDATE":"KEEP_V64_RESEARCH_CANDIDATE",reason:strictPass?"Train-selected fixed 0.25x independent Long sleeve remained profitable on untouched Normal/Stress Holdout.":"Train-selected independent Long sleeve failed untouched Holdout and/or full-period robustness."};
}
'''
if marker not in src:
    raise SystemExit('longDiagnostics marker missing')
src = src.replace(marker, insert + marker, 1)

start = src.index('  const v64 = evaluateV64(rows,funding,baselineNormal);')
end = src.index('\n}\n\nmain().catch', start)
tail = r'''  const v68=evaluateV68(rows,funding,baselineNormal);
  v64ActiveConfig=V68_FROZEN_V64_CONFIG;
  const incumbentNormal=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  const incumbentStress=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
  const family=v68.selectedFamily as V68Family|null;
  const newLongNormal=family?replayV68NewLongSleeve(rows,funding,"normal",family):[];
  const newLongStress=family?replayV68NewLongSleeve(rows,funding,"stress",family):[];
  const resultPayload={status:"PASS_RESEARCH_ONLY",period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true,requiresActualTrades:true},source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},longDiagnostics:longDiag,v68,final:{v64Preserved:true,newLongSleeveSelected:family,newLongSleevePromoted:v68.strictPass},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  function mkV64Ledger(tradesN:RichTrade[],tradesS:RichTrade[]) { return {
    schema:"pengu-dual-ls-v2-aster-ledger/v1",strategyId:PENGU_DUAL_LS_V2.id,longVariant:"PENGU_DUAL_LS_V2_FINAL_V64_FROZEN",shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",currentProductionSourceSha:SOURCE_SHA,researchOnly:true,
    researchCandidate:{frozenV64Config:V68_FROZEN_V64_CONFIG,diagnosticsSchema:"pengu-v68-independent-long-sleeve/v1"},period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},
    integrity:{noOverlap:tradesN.every((t,i)=>i===0||t.entryTs>tradesN[i-1].exitTs),maximumRequestedGross:Math.max(...tradesN.map(t=>t.requestedGross))},modes:{normal:{metrics:metrics(tradesN),trades:tradesN.map(publicTrade)},stress:{metrics:metrics(tradesS),trades:tradesS.map(publicTrade)}},safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}
  }; }
  function mkNewLongLedger(tradesN:RichTrade[],tradesS:RichTrade[],selected:V68Family|null) { return {
    schema:"pengu-v68-new-long-sleeve-ledger/v1",strategyId:V68_NEW_LONG_SLEEVE,researchOnly:true,selectedFamily:selected,requestedGross:V68_NEW_LONG_GROSS,
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},
    integrity:{noOverlap:tradesN.every((t,i)=>i===0||t.entryTs>tradesN[i-1].exitTs),longOnly:tradesN.every(t=>t.side==="L"),maximumRequestedGross:tradesN.length?Math.max(...tradesN.map(t=>t.requestedGross)):0},modes:{normal:{metrics:metrics(tradesN),trades:tradesN.map(publicTrade)},stress:{metrics:metrics(tradesS),trades:tradesS.map(publicTrade)}},safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}
  }; }
  const incumbentLedger=mkV64Ledger(incumbentNormal,incumbentStress);
  const newLongLedger=mkNewLongLedger(newLongNormal,newLongStress,family);
  assert.equal(incumbentLedger.integrity.noOverlap,true); assert.equal(newLongLedger.integrity.noOverlap,true); assert.equal(newLongLedger.integrity.longOnly,true);
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v68-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"incumbent-v64-pengu-ledger.json"),JSON.stringify(incumbentLedger,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"new-long-sleeve-ledger.json"),JSON.stringify(newLongLedger,null,2)+"\n","utf8");
  console.log("V68_RESULT="+JSON.stringify({decision:v68.decision,selectedFamily:v68.selectedFamily,trainingEligible:v68.trainingEligible,holdoutTrades:v68.holdoutTrades,normalHoldoutPositive:v68.normalHoldoutPositive,stressHoldoutPositive:v68.stressHoldoutPositive,fullNormalPositive:v68.fullNormalPositive,stressRobust:v68.stressRobust,strictPass:v68.strictPass}));
'''
src = src[:start] + tail + src[end:]
TARGET.write_text(src)
print(f'PATCHED_V68={TARGET} bytes={TARGET.stat().st_size}')
