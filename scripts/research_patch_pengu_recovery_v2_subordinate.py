from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

old='type RecoveryBtConfig={rule:RecoveryRuleName;priority:RecoveryPriority;gross:number;exit:RecoveryExitConfig};'
new='type RecoveryYieldMode="NONE"|"BASE_LONG"|"ANY_BASE";\ntype RecoveryBtConfig={rule:RecoveryRuleName;priority:RecoveryPriority;gross:number;exit:RecoveryExitConfig;yieldMode:RecoveryYieldMode};'
if old not in src:raise SystemExit('RecoveryBtConfig marker missing')
src=src.replace(old,new,1)

old='const entryIndex=index+1,entry=rows[entryIndex].candle;let exitIndex=entryIndex,exitPrice=entry.open,engineExitReason="",exitReason:ExitGroup="time",bestFavorable=0,worstAdverse=0;let initialShortState:any=undefined;'
new='const entryIndex=index+1,entry=rows[entryIndex].candle;let exitIndex=entryIndex,exitPrice=entry.open,engineExitReason="",exitReason:ExitGroup="time",bestFavorable=0,worstAdverse=0;let initialShortState:any=undefined;let handoffSignalIndex:number|null=null;'
if old not in src:raise SystemExit('entry variable marker missing')
src=src.replace(old,new,1)

old='for(let cursor=entryIndex;cursor<=last;cursor++){const c=rows[cursor].candle;bestFavorable=Math.max(bestFavorable,c.high/entry.open-1);worstAdverse=Math.min(worstAdverse,c.low/entry.open-1);if(c.low<=hardStop){exitIndex=cursor;exitPrice=hardStop;engineExitReason="RECOVERY_HARD_STOP";exitReason="hard";break;}const priorHigh=highWater;if(priorHigh>=entry.open*(1+ec.trailActivationPct)){const stop=priorHigh*(1-ec.trailRetracePct);if(c.low<=stop){exitIndex=cursor;exitPrice=stop;engineExitReason="RECOVERY_TRAILING_STOP";exitReason="trail";break;}}highWater=Math.max(highWater,c.high);}'
new='for(let cursor=entryIndex;cursor<=last;cursor++){const c=rows[cursor].candle;bestFavorable=Math.max(bestFavorable,c.high/entry.open-1);worstAdverse=Math.min(worstAdverse,c.low/entry.open-1);if(c.low<=hardStop){exitIndex=cursor;exitPrice=hardStop;engineExitReason="RECOVERY_HARD_STOP";exitReason="hard";break;}const priorHigh=highWater;if(priorHigh>=entry.open*(1+ec.trailActivationPct)){const stop=priorHigh*(1-ec.trailRetracePct);if(c.low<=stop){exitIndex=cursor;exitPrice=stop;engineExitReason="RECOVERY_TRAILING_STOP";exitReason="trail";break;}}highWater=Math.max(highWater,c.high);if(cfg.yieldMode!=="NONE"&&cursor<last&&cursor+1<rows.length){const yLong=longSignalForMode(rows,cursor,baseLongMode),yShort=rows[cursor].shortSignal;const shouldYield=cfg.yieldMode==="ANY_BASE"?(yLong||yShort):yLong;if(shouldYield){handoffSignalIndex=cursor;exitIndex=cursor+1;exitPrice=rows[cursor+1].candle.open;engineExitReason=yShort&&!yLong?"RECOVERY_YIELD_SHORT":"RECOVERY_YIELD_LONG";exitReason="time";break;}}}'
if old not in src:raise SystemExit('recovery exit loop marker missing')
src=src.replace(old,new,1)

old='cooldown=exitIndex+PENGU_DUAL_LS_V2.cooldownHours;index=exitIndex+1;'
new='if(handoffSignalIndex!==null){cooldown=-1;index=handoffSignalIndex;continue;}cooldown=exitIndex+PENGU_DUAL_LS_V2.cooldownHours;index=exitIndex+1;'
if old not in src:raise SystemExit('cooldown marker missing')
src=src.replace(old,new,1)

old='for(const rule of ["R_CORE3","R_LEVEL3","R_BTC3","R_CORE2OF3"] as const)for(const priority of ["SHORT_FIRST","RECOVERY_OVER_NEW_SHORT"] as const)for(const gross of [.25,.375,.5])for(const exit of RECOVERY_EXIT_CONFIGS)configs.push({rule,priority,gross,exit});'
new='for(const rule of ["R_CORE3","R_LEVEL3","R_BTC3","R_CORE2OF3"] as const)for(const priority of ["SHORT_FIRST","RECOVERY_OVER_NEW_SHORT"] as const)for(const gross of [.25,.375,.5])for(const exit of RECOVERY_EXIT_CONFIGS)for(const yieldMode of ["NONE","BASE_LONG","ANY_BASE"] as const)configs.push({rule,priority,gross,exit,yieldMode});'
if old not in src:raise SystemExit('candidate generation marker missing')
src=src.replace(old,new,1)

old='candidateCount:configs.length,requirements:'
new='candidateCount:configs.length,recycledHoldoutNotice:"FOLD3 informed the subordinate-yield redesign; FOLD3 is diagnostic only for V2 and is NOT a fresh holdout. External forward/cross-venue validation is required before promotion.",requirements:'
if old not in src:raise SystemExit('selection protocol marker missing')
src=src.replace(old,new,1)

TARGET.write_text(src)
print(f'PATCHED_RECOVERY_V2_SUBORDINATE={TARGET}')
