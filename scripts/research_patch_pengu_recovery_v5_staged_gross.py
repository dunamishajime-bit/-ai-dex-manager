from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

old='type RecoveryYieldMode="NONE"|"BASE_LONG"|"ANY_BASE";\ntype RecoveryBtConfig={rule:RecoveryRuleName;priority:RecoveryPriority;gross:number;exit:RecoveryExitConfig;yieldMode:RecoveryYieldMode};'
new='type RecoveryYieldMode="NONE"|"BASE_LONG"|"ANY_BASE";\ntype RecoveryStageMode="FULL"|"INIT25_ADD25_3"|"INIT25_ADD25_4"|"INIT25_ADD25_5"|"INIT375_ADD125_3"|"INIT375_ADD125_4"|"INIT375_ADD125_5";\ntype RecoveryBtConfig={rule:RecoveryRuleName;priority:RecoveryPriority;gross:number;exit:RecoveryExitConfig;yieldMode:RecoveryYieldMode;stageMode:RecoveryStageMode};'
if old not in src: raise SystemExit('V2 RecoveryBtConfig marker missing')
src=src.replace(old,new,1)

marker='function recoveryTradeCount(trades:RichTrade[]){return trades.filter(t=>t.engineExitReason.startsWith("RECOVERY_")).length;}'
insert=r'''
const RECOVERY_V5_STAGE_MODES:RecoveryStageMode[]=["FULL","INIT25_ADD25_3","INIT25_ADD25_4","INIT25_ADD25_5","INIT375_ADD125_3","INIT375_ADD125_4","INIT375_ADD125_5"];
function recoveryStagePlan(mode:RecoveryStageMode,totalGross:number){
 if(mode==="FULL")return{initialGross:totalGross,addonGross:0,addonTriggerPct:null as number|null};
 if(mode.startsWith("INIT25_"))return{initialGross:.25,addonGross:Math.max(0,totalGross-.25),addonTriggerPct:Number(mode.slice(-1))/100};
 return{initialGross:.375,addonGross:Math.max(0,totalGross-.375),addonTriggerPct:Number(mode.slice(-1))/100};
}
'''
if marker not in src: raise SystemExit('recoveryTradeCount marker missing')
src=src.replace(marker,insert+marker,1)

old='const entryIndex=index+1,entry=rows[entryIndex].candle;let exitIndex=entryIndex,exitPrice=entry.open,engineExitReason="",exitReason:ExitGroup="time",bestFavorable=0,worstAdverse=0;let initialShortState:any=undefined;let handoffSignalIndex:number|null=null;'
new='const entryIndex=index+1,entry=rows[entryIndex].candle;let exitIndex=entryIndex,exitPrice=entry.open,engineExitReason="",exitReason:ExitGroup="time",bestFavorable=0,worstAdverse=0;let initialShortState:any=undefined;let handoffSignalIndex:number|null=null;const stagePlan=kind==="REC_L"?recoveryStagePlan(cfg.stageMode,cfg.gross):{initialGross:requestedGross,addonGross:0,addonTriggerPct:null as number|null};let recoveryAddonEntryIndex:number|null=null,recoveryAddonEntryPrice:number|null=null;'
if old not in src: raise SystemExit('V2 entry variable marker missing')
src=src.replace(old,new,1)

