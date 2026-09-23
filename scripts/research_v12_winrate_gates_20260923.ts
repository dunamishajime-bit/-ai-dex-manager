import fs from "fs/promises";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import type { PerpBar, PerpMarketData } from "../lib/research-lab/perp/types";
import {
  buildV12Signals,
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
type Route = "NORMAL_SCORE"|"STRONG_REGIME_ALT"|"RELAXED_MOMENTUM_ALT"|"UNKNOWN";
type RoutedSignal = V12Signal & { route: Route };
type Position = {
  symbol:string; side:"LONG"|"SHORT"; entry:number; qty:number; entryFee:number; funding:number; lastFund:number;
  initialStop:number; stop:number; tp:number; trailingDistance:number; peak:number; trough:number; bars:number; rank:number; entryTs:number; route:Route;
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
};
type Mode = { name:string; feeBps:number; slipBps:number };

const variants: Variant[] = [
  { name:"BASELINE" },
  { name:"FAST_BTC_24H", fastBtcVeto:"24h" },
  { name:"FAST_BTC_12H_24H", fastBtcVeto:"12h24h" },
  { name:"REENTRY_4H", sameSymbolCooldownBars:2 },
  { name:"REENTRY_6H", sameSymbolCooldownBars:3 },
  { name:"RANK2_SCORE_035", rank2MinScore:0.35 },
  { name:"RANK2_SCORE_045", rank2MinScore:0.45 },
  { name:"RANK2_SCORE_055", rank2MinScore:0.55 },
  { name:"BREAKOUT_18_BUFFER_233", breakoutConfirm:true },
  { name:"DD_DEFENSE", ddDefense:true },
  { name:"COMBO_A", fastBtcVeto:"24h", sameSymbolCooldownBars:2, rank2MinScore:0.35 },
  { name:"COMBO_B", fastBtcVeto:"24h", sameSymbolCooldownBars:3, rank2MinScore:0.45 },
  { name:"COMBO_C", fastBtcVeto:"12h24h", sameSymbolCooldownBars:3, rank2MinScore:0.45, ddDefense:true },
  { name:"LOSS_COOLDOWN_4H", lossOnlyCooldownBars:2 },
  { name:"LOSS_COOLDOWN_6H", lossOnlyCooldownBars:3 },
  { name:"LOSS_COOLDOWN_12H", lossOnlyCooldownBars:6 },
  { name:"BTC_BOTH_NEGATIVE", fastBtcVeto:"bothNegative" },
  { name:"LOSS6H_PLUS_BTC_BOTH_NEG", lossOnlyCooldownBars:3, fastBtcVeto:"bothNegative" },
  { name:"BLOCK_STRONG_ALT", blockStrongAlt:true },
  { name:"BLOCK_RELAXED_ALT", blockRelaxedAlt:true },
  { name:"NORMAL_ONLY", blockStrongAlt:true, blockRelaxedAlt:true },
  { name:"ALT_SCORE_030", altMinScore:0.30 },
  { name:"ALT_SCORE_040", altMinScore:0.40 },
  { name:"ALT_SCORE_050", altMinScore:0.50 },
  { name:"ALT_VOLUME_120", altMinVolume:1.20 },
  { name:"ALT_VOLUME_140", altMinVolume:1.40 },
  { name:"ALT_MOM_080", altMinMomentum:0.08 },
  { name:"ALT_SCORE030_VOL120", altMinScore:0.30, altMinVolume:1.20 },
  { name:"ALT_SCORE040_VOL120", altMinScore:0.40, altMinVolume:1.20 },
  { name:"ALT_SCORE030_VOL120_LOSS6H", altMinScore:0.30, altMinVolume:1.20, lossOnlyCooldownBars:3 },
  { name:"BLOCK_NORMAL_SCORE", blockNormalScore:true },
  { name:"RELAXED_SCORE_030", relaxedMinScore:0.30 },
  { name:"RELAXED_SCORE_040", relaxedMinScore:0.40 },
  { name:"RELAXED_VOLUME_120", relaxedMinVolume:1.20 },
  { name:"RELAXED_VOLUME_140", relaxedMinVolume:1.40 },
  { name:"RELAXED_BTC_BOTH_NEG", relaxedBtcBothNegativeVeto:true },
  { name:"RELAXED_VOL120_BTC_BOTH_NEG", relaxedMinVolume:1.20, relaxedBtcBothNegativeVeto:true },
  { name:"RELAXED_VOL140_BTC_BOTH_NEG", relaxedMinVolume:1.40, relaxedBtcBothNegativeVeto:true },
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
function variantSignals(p:Prepared,t:number,v:Variant,currentDd:number){
  const i=p.idx.BTC?.get(t); if(i==null)return [] as RoutedSignal[];
  let ss=buildV12Signals(p.bars,i,V12_X1_ALL.maximumPositions).map(s=>({...s,route:routeFor(p,s,t)})) as RoutedSignal[];
  ss=ss.filter(s=>fastBtcPass(p,s,t,v.fastBtcVeto));
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
    return true;
  });
  if(v.ddDefense){
    if(currentDd>=5) ss=ss.filter(s=>s.rank===1 && s.score>=0.45);
    else if(currentDd>=4) ss=ss.filter(s=>s.rank===1);
  }
  return ss;
}

