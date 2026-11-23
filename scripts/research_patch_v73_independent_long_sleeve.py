from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()
marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
type V73Family = "EMA72_REGIME_FLIP";
const V73_NEW_LONG_GROSS = 0.25;
const V73_MATERIAL_GAIN_MULTIPLE = 1.05;
const V73_NEW_LONG_SLEEVE = "PENGU_V73_NEW_LONG_SLEEVE";
const V73_MIN_TRADES_PER_FOLD = 2;
const V73_FOLD_BOUNDARIES = [
  "2025-08-10T00:00:00Z",
  "2025-12-09T16:00:00Z",
  "2026-04-10T08:00:00Z",
  "2026-08-10T00:00:00Z",
].map(x=>Date.parse(x));
const V73_FROZEN_V64_CONFIG:V64Config={
  rule:{feature:"penguReturn72h",op:"lte",threshold:0.12049482888834451},
  lowGross:0.1875,
  label:"penguReturn72h_lte_0.12049483_LOW0.1875",
  trainScore:31.7010356792032,
};
function v73Raw(rows:PenguDualLsV2EvaluationRow[],index:number) {
  if(index<7) return false;
  const row=rows[index], f=row.features, prev=rows[index-1].features;
  if(!f || !prev || row.shortSignal || longRawForMode(row,"V64_DYNAMIC")) return false;
  let below=0, valid=0;
  for(let j=index-6;j<=index-1;j+=1) {
    const x=rows[j].features;
    if(!x) continue;
    valid+=1;
    if(x.close<=x.ema72) below+=1;
  }
  const regimeFlip=valid===6 && below>=4 && prev.close<=prev.ema72 && f.close>f.ema72;
  return regimeFlip
    && f.btcReturn24h>=-0.02
    && f.relativeReturn24h>=0
    && f.volumeRatio6OverPrior36>=1.0
    && f.rsi14>=50 && f.rsi14<=70
    && row.candle.close>row.candle.open;
}
function v73NewLongSignal(rows:PenguDualLsV2EvaluationRow[],index:number) {
  const current=v73Raw(rows,index), previous=index>0?v73Raw(rows,index-1):false;
  return current&&!previous;
}
function replayV73NewLongSleeve(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],mode:Mode) {
  const trades:RichTrade[]=[];
  const costPerSide=BASE_FEE_PER_SIDE+(mode==="stress"?STRESS_ADVERSE_SLIPPAGE_PER_SIDE:0);
  let index=250, cooldown=-1;
  while(index<rows.length-2) {
    if(index<=cooldown) { index+=1; continue; }
    const features=rows[index].features;
    if(!features || !v73NewLongSignal(rows,index)) { index+=1; continue; }
    const entryIndex=index+1, entry=rows[entryIndex].candle;
    let position:PenguDualLsV2Position={side:1,entryTs:entry.openTime,entryPrice:entry.open,quantity:1,gross:V73_NEW_LONG_GROSS,highWaterMark:entry.open,lowWaterMark:entry.open,entryVersion:"LONG_V2_FINAL"};
    const hold=PENGU_DUAL_LS_V2.long.maxHoldHours;
    const last=Math.min(rows.length-1,entryIndex+hold-1);
    let exitIndex=last, exitPrice=rows[last].candle.close, engineExitReason="LONG_MAX_HOLD", exitReason:ExitGroup="time";
    let bestFavorable=0,worstAdverse=0;
    for(let cursor=entryIndex;cursor<=last;cursor+=1) {
      const f=rows[cursor].features; assert(f,`features missing at ${cursor}`);
      bestFavorable=Math.max(bestFavorable,f.high/entry.open-1); worstAdverse=Math.min(worstAdverse,f.low/entry.open-1);
      const evaluation=evaluatePenguDualLsV2PositionBar(position,f); position=evaluation.updatedPosition;
      if(evaluation.exit) { exitIndex=cursor; exitPrice=evaluation.exit.stopPrice??rows[cursor].candle.close; engineExitReason=evaluation.exit.reason; exitReason=evaluation.exit.reason.includes("HARD")?"hard":evaluation.exit.reason.includes("TRAILING")?"trail":"time"; break; }
    }
    if(entry.openTime>=EVAL_START && entry.openTime<EVAL_END) {
      const exitTs=rows[exitIndex].candle.openTime, rawUnitReturn=exitPrice/entry.open-1, fundingUnitReturn=-fundingBetween(funding,entry.openTime,exitTs), costUnitReturn=-2*costPerSide, netUnitReturn=rawUnitReturn+fundingUnitReturn+costUnitReturn;
      trades.push({side:"L",signalTs:rows[index].candle.openTime,entryTs:entry.openTime,exitTs,entryPrice:entry.open,exitPrice,requestedGross:V73_NEW_LONG_GROSS,rawUnitReturn,fundingUnitReturn,costUnitReturn,netUnitReturn,accountReturn:V73_NEW_LONG_GROSS*netUnitReturn,exitReason,engineExitReason,entryFeatures:{...features},mfeUnit:bestFavorable,maeUnit:worstAdverse});
    }
    cooldown=exitIndex+PENGU_DUAL_LS_V2.cooldownHours; index=exitIndex+1;
  }
  return trades;
}
function evaluateV73(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],baselineV56Normal:RichTrade[]) {
  const derivation=deriveV57Thresholds(baselineV56Normal); v57Thresholds=derivation.thresholds; v64ActiveConfig=V73_FROZEN_V64_CONFIG;
  const incN=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades, incS=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
  const incNM=metrics(incN),incSM=metrics(incS);
  assert.equal(incNM.trades,41,`V64 incumbent trade drift: ${JSON.stringify(incNM)}`); assert.equal(incNM.longTrades,13); assert.equal(incNM.shortTrades,28); assert.ok(Math.abs(incNM.returnPct-303.9903920953809)<1e-6,`V64 return drift: ${incNM.returnPct}`);
  const normal=replayV73NewLongSleeve(rows,funding,"normal"), stress=replayV73NewLongSleeve(rows,funding,"stress");
  const folds:Array<any>=[];
  for(let i=0;i<3;i+=1) { const a=V73_FOLD_BOUNDARIES[i],b=V73_FOLD_BOUNDARIES[i+1],n=sliceByTime(normal,a,b),s=sliceByTime(stress,a,b),mn=metrics(n),ms=metrics(s); const normalPass=n.length>=V73_MIN_TRADES_PER_FOLD&&mn.returnPct>0&&(mn.profitFactor??0)>=1.0,stressPass=s.length>=V73_MIN_TRADES_PER_FOLD&&ms.returnPct>0&&(ms.profitFactor??0)>=1.0; folds.push({fold:i+1,start:new Date(a).toISOString(),end:new Date(b).toISOString(),trades:{normal:n.length,stress:s.length},metrics:{normal:mn,stress:ms},normalPass,stressPass,pass:normalPass&&stressPass}); }
  const allFoldPass=folds.every(x=>x.pass), fmN=metrics(normal),fmS=metrics(stress),strictPass=allFoldPass;
  return {schema:"pengu-v73-independent-long-sleeve/v1",family:"EMA72_REGIME_FLIP" as V73Family,frozenV64Config:V73_FROZEN_V64_CONFIG,newLongGross:V73_NEW_LONG_GROSS,materialGainThresholdMultiple:V73_MATERIAL_GAIN_MULTIPLE,incumbent:{normal:incNM,stress:incSM},folds,allFoldPass,fullMetrics:{normal:fmN,stress:fmS},strictPass,decision:strictPass?"ADOPT_V73_STANDALONE_CANDIDATE":"KEEP_V64_RESEARCH_CANDIDATE",reason:strictPass?"Fixed EMA72_REGIME_FLIP 0.25x independent Long sleeve passed all three predeclared Normal/Stress folds.":"Fixed V73 sleeve failed at least one predeclared chronological fold; no tuning permitted."};
}
'''
if marker not in src: raise SystemExit('longDiagnostics marker missing')
src=src.replace(marker,insert+marker,1)
start=src.index('  const v64 = evaluateV64(rows,funding,baselineNormal);'); end=src.index('\n}\n\nmain().catch',start)
tail=r'''  const v73=evaluateV73(rows,funding,baselineNormal);
  v64ActiveConfig=V73_FROZEN_V64_CONFIG;
  const incumbentNormal=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades, incumbentStress=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
  const newLongNormal=replayV73NewLongSleeve(rows,funding,"normal"), newLongStress=replayV73NewLongSleeve(rows,funding,"stress");
  const resultPayload={status:"PASS_RESEARCH_ONLY",period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},v73,final:{v64Preserved:true,newLongSleeveSelected:"EMA72_REGIME_FLIP",newLongSleevePromoted:v73.strictPass},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  function mkV64Ledger(tradesN:RichTrade[],tradesS:RichTrade[]) { return {schema:"pengu-dual-ls-v2-aster-ledger/v1",strategyId:PENGU_DUAL_LS_V2.id,longVariant:"PENGU_DUAL_LS_V2_FINAL_V64_FROZEN",shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",currentProductionSourceSha:SOURCE_SHA,researchOnly:true,researchCandidate:{frozenV64Config:V73_FROZEN_V64_CONFIG,diagnosticsSchema:"pengu-v73-independent-long-sleeve/v1"},period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},integrity:{noOverlap:tradesN.every((t,i)=>i===0||t.entryTs>tradesN[i-1].exitTs),maximumRequestedGross:Math.max(...tradesN.map(t=>t.requestedGross))},modes:{normal:{metrics:metrics(tradesN),trades:tradesN.map(publicTrade)},stress:{metrics:metrics(tradesS),trades:tradesS.map(publicTrade)}},safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}}; }
  function mkNewLongLedger(tradesN:RichTrade[],tradesS:RichTrade[]) { return {schema:"pengu-v73-new-long-sleeve-ledger/v1",strategyId:V73_NEW_LONG_SLEEVE,researchOnly:true,selectedFamily:"EMA72_REGIME_FLIP",requestedGross:V73_NEW_LONG_GROSS,period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},integrity:{noOverlap:tradesN.every((t,i)=>i===0||t.entryTs>tradesN[i-1].exitTs),longOnly:tradesN.every(t=>t.side==="L"),maximumRequestedGross:tradesN.length?Math.max(...tradesN.map(t=>t.requestedGross)):0},modes:{normal:{metrics:metrics(tradesN),trades:tradesN.map(publicTrade)},stress:{metrics:metrics(tradesS),trades:tradesS.map(publicTrade)}},safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}}; }
  const incumbentLedger=mkV64Ledger(incumbentNormal,incumbentStress),newLongLedger=mkNewLongLedger(newLongNormal,newLongStress); assert.equal(incumbentLedger.integrity.noOverlap,true); assert.equal(newLongLedger.integrity.noOverlap,true); assert.equal(newLongLedger.integrity.longOnly,true);
  await fs.mkdir(OUTPUT_DIR,{recursive:true}); await fs.writeFile(path.join(OUTPUT_DIR,"v73-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8"); await fs.writeFile(path.join(OUTPUT_DIR,"incumbent-v64-pengu-ledger.json"),JSON.stringify(incumbentLedger,null,2)+"\n","utf8"); await fs.writeFile(path.join(OUTPUT_DIR,"new-long-sleeve-ledger.json"),JSON.stringify(newLongLedger,null,2)+"\n","utf8"); console.log("V73_RESULT="+JSON.stringify({decision:v73.decision,family:v73.family,allFoldPass:v73.allFoldPass,strictPass:v73.strictPass,fullMetrics:v73.fullMetrics,folds:v73.folds}));
'''
src=src[:start]+tail+src[end:]
TARGET.write_text(src)
print(f'PATCHED_V73={TARGET} bytes={TARGET.stat().st_size}')