old='for(let cursor=entryIndex;cursor<=last;cursor++){const c=rows[cursor].candle;bestFavorable=Math.max(bestFavorable,c.high/entry.open-1);worstAdverse=Math.min(worstAdverse,c.low/entry.open-1);if(c.low<=hardStop){exitIndex=cursor;exitPrice=hardStop;engineExitReason="RECOVERY_HARD_STOP";exitReason="hard";break;}const priorHigh=highWater;if(priorHigh>=entry.open*(1+ec.trailActivationPct)){const stop=priorHigh*(1-ec.trailRetracePct);if(c.low<=stop){exitIndex=cursor;exitPrice=stop;engineExitReason="RECOVERY_TRAILING_STOP";exitReason="trail";break;}}highWater=Math.max(highWater,c.high);if(cfg.yieldMode!=="NONE"&&cursor<last&&cursor+1<rows.length){const yLong=longSignalForMode(rows,cursor,baseLongMode),yShort=rows[cursor].shortSignal;const shouldYield=cfg.yieldMode==="ANY_BASE"?(yLong||yShort):yLong;if(shouldYield){handoffSignalIndex=cursor;exitIndex=cursor+1;exitPrice=rows[cursor+1].candle.open;engineExitReason=yShort&&!yLong?"RECOVERY_YIELD_SHORT":"RECOVERY_YIELD_LONG";exitReason="time";break;}}}'
new='for(let cursor=entryIndex;cursor<=last;cursor++){const c=rows[cursor].candle;bestFavorable=Math.max(bestFavorable,c.high/entry.open-1);worstAdverse=Math.min(worstAdverse,c.low/entry.open-1);if(c.low<=hardStop){exitIndex=cursor;exitPrice=hardStop;engineExitReason="RECOVERY_HARD_STOP";exitReason="hard";break;}const priorHigh=highWater;if(priorHigh>=entry.open*(1+ec.trailActivationPct)){const stop=priorHigh*(1-ec.trailRetracePct);if(c.low<=stop){exitIndex=cursor;exitPrice=stop;engineExitReason="RECOVERY_TRAILING_STOP";exitReason="trail";break;}}highWater=Math.max(highWater,c.high);if(recoveryAddonEntryIndex===null&&stagePlan.addonGross>0&&stagePlan.addonTriggerPct!==null&&c.close>=entry.open*(1+stagePlan.addonTriggerPct)&&cursor<last&&cursor+1<rows.length){recoveryAddonEntryIndex=cursor+1;recoveryAddonEntryPrice=rows[cursor+1].candle.open;}if(cfg.yieldMode!=="NONE"&&cursor<last&&cursor+1<rows.length){const yLong=longSignalForMode(rows,cursor,baseLongMode),yShort=rows[cursor].shortSignal;const shouldYield=cfg.yieldMode==="ANY_BASE"?(yLong||yShort):yLong;if(shouldYield){handoffSignalIndex=cursor;exitIndex=cursor+1;exitPrice=rows[cursor+1].candle.open;engineExitReason=yShort&&!yLong?"RECOVERY_YIELD_SHORT":"RECOVERY_YIELD_LONG";exitReason="time";break;}}}'
if old not in src: raise SystemExit('V2 recovery exit loop marker missing')
src=src.replace(old,new,1)

