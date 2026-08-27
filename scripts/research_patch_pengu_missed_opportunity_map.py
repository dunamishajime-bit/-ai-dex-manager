from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()
marker = '\nfunction longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {'
insert = r'''
type OpportunityCoverage = "LONG_ALREADY_CAPTURED" | "SHORT_CONFLICT" | "FREE_MISSED";
type OpportunityPoint = {
  signalTs:number; entryTs:number; entryIndex:number; horizonHours:number; entryPrice:number;
  peakTs:number; peakIndex:number; peakPrice:number; troughTs:number; troughPrice:number;
  mfePct:number; maePct:number; maeBeforePeakPct:number; closeReturnPct:number;
  normalNetMfePct:number; severeNetMfePct:number; gross025NormalPct:number; gross025SeverePct:number;
  coverage:OpportunityCoverage; failedLongGates:string[]; longRaw:boolean; longSignal:boolean; shortSignal:boolean;
  features:Record<string,number>;
};
const OPPORTUNITY_HORIZONS=[6,12,24,48,96] as const;
const OPPORTUNITY_THRESHOLDS=[3,5,8,10,15,20,30] as const;
function opportunityCoverage(ts:number,trades:RichTrade[]):OpportunityCoverage {
  const active=trades.find(t=>t.entryTs<=ts&&ts<=t.exitTs);
  if(!active) return "FREE_MISSED";
  return active.side==="L"?"LONG_ALREADY_CAPTURED":"SHORT_CONFLICT";
}
function opportunityPoint(rows:PenguDualLsV2EvaluationRow[],index:number,horizonHours:number,trades:RichTrade[]):OpportunityPoint|null {
  if(index<0||index>=rows.length-2||!rows[index].features) return null;
  const entryIndex=index+1, entry=rows[entryIndex].candle, last=Math.min(rows.length-1,entryIndex+horizonHours-1);
  if(entry.openTime<EVAL_START||entry.openTime>=EVAL_END||last<entryIndex) return null;
  let peakIndex=entryIndex,peakPrice=entry.open,troughIndex=entryIndex,troughPrice=entry.open;
  for(let j=entryIndex;j<=last;j++) {
    const c=rows[j].candle;
    if(c.high>peakPrice){peakPrice=c.high;peakIndex=j;}
    if(c.low<troughPrice){troughPrice=c.low;troughIndex=j;}
  }
  let prePeakLow=entry.open;
  for(let j=entryIndex;j<=peakIndex;j++) prePeakLow=Math.min(prePeakLow,rows[j].candle.low);
  const f=rows[index].features!;
  const passes=longGatePasses(f);
  const failedLongGates=longGateOrder.filter(g=>!passes[g]);
  const mfe=peakPrice/entry.open-1,mae=troughPrice/entry.open-1,maeBeforePeak=prePeakLow/entry.open-1;
  const closeReturn=rows[last].candle.close/entry.open-1;
  const normalCost=2*BASE_FEE_PER_SIDE, severeCost=2*(BASE_FEE_PER_SIDE+STRESS_ADVERSE_SLIPPAGE_PER_SIDE);
  return {
    signalTs:rows[index].candle.openTime,entryTs:entry.openTime,entryIndex,horizonHours,entryPrice:entry.open,
    peakTs:rows[peakIndex].candle.openTime,peakIndex,peakPrice,troughTs:rows[troughIndex].candle.openTime,troughPrice,
    mfePct:mfe*100,maePct:mae*100,maeBeforePeakPct:maeBeforePeak*100,closeReturnPct:closeReturn*100,
    normalNetMfePct:(mfe-normalCost)*100,severeNetMfePct:(mfe-severeCost)*100,
    gross025NormalPct:.25*(mfe-normalCost)*100,gross025SeverePct:.25*(mfe-severeCost)*100,
    coverage:opportunityCoverage(entry.openTime,trades),failedLongGates,longRaw:rows[index].longRaw,longSignal:rows[index].longSignal,shortSignal:rows[index].shortSignal,
    features:{atr24Ratio:f.atr24Ratio,btcReturn24h:f.btcReturn24h,penguReturn24h:f.penguReturn24h,penguReturn72h:f.penguReturn72h,relativeReturn24h:f.relativeReturn24h,volumeRatio6OverPrior36:f.volumeRatio6OverPrior36,rsi14:f.rsi14,btcEma168Distance:f.btcEma168Distance}
  };
}
function quantileNumber(values:number[],q:number){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),pos=(a.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo);}
function compactStats(points:OpportunityPoint[]){
  const x=(k:keyof Pick<OpportunityPoint,"mfePct"|"maePct"|"maeBeforePeakPct"|"closeReturnPct">)=>points.map(p=>Number(p[k])).filter(Number.isFinite);
  const mfe=x("mfePct"),mae=x("maePct"),pre=x("maeBeforePeakPct"),close=x("closeReturnPct");
  return {count:points.length,mfePct:{p50:quantileNumber(mfe,.5),p75:quantileNumber(mfe,.75),p90:quantileNumber(mfe,.9),p95:quantileNumber(mfe,.95),max:mfe.length?Math.max(...mfe):null},maePct:{p50:quantileNumber(mae,.5),p10:quantileNumber(mae,.1),min:mae.length?Math.min(...mae):null},maeBeforePeakPct:{p50:quantileNumber(pre,.5),p10:quantileNumber(pre,.1)},closeReturnPct:{p50:quantileNumber(close,.5),p75:quantileNumber(close,.75),p90:quantileNumber(close,.9)}};
}
function dedupeEpisodes(points:OpportunityPoint[],thresholdPct:number){
  const eligible=points.filter(p=>p.normalNetMfePct>=thresholdPct).sort((a,b)=>a.entryTs-b.entryTs);
  const clusters:Array<OpportunityPoint[]> = [];
  let current:OpportunityPoint[]=[];let lastEntry=-Infinity;
  for(const p of eligible){if(!current.length||p.entryTs-lastEntry<=3*HOUR){current.push(p);}else{clusters.push(current);current=[p];}lastEntry=p.entryTs;}
  if(current.length)clusters.push(current);
  return clusters.map(cluster=>[...cluster].sort((a,b)=>b.normalNetMfePct-a.normalNetMfePct||Math.abs(a.maeBeforePeakPct)-Math.abs(b.maeBeforePeakPct))[0]);
}
function gateFailureCounts(points:OpportunityPoint[]){const out:Record<string,number>={};for(const p of points)for(const g of p.failedLongGates)out[g]=(out[g]??0)+1;return Object.fromEntries(Object.entries(out).sort((a,b)=>b[1]-a[1]));}
function oracleDp(points:OpportunityPoint[],thresholdPct:number,mode:"normal"|"severe"){
  const filtered=points.filter(p=>(mode==="normal"?p.normalNetMfePct:p.severeNetMfePct)>=thresholdPct).sort((a,b)=>a.entryIndex-b.entryIndex||a.peakIndex-b.peakIndex);
  const n=filtered.length,dp=new Array(n+1).fill(0),take=new Array(n).fill(false),next=new Array(n).fill(n);
  for(let i=0;i<n;i++){let j=i+1;const cutoff=filtered[i].peakIndex+PENGU_DUAL_LS_V2.cooldownHours;while(j<n&&filtered[j].entryIndex<=cutoff)j++;next[i]=j;}
  for(let i=n-1;i>=0;i--){const net=(mode==="normal"?filtered[i].normalNetMfePct:filtered[i].severeNetMfePct)/100;const reward=Math.log1p(.25*net);const yes=reward+dp[next[i]],no=dp[i+1];if(yes>no){dp[i]=yes;take[i]=true;}else dp[i]=no;}
  const selected:OpportunityPoint[]=[];for(let i=0;i<n;){if(take[i]&&Math.log1p(.25*((mode==="normal"?filtered[i].normalNetMfePct:filtered[i].severeNetMfePct)/100))+dp[next[i]]>=dp[i+1]-1e-12){selected.push(filtered[i]);i=next[i];}else i++;}
  return {trades:selected.length,compoundedGross025ReturnPct:(Math.exp(dp[0])-1)*100,sumGross025ReturnPct:selected.reduce((s,p)=>s+(mode==="normal"?p.gross025NormalPct:p.gross025SeverePct),0),selected:selected.map(p=>({entryTs:new Date(p.entryTs).toISOString(),peakTs:new Date(p.peakTs).toISOString(),netMfePct:mode==="normal"?p.normalNetMfePct:p.severeNetMfePct,coverage:p.coverage,maeBeforePeakPct:p.maeBeforePeakPct}))};
}
function analyzeMissedOpportunity(rows:PenguDualLsV2EvaluationRow[],v64Trades:RichTrade[]){
  const byHorizon:Record<string,any>={};
  const topMissed:Array<any>=[];
  for(const h of OPPORTUNITY_HORIZONS){
    const points:OpportunityPoint[]=[];
    for(let i=0;i<rows.length-2;i++){const p=opportunityPoint(rows,i,h,v64Trades);if(p)points.push(p);}
    const coverage:any={};for(const c of ["LONG_ALREADY_CAPTURED","SHORT_CONFLICT","FREE_MISSED"] as const)coverage[c]=compactStats(points.filter(p=>p.coverage===c));
    const thresholds:any={};
    for(const t of OPPORTUNITY_THRESHOLDS){
      const above=points.filter(p=>p.normalNetMfePct>=t),free=above.filter(p=>p.coverage==="FREE_MISSED"),conflict=above.filter(p=>p.coverage==="SHORT_CONFLICT"),captured=above.filter(p=>p.coverage==="LONG_ALREADY_CAPTURED");
      const episodes=dedupeEpisodes(points,t),missedEpisodes=episodes.filter(p=>p.coverage!=="LONG_ALREADY_CAPTURED");
      thresholds[String(t)]={hourlyStarts:{all:above.length,freeMissed:free.length,shortConflict:conflict.length,longCaptured:captured.length,missedSharePct:above.length?100*(free.length+conflict.length)/above.length:0},dedupedEpisodes:{all:episodes.length,missed:missedEpisodes.length,missedSharePct:episodes.length?100*missedEpisodes.length/episodes.length:0,byCoverage:Object.fromEntries((["FREE_MISSED","SHORT_CONFLICT","LONG_ALREADY_CAPTURED"] as const).map(c=>[c,episodes.filter(p=>p.coverage===c).length]))},freeMissedGateFailures:gateFailureCounts(free),oracle:{allNormal:oracleDp(points,t,"normal"),missedNormal:oracleDp(points.filter(p=>p.coverage!=="LONG_ALREADY_CAPTURED"),t,"normal"),allSevere:oracleDp(points,t,"severe"),missedSevere:oracleDp(points.filter(p=>p.coverage!=="LONG_ALREADY_CAPTURED"),t,"severe")}};
    }
    byHorizon[String(h)]={all:compactStats(points),coverage,thresholds};
    if(h===24||h===48||h===96){topMissed.push(...points.filter(p=>p.coverage!=="LONG_ALREADY_CAPTURED").sort((a,b)=>b.normalNetMfePct-a.normalNetMfePct).slice(0,40).map(p=>({horizonHours:h,entryTs:new Date(p.entryTs).toISOString(),peakTs:new Date(p.peakTs).toISOString(),coverage:p.coverage,mfePct:p.mfePct,normalNetMfePct:p.normalNetMfePct,severeNetMfePct:p.severeNetMfePct,maeBeforePeakPct:p.maeBeforePeakPct,closeReturnPct:p.closeReturnPct,failedLongGates:p.failedLongGates,features:p.features})));}
  }
  return {schema:"pengu-missed-opportunity-map/v1",method:{entry:"every closed 1h bar -> next 1h open",horizonsHours:OPPORTUNITY_HORIZONS,thresholdsNetMfePct:OPPORTUNITY_THRESHOLDS,fees:{normalRoundTripPct:2*BASE_FEE_PER_SIDE*100,severeRoundTripPct:2*(BASE_FEE_PER_SIDE+STRESS_ADVERSE_SLIPPAGE_PER_SIDE)*100},grossForCapacity:0.25,deduplication:"adjacent qualifying starts separated by <=3h form one episode; representative maximizes Normal net MFE",oracle:"hindsight upper-bound only; exit at future peak, no overlap, production cooldown enforced; not a tradable strategy"},v64:{trades:v64Trades.length,longTrades:v64Trades.filter(t=>t.side==="L").length,shortTrades:v64Trades.filter(t=>t.side==="S").length,metrics:metrics(v64Trades)},byHorizon,topMissed:[...topMissed].sort((a,b)=>b.normalNetMfePct-a.normalNetMfePct).slice(0,100),safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
}
'''
if marker not in src:
    raise SystemExit('longDiagnostics marker missing')
