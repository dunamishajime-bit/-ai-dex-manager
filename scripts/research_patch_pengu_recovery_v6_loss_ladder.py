from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

old='type RecoveryYieldMode="NONE"|"BASE_LONG"|"ANY_BASE";\ntype RecoveryBtConfig={rule:RecoveryRuleName;priority:RecoveryPriority;gross:number;exit:RecoveryExitConfig;yieldMode:RecoveryYieldMode};'
new='type RecoveryYieldMode="NONE"|"BASE_LONG"|"ANY_BASE";\ntype RecoveryLossMode="FULL6"|"STOP55"|"STOP5"|"STOP45"|"HALF4_KEEP6"|"HALF45_KEEP6"|"HALF5_KEEP6";\ntype RecoveryBtConfig={rule:RecoveryRuleName;priority:RecoveryPriority;gross:number;exit:RecoveryExitConfig;yieldMode:RecoveryYieldMode;lossMode:RecoveryLossMode};'
if old not in src: raise SystemExit('V2 RecoveryBtConfig marker missing')
src=src.replace(old,new,1)

marker='function recoveryTradeCount(trades:RichTrade[]){return trades.filter(t=>t.engineExitReason.startsWith("RECOVERY_")).length;}'
insert=r'''
type RecoveryLossProfile={fullStopPct:number;partialStopPct:number|null;partialGross:number};
const RECOVERY_V6_LOSS_MODES:RecoveryLossMode[]=["FULL6","STOP55","STOP5","STOP45","HALF4_KEEP6","HALF45_KEEP6","HALF5_KEEP6"];
function recoveryLossProfile(mode:RecoveryLossMode):RecoveryLossProfile{
 if(mode==="STOP55")return{fullStopPct:.055,partialStopPct:null,partialGross:0};
 if(mode==="STOP5")return{fullStopPct:.05,partialStopPct:null,partialGross:0};
 if(mode==="STOP45")return{fullStopPct:.045,partialStopPct:null,partialGross:0};
 if(mode==="HALF4_KEEP6")return{fullStopPct:.06,partialStopPct:.04,partialGross:.25};
 if(mode==="HALF45_KEEP6")return{fullStopPct:.06,partialStopPct:.045,partialGross:.25};
 if(mode==="HALF5_KEEP6")return{fullStopPct:.06,partialStopPct:.05,partialGross:.25};
 return{fullStopPct:.06,partialStopPct:null,partialGross:0};
}
'''
if marker not in src: raise SystemExit('recoveryTradeCount marker missing')
src=src.replace(marker,insert+marker,1)

old='const entryIndex=index+1,entry=rows[entryIndex].candle;let exitIndex=entryIndex,exitPrice=entry.open,engineExitReason="",exitReason:ExitGroup="time",bestFavorable=0,worstAdverse=0;let initialShortState:any=undefined;let handoffSignalIndex:number|null=null;'
new='const entryIndex=index+1,entry=rows[entryIndex].candle;let exitIndex=entryIndex,exitPrice=entry.open,engineExitReason="",exitReason:ExitGroup="time",bestFavorable=0,worstAdverse=0;let initialShortState:any=undefined;let handoffSignalIndex:number|null=null;let recoveryPartialExitIndex:number|null=null,recoveryPartialExitPrice:number|null=null,recoveryPartialExitGross=0;'
if old not in src: raise SystemExit('V2 entry variable marker missing')
src=src.replace(old,new,1)

old='const ec=cfg.exit,last=Math.min(rows.length-1,entryIndex+ec.maxHoldHours-1);exitIndex=last;exitPrice=rows[last].candle.close;engineExitReason="RECOVERY_MAX_HOLD";let highWater=entry.open;const fixedStop=entry.open*(1-ec.hardStopPct);const structural=ec.structuralBufferPct===null?-Infinity:rec!.troughClose*(1-ec.structuralBufferPct);const hardStop=Math.max(fixedStop,structural);'
new='const ec=cfg.exit,last=Math.min(rows.length-1,entryIndex+ec.maxHoldHours-1);exitIndex=last;exitPrice=rows[last].candle.close;engineExitReason="RECOVERY_MAX_HOLD";let highWater=entry.open;const lp=recoveryLossProfile(cfg.lossMode);const fixedStop=entry.open*(1-lp.fullStopPct);const structural=ec.structuralBufferPct===null?-Infinity:rec!.troughClose*(1-ec.structuralBufferPct);const hardStop=Math.max(fixedStop,structural);const partialStop=lp.partialStopPct===null?null:entry.open*(1-lp.partialStopPct);'
if old not in src: raise SystemExit('V2 hard-stop marker missing')
src=src.replace(old,new,1)