old='if(entry.openTime>=EVAL_START&&entry.openTime<EVAL_END){const exitTs=rows[exitIndex].candle.openTime,rawUnitReturn=side==="L"?exitPrice/entry.open-1:entry.open/exitPrice-1,fundingRate=fundingBetween(funding,entry.openTime,exitTs),fundingUnitReturn=side==="L"?-fundingRate:fundingRate,costUnitReturn=-2*costPerSide,netUnitReturn=rawUnitReturn+fundingUnitReturn+costUnitReturn;trades.push({side,signalTs:rows[index].candle.openTime,entryTs:entry.openTime,exitTs,entryPrice:entry.open,exitPrice,requestedGross,rawUnitReturn,fundingUnitReturn,costUnitReturn,netUnitReturn,accountReturn:requestedGross*netUnitReturn,exitReason,engineExitReason,sizingState:side==="S"?classifyPenguShortV20SizingState(requestedGross):undefined,counterwind:initialShortState?.counterwind,entryFeatures:{...f},mfeUnit:bestFavorable,maeUnit:worstAdverse});}'
new='if(entry.openTime>=EVAL_START&&entry.openTime<EVAL_END){const exitTs=rows[exitIndex].candle.openTime;let rawUnitReturn=side==="L"?exitPrice/entry.open-1:entry.open/exitPrice-1,fundingRate=fundingBetween(funding,entry.openTime,exitTs),fundingUnitReturn=side==="L"?-fundingRate:fundingRate,costUnitReturn=-2*costPerSide,netUnitReturn=rawUnitReturn+fundingUnitReturn+costUnitReturn,accountReturn=requestedGross*netUnitReturn;if(kind==="REC_L"){const initialNet=exitPrice/entry.open-1-fundingBetween(funding,entry.openTime,exitTs)-2*costPerSide;let actualGross=stagePlan.initialGross,weightedRaw=stagePlan.initialGross*(exitPrice/entry.open-1),weightedFunding=stagePlan.initialGross*(-fundingBetween(funding,entry.openTime,exitTs)),weightedCost=stagePlan.initialGross*(-2*costPerSide);accountReturn=stagePlan.initialGross*initialNet;if(recoveryAddonEntryIndex!==null&&recoveryAddonEntryPrice!==null&&recoveryAddonEntryIndex<=exitIndex){const addonTs=rows[recoveryAddonEntryIndex].candle.openTime,addonRaw=exitPrice/recoveryAddonEntryPrice-1,addonFunding=-fundingBetween(funding,addonTs,exitTs),addonCost=-2*costPerSide,addonNet=addonRaw+addonFunding+addonCost;accountReturn+=stagePlan.addonGross*addonNet;actualGross+=stagePlan.addonGross;weightedRaw+=stagePlan.addonGross*addonRaw;weightedFunding+=stagePlan.addonGross*addonFunding;weightedCost+=stagePlan.addonGross*addonCost;}requestedGross=actualGross;rawUnitReturn=actualGross>0?weightedRaw/actualGross:0;fundingUnitReturn=actualGross>0?weightedFunding/actualGross:0;costUnitReturn=actualGross>0?weightedCost/actualGross:0;netUnitReturn=actualGross>0?accountReturn/actualGross:0;}trades.push({side,signalTs:rows[index].candle.openTime,entryTs:entry.openTime,exitTs,entryPrice:entry.open,exitPrice,requestedGross,rawUnitReturn,fundingUnitReturn,costUnitReturn,netUnitReturn,accountReturn,exitReason,engineExitReason,sizingState:side==="S"?classifyPenguShortV20SizingState(requestedGross):undefined,counterwind:initialShortState?.counterwind,entryFeatures:{...f},mfeUnit:bestFavorable,maeUnit:worstAdverse});}'
if old not in src: raise SystemExit('V2 trade accounting marker missing')
src=src.replace(old,new,1)

old='for(const rule of ["R_CORE3","R_LEVEL3","R_BTC3","R_CORE2OF3"] as const)for(const priority of ["SHORT_FIRST","RECOVERY_OVER_NEW_SHORT"] as const)for(const gross of [.25,.375,.5])for(const exit of RECOVERY_EXIT_CONFIGS)for(const yieldMode of ["NONE","BASE_LONG","ANY_BASE"] as const)configs.push({rule,priority,gross,exit,yieldMode});'
new='const v5Exit=RECOVERY_EXIT_CONFIGS.find(x=>x.name==="FIXED_A6_T6_R3_H72");if(!v5Exit)throw new Error("V5 fixed exit missing");for(const stageMode of RECOVERY_V5_STAGE_MODES)configs.push({rule:"R_BTC3",priority:"SHORT_FIRST",gross:.5,exit:v5Exit,yieldMode:"BASE_LONG",stageMode});'
if old not in src: raise SystemExit('V2 candidate generation marker missing')
src=src.replace(old,new,1)

