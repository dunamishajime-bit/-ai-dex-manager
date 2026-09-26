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
const END = Date.parse("2026-09-26T08:00:00Z");
const START = END - 497 * HOUR;
const HOLD_BARS = 12;
const ROUND_TRIP_COST_PCT = 0.003;
const CASES = [
  { name: "FROZEN", volume: 0.9845, score: 1.4649 },
  { name: "VOLUME_080", volume: 0.80, score: 1.4649 },
  { name: "VOLUME_060", volume: 0.60, score: 1.4649 },
  { name: "VOLUME_040", volume: 0.40, score: 1.4649 },
  { name: "SCORE_125", volume: 0.9845, score: 1.25 },
  { name: "SCORE_100", volume: 0.9845, score: 1.00 },
  { name: "COMBINED_V080_S100", volume: 0.80, score: 1.00 },
  { name: "COMBINED_V060_S080", volume: 0.60, score: 0.80 },
  { name: "COMBINED_V040_S080", volume: 0.40, score: 0.80 },
  { name: "COMBINED_V040_S060", volume: 0.40, score: 0.60 },
  { name: "COMBINED_V020_S060", volume: 0.20, score: 0.60 },
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
    userAgent:"DisDex-ReadOnly-V12-Gate-Sensitivity/20260926",
  });
  const all:Record<string,V12Bar[]>={};
  for(const sym of V12_X1_ALL.universe){
    const raw=await client.getKlines(`${sym}USDT`,"1h",500,{startTime:START,endTime:END-1});
    all[sym]=resampleV12H1ToH2(raw.map(parseKline).filter((x):x is NonNullable<ReturnType<typeof parseKline>>=>!!x));
    if(all[sym].length<100)throw Error(`INSUFFICIENT_SYMBOL_BARS:${sym}:${all[sym].length}`);
    console.log(`PUBLIC_ASTER_BARS:${sym}:${all[sym].length}`);
    await new Promise(r=>setTimeout(r,170));
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
  }));
  let windows=0;
  for(let i=65;i<all.BTC.length-HOLD_BARS-1;i++){
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
        run.net24hProxy.push((candidate.side==="LONG" ? end/start-1 : start/end-1)-ROUND_TRIP_COST_PCT);
      }
    }
  }
  const base=output[0].opportunityKeys;
  const results=output.map(x=>{
    const proxy=x.net24hProxy;
    const sum=proxy.reduce((a,b)=>a+b,0);
    const added=[...x.opportunityKeys].filter(k=>!base.has(k));
    return {
      case:x.name,volumeRatioMin:x.volume,qualityScoreThreshold:x.score,
      rawCandidatesAfterBase:x.rawCandidatesAfterBase,
      potentialSignalWindows:x.windowsWithSignal,
      potentialEntries:x.opportunities,hc175Entries:x.hc175Opportunities,
      newlyAdmittedRelativeToFrozen:added.length,
      signed24hNetFeeProxyMeanPct:proxy.length?100*sum/proxy.length:null,
      signed24hNetFeeProxyPositivePct:proxy.length?100*proxy.filter(v=>v>0).length/proxy.length:null,
      proxyEvents:proxy.length,
    };
  });
  const artifact={
    schema:"v12-short-sample-gate-sensitivity/v1",researchOnly:true,
    notABacktest:true,noIntegratedGrossOrStopSimulation:true,
    sourceSha:"e1b58060d6263a3af7ced51bec854d3e211d2f35",
    market:"ASTER_FUTURES_V3_PUBLIC_H1",
    period:{firstCommonBar:new Date(all.BTC[0].ts).toISOString(),lastCommonBar:new Date(all.BTC.at(-1)!.endTs).toISOString()},
    windows,commonH2Bars:common.size,
    frozenGateExactParity:true,hcGrossMultiplierUnchanged:1.75,
    feeProxyRoundTrip:ROUND_TRIP_COST_PCT,
    caveat:"Overlapping signed 24h forward proxies are NOT realized trade PnL, WR, PF, DD, stop-aware fills or investable performance.",
    results,safety:{ordersSent:0,liveChanged:false,productionChanged:false},
  };
  writeFileSync(process.env.GATE_RESEARCH_OUT||"v12-short-gate-sensitivity-20260926.json",JSON.stringify(artifact,null,2)+"\n");
  console.log("V12_GATE_SENSITIVITY="+JSON.stringify(artifact));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