old='for(let cursor=entryIndex;cursor<=last;cursor++){const c=rows[cursor].candle;bestFavorable=Math.max(bestFavorable,c.high/entry.open-1);worstAdverse=Math.min(worstAdverse,c.low/entry.open-1);if(c.low<=hardStop){exitIndex=cursor;exitPrice=hardStop;engineExitReason="RECOVERY_HARD_STOP";exitReason="hard";break;}const priorHigh=highWater;if(priorHigh>=entry.open*(1+ec.trailActivationPct)){const stop=priorHigh*(1-ec.trailRetracePct);if(c.low<=stop){exitIndex=cursor;exitPrice=stop;engineExitReason="RECOVERY_TRAILING_STOP";exitReason="trail";break;}}highWater=Math.max(highWater,c.high);if(cfg.yieldMode!=="NONE"&&cursor<last&&cursor+1<rows.length){const yLong=longSignalForMode(rows,cursor,baseLongMode),yShort=rows[cursor].shortSignal;const shouldYield=cfg.yieldMode==="ANY_BASE"?(yLong||yShort):yLong;if(shouldYield){handoffSignalIndex=cursor;exitIndex=cursor+1;exitPrice=rows[cursor+1].candle.open;engineExitReason=yShort&&!yLong?"RECOVERY_YIELD_SHORT":"RECOVERY_YIELD_LONG";exitReason="time";break;}}}'
new='for(let cursor=entryIndex;cursor<=last;cursor++){const c=rows[cursor].candle;bestFavorable=Math.max(bestFavorable,c.high/entry.open-1);worstAdverse=Math.min(worstAdverse,c.low/entry.open-1);if(partialStop!==null&&recoveryPartialExitIndex===null&&c.low<=partialStop){recoveryPartialExitIndex=cursor;recoveryPartialExitPrice=partialStop;recoveryPartialExitGross=lp.partialGross;}if(c.low<=hardStop){exitIndex=cursor;exitPrice=hardStop;engineExitReason=recoveryPartialExitIndex!==null?"RECOVERY_LADDER_HARD_STOP":"RECOVERY_HARD_STOP";exitReason="hard";break;}const priorHigh=highWater;if(priorHigh>=entry.open*(1+ec.trailActivationPct)){const stop=priorHigh*(1-ec.trailRetracePct);if(c.low<=stop){exitIndex=cursor;exitPrice=stop;engineExitReason=recoveryPartialExitIndex!==null?"RECOVERY_LADDER_TRAILING_STOP":"RECOVERY_TRAILING_STOP";exitReason="trail";break;}}highWater=Math.max(highWater,c.high);if(cfg.yieldMode!=="NONE"&&cursor<last&&cursor+1<rows.length){const yLong=longSignalForMode(rows,cursor,baseLongMode),yShort=rows[cursor].shortSignal;const shouldYield=cfg.yieldMode==="ANY_BASE"?(yLong||yShort):yLong;if(shouldYield){handoffSignalIndex=cursor;exitIndex=cursor+1;exitPrice=rows[cursor+1].candle.open;engineExitReason=yShort&&!yLong?"RECOVERY_YIELD_SHORT":"RECOVERY_YIELD_LONG";exitReason="time";break;}}}'
if old not in src: raise SystemExit('V2 recovery exit loop marker missing')
src=src.replace(old,new,1)

old='if(entry.openTime>=EVAL_START&&entry.openTime<EVAL_END){const exitTs=rows[exitIndex].candle.openTime,rawUnitReturn=side==="L"?exitPrice/entry.open-1:entry.open/exitPrice-1,fundingRate=fundingBetween(funding,entry.openTime,exitTs),fundingUnitReturn=side==="L"?-fundingRate:fundingRate,costUnitReturn=-2*costPerSide,netUnitReturn=rawUnitReturn+fundingUnitReturn+costUnitReturn;trades.push({side,signalTs:rows[index].candle.openTime,entryTs:entry.openTime,exitTs,entryPrice:entry.open,exitPrice,requestedGross,rawUnitReturn,fundingUnitReturn,costUnitReturn,netUnitReturn,accountReturn:requestedGross*netUnitReturn,exitReason,engineExitReason,sizingState:side==="S"?classifyPenguShortV20SizingState(requestedGross):undefined,counterwind:initialShortState?.counterwind,entryFeatures:{...f},mfeUnit:bestFavorable,maeUnit:worstAdverse});}'
new='if(entry.openTime>=EVAL_START&&entry.openTime<EVAL_END){const exitTs=rows[exitIndex].candle.openTime;let rawUnitReturn=side==="L"?exitPrice/entry.open-1:entry.open/exitPrice-1,fundingRate=fundingBetween(funding,entry.openTime,exitTs),fundingUnitReturn=side==="L"?-fundingRate:fundingRate,costUnitReturn=-2*costPerSide,netUnitReturn=rawUnitReturn+fundingUnitReturn+costUnitReturn,accountReturn=requestedGross*netUnitReturn;if(kind==="REC_L"&&recoveryPartialExitIndex!==null&&recoveryPartialExitPrice!==null&&recoveryPartialExitGross>0){const pTs=rows[recoveryPartialExitIndex].candle.openTime,pRaw=recoveryPartialExitPrice/entry.open-1,pFunding=-fundingBetween(funding,entry.openTime,pTs),pCost=-2*costPerSide,pNet=pRaw+pFunding+pCost,remainingGross=Math.max(0,cfg.gross-recoveryPartialExitGross),rRaw=exitPrice/entry.open-1,rFunding=-fundingBetween(funding,entry.openTime,exitTs),rCost=-2*costPerSide,rNet=rRaw+rFunding+rCost;accountReturn=recoveryPartialExitGross*pNet+remainingGross*rNet;rawUnitReturn=(recoveryPartialExitGross*pRaw+remainingGross*rRaw)/cfg.gross;fundingUnitReturn=(recoveryPartialExitGross*pFunding+remainingGross*rFunding)/cfg.gross;costUnitReturn=(recoveryPartialExitGross*pCost+remainingGross*rCost)/cfg.gross;netUnitReturn=accountReturn/cfg.gross;requestedGross=cfg.gross;}trades.push({side,signalTs:rows[index].candle.openTime,entryTs:entry.openTime,exitTs,entryPrice:entry.open,exitPrice,requestedGross,rawUnitReturn,fundingUnitReturn,costUnitReturn,netUnitReturn,accountReturn,exitReason,engineExitReason,sizingState:side==="S"?classifyPenguShortV20SizingState(requestedGross):undefined,counterwind:initialShortState?.counterwind,entryFeatures:{...f},mfeUnit:bestFavorable,maeUnit:worstAdverse});}'
if old not in src: raise SystemExit('V2 trade accounting marker missing')
src=src.replace(old,new,1)

