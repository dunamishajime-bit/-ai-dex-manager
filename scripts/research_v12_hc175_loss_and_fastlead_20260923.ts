import fs from "fs/promises";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import type { PerpBar, PerpMarketData } from "../lib/research-lab/perp/types";
import {
  buildV12Signals,
  computeV12Regime,
  nextTrailingStop,
  protectiveLevels,
  resampleV12H1ToH2,
  sizeV12Position,
  type V12Bar,
  type V12Signal,
} from "../lib/v12-x1-all";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";

const H = 3_600_000;
const START = Date.parse("2025-08-10T00:00:00Z");
const END = Date.parse("2026-08-10T00:00:00Z");
const WARM = START - 180 * 24 * H;
const SYMS = [...V12_X1_ALL.universe];

type Prepared = { bars: Record<string,V12Bar[]>; idx: Record<string,Map<number,number>>; timeline:number[] };
type Route = "NORMAL_SCORE"|"STRONG_REGIME_ALT"|"RELAXED_MOMENTUM_ALT"|"EARLY_FAST_BTC"|"UNKNOWN";
type EntryFeatures = { score:number; momentum:number; volumeRatio:number; prevVolumeRatio:number; volume2Mean:number; atrRatio:number; ret2h:number; ret6h:number; ret12h:number; ret24h:number; btc6h:number; btc12h:number; btc24h:number; rel24h:number; eth12h:number; sol12h:number; breadth12:number; breadth24:number; breakout12:number; closePos:number; reclaim6:number; pullback6:number; rankGap:number };
type RoutedSignal = V12Signal & { route: Route; features: EntryFeatures };
type Position = {
  symbol:string; side:"LONG"|"SHORT"; entry:number; qty:number; entryFee:number; funding:number; lastFund:number;
  initialStop:number; stop:number; tp:number; trailingDistance:number; peak:number; trough:number; bars:number; rank:number; entryTs:number; route:Route; features:EntryFeatures; isHC:boolean;
};
type Variant = {
  name:string;
  fastBtcVeto?: "24h"|"12h24h"|"bothNegative";
  sameSymbolCooldownBars?: number;
  lossOnlyCooldownBars?: number;
  rank2MinScore?: number;
  breakoutConfirm?: boolean;
  ddDefense?: boolean;
  blockStrongAlt?: boolean;
  blockRelaxedAlt?: boolean;
  altMinScore?: number;
  altMinVolume?: number;
  altMinMomentum?: number;
  blockNormalScore?: boolean;
  relaxedMinScore?: number;
  relaxedMinVolume?: number;
  relaxedBtcBothNegativeVeto?: boolean;
  altMaxMomentum?: number;
  strongMaxMomentum?: number;
  relaxedMaxMomentum?: number;
  altMinAtrRatio?: number;
  altMinRet24?: number;
  altMinBtc24?: number;
  altMaxScore?: number;
  tpAtrOverride?: number;
  trailAtrOverride?: number;
  hcMinRet24?: number;
  hcMaxPrevVolume?: number;
  hcMinBtc24?: number;
  hcAltOnly?: boolean;
  hcMaxRankGap?: number;
  hcMaxRet2h?: number;
  hcOverlay?: boolean;
  hcPriority?: boolean;
  hcGrossMultiplier?: number;
  nonHcGrossMultiplier?: number;
  nonHcRank2Floor?: number;
  nonHcRank1Floor?: number;
  weakRank2Breakout?: boolean;
  nonHcSoftBreakout?: boolean;
  nonHcDdDefense?: "moderate"|"hard";
  earlyFast?: {btc6:number;btc12:number;minScore:number;minSymbol6:number};
  lowRank2BtcPairVeto?:boolean;
  nonHcLossCooldownBars?:number;
};
type Mode = { name:string; feeBps:number; slipBps:number };