old='const score=(nf.FOLD1.returnPct-base.normalFolds.FOLD1.returnPct)+(sf.FOLD1.returnPct-base.stressFolds.FOLD1.returnPct)*.5+(nf.FOLD2.returnPct-base.normalFolds.FOLD2.returnPct)*1.5+(sf.FOLD2.returnPct-base.stressFolds.FOLD2.returnPct);evaluated.push({cfg,developmentFold1Pass:f1,validationFold2Pass:f2,untouchedFold3Pass:f3,score,metrics:m,deltas:'
new='const score=(nf.FOLD1.returnPct-base.normalFolds.FOLD1.returnPct)+(sf.FOLD1.returnPct-base.stressFolds.FOLD1.returnPct)*.5+(nf.FOLD2.returnPct-base.normalFolds.FOLD2.returnPct)*1.5+(sf.FOLD2.returnPct-base.stressFolds.FOLD2.returnPct);const riskScore=Math.min(nf.FOLD1.maxDrawdownPct-base.normalFolds.FOLD1.maxDrawdownPct,sf.FOLD1.maxDrawdownPct-base.stressFolds.FOLD1.maxDrawdownPct,nf.FOLD2.maxDrawdownPct-base.normalFolds.FOLD2.maxDrawdownPct,sf.FOLD2.maxDrawdownPct-base.stressFolds.FOLD2.maxDrawdownPct);evaluated.push({cfg,developmentFold1Pass:f1,validationFold2Pass:f2,untouchedFold3Pass:f3,score,riskScore,metrics:m,deltas:'
if old not in src: raise SystemExit('V2 score marker missing')
src=src.replace(old,new,1)

old='const survivors=evaluated.filter(x=>x.developmentFold1Pass&&x.validationFold2Pass).sort((a,b)=>b.score-a.score);'
new='const survivors=evaluated.filter(x=>x.developmentFold1Pass&&x.validationFold2Pass).sort((a,b)=>b.riskScore-a.riskScore||b.score-a.score);'
if old not in src: raise SystemExit('V2 survivor sort marker missing')
src=src.replace(old,new,1)

src=src.replace('schema:"pengu-recovery-integrated-backtest/v1"','schema:"pengu-recovery-integrated-backtest/v5-staged-gross"',1)
src=src.replace('thresholdSource:"entry thresholds fixed from Fold1 recovery-label medians only"','thresholdSource:"V2 R_BTC3 entry/exit are frozen. V5 is a post-hoc staged-gross family: initial 0.25/0.375 gross, add remaining exposure only after a causal close confirms +3/+4/+5% from entry; FOLD1/FOLD2 select only."',1)
src=src.replace('recycledHoldoutNotice:"FOLD3 informed the subordinate-yield redesign; FOLD3 is diagnostic only for V2 and is NOT a fresh holdout. External forward/cross-venue validation is required before promotion."','recycledHoldoutNotice:"FOLD3 and previously observed forward/cross-venue results are contaminated diagnostics for V5 because they motivated reducing pre-confirmation exposure. They cannot be called fresh holdouts; a new future freeze is required before LIVE promotion."',1)
src=src.replace('requirements:"Normal and Severe must improve Return in Fold1 and Fold2 with >=2 recovery trades, PF >=90% baseline, DD degradation <=2pp; final requires same on untouched Fold3 plus full Normal/Severe improvement, PF >=95%, full DD degradation <=1.5pp"','requirements:"V5 freezes V2 R_BTC3/SHORT_FIRST/FIXED_A6_T6_R3_H72/BASE_LONG and searches 7 staged-gross plans only. FOLD1/FOLD2 must still beat V64 Normal+Severe Return, PF >=90% of V64 and DD degradation <=2pp. Selection is risk-first on worst FOLD1/FOLD2 DD delta, then return score. Add-ons execute next 1h open after a qualifying close; no same-bar hindsight."',1)
src=src.replace('decision:strictPass?"RECOVERY_SLEEVE_ROBUST_CANDIDATE":"NO_ROBUST_RECOVERY_SLEEVE_YET"','decision:strictPass?"HISTORICAL_V5_STAGED_GROSS_CANDIDATE_DIAGNOSTIC_ONLY":"NO_ROBUST_RECOVERY_SLEEVE_YET"',1)

TARGET.write_text(src)
print(f'PATCHED_RECOVERY_V5_STAGED_GROSS={TARGET}')
