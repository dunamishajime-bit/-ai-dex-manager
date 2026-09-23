import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";
import { PENGU_RECOVERY_V8 } from "../config/penguRecoveryV8";
import {
  buildPenguDualLsV2EvaluationSeries,
  cooldownHoursForPenguExit,
  evaluatePenguDualLsV2PositionBar,
  isPenguV8V64DynamicLongRaw,
  penguV8BreakoutAtrScore,
  penguV8V64RequestedLongGross,
  targetGrossForAtr,
  type PenguDualLsV2EvaluationRow,
  type PenguDualLsV2Features,
  type PenguDualLsV2History,
  type PenguDualLsV2Position,
} from "../lib/pengu-dual-ls-v2";
import {
  evaluateRecoveryV8Entry,
  evaluateRecoveryV8PositionBar,
  type RecoveryV8Position,
} from "../lib/pengu-recovery-v8";
import { createPenguShortV20State } from "../lib/pengu-short-v20";
import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";

const HOUR = 3_600_000;
const WARM_START = Date.parse("2025-07-20T00:00:00Z");
const FORMAL_START = Date.parse("2025-08-10T00:00:00Z");
const FORMAL_END = Date.parse("2026-08-10T00:00:00Z");
const RECENT_END = Date.parse("2026-09-23T13:00:00Z");
const BASE_URL = "https://fapi.asterdex.com";
const BASE_FEE_PER_SIDE = 0.0006;
const STRESS_SLIPPAGE_PER_SIDE = 0.0035;

type Variant = "BASELINE" | "CONFIRMED_BREAKOUT" | "EARLY_INITIAL" | "COMBINED";
type Mode = "NORMAL" | "SEVERE";
type EntryRoute = "SHORT_V20" | "BASE_V64_LONG" | "CONFIRMED_RSI_BREAKOUT" | "EARLY_INITIAL_LONG" | "RECOVERY_V8";
type ExitReason = string;

interface FundingPoint { fundingTime:number; fundingRate:number; }
interface Trade {
  variant:Variant; mode:Mode; route:EntryRoute; side:"L"|"S"; signalTs:number; entryTs:number; exitTs:number;
  entryPrice:number; exitPrice:number; requestedGross:number; accountReturn:number; rawUnitReturn:number;
  fundingUnitReturn:number; costUnitReturn:number; exitReason:ExitReason; entryFeatures:PenguDualLsV2Features;
  partialDefense?:boolean; partialAccountReturn?:number;
}

