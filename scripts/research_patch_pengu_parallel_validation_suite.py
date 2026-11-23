from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

# Freeze the selected Recovery V2 configuration from run #33064029841.
marker = '\nfunction main()'
if marker not in src:
    raise SystemExit('main marker missing')

insert = r'''
const RECOVERY_V2_FROZEN = {
  rule: "R_BTC3" as const,
  priority: "SHORT_FIRST" as const,
  gross: 0.5,
  exit: {
    name: "FIXED_A6_T6_R3_H72",
    hardStopPct: 0.06,
    trailActivationPct: 0.06,
    trailRetracePct: 0.03,
    maxHoldHours: 72,
    structuralBufferPct: null,
  },
  yieldMode: "BASE_LONG" as const,
};

function fixedRecoveryConfig() {
  return RECOVERY_V2_FROZEN as RecoveryBtConfig;
}

function validationWindow() {
  const mode = process.env.PENGU_VALIDATION_MODE || "RISK";
  return mode;
}

function compactTrade(t:RichTrade) {
  return {
    side:t.side,
    signalTs:new Date(t.signalTs).toISOString(),
    entryTs:new Date(t.entryTs).toISOString(),
    exitTs:new Date(t.exitTs).toISOString(),
    requestedGross:t.requestedGross,
    accountReturnPct:t.accountReturn*100,
    rawUnitReturnPct:t.rawUnitReturn*100,
    fundingUnitReturnPct:t.fundingUnitReturn*100,
    costUnitReturnPct:t.costUnitReturn*100,
    exitReason:t.engineExitReason,
    mfePct:t.mfeUnit*100,
    maePct:t.maeUnit*100,
    entryFeatures:{
      atr24Ratio:t.entryFeatures.atr24Ratio,
      btcEma168Distance:t.entryFeatures.btcEma168Distance,
      btcReturn24h:t.entryFeatures.btcReturn24h,
      penguReturn24h:t.entryFeatures.penguReturn24h,
      penguReturn72h:t.entryFeatures.penguReturn72h,
      relativeReturn24h:t.entryFeatures.relativeReturn24h,
      rsi14:t.entryFeatures.rsi14,
      volumeRatio6OverPrior36:t.entryFeatures.volumeRatio6OverPrior36,
    },
  };
}

function sliceTrades(trades:RichTrade[], start:number, end:number) {
  return trades.filter(t=>t.entryTs>=start && t.entryTs<end);
}

function riskBreakdown(trades:RichTrade[]) {
  const recovery=trades.filter((t:any)=>String(t.engineExitReason||'').startsWith('RECOVERY_'));
  const sorted=[...recovery].sort((a,b)=>a.accountReturn-b.accountReturn);
  const hard=sorted.filter(t=>t.engineExitReason==='RECOVERY_HARD_STOP');
  const losses=sorted.filter(t=>t.accountReturn<0);
  let maxConsecutiveLosses=0,cur=0;
  for(const t of recovery){if(t.accountReturn<0){cur++;maxConsecutiveLosses=Math.max(maxConsecutiveLosses,cur);}else cur=0;}
  const buckets=(key:string, fn:(t:RichTrade)=>string)=>Object.fromEntries([...new Set(recovery.map(fn))].sort().map(k=>[k,metrics(recovery.filter(t=>fn(t)===k))]));
  return {
    recoveryTrades:recovery.length,
    recoveryMetrics:metrics(recovery),
    hardStopCount:hard.length,
    lossCount:losses.length,
    maxConsecutiveLosses,
    worst5:sorted.slice(0,5).map(compactTrade),
    atrBuckets:buckets('atr',t=>t.entryFeatures.atr24Ratio<0.006?'LOW':t.entryFeatures.atr24Ratio<0.012?'MID':'HIGH'),
    btcRegimeBuckets:buckets('btc',t=>t.entryFeatures.btcReturn24h<-0.015?'BTC_DOWN':t.entryFeatures.btcReturn24h>0.015?'BTC_UP':'BTC_FLAT'),
    rsiBuckets:buckets('rsi',t=>t.entryFeatures.rsi14<55?'RSI_LOW':t.entryFeatures.rsi14<70?'RSI_MID':'RSI_HIGH'),
  };
}

function purgedFolds(start:number,end:number,n:number,purgeHours:number){
  const width=(end-start)/n, purge=purgeHours*HOUR;
  return Array.from({length:n},(_,i)=>{
    const rawStart=start+i*width, rawEnd=i===n-1?end:start+(i+1)*width;
    const s=rawStart+(i>0?purge:0), e=rawEnd-(i<n-1?purge:0);
    return {name:`P${n}_${i+1}`,start:Math.floor(s/HOUR)*HOUR,end:Math.floor(e/HOUR)*HOUR};
  });
}

function compareFolds(baseN:RichTrade[],candN:RichTrade[],baseS:RichTrade[],candS:RichTrade[],n:number){
  return purgedFolds(EVAL_START,EVAL_END,n,72).map(f=>{
    const bn=metrics(sliceTrades(baseN,f.start,f.end)),cn=metrics(sliceTrades(candN,f.start,f.end));
    const bs=metrics(sliceTrades(baseS,f.start,f.end)),cs=metrics(sliceTrades(candS,f.start,f.end));
    return {name:f.name,start:new Date(f.start).toISOString(),end:new Date(f.end).toISOString(),baselineNormal:bn,candidateNormal:cn,baselineStress:bs,candidateStress:cs,deltas:{normalReturnPct:cn.returnPct-bn.returnPct,stressReturnPct:cs.returnPct-bs.returnPct,normalDdPct:cn.maxDrawdownPct-bn.maxDrawdownPct,stressDdPct:cs.maxDrawdownPct-bs.maxDrawdownPct}};
  });
}
'''
src = src.replace(marker, insert + marker, 1)