// HC is a locked 1.75x multiplier in every candidate; never remove its entry conditions.
const LOCKED = {hcOverlay:true,hcPriority:true,hcGrossMultiplier:1.75,nonHcGrossMultiplier:1} as const;
// HC 1.75x frozen in ALL variants. Exploratory early-route parameters require independent validation.
const LOCKED={hcOverlay:true,hcPriority:true,hcGrossMultiplier:1.75,nonHcGrossMultiplier:1} as const;
const variants:Variant[]=[
  {name:"HC175_LOCKED",...LOCKED},
  {name:"HC175_LOSS6H",...LOCKED,lossOnlyCooldownBars:3},
  {name:"HC175_LOSS6H_NONHC",...LOCKED,nonHcLossCooldownBars:3},
  {name:"HC175_WEAK_RANK2_BAD_BTC",...LOCKED,lowRank2BtcPairVeto:true},
  {name:"HC175_LOSS6H_WEAK_RANK2_BAD_BTC",...LOCKED,lossOnlyCooldownBars:3,lowRank2BtcPairVeto:true},
  {name:"HC175_EARLY_004_008_SCORE035",...LOCKED,earlyFast:{btc6:.004,btc12:.008,minScore:.35,minSymbol6:0}},
  {name:"HC175_EARLY_007_012_SCORE045",...LOCKED,earlyFast:{btc6:.007,btc12:.012,minScore:.45,minSymbol6:.003}},
  {name:"HC175_EARLY_010_015_SCORE055",...LOCKED,earlyFast:{btc6:.010,btc12:.015,minScore:.55,minSymbol6:.005}},
  {name:"HC175_EARLY_007_012_SCORE045_LOSS6H",...LOCKED,lossOnlyCooldownBars:3,earlyFast:{btc6:.007,btc12:.012,minScore:.45,minSymbol6:.003}},
  {name:"HC175_EARLY_007_012_SCORE045_LOW_RANK2_BTC",...LOCKED,lowRank2BtcPairVeto:true,earlyFast:{btc6:.007,btc12:.012,minScore:.45,minSymbol6:.003}},
];
const modes: Mode[] = [
  { name:"NORMAL", feeBps:5, slipBps:0 },
  { name:"SEVERE", feeBps:10, slipBps:5 },
];

