from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

old='type RecoveryYieldMode="NONE"|"BASE_LONG"|"ANY_BASE";\ntype RecoveryBtConfig={rule:RecoveryRuleName;priority:RecoveryPriority;gross:number;exit:RecoveryExitConfig;yieldMode:RecoveryYieldMode};'
new='type RecoveryYieldMode="NONE"|"BASE_LONG"|"ANY_BASE";\ntype RecoveryRiskMode="NONE"|"P4_BE"|"P4_P05"|"P4_P1"|"P5_BE"|"P5_P05"|"P5_P1"|"P4_TRAIL3"|"P5_TRAIL3"|"FAIL24_FLAT"|"FAIL36_FLAT"|"P4_BE_FAIL24"|"P5_BE_FAIL24";\ntype RecoveryBtConfig={rule:RecoveryRuleName;priority:RecoveryPriority;gross:number;exit:RecoveryExitConfig;yieldMode:RecoveryYieldMode;riskMode:RecoveryRiskMode};'
if old not in src: raise SystemExit('V2 RecoveryBtConfig marker missing')
src=src.replace(old,new,1)

marker='function recoveryTradeCount(trades:RichTrade[]){return trades.filter(t=>t.engineExitReason.startsWith("RECOVERY_")).length;}'
insert=r'''
type RecoveryRiskProfile={protectActivationPct:number|null;protectFloorPct:number|null;protectTrailRetracePct:number|null;softFailHours:number|null;softFailMfePct:number|null;softFailCloseFloorPct:number|null};
const RECOVERY_V4_RISK_MODES:RecoveryRiskMode[]=["NONE","P4_BE","P4_P05","P4_P1","P5_BE","P5_P05","P5_P1","P4_TRAIL3","P5_TRAIL3","FAIL24_FLAT","FAIL36_FLAT","P4_BE_FAIL24","P5_BE_FAIL24"];
function recoveryRiskProfile(mode:RecoveryRiskMode):RecoveryRiskProfile{
 const z:RecoveryRiskProfile={protectActivationPct:null,protectFloorPct:null,protectTrailRetracePct:null,softFailHours:null,softFailMfePct:null,softFailCloseFloorPct:null};
 if(mode==="P4_BE")return{...z,protectActivationPct:.04,protectFloorPct:0};
 if(mode==="P4_P05")return{...z,protectActivationPct:.04,protectFloorPct:.005};
 if(mode==="P4_P1")return{...z,protectActivationPct:.04,protectFloorPct:.01};
 if(mode==="P5_BE")return{...z,protectActivationPct:.05,protectFloorPct:0};
 if(mode==="P5_P05")return{...z,protectActivationPct:.05,protectFloorPct:.005};
 if(mode==="P5_P1")return{...z,protectActivationPct:.05,protectFloorPct:.01};
 if(mode==="P4_TRAIL3")return{...z,protectActivationPct:.04,protectTrailRetracePct:.03};
 if(mode==="P5_TRAIL3")return{...z,protectActivationPct:.05,protectTrailRetracePct:.03};
 if(mode==="FAIL24_FLAT")return{...z,softFailHours:24,softFailMfePct:.04,softFailCloseFloorPct:0};
 if(mode==="FAIL36_FLAT")return{...z,softFailHours:36,softFailMfePct:.04,softFailCloseFloorPct:0};
 if(mode==="P4_BE_FAIL24")return{...z,protectActivationPct:.04,protectFloorPct:0,softFailHours:24,softFailMfePct:.04,softFailCloseFloorPct:0};
 if(mode==="P5_BE_FAIL24")return{...z,protectActivationPct:.05,protectFloorPct:0,softFailHours:24,softFailMfePct:.04,softFailCloseFloorPct:0};
 return z;
}
'''
if marker not in src: raise SystemExit('recoveryTradeCount marker missing')
src=src.replace(marker,insert+marker,1)

