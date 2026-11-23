from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

old='type RecoveryYieldMode="NONE"|"BASE_LONG"|"ANY_BASE";\ntype RecoveryBtConfig={rule:RecoveryRuleName;priority:RecoveryPriority;gross:number;exit:RecoveryExitConfig;yieldMode:RecoveryYieldMode};'
new='type RecoveryYieldMode="NONE"|"BASE_LONG"|"ANY_BASE";\ntype RecoveryContinuationMode="NONE"|"GATE5"|"GATE6"|"GATE7"|"TIER5_25"|"TIER5_375"|"TIER6_25"|"TIER6_375"|"TIER7_25"|"TIER7_375"|"SCALE_5_6"|"SCALE_6_7";\ntype RecoveryBtConfig={rule:RecoveryRuleName;priority:RecoveryPriority;gross:number;exit:RecoveryExitConfig;yieldMode:RecoveryYieldMode;continuationMode:RecoveryContinuationMode};'
if old not in src: raise SystemExit('V2 RecoveryBtConfig marker missing')
src=src.replace(old,new,1)

marker='function recoveryTradeCount(trades:RichTrade[]){return trades.filter(t=>t.engineExitReason.startsWith("RECOVERY_")).length;}'
insert=r'''
function recoveryContinuationScore(x:any){
 let score=0;
 if(x.ema72Recovery3hPct>0)score++;
 if(x.ema168Recovery3hPct>0)score++;
 if(x.relative6hPct>0)score++;
 if(x.relativeAcceleration6v24Pct>0)score++;
 if(x.momentumAcceleration6v24Pct>0)score++;
 if(x.greenBars3>=2)score++;
 if(x.bodyReturn3Pct>0)score++;
 // +3% recovery inside the 48h trough-age window has a mechanical minimum velocity of 0.0625%/h.
 // Require at least 2x that minimum for the velocity point; this is predeclared and not fit to Fold3/forward/venue outcomes.
 if(x.recoveryVelocityPctPerHour>=0.125)score++;
 return score;
}
function continuationGate(mode:RecoveryContinuationMode){
 if(mode==="GATE5")return 5;if(mode==="GATE6")return 6;if(mode==="GATE7")return 7;
 return null;
}
function recoveryContinuationAllowed(x:any,mode:RecoveryContinuationMode){const g=continuationGate(mode);return g===null||recoveryContinuationScore(x)>=g;}
function recoveryContinuationGross(x:any,mode:RecoveryContinuationMode,baseGross:number){
 const s=recoveryContinuationScore(x);
 if(mode==="TIER5_25")return s>=5?baseGross:.25;
 if(mode==="TIER5_375")return s>=5?baseGross:.375;
 if(mode==="TIER6_25")return s>=6?baseGross:.25;
 if(mode==="TIER6_375")return s>=6?baseGross:.375;
 if(mode==="TIER7_25")return s>=7?baseGross:.25;
 if(mode==="TIER7_375")return s>=7?baseGross:.375;
 if(mode==="SCALE_5_6")return s>=6?baseGross:s>=5?.375:.25;
 if(mode==="SCALE_6_7")return s>=7?baseGross:s>=6?.375:.25;
 return baseGross;
}
const RECOVERY_V3_CONTINUATION_MODES:RecoveryContinuationMode[]=["NONE","GATE5","GATE6","GATE7","TIER5_25","TIER5_375","TIER6_25","TIER6_375","TIER7_25","TIER7_375","SCALE_5_6","SCALE_6_7"];
'''
if marker not in src: raise SystemExit('recoveryTradeCount marker missing')
src=src.replace(marker,insert+marker,1)

old='const baseLong=longSignalForMode(rows,index,baseLongMode);const rec=!baseLong?recoveryRuleAt(rows,index,cfg.rule):null;const short=rows[index].shortSignal;'
new='const baseLong=longSignalForMode(rows,index,baseLongMode);const recRaw=!baseLong?recoveryRuleAt(rows,index,cfg.rule):null;const rec=recRaw&&recoveryContinuationAllowed(recRaw.features,cfg.continuationMode)?recRaw:null;const short=rows[index].shortSignal;'
if old not in src: raise SystemExit('recovery entry marker missing')
src=src.replace(old,new,1)

old='let requestedGross=kind==="REC_L"?cfg.gross:targetGrossForAtr(f.atr24Ratio,side==="L"?1:-1);'
new='let requestedGross=kind==="REC_L"?recoveryContinuationGross(rec!.features,cfg.continuationMode,cfg.gross):targetGrossForAtr(f.atr24Ratio,side==="L"?1:-1);'
if old not in src: raise SystemExit('recovery gross marker missing')
src=src.replace(old,new,1)

