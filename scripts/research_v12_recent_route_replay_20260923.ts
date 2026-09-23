import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { buildV12Signals, resampleV12H1ToH2, type V12Bar, type V12Signal } from "../lib/v12-x1-all";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
const H=3600000;
const TARGETS=[1790100000000,1790114400000,1790121600000];
const START=Math.min(...TARGETS)-180*24*H, END=Math.max(...TARGETS)+8*H;
const SYMS=[...V12_X1_ALL.universe];
type P={bars:Record<string,V12Bar[]>;idx:Record<string,Map<number,number>>};
function prep(d:any):P{const bars:any={},idx:any={};for(const s of SYMS){bars[s]=resampleV12H1ToH2((d.bySymbol[s]||[]).map((x:any)=>({...x,closed:true})));idx[s]=new Map(bars[s].map((x:any,i:number)=>[x.ts,i]));}return{bars,idx};}
function routeFor(p:P,s:V12Signal,t:number){
 if(s.score>=V12_X1_ALL.neutralScoreThreshold)return "NORMAL_SCORE";
 const bi=p.idx.BTC?.get(t),si=p.idx[s.symbol]?.get(t),btc=p.bars.BTC,sb=p.bars[s.symbol];if(bi==null||si==null||!btc||!sb)return "UNKNOWN";
 const slice=btc.slice(bi-V12_X1_ALL.btcRegimeSmaBars+1,bi+1);if(slice.length!==V12_X1_ALL.btcRegimeSmaBars)return "UNKNOWN";
 const ma=slice.reduce((a,x)=>a+x.close,0)/slice.length,dist=btc[bi].close/ma-1,strong=Math.abs(dist)>=V12_X1_ALL.strongRegimeThresholdPct,atrRatio=s.atr/sb[si].close;
 if(strong&&s.score>=V12_X1_ALL.strongRegimeQualityScoreMinimum&&s.score<=V12_X1_ALL.strongRegimeQualityScoreMaximum&&atrRatio>=V12_X1_ALL.strongRegimeQualityMinimumAtrRatio)return "STRONG_REGIME_ALT";
 const aligned=s.side==="LONG"?s.momentum:-s.momentum;
 if(aligned>=V12_X1_ALL.relaxedRegimeMinimumMomentumPct&&atrRatio>=V12_X1_ALL.relaxedRegimeMinimumAtrRatio)return "RELAXED_MOMENTUM_ALT";
 return "UNKNOWN";
}
async function main(){const d=await loadPerpMarketData({symbols:SYMS,startTs:START,endTs:END});const p=prep(d);for(let i=0;i<p.bars.BTC.length;i++){const t=p.bars.BTC[i].ts;const ss=buildV12Signals(p.bars,i,V12_X1_ALL.maximumPositions);for(const s of ss){if(TARGETS.includes(s.referenceTs)){console.log(JSON.stringify({referenceTs:s.referenceTs,referenceIso:new Date(s.referenceTs).toISOString(),decisionBarTs:t,symbol:s.symbol,rank:s.rank,side:s.side,score:s.score,momentum:s.momentum,volumeRatio:s.volumeRatio,regime:s.regime,route:routeFor(p,s,t)}));}}}}
main().catch(e=>{console.error(e);process.exitCode=1});