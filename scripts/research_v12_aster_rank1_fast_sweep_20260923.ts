import fs from "fs/promises";
import { AsterV3Client, type AsterKline } from "../lib/aster-v3-client";
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
const WARM = START - 14 * 24 * H;
const SYMS = [...V12_X1_ALL.universe];

type Prepared = { bars: Record<string,V12Bar[]>; idx: Record<string,Map<number,number>>; timeline:number[] };
type Route = "NORMAL_SCORE"|"STRONG_REGIME_ALT"|"RELAXED_MOMENTUM_ALT"|"EARLY_FAST_BTC"|"UNKNOWN";
type EntryFeatures = { score:number; momentum:number; volumeRatio:number; prevVolumeRatio:number; volume2Mean:number; atrRatio:number; ret2h:number; ret6h:number; ret12h:number; ret24h:number; btc6h:number; btc12h:number; btc24h:number; btcEr12:number; btcEr24:number; rel24h:number; eth12h:number; sol12h:number; breadth12:number; breadth24:number; breakout12:number; closePos:number; reclaim6:number; pullback6:number; rankGap:number };
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
  marketMode?: "ER_CHOP"|"STATE_BLOCK"|"STATE_SIZE075";
  clusterPauseBars?: number;
  clusterWindowBars?: number;
  clusterTrendRecovery?: boolean;
  narrowMode?: "ER_BLOCK"|"ER_HALF"|"LAG6_BLOCK"|"LAG6_HALF"|"WEAK_BLOCK"|"WEAK_HALF"|"ERLAG_BLOCK"|"ERLAG_HALF"|"ANY_BLOCK"|"ANY_HALF";
  noTrend?: {er12Max:number; er24Max?:number; requireBtc12Adverse?:boolean; requireBtc6OrSymbolWeak?:boolean; symbol6Max?:number; includeBurst?:boolean; burstEr12Max?:number; combineAnyWeak?:boolean; minScore?:number};
  rank1FastBlock?: {er12Max:number; symbol6Max?:number; rel24Max?:number; scoreMax?:number};
};
type Mode = { name:string; feeBps:number; slipBps:number };

// HC is a locked 1.75x multiplier in every candidate; never remove its entry conditions.
// HC 1.75x frozen in ALL variants. Exploratory early-route parameters require independent validation.
const LOCKED={hcOverlay:true,hcPriority:true,hcGrossMultiplier:1.75,nonHcGrossMultiplier:1} as const;
const variants:Variant[]=[
  {name:"HC175_LOCKED",...LOCKED},
  {name:"FALSEBURST80_ONLY",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80}},
  {name:"FB80_R1_ER06",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80},rank1FastBlock:{er12Max:.06}},
  {name:"FB80_R1_ER07",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80},rank1FastBlock:{er12Max:.07}},
  {name:"FB80_R1_ER08",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80},rank1FastBlock:{er12Max:.08}},
  {name:"FB80_R1_ER10",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80},rank1FastBlock:{er12Max:.10}},
  {name:"FB80_R1_ER12",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80},rank1FastBlock:{er12Max:.12}},
  {name:"FB80_R1_ER15",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80},rank1FastBlock:{er12Max:.15}},
  {name:"FB80_R1_ER08_SYM10",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80},rank1FastBlock:{er12Max:.08,symbol6Max:.01}},
  {name:"FB80_R1_ER10_SYM10",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80},rank1FastBlock:{er12Max:.10,symbol6Max:.01}},
  {name:"FB80_R1_ER12_SYM10",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80},rank1FastBlock:{er12Max:.12,symbol6Max:.01}},
  {name:"FB80_R1_ER08_REL10",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80},rank1FastBlock:{er12Max:.08,rel24Max:.01}},
  {name:"FB80_R1_ER10_REL10",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80},rank1FastBlock:{er12Max:.10,rel24Max:.01}},
  {name:"FB80_R1_ER08_SYM10_REL10",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80},rank1FastBlock:{er12Max:.08,symbol6Max:.01,rel24Max:.01}},
  {name:"FB80_R1_ER10_SYM12_REL12_SCORE70",...LOCKED,noTrend:{er12Max:0,includeBurst:true,burstEr12Max:.80},rank1FastBlock:{er12Max:.10,symbol6Max:.012,rel24Max:.012,scoreMax:.70}},
];
const modes: Mode[] = [
  { name:"NORMAL", feeBps:5, slipBps:0 },
  { name:"SEVERE", feeBps:10, slipBps:5 },
];

