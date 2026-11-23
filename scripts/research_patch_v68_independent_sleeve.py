from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

if 'V67_NEW_LONG' not in src or 'V67_FROZEN_V64_CONFIG' not in src:
    raise SystemExit('V67 patch must be applied before V68')

marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
const V68_INDEPENDENT_SLEEVE = "V68_INDEPENDENT_SLEEVE";
const V68_NEW_LONG_MAX_GROSS = 0.375;
const V68_FROZEN_V64_CONFIG:V64Config={
  rule:{feature:"penguReturn72h",op:"lte",threshold:0.12049482888834451},
  lowGross:0.1875,
  label:"penguReturn72h_lte_0.12049483_LOW0.1875",
  trainScore:31.7010356792032,
};

type V68SleeveReplay = {trades:RichTrade[];family:V67Family;mode:Mode};

function v68ModeForFamily(family:V67Family):LongMode {
  if(family==="PULLBACK_CONTINUATION") return "V67_PULLBACK_CONTINUATION";
  if(family==="BREAKOUT_CONFIRMATION") return "V67_BREAKOUT_CONFIRMATION";
  return "V67_OVERSOLD_REVERSAL";
}

function replayV68NewLongSleeve(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],mode:Mode,family:V67Family):V68SleeveReplay {
  const trades:RichTrade[]=[];
  const costPerSide=BASE_FEE_PER_SIDE+(mode==="stress"?STRESS_ADVERSE_SLIPPAGE_PER_SIDE:0);
  const familyMode=v68ModeForFamily(family);
  let index=250;
  let cooldown=-1;
  while(index<rows.length-2) {
    if(index<=cooldown) { index+=1; continue; }
    const features=rows[index].features;
    if(!features) { index+=1; continue; }
    const current=v67FamilyRaw(rows,index,family);
    const previous=index>0?v67FamilyRaw(rows,index-1,family):false;
    const signal=current&&!previous;
    if(!signal) { index+=1; continue; }
    assert.equal(v67NewLongSignal(rows,index,familyMode),true);
    const entryIndex=index+1;
    const entry=rows[entryIndex].candle;
    const requestedGross=Math.min(V68_NEW_LONG_MAX_GROSS,targetGrossForAtr(features.atr24Ratio,1));
    let position:PenguDualLsV2Position={
      side:1,entryTs:entry.openTime,entryPrice:entry.open,quantity:1,gross:requestedGross,
      highWaterMark:entry.open,lowWaterMark:entry.open,entryVersion:"V68_INDEPENDENT_NEW_LONG",
    };
    const hold=PENGU_DUAL_LS_V2.long.maxHoldHours;
    const last=Math.min(rows.length-1,entryIndex+hold-1);
    let exitIndex=last;
    let exitPrice=rows[last].candle.close;
    let engineExitReason="LONG_MAX_HOLD";
    let exitReason:ExitGroup="time";
    let bestFavorable=0,worstAdverse=0;
    for(let cursor=entryIndex;cursor<=last;cursor+=1) {
      const f=rows[cursor].features; assert(f,`features missing at ${cursor}`);
      bestFavorable=Math.max(bestFavorable,f.high/entry.open-1);
      worstAdverse=Math.min(worstAdverse,f.low/entry.open-1);
      const evaluation=evaluatePenguDualLsV2PositionBar(position,f);
      position=evaluation.updatedPosition;
      if(evaluation.exit) {
        exitIndex=cursor;
        exitPrice=evaluation.exit.stopPrice??rows[cursor].candle.close;
        engineExitReason=evaluation.exit.reason;
        exitReason=evaluation.exit.reason.includes("HARD")?"hard":evaluation.exit.reason.includes("TRAILING")?"trail":"time";
        break;
      }
    }
    if(entry.openTime>=EVAL_START&&entry.openTime<EVAL_END) {
      const exitTs=rows[exitIndex].candle.openTime;
      const rawUnitReturn=exitPrice/entry.open-1;
      const fundingRate=fundingBetween(funding,entry.openTime,exitTs);
      const fundingUnitReturn=-fundingRate;
      const costUnitReturn=-2*costPerSide;
      const netUnitReturn=rawUnitReturn+fundingUnitReturn+costUnitReturn;
      trades.push({side:"L",signalTs:rows[index].candle.openTime,entryTs:entry.openTime,exitTs,entryPrice:entry.open,exitPrice,requestedGross,rawUnitReturn,fundingUnitReturn,costUnitReturn,netUnitReturn,accountReturn:requestedGross*netUnitReturn,exitReason,engineExitReason,entryFeatures:{...features},mfeUnit:bestFavorable,maeUnit:worstAdverse});
    }
    cooldown=exitIndex+PENGU_DUAL_LS_V2.cooldownHours;
    index=exitIndex+1;
  }
  return {trades,family,mode};
}

