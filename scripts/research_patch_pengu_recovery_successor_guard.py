from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

# This successor study is intentionally post-hoc at the feature-family level:
# ATR and BTC 24h return were nominated after weakness diagnostics. Thresholds themselves
# are derived from FOLD1 signal distributions only; FOLD2 selects; FOLD3 is diagnostic only.
old='return pass?{...c,features:x}:null;}'
new='if(!pass)return null;if(!recoverySuccessorGuardPass(x))return null;return {...c,features:x};}'
if old not in src:
    raise SystemExit('recoveryRuleAt return marker missing')
src=src.replace(old,new,1)

marker='\nfunction recoveryTradeCount(trades:RichTrade[])'
insert=r'''
type RecoverySuccessorGuard={name:string;atrFloorPct:number|null;btc24CapPct:number|null};
let recoverySuccessorActiveGuard:RecoverySuccessorGuard|null=null;
function recoverySuccessorGuardPass(x:Record<string,number>){
  const g=recoverySuccessorActiveGuard;if(!g)return true;
  if(g.atrFloorPct!==null&&x.atr24Pct<g.atrFloorPct)return false;
  if(g.btc24CapPct!==null&&x.btcReturn24hPct>g.btc24CapPct)return false;
  return true;
}
function successorFixedCfg():RecoveryBtConfig{
  const exit=RECOVERY_EXIT_CONFIGS.find(x=>x.name==="FIXED_A6_T6_R3_H72");assert(exit);
  return {rule:"R_BTC3",priority:"SHORT_FIRST",gross:.5,exit,yieldMode:"BASE_LONG"};
}
function successorRawF1Features(rows:PenguDualLsV2EvaluationRow[]){
  recoverySuccessorActiveGuard=null;const [a,b]=foldBounds().FOLD1;const out:Record<string,number>[]=[];
  for(let i=Math.max(250,RECOVERY_LOOKBACK);i<rows.length-2;i++){
    const ts=rows[i].candle.openTime;if(ts<a||ts>=b)continue;
    const rec=recoveryRuleAt(rows,i,"R_BTC3");if(rec)out.push(rec.features);
  }
  return out;
}
function successorFold(m:any,fold:"FOLD1"|"FOLD2"|"FOLD3"){return m[fold];}
function successorPfOk(c:any,b:any,ratio=.95){if(b.profitFactor===null||c.profitFactor===null)return true;return c.profitFactor+1e-12>=b.profitFactor*ratio;}
function successorDevOk(cn:any,cs:any,bn:any,bs:any){
  return cn.recoveryTrades>=2&&cs.recoveryTrades>=2
    &&cn.returnPct+0.5>=bn.returnPct&&cs.returnPct+0.5>=bs.returnPct
    &&successorPfOk(cn,bn)&&successorPfOk(cs,bs)
    &&cn.maxDrawdownPct+0.25>=bn.maxDrawdownPct&&cs.maxDrawdownPct+0.25>=bs.maxDrawdownPct;
}
function successorScore(cn:any,cs:any,bn:any,bs:any){
  const ret=(cn.returnPct-bn.returnPct)+(cs.returnPct-bs.returnPct);
  const dd=(cn.maxDrawdownPct-bn.maxDrawdownPct)+(cs.maxDrawdownPct-bs.maxDrawdownPct);
  const pf=(Number(cn.profitFactor??0)-Number(bn.profitFactor??0))+(Number(cs.profitFactor??0)-Number(bs.profitFactor??0));
  return ret+0.5*dd+0.15*pf;
}
function analyzeRecoverySuccessorGuard(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],v64:any,selectedConfig:V64Config|null){
  const useV64=Boolean(v64.strictPass&&selectedConfig);v64ActiveConfig=useV64?selectedConfig:null;
  const baseMode:LongMode=useV64?"V64_DYNAMIC":"V57_REGIME72_BREAKOUT",cfg=successorFixedCfg();
  recoverySuccessorActiveGuard=null;const unN=replayRecoveryIntegrated(rows,funding,"normal",baseMode,cfg);
  recoverySuccessorActiveGuard=null;const unS=replayRecoveryIntegrated(rows,funding,"stress",baseMode,cfg);
  const unNF=metricByFold(unN),unSF=metricByFold(unS);
  const f1=successorRawF1Features(rows),atrs=f1.map(x=>x.atr24Pct).filter(Number.isFinite),btcs=f1.map(x=>x.btcReturn24hPct).filter(Number.isFinite);
  assert(atrs.length>=4&&btcs.length>=4);
  const aq25=Number(quantileNumber(atrs,.25)),aq40=Number(quantileNumber(atrs,.40)),bq60=Number(quantileNumber(btcs,.60)),bq75=Number(quantileNumber(btcs,.75));
  const guards:RecoverySuccessorGuard[]=[
    {name:"ATR_Q25",atrFloorPct:aq25,btc24CapPct:null},{name:"ATR_Q40",atrFloorPct:aq40,btc24CapPct:null},
    {name:"BTC_Q60_CAP",atrFloorPct:null,btc24CapPct:bq60},{name:"BTC_Q75_CAP",atrFloorPct:null,btc24CapPct:bq75},
    {name:"ATR_Q25_BTC_Q60",atrFloorPct:aq25,btc24CapPct:bq60},{name:"ATR_Q25_BTC_Q75",atrFloorPct:aq25,btc24CapPct:bq75},
    {name:"ATR_Q40_BTC_Q60",atrFloorPct:aq40,btc24CapPct:bq60},{name:"ATR_Q40_BTC_Q75",atrFloorPct:aq40,btc24CapPct:bq75},
  ];
  const evaluated:any[]=[];
  for(const guard of guards){
    recoverySuccessorActiveGuard=guard;v64ActiveConfig=useV64?selectedConfig:null;const n=replayRecoveryIntegrated(rows,funding,"normal",baseMode,cfg);
    recoverySuccessorActiveGuard=guard;v64ActiveConfig=useV64?selectedConfig:null;const s=replayRecoveryIntegrated(rows,funding,"stress",baseMode,cfg);
    const nf=metricByFold(n),sf=metricByFold(s);const f1ok=successorDevOk(nf.FOLD1,sf.FOLD1,unNF.FOLD1,unSF.FOLD1);const f2ok=successorDevOk(nf.FOLD2,sf.FOLD2,unNF.FOLD2,unSF.FOLD2);
    evaluated.push({guard,f1DevelopmentPass:f1ok,f2SelectionPass:f2ok,f2Score:successorScore(nf.FOLD2,sf.FOLD2,unNF.FOLD2,unSF.FOLD2),normal:metrics(n),stress:metrics(s),normalFolds:nf,stressFolds:sf,recoveryTradesNormal:recoveryTradeCount(n),recoveryTradesStress:recoveryTradeCount(s)});
  }
  recoverySuccessorActiveGuard=null;
  const survivors=evaluated.filter(x=>x.f1DevelopmentPass&&x.f2SelectionPass).sort((a,b)=>b.f2Score-a.f2Score);const selected=survivors[0]??null;
  const f3Diagnostic=selected?{
    normalDeltaReturnPct:selected.normalFolds.FOLD3.returnPct-unNF.FOLD3.returnPct,
    stressDeltaReturnPct:selected.stressFolds.FOLD3.returnPct-unSF.FOLD3.returnPct,
    normalDeltaDdPct:selected.normalFolds.FOLD3.maxDrawdownPct-unNF.FOLD3.maxDrawdownPct,
    stressDeltaDdPct:selected.stressFolds.FOLD3.maxDrawdownPct-unSF.FOLD3.maxDrawdownPct,
    normalPass:successorDevOk(selected.normalFolds.FOLD3,selected.stressFolds.FOLD3,unNF.FOLD3,unSF.FOLD3)
  }:null;
  return {schema:"pengu-recovery-successor-guard/v1",methodology:{status:"POST_HOC_FEATURE_FAMILY_DEVELOPMENT",featureFamily:"ATR24 floor and BTC 24h return cap were nominated after prior risk/fresh-forward diagnostics; this is NOT a fresh OOS claim",thresholdDerivation:"FOLD1 accepted R_BTC3 signal distribution only; no FOLD2/FOLD3/fresh/cross-venue values used to derive numeric thresholds",development:"FOLD1",selection:"FOLD2",diagnosticOnly:"FOLD3 is recycled diagnostic only; fresh-forward already observed and cannot become fresh again",candidateCount:guards.length},derivedThresholds:{atrQ25Pct:aq25,atrQ40Pct:aq40,btc24Q60Pct:bq60,btc24Q75Pct:bq75,f1SignalCount:f1.length},fixedRecovery:cfg,unguarded:{normal:metrics(unN),stress:metrics(unS),normalFolds:unNF,stressFolds:unSF},survivorCount:survivors.length,selected,f3Diagnostic,top:evaluated.sort((a,b)=>b.f2Score-a.f2Score),decision:selected?"SUCCESSOR_GUARD_SELECTED_FOR_EXTERNAL_DIAGNOSTIC":"NO_GUARD_SURVIVED_F1_F2",safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
}
'''
if marker not in src:
    raise SystemExit('recoveryTradeCount marker missing')
src=src.replace(marker,insert+marker,1)

old='  analysis.recoveryBacktest=analyzeRecoveryBacktest(rows,funding,v64,selectedConfig);'
new='  analysis.recoveryBacktest=analyzeRecoveryBacktest(rows,funding,v64,selectedConfig);\n  analysis.recoverySuccessorGuard=analyzeRecoverySuccessorGuard(rows,funding,v64,selectedConfig);'
if old not in src:
    raise SystemExit('recoveryBacktest assignment marker missing')
src=src.replace(old,new,1)

TARGET.write_text(src)
print(f'PATCHED_RECOVERY_SUCCESSOR_GUARD={TARGET}')
