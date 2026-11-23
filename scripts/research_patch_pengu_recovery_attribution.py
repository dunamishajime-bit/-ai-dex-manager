from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()
marker='\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert=r'''
function sumAccountReturnPct(ts:RichTrade[]){return ts.reduce((s,t)=>s+t.accountReturn,0)*100;}
function compactAttributionTrade(t:RichTrade){return{side:t.side,signalTs:new Date(t.signalTs).toISOString(),entryTs:new Date(t.entryTs).toISOString(),exitTs:new Date(t.exitTs).toISOString(),requestedGross:t.requestedGross,accountReturnPct:t.accountReturn*100,rawUnitReturnPct:t.rawUnitReturn*100,fundingUnitReturnPct:t.fundingUnitReturn*100,costUnitReturnPct:t.costUnitReturn*100,exitReason:t.engineExitReason,mfePct:t.mfeUnit*100,maePct:t.maeUnit*100,entryFeatures:{btcReturn24h:t.entryFeatures.btcReturn24h,penguReturn24h:t.entryFeatures.penguReturn24h,penguReturn72h:t.entryFeatures.penguReturn72h,relativeReturn24h:t.entryFeatures.relativeReturn24h,atr24Ratio:t.entryFeatures.atr24Ratio,rsi14:t.entryFeatures.rsi14,btcEma168Distance:t.entryFeatures.btcEma168Distance}};}
function attributionKey(t:RichTrade){return `${t.side}:${t.signalTs}`;}
function analyzeRecoveryAttribution(rows:PenguDualLsV2EvaluationRow[],funding:FundingPoint[],bt:any,v64:any,selectedConfig:V64Config|null){
  if(!bt.selected)return{schema:"pengu-recovery-attribution/v1",available:false,reason:"no Fold1/Fold2 selected candidate"};
  const useV64=Boolean(v64.strictPass&&selectedConfig);v64ActiveConfig=useV64?selectedConfig:null;const baseMode:LongMode=useV64?"V64_DYNAMIC":"V57_REGIME72_BREAKOUT";
  const cfg=bt.selected.cfg as RecoveryBtConfig;const base=replay(rows,funding,{mode:"normal",longMode:baseMode}).trades;v64ActiveConfig=useV64?selectedConfig:null;const cand=replayRecoveryIntegrated(rows,funding,"normal",baseMode,cfg);
  const out:any={};
  for(const [fold,[a,b]] of Object.entries(foldBounds()) as any){const bb=sliceByTime(base,a,b),cc=sliceByTime(cand,a,b),bk=new Set(bb.map(attributionKey)),ck=new Set(cc.map(attributionKey));const rec=cc.filter(t=>t.engineExitReason.startsWith("RECOVERY_"));const displaced=bb.filter(t=>!ck.has(attributionKey(t)));const addedNonRecovery=cc.filter(t=>!t.engineExitReason.startsWith("RECOVERY_")&&!bk.has(attributionKey(t)));const retained=bb.filter(t=>ck.has(attributionKey(t)));out[fold]={baseline:metrics(bb),candidate:metrics(cc),recovery:{count:rec.length,metrics:metrics(rec),sumAccountReturnPct:sumAccountReturnPct(rec),trades:rec.map(compactAttributionTrade)},displacedBaseline:{count:displaced.length,metrics:metrics(displaced),sumAccountReturnPct:sumAccountReturnPct(displaced),trades:displaced.map(compactAttributionTrade)},addedNonRecovery:{count:addedNonRecovery.length,metrics:metrics(addedNonRecovery),sumAccountReturnPct:sumAccountReturnPct(addedNonRecovery),trades:addedNonRecovery.map(compactAttributionTrade)},retainedBaseline:{count:retained.length,sumAccountReturnPct:sumAccountReturnPct(retained)}};}
  return{schema:"pengu-recovery-attribution/v1",available:true,selectedConfig:cfg,folds:out,note:"Component simple sums are diagnostic only; portfolio Return is path-compounded and not additive.",safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
}
'''
if marker not in src:raise SystemExit('longDiagnostics marker missing for attribution')
src=src.replace(marker,insert+marker,1)
old='  analysis.recoveryBacktest=analyzeRecoveryBacktest(rows,funding,v64,selectedConfig);'
new='  analysis.recoveryBacktest=analyzeRecoveryBacktest(rows,funding,v64,selectedConfig);\n  analysis.recoveryAttribution=analyzeRecoveryAttribution(rows,funding,analysis.recoveryBacktest,v64,selectedConfig);'
if old not in src:raise SystemExit('recoveryBacktest assignment missing for attribution')
src=src.replace(old,new,1)
TARGET.write_text(src)
print(f'PATCHED_RECOVERY_ATTRIBUTION={TARGET}')