function v68CombinedMetrics(core:RichTrade[],sleeve:RichTrade[]) {
  return metrics([...core,...sleeve].sort((a,b)=>a.exitTs-b.exitTs||a.signalTs-b.signalTs));
}

function evaluateV68(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],baselineV56Normal:RichTrade[]) {
  const derivation=deriveV57Thresholds(baselineV56Normal); v57Thresholds=derivation.thresholds;
  v64ActiveConfig=V68_FROZEN_V64_CONFIG;
  const coreN=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  const coreS=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
  const coreNM=metrics(coreN),coreSM=metrics(coreS);
  const v64CoreIdentityPass=coreNM.trades===41&&coreNM.longTrades===13&&coreNM.shortTrades===28
    && Math.abs(coreNM.returnPct-303.9903920953809)<1e-6
    && Math.abs(coreSM.returnPct-224.20754349037898)<1e-6;
  assert(v64CoreIdentityPass,`Frozen V64 core drift: ${JSON.stringify({normal:coreNM,stress:coreSM})}`);
  const sl=(x:RichTrade[],a:number,b:number)=>sliceByTime(x,a,b);
  const candidates:Array<any>=[];
  for(const family of ["PULLBACK_CONTINUATION","BREAKOUT_CONFIRMATION","OVERSOLD_REVERSAL"] as V67Family[]) {
    const n=replayV68NewLongSleeve(rows,funding,"normal",family).trades;
    const s=replayV68NewLongSleeve(rows,funding,"stress",family).trades;
    const nt=sl(n,EVAL_START,HOLDOUT_CUTOFF),st=sl(s,EVAL_START,HOLDOUT_CUTOFF);
    const mn=metrics(nt),ms=metrics(st);
    const trainingEligible=mn.trades>=2&&ms.trades>=2
      && mn.returnPct>0&&ms.returnPct>0
      && (mn.profitFactor??0)>=1.05&&(ms.profitFactor??0)>=1.0
      && mn.maxDrawdownPct>=-15&&ms.maxDrawdownPct>=-17;
    const trainScore=mn.returnPct+.5*ms.returnPct;
    candidates.push({family,trainingEligible,trainScore,trainNormal:mn,trainStress:ms,fullNormal:metrics(n),fullStress:metrics(s)});
  }
  const eligible=candidates.filter(x=>x.trainingEligible).sort((a,b)=>b.trainScore-a.trainScore);
  const selected=eligible[0]??null;
  if(!selected) return {schema:"pengu-v68-independent-sleeve/v1",frozenV64Config:V68_FROZEN_V64_CONFIG,v64CoreIdentityPass,core:{normal:coreNM,stress:coreSM},candidateCount:candidates.length,eligibleCount:0,candidates,selectedFamily:null,trainingEligible:false,newLongSleeve:null,holdoutAddedLongTrades:{normal:0,stress:0},normalHoldoutPositive:false,stressHoldoutPositive:false,stressRobust:false,fullNormalImproves:false,strictPass:false,decision:"KEEP_V64_RESEARCH_CANDIDATE",reason:"No independent Long sleeve family was profitable enough on Train under Normal/Stress guards."};
  const newN=replayV68NewLongSleeve(rows,funding,"normal",selected.family).trades;
  const newS=replayV68NewLongSleeve(rows,funding,"stress",selected.family).trades;
  const holdN=sl(newN,HOLDOUT_CUTOFF,EVAL_END),holdS=sl(newS,HOLDOUT_CUTOFF,EVAL_END);
  const holdNM=metrics(holdN),holdSM=metrics(holdS),fullNM=metrics(newN),fullSM=metrics(newS);
  const holdoutAddedLongTrades={normal:holdN.length,stress:holdS.length};
  const normalHoldoutPositive=holdN.length>=2&&holdNM.returnPct>0&&(holdNM.profitFactor??0)>=1.0&&holdNM.maxDrawdownPct>=-12;
  const stressHoldoutPositive=holdS.length>=2&&holdSM.returnPct>0&&(holdSM.profitFactor??0)>=1.0&&holdSM.maxDrawdownPct>=-15;
  const combinedN=v68CombinedMetrics(coreN,newN),combinedS=v68CombinedMetrics(coreS,newS);
  const fullNormalImproves=fullNM.returnPct>0&&combinedN.returnPct>coreNM.returnPct+1e-9&&(combinedN.profitFactor??0)>=(coreNM.profitFactor??0)*.99&&combinedN.maxDrawdownPct>=coreNM.maxDrawdownPct-1.0;
  const stressRobust=fullSM.returnPct>0&&combinedS.returnPct>coreSM.returnPct+1e-9&&(combinedS.profitFactor??0)>=(coreSM.profitFactor??0)*.99&&combinedS.maxDrawdownPct>=coreSM.maxDrawdownPct-1.0;
  const strictPass=v64CoreIdentityPass&&normalHoldoutPositive&&stressHoldoutPositive&&fullNormalImproves&&stressRobust;
  const newLongSleeve={class:V68_INDEPENDENT_SLEEVE,maxGross:V68_NEW_LONG_MAX_GROSS,selectedFamily:selected.family,normal:fullNM,stress:fullSM,holdoutNormal:holdNM,holdoutStress:holdSM};
  return {schema:"pengu-v68-independent-sleeve/v1",frozenV64Config:V68_FROZEN_V64_CONFIG,v64CoreIdentityPass,core:{normal:coreNM,stress:coreSM},candidateCount:candidates.length,eligibleCount:eligible.length,candidates,selectedFamily:selected.family,selectedTraining:selected,trainingEligible:true,newLongSleeve,holdoutAddedLongTrades,normalHoldoutPositive,stressHoldoutPositive,combinedProxy:{normal:combinedN,stress:combinedS},stressRobust,fullNormalImproves,strictPass,decision:strictPass?"ADOPT_V68_INDEPENDENT_SLEEVE_RESEARCH_CANDIDATE":"KEEP_V64_RESEARCH_CANDIDATE",reason:strictPass?"Independent Long sleeve survived untouched Holdout while the V64 core remained bit-for-bit strategy-identical.":"Independent sleeve failed Holdout and/or full-period robustness guards; V64 remains protected."};
}
'''
if marker not in src:
    raise SystemExit('longDiagnostics marker missing')
src = src.replace(marker, insert + marker, 1)

start = src.index('  const v67=evaluateV67(rows,funding,baselineNormal);')
end = src.index('\n}\n\nmain().catch', start)
tail = r'''  const v68=evaluateV68(rows,funding,baselineNormal);
  v64ActiveConfig=V68_FROZEN_V64_CONFIG;
  const coreNormal=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  const coreStress=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades;
  const selectedFamily=v68.selectedFamily as V67Family|null;
  const newNormal=selectedFamily?replayV68NewLongSleeve(rows,funding,"normal",selectedFamily).trades:[];
  const newStress=selectedFamily?replayV68NewLongSleeve(rows,funding,"stress",selectedFamily).trades:[];
  const resultPayload={status:"PASS_RESEARCH_ONLY",period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(),selectionFraction:2/3,untouchedForSelection:true,requiresActualAddedLongTrades:true},source:{productionLogicSha:SOURCE_SHA,venue:"Aster perpetual public REST V3"},longDiagnostics:longDiag,v68,final:{promoted:v68.strictPass,coreMode:"V64_DYNAMIC",newLongSleeve:selectedFamily?V68_INDEPENDENT_SLEEVE:null,selectedFamily,coreNormal:metrics(coreNormal),coreStress:metrics(coreStress),newNormal:metrics(newNormal),newStress:metrics(newStress)},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  function mkCoreLedger(tradesN:RichTrade[],tradesS:RichTrade[]) { return {
    schema:"pengu-dual-ls-v2-aster-ledger/v1",strategyId:PENGU_DUAL_LS_V2.id,longVariant:"PENGU_DUAL_LS_V2_FINAL_V64_FROZEN",shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",currentProductionSourceSha:SOURCE_SHA,researchOnly:true,
    researchCandidate:{longMode:"V64_DYNAMIC",frozenV64Config:V68_FROZEN_V64_CONFIG,protectedBy:"V68_INDEPENDENT_SLEEVE",diagnosticsSchema:"pengu-v68-independent-sleeve/v1"},period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},
    integrity:{noOverlap:tradesN.every((t,i)=>i===0||t.entryTs>tradesN[i-1].exitTs),maximumRequestedGross:Math.max(...tradesN.map(t=>t.requestedGross))},modes:{normal:{metrics:metrics(tradesN),trades:tradesN.map(publicTrade)},stress:{metrics:metrics(tradesS),trades:tradesS.map(publicTrade)}},safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}
  }; }
  function mkNewLedger(tradesN:RichTrade[],tradesS:RichTrade[],family:V67Family|null) { return {
    schema:"pengu-v68-new-long-sleeve-ledger/v1",strategyId:"PENGU_V68_NEW_LONG_SLEEVE",longVariant:family?`V68_${family}`:"V68_NONE",researchOnly:true,
    researchCandidate:{class:V68_INDEPENDENT_SLEEVE,selectedFamily:family,maxGross:V68_NEW_LONG_MAX_GROSS,diagnosticsSchema:"pengu-v68-independent-sleeve/v1"},period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},
    integrity:{longOnly:tradesN.every(t=>t.side==="L")&&tradesS.every(t=>t.side==="L"),noOverlap:tradesN.every((t,i)=>i===0||t.entryTs>tradesN[i-1].exitTs),maximumRequestedGross:tradesN.length?Math.max(...tradesN.map(t=>t.requestedGross)):0},modes:{normal:{metrics:metrics(tradesN),trades:tradesN.map(publicTrade)},stress:{metrics:metrics(tradesS),trades:tradesS.map(publicTrade)}},safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}
  }; }
  const coreLedger=mkCoreLedger(coreNormal,coreStress);
  const newLedger=mkNewLedger(newNormal,newStress,selectedFamily);
  assert.equal(coreLedger.integrity.noOverlap,true); assert.equal(newLedger.integrity.longOnly,true); assert.equal(newLedger.integrity.noOverlap,true);
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"v68-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"incumbent-v64-pengu-ledger.json"),JSON.stringify(coreLedger,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"pengu-new-long-ledger.json"),JSON.stringify(newLedger,null,2)+"\n","utf8");
  console.log("V68_RESULT="+JSON.stringify({decision:v68.decision,selectedFamily:v68.selectedFamily,trainingEligible:v68.trainingEligible,v64CoreIdentityPass:v68.v64CoreIdentityPass,newLongSleeve:v68.newLongSleeve,holdoutAddedLongTrades:v68.holdoutAddedLongTrades,normalHoldoutPositive:v68.normalHoldoutPositive,stressHoldoutPositive:v68.stressHoldoutPositive,stressRobust:v68.stressRobust,fullNormalImproves:v68.fullNormalImproves,strictPass:v68.strictPass}));
'''
src = src[:start] + tail + src[end:]
TARGET.write_text(src)
print(f'PATCHED_V68={TARGET} bytes={TARGET.stat().st_size}')