old='for(const rule of ["R_CORE3","R_LEVEL3","R_BTC3","R_CORE2OF3"] as const)for(const priority of ["SHORT_FIRST","RECOVERY_OVER_NEW_SHORT"] as const)for(const gross of [.25,.375,.5])for(const exit of RECOVERY_EXIT_CONFIGS)for(const yieldMode of ["NONE","BASE_LONG","ANY_BASE"] as const)configs.push({rule,priority,gross,exit,yieldMode});'
new='const v3Exit=RECOVERY_EXIT_CONFIGS.find(x=>x.name==="FIXED_A6_T6_R3_H72");if(!v3Exit)throw new Error("V3 fixed exit missing");for(const continuationMode of RECOVERY_V3_CONTINUATION_MODES)configs.push({rule:"R_BTC3",priority:"SHORT_FIRST",gross:.5,exit:v3Exit,yieldMode:"BASE_LONG",continuationMode});'
if old not in src: raise SystemExit('V2 candidate generation marker missing')
src=src.replace(old,new,1)

old='const score=(nf.FOLD1.returnPct-base.normalFolds.FOLD1.returnPct)+(sf.FOLD1.returnPct-base.stressFolds.FOLD1.returnPct)*.5+(nf.FOLD2.returnPct-base.normalFolds.FOLD2.returnPct)*1.5+(sf.FOLD2.returnPct-base.stressFolds.FOLD2.returnPct);evaluated.push({cfg,developmentFold1Pass:f1,validationFold2Pass:f2,untouchedFold3Pass:f3,score,metrics:m,deltas:'
new='const score=(nf.FOLD1.returnPct-base.normalFolds.FOLD1.returnPct)+(sf.FOLD1.returnPct-base.stressFolds.FOLD1.returnPct)*.5+(nf.FOLD2.returnPct-base.normalFolds.FOLD2.returnPct)*1.5+(sf.FOLD2.returnPct-base.stressFolds.FOLD2.returnPct);const riskScore=Math.min(sf.FOLD1.maxDrawdownPct-base.stressFolds.FOLD1.maxDrawdownPct,sf.FOLD2.maxDrawdownPct-base.stressFolds.FOLD2.maxDrawdownPct);evaluated.push({cfg,developmentFold1Pass:f1,validationFold2Pass:f2,untouchedFold3Pass:f3,score,riskScore,metrics:m,deltas:'
if old not in src: raise SystemExit('V2 score marker missing')
src=src.replace(old,new,1)

old='const survivors=evaluated.filter(x=>x.developmentFold1Pass&&x.validationFold2Pass).sort((a,b)=>b.score-a.score);'
new='const survivors=evaluated.filter(x=>x.developmentFold1Pass&&x.validationFold2Pass).sort((a,b)=>b.riskScore-a.riskScore||b.score-a.score);'
if old not in src: raise SystemExit('V2 survivor sort marker missing')
src=src.replace(old,new,1)

src=src.replace('schema:"pengu-recovery-integrated-backtest/v1"','schema:"pengu-recovery-integrated-backtest/v3-continuation"',1)
src=src.replace('thresholdSource:"entry thresholds fixed from Fold1 recovery-label medians only"','thresholdSource:"V2 R_BTC3 entry thresholds remain frozen; V3 continuation score uses predeclared causal sign/structure checks only; no Fold3, forward, or venue outcome is used for thresholds"',1)
src=src.replace('recycledHoldoutNotice:"FOLD3 informed the subordinate-yield redesign; FOLD3 is diagnostic only for V2 and is NOT a fresh holdout. External forward/cross-venue validation is required before promotion."','recycledHoldoutNotice:"FOLD3 informed V2 and remains diagnostic only. V3 candidates are selected on FOLD1/FOLD2 only; FOLD3, fresh forward, and cross-venue results must not be used to retune this V3 grid."',1)
src=src.replace('requirements:"Normal and Severe must improve Return in Fold1 and Fold2 with >=2 recovery trades, PF >=90% baseline, DD degradation <=2pp; final requires same on untouched Fold3 plus full Normal/Severe improvement, PF >=95%, full DD degradation <=1.5pp"','requirements:"V3 freezes V2 R_BTC3/SHORT_FIRST/0.5/FIXED_A6_T6_R3_H72/BASE_LONG and searches only 12 predeclared continuation-risk modes. FOLD1/FOLD2 must improve Normal+Severe Return with >=2 recovery trades, PF >=90% baseline, DD degradation <=2pp. Selection is risk-first on worst FOLD1/FOLD2 Severe DD delta, then return score. FOLD3 is diagnostic only; external validation is mandatory."',1)
src=src.replace('decision:strictPass?"RECOVERY_SLEEVE_ROBUST_CANDIDATE":"NO_ROBUST_RECOVERY_SLEEVE_YET"','decision:strictPass?"HISTORICAL_V3_CANDIDATE_ONLY_EXTERNAL_VALIDATION_REQUIRED":"NO_ROBUST_RECOVERY_SLEEVE_YET"',1)

TARGET.write_text(src)
print(f'PATCHED_RECOVERY_V3_CONTINUATION={TARGET}')