function simulate(d:PerpMarketData,p:Prepared,v:Variant,m:Mode){
  const fee=m.feeBps/10000, slip=m.slipBps/10000;
  const times=p.timeline.filter(t=>t>=START&&t<END);
  const deposits=monthlyDepositSchedule(); let depI=0;
  let cash=10000, contributed=10000, peak=10000, maxDd=0;
  const pos=new Map<string,Position>(); const pending=new Map<string,RoutedSignal>(); const cool=new Map<string,number>();
  const pnls:number[]=[]; const tradeRows:any[]=[]; let entries=0, rank2Entries=0, filtered=0, winsFiltered=0;
  const px=(s:string,t:number,f:"open"|"close"="close")=>{const i=p.idx[s]?.get(t);return i==null?undefined:p.bars[s]?.[i]?.[f];};
  const equity=(t:number,f:"open"|"close"="close")=>{let e=cash;for(const q of pos.values()){const x=px(q.symbol,t,f)??q.entry;const dir=q.side==="LONG"?1:-1;e+=dir*q.qty*(x-q.entry)-q.qty*x*fee;}return Math.max(0,e);};
  const gross=(t:number)=>{const e=Math.max(1,equity(t));let n=0;for(const q of pos.values())n+=q.qty*(px(q.symbol,t)??q.entry);return n/e;};
  const close=(q:Position,raw:number,reason:string,t:number)=>{
    const x=q.side==="LONG"?raw*(1-slip):raw*(1+slip);const dir=q.side==="LONG"?1:-1;
    const g=dir*q.qty*(x-q.entry),ef=q.qty*x*fee,net=g-q.entryFee-ef-q.funding;
    cash=Math.max(0,cash+g-ef);pnls.push(net);tradeRows.push({symbol:q.symbol,rank:q.rank,route:q.route,entryTs:q.entryTs,exitTs:t,net,pct:(x/q.entry-1)*100*dir,reason});
    pos.delete(q.symbol);
    const coolBars = v.lossOnlyCooldownBars && net < 0
      ? v.lossOnlyCooldownBars
      : (v.sameSymbolCooldownBars ?? V12_X1_ALL.cooldownBars);
    cool.set(q.symbol,t+coolBars*V12_X1_ALL.timeframeHours*H);
  };
  for(const t of times){
    while(depI<deposits.length&&deposits[depI]<=t){cash+=10000;contributed+=10000;peak+=10000;depI++;}
    for(const [s,sig] of [...pending]){
      if(pos.has(s)||(cool.get(s)||0)>t){pending.delete(s);continue;}
      const raw=px(s,t,"open");if(!raw){pending.delete(s);continue;}
      const e=equity(t,"open"),entry=sig.side==="LONG"?raw*(1+slip):raw*(1-slip);
      const sz=sizeV12Position(e,entry,sig.atr,sig.side); const active=[...pos.values()].reduce((n,q)=>n+q.qty*(px(q.symbol,t,"open")??q.entry),0);
      const cap=Math.max(0,e*V12_X1_ALL.dynamicResidualAggregateGrossCap-active);
      const rankCap=e*(sig.rank===3?V12_X1_ALL.rank3EntryGrossCap:V12_X1_ALL.perPositionEntryGrossCap);
      const notional=Math.min(sz.requestedNotional,rankCap,cap);
      if(notional/e<0.05){pending.delete(s);continue;}
      const qty=notional/entry,entryFee=notional*fee,levels=protectiveLevels(entry,sig.atr,sig.side);
      cash-=entryFee;pos.set(s,{symbol:s,side:sig.side,entry,qty,entryFee,funding:0,lastFund:t,initialStop:levels.initialStop,stop:levels.initialStop,tp:levels.takeProfit,trailingDistance:levels.trailingDistance,peak:entry,trough:entry,bars:0,rank:sig.rank,entryTs:t,route:sig.route});
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
    filtered += Math.max(0,base.length-ss.length);
    let slots=Math.max(0,V12_X1_ALL.maximumPositions-pos.size-pending.size);
    for(const s of ss){if(slots<=0)break;if(pos.has(s.symbol)||pending.has(s.symbol)||(cool.get(s.symbol)||0)>t)continue;pending.set(s.symbol,s);slots--;}
  }
  while(depI<deposits.length&&deposits[depI]<=END){cash+=10000;contributed+=10000;depI++;}
  for(const q of [...pos.values()]){const b=p.bars[q.symbol];const last=b?.filter(x=>x.ts<END).at(-1);if(last)close(q,last.close,"end",END);}
  const gp=pnls.filter(x=>x>0).reduce((a,b)=>a+b,0),gl=-pnls.filter(x=>x<0).reduce((a,b)=>a+b,0);
  const routeStats=Object.fromEntries((["NORMAL_SCORE","STRONG_REGIME_ALT","RELAXED_MOMENTUM_ALT","UNKNOWN"] as Route[]).map(route=>{
    const xs=tradeRows.filter(x=>x.route===route), rgp=xs.filter(x=>x.net>0).reduce((a,x)=>a+x.net,0), rgl=-xs.filter(x=>x.net<0).reduce((a,x)=>a+x.net,0);
    return [route,{tradeCount:xs.length,winRatePct:xs.length?xs.filter(x=>x.net>0).length/xs.length*100:0,profitFactor:rgl?rgp/rgl:rgp?99:0,netPnl:xs.reduce((a,x)=>a+x.net,0),avgPct:xs.length?xs.reduce((a,x)=>a+x.pct,0)/xs.length:0}];
  }));
  return {
    finalEquity:cash,contributed,netProfit:cash-contributed,returnOnContributionPct:(cash/contributed-1)*100,
    maxDrawdownPct:maxDd,profitFactor:gl?gp/gl:gp?99:0,winRatePct:pnls.length?pnls.filter(x=>x>0).length/pnls.length*100:0,
    tradeCount:pnls.length,entries,rank2Entries,filteredSignals:filtered,averageTradePct:tradeRows.length?tradeRows.reduce((a,x)=>a+x.pct,0)/tradeRows.length:0,
    grossAtEnd:gross(END-H),routeStats, losses:tradeRows.filter(x=>x.net<0).sort((a,b)=>a.net-b.net).slice(0,10),
  };
}

async function main(){
  const d=await loadPerpMarketData({symbols:SYMS,startTs:WARM,endTs:END+4*H});
  const p=prep(d); const results:any={};
  for(const v of variants){results[v.name]={};for(const m of modes)results[v.name][m.name]=simulate(d,p,v,m);}
  const rows=variants.map(v=>({variant:v.name,...results[v.name]}));
  const out={status:"PASS_RESEARCH_ONLY",period:{start:new Date(START).toISOString(),end:new Date(END).toISOString()},conditions:{initialJpy:10000,monthlyJpy:10000,monthlyCount:12,totalContributionJpy:130000},productionConstants:V12_X1_ALL,dataSource:d.source,variants,results,rankingNormal:[...rows].sort((a,b)=>b.NORMAL.profitFactor-a.NORMAL.profitFactor).map(x=>x.variant)};
  await fs.mkdir(".research-state/v12-winrate-gates-20260923",{recursive:true});
  await fs.writeFile(".research-state/v12-winrate-gates-20260923/result.json",JSON.stringify(out,null,2)+"\n");
  console.log(JSON.stringify(out));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