function prep(d:PerpMarketData): Prepared {
  const bars:Record<string,V12Bar[]> = {};
  const idx:Record<string,Map<number,number>> = {};
  for (const s of SYMS) {
    const raw=(d.bySymbol[s]||[]).map(x=>({ts:x.ts,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume,closed:true}));
    bars[s]=resampleV12H1ToH2(raw);
    idx[s]=new Map(bars[s].map((x,i)=>[x.ts,i]));
  }
  return { bars, idx, timeline:(bars.BTC||[]).map(x=>x.ts) };
}
function firstFunding(a:{ts:number;rate:number}[],ts:number){let l=0,r=a.length;while(l<r){const m=(l+r)>>1;if(a[m].ts<=ts)l=m+1;else r=m;}return l;}
function funding(a:{ts:number;rate:number}[],from:number,to:number){let i=firstFunding(a,from),x=0;for(;i<a.length&&a[i].ts<=to;i++)x+=a[i].rate;return x;}
function pf(xs:number[]){const gp=xs.filter(x=>x>0).reduce((a,b)=>a+b,0);const gl=-xs.filter(x=>x<0).reduce((a,b)=>a+b,0);return gl?gp/gl:gp?99:0;}
function monthlyDepositSchedule(){
  const out:number[]=[]; const d=new Date(START);
  for(let n=1;n<=12;n++){const x=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n,d.getUTCDate()));out.push(x.getTime());}
  return out;
}
function ret(b:V12Bar[],i:number,n:number){return i>=n?b[i].close/b[i-n].close-1:NaN;}
function breakoutPass(p:Prepared,s:V12Signal,t:number){
  const i=p.idx[s.symbol]?.get(t); const b=p.bars[s.symbol]; if(i==null||!b||i<18)return false;
  const prior=b.slice(i-18,i);
  if(s.side==="LONG"){const h=Math.max(...prior.map(x=>x.high));return b[i].close>=h*(1+V12_X1_ALL.breakoutBufferPct);}
  const l=Math.min(...prior.map(x=>x.low));return b[i].close<=l*(1-V12_X1_ALL.breakoutBufferPct);
}
function fastBtcPass(p:Prepared,s:V12Signal,t:number,mode:Variant["fastBtcVeto"]){
  if(!mode)return true; const i=p.idx.BTC?.get(t); const b=p.bars.BTC; if(i==null||!b)return false;
  const r24=ret(b,i,12); const r12=ret(b,i,6);
  if(!Number.isFinite(r24)||!Number.isFinite(r12))return false;
  if(mode==="bothNegative"){
    if(s.side==="LONG") return !(r24<0 && r12<0);
    return !(r24>0 && r12>0);
  }
  if(s.side==="LONG") return mode==="24h" ? r24>=0 : (r24>=0 && r12>=0);
  return mode==="24h" ? r24<=0 : (r24<=0 && r12<=0);
}
function entryFeatures(p:Prepared,s:V12Signal,t:number):EntryFeatures{
  const si=p.idx[s.symbol]?.get(t), bi=p.idx.BTC?.get(t), sb=p.bars[s.symbol], bb=p.bars.BTC;
  if(si==null||bi==null||!sb||!bb) throw new Error("FEATURE_INDEX_MISSING");
  const side=s.side==="LONG"?1:-1;
  const r=(b:V12Bar[],i:number,n:number)=>i>=n?b[i].close/b[i-n].close-1:NaN;
  const vrAt=(b:V12Bar[],i:number)=>{if(i<20)return NaN;const m=b.slice(i-20,i).reduce((a,x)=>a+x.volume,0)/20;return m>0?b[i].volume/m:NaN;};
  const prior12=sb.slice(Math.max(0,si-12),si);
  const priorHigh=prior12.length?Math.max(...prior12.map(x=>x.high)):sb[si].high;
  const priorLow=prior12.length?Math.min(...prior12.map(x=>x.low)):sb[si].low;
  const range=Math.max(1e-12,sb[si].high-sb[si].low);
  const rawPos=(sb[si].close-sb[si].low)/range;
  const sym24=r(sb,si,12), btc24=r(bb,bi,12);
  const prevVr=vrAt(sb,si-1);
  const eth=p.bars.ETH, sol=p.bars.SOL, ei=p.idx.ETH?.get(t), soi=p.idx.SOL?.get(t);
  const eth12=ei==null||!eth?NaN:side*r(eth,ei,6), sol12=soi==null||!sol?NaN:side*r(sol,soi,6);
  const btc12=side*r(bb,bi,6);
  const eth24=ei==null||!eth?NaN:side*r(eth,ei,12), sol24=soi==null||!sol?NaN:side*r(sol,soi,12);
  const vals12=[btc12,eth12,sol12].filter(Number.isFinite), vals24=[side*btc24,eth24,sol24].filter(Number.isFinite);
  const swing=sb.slice(Math.max(0,si-7),Math.max(0,si-1));
  const prev=si>=1?sb[si-1]:sb[si];
  const levelHigh=swing.length?Math.max(...swing.map(x=>x.high)):prev.high;
  const levelLow=swing.length?Math.min(...swing.map(x=>x.low)):prev.low;
  const reclaim6=s.side==="LONG"
    ? (prev.low<=levelHigh*1.005 && sb[si].close>levelHigh && sb[si].close>prev.high?1:0)
    : (prev.high>=levelLow*0.995 && sb[si].close<levelLow && sb[si].close<prev.low?1:0);
  const pullback6=s.side==="LONG"?(prev.close/levelHigh-1):(levelLow/prev.close-1);
  return {
    score:s.score,momentum:side*s.momentum,volumeRatio:s.volumeRatio,prevVolumeRatio:prevVr,volume2Mean:(s.volumeRatio+prevVr)/2,atrRatio:s.atr/sb[si].close,
    ret2h:side*r(sb,si,1),ret6h:side*r(sb,si,3),ret12h:side*r(sb,si,6),ret24h:side*sym24,
    btc6h:side*r(bb,bi,3),btc12h:btc12,btc24h:side*btc24,rel24h:side*(sym24-btc24),
    eth12h:eth12,sol12h:sol12,breadth12:vals12.length?vals12.filter(x=>x>0).length/vals12.length:0,
    breadth24:vals24.length?vals24.filter(x=>x>0).length/vals24.length:0,
    breakout12:s.side==="LONG"?sb[si].close/priorHigh-1:priorLow/sb[si].close-1,
    closePos:s.side==="LONG"?rawPos:1-rawPos,reclaim6,pullback6,rankGap:0,
  };
}
function routeFor(p:Prepared,s:V12Signal,t:number):Route{
  if(s.score>=V12_X1_ALL.neutralScoreThreshold)return "NORMAL_SCORE";
  const bi=p.idx.BTC?.get(t), btc=p.bars.BTC, si=p.idx[s.symbol]?.get(t), sb=p.bars[s.symbol];
  if(bi==null||!btc||si==null||!sb)return "UNKNOWN";
  const slice=btc.slice(bi-V12_X1_ALL.btcRegimeSmaBars+1,bi+1);
  if(slice.length!==V12_X1_ALL.btcRegimeSmaBars)return "UNKNOWN";
  const ma=slice.reduce((a,x)=>a+x.close,0)/slice.length;
  const dist=btc[bi].close/ma-1;
  const strong=Math.abs(dist)>=V12_X1_ALL.strongRegimeThresholdPct;
  const atrRatio=s.atr/sb[si].close;
  if(strong && s.score>=V12_X1_ALL.strongRegimeQualityScoreMinimum && s.score<=V12_X1_ALL.strongRegimeQualityScoreMaximum && atrRatio>=V12_X1_ALL.strongRegimeQualityMinimumAtrRatio)return "STRONG_REGIME_ALT";
  const aligned=s.side==="LONG"?s.momentum:-s.momentum;
  if(aligned>=V12_X1_ALL.relaxedRegimeMinimumMomentumPct && atrRatio>=V12_X1_ALL.relaxedRegimeMinimumAtrRatio)return "RELAXED_MOMENTUM_ALT";
  return "UNKNOWN";
}
// Research-only fast-side candidate, re-derived from frozen causal momentum/ATR/score equation.
// Build ONLY when BTC's 6h and 12h confirmed direction differs from its slow 53/52 regime.
function earlyFastSignals(p:Prepared,t:number,v:Variant):RoutedSignal[]{
  const opt=v.earlyFast;if(!opt)return [];
  const bi=p.idx.BTC?.get(t),bb=p.bars.BTC;
  if(bi==null||!bb||bi<60)return [];
  const r6=ret(bb,bi,3),r12=ret(bb,bi,6);
  if(!Number.isFinite(r6)||!Number.isFinite(r12))return [];
  const fastSide=r6>=opt.btc6&&r12>=opt.btc12?"LONG":r6<=-opt.btc6&&r12<=-opt.btc12?"SHORT":null;
  if(!fastSide||computeV12Regime(bb,bi)===fastSide)return [];
  const directional=fastSide==="LONG"?1:-1;
  const candidates: RoutedSignal[]=[];
  for(const symbol of SYMS){
    const i=p.idx[symbol]?.get(t),b=p.bars[symbol];
    if(i==null||!b||i<Math.max(V12_X1_ALL.momentumBars,V12_X1_ALL.atrBars,22))continue;
    const base=b[i-V12_X1_ALL.momentumBars],last=b[i];
    if(!base||!last||base.close<=0||last.close<=0)continue;
    const momentum=last.close/base.close-1;
    if(Math.sign(momentum)!==directional||directional*momentum<V12_X1_ALL.minimumMomentumPct)continue;
    const s6=ret(b,i,3)*directional;
    if(s6<opt.minSymbol6)continue;
    const vol20=b.slice(i-20,i).reduce((sum,x)=>sum+x.volume,0)/20;
    const vr=vol20>0?last.volume/vol20:NaN;
    if(!(vr>=V12_X1_ALL.minimumVolumeRatio))continue;
    const logs:number[]=[];
    for(let j=i-V12_X1_ALL.volatilityLookbackBars+1;j<=i;j++){
      if(!b[j]||!b[j-1]||b[j-1].close<=0){logs.length=0;break;}
      logs.push(Math.log(b[j].close/b[j-1].close));
    }
    if(logs.length!==V12_X1_ALL.volatilityLookbackBars)continue;
    const mean=logs.reduce((sum,x)=>sum+x,0)/logs.length;
    const vol=Math.sqrt(logs.reduce((sum,x)=>sum+(x-mean)**2,0)/(logs.length-1));
    let ar=0,good=true;
    for(let j=i-V12_X1_ALL.atrBars+1;j<=i;j++){
      const x=b[j],prev=b[j-1];if(!x||!prev){good=false;break;}
      ar+=Math.max(x.high-x.low,Math.abs(x.high-prev.close),Math.abs(x.low-prev.close));
    }
    if(!good)continue;
    const currentAtr=ar/V12_X1_ALL.atrBars,atrRatio=currentAtr/last.close;
    if(!(atrRatio>=.014))continue;
    const raw=momentum/Math.max(.0001,vol*Math.sqrt(V12_X1_ALL.momentumBars));
    const score=directional*raw/(1+V12_X1_ALL.volatilityPenalty*vol*100);
    if(score<opt.minScore)continue;
    const s:V12Signal={symbol,side:fastSide,momentum,volatility:vol,atr:currentAtr,volumeRatio:vr,score,
      referenceTs:last.endTs,entryTs:b[i+1]?.ts||last.endTs,regime:fastSide,rank:1};
    candidates.push({...s,route:"EARLY_FAST_BTC",features:entryFeatures(p,s,t)});
  }
  candidates.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol));
  if(candidates[0]){candidates[0].rank=1;return [candidates[0]];}
  return [];
}
function variantSignals(p:Prepared,t:number,v:Variant,currentDd:number){
  const i=p.idx.BTC?.get(t); if(i==null)return [] as RoutedSignal[];
  const rawSignals=buildV12Signals(p.bars,i,V12_X1_ALL.maximumPositions);
  let ss=rawSignals.map((s,idx)=>{
    const features=entryFeatures(p,s,t);
    const next=rawSignals[idx+1];
    features.rankGap=next?Math.max(0,s.score-next.score):Math.max(0,s.score);
    return {...s,route:routeFor(p,s,t),features};
  }) as RoutedSignal[];
  ss=ss.filter(s=>fastBtcPass(p,s,t,v.fastBtcVeto));
  if(v.hcMinRet24!=null) ss=ss.filter(s=>s.features.ret24h>=v.hcMinRet24!);
  if(v.hcMaxPrevVolume!=null) ss=ss.filter(s=>s.features.prevVolumeRatio<=v.hcMaxPrevVolume!);
  if(v.hcMinBtc24!=null) ss=ss.filter(s=>s.features.btc24h>=v.hcMinBtc24!);
  if(v.hcMaxRankGap!=null) ss=ss.filter(s=>s.features.rankGap<=v.hcMaxRankGap!);
  if(v.hcMaxRet2h!=null) ss=ss.filter(s=>s.features.ret2h<=v.hcMaxRet2h!);
  if(v.hcAltOnly) ss=ss.filter(s=>s.route!=="NORMAL_SCORE");
  if(v.breakoutConfirm) ss=ss.filter(s=>breakoutPass(p,s,t));
  if(v.rank2MinScore!=null) ss=ss.filter(s=>s.rank!==2 || s.score>=v.rank2MinScore!);
  if(v.blockStrongAlt) ss=ss.filter(s=>s.route!=="STRONG_REGIME_ALT");
  if(v.blockRelaxedAlt) ss=ss.filter(s=>s.route!=="RELAXED_MOMENTUM_ALT");
  if(v.blockNormalScore) ss=ss.filter(s=>s.route!=="NORMAL_SCORE");
  ss=ss.filter(s=>{
    if(s.route==="NORMAL_SCORE")return true;
    if(s.route==="RELAXED_MOMENTUM_ALT"){
      if(v.relaxedMinScore!=null && s.score<v.relaxedMinScore)return false;
      if(v.relaxedMinVolume!=null && s.volumeRatio<v.relaxedMinVolume)return false;
      if(v.relaxedBtcBothNegativeVeto && !fastBtcPass(p,s,t,"bothNegative"))return false;
    }
    if(v.altMinScore!=null && s.score<v.altMinScore)return false;
    if(v.altMinVolume!=null && s.volumeRatio<v.altMinVolume)return false;
    const aligned=s.side==="LONG"?s.momentum:-s.momentum;
    if(v.altMinMomentum!=null && aligned<v.altMinMomentum)return false;
    if(v.altMaxMomentum!=null && aligned>v.altMaxMomentum)return false;
    if(v.altMinAtrRatio!=null && s.features.atrRatio<v.altMinAtrRatio)return false;
    if(v.altMinRet24!=null && s.features.ret24h<v.altMinRet24)return false;
    if(v.altMinBtc24!=null && s.features.btc24h<v.altMinBtc24)return false;
    if(v.altMaxScore!=null && s.score>v.altMaxScore)return false;
    if(s.route==="STRONG_REGIME_ALT" && v.strongMaxMomentum!=null && aligned>v.strongMaxMomentum)return false;
    if(s.route==="RELAXED_MOMENTUM_ALT" && v.relaxedMaxMomentum!=null && aligned>v.relaxedMaxMomentum)return false;
    return true;
  });
  if(v.ddDefense){
    if(currentDd>=5) ss=ss.filter(s=>s.rank===1 && s.score>=0.45);
    else if(currentDd>=4) ss=ss.filter(s=>s.rank===1);
  }
  if(v.lowRank2BtcPairVeto)ss=ss.filter(s=>highConfidence(s)||s.rank!==2||s.score>=.35||fastBtcPass(p,s,t,"bothNegative"));
  if(v.nonHcRank2Floor!=null) ss=ss.filter(s=>highConfidence(s)||s.rank!==2||s.score>=v.nonHcRank2Floor!);
  if(v.nonHcRank1Floor!=null) ss=ss.filter(s=>highConfidence(s)||s.rank!==1||s.score>=v.nonHcRank1Floor!);
  if(v.weakRank2Breakout) ss=ss.filter(s=>highConfidence(s)||s.rank!==2||s.score>=0.35||s.features.breakout12>=0||s.features.reclaim6>=1);
  if(v.nonHcSoftBreakout) ss=ss.filter(s=>highConfidence(s)||s.features.breakout12>=0||s.features.reclaim6>=1);
  // Study-only: currentDd is isolated V12 simulated DD, not live shared portfolio DD.
  if(v.nonHcDdDefense==="moderate"){
    if(currentDd>=5)ss=ss.filter(s=>highConfidence(s)||(s.rank===1&&s.score>=0.35));
    else if(currentDd>=4)ss=ss.filter(s=>highConfidence(s)||s.rank!==2);
  }
  if(v.nonHcDdDefense==="hard"&&currentDd>=4)ss=ss.filter(s=>highConfidence(s));
  if(v.earlyFast){const lead=earlyFastSignals(p,t,v);if(lead.length)ss=[...ss,...lead].filter((s,i,all)=>all.findIndex(x=>x.symbol===s.symbol&&x.side===s.side)===i);}
  return ss;
}