function parseAsterH1(row:AsterKline){
  const ts=Number(row[0]),open=Number(row[1]),high=Number(row[2]),low=Number(row[3]),close=Number(row[4]),volume=Number(row[5]);
  if(![ts,open,high,low,close,volume].every(Number.isFinite)||ts%H!==0||!(open>0&&high>=low&&low>0&&close>0&&volume>=0))return null;
  return {ts,open,high,low,close,volume};
}
async function fetchAsterH1(client:AsterV3Client,symbol:string,startTs:number,endTs:number){
  const out:any[]=[]; let cursor=startTs; const limit=1000;
  while(cursor<endTs){
    const rows=await client.getKlines(`${symbol}USDT`,"1h",limit,{startTime:cursor,endTime:endTs-1});
    if(!rows.length)break;
    for(const row of rows){const x=parseAsterH1(row);if(x&&x.ts>=startTs&&x.ts<endTs)out.push(x);}
    const last=Math.max(...rows.map(r=>Number(r[0])).filter(Number.isFinite));
    const next=last+H;if(!(next>cursor))break;cursor=next;
    if(rows.length<limit)break;
    await new Promise(r=>setTimeout(r,120));
  }
  const uniq=new Map(out.map(x=>[x.ts,x]));
  return [...uniq.values()].sort((a,b)=>a.ts-b.ts);
}
async function fetchAsterFunding(symbol:string,startTs:number,endTs:number){
  const out:{ts:number;rate:number}[]=[];let cursor=startTs;const limit=1000;
  while(cursor<endTs){
    const u=new URL("https://fapi.asterdex.com/fapi/v3/fundingRate");
    u.searchParams.set("symbol",`${symbol}USDT`);u.searchParams.set("startTime",String(cursor));u.searchParams.set("endTime",String(endTs-1));u.searchParams.set("limit",String(limit));
    const res=await fetch(u,{headers:{"user-agent":"DisDex-V12-Aster-BT-Parity/20260923"}});
    if(!res.ok)throw new Error(`ASTER_FUNDING_HTTP_${res.status}:${symbol}`);
    const rows:any=await res.json();if(!Array.isArray(rows))throw new Error(`ASTER_FUNDING_SCHEMA:${symbol}`);
    if(!rows.length)break;
    for(const row of rows){const ts=Number(row.fundingTime),rate=Number(row.fundingRate);if(Number.isFinite(ts)&&Number.isFinite(rate)&&ts>=startTs&&ts<endTs)out.push({ts,rate});}
    const last=Math.max(...rows.map((r:any)=>Number(r.fundingTime)).filter(Number.isFinite));
    const next=last+1;if(!(next>cursor))break;cursor=next;
    if(rows.length<limit)break;
    await new Promise(r=>setTimeout(r,120));
  }
  const uniq=new Map(out.map(x=>[x.ts,x]));
  return [...uniq.values()].sort((a,b)=>a.ts-b.ts);
}
async function loadAsterExactMarketData():Promise<PerpMarketData>{
  const client=new AsterV3Client({baseUrl:"https://fapi.asterdex.com",requestTimeoutMs:20_000,userAgent:"DisDex-V12-Aster-BT-Parity/20260923"});
  const bySymbol:Record<string,any[]>={};const fundingBySymbol:Record<string,{ts:number;rate:number}[]>={};
  for(const symbol of SYMS){
    bySymbol[symbol]=await fetchAsterH1(client,symbol,WARM,END+4*H);
    if(bySymbol[symbol].length<200)throw new Error(`ASTER_H1_INSUFFICIENT:${symbol}:${bySymbol[symbol].length}`);
    fundingBySymbol[symbol]=await fetchAsterFunding(symbol,START-H,END+4*H);
    console.error(`ASTER_FETCH ${symbol} h1=${bySymbol[symbol].length} funding=${fundingBySymbol[symbol].length}`);
  }
  return {startTs:WARM,endTs:END+4*H,source:"aster-futures-exact" as any,bySymbol,fundingBySymbol} as PerpMarketData;
}
function prep(d:PerpMarketData): Prepared {
  const rawBars:Record<string,V12Bar[]> = {};
  for (const s of SYMS) {
    const raw=(d.bySymbol[s]||[]).map(x=>({ts:x.ts,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume,closed:true}));
    rawBars[s]=resampleV12H1ToH2(raw);
  }
  const common=SYMS.reduce<Set<number>|undefined>((acc,s)=>{
    const set=new Set(rawBars[s].map(x=>x.endTs));
    return acc?new Set([...acc].filter(x=>set.has(x))):set;
  },undefined);
  if(!common||common.size<80)throw new Error(`ASTER_COMMON_H2_INSUFFICIENT:${common?.size||0}`);
  const bars:Record<string,V12Bar[]> = {};
  const idx:Record<string,Map<number,number>> = {};
  for(const s of SYMS){
    bars[s]=rawBars[s].filter(x=>common.has(x.endTs));
    idx[s]=new Map(bars[s].map((x,i)=>[x.ts,i]));
  }
  const n=bars.BTC.length;
  if(SYMS.some(s=>bars[s].length!==n))throw new Error("ASTER_COMMON_H2_LENGTH_MISMATCH");
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
function efficiency(b:V12Bar[],i:number,n:number){
  if(i<n)return NaN;
  const net=Math.abs(b[i].close-b[i-n].close);
  let path=0;for(let k=i-n+1;k<=i;k++)path+=Math.abs(b[k].close-b[k-1].close);
  return path>0?net/path:0;
}
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
    btc6h:side*r(bb,bi,3),btc12h:btc12,btc24h:side*btc24,btcEr12:efficiency(bb,bi,6),btcEr24:efficiency(bb,bi,12),rel24h:side*(sym24-btc24),
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
  if(v.marketMode==="ER_CHOP")ss=ss.filter(s=>highConfidence(s)||!erChop(s));
  if(v.marketMode==="STATE_BLOCK"||v.marketMode==="STATE_SIZE075")ss=ss.filter(s=>highConfidence(s)||marketState(s)!=="CHOP");
  if(v.narrowMode?.endsWith("_BLOCK"))ss=ss.filter(s=>highConfidence(s)||!narrowMatch(s,v.narrowMode));
  if(v.noTrend)ss=ss.filter(s=>highConfidence(s)||!noTrendMatch(s,v.noTrend!));
  if(v.rank1FastBlock)ss=ss.filter(s=>!rank1FastBlockMatch(s,v.rank1FastBlock!));
  return ss;
}