function sleep(ms:number){ return new Promise(r=>setTimeout(r,ms)); }
async function fetchArray(url:URL){
  let last:unknown;
  for(let a=0;a<6;a++){
    try{
      const res=await fetch(url,{headers:{accept:"application/json","user-agent":"DisDex-PENGU-Breakout-Early-Research/20260923"}});
      if(!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0,180)}`);
      const x=await res.json(); if(!Array.isArray(x)) throw new Error("response-not-array"); return x as any[];
    }catch(e){last=e;await sleep(400*(a+1));}
  }
  throw last;
}
async function candles(symbol:string){
  const out:any[][]=[]; let cursor=WARM_START;
  while(cursor<RECENT_END){
    const u=new URL("/fapi/v3/klines",BASE_URL);
    u.searchParams.set("symbol",symbol);u.searchParams.set("interval","1h");u.searchParams.set("startTime",String(cursor));
    u.searchParams.set("endTime",String(RECENT_END-1));u.searchParams.set("limit","1500");
    const b=await fetchArray(u) as any[][]; if(!b.length)break;out.push(...b);
    const next=Number(b.at(-1)?.[0])+HOUR;if(!(next>cursor))throw new Error("pagination-stalled");cursor=next;await sleep(60);
  }
  const map=new Map<number,DisDexV35Candle>();
  for(const r of out){
    const openTime=Number(r[0]); const c={openTime,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closeTime:Number(r[6]??openTime+HOUR-1)};
    if(openTime>=WARM_START&&openTime<RECENT_END&&Object.values(c).every(Number.isFinite))map.set(openTime,c);
  }
  return [...map.values()].sort((a,b)=>a.openTime-b.openTime);
}
async function funding(){
  const out:FundingPoint[]=[];let cursor=WARM_START;
  while(cursor<RECENT_END){
    const u=new URL("/fapi/v3/fundingRate",BASE_URL);u.searchParams.set("symbol","PENGUUSDT");u.searchParams.set("startTime",String(cursor));
    u.searchParams.set("endTime",String(RECENT_END-1));u.searchParams.set("limit","1000");
    const b=await fetchArray(u) as any[];if(!b.length)break;
    for(const r of b){const fundingTime=Number(r.fundingTime),fundingRate=Number(r.fundingRate);if(Number.isFinite(fundingTime)&&Number.isFinite(fundingRate))out.push({fundingTime,fundingRate});}
    const next=Number(b.at(-1)?.fundingTime)+1;if(!(next>cursor))break;cursor=next;await sleep(50);
  }
  return [...new Map(out.map(x=>[x.fundingTime,x])).values()].sort((a,b)=>a.fundingTime-b.fundingTime);
}
function fundingBetween(points:FundingPoint[],a:number,b:number){return points.filter(x=>x.fundingTime>a&&x.fundingTime<=b).reduce((s,x)=>s+x.fundingRate,0);}
function allLongGatesExcept(f:PenguDualLsV2Features, except:Set<string>){
  const r=PENGU_DUAL_LS_V2.long;
  const gates:Record<string,boolean>={
    regime72:f.penguReturn72h>=r.regimeReturn72hMinimum,
    breakout18:f.close>f.priorHigh18h,
    return24:f.penguReturn24h>=r.penguReturn24hMinimum,
    relative24:f.relativeReturn24h>=r.relativeReturn24hMinimum,
    btc24:f.btcReturn24h>=r.btcReturn24hMinimum,
    rsiMin:f.rsi14>=r.rsiMinimum,
    rsiMax:f.rsi14<=r.rsiMaximum,
    volumeMin:f.volumeRatio6OverPrior36>=r.volumeRatioMinimum,
    volumeMax:f.volumeRatio6OverPrior36<=r.volumeRatioMaximum,
    atrMax:f.atr24Ratio<=r.atr24RatioMaximum,
    ema168:f.close>f.ema168,
  };
  return Object.entries(gates).every(([k,v])=>except.has(k)||v);
}
function confirmedOverride(f:PenguDualLsV2Features){
  return allLongGatesExcept(f,new Set(["rsiMax"]))
    && f.rsi14>PENGU_DUAL_LS_V2.long.rsiMaximum && f.rsi14<=95
    && penguV8BreakoutAtrScore(f)>=0.75;
}
function earlyOverride(rows:readonly PenguDualLsV2EvaluationRow[],i:number){
  const f=rows[i]?.features;if(!f||i<6)return false;
  if(!allLongGatesExcept(f,new Set(["breakout18"])))return false;
  if(!(f.close<=f.priorHigh18h))return false;
  const atrAbs=Math.max(1e-12,f.close*f.atr24Ratio);
  const gapAtr=(f.priorHigh18h-f.close)/atrAbs;
  const six=rows[i-6]?.candle.close;
  const ret6=six>0?f.close/six-1:Number.NaN;
  return gapAtr>=0&&gapAtr<=0.35&&ret6>=0.03;
}
function variantRaw(rows:readonly PenguDualLsV2EvaluationRow[],i:number,v:Variant){
  const f=rows[i]?.features;if(!f)return false;
  const base=isPenguV8V64DynamicLongRaw(f);
  if(v==="BASELINE")return base;
  const c=confirmedOverride(f);
  const e=earlyOverride(rows,i);
  return base||(v==="CONFIRMED_BREAKOUT"?c:v==="EARLY_INITIAL"?e:c||e);
}
function variantSignal(rows:readonly PenguDualLsV2EvaluationRow[],i:number,v:Variant){
  const cur=variantRaw(rows,i,v);const prev=i>0?variantRaw(rows,i-1,v):false;return cur&&!prev;
}
function routeAt(rows:readonly PenguDualLsV2EvaluationRow[],i:number,v:Variant):EntryRoute|undefined{
  if(!variantSignal(rows,i,v))return undefined;
  const f=rows[i]!.features!;
  if(isPenguV8V64DynamicLongRaw(f))return "BASE_V64_LONG";
  if((v==="CONFIRMED_BREAKOUT"||v==="COMBINED")&&confirmedOverride(f))return "CONFIRMED_RSI_BREAKOUT";
  if((v==="EARLY_INITIAL"||v==="COMBINED")&&earlyOverride(rows,i))return "EARLY_INITIAL_LONG";
  return undefined;
}
function acceptedGross(route:EntryRoute,f:PenguDualLsV2Features){
  if(route==="RECOVERY_V8")return Math.min(PENGU_DUAL_LS_V2.maximumGross,PENGU_RECOVERY_V8.initialGross);
  if(route==="SHORT_V20")return Math.min(PENGU_DUAL_LS_V2.maximumGross,targetGrossForAtr(f.atr24Ratio));
  return Math.min(PENGU_DUAL_LS_V2.maximumGross,penguV8V64RequestedLongGross(f));
}
function legReturn(side:"L"|"S",gross:number,entry:number,exit:number,entryTs:number,exitTs:number,points:FundingPoint[],cost:number){
  const raw=side==="L"?exit/entry-1:entry/exit-1;
  const fr=fundingBetween(points,entryTs,exitTs);const fu=side==="L"?-fr:fr;const cu=-2*cost;
  return {raw,fu,cu,account:gross*(raw+fu+cu)};
}
function replay(rows:PenguDualLsV2EvaluationRow[],points:FundingPoint[],v:Variant,mode:Mode){
  const cost=BASE_FEE_PER_SIDE+(mode==="SEVERE"?STRESS_SLIPPAGE_PER_SIDE:0);const trades:Trade[]=[];
  let i=250,cooldownUntilTs=0;
  while(i<rows.length-2){
    const currentReferenceTs=rows[i]?.features?.referenceTs ?? rows[i]?.candle.openTime ?? 0;
    if(currentReferenceTs<cooldownUntilTs){i++;continue;}const f=rows[i].features;if(!f){i++;continue;}
    const longRoute=routeAt(rows,i,v);const longSignal=Boolean(longRoute);
    const adjustedRecovery=rows[i].recoveryV8?{...rows[i].recoveryV8,ordinaryLongEligible:longSignal,baseLongSignal:longSignal}:undefined;
    const recovery=adjustedRecovery?evaluateRecoveryV8Entry(adjustedRecovery):undefined;
    let route:EntryRoute|undefined;
    if(rows[i].shortSignal)route="SHORT_V20"; else if(longRoute)route=longRoute; else if(recovery?.kind==="RECOVERY_V8")route="RECOVERY_V8";
    if(!route){i++;continue;}
    const side:"L"|"S"=route==="SHORT_V20"?"S":"L";const entryIndex=i+1,entry=rows[entryIndex].candle,gross=acceptedGross(route,f);
    let exitIndex=entryIndex,exitPrice=entry.open,exitReason="WINDOW_END",partialDefense=false,partialAccountReturn=0,accountReturn=0,rawUnitReturn=0,fundingUnitReturn=0,costUnitReturn=0;
    if(route==="RECOVERY_V8"){
      let rp:RecoveryV8Position={side:1,entryTs:entry.openTime,entryPrice:entry.open,quantity:1,originalGross:gross,remainingGross:gross,partialDefenseTriggered:false,highWaterMark:entry.open};
      const naturalLast=entryIndex+PENGU_RECOVERY_V8.exit.maxHoldHours-1;const last=Math.min(rows.length-1,naturalLast);exitIndex=last;exitPrice=rows[last].candle.close;exitReason=last===naturalLast?"RECOVERY_V8_MAX_HOLD":"WINDOW_END";
      let remainingGross=gross;
      for(let j=entryIndex;j<=last;j++){
        const rr=rows[j].recoveryV8?{...rows[j].recoveryV8,ordinaryLongEligible:variantSignal(rows,j,v),baseLongSignal:variantSignal(rows,j,v)}:undefined;
        if(!rr)continue;const ev=evaluateRecoveryV8PositionBar(rp,rr);
        if(ev.events.includes("PARTIAL_DEFENSE")&&!partialDefense){
          const pg=ev.partialGross??PENGU_RECOVERY_V8.partial.gross;const pp=ev.triggerPrice??entry.open*(1-PENGU_RECOVERY_V8.partial.stopPct);
          partialAccountReturn=legReturn("L",pg,entry.open,pp,entry.openTime,rows[j].candle.openTime,points,cost).account;
          partialDefense=true;remainingGross=Math.max(0,gross-pg);
        }
        rp=ev.updatedPosition;
        if(["HARD_STOP","TRAILING_STOP","MAX_HOLD","YIELD_BASE_LONG"].includes(ev.kind)){
          exitIndex=j;exitPrice=ev.stopPrice??rows[j].candle.close;exitReason=`RECOVERY_V8_${ev.kind}`;break;
        }
      }
      const leg=legReturn("L",remainingGross,entry.open,exitPrice,entry.openTime,rows[exitIndex].candle.openTime,points,cost);
      accountReturn=partialAccountReturn+leg.account;
      const denom=Math.max(1e-12,gross);rawUnitReturn=accountReturn/denom;fundingUnitReturn=0;costUnitReturn=0;
    }else{
      let pos:PenguDualLsV2Position={side:side==="L"?1:-1,entryTs:entry.openTime,entryPrice:entry.open,quantity:1,gross,highWaterMark:entry.open,lowWaterMark:entry.open,
        entryVersion:side==="S"?"SHORT_V20":"LONG_V2_FINAL",
        shortV20:side==="S"?createPenguShortV20State({entryPrice:entry.open,requestedGross:gross,entryAtr24Ratio:f.atr24Ratio,btcEma168Distance:f.btcEma168Distance,btcReturn24h:f.btcReturn24h}):undefined};
      const hold=side==="L"?PENGU_DUAL_LS_V2.long.maxHoldHours:PENGU_DUAL_LS_V2.short.maxHoldHours;const naturalLast=entryIndex+hold-1;const last=Math.min(rows.length-1,naturalLast);exitIndex=last;exitPrice=rows[last].candle.close;exitReason=last===naturalLast?(side==="L"?"LONG_MAX_HOLD":"SHORT_MAX_HOLD"):"WINDOW_END";
      for(let j=entryIndex;j<=last;j++){const ff=rows[j].features;if(!ff)continue;const ev=evaluatePenguDualLsV2PositionBar(pos,ff);pos=ev.updatedPosition;if(ev.exit){exitIndex=j;exitPrice=ev.exit.stopPrice??rows[j].candle.close;exitReason=ev.exit.reason;break;}}
      const leg=legReturn(side,gross,entry.open,exitPrice,entry.openTime,rows[exitIndex].candle.openTime,points,cost);accountReturn=leg.account;rawUnitReturn=leg.raw;fundingUnitReturn=leg.fu;costUnitReturn=leg.cu;
    }
    trades.push({variant:v,mode,route,side,signalTs:rows[i].candle.openTime,entryTs:entry.openTime,exitTs:rows[exitIndex].candle.openTime,entryPrice:entry.open,exitPrice,requestedGross:gross,accountReturn,rawUnitReturn,fundingUnitReturn,costUnitReturn,exitReason,entryFeatures:{...f},partialDefense,partialAccountReturn});
    cooldownUntilTs=rows[exitIndex].candle.openTime+cooldownHoursForPenguExit(exitReason as any)*HOUR;i=exitIndex+1;
  }
  return trades;
}
function metrics(ts:Trade[]){
  let eq=1,peak=1,dd=0,gp=0,gl=0;for(const t of ts){eq*=1+t.accountReturn;peak=Math.max(peak,eq);dd=Math.min(dd,eq/peak-1);if(t.accountReturn>0)gp+=t.accountReturn;else gl-=t.accountReturn;}
  return {trades:ts.length,returnPct:(eq-1)*100,winRatePct:ts.length?ts.filter(t=>t.accountReturn>0).length/ts.length*100:null,profitFactor:gl>0?gp/gl:null,maxDrawdownPct:dd*100,
    longTrades:ts.filter(t=>t.side==="L").length,shortTrades:ts.filter(t=>t.side==="S").length,extraConfirmed:ts.filter(t=>t.route==="CONFIRMED_RSI_BREAKOUT").length,extraEarly:ts.filter(t=>t.route==="EARLY_INITIAL_LONG").length,recoveryTrades:ts.filter(t=>t.route==="RECOVERY_V8").length};
}
function between(ts:Trade[],a:number,b:number){return ts.filter(t=>t.entryTs>=a&&t.entryTs<b);}
function routeMetrics(ts:Trade[]){return Object.fromEntries((["SHORT_V20","BASE_V64_LONG","CONFIRMED_RSI_BREAKOUT","EARLY_INITIAL_LONG","RECOVERY_V8"] as EntryRoute[]).map(r=>[r,metrics(ts.filter(t=>t.route===r))]));}
function recentSignals(rows:PenguDualLsV2EvaluationRow[],v:Variant){
  const cutoff=RECENT_END-7*24*HOUR;const out:any[]=[];for(let i=0;i<rows.length;i++){if(rows[i].candle.openTime<cutoff||rows[i].candle.openTime>=RECENT_END||!rows[i].features)continue;const route=routeAt(rows,i,v);if(route&&route!=="BASE_V64_LONG")out.push({ts:new Date(rows[i].candle.openTime).toISOString(),route,features:rows[i].features,breakoutAtr:penguV8BreakoutAtrScore(rows[i].features!),gapAtr:(rows[i].features!.priorHigh18h-rows[i].features!.close)/Math.max(1e-12,rows[i].features!.close*rows[i].features!.atr24Ratio)});}return out;
}

async function main(){
  const [p,b,fp]=await Promise.all([candles("PENGUUSDT"),candles("BTCUSDT"),funding()]);
  const common=new Set(p.map(x=>x.openTime));const btc=b.filter(x=>common.has(x.openTime));const btcSet=new Set(btc.map(x=>x.openTime));const pengu=p.filter(x=>btcSet.has(x.openTime));
  assert.equal(pengu.length,btc.length);assert.ok(pengu.length>9000,`insufficient common rows ${pengu.length}`);
  const history:PenguDualLsV2History={pengu1h:pengu,btc1h:btc,penguFunding:fp};
  const rows=buildPenguDualLsV2EvaluationSeries(history,RECENT_END+1);
  const variants:Variant[]=["BASELINE","CONFIRMED_BREAKOUT","EARLY_INITIAL","COMBINED"];const modes:Mode[]=["NORMAL","SEVERE"];
  const result:any={schema:"pengu-breakout-early-comparison/v1",source:{venue:"ASTER_FUTURES_V3",sourceSha:process.env.PRODUCTION_SOURCE_SHA||null},thresholds:{confirmed:{onlyRsiMaxRelaxed:true,rsiAbove:78,rsiAtMost:95,breakoutAtrMin:.75},early:{onlyBreakoutRelaxed:true,gapAtrMax:.35,ret6hMin:.03}},gross:{maximum:PENGU_DUAL_LS_V2.maximumGross,recovery:PENGU_RECOVERY_V8.initialGross},windows:{formal:[new Date(FORMAL_START).toISOString(),new Date(FORMAL_END).toISOString()],recentHoldout:[new Date(FORMAL_END).toISOString(),new Date(RECENT_END).toISOString()]},variants:{},recentSignals:{},safety:{researchOnly:true,ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  for(const v of variants){result.variants[v]={};for(const m of modes){const all=replay(rows,fp,v,m);const formal=between(all,FORMAL_START,FORMAL_END),recent=between(all,FORMAL_END,RECENT_END);result.variants[v][m]={formal:metrics(formal),recentHoldout:metrics(recent),fullThroughSep23:metrics(between(all,FORMAL_START,RECENT_END)),routeFormal:routeMetrics(formal),routeRecent:routeMetrics(recent),trades:all.filter(t=>t.entryTs>=FORMAL_START&&t.entryTs<RECENT_END)};}result.recentSignals[v]=recentSignals(rows,v);}
  const base=result.variants.BASELINE.NORMAL;for(const v of variants.filter(x=>x!=="BASELINE")){result.variants[v].deltaVsBaseline={formalReturnPct:result.variants[v].NORMAL.formal.returnPct-base.formal.returnPct,formalWinRatePct:result.variants[v].NORMAL.formal.winRatePct-base.formal.winRatePct,formalDdPct:result.variants[v].NORMAL.formal.maxDrawdownPct-base.formal.maxDrawdownPct,recentReturnPct:result.variants[v].NORMAL.recentHoldout.returnPct-base.recentHoldout.returnPct,recentWinRatePct:result.variants[v].NORMAL.recentHoldout.winRatePct-base.recentHoldout.winRatePct};}
  await fs.mkdir(".research-state/pengu-breakout-early-comparison",{recursive:true});await fs.writeFile(".research-state/pengu-breakout-early-comparison/result.json",JSON.stringify(result,null,2)+"\n");
  console.log("PENGU_BREAKOUT_EARLY_SUMMARY="+JSON.stringify(Object.fromEntries(variants.map(v=>[v,{normal:result.variants[v].NORMAL,severe:result.variants[v].SEVERE,recentSignals:result.recentSignals[v]}]))));
}
main().catch(e=>{console.error(e);process.exit(1);});