function highConfidence(s:RoutedSignal):boolean {
  const f=s.features;
  return f.ret24h>=0.018 && f.prevVolumeRatio<=0.80 && f.btc24h>=0.020;
}
function simulate(d:PerpMarketData,p:Prepared,v:Variant,m:Mode){
  const fee=m.feeBps/10000, slip=m.slipBps/10000;
  const times=p.timeline.filter(t=>t>=START&&t<END);
  const deposits=monthlyDepositSchedule(); let depI=0;
  let cash=10000, contributed=10000, peak=10000, maxDd=0;
  const pos=new Map<string,Position>(); const pending=new Map<string,RoutedSignal>(); const cool=new Map<string,number>(); const nonHcCooldown=new Map<string,number>();
  const pnls:number[]=[]; const tradeRows:any[]=[]; let entries=0, rank2Entries=0, filtered=0, winsFiltered=0, maxEntryGross=0, hcEntries=0,nonHcEntries=0;
  const px=(s:string,t:number,f:"open"|"close"="close")=>{const i=p.idx[s]?.get(t);return i==null?undefined:p.bars[s]?.[i]?.[f];};
  const equity=(t:number,f:"open"|"close"="close")=>{let e=cash;for(const q of pos.values()){const x=px(q.symbol,t,f)??q.entry;const dir=q.side==="LONG"?1:-1;e+=dir*q.qty*(x-q.entry)-q.qty*x*fee;}return Math.max(0,e);};
  const gross=(t:number)=>{const e=Math.max(1,equity(t));let n=0;for(const q of pos.values())n+=q.qty*(px(q.symbol,t)??q.entry);return n/e;};
  const close=(q:Position,raw:number,reason:string,t:number)=>{
    const x=q.side==="LONG"?raw*(1-slip):raw*(1+slip);const dir=q.side==="LONG"?1:-1;
    const g=dir*q.qty*(x-q.entry),ef=q.qty*x*fee,net=g-q.entryFee-ef-q.funding;
    cash=Math.max(0,cash+g-ef);pnls.push(net);tradeRows.push({symbol:q.symbol,rank:q.rank,route:q.route,entryTs:q.entryTs,exitTs:t,net,pct:(x/q.entry-1)*100*dir,reason,isHC:q.isHC,...q.features});
    pos.delete(q.symbol);
    const coolBars = v.lossOnlyCooldownBars && net < 0
      ? v.lossOnlyCooldownBars
      : (v.sameSymbolCooldownBars ?? V12_X1_ALL.cooldownBars);
    cool.set(q.symbol,t+coolBars*V12_X1_ALL.timeframeHours*H);
    if(net<0&&v.nonHcLossCooldownBars)nonHcCooldown.set(q.symbol,t+v.nonHcLossCooldownBars*V12_X1_ALL.timeframeHours*H);
  };
  for(const t of times){
    while(depI<deposits.length&&deposits[depI]<=t){cash+=10000;contributed+=10000;peak+=10000;depI++;}
    for(const [s,sig] of [...pending]){
      if(pos.has(s)||(cool.get(s)||0)>t||((nonHcCooldown.get(s)||0)>t&&!highConfidence(sig))){pending.delete(s);continue;}
      const raw=px(s,t,"open");if(!raw){pending.delete(s);continue;}
      const e=equity(t,"open"),entry=sig.side==="LONG"?raw*(1+slip):raw*(1-slip);
      const sz=sizeV12Position(e,entry,sig.atr,sig.side); const active=[...pos.values()].reduce((n,q)=>n+q.qty*(px(q.symbol,t,"open")??q.entry),0);
      const cap=Math.max(0,e*V12_X1_ALL.dynamicResidualAggregateGrossCap-active);
      const isHC=highConfidence(sig);
      const mult=v.hcOverlay?(isHC?(v.hcGrossMultiplier??1):(v.nonHcGrossMultiplier??1)):1;
      // Keep rank3's original 0.10x ceiling. Boost rank1/2 only within the unchanged aggregate cap.
      const rankCap=e*(sig.rank===3?V12_X1_ALL.rank3EntryGrossCap* Math.min(1,mult):V12_X1_ALL.perPositionEntryGrossCap*mult);
      const notional=Math.min(sz.requestedNotional*mult,rankCap,cap);
      if(notional/e<0.05){pending.delete(s);continue;}
      const qty=notional/entry,entryFee=notional*fee,levels=protectiveLevels(entry,sig.atr,sig.side);
      const tpAtr=v.tpAtrOverride??V12_X1_ALL.takeProfitAtr;
      const tp=sig.side==="LONG"?entry+sig.atr*tpAtr:entry-sig.atr*tpAtr;
      const trailingDistance=sig.atr*(v.trailAtrOverride??V12_X1_ALL.trailingAtr);
      cash-=entryFee;pos.set(s,{symbol:s,side:sig.side,entry,qty,entryFee,funding:0,lastFund:t,initialStop:levels.initialStop,stop:levels.initialStop,tp,trailingDistance,peak:entry,trough:entry,bars:0,rank:sig.rank,entryTs:t,route:sig.route,features:sig.features,isHC});
      maxEntryGross=Math.max(maxEntryGross,(active+notional)/e);
      if(isHC)hcEntries++;else nonHcEntries++;
      entries++;if(sig.rank===2)rank2Entries++;pending.delete(s);
    }
    for(const q of [...pos.values()]){
      const i=p.idx[q.symbol]?.get(t),b=i==null?undefined:p.bars[q.symbol]?.[i];if(!b)continue;
      q.bars++;const fr=funding(d.fundingBySymbol[q.symbol]||[],q.lastFund,t);const fc=q.qty*q.entry*fr*(q.side==="LONG"?1:-1);q.funding+=fc;q.lastFund=t;cash-=fc;
      if(q.side==="LONG"){if(b.low<=q.stop){close(q,q.stop,q.stop>q.initialStop?"trail":"stop",t);continue;}if(b.high>=q.tp){close(q,q.tp,"tp",t);continue;}}
      else{if(b.high>=q.stop){close(q,q.stop,q.stop<q.initialStop?"trail":"stop",t);continue;}if(b.low<=q.tp){close(q,q.tp,"tp",t);continue;}}
      q.peak=Math.max(q.peak,b.high);q.trough=Math.min(q.trough,b.low);q.stop=nextTrailingStop(q.side,q.stop,q.side==="LONG"?q.peak:q.trough,q.trailingDistance);
      if(q.bars>=V12_X1_ALL.maxHoldBars){close(q,b.close,"max-hold",t);continue;}
    }
    const e=equity(t);peak=Math.max(peak,e);const dd=peak>0?(peak-e)/peak*100:0;maxDd=Math.max(maxDd,dd);
    const baseI=p.idx.BTC?.get(t); const base=baseI==null?[]:buildV12Signals(p.bars,baseI,V12_X1_ALL.maximumPositions);
    const ss=variantSignals(p,t,v,dd);
    if(v.hcPriority) ss.sort((a,b)=>Number(highConfidence(b))-Number(highConfidence(a)) || a.rank-b.rank);
    filtered += Math.max(0,base.length-ss.length);
    let slots=Math.max(0,V12_X1_ALL.maximumPositions-pos.size-pending.size);
    for(const s of ss){if(slots<=0)break;if(pos.has(s.symbol)||pending.has(s.symbol)||(cool.get(s.symbol)||0)>t||((nonHcCooldown.get(s.symbol)||0)>t&&!highConfidence(s)))continue;
      if(s.route==="EARLY_FAST_BTC"&&[...pos.values()].some(q=>q.side!==s.side))continue;pending.set(s.symbol,s);slots--;}
  }
  while(depI<deposits.length&&deposits[depI]<=END){cash+=10000;contributed+=10000;depI++;}
  for(const q of [...pos.values()]){const b=p.bars[q.symbol];const last=b?.filter(x=>x.ts<END).at(-1);if(last)close(q,last.close,"end",END);}
  const gp=pnls.filter(x=>x>0).reduce((a,b)=>a+b,0),gl=-pnls.filter(x=>x<0).reduce((a,b)=>a+b,0);
  const routeStats=Object.fromEntries((["NORMAL_SCORE","STRONG_REGIME_ALT","RELAXED_MOMENTUM_ALT","EARLY_FAST_BTC","UNKNOWN"] as Route[]).map(route=>{
    const xs=tradeRows.filter(x=>x.route===route), rgp=xs.filter(x=>x.net>0).reduce((a,x)=>a+x.net,0), rgl=-xs.filter(x=>x.net<0).reduce((a,x)=>a+x.net,0);
    return [route,{tradeCount:xs.length,winRatePct:xs.length?xs.filter(x=>x.net>0).length/xs.length*100:0,profitFactor:rgl?rgp/rgl:rgp?99:0,netPnl:xs.reduce((a,x)=>a+x.net,0),avgPct:xs.length?xs.reduce((a,x)=>a+x.pct,0)/xs.length:0}];
  }));
  const hcRows=tradeRows.filter(x=>x.isHC), nonHcRows=tradeRows.filter(x=>!x.isHC);
  const subgroup=(xs:any[])=>{
    const win=xs.filter(x=>x.net>0), gp=win.reduce((a,x)=>a+x.net,0);
    const gl=-xs.filter(x=>x.net<0).reduce((a,x)=>a+x.net,0);
    return {trades:xs.length,winRatePct:xs.length?100*win.length/xs.length:0,pf:gl?gp/gl:gp?99:0,netPnl:xs.reduce((a,x)=>a+x.net,0)};
  };
  return {
    hcStats:subgroup(hcRows),nonHcStats:subgroup(nonHcRows),maxEntryGross,hcEntries,nonHcEntries,
    finalEquity:cash,contributed,netProfit:cash-contributed,returnOnContributionPct:(cash/contributed-1)*100,
    maxDrawdownPct:maxDd,profitFactor:gl?gp/gl:gp?99:0,winRatePct:pnls.length?pnls.filter(x=>x>0).length/pnls.length*100:0,
    tradeCount:pnls.length,entries,rank2Entries,filteredSignals:filtered,averageTradePct:tradeRows.length?tradeRows.reduce((a,x)=>a+x.pct,0)/tradeRows.length:0,
    grossAtEnd:gross(END-H),routeStats, losses:tradeRows.filter(x=>x.net<0).sort((a,b)=>a.net-b.net).slice(0,10),
    trades: ["HC175_LOCKED","HC175_EARLY_004_008_SCORE035","HC175_EARLY_007_012_SCORE045","HC175_EARLY_010_015_SCORE055"].includes(v.name)?tradeRows:undefined,
  };
}

