from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()
marker='\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert=r'''
type DirectionalWave={thresholdPct:number;troughIndex:number;troughTs:number;troughClose:number;peakIndex:number;peakTs:number;peakClose:number;movePct:number;durationHours:number;longOverlap:boolean;longEntryInWave:boolean;shortOverlap:boolean;segment:"FOLD1"|"FOLD2"|"FOLD3";confirmations:Record<string,any>};
function waveSegment(ts:number){const span=EVAL_END-EVAL_START,a=EVAL_START+Math.floor(span/3),b=EVAL_START+Math.floor(span*2/3);return ts<a?"FOLD1":ts<b?"FOLD2":"FOLD3";}
function overlapTrade(t:RichTrade,a:number,b:number){return t.entryTs<=b&&t.exitTs>=a;}
function waveConfirmation(rows:PenguDualLsV2EvaluationRow[],troughIndex:number,peakIndex:number,troughClose:number,triggerPct:number){
  let ci=-1;for(let i=troughIndex+1;i<=peakIndex;i++){if(rows[i].candle.close>=troughClose*(1+triggerPct/100)){ci=i;break;}}
  if(ci<0||ci+1>peakIndex||!rows[ci].features)return null;
  const entry=rows[ci+1].candle.open,peak=rows[peakIndex].candle.close,f=rows[ci].features!,passes=longGatePasses(f),failed=longGateOrder.filter(g=>!passes[g]);
  const raw=peak/entry-1,normalCost=2*BASE_FEE_PER_SIDE,severeCost=2*(BASE_FEE_PER_SIDE+STRESS_ADVERSE_SLIPPAGE_PER_SIDE);
  let minLow=entry;for(let j=ci+1;j<=peakIndex;j++)minLow=Math.min(minLow,rows[j].candle.low);
  return {triggerPct,signalTs:rows[ci].candle.openTime,entryTs:rows[ci+1].candle.openTime,entryPrice:entry,remainingToPeakPct:raw*100,maeToPeakPct:(minLow/entry-1)*100,gross025NormalPct:.25*(raw-normalCost)*100,gross025SeverePct:.25*(raw-severeCost)*100,failedLongGates:failed,features:{atr24Ratio:f.atr24Ratio,btcReturn24h:f.btcReturn24h,penguReturn24h:f.penguReturn24h,penguReturn72h:f.penguReturn72h,relativeReturn24h:f.relativeReturn24h,volumeRatio6OverPrior36:f.volumeRatio6OverPrior36,rsi14:f.rsi14,btcEma168Distance:f.btcEma168Distance}};
}
function directionalUpWaves(rows:PenguDualLsV2EvaluationRow[],thresholdPct:number,trades:RichTrade[]){
  const delta=thresholdPct/100;let start=rows.findIndex(r=>r.candle.openTime>=EVAL_START);if(start<0)return[] as DirectionalWave[];
  let lowIndex=start,low=rows[start].candle.close,i=start+1;const out:DirectionalWave[]=[];
  while(i<rows.length&&rows[i].candle.openTime<EVAL_END){
    const close=rows[i].candle.close;
    if(close<low){low=close;lowIndex=i;i++;continue;}
    if(close/low-1<delta){i++;continue;}
    let peakIndex=i,peak=close,j=i+1;
    while(j<rows.length&&rows[j].candle.openTime<EVAL_END){const c=rows[j].candle.close;if(c>peak){peak=c;peakIndex=j;}if(c/peak-1<=-delta)break;j++;}
    const a=rows[lowIndex].candle.openTime,b=rows[peakIndex].candle.openTime;
    const longOverlap=trades.some(t=>t.side==="L"&&overlapTrade(t,a,b)),longEntryInWave=trades.some(t=>t.side==="L"&&t.entryTs>=a&&t.entryTs<=b),shortOverlap=trades.some(t=>t.side==="S"&&overlapTrade(t,a,b));
    out.push({thresholdPct,troughIndex:lowIndex,troughTs:a,troughClose:low,peakIndex,peakTs:b,peakClose:peak,movePct:(peak/low-1)*100,durationHours:(b-a)/HOUR,longOverlap,longEntryInWave,shortOverlap,segment:waveSegment(a),confirmations:{"2":waveConfirmation(rows,lowIndex,peakIndex,low,2),"3":waveConfirmation(rows,lowIndex,peakIndex,low,3),"5":waveConfirmation(rows,lowIndex,peakIndex,low,5)}});
    if(j>=rows.length||rows[j].candle.openTime>=EVAL_END)break;
    lowIndex=j;low=rows[j].candle.close;i=j+1;
  }
  return out;
}
function sumCapacity(waves:DirectionalWave[],mode:"normal"|"severe",confirmation:string|null){const cost=mode==="normal"?2*BASE_FEE_PER_SIDE:2*(BASE_FEE_PER_SIDE+STRESS_ADVERSE_SLIPPAGE_PER_SIDE);let sum=0,log=0,n=0;for(const w of waves){let r:number;if(confirmation){const c=w.confirmations[confirmation];if(!c)continue;r=c.remainingToPeakPct/100;}else r=w.movePct/100;const net=r-cost;if(net<=0)continue;const ar=.25*net;sum+=ar;n++;log+=Math.log1p(ar);}return{trades:n,sumGross025ReturnPct:sum*100,compoundedGross025ReturnPct:(Math.exp(log)-1)*100};}
function numericDist(v:number[]){const a=v.filter(Number.isFinite);return{count:a.length,p50:quantileNumber(a,.5),p75:quantileNumber(a,.75),p90:quantileNumber(a,.9),min:a.length?Math.min(...a):null,max:a.length?Math.max(...a):null,sum:a.reduce((s,x)=>s+x,0)};}
function confirmationGateFailures(waves:DirectionalWave[],trigger:string){const out:Record<string,number>={};for(const w of waves){const c=w.confirmations[trigger];if(!c)continue;for(const g of c.failedLongGates)out[g]=(out[g]??0)+1;}return Object.fromEntries(Object.entries(out).sort((a,b)=>b[1]-a[1]));}
function analyzeDirectionalWaves(rows:PenguDualLsV2EvaluationRow[],trades:RichTrade[]){const result:Record<string,any>={};for(const t of [5,8,10,15,20]){const waves=directionalUpWaves(rows,t,trades),missed=waves.filter(w=>!w.longOverlap),captured=waves.filter(w=>w.longOverlap);const segments:any={};for(const s of ["FOLD1","FOLD2","FOLD3"] as const){const sw=waves.filter(w=>w.segment===s),sm=sw.filter(w=>!w.longOverlap);segments[s]={waves:sw.length,missed:sm.length,missedSharePct:sw.length?sm.length/sw.length*100:0,missedMovePct:numericDist(sm.map(w=>w.movePct)),missed3pctConfirmRemaining:numericDist(sm.map(w=>w.confirmations["3"]?.remainingToPeakPct).filter(Number.isFinite))};}const conf:any={};for(const trigger of ["2","3","5"]){const allC=waves.filter(w=>w.confirmations[trigger]),missC=missed.filter(w=>w.confirmations[trigger]);conf[trigger]={allConfirmed:allC.length,missedConfirmed:missC.length,missedRemainingToPeakPct:numericDist(missC.map(w=>w.confirmations[trigger].remainingToPeakPct)),missedMaeToPeakPct:numericDist(missC.map(w=>w.confirmations[trigger].maeToPeakPct)),missedNormalCapacity:sumCapacity(missed,"normal",trigger),missedSevereCapacity:sumCapacity(missed,"severe",trigger),missedGateFailures:confirmationGateFailures(missed,trigger)};}result[String(t)]={waves:waves.length,capturedByAnyV64Long:captured.length,capturedByV64LongEntry: waves.filter(w=>w.longEntryInWave).length,missed:missed.length,missedSharePct:waves.length?missed.length/waves.length*100:0,shortOverlapAmongMissed:missed.filter(w=>w.shortOverlap).length,movePct:{all:numericDist(waves.map(w=>w.movePct)),missed:numericDist(missed.map(w=>w.movePct)),captured:numericDist(captured.map(w=>w.movePct))},perfectTroughToPeakCapacity:{missedNormal:sumCapacity(missed,"normal",null),missedSevere:sumCapacity(missed,"severe",null)},confirmations:conf,segments,missedWaves:missed.map(w=>({troughTs:new Date(w.troughTs).toISOString(),peakTs:new Date(w.peakTs).toISOString(),movePct:w.movePct,durationHours:w.durationHours,shortOverlap:w.shortOverlap,segment:w.segment,confirm3:w.confirmations["3"]?{entryTs:new Date(w.confirmations["3"].entryTs).toISOString(),remainingToPeakPct:w.confirmations["3"].remainingToPeakPct,maeToPeakPct:w.confirmations["3"].maeToPeakPct,failedLongGates:w.confirmations["3"].failedLongGates}:null}))};}return{schema:"pengu-directional-wave-map/v1",definition:"close-based directional-change bullish waves; threshold confirms rise from running close trough and same threshold drawdown from running close peak ends the wave; non-overlapping by construction",thresholdsPct:[5,8,10,15,20],confirmationTriggersPct:[2,3,5],result};}
'''
if marker not in src:raise SystemExit('longDiagnostics marker missing for directional map')
src=src.replace(marker,insert+marker,1)
old='  const analysis=analyzeMissedOpportunity(rows,v64Trades);'
new='  const analysis:any=analyzeMissedOpportunity(rows,v64Trades);\n  analysis.schema="pengu-missed-opportunity-map/v2";\n  analysis.directionalWaves=analyzeDirectionalWaves(rows,v64Trades);'
if old not in src:raise SystemExit('analysis assignment marker missing')
src=src.replace(old,new,1)
TARGET.write_text(src)
print(f'PATCHED_DIRECTIONAL_WAVES={TARGET}')
