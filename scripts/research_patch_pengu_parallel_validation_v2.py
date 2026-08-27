from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

marker='\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
if marker not in src:
    raise SystemExit('longDiagnostics marker missing')

insert=r'''
const RECOVERY_V2_FROZEN:RecoveryBtConfig={
  rule:"R_BTC3",
  priority:"SHORT_FIRST",
  gross:.5,
  exit:{name:"FIXED_A6_T6_R3_H72",hardStopPct:.06,trailActivationPct:.06,trailRetracePct:.03,maxHoldHours:72,structuralBufferPct:null},
  yieldMode:"BASE_LONG",
};
function pvSlice(trades:RichTrade[],a:number,b:number){return trades.filter(t=>t.entryTs>=a&&t.entryTs<b);}
function pvFolds(a:number,b:number,n:number,purgeHours:number){const w=(b-a)/n,p=purgeHours*HOUR;return Array.from({length:n},(_,i)=>{const ra=a+i*w,rb=i===n-1?b:a+(i+1)*w;return{name:`P${n}_${i+1}`,start:Math.floor((ra+(i? p:0))/HOUR)*HOUR,end:Math.floor((rb-(i<n-1?p:0))/HOUR)*HOUR};});}
function pvCompare(baseN:RichTrade[],candN:RichTrade[],baseS:RichTrade[],candS:RichTrade[],n:number){return pvFolds(EVAL_START,EVAL_END,n,72).map(f=>{const bn=metrics(pvSlice(baseN,f.start,f.end)),cn=metrics(pvSlice(candN,f.start,f.end)),bs=metrics(pvSlice(baseS,f.start,f.end)),cs=metrics(pvSlice(candS,f.start,f.end));return{name:f.name,start:new Date(f.start).toISOString(),end:new Date(f.end).toISOString(),baselineNormal:bn,candidateNormal:cn,baselineStress:bs,candidateStress:cs,deltas:{normalReturnPct:cn.returnPct-bn.returnPct,stressReturnPct:cs.returnPct-bs.returnPct,normalDdPct:cn.maxDrawdownPct-bn.maxDrawdownPct,stressDdPct:cs.maxDrawdownPct-bs.maxDrawdownPct}};});}
function pvCompact(t:RichTrade){return{side:t.side,entryTs:new Date(t.entryTs).toISOString(),exitTs:new Date(t.exitTs).toISOString(),accountReturnPct:t.accountReturn*100,exitReason:t.engineExitReason,mfePct:t.mfeUnit*100,maePct:t.maeUnit*100,atr24Ratio:t.entryFeatures.atr24Ratio,btcReturn24h:t.entryFeatures.btcReturn24h,rsi14:t.entryFeatures.rsi14,relativeReturn24h:t.entryFeatures.relativeReturn24h};}
function pvRisk(trades:RichTrade[]){const r=trades.filter(t=>t.engineExitReason.startsWith("RECOVERY_")),losses=r.filter(t=>t.accountReturn<0),hard=r.filter(t=>t.engineExitReason==="RECOVERY_HARD_STOP");let streak=0,maxStreak=0;for(const t of r){if(t.accountReturn<0){streak++;maxStreak=Math.max(maxStreak,streak);}else streak=0;}const bucket=(fn:(t:RichTrade)=>string)=>Object.fromEntries([...new Set(r.map(fn))].sort().map(k=>[k,metrics(r.filter(t=>fn(t)===k))]));return{recoveryTrades:r.length,recoveryMetrics:metrics(r),lossCount:losses.length,hardStopCount:hard.length,maxConsecutiveLosses:maxStreak,worst5:[...r].sort((a,b)=>a.accountReturn-b.accountReturn).slice(0,5).map(pvCompact),atrBuckets:bucket(t=>t.entryFeatures.atr24Ratio<.006?"LOW":t.entryFeatures.atr24Ratio<.012?"MID":"HIGH"),btcBuckets:bucket(t=>t.entryFeatures.btcReturn24h<-.015?"DOWN":t.entryFeatures.btcReturn24h>.015?"UP":"FLAT"),rsiBuckets:bucket(t=>t.entryFeatures.rsi14<55?"LOW":t.entryFeatures.rsi14<70?"MID":"HIGH")};}
function buildParallelValidation(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],v64:any,selectedConfig:V64Config|null){const useV64=Boolean(v64.strictPass&&selectedConfig);v64ActiveConfig=useV64?selectedConfig:null;const baseMode:LongMode=useV64?"V64_DYNAMIC":"V57_REGIME72_BREAKOUT";const bn=replay(rows,funding,{mode:"normal",longMode:baseMode}).trades;v64ActiveConfig=useV64?selectedConfig:null;const bs=replay(rows,funding,{mode:"stress",longMode:baseMode}).trades;v64ActiveConfig=useV64?selectedConfig:null;const cn=replayRecoveryIntegrated(rows,funding,"normal",baseMode,RECOVERY_V2_FROZEN);v64ActiveConfig=useV64?selectedConfig:null;const cs=replayRecoveryIntegrated(rows,funding,"stress",baseMode,RECOVERY_V2_FROZEN);const mode=process.env.PENGU_VALIDATION_MODE||"PURGED";const out:any={schema:"pengu-recovery-v2-parallel-validation/v2",mode,frozenRecovery:RECOVERY_V2_FROZEN,baseMode,v64SelectedConfig:selectedConfig,baseline:{normal:metrics(bn),stress:metrics(bs)},candidate:{normal:metrics(cn),stress:metrics(cs)},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};if(mode==="PURGED"){out.folds4=pvCompare(bn,cn,bs,cs,4);out.folds6=pvCompare(bn,cn,bs,cs,6);}if(mode==="RISK"){out.normal=pvRisk(cn);out.stress=pvRisk(cs);}return out;}
'''
src=src.replace(marker,insert+marker,1)

old='  analysis.recoveryBacktest=analyzeRecoveryBacktest(rows,funding,v64,selectedConfig);'
new='  analysis.recoveryBacktest=analyzeRecoveryBacktest(rows,funding,v64,selectedConfig);\n  analysis.parallelValidation=buildParallelValidation(rows,funding,v64,selectedConfig);'
if old not in src:
    raise SystemExit('recoveryBacktest assignment missing')
src=src.replace(old,new,1)
TARGET.write_text(src)
print(f'PATCHED_PARALLEL_VALIDATION_V2={TARGET}')
