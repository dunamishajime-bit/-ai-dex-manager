/**
 * Read-only public Aster H1 V12 entry-gate sensitivity, not a trading BT.
 * Historical 20-day overlapping 24h signed returns are diagnostics only:
 * no concurrent 5-logic gross, resident stops, intrabar fills, or compounding.
 * Sources are EXACT frozen production signal/selector functions.
 */
import { writeFileSync } from "node:fs";
import { AsterV3Client, type AsterKline } from "../lib/aster-v3-client";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import {
  buildV12DecisionObservation, buildV12Signals, evaluateV12WinRateGate,
  resampleV12H1ToH2, selectV12Top3Candidates,
  type V12Bar, type V12Candidate,
} from "../lib/v12-x1-all";

const HOUR = 3_600_000;
const END = Date.parse("2026-08-10T00:00:00Z");
const SAMPLE_START = Date.parse("2025-08-10T00:00:00Z");
const START = SAMPLE_START - 11 * 24 * HOUR;
const HOLD_BARS = 12;
const ROUND_TRIP_COST_PCT = 0.003;
const CASES = [
  { name:"FROZEN",volume:0.9845,score:1.4649 },
  { name:"VOLUME_080",volume:0.80,score:1.4649 },
  { name:"USER_V055_S085",volume:0.55,score:0.85 },
  { name:"COMBINED_V060_S080",volume:0.60,score:0.80 },
] as const;

