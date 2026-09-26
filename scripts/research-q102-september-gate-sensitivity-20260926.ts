/** Read-only historical Q102 HIGH_VOL gate sensitivity with frozen Sep monthly rules.
 * The monthly rules are September's live observer selection from August training.
 * This is a SINGLE-SLEEVE September HIGH_VOL research replay, not the 5-logic BT.
 */
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {
 computeQuality102HighVolFeatures,quality102HighVolMarketValid,
 simulateQuality102HighVolExit,quality102NetFromGross,QUALITY102_RESEARCH_COSTS,
 type Quality102Candle,
} from "../lib/disdex-quality102-causal-pipeline";

const H=3_600_000;
const frozen=JSON.parse(readFileSync(process.env.Q102_SNAPSHOT_PATH||"q102-ranking.json","utf8")) as {
  runtimeCommitSha:string,referenceTs:number,
  items:Array<{symbol:string,diagnostics?:{highVol?:{
    rule?:{longDrop:number,longRsi:number,shortRally:number,shortRsi:number,hardStop:number},
    metrics?:{trades:number,winRate:number,profitFactor:number,expectancy:number,maxDrawdown:number},
    scannerHealthPass:boolean,features?:{signalTs:number,ret24:number,ret14d:number,rsi14:number,volumeRatio:number,atrPct:number},
    rawMatched:boolean,
  }}}>;
};
const history=JSON.parse(readFileSync(process.env.Q102_HISTORY_PATH||"q102-market-history.json","utf8")) as{candlesBySymbol:Record<string,Quality102Candle[]>};
assert.equal(frozen.runtimeCommitSha,"e1b58060d6263a3af7ced51bec854d3e211d2f35","unexpected live SHA");
const cutoff=Number(frozen.referenceTs)-H;
const sampleStart=Date.parse("2026-09-01T00:00:00Z");
const scenarios=[
 {name:"FROZEN",retMult:1,rsiDelta:0,minimumVolume:0.5},
 {name:"DROP_095",retMult:0.95,rsiDelta:0,minimumVolume:0.5},
 {name:"DROP_090",retMult:0.9,rsiDelta:0,minimumVolume:0.5},
 {name:"DROP_080",retMult:0.8,rsiDelta:0,minimumVolume:0.5},
 {name:"RSI_PLUS_5",retMult:1,rsiDelta:5,minimumVolume:0.5},
 {name:"DROP090_RSI5",retMult:0.9,rsiDelta:5,minimumVolume:0.5},
 {name:"DROP080_RSI5",retMult:0.8,rsiDelta:5,minimumVolume:0.5},
 {name:"VOL040",retMult:1,rsiDelta:0,minimumVolume:0.4},
] as const;
type Candidate={id:string,symbol:string,side:1|-1,signalTs:number,entryTs:number,score:number,hardStop:number,bars:Quality102Candle[],netNormal:number,netSevere:number,exitTs:number,holdHours:number,exitReason:string};
const outputs=scenarios.map(s=>({...s,candidates:[] as Candidate[],candidateKeys:new Set<string>()}));
let validated=0, usable=0, skipped=0, invalidSymbols:string[]=[];
const relevant=frozen.items.filter(x=>x.diagnostics?.highVol?.rule&&x.diagnostics.highVol?.scannerHealthPass);
for(const item of relevant){
  const symbol=item.symbol;
  const diag=item.diagnostics!.highVol!;
  const rule=diag.rule!,m=diag.metrics!;
  if(!m||!(Number.isFinite(m.winRate)&&Number.isFinite(m.profitFactor)&&Number.isFinite(m.expectancy)))throw Error("METRICS_MISSING:"+symbol);
  let rows=history.candlesBySymbol[symbol]||[];
  rows=rows.filter(x=>x.timestampMs<=cutoff);
  if(!rows.length||rows.at(-1)!.timestampMs!==cutoff){invalidSymbols.push(symbol);continue;}
  // Prove our closed-bar feature function matches current live observer.
  const liveFeature=computeQuality102HighVolFeatures(rows,rows.length-1);
  const obs=diag.features;
  if(!obs||obs.signalTs!==liveFeature.signalTs)throw Error("LIVE_FEATURE_TIMESTAMP_MISMATCH:"+symbol);
  for(const key of ["ret24","ret14d","rsi14","volumeRatio","atrPct"] as const){
    if(Math.abs(liveFeature[key]-obs[key])>1e-7)throw Error("LIVE_FEATURE_PARITY_FAILED:"+symbol+":"+key);
  }
  const origMarket=quality102HighVolMarketValid(liveFeature);
  const origLong=liveFeature.ret14d>=0&&liveFeature.barUp&&liveFeature.ret24<=-rule.longDrop&&liveFeature.rsi14<=rule.longRsi;
  const origShort=liveFeature.ret14d<0&&liveFeature.barDown&&liveFeature.ret24>=rule.shortRally&&liveFeature.rsi14>=rule.shortRsi;
  if(Boolean(diag.rawMatched)!==Boolean(origMarket&&(origLong||origShort)))throw Error("LIVE_RAW_GATE_PARITY_FAILED:"+symbol);
  validated++;
  const first=rows.findIndex(x=>x.timestampMs>=sampleStart);
  if(first<336){skipped++;continue;}
  usable++;
  for(let i=first;i+72<rows.length;i++){
    const f=computeQuality102HighVolFeatures(rows,i);
    const enter=rows[i+1];
    if(!enter||enter.timestampMs!==f.signalTs+H)throw Error("NONCONTIGUOUS_ENTRY:"+symbol);
    for(const out of outputs){
      if(!(Number.isFinite(f.ret14d)&&f.atrPct>=.01&&f.volumeRatio>=out.minimumVolume))continue;
      const l=f.ret14d>=0&&f.barUp&&f.ret24<=-rule.longDrop*out.retMult&&f.rsi14<=rule.longRsi+out.rsiDelta;
      const sh=f.ret14d<0&&f.barDown&&f.ret24>=rule.shortRally*out.retMult&&f.rsi14>=rule.shortRsi-out.rsiDelta;
      if(!l&&!sh)continue;
      const side:1|-1=l?1:-1;
      const exit=simulateQuality102HighVolExit({bars:rows.slice(i+1,i+73),entryPrice:enter.open,side,hardStop:rule.hardStop});
      const score=30*m.winRate+10*Math.min(m.profitFactor,3)+200*Math.max(-.05,Math.min(.1,m.expectancy))+60*Math.min(Math.abs(f.ret24),.25)+30*Math.min(f.atrPct,.08)+2*Math.min(f.volumeRatio,3)+(symbol==="PENGUUSDT"?3:0);
      const event:Candidate={
        id:symbol+"|"+side+"|"+f.signalTs,symbol,side,signalTs:f.signalTs,entryTs:enter.timestampMs,score,hardStop:rule.hardStop,
        bars:[],netNormal:quality102NetFromGross(exit.grossReturn,exit.holdHours,QUALITY102_RESEARCH_COSTS.normal.perSide,QUALITY102_RESEARCH_COSTS.normal.fundingPerDay),
        netSevere:quality102NetFromGross(exit.grossReturn,exit.holdHours,QUALITY102_RESEARCH_COSTS.stress.perSide,QUALITY102_RESEARCH_COSTS.stress.fundingPerDay),
        exitTs:exit.exitTs,holdHours:exit.holdHours,exitReason:exit.exitReason,
      };
      out.candidates.push(event);out.candidateKeys.add(event.id);
    }
  }
}
if(validated<3||usable<3)throw Error("INSUFFICIENT_Q102_FROZEN_SYMBOL_PARITY:"+validated+":"+usable);
const base=outputs[0].candidateKeys;
const result=outputs.map(o=>{
  const byTs=new Map<number,Candidate[]>();
  for(const c of o.candidates){const bucket=byTs.get(c.entryTs)||[];bucket.push(c);byTs.set(c.entryTs,bucket);}
  const keys=[...byTs.keys()].sort((a,b)=>a-b);
  let nextEntryTs=0,equityN=1,equityS=1,peakN=1,peakS=1,ddN=0,ddS=0,n=0,wins=0,gains=0,losses=0;
  const trades:Array<{symbol:string,side:number,entryTs:number,exitTs:number,netNormal:number,exitReason:string}>=[];
  for(const ts of keys){
    if(ts<nextEntryTs)continue;
    const chosen=byTs.get(ts)!.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol))[0];
    const ret=chosen.netNormal;
    equityN*=(1+ret);equityS*=(1+chosen.netSevere);
    peakN=Math.max(peakN,equityN);peakS=Math.max(peakS,equityS);
    ddN=Math.min(ddN,equityN/peakN-1);ddS=Math.min(ddS,equityS/peakS-1);
    if(ret>0){wins++;gains+=ret}else losses+=ret;
    nextEntryTs=chosen.exitTs+H;
    trades.push({symbol:chosen.symbol,side:chosen.side,entryTs:chosen.entryTs,exitTs:chosen.exitTs,netNormal:ret,exitReason:chosen.exitReason});
    n++;
  }
  return {
    case:o.name,retThresholdMultiple:o.retMult,rsiDelta:o.rsiDelta,volumeMin:o.minimumVolume,
    symbolHourSignalCandidates:o.candidates.length,
    addedUnfilteredCandidateKeys:[...o.candidateKeys].filter(k=>!base.has(k)).length,
    isolatedSelectedTrades:n,positiveTrades:wins,isolatedWinRatePct:n?100*wins/n:null,
    isolatedNormalReturnPct:100*(equityN-1),isolatedSevereReturnPct:100*(equityS-1),
    isolatedNormalMaxDDPct:100*ddN,isolatedSevereMaxDDPct:100*ddS,
    isolatedNormalPF:losses<0?gains/-losses:null,
    exitReasons:Object.fromEntries([...new Set(trades.map(t=>t.exitReason))].map(t=>[t,trades.filter(x=>x.exitReason===t).length])),
    selectedKeys:trades.map(t=>t.symbol+"|"+t.side+"|"+t.entryTs),
  };
});
const report={
  schema:"q102-september-frozen-rule-sensitivity/v1",frozenLiveSHA:frozen.runtimeCommitSha,strictCurrentFeatureParity:true,
  source:"current live market-history.json and decision-ranking-snapshot.json",
  causalMonthlySelection:"September rule frozen from prior August training as present in live observer; no September retraining",
  sampleStart:new Date(sampleStart).toISOString(),sampleCutoff:new Date(cutoff).toISOString(),
  sourceSymbols:frozen.items.length,validatedLiveFeatureSymbols:validated,usableHistorySymbols:usable,invalidSymbols,skipped,
  caveats:"HIGH_VOL-only one-slot approximation, excludes PENGU correlation, S34 precedence, shared portfolio Gross, real orders, partial fills and out-of-month state. Historical small-sample outcomes are not the formal 5-logic BT.",
  outputs:result,safety:{liveChanged:false,ordersSent:0,protectiveOrdersChanged:0},
};
writeFileSync(process.env.Q102_RESEARCH_OUT||"q102-september-gate-sensitivity-20260926.json",JSON.stringify(report,null,2)+"\n");
console.log("Q102_SEPTEMBER_GATE_RESEARCH="+JSON.stringify({...report,outputs:result.map(({selectedKeys,...summary})=>summary)}));