async function main(){
  const d=await loadPerpMarketData({symbols:SYMS,startTs:WARM,endTs:END+4*H});
  const p=prep(d); const results:any={};
  for(const v of variants){results[v.name]={};for(const m of modes)results[v.name][m.name]=simulate(d,p,v,m);}
  const rows=variants.map(v=>({variant:v.name,...results[v.name]}));
  const out={status:"PASS_RESEARCH_ONLY_HC175_LOCKED",limitations:["V12 research simulator only; no PENGU/Q102/V52/FET shared gross replay","DD defense uses isolated V12 DD not live shared portfolio DD","Locked HC condition ret24h>=1.8%, prevVol<=0.80, directional BTC24h>=2.0%; HC weight 1.75, unchanged aggregate gross 2.0x"],period:{start:new Date(START).toISOString(),end:new Date(END).toISOString()},conditions:{initialJpy:10000,monthlyJpy:10000,monthlyCount:12,totalContributionJpy:130000},productionConstants:V12_X1_ALL,dataSource:d.source,variants,results,rankingNormal:[...rows].sort((a,b)=>b.NORMAL.profitFactor-a.NORMAL.profitFactor).map(x=>x.variant)};
  await fs.mkdir(".research-state/v12-winrate-gates-20260923",{recursive:true});
  await fs.writeFile(".research-state/v12-winrate-gates-20260923/result.json",JSON.stringify(out,null,2)+"\n");
  console.log(JSON.stringify(out));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