function parseKline(row: AsterKline) {
  const [ts,open,high,low,close,volume,closeTs]=[0,1,2,3,4,5,6].map(i=>Number(row[i]));
  if (![ts,open,high,low,close,volume,closeTs].every(Number.isFinite)
    || ts % HOUR !== 0 || ts + HOUR > END
    || open <= 0 || close <= 0 || low <= 0 || high < low || volume < 0) return null;
  return {ts,open,high,low,close,volume,closed:true};
}
function quality(input:{regime:string;strong:boolean;side:string;score:number;momentum:number;atrRatio:number},s:number) {
  const {regime,strong,side,score,momentum,atrRatio}=input;
  if(regime==="NEUTRAL")return V12_X1_ALL.allowNeutralRegime && score>=s;
  if((regime==="LONG"&&side!=="LONG")||(regime==="SHORT"&&side!=="SHORT"))return false;
  if(score>=s)return true;
  if(strong)return score>=V12_X1_ALL.strongRegimeQualityScoreMinimum
    && score<=V12_X1_ALL.strongRegimeQualityScoreMaximum
    && atrRatio>=V12_X1_ALL.strongRegimeQualityMinimumAtrRatio;
  const aligned=side==="LONG"?momentum:-momentum;
  return aligned>=V12_X1_ALL.relaxedRegimeMinimumMomentumPct
    && atrRatio>=V12_X1_ALL.relaxedRegimeMinimumAtrRatio;
}
async function main(){
  const client=new AsterV3Client({
    baseUrl:"https://fapi.asterdex.com",requestTimeoutMs:15_000,
    userAgent:"DisDex-ReadOnly-V12-1Y-Research/20260926",
  });
  const all:Record<string,V12Bar[]>={};
  for(const sym of V12_X1_ALL.universe){
    const unique=new Map<number,ReturnType<typeof parseKline>>();
    for(let begin=START;begin<END;begin+=500*HOUR){
      const end=Math.min(END-1,begin+500*HOUR-1);
      let raw;
      try{raw=await client.getKlines(`${sym}USDT`,"1h",500,{startTime:begin,endTime:end});}
      catch(e){throw Error(`ASTER_HISTORICAL_FETCH_FAILED:${sym}:${new Date(begin).toISOString()}:${e instanceof Error?e.message:String(e)}`);}
      for(const item of raw){
        const x=parseKline(item);if(!x)continue;
        const prev=unique.get(x.ts);
        if(prev&&(prev!.close!==x.close||prev!.volume!==x.volume))throw Error(`HISTORICAL_AMENDED_BAR:${sym}:${x.ts}`);
        unique.set(x.ts,x);
      }
      await new Promise(r=>setTimeout(r,300));
    }
    all[sym]=resampleV12H1ToH2([...unique.values()].filter((x):x is NonNullable<ReturnType<typeof parseKline>>=>!!x));
    console.log(`PUBLIC_ASTER_ANNUAL_BARS:${sym}:${all[sym].length}`);
    if(all[sym].length<1_500)throw Error(`INSUFFICIENT_1Y_SYMBOL_BARS:${sym}:${all[sym].length}`);
  }
  const common=V12_X1_ALL.universe.reduce<Set<number>|undefined>((acc,sym)=>{
    const next=new Set(all[sym].map(b=>b.endTs));
    return acc?new Set([...acc].filter(t=>next.has(t))):next;
  },undefined);
  if(!common||common.size<130)throw Error(`INSUFFICIENT_COMMON_H2:${common?.size||0}`);
  for(const sym of V12_X1_ALL.universe)all[sym]=all[sym].filter(b=>common.has(b.endTs));
  const output=CASES.map(x=>({
    ...x,opportunities:0,windowsWithSignal:0,hc175Opportunities:0,
    net24hProxy:[] as number[],rawCandidatesAfterBase:0,
    observedFromFrozen:new Set<string>(),opportunityKeys:new Set<string>(),
    returnByKey:new Map<string,number>(),
  }));
  let windows=0;
  for(let i=65;i<all.BTC.length-HOLD_BARS-1;i++){
    if(all.BTC[i].endTs<SAMPLE_START)continue;
    const baseline=buildV12Signals(all,i);
    const observed=buildV12DecisionObservation(all,i,all.BTC[i].endTs);
    if(!observed)continue;
    windows++;
    const btc=all.BTC;
    const sma=btc.slice(i-V12_X1_ALL.btcRegimeSmaBars+1,i+1).reduce((t,b)=>t+b.close,0)/V12_X1_ALL.btcRegimeSmaBars;
    const strong=observed.regime!=="NEUTRAL" && Math.abs(btc[i].close/sma-1)>=V12_X1_ALL.strongRegimeThresholdPct;
    for(const run of output){
      const eligible:V12Candidate[]=observed.candidates.filter(c=>{
        if(c.volumeRatio<run.volume || Math.abs(c.momentum)<V12_X1_ALL.minimumMomentumPct) return false;
        const edge=Math.abs(c.momentum);
        if(edge<V12_X1_ALL.minimumEdgeToCostRatio*V12_X1_ALL.normalRoundTripCostBps/10_000)return false;
        return quality({regime:observed.regime,strong,side:c.side,score:c.score,momentum:c.momentum,atrRatio:c.atr/all[c.symbol][i].close},run.score);
      }).map(c=>({symbol:c.symbol,side:c.side,score:c.score,volumeRatio:c.volumeRatio,momentum:c.momentum,volatility:c.volatility,atr:c.atr}));
      run.rawCandidatesAfterBase+=eligible.length;
      const selected=selectV12Top3Candidates(eligible).map(({candidate,rank})=>({candidate,rank,gate:evaluateV12WinRateGate(all,i,{symbol:candidate.symbol,side:candidate.side,rank})})).filter(x=>x.gate.allow);
      if(run.name==="FROZEN"){
        const actual=baseline.map(b=>`${b.symbol}|${b.side}|${b.rank}`).sort().join(",");
        const computed=selected.map(x=>`${x.candidate.symbol}|${x.candidate.side}|${x.rank}`).sort().join(",");
        if(actual!==computed)throw Error(`BASELINE_PRODUCTION_PARITY_FAILURE:${new Date(btc[i].endTs).toISOString()}:${actual}:${computed}`);
      }
      if(selected.length)run.windowsWithSignal++;
      for(const {candidate,gate} of selected){
        const name=`${candidate.symbol}|${candidate.side}|${btc[i].endTs}`;
        run.opportunityKeys.add(name);
        run.opportunities++;
        if(gate.highConfidence)run.hc175Opportunities++;
        const symbolBars=all[candidate.symbol];
        const start=symbolBars[i+1].open;
        const end=symbolBars[i+HOLD_BARS].close;
        if(!(start>0&&end>0))throw Error("INVALID_FORWARD_PRICE");
        const signedNet=(candidate.side==="LONG" ? end/start-1 : 1-end/start)-ROUND_TRIP_COST_PCT;
        run.net24hProxy.push(signedNet);
        run.returnByKey.set(name,signedNet);
      }
    }
  }
  const base=output[0].opportunityKeys;
  const results=output.map(x=>{
    const proxy=x.net24hProxy;
    const sum=proxy.reduce((a,b)=>a+b,0);
    const added=[...x.opportunityKeys].filter(k=>!base.has(k));
    const addReturns=added.map(k=>x.returnByKey.get(k)!).filter(Number.isFinite);
    const removed=[...base].filter(k=>!x.opportunityKeys.has(k));
    return {
      case:x.name,volumeRatioMin:x.volume,qualityScoreThreshold:x.score,
      rawCandidatesAfterBase:x.rawCandidatesAfterBase,
      potentialSignalWindows:x.windowsWithSignal,
      potentialEntries:x.opportunities,hc175Entries:x.hc175Opportunities,
      newlyAdmittedRelativeToFrozen:added.length,
      frozenOpportunitiesDisplaced:removed.length,
      incrementalOnlyNet24hMeanPct:addReturns.length?100*addReturns.reduce((a,b)=>a+b,0)/addReturns.length:null,
      incrementalOnlyNet24hPositivePct:addReturns.length?100*addReturns.filter(x=>x>0).length/addReturns.length:null,
      signed24hNetFeeProxyMeanPct:proxy.length?100*sum/proxy.length:null,
      signed24hNetFeeProxyPositivePct:proxy.length?100*proxy.filter(v=>v>0).length/proxy.length:null,
      proxyEvents:proxy.length,
    };
  });
  const artifact={
    schema:"v12-one-year-gate-sensitivity/v1",researchOnly:true,
    notABacktest:true,noIntegratedGrossOrStopSimulation:true,
    sourceSha:"e1b58060d6263a3af7ced51bec854d3e211d2f35",
    market:"ASTER_FUTURES_V3_PUBLIC_H1",
    comparisonPeriod:"2025-08-10T00Z through 2026-08-10T00Z",
    period:{firstCommonBar:new Date(all.BTC[0].ts).toISOString(),lastCommonBar:new Date(all.BTC.at(-1)!.endTs).toISOString()},
    windows,commonH2Bars:common.size,
    frozenGateExactParity:true,hcGrossMultiplierUnchanged:1.75,
    feeProxyRoundTrip:ROUND_TRIP_COST_PCT,
    caveat:"Overlapping entry-notional signed 24h forward proxies are NOT realized trade PnL, WR, PF, DD, stop-aware fills or investable performance.",
    results,safety:{ordersSent:0,liveChanged:false,productionChanged:false},
  };
  writeFileSync(process.env.GATE_RESEARCH_OUT||"v12-one-year-gate-sensitivity-20260926.json",JSON.stringify(artifact,null,2)+"\n");
  console.log("V12_GATE_SENSITIVITY="+JSON.stringify(artifact));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
