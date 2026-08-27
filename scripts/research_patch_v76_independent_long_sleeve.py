from pathlib import Path
TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()
marker='\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert=r'''
type V76Family="V64_POST_EXIT_TREND_HOLD";
const V76_NEW_LONG_GROSS=0.25;
const V76_MATERIAL_GAIN_MULTIPLE=1.05;
const V76_MIN_TRADES_PER_FOLD=2;
const V76_NEW_LONG_SLEEVE="PENGU_V76_NEW_LONG_SLEEVE";
const V76_FOLD_BOUNDARIES=["2025-08-10T00:00:00Z","2025-12-09T16:00:00Z","2026-04-10T08:00:00Z","2026-08-10T00:00:00Z"].map(x=>Date.parse(x));
const V76_FROZEN_V64_CONFIG:V64Config={rule:{feature:"penguReturn72h",op:"lte",threshold:0.12049482888834451},lowGross:0.1875,label:"penguReturn72h_lte_0.12049483_LOW0.1875",trainScore:31.7010356792032};
function v76Anchors(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[]){
  v64ActiveConfig=V76_FROZEN_V64_CONFIG;
  const incumbent=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades;
  return new Map(incumbent.filter(t=>t.side==="L").map(t=>[t.exitTs,t]));
}
function v76Raw(rows:PenguDualLsV2EvaluationRow[],index:number,anchors:Map<number,RichTrade>){
  if(index<12)return false;
  const row=rows[index],f=row.features,anchor=anchors.get(rows[index-12].candle.openTime);
  if(!f||!anchor||row.shortSignal||longRawForMode(row,"V64_DYNAMIC"))return false;
  return row.candle.close>anchor.exitPrice
    && f.close>f.ema72
    && f.relativeReturn24h>=0
    && f.btcReturn24h>=-0.02
    && f.rsi14>=45&&f.rsi14<=75;
}
function replayV76NewLongSleeve(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],mode:Mode){
  const trades:RichTrade[]=[],anchors=v76Anchors(rows,funding);const costPerSide=BASE_FEE_PER_SIDE+(mode==="stress"?STRESS_ADVERSE_SLIPPAGE_PER_SIDE:0);let index=250,cooldown=-1;
  while(index<rows.length-2){if(index<=cooldown){index++;continue;}const features=rows[index].features;if(!features||!v76Raw(rows,index,anchors)){index++;continue;}const entryIndex=index+1,entry=rows[entryIndex].candle;let position:PenguDualLsV2Position={side:1,entryTs:entry.openTime,entryPrice:entry.open,quantity:1,gross:V76_NEW_LONG_GROSS,highWaterMark:entry.open,lowWaterMark:entry.open,entryVersion:"LONG_V2_FINAL"};const last=Math.min(rows.length-1,entryIndex+PENGU_DUAL_LS_V2.long.maxHoldHours-1);let exitIndex=last,exitPrice=rows[last].candle.close,engineExitReason="LONG_MAX_HOLD",exitReason:ExitGroup="time",mfe=0,mae=0;
    for(let cursor=entryIndex;cursor<=last;cursor++){const f=rows[cursor].features;assert(f);mfe=Math.max(mfe,f.high/entry.open-1);mae=Math.min(mae,f.low/entry.open-1);const e=evaluatePenguDualLsV2PositionBar(position,f);position=e.updatedPosition;if(e.exit){exitIndex=cursor;exitPrice=e.exit.stopPrice??rows[cursor].candle.close;engineExitReason=e.exit.reason;exitReason=e.exit.reason.includes("HARD")?"hard":e.exit.reason.includes("TRAILING")?"trail":"time";break;}}
    if(entry.openTime>=EVAL_START&&entry.openTime<EVAL_END){const exitTs=rows[exitIndex].candle.openTime,rawUnitReturn=exitPrice/entry.open-1,fundingUnitReturn=-fundingBetween(funding,entry.openTime,exitTs),costUnitReturn=-2*costPerSide,netUnitReturn=rawUnitReturn+fundingUnitReturn+costUnitReturn;trades.push({side:"L",signalTs:rows[index].candle.openTime,entryTs:entry.openTime,exitTs,entryPrice:entry.open,exitPrice,requestedGross:V76_NEW_LONG_GROSS,rawUnitReturn,fundingUnitReturn,costUnitReturn,netUnitReturn,accountReturn:V76_NEW_LONG_GROSS*netUnitReturn,exitReason,engineExitReason,entryFeatures:{...features},mfeUnit:mfe,maeUnit:mae});}
    cooldown=exitIndex+PENGU_DUAL_LS_V2.cooldownHours;index=exitIndex+1;
  }return trades;
}
function evaluateV76(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],baselineV56Normal:RichTrade[]){
  const derivation=deriveV57Thresholds(baselineV56Normal);v57Thresholds=derivation.thresholds;v64ActiveConfig=V76_FROZEN_V64_CONFIG;const incN=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades,incS=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades,incNM=metrics(incN),incSM=metrics(incS);assert.equal(incNM.trades,41);assert.equal(incNM.longTrades,13);assert.equal(incNM.shortTrades,28);assert.ok(Math.abs(incNM.returnPct-303.9903920953809)<1e-6);
  const normal=replayV76NewLongSleeve(rows,funding,"normal"),stress=replayV76NewLongSleeve(rows,funding,"stress"),folds:Array<any>=[];for(let i=0;i<3;i++){const a=V76_FOLD_BOUNDARIES[i],b=V76_FOLD_BOUNDARIES[i+1],n=sliceByTime(normal,a,b),s=sliceByTime(stress,a,b),mn=metrics(n),ms=metrics(s),normalPass=n.length>=V76_MIN_TRADES_PER_FOLD&&mn.returnPct>0&&(mn.profitFactor??0)>=1,stressPass=s.length>=V76_MIN_TRADES_PER_FOLD&&ms.returnPct>0&&(ms.profitFactor??0)>=1;folds.push({fold:i+1,start:new Date(a).toISOString(),end:new Date(b).toISOString(),trades:{normal:n.length,stress:s.length},metrics:{normal:mn,stress:ms},normalPass,stressPass,pass:normalPass&&stressPass});}const allFoldPass=folds.every(x=>x.pass),fmN=metrics(normal),fmS=metrics(stress),strictPass=allFoldPass;return{schema:"pengu-v76-independent-long-sleeve/v1",family:"V64_POST_EXIT_TREND_HOLD" as V76Family,frozenV64Config:V76_FROZEN_V64_CONFIG,newLongGross:V76_NEW_LONG_GROSS,materialGainThresholdMultiple:V76_MATERIAL_GAIN_MULTIPLE,incumbent:{normal:incNM,stress:incSM},folds,allFoldPass,fullMetrics:{normal:fmN,stress:fmS},strictPass,decision:strictPass?"ADOPT_V76_STANDALONE_CANDIDATE":"KEEP_V64_RESEARCH_CANDIDATE"};
}
'''
if marker not in src:raise SystemExit('marker missing')
src=src.replace(marker,insert+marker,1)
start=src.index('  const v64 = evaluateV64(rows,funding,baselineNormal);');end=src.index('\n}\n\nmain().catch',start)
tail=r'''  const v76=evaluateV76(rows,funding,baselineNormal);v64ActiveConfig=V76_FROZEN_V64_CONFIG;const incumbentNormal=replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades,incumbentStress=replay(rows,funding,{mode:"stress",longMode:"V64_DYNAMIC"}).trades,newLongNormal=replayV76NewLongSleeve(rows,funding,"normal"),newLongStress=replayV76NewLongSleeve(rows,funding,"stress");const resultPayload={status:"PASS_RESEARCH_ONLY",v76,final:{v64Preserved:true,newLongSleeveSelected:"V64_POST_EXIT_TREND_HOLD",newLongSleevePromoted:v76.strictPass},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
function mkV64(n:RichTrade[],s:RichTrade[]){return{schema:"pengu-dual-ls-v2-aster-ledger/v1",strategyId:PENGU_DUAL_LS_V2.id,longVariant:"PENGU_DUAL_LS_V2_FINAL_V64_FROZEN",shortVariant:"COUNTERWIND_VOL_TARGET_FAILURE_EXIT",currentProductionSourceSha:SOURCE_SHA,researchOnly:true,period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},integrity:{noOverlap:n.every((t,i)=>i===0||t.entryTs>n[i-1].exitTs),maximumRequestedGross:Math.max(...n.map(t=>t.requestedGross))},modes:{normal:{metrics:metrics(n),trades:n.map(publicTrade)},stress:{metrics:metrics(s),trades:s.map(publicTrade)}},safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};}function mkNew(n:RichTrade[],s:RichTrade[]){return{schema:"pengu-v76-new-long-sleeve-ledger/v1",strategyId:V76_NEW_LONG_SLEEVE,researchOnly:true,selectedFamily:"V64_POST_EXIT_TREND_HOLD",requestedGross:V76_NEW_LONG_GROSS,period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA},costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},integrity:{noOverlap:n.every((t,i)=>i===0||t.entryTs>n[i-1].exitTs),longOnly:n.every(t=>t.side==="L"),maximumRequestedGross:n.length?Math.max(...n.map(t=>t.requestedGross)):0},modes:{normal:{metrics:metrics(n),trades:n.map(publicTrade)},stress:{metrics:metrics(s),trades:s.map(publicTrade)}},safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};}const incumbentLedger=mkV64(incumbentNormal,incumbentStress),newLongLedger=mkNew(newLongNormal,newLongStress);assert.equal(newLongLedger.integrity.longOnly,true);await fs.mkdir(OUTPUT_DIR,{recursive:true});await fs.writeFile(path.join(OUTPUT_DIR,"v76-result.json"),JSON.stringify(resultPayload,null,2)+"\n");await fs.writeFile(path.join(OUTPUT_DIR,"incumbent-v64-pengu-ledger.json"),JSON.stringify(incumbentLedger,null,2)+"\n");await fs.writeFile(path.join(OUTPUT_DIR,"new-long-sleeve-ledger.json"),JSON.stringify(newLongLedger,null,2)+"\n");console.log("V76_RESULT="+JSON.stringify(v76));
'''
src=src[:start]+tail+src[end:];TARGET.write_text(src);print(f'PATCHED_V76={TARGET}')