old='for(const rule of ["R_CORE3","R_LEVEL3","R_BTC3","R_CORE2OF3"] as const)for(const priority of ["SHORT_FIRST","RECOVERY_OVER_NEW_SHORT"] as const)for(const gross of [.25,.375,.5])for(const exit of RECOVERY_EXIT_CONFIGS)for(const yieldMode of ["NONE","BASE_LONG","ANY_BASE"] as const)configs.push({rule,priority,gross,exit,yieldMode});'
new='const v6Exit=RECOVERY_EXIT_CONFIGS.find(x=>x.name==="FIXED_A6_T6_R3_H72");if(!v6Exit)throw new Error("V6 fixed exit missing");for(const lossMode of RECOVERY_V6_LOSS_MODES)configs.push({rule:"R_BTC3",priority:"SHORT_FIRST",gross:.5,exit:v6Exit,yieldMode:"BASE_LONG",lossMode});'
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

src=src.replace('schema:"pengu-recovery-integrated-backtest/v1"','schema:"pengu-recovery-integrated-backtest/v6-loss-ladder"',1)
src=src.replace('thresholdSource:"entry thresholds fixed from Fold1 recovery-label medians only"','thresholdSource:"V2 R_BTC3 entry and +6% trail are frozen. V6 searches only predeclared downside ladders: tighter full hard stops or a 0.25-gross partial exit at -4/-4.5/-5% while retaining 0.25 gross to the original -6% stop."',1)
src=src.replace('recycledHoldoutNotice:"FOLD3 informed the subordinate-yield redesign; FOLD3 is diagnostic only for V2 and is NOT a fresh holdout. External forward/cross-venue validation is required before promotion."','recycledHoldoutNotice:"FOLD3 and previously observed forward/cross-venue results are contaminated diagnostics for V6 because they exposed hard-stop tail risk. Only FOLD1/FOLD2 select the loss ladder. A new future freeze is required before LIVE promotion."',1)
src=src.replace('requirements:"Normal and Severe must improve Return in Fold1 and Fold2 with >=2 recovery trades, PF >=90% baseline, DD degradation <=2pp; final requires same on untouched Fold3 plus full Normal/Severe improvement, PF >=95%, full DD degradation <=1.5pp"','requirements:"V6 freezes V2 R_BTC3/SHORT_FIRST/gross0.5/FIXED_A6_T6_R3_H72/BASE_LONG and searches 7 downside-defense plans only. FOLD1/FOLD2 must still beat V64 Normal+Severe Return, PF >=90% of V64 and DD degradation <=2pp. Selection is risk-first on worst FOLD1/FOLD2 DD delta, then return score. Partial-stop accounting includes separate fees/funding for the exited and retained tranches."',1)
src=src.replace('decision:strictPass?"RECOVERY_SLEEVE_ROBUST_CANDIDATE":"NO_ROBUST_RECOVERY_SLEEVE_YET"','decision:strictPass?"HISTORICAL_V6_LOSS_LADDER_CANDIDATE_DIAGNOSTIC_ONLY":"NO_ROBUST_RECOVERY_SLEEVE_YET"',1)

TARGET.write_text(src)
print(f'PATCHED_RECOVERY_V6_LOSS_LADDER={TARGET}')