old='for(let cursor=entryIndex;cursor<=last;cursor++){const c=rows[cursor].candle;bestFavorable=Math.max(bestFavorable,c.high/entry.open-1);worstAdverse=Math.min(worstAdverse,c.low/entry.open-1);if(c.low<=hardStop){exitIndex=cursor;exitPrice=hardStop;engineExitReason="RECOVERY_HARD_STOP";exitReason="hard";break;}const priorHigh=highWater;if(priorHigh>=entry.open*(1+ec.trailActivationPct)){const stop=priorHigh*(1-ec.trailRetracePct);if(c.low<=stop){exitIndex=cursor;exitPrice=stop;engineExitReason="RECOVERY_TRAILING_STOP";exitReason="trail";break;}}highWater=Math.max(highWater,c.high);if(cfg.yieldMode!=="NONE"&&cursor<last&&cursor+1<rows.length){const yLong=longSignalForMode(rows,cursor,baseLongMode),yShort=rows[cursor].shortSignal;const shouldYield=cfg.yieldMode==="ANY_BASE"?(yLong||yShort):yLong;if(shouldYield){handoffSignalIndex=cursor;exitIndex=cursor+1;exitPrice=rows[cursor+1].candle.open;engineExitReason=yShort&&!yLong?"RECOVERY_YIELD_SHORT":"RECOVERY_YIELD_LONG";exitReason="time";break;}}}'
new='for(let cursor=entryIndex;cursor<=last;cursor++){const c=rows[cursor].candle;bestFavorable=Math.max(bestFavorable,c.high/entry.open-1);worstAdverse=Math.min(worstAdverse,c.low/entry.open-1);if(c.low<=hardStop){exitIndex=cursor;exitPrice=hardStop;engineExitReason="RECOVERY_HARD_STOP";exitReason="hard";break;}const priorHigh=highWater;if(priorHigh>=entry.open*(1+ec.trailActivationPct)){const stop=priorHigh*(1-ec.trailRetracePct);if(c.low<=stop){exitIndex=cursor;exitPrice=stop;engineExitReason="RECOVERY_TRAILING_STOP";exitReason="trail";break;}}const rp=recoveryRiskProfile(cfg.riskMode);if(rp.protectActivationPct!==null&&priorHigh>=entry.open*(1+rp.protectActivationPct)){let riskStop=-Infinity;if(rp.protectFloorPct!==null)riskStop=Math.max(riskStop,entry.open*(1+rp.protectFloorPct));if(rp.protectTrailRetracePct!==null)riskStop=Math.max(riskStop,priorHigh*(1-rp.protectTrailRetracePct));if(Number.isFinite(riskStop)&&c.low<=riskStop){exitIndex=cursor;exitPrice=riskStop;engineExitReason="RECOVERY_PROTECTIVE_STOP";exitReason="trail";break;}}highWater=Math.max(highWater,c.high);if(rp.softFailHours!==null&&rp.softFailMfePct!==null&&rp.softFailCloseFloorPct!==null&&cursor-entryIndex+1>=rp.softFailHours&&bestFavorable<rp.softFailMfePct&&c.close<=entry.open*(1+rp.softFailCloseFloorPct)&&cursor<last&&cursor+1<rows.length){exitIndex=cursor+1;exitPrice=rows[cursor+1].candle.open;engineExitReason="RECOVERY_FAILED_CONTINUATION";exitReason="time";break;}if(cfg.yieldMode!=="NONE"&&cursor<last&&cursor+1<rows.length){const yLong=longSignalForMode(rows,cursor,baseLongMode),yShort=rows[cursor].shortSignal;const shouldYield=cfg.yieldMode==="ANY_BASE"?(yLong||yShort):yLong;if(shouldYield){handoffSignalIndex=cursor;exitIndex=cursor+1;exitPrice=rows[cursor+1].candle.open;engineExitReason=yShort&&!yLong?"RECOVERY_YIELD_SHORT":"RECOVERY_YIELD_LONG";exitReason="time";break;}}}'
if old not in src: raise SystemExit('V2 recovery exit loop marker missing')
src=src.replace(old,new,1)

old='for(const rule of ["R_CORE3","R_LEVEL3","R_BTC3","R_CORE2OF3"] as const)for(const priority of ["SHORT_FIRST","RECOVERY_OVER_NEW_SHORT"] as const)for(const gross of [.25,.375,.5])for(const exit of RECOVERY_EXIT_CONFIGS)for(const yieldMode of ["NONE","BASE_LONG","ANY_BASE"] as const)configs.push({rule,priority,gross,exit,yieldMode});'
new='const v4Exit=RECOVERY_EXIT_CONFIGS.find(x=>x.name==="FIXED_A6_T6_R3_H72");if(!v4Exit)throw new Error("V4 fixed exit missing");for(const riskMode of RECOVERY_V4_RISK_MODES)configs.push({rule:"R_BTC3",priority:"SHORT_FIRST",gross:.5,exit:v4Exit,yieldMode:"BASE_LONG",riskMode});'
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

src=src.replace('schema:"pengu-recovery-integrated-backtest/v1"','schema:"pengu-recovery-integrated-backtest/v4-risk-management"',1)
src=src.replace('thresholdSource:"entry thresholds fixed from Fold1 recovery-label medians only"','thresholdSource:"V2 R_BTC3 entry is frozen. V4 is a post-hoc risk-management successor family inspired by observed giveback/hard-stop behavior; only FOLD1/FOLD2 select among the predeclared risk modes."',1)
src=src.replace('recycledHoldoutNotice:"FOLD3 informed the subordinate-yield redesign; FOLD3 is diagnostic only for V2 and is NOT a fresh holdout. External forward/cross-venue validation is required before promotion."','recycledHoldoutNotice:"FOLD3 and the previously observed Aug-10-to-Aug-27 forward/cross-venue periods are contaminated diagnostics for V4 because they informed the risk redesign. They must never be called fresh holdouts. A new future freeze is required before LIVE promotion."',1)
src=src.replace('requirements:"Normal and Severe must improve Return in Fold1 and Fold2 with >=2 recovery trades, PF >=90% baseline, DD degradation <=2pp; final requires same on untouched Fold3 plus full Normal/Severe improvement, PF >=95%, full DD degradation <=1.5pp"','requirements:"V4 freezes V2 R_BTC3/SHORT_FIRST/gross0.5/FIXED_A6_T6_R3_H72/BASE_LONG and searches 13 predeclared risk-management modes only. FOLD1/FOLD2 must still beat V64 Normal+Severe Return, PF >=90% of V64 and DD degradation <=2pp. Selection is risk-first on the worst FOLD1/FOLD2 Normal/Severe DD delta, then return score. FOLD3 and prior external periods are diagnostic only."',1)
src=src.replace('decision:strictPass?"RECOVERY_SLEEVE_ROBUST_CANDIDATE":"NO_ROBUST_RECOVERY_SLEEVE_YET"','decision:strictPass?"HISTORICAL_V4_RISK_CANDIDATE_DIAGNOSTIC_ONLY":"NO_ROBUST_RECOVERY_SLEEVE_YET"',1)

TARGET.write_text(src)
print(f'PATCHED_RECOVERY_V4_RISK_MANAGEMENT={TARGET}')