src = src.replace(marker, insert + marker, 1)
start = src.index('  const v64 = evaluateV64(rows,funding,baselineNormal);')
end = src.index('\n}\n\nmain().catch', start)
tail = r'''  const v64=evaluateV64(rows,funding,baselineNormal);
  const selectedConfig=v64.selectedConfig as V64Config|null;
  v64ActiveConfig=null;
  const incumbentNormal=replay(rows,funding,{mode:"normal",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  if(selectedConfig) v64ActiveConfig=selectedConfig;
  const candidateNormal=selectedConfig?replay(rows,funding,{mode:"normal",longMode:"V64_DYNAMIC"}).trades:incumbentNormal;
  const v64Trades=v64.strictPass?candidateNormal:incumbentNormal;
  assert.equal(v64Trades.length,41,"V64 trade identity/count must remain frozen at 41");
  assert.equal(v64Trades.filter(t=>t.side==="L").length,13,"V64 frozen Long count must remain 13");
  assert.equal(v64Trades.filter(t=>t.side==="S").length,28,"V64 frozen Short count must remain 28");
  const analysis=analyzeMissedOpportunity(rows,v64Trades);
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"missed-opportunity-map.json"),JSON.stringify(analysis,null,2)+"\n","utf8");
  console.log("OPPORTUNITY_MAP="+JSON.stringify({schema:analysis.schema,v64:analysis.v64,method:analysis.method,byHorizon:Object.fromEntries(Object.entries(analysis.byHorizon).map(([h,v]:any)=>[h,{all:v.all,coverage:v.coverage,thresholds:Object.fromEntries(Object.entries(v.thresholds).map(([t,x]:any)=>[t,{hourlyStarts:x.hourlyStarts,dedupedEpisodes:x.dedupedEpisodes,oracle:{missedNormal:{trades:x.oracle.missedNormal.trades,compoundedGross025ReturnPct:x.oracle.missedNormal.compoundedGross025ReturnPct},missedSevere:{trades:x.oracle.missedSevere.trades,compoundedGross025ReturnPct:x.oracle.missedSevere.compoundedGross025ReturnPct}}}]))}]))}));
'''
src = src[:start] + tail + src[end:]
TARGET.write_text(src)
print(f'PATCHED_OPPORTUNITY_MAP={TARGET}')