function highConfidence(s:RoutedSignal):boolean {
  const f=s.features;
  return f.ret24h>=0.018 && f.prevVolumeRatio<=0.80 && f.btc24h>=0.020;
}
type MarketState="TREND"|"TRANSITION"|"CHOP";
function marketState(s:RoutedSignal):MarketState{
  const f=s.features;
  const votes=[f.btc6h,f.btc12h,f.btc24h].filter(x=>x>0).length;
  if(votes>=2 && f.btcEr12>=0.28 && f.breadth12>=2/3)return "TREND";
  const mixed=votes>0&&votes<3;
  if((f.btcEr12<0.18&&f.btcEr24<0.25)||(votes<=1&&f.btcEr12<0.28&&f.breadth12<=1/3)||(mixed&&f.btcEr12<0.20))return "CHOP";
  return "TRANSITION";
}
function erChop(s:RoutedSignal){const f=s.features;return f.btcEr12<0.18&&f.btcEr24<0.25;}
function narrowFlags(s:RoutedSignal){
  const f=s.features;
  const erExhaust=f.btcEr24>=0.50&&f.btcEr12<0.50;
  const lag6=f.btcEr24>=0.60&&f.ret6h<0.01;
  const weakFlow=f.volumeRatio>=2.0&&f.rel24h<0;
  return {erExhaust,lag6,weakFlow,erlag:erExhaust||lag6,any:erExhaust||lag6||weakFlow};
}
function narrowMatch(s:RoutedSignal,mode:Variant["narrowMode"]){
  const z=narrowFlags(s);
  if(!mode)return false;
  if(mode.startsWith("ERLAG"))return z.erlag;
  if(mode.startsWith("ER_"))return z.erExhaust;
  if(mode.startsWith("LAG6"))return z.lag6;
  if(mode.startsWith("WEAK"))return z.weakFlow;
  if(mode.startsWith("ANY"))return z.any;
  return false;
}
function noTrendMatch(s:RoutedSignal,opt:NonNullable<Variant["noTrend"]>){
  const f=s.features;
  const erOk=f.btcEr12<opt.er12Max && (opt.er24Max==null || f.btcEr24<opt.er24Max) && (opt.minScore==null || f.score>=opt.minScore);
  const btc12Ok=!opt.requireBtc12Adverse || f.btc12h<0;
  const weakOk=!opt.requireBtc6OrSymbolWeak || f.btc6h<0 || f.ret6h<(opt.symbol6Max??.005);
  const noTrend=erOk&&btc12Ok&&weakOk;
  const burst=!!opt.includeBurst && f.btcEr24<.20 && f.btcEr12>=.55 && f.btcEr12<(opt.burstEr12Max??Infinity) && f.ret6h>=.02;
  const oldWeak=!!opt.combineAnyWeak && narrowFlags(s).any;
  return noTrend||burst||oldWeak;
}
function rank1FastBlockMatch(s:RoutedSignal,opt:NonNullable<Variant["rank1FastBlock"]>){
  const f=s.features;
  if(s.rank!==1 || highConfidence(s)) return false;
  if(!(f.btcEr12<opt.er12Max && f.btc12h<0)) return false;
  if(opt.symbol6Max!=null && !(f.ret6h<opt.symbol6Max)) return false;
  if(opt.rel24Max!=null && !(f.rel24h<opt.rel24Max)) return false;
  if(opt.scoreMax!=null && !(f.score<opt.scoreMax)) return false;
  return true;
}
function simulate(d:PerpMarketData,p:Prepared,v:Variant,m:Mode){
  const fee=m.feeBps/10000, slip=m.slipBps/10000;
  const times=p.timeline.filter(t=>t>=START&&t<END);
  const deposits=monthlyDepositSchedule(); let depI=0;
  let cash=10000, contributed=10000, peak=10000, maxDd=0;
  const pos=new Map<string,Position>(); const pending=new Map<string,RoutedSignal>(); const cool=new Map<string,number>(); const nonHcCooldown=new Map<string,number>();
  const pnls:number[]=[]; const tradeRows:any[]=[]; const recentNonHcLossTs:number[]=[]; let marketPauseUntil=0; let clusterTrips=0; let entries=0, rank2Entries=0, filtered=0, winsFiltered=0, maxEntryGross=0, hcEntries=0,nonHcEntries=0;
  const px=(s:string,t:number,f:"open"|"close"="close")=>{const i=p.idx[s]?.get(t);return i==null?undefined:p.bars[s]?.[i]?.[f];};
  const equity=(t:number,f:"open"|"close"="close")=>{let e=cash;for(const q of pos.values()){const x=px(q.symbol,t,f)??q.entry;const dir=q.side==="LONG"?1:-1;e+=dir*q.qty*(x-q.entry)-q.qty*x*fee;}return Math.max(0,e);};
  const gross=(t:number)=>{const e=Math.max(1,equity(t));let n=0;for(const q of pos.values())n+=q.qty*(px(q.symbol,t)??q.entry);return n/e;};
  const close=(q:Position,raw:number,reason:string,t:number)=>{
    const x=q.side==="LONG"?raw*(1-slip):raw*(1+slip);const dir=q.side==="LONG"?1:-1;
    const g=dir*q.qty*(x-q.entry),ef=q.qty*x*fee,net=g-q.entryFee-ef-q.funding;
    cash=Math.max(0,cash+g-ef);pnls.push(net);tradeRows.push({symbol:q.symbol,side:q.side,rank:q.rank,route:q.route,entryTs:q.entryTs,exitTs:t,net,pct:(x/q.entry-1)*100*dir,reason,isHC:q.isHC,...q.features});
    pos.delete(q.symbol);
    const coolBars = v.lossOnlyCooldownBars && net < 0
      ? v.lossOnlyCooldownBars
      : (v.sameSymbolCooldownBars ?? V12_X1_ALL.cooldownBars);
    cool.set(q.symbol,t+coolBars*V12_X1_ALL.timeframeHours*H);
    if(net<0&&v.nonHcLossCooldownBars)nonHcCooldown.set(q.symbol,t+v.nonHcLossCooldownBars*V12_X1_ALL.timeframeHours*H);
    if(net<0&&!q.isHC&&v.clusterPauseBars){
      const windowMs=(v.clusterWindowBars??2)*V12_X1_ALL.timeframeHours*H;
      while(recentNonHcLossTs.length&&recentNonHcLossTs[0]<t-windowMs)recentNonHcLossTs.shift();
      recentNonHcLossTs.push(t);
      if(recentNonHcLossTs.length>=2){marketPauseUntil=Math.max(marketPauseUntil,t+v.clusterPauseBars*V12_X1_ALL.timeframeHours*H);clusterTrips++;recentNonHcLossTs.length=0;}
    }
  };
  for(const t of times){
    while(depI<deposits.length&&deposits[depI]<=t){cash+=10000;contributed+=10000;peak+=10000;depI++;}
    for(const [s,sig] of [...pending]){
      const pauseBlocks=marketPauseUntil>t&&!highConfidence(sig)&&!(v.clusterTrendRecovery&&marketState(sig)==="TREND");
      if(pos.has(s)||(cool.get(s)||0)>t||((nonHcCooldown.get(s)||0)>t&&!highConfidence(sig))||pauseBlocks){pending.delete(s);continue;}
      const raw=px(s,t,"open");if(!raw){pending.delete(s);continue;}
      const e=equity(t,"open"),entry=sig.side==="LONG"?raw*(1+slip):raw*(1-slip);
      const sz=sizeV12Position(e,entry,sig.atr,sig.side); const active=[...pos.values()].reduce((n,q)=>n+q.qty*(px(q.symbol,t,"open")??q.entry),0);
      const cap=Math.max(0,e*V12_X1_ALL.dynamicResidualAggregateGrossCap-active);
      const isHC=highConfidence(sig);
      let mult=v.hcOverlay?(isHC?(v.hcGrossMultiplier??1):(v.nonHcGrossMultiplier??1)):1;
      if(!isHC&&v.marketMode==="STATE_SIZE075"&&marketState(sig)==="TRANSITION")mult*=0.75;
      if(!isHC&&v.narrowMode?.endsWith("_HALF")&&narrowMatch(sig,v.narrowMode))mult*=0.50;
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
    for(const s of ss){if(slots<=0)break;const pauseBlocks=marketPauseUntil>t&&!highConfidence(s)&&!(v.clusterTrendRecovery&&marketState(s)==="TREND");if(pos.has(s.symbol)||pending.has(s.symbol)||(cool.get(s.symbol)||0)>t||((nonHcCooldown.get(s.symbol)||0)>t&&!highConfidence(s))||pauseBlocks)continue;
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
    hcStats:subgroup(hcRows),nonHcStats:subgroup(nonHcRows),maxEntryGross,hcEntries,nonHcEntries,clusterTrips,
    finalEquity:cash,contributed,netProfit:cash-contributed,returnOnContributionPct:(cash/contributed-1)*100,
    maxDrawdownPct:maxDd,profitFactor:gl?gp/gl:gp?99:0,winRatePct:pnls.length?pnls.filter(x=>x>0).length/pnls.length*100:0,
    tradeCount:pnls.length,entries,rank2Entries,filteredSignals:filtered,averageTradePct:tradeRows.length?tradeRows.reduce((a,x)=>a+x.pct,0)/tradeRows.length:0,
    grossAtEnd:gross(END-H),routeStats, losses:tradeRows.filter(x=>x.net<0).sort((a,b)=>a.net-b.net).slice(0,10),
    trades: tradeRows,
  };
}

async function main(){
  const d=await loadAsterExactMarketData();
  const p=prep(d); const results:any={};
  for(const v of variants){results[v.name]={};for(const m of modes)results[v.name][m.name]=simulate(d,p,v,m);}
  const rows=variants.map(v=>({variant:v.name,...results[v.name]}));
  const baseline=results.HC175_LOCKED;
  const thirds=[START,START+(END-START)/3,START+2*(END-START)/3,END];
  const removed:any={};
  for(const v of variants){removed[v.name]={};for(const m of modes){
    const baseTrades=baseline[m.name].trades||[],cur=results[v.name][m.name].trades||[];
    const keys=new Set(cur.map((x:any)=>x.symbol+"|"+x.side+"|"+x.entryTs));
    const gone=baseTrades.filter((x:any)=>!x.isHC&&!keys.has(x.symbol+"|"+x.side+"|"+x.entryTs));
    removed[v.name][m.name]={
      removedTrades:gone.length,removedWins:gone.filter((x:any)=>x.net>0).length,removedLosses:gone.filter((x:any)=>x.net<0).length,
      removedNetPnl:gone.reduce((a:number,x:any)=>a+x.net,0),
      thirds:[0,1,2].map(k=>{const xs=gone.filter((x:any)=>x.entryTs>=thirds[k]&&x.entryTs<thirds[k+1]);return {n:xs.length,wins:xs.filter((x:any)=>x.net>0).length,losses:xs.filter((x:any)=>x.net<0).length,net:xs.reduce((a:number,x:any)=>a+x.net,0)};})
    };
  }}
  const todayAudit=variants.map(v=>({variant:v.name,blocked:[]}));
  const out={status:"PASS_ASTER_EXACT_V12_RANK1_FAST_SWEEP",limitations:["V12 research simulator only","HC condition and 1.75x multiplier frozen","OHLCV and funding fetched from Aster Futures public endpoints; H1->H2 and common-timestamp alignment match Production semantics"],period:{start:new Date(START).toISOString(),end:new Date(END).toISOString()},conditions:{initialJpy:10000,monthlyJpy:10000,monthlyCount:12,totalContributionJpy:130000},productionConstants:V12_X1_ALL,dataSource:d.source,variants,results,removed,todayAudit,rankingNormal:[...rows].sort((a,b)=>b.NORMAL.finalEquity-a.NORMAL.finalEquity).map(x=>x.variant)};
  const focus=variants.map(v=>({variant:v.name,NORMAL:{finalEquity:results[v.name].NORMAL.finalEquity,winRatePct:results[v.name].NORMAL.winRatePct,profitFactor:results[v.name].NORMAL.profitFactor,maxDrawdownPct:results[v.name].NORMAL.maxDrawdownPct,tradeCount:results[v.name].NORMAL.tradeCount,hc:results[v.name].NORMAL.hcStats,...removed[v.name].NORMAL},SEVERE:{finalEquity:results[v.name].SEVERE.finalEquity,winRatePct:results[v.name].SEVERE.winRatePct,profitFactor:results[v.name].SEVERE.profitFactor,maxDrawdownPct:results[v.name].SEVERE.maxDrawdownPct,tradeCount:results[v.name].SEVERE.tradeCount,hc:results[v.name].SEVERE.hcStats,...removed[v.name].SEVERE},today:todayAudit.find(x=>x.variant===v.name)?.blocked}));
  console.error("FOCUS_SUMMARY="+JSON.stringify(focus));
  await fs.mkdir(".research-state/v12-winrate-gates-20260923",{recursive:true});
  await fs.writeFile(".research-state/v12-winrate-gates-20260923/result.json",JSON.stringify(out,null,2)+"\n");
  console.log(JSON.stringify(out));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