# Inject validation payload after the existing recoveryBacktest is computed and before output is written.
needle = '  const resultPayload='
if needle not in src:
    raise SystemExit('result payload marker missing')

patch = r'''  const validationMode=validationWindow();
  const fixedCfg=fixedRecoveryConfig();
  const baseNormal=replayRecoveryIntegrated(rows,funding,{mode:"normal",cfg:null}).trades;
  const baseStress=replayRecoveryIntegrated(rows,funding,{mode:"stress",cfg:null}).trades;
  const fixedNormal=replayRecoveryIntegrated(rows,funding,{mode:"normal",cfg:fixedCfg}).trades;
  const fixedStress=replayRecoveryIntegrated(rows,funding,{mode:"stress",cfg:fixedCfg}).trades;
  const validationPayload:any={
    schema:"pengu-recovery-v2-parallel-validation/v1",
    validationMode,
    frozenConfig:fixedCfg,
    baseline:{normal:metrics(baseNormal),stress:metrics(baseStress)},
    candidate:{normal:metrics(fixedNormal),stress:metrics(fixedStress)},
    safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };
  if(validationMode==="PURGED"){
    validationPayload.folds4=compareFolds(baseNormal,fixedNormal,baseStress,fixedStress,4);
    validationPayload.folds6=compareFolds(baseNormal,fixedNormal,baseStress,fixedStress,6);
  } else if(validationMode==="RISK"){
    validationPayload.normal=riskBreakdown(fixedNormal);
    validationPayload.stress=riskBreakdown(fixedStress);
  } else if(validationMode==="FORWARD"){
    const fs=Date.parse(process.env.PENGU_FORWARD_START||"2026-08-10T00:00:00Z");
    const fe=Date.parse(process.env.PENGU_FORWARD_END||"2026-08-28T00:00:00Z");
    validationPayload.forward={start:new Date(fs).toISOString(),end:new Date(fe).toISOString(),baselineNormal:metrics(sliceTrades(baseNormal,fs,fe)),candidateNormal:metrics(sliceTrades(fixedNormal,fs,fe)),baselineStress:metrics(sliceTrades(baseStress,fs,fe)),candidateStress:metrics(sliceTrades(fixedStress,fs,fe))};
  }
  await fs.writeFile(path.join(OUTPUT_DIR,"parallel-validation.json"),JSON.stringify(validationPayload,null,2));
'''
src = src.replace(needle, patch + needle, 1)

TARGET.write_text(src)
print(f'PATCHED_PARALLEL_VALIDATION={TARGET}')
