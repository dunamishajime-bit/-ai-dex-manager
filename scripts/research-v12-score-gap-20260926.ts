/**
 * Read-only public Aster H1 V12 entry-gate sensitivity, not a trading BT.
 * Historical one-year overlapping 24h signed returns are diagnostics only:
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
const HOLDOUT_START = Date.parse("2026-05-10T00:00:00Z");
// Predeclared diagnostic groups. Select only the highest-scored raw candidate
// per group per completed H2 bar to reduce simultaneous multi-symbol inflation.
const MISSED_GROUPS = [
  "ONLY_VOLUME_BLOCK", "ONLY_QUALITY_BLOCK", "VOLUME_AND_QUALITY_BLOCK",
  "STRONG_SCORE_GAP_OTHER_BASE_PASS", "NEUTRAL_S070_085_VOLUME080",
  "NEUTRAL_S085_100_VOLUME080", "NEUTRAL_S100_146_VOLUME080",
  "UNRANKED_BASE_ELIGIBLE", "FINAL_WINRATE_GATE_BLOCK",
] as const;
type MissedGroup = typeof MISSED_GROUPS[number];
type MissedSample = { symbol:string; side:string; ts:number; net:number };

const ROUND_TRIP_COST_PCT = 0.003;
const CASES = [
  {name:"FROZEN",volume:0.9845,score:1.4649,gap:"NONE",minimumAtr:0.014},
  {name:"V080_ONLY",volume:0.80,score:1.4649,gap:"NONE",minimumAtr:0.014},
  {name:"SCORE100_ONLY",volume:0.9845,score:1.00,gap:"NONE",minimumAtr:0.014},
  {name:"V080_S100",volume:0.80,score:1.00,gap:"NONE",minimumAtr:0.014},
  {name:"V080_S085",volume:0.80,score:0.85,gap:"NONE",minimumAtr:0.014},
  {name:"V080_S070",volume:0.80,score:0.70,gap:"NONE",minimumAtr:0.014},
  {name:"V055_S085",volume:0.55,score:0.85,gap:"NONE",minimumAtr:0.014},
  {name:"GAP_ONLY_FROZEN_VOLUME",volume:0.9845,score:1.4649,gap:"ATR",minimumAtr:0.014},
  {name:"GAP_ATR_V080_S100",volume:0.80,score:1.00,gap:"ATR",minimumAtr:0.014},
  {name:"GAP_ATR_V055_S085",volume:0.55,score:0.85,gap:"ATR",minimumAtr:0.014},
  {name:"GAP_MOM054_V080_S100",volume:0.80,score:1.00,gap:"MOM054",minimumAtr:0.014},
  {name:"GAP_ATR018_V080_S100",volume:0.80,score:1.00,gap:"ATR",minimumAtr:0.018},
] as const;

function parseKline(row: AsterKline) {
  const [ts,open,high,low,close,volume,closeTs]=[0,1,2,3,4,5,6].map(i=>Number(row[i]));
  if (![ts,open,high,low,close,volume,closeTs].every(Number.isFinite)
    || ts % HOUR !== 0 || ts + HOUR > END
    || open <= 0 || close <= 0 || low <= 0 || high < low || volume < 0) return null;
  return {ts,open,high,low,close,volume,closed:true};
}
function quality(input:{regime:string;strong:boolean;side:string;score:number;momentum:number;atrRatio:number},
  s:number,mode:"NONE"|"ATR"|"MOM054",minimumAtr:number) {
  const {regime,strong,side,score,momentum,atrRatio}=input;
  if(regime==="NEUTRAL")return V12_X1_ALL.allowNeutralRegime && score>=s;
  if((regime==="LONG"&&side!=="LONG")||(regime==="SHORT"&&side!=="SHORT"))return false;
  if(score>=s)return true;
  const aligned=side==="LONG"?momentum:-momentum;
  if(strong){
    if(score>=V12_X1_ALL.strongRegimeQualityScoreMinimum
       &&score<=V12_X1_ALL.strongRegimeQualityScoreMaximum
       &&atrRatio>=V12_X1_ALL.strongRegimeQualityMinimumAtrRatio)return true;
    return mode!=="NONE" && score>V12_X1_ALL.strongRegimeQualityScoreMaximum
      && score<s && atrRatio>=minimumAtr
      && (mode==="ATR" || aligned>=V12_X1_ALL.relaxedRegimeMinimumMomentumPct);
  }
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
  const baseGateAudit={rawCandidateRows:0,volumeBlocked:0,qualityBlocked:0,volumeAndQualityBlocked:0,
    scoreGapRaw:0,scoreGapOnlyBaseFailure:0,neutralVolume080Score070:0};
  const nearMisses = {} as Record<MissedGroup,MissedSample[]>;
  for(const name of MISSED_GROUPS) nearMisses[name] = [];
  let windows=0;
  for(let i=65;i<all.BTC.length-HOLD_BARS-1;i++){
    if(all.BTC[i].endTs<SAMPLE_START)continue;
    const baseline=buildV12Signals(all,i);
    const observed=buildV12DecisionObservation(all,i,all.BTC[i].endTs);
    if(!observed)continue;
    windows++;
    for (const c of observed.candidates) {
      const audit=c.allGateChecks;
      if (!audit) throw Error("ALL_GATE_DIAGNOSTICS_MISSING");
      const volumeBlock=audit.checks.volume.status==="BLOCK";
      const qualityBlock=audit.checks.entryQuality.status==="BLOCK";
      baseGateAudit.rawCandidateRows++;
      if(volumeBlock)baseGateAudit.volumeBlocked++;
      if(qualityBlock)baseGateAudit.qualityBlocked++;
      if(volumeBlock && qualityBlock)baseGateAudit.volumeAndQualityBlocked++;
      if(audit.strongScoreGap)baseGateAudit.scoreGapRaw++;
      if(audit.strongScoreGapOnlyBaseFailure)baseGateAudit.scoreGapOnlyBaseFailure++;
      if(observed.regime==="NEUTRAL" && c.volumeRatio>=0.8 && c.score>=0.70 && c.score<1.00)
         baseGateAudit.neutralVolume080Score070++;
    }
    // The base runner's first failed reason is not proof other gates passed.
    // Use the independently computed allGateChecks, and do not relax real LIVE.
    for (const group of MISSED_GROUPS) {
      const c=observed.candidates.find(c=>{
        const a=c.allGateChecks;
        if(!a)return false;
        const ch=a.checks;
        const other=["edgeToCost","momentum","btcDirection"].every(k=>ch[k]?.status==="PASS");
        const volume=ch.volume?.status==="BLOCK";
        const quality=ch.entryQuality?.status==="BLOCK";
        const baseEligible=c.baseEligible===true;
        if(group==="ONLY_VOLUME_BLOCK")return other&&volume&&!quality;
        if(group==="ONLY_QUALITY_BLOCK")return other&&!volume&&quality;
        if(group==="VOLUME_AND_QUALITY_BLOCK")return other&&volume&&quality;
        if(group==="STRONG_SCORE_GAP_OTHER_BASE_PASS")return a.strongScoreGapOnlyBaseFailure;
        if(group==="UNRANKED_BASE_ELIGIBLE")return baseEligible&&c.portfolioRank===undefined;
        if(group==="FINAL_WINRATE_GATE_BLOCK")return baseEligible&&c.portfolioRank!==undefined
          &&typeof c.entryGateReason==="string"&&c.entryGateReason.startsWith("BLOCK");
        if(observed.regime!=="NEUTRAL"||!other||c.volumeRatio<0.80)return false;
        if(group==="NEUTRAL_S070_085_VOLUME080")return c.score>=0.70&&c.score<0.85;
        if(group==="NEUTRAL_S085_100_VOLUME080")return c.score>=0.85&&c.score<1.00;
        if(group==="NEUTRAL_S100_146_VOLUME080")return c.score>=1.00&&c.score<V12_X1_ALL.neutralScoreThreshold;
        return false;
      });
      if(!c)continue;
      const bars=all[c.symbol];
      const start=bars[i+1].open,end=bars[i+HOLD_BARS].close;
      if(!(start>0&&end>0))throw Error("NEARMISS_INVALID_FORWARD_BAR");
      const net=(c.side==="LONG"?end/start-1:1-end/start)-ROUND_TRIP_COST_PCT;
      nearMisses[group].push({symbol:c.symbol,side:c.side,ts:all.BTC[i].endTs,net});
    }
    const btc=all.BTC;
    const sma=btc.slice(i-V12_X1_ALL.btcRegimeSmaBars+1,i+1).reduce((t,b)=>t+b.close,0)/V12_X1_ALL.btcRegimeSmaBars;
    const strong=observed.regime!=="NEUTRAL" && Math.abs(btc[i].close/sma-1)>=V12_X1_ALL.strongRegimeThresholdPct;
    for(const run of output){
      const eligible:V12Candidate[]=observed.candidates.filter(c=>{
        if(c.volumeRatio<run.volume || Math.abs(c.momentum)<V12_X1_ALL.minimumMomentumPct) return false;
        const edge=Math.abs(c.momentum);
        if(edge<V12_X1_ALL.minimumEdgeToCostRatio*V12_X1_ALL.normalRoundTripCostBps/10_000)return false;
        return quality({regime:observed.regime,strong,side:c.side,score:c.score,momentum:c.momentum,atrRatio:c.atr/all[c.symbol][i].close},run.score,run.gap,run.minimumAtr);
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
  const pairedNames:Record<string,string>={GAP_ONLY_FROZEN_VOLUME:"FROZEN",GAP_ATR_V080_S100:"V080_S100",
    GAP_ATR_V055_S085:"V055_S085",GAP_MOM054_V080_S100:"V080_S100",GAP_ATR018_V080_S100:"V080_S100"};
  const results=output.map(x=>{
    const proxy=x.net24hProxy;
    const sum=proxy.reduce((a,b)=>a+b,0);
    const added=[...x.opportunityKeys].filter(k=>!base.has(k));
    const addReturns=added.map(k=>x.returnByKey.get(k)!).filter(Number.isFinite);
    const removed=[...base].filter(k=>!x.opportunityKeys.has(k));
    // Repeated H2 observations of the same symbol are not fresh live entries.
    const events=[...x.opportunityKeys].map(key=>{
      const [symbol,side,tsText]=key.split("|");
      return {symbol,side,ts:Number(tsText),net:x.returnByKey.get(key)!};
    }).sort((a,b)=>a.ts-b.ts||a.symbol.localeCompare(b.symbol));
    const jstDay=(ts:number)=>new Date(ts+9*HOUR).toISOString().slice(0,10);
    const days=new Map<string,number>();
    for(const e of events)days.set(jstDay(e.ts),(days.get(jstDay(e.ts))||0)+1);
    const episodes=(hours:number)=>{
      const lastBySymbol=new Map<string,number>();
      const kept:typeof events=[];
      for(const e of events){
        const last=lastBySymbol.get(e.symbol);
        if(last!==undefined&&e.ts-last<hours*HOUR)continue;
        kept.push(e);lastBySymbol.set(e.symbol,e.ts);
      }
      return {episodeCount:kept.length,
        positive24hForwardPct:kept.length?100*kept.filter(e=>e.net>0).length/kept.length:null,
        mean24hForwardNetPct:kept.length?100*kept.reduce((a,e)=>a+e.net,0)/kept.length:null,
        episodeDaysJst:new Set(kept.map(e=>jstDay(e.ts))).size};
    };
    const dailyCounts=[...days.values()].sort((a,b)=>a-b);
    const fullYearDays=365;
    const twin=output.find(y=>y.name===pairedNames[x.name]);
    const incrementalTwin=twin ? [...x.opportunityKeys].filter(k=>!twin.opportunityKeys.has(k)) : [];
    const displacedTwin=twin ? [...twin.opportunityKeys].filter(k=>!x.opportunityKeys.has(k)) : [];
    const incrementalTwinReturns=incrementalTwin.map(k=>x.returnByKey.get(k)!).filter(Number.isFinite);
    const holdoutTwin=incrementalTwin.filter(k=>Number(k.split("|")[2])>=HOLDOUT_START);
    const holdoutTwinReturns=holdoutTwin.map(k=>x.returnByKey.get(k)!).filter(Number.isFinite);
    const periodMetric=(items:typeof events)=>{
      const total=items.reduce((a,e)=>a+e.net,0);
      const bySymbol=new Map<string,number>();const episodes46:typeof events=[];
      for(const e of items){
        const last=bySymbol.get(e.symbol);
        if(last!==undefined && e.ts-last<46*HOUR)continue;
        bySymbol.set(e.symbol,e.ts);episodes46.push(e);
      }
      return {repeatedObservations:items.length,
        signalDaysJst:new Set(items.map(e=>jstDay(e.ts))).size,
        repeated24hMeanPct:items.length?100*total/items.length:null,
        repeated24hPositivePct:items.length?100*items.filter(e=>e.net>0).length/items.length:null,
        independent46hEpisodeCount:episodes46.length,
        independent46hMean24hProxyPct:episodes46.length?100*episodes46.reduce((a,e)=>a+e.net,0)/episodes46.length:null,
        independent46hPositivePct:episodes46.length?100*episodes46.filter(e=>e.net>0).length/episodes46.length:null,
      };
    };
    return {
      case:x.name,volumeRatioMin:x.volume,qualityScoreThreshold:x.score,
      rawCandidatesAfterBase:x.rawCandidatesAfterBase,
      trainPeriod:periodMetric(events.filter(e=>e.ts<HOLDOUT_START)),
      disjointFinal92DayHoldout:periodMetric(events.filter(e=>e.ts>=HOLDOUT_START)),
      versusUngappedTwin:twin?{
        twin:twin.name,additionalH2Observations:incrementalTwin.length,
        displacedTwinObservations:displacedTwin.length,
        added24hNetProxyMeanPct:incrementalTwinReturns.length?100*incrementalTwinReturns.reduce((a,b)=>a+b,0)/incrementalTwinReturns.length:null,
        added24hProxyPositivePct:incrementalTwinReturns.length?100*incrementalTwinReturns.filter(z=>z>0).length/incrementalTwinReturns.length:null,
        addedHoldoutObservations:holdoutTwin.length,
        addedHoldout24hNetProxyMeanPct:holdoutTwinReturns.length?100*holdoutTwinReturns.reduce((a,b)=>a+b,0)/holdoutTwinReturns.length:null,
        addedHoldout24hPositivePct:holdoutTwinReturns.length?100*holdoutTwinReturns.filter(z=>z>0).length/holdoutTwinReturns.length:null
      }:null,
      strongScoreGapMode:x.gap,strongGapMinimumAtrRatio:x.minimumAtr,
      potentialSignalWindows:x.windowsWithSignal,
      potentialEntries:x.opportunities,hc175Entries:x.hc175Opportunities,
      newlyAdmittedRelativeToFrozen:added.length,
      frozenOpportunitiesDisplaced:removed.length,
      incrementalOnlyNet24hMeanPct:addReturns.length?100*addReturns.reduce((a,b)=>a+b,0)/addReturns.length:null,
      incrementalOnlyNet24hPositivePct:addReturns.length?100*addReturns.filter(x=>x>0).length/addReturns.length:null,
      signed24hNetFeeProxyMeanPct:proxy.length?100*sum/proxy.length:null,
      signed24hNetFeeProxyPositivePct:proxy.length?100*proxy.filter(v=>v>0).length/proxy.length:null,
      proxyEvents:proxy.length,
      repeatedH2ObservationsNotRealEntries:true,
      yearDays:fullYearDays,signalDaysJst:days.size,zeroSignalDaysJst:fullYearDays-days.size,
      medianRepeatedObservationsPerSignalDay:dailyCounts.length?dailyCounts[Math.floor(dailyCounts.length/2)]:null,
      maxRepeatedObservationsOnOneSignalDay:dailyCounts.at(-1)||0,
      perMonthSignalDaysJst:Object.fromEntries([...days.keys()].reduce((m,day)=>{
        const month=day.slice(0,7);m.set(month,(m.get(month)||0)+1);return m;
      },new Map<string,number>())),
      independentSymbolEpisodesMin24hApart:episodes(24),
      independentSymbolEpisodesMin46hApart:episodes(46),
      episodeCaveat:"Per-symbol spacing only; not actual trades, no stops or 5-logic gross.",
    };
  });
  function nearMissSummary(items:MissedSample[]){
    const sorted=[...items].sort((a,b)=>a.ts-b.ts||a.symbol.localeCompare(b.symbol));
    const last=new Map<string,number>(),independent:MissedSample[]=[];
    for(const e of sorted){
      const previous=last.get(e.symbol);
      if(previous!==undefined && e.ts-previous<46*HOUR)continue;
      last.set(e.symbol,e.ts);
      independent.push(e);
    }
    const calc=(data:MissedSample[])=>({
      count:data.length,
      meanNet24hProxyPct:data.length?100*data.reduce((acc,e)=>acc+e.net,0)/data.length:null,
      positiveNet24hPct:data.length?100*data.filter(e=>e.net>0).length/data.length:null,
      signalDaysJst:new Set(data.map(e=>new Date(e.ts+9*HOUR).toISOString().slice(0,10))).size,
    });
    return {
      rawTopScoredPerH2:calc(sorted),
      independent46h:calc(independent),
      trainBeforeMay10:calc(independent.filter(e=>e.ts<HOLDOUT_START)),
      finalDisjointHoldout:calc(independent.filter(e=>e.ts>=HOLDOUT_START)),
      isExecutableOrder:false,
      winRateOrRealizedPnL:false,
    };
  }
  const rawNearMissTopRankGroups=Object.fromEntries(
    MISSED_GROUPS.map(name=>[name,nearMissSummary(nearMisses[name])])
  );
  const artifact={
    schema:"v12-one-year-score-gap-sensitivity/v3",researchOnly:true,scoreGapDiagnostic:true,
    notABacktest:true,noIntegratedGrossOrStopSimulation:true,
    sourceSha:"e1b58060d6263a3af7ced51bec854d3e211d2f35",
    market:"ASTER_FUTURES_V3_PUBLIC_H1",
    comparisonPeriod:"2025-08-10T00Z through 2026-08-10T00Z",
    period:{firstCommonBar:new Date(all.BTC[0].ts).toISOString(),lastCommonBar:new Date(all.BTC.at(-1)!.endTs).toISOString()},
    windows,commonH2Bars:common.size,
    holdoutStart:"2026-05-10T00:00:00Z",baseGateAudit,rawNearMissTopRankGroups,
    frozenGateExactParity:true,hcGrossMultiplierUnchanged:1.75,
    feeProxyRoundTrip:ROUND_TRIP_COST_PCT,
    caveat:"Overlapping entry-notional signed 24h forward proxies and highest-scored raw near-misses are NOT executable trades, realized trade PnL, WR, PF, DD, stop-aware fills, or investable performance.",
    results,safety:{ordersSent:0,liveChanged:false,productionChanged:false},
  };
  writeFileSync(process.env.GATE_RESEARCH_OUT||"v12-one-year-score-gap-20260926.json",JSON.stringify(artifact,null,2)+"\n");
  console.log("V12_SCORE_GAP_SENSITIVITY="+JSON.stringify(artifact));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
