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

type Variant = "BASELINE" | "LONG_CONT" | "LONG_SHORT_EXIT_FLIP" | "LONG_DEEP_RECLAIM" | "SHORT_CONT" | "SHORT_BLOWOFF_REVERSAL" | "SHORT_DIRECT_BREAKDOWN";
type Mode = "NORMAL" | "SEVERE";
type EntryRoute = "SHORT_V20" | "BASE_V64_LONG" | "LONG_CONT" | "LONG_SHORT_EXIT_FLIP" | "LONG_DEEP_RECLAIM" | "SHORT_CONT" | "SHORT_BLOWOFF_REVERSAL" | "SHORT_DIRECT_BREAKDOWN" | "RECOVERY_V8";
type ExitReason = string;

interface FundingPoint { fundingTime:number; fundingRate:number; }
interface Trade {
  variant:Variant; mode:Mode; route:EntryRoute; side:"L"|"S"; signalTs:number; entryTs:number; exitTs:number;
  entryPrice:number; exitPrice:number; requestedGross:number; accountReturn:number; rawUnitReturn:number;
  fundingUnitReturn:number; costUnitReturn:number; exitReason:ExitReason; entryFeatures:PenguDualLsV2Features;
  partialDefense?:boolean; partialAccountReturn?:number; openAtWindowEnd?:boolean;
  continuationSourceExitTs?:number; continuationSourceExitPrice?:number;
}
interface ProfitExitArm { exitTs:number; exitPrice:number; expiresTs:number; sourceEntryTs:number; sourceSignalTs:number; sourceAccountReturn:number; }

function sleep(ms:number){ return new Promise(r=>setTimeout(r,ms)); }
async function fetchArray(url:URL){
  let last:unknown;
  for(let a=0;a<6;a++){
    try{
      const res=await fetch(url,{headers:{accept:"application/json","user-agent":"DisDex-PENGU-Wave-Cover-Stage1/20260924"}});
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
function baseLongSignal(rows:readonly PenguDualLsV2EvaluationRow[],i:number){
  const f=rows[i]?.features;if(!f)return false;
  const cur=isPenguV8V64DynamicLongRaw(f);
  const prev=i>0&&rows[i-1]?.features?isPenguV8V64DynamicLongRaw(rows[i-1]!.features!):false;
  return cur&&!prev;
}
function ret6(rows:readonly PenguDualLsV2EvaluationRow[],i:number){
  const f=rows[i]?.features,prev=i>=6?rows[i-6]?.candle.close:NaN;
  return f&&prev>0?f.close/prev-1:Number.NaN;
}

function priorLow18(rows:readonly PenguDualLsV2EvaluationRow[],i:number){
  if(i<18)return Number.NaN;
  return Math.min(...rows.slice(i-18,i).map(x=>x.candle.low));
}
function atrAbs(f:PenguDualLsV2Features){return Math.max(1e-12,f.close*f.atr24Ratio);}
function basicVolumeAtr(f:PenguDualLsV2Features){
  return f.volumeRatio6OverPrior36>=PENGU_DUAL_LS_V2.long.volumeRatioMinimum
    && f.volumeRatio6OverPrior36<=PENGU_DUAL_LS_V2.long.volumeRatioMaximum
    && f.atr24Ratio<=PENGU_DUAL_LS_V2.long.atr24RatioMaximum;
}
function longContCondition(rows:readonly PenguDualLsV2EvaluationRow[],i:number,arm?:ProfitExitArm){
  const f=rows[i]?.features;if(!f||!arm)return false;
  const ts=f.referenceTs;
  return ts>=arm.exitTs+PENGU_DUAL_LS_V2.cooldownHours*HOUR
    && ts<=arm.expiresTs
    && f.close>=arm.exitPrice
    && ret6(rows,i)>=0.03
    && Math.abs(f.close-f.priorHigh18h)/atrAbs(f)<=0.50
    && f.penguReturn24h>=0.10
    && f.penguReturn72h>=0.15 && f.penguReturn72h<=0.40
    && f.relativeReturn24h>=0.05
    && f.btcReturn24h>=0
    && f.rsi14>=55 && f.rsi14<=90
    && basicVolumeAtr(f)
    && f.close>f.ema168;
}
function longShortExitFlipCondition(rows:readonly PenguDualLsV2EvaluationRow[],i:number,arm?:ProfitExitArm){
  const f=rows[i]?.features;if(!f||!arm)return false;
  const ts=f.referenceTs;
  return ts>=arm.exitTs+PENGU_DUAL_LS_V2.cooldownHours*HOUR
    && ts<=arm.expiresTs
    && f.close>=arm.exitPrice
    && ret6(rows,i)>=0.03
    && f.penguReturn24h>=-0.02
    && f.penguReturn72h<=0.05
    && f.relativeReturn24h>=0
    && f.btcReturn24h>=-0.03
    && f.rsi14>=45 && f.rsi14<=75
    && basicVolumeAtr(f)
    && f.close>f.ema72;
}
function longDeepReclaimRaw(rows:readonly PenguDualLsV2EvaluationRow[],i:number){
  const f=rows[i]?.features;if(!f)return false;
  return f.penguReturn72h<=-0.10 && f.penguReturn72h>=-0.45
    && f.penguReturn24h>=0.02
    && ret6(rows,i)>=0.04
    && f.relativeReturn24h>=0.015
    && f.btcReturn24h>=-0.03
    && f.rsi14>=45 && f.rsi14<=72
    && basicVolumeAtr(f)
    && f.close>f.ema72;
}
function shortContCondition(rows:readonly PenguDualLsV2EvaluationRow[],i:number,arm?:ProfitExitArm){
  const f=rows[i]?.features;if(!f||!arm)return false;
  const ts=f.referenceTs,low18=priorLow18(rows,i);
  if(!Number.isFinite(low18))return false;
  return ts>=arm.exitTs+PENGU_DUAL_LS_V2.cooldownHours*HOUR
    && ts<=arm.expiresTs
    && f.close<=arm.exitPrice
    && ret6(rows,i)<=-0.03
    && Math.abs(f.close-low18)/atrAbs(f)<=0.50
    && f.penguReturn24h<=-0.10
    && f.penguReturn72h<=-0.15 && f.penguReturn72h>=-0.40
    && f.relativeReturn24h<=-0.05
    && f.btcReturn24h<=0
    && f.rsi14>=10 && f.rsi14<=45
    && basicVolumeAtr(f)
    && f.close<f.ema168;
}
function shortBlowoffRaw(rows:readonly PenguDualLsV2EvaluationRow[],i:number){
  const f=rows[i]?.features;if(!f)return false;
  const drawdown=f.close/f.priorHigh18h-1;
  return f.penguReturn72h>=0.12 && f.penguReturn72h<=0.45
    && ret6(rows,i)<=-0.035
    && drawdown<=-0.04
    && f.close<f.previousLow
    && f.btcReturn24h<=0.04
    && f.rsi14>=30 && f.rsi14<=60
    && basicVolumeAtr(f);
}
function shortDirectRaw(rows:readonly PenguDualLsV2EvaluationRow[],i:number){
  const f=rows[i]?.features;if(!f)return false;
  return ret6(rows,i)<=-0.035
    && f.penguReturn24h<=-0.03
    && f.penguReturn72h<=0.10
    && f.relativeReturn24h<=-0.015
    && f.close<f.previousLow
    && f.close<f.ema72
    && f.btcReturn24h<=0.04
    && f.btcEma168Distance>=-0.04
    && f.rsi14>=30 && f.rsi14<=58
    && basicVolumeAtr(f);
}
function risingEdge(rows:readonly PenguDualLsV2EvaluationRow[],i:number,fn:(rows:readonly PenguDualLsV2EvaluationRow[],i:number)=>boolean){
  return fn(rows,i) && (i<=0 || !fn(rows,i-1));
}
function supplementalRoute(
  rows:readonly PenguDualLsV2EvaluationRow[],
  i:number,
  v:Variant,
  arms:{longTrail?:ProfitExitArm;shortExit?:ProfitExitArm;shortTrail?:ProfitExitArm},
):EntryRoute|undefined{
  if(v==="LONG_CONT"&&longContCondition(rows,i,arms.longTrail))return "LONG_CONT";
  if(v==="LONG_SHORT_EXIT_FLIP"&&longShortExitFlipCondition(rows,i,arms.shortExit))return "LONG_SHORT_EXIT_FLIP";
  if(v==="LONG_DEEP_RECLAIM"&&risingEdge(rows,i,longDeepReclaimRaw))return "LONG_DEEP_RECLAIM";
  if(v==="SHORT_CONT"&&shortContCondition(rows,i,arms.shortTrail))return "SHORT_CONT";
  if(v==="SHORT_BLOWOFF_REVERSAL"&&risingEdge(rows,i,shortBlowoffRaw))return "SHORT_BLOWOFF_REVERSAL";
  if(v==="SHORT_DIRECT_BREAKDOWN"&&risingEdge(rows,i,shortDirectRaw))return "SHORT_DIRECT_BREAKDOWN";
  return undefined;
}
function routeSide(route:EntryRoute):"L"|"S"{
  return route==="SHORT_V20"||route.startsWith("SHORT_")?"S":"L";
}
function acceptedGross(route:EntryRoute,f:PenguDualLsV2Features){
  if(route==="RECOVERY_V8")return Math.min(PENGU_DUAL_LS_V2.maximumGross,PENGU_RECOVERY_V8.initialGross);
  if(routeSide(route)==="S")return Math.min(PENGU_DUAL_LS_V2.maximumGross,targetGrossForAtr(f.atr24Ratio));
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
  let longTrail:ProfitExitArm|undefined,shortExit:ProfitExitArm|undefined,shortTrail:ProfitExitArm|undefined;
  while(i<rows.length-2){
    const currentReferenceTs=rows[i]?.features?.referenceTs ?? rows[i]?.candle.openTime ?? 0;
    if(longTrail&&currentReferenceTs>longTrail.expiresTs)longTrail=undefined;
    if(shortExit&&currentReferenceTs>shortExit.expiresTs)shortExit=undefined;
    if(shortTrail&&currentReferenceTs>shortTrail.expiresTs)shortTrail=undefined;
    if(currentReferenceTs<cooldownUntilTs){i++;continue;}
    const f=rows[i].features;if(!f){i++;continue;}
    const baseLong=baseLongSignal(rows,i);
    const extra=supplementalRoute(rows,i,v,{longTrail,shortExit,shortTrail});
    const extraSide=extra?routeSide(extra):undefined;
    const anyLong=baseLong||extraSide==="L";
    const adjustedRecovery=rows[i].recoveryV8?{...rows[i].recoveryV8,ordinaryLongEligible:anyLong,baseLongSignal:anyLong}:undefined;
    const recovery=adjustedRecovery?evaluateRecoveryV8Entry(adjustedRecovery):undefined;
    let route:EntryRoute|undefined;
    if(rows[i].shortSignal)route="SHORT_V20";
    else if(extraSide==="S")route=extra;
    else if(baseLong)route="BASE_V64_LONG";
    else if(extraSide==="L")route=extra;
    else if(recovery?.kind==="RECOVERY_V8")route="RECOVERY_V8";
    if(!route){i++;continue;}
    const side=routeSide(route);const entryIndex=i+1,entry=rows[entryIndex].candle,gross=acceptedGross(route,f);
    let exitIndex=entryIndex,exitPrice=entry.open,exitReason="WINDOW_END",partialDefense=false,partialAccountReturn=0,accountReturn=0,rawUnitReturn=0,fundingUnitReturn=0,costUnitReturn=0;
    if(route==="RECOVERY_V8"){
      let rp:RecoveryV8Position={side:1,entryTs:entry.openTime,entryPrice:entry.open,quantity:1,originalGross:gross,remainingGross:gross,partialDefenseTriggered:false,highWaterMark:entry.open};
      const naturalLast=entryIndex+PENGU_RECOVERY_V8.exit.maxHoldHours-1;const last=Math.min(rows.length-1,naturalLast);exitIndex=last;exitPrice=rows[last].candle.close;exitReason=last===naturalLast?"RECOVERY_V8_MAX_HOLD":"WINDOW_END";
      let remainingGross=gross;
      for(let j=entryIndex;j<=last;j++){
        const baseAtJ=baseLongSignal(rows,j);
        const rr=rows[j].recoveryV8?{...rows[j].recoveryV8,ordinaryLongEligible:baseAtJ,baseLongSignal:baseAtJ}:undefined;
        if(!rr)continue;const ev=evaluateRecoveryV8PositionBar(rp,rr);
        if(ev.events.includes("PARTIAL_DEFENSE")&&!partialDefense){
          const pg=ev.partialGross??PENGU_RECOVERY_V8.partial.gross;const pp=ev.triggerPrice??entry.open*(1-PENGU_RECOVERY_V8.partial.stopPct);
          partialAccountReturn=legReturn("L",pg,entry.open,pp,entry.openTime,rows[j].candle.openTime,points,cost).account;
          partialDefense=true;remainingGross=Math.max(0,gross-pg);
        }
        rp=ev.updatedPosition;
        if(["HARD_STOP","TRAILING_STOP","MAX_HOLD","YIELD_BASE_LONG"].includes(ev.kind)){
          exitIndex=j;exitPrice=ev.stopPrice??rows[j].candle.close;exitReason=\`RECOVERY_V8_\${ev.kind}\`;break;
        }
      }
      const leg=legReturn("L",remainingGross,entry.open,exitPrice,entry.openTime,rows[exitIndex].candle.openTime,points,cost);
      accountReturn=partialAccountReturn+leg.account;rawUnitReturn=accountReturn/Math.max(1e-12,gross);
    }else{
      const specialContinuation=route==="LONG_CONT"||route==="SHORT_CONT";
      if(specialContinuation){
        const hold=side==="L"?PENGU_DUAL_LS_V2.long.maxHoldHours:PENGU_DUAL_LS_V2.short.maxHoldHours;
        const naturalLast=entryIndex+hold-1,last=Math.min(rows.length-1,naturalLast);
        let best=entry.open;exitIndex=last;exitPrice=rows[last].candle.close;exitReason=last===naturalLast?(side==="L"?"LONG_MAX_HOLD":"SHORT_MAX_HOLD"):"WINDOW_END";
        for(let j=entryIndex;j<=last;j++){
          const ff=rows[j].features;if(!ff)continue;
          if(side==="L"){
            const hard=entry.open*(1-PENGU_DUAL_LS_V2.long.hardStopPct);
            if(ff.low<=hard){exitIndex=j;exitPrice=hard;exitReason="LONG_HARD_STOP";break;}
            const trailing=best*(1-0.03);
            if(best/entry.open-1>=0.06&&ff.low<=trailing){exitIndex=j;exitPrice=trailing;exitReason="LONG_TRAILING_STOP";break;}
            best=Math.max(best,ff.high);
          }else{
            const hard=entry.open*(1+PENGU_DUAL_LS_V2.short.hardStopPct);
            if(ff.high>=hard){exitIndex=j;exitPrice=hard;exitReason="SHORT_HARD_STOP";break;}
            const trailing=best*(1+0.03);
            if(entry.open/best-1>=0.06&&ff.high>=trailing){exitIndex=j;exitPrice=trailing;exitReason="SHORT_TRAILING_STOP";break;}
            best=Math.min(best,ff.low);
          }
        }
      }else{
        let pos:PenguDualLsV2Position={side:side==="L"?1:-1,entryTs:entry.openTime,entryPrice:entry.open,quantity:1,gross,highWaterMark:entry.open,lowWaterMark:entry.open,
          entryVersion:side==="S"?(route==="SHORT_V20"?"SHORT_V20":"LEGACY_V2"):"LONG_V2_FINAL",
          shortV20:route==="SHORT_V20"?createPenguShortV20State({entryPrice:entry.open,requestedGross:gross,entryAtr24Ratio:f.atr24Ratio,btcEma168Distance:f.btcEma168Distance,btcReturn24h:f.btcReturn24h}):undefined};
        const hold=side==="L"?PENGU_DUAL_LS_V2.long.maxHoldHours:PENGU_DUAL_LS_V2.short.maxHoldHours;
        const naturalLast=entryIndex+hold-1,last=Math.min(rows.length-1,naturalLast);exitIndex=last;exitPrice=rows[last].candle.close;exitReason=last===naturalLast?(side==="L"?"LONG_MAX_HOLD":"SHORT_MAX_HOLD"):"WINDOW_END";
        for(let j=entryIndex;j<=last;j++){const ff=rows[j].features;if(!ff)continue;const ev=evaluatePenguDualLsV2PositionBar(pos,ff);pos=ev.updatedPosition;if(ev.exit){exitIndex=j;exitPrice=ev.exit.stopPrice??rows[j].candle.close;exitReason=ev.exit.reason;break;}}
      }
      const leg=legReturn(side,gross,entry.open,exitPrice,entry.openTime,rows[exitIndex].candle.openTime,points,cost);accountReturn=leg.account;rawUnitReturn=leg.raw;fundingUnitReturn=leg.fu;costUnitReturn=leg.cu;
    }
    const trade:Trade={variant:v,mode,route,side,signalTs:rows[i].candle.openTime,entryTs:entry.openTime,exitTs:rows[exitIndex].candle.openTime,entryPrice:entry.open,exitPrice,requestedGross:gross,accountReturn,rawUnitReturn,fundingUnitReturn,costUnitReturn,exitReason,entryFeatures:{...f},partialDefense,partialAccountReturn,openAtWindowEnd:exitReason==="WINDOW_END"};
    trades.push(trade);
    const armBase={exitTs:rows[exitIndex].candle.openTime,exitPrice,sourceEntryTs:entry.openTime,sourceSignalTs:rows[i].candle.openTime,sourceAccountReturn:accountReturn};
    if(route==="BASE_V64_LONG"&&exitReason==="LONG_TRAILING_STOP"&&accountReturn>0)longTrail={...armBase,expiresTs:armBase.exitTs+24*HOUR};
    if(route==="SHORT_V20"&&accountReturn>0){
      shortExit={...armBase,expiresTs:armBase.exitTs+36*HOUR};
      if(exitReason==="SHORT_TRAILING_STOP"||exitReason==="SHORT_MAX_HOLD")shortTrail={...armBase,expiresTs:armBase.exitTs+24*HOUR};
    }
    cooldownUntilTs=rows[exitIndex].candle.openTime+cooldownHoursForPenguExit(exitReason as any)*HOUR;i=exitIndex+1;
  }
  return trades;
}
function metrics(ts:Trade[]){
  const closed=ts.filter(t=>!t.openAtWindowEnd);const open=ts.filter(t=>t.openAtWindowEnd);
  let eq=1,peak=1,dd=0,gp=0,gl=0;for(const t of closed){eq*=1+t.accountReturn;peak=Math.max(peak,eq);dd=Math.min(dd,eq/peak-1);if(t.accountReturn>0)gp+=t.accountReturn;else gl-=t.accountReturn;}
  let markedEq=1;for(const t of ts)markedEq*=1+t.accountReturn;
  return {trades:ts.length,closedTrades:closed.length,openTrades:open.length,returnPct:(eq-1)*100,markToWindowReturnPct:(markedEq-1)*100,openMarkedAccountReturnPct:open.reduce((a,t)=>a+t.accountReturn,0)*100,
    winRatePct:closed.length?closed.filter(t=>t.accountReturn>0).length/closed.length*100:null,profitFactor:gl>0?gp/gl:null,maxDrawdownPct:dd*100,
    longTrades:ts.filter(t=>t.side==="L").length,shortTrades:ts.filter(t=>t.side==="S").length,continuationTrades:ts.filter(t=>t.route.startsWith("TRAIL_")).length,recoveryTrades:ts.filter(t=>t.route==="RECOVERY_V8").length};
}
function between(ts:Trade[],a:number,b:number){return ts.filter(t=>t.entryTs>=a&&t.entryTs<b);}
function routeMetrics(ts:Trade[]){const routes=[...new Set(ts.map(t=>t.route))];return Object.fromEntries(routes.map(r=>[r,metrics(ts.filter(t=>t.route===r))]));}
function formalFolds(ts:Trade[]){
  const span=FORMAL_END-FORMAL_START;const a=FORMAL_START+Math.floor(span/3),b=FORMAL_START+Math.floor(span*2/3);
  return {FOLD1:metrics(between(ts,FORMAL_START,a)),FOLD2:metrics(between(ts,a,b)),FOLD3:metrics(between(ts,b,FORMAL_END))};
}
function continuationLedger(ts:Trade[]){return ts.filter(t=>t.route.startsWith("TRAIL_")).map(t=>({route:t.route,signalTs:new Date(t.signalTs).toISOString(),entryTs:new Date(t.entryTs).toISOString(),exitTs:new Date(t.exitTs).toISOString(),entryPrice:t.entryPrice,exitPrice:t.exitPrice,gross:t.requestedGross,accountReturnPct:t.accountReturn*100,exitReason:t.exitReason,openAtWindowEnd:t.openAtWindowEnd??false,sourceExitTs:t.continuationSourceExitTs?new Date(t.continuationSourceExitTs).toISOString():null,sourceExitPrice:t.continuationSourceExitPrice??null,features:{rsi14:t.entryFeatures.rsi14,penguReturn24h:t.entryFeatures.penguReturn24h,penguReturn72h:t.entryFeatures.penguReturn72h,relativeReturn24h:t.entryFeatures.relativeReturn24h,btcReturn24h:t.entryFeatures.btcReturn24h,volumeRatio:t.entryFeatures.volumeRatio6OverPrior36,atr24Ratio:t.entryFeatures.atr24Ratio,ret6h:null}}));}

type WaveDirection = "UP" | "DOWN";
type WaveClass = "CAPTURED" | "PARTIAL_EXIT_MISS" | "FULL_MISS";

interface DirectionalWaveAudit {
  thresholdPct:number;
  direction:WaveDirection;
  startIndex:number;
  endIndex:number;
  startTs:number;
  endTs:number;
  startPrice:number;
  endPrice:number;
  movePct:number;
  durationHours:number;
  classification:WaveClass;
  sameSideTradeCount:number;
  oppositeTradeCount:number;
  sameSideEntryInWave:boolean;
  lastSameSideExitTs?:number;
  lastSameSideExitPrice?:number;
  remainingAfterLastExitPct:number;
  sameSideAccountReturnPct:number;
  sameSideRawReturnPct:number;
  trigger3?:ReturnType<typeof waveTriggerSnapshot>;
  trigger5?:ReturnType<typeof waveTriggerSnapshot>;
  trades:Array<{side:"L"|"S";route:EntryRoute;entryTs:number;exitTs:number;entryPrice:number;exitPrice:number;accountReturnPct:number;rawUnitReturnPct:number;exitReason:string}>;
}

function longGateFailureClues(f:PenguDualLsV2Features){
  const r=PENGU_DUAL_LS_V2.long;
  const checks:Record<string,boolean>={
    REGIME72:f.penguReturn72h>=r.regimeReturn72hMinimum,
    BREAKOUT18:f.close>f.priorHigh18h,
    RETURN24:f.penguReturn24h>=r.penguReturn24hMinimum,
    REL24:f.relativeReturn24h>=r.relativeReturn24hMinimum,
    BTC24:f.btcReturn24h>=r.btcReturn24hMinimum,
    RSI_MIN:f.rsi14>=r.rsiMinimum,
    RSI_MAX:f.rsi14<=r.rsiMaximum,
    VOL_MIN:f.volumeRatio6OverPrior36>=r.volumeRatioMinimum,
    VOL_MAX:f.volumeRatio6OverPrior36<=r.volumeRatioMaximum,
    ATR_MAX:f.atr24Ratio<=r.atr24RatioMaximum,
    EMA168:f.close>f.ema168,
  };
  return Object.entries(checks).filter(([,ok])=>!ok).map(([k])=>k);
}
function waveTriggerSnapshot(rows:PenguDualLsV2EvaluationRow[],startIndex:number,endIndex:number,direction:WaveDirection,triggerPct:number){
  const start=rows[startIndex].candle.close;
  const target=direction==="UP"?start*(1+triggerPct/100):start*(1-triggerPct/100);
  let i=-1;
  for(let j=startIndex+1;j<=endIndex;j++){
    const close=rows[j].candle.close;
    if(direction==="UP"?close>=target:close<=target){i=j;break;}
  }
  if(i<0||!rows[i].features)return undefined;
  const f=rows[i].features!;
  return {
    triggerPct,
    referenceTs:f.referenceTs,
    referenceIso:new Date(f.referenceTs).toISOString(),
    close:f.close,
    longRaw:isPenguV8V64DynamicLongRaw(f),
    longEdgeSignal:baseLongSignal(rows,i),
    shortSignal:rows[i].shortSignal,
    longGateFailures:longGateFailureClues(f),
    features:{
      rsi14:f.rsi14,
      penguReturn24h:f.penguReturn24h,
      penguReturn72h:f.penguReturn72h,
      btcReturn24h:f.btcReturn24h,
      relativeReturn24h:f.relativeReturn24h,
      volumeRatio:f.volumeRatio6OverPrior36,
      atr24Ratio:f.atr24Ratio,
      breakoutAtr:penguV8BreakoutAtrScore(f),
      btcEma168Distance:f.btcEma168Distance,
    },
  };
}
function overlap(t:Trade,a:number,b:number){return t.entryTs<=b&&t.exitTs>=a;}
function directionalMovePct(direction:WaveDirection,start:number,end:number){
  return direction==="UP"?(end/start-1)*100:(start/end-1)*100;
}
function remainingMovePct(direction:WaveDirection,exitPrice:number,endPrice:number){
  if(!(exitPrice>0&&endPrice>0))return 0;
  return direction==="UP"?Math.max(0,(endPrice/exitPrice-1)*100):Math.max(0,(exitPrice/endPrice-1)*100);
}
function classifyWave(direction:WaveDirection,startIndex:number,endIndex:number,startPrice:number,endPrice:number,thresholdPct:number,rows:PenguDualLsV2EvaluationRow[],trades:Trade[]):DirectionalWaveAudit{
  const startTs=rows[startIndex].candle.openTime,endTs=rows[endIndex].candle.openTime;
  const wanted=direction==="UP"?"L":"S";
  const same=trades.filter(t=>t.side===wanted&&overlap(t,startTs,endTs));
  const opposite=trades.filter(t=>t.side!==wanted&&overlap(t,startTs,endTs));
  const lastExit=[...same].filter(t=>t.exitTs<endTs).sort((a,b)=>b.exitTs-a.exitTs)[0];
  const remaining=lastExit?remainingMovePct(direction,lastExit.exitPrice,endPrice):0;
  const classification:WaveClass=same.length===0?"FULL_MISS":remaining>=5?"PARTIAL_EXIT_MISS":"CAPTURED";
  return {
    thresholdPct,direction,startIndex,endIndex,startTs,endTs,startPrice,endPrice,
    movePct:directionalMovePct(direction,startPrice,endPrice),
    durationHours:(endTs-startTs)/HOUR,
    classification,
    sameSideTradeCount:same.length,
    oppositeTradeCount:opposite.length,
    sameSideEntryInWave:same.some(t=>t.entryTs>=startTs&&t.entryTs<=endTs),
    lastSameSideExitTs:lastExit?.exitTs,
    lastSameSideExitPrice:lastExit?.exitPrice,
    remainingAfterLastExitPct:remaining,
    sameSideAccountReturnPct:same.reduce((a,t)=>a+t.accountReturn*100,0),
    sameSideRawReturnPct:same.reduce((a,t)=>a+t.rawUnitReturn*100,0),
    trigger3:waveTriggerSnapshot(rows,startIndex,endIndex,direction,3),
    trigger5:waveTriggerSnapshot(rows,startIndex,endIndex,direction,5),
    trades:[...same,...opposite].sort((a,b)=>a.entryTs-b.entryTs).map(t=>({side:t.side,route:t.route,entryTs:t.entryTs,exitTs:t.exitTs,entryPrice:t.entryPrice,exitPrice:t.exitPrice,accountReturnPct:t.accountReturn*100,rawUnitReturnPct:t.rawUnitReturn*100,exitReason:t.exitReason})),
  };
}
function detectUpWaves(rows:PenguDualLsV2EvaluationRow[],startTs:number,endTs:number,thresholdPct:number,trades:Trade[]){
  const first=rows.findIndex(r=>r.candle.openTime>=startTs);if(first<0)return[] as DirectionalWaveAudit[];
  const delta=thresholdPct/100;let lowIndex=first,low=rows[first].candle.close,i=first+1;const out:DirectionalWaveAudit[]=[];
  while(i<rows.length&&rows[i].candle.openTime<endTs){
    const close=rows[i].candle.close;
    if(close<low){low=close;lowIndex=i;i++;continue;}
    if(close/low-1<delta){i++;continue;}
    let peakIndex=i,peak=close,j=i+1;
    while(j<rows.length&&rows[j].candle.openTime<endTs){
      const c=rows[j].candle.close;
      if(c>peak){peak=c;peakIndex=j;}
      if(c/peak-1<=-delta)break;
      j++;
    }
    out.push(classifyWave("UP",lowIndex,peakIndex,low,peak,thresholdPct,rows,trades));
    if(j>=rows.length||rows[j].candle.openTime>=endTs)break;
    lowIndex=j;low=rows[j].candle.close;i=j+1;
  }
  return out;
}
function detectDownWaves(rows:PenguDualLsV2EvaluationRow[],startTs:number,endTs:number,thresholdPct:number,trades:Trade[]){
  const first=rows.findIndex(r=>r.candle.openTime>=startTs);if(first<0)return[] as DirectionalWaveAudit[];
  const delta=thresholdPct/100;let highIndex=first,high=rows[first].candle.close,i=first+1;const out:DirectionalWaveAudit[]=[];
  while(i<rows.length&&rows[i].candle.openTime<endTs){
    const close=rows[i].candle.close;
    if(close>high){high=close;highIndex=i;i++;continue;}
    if(1-close/high<delta){i++;continue;}
    let troughIndex=i,trough=close,j=i+1;
    while(j<rows.length&&rows[j].candle.openTime<endTs){
      const c=rows[j].candle.close;
      if(c<trough){trough=c;troughIndex=j;}
      if(c/trough-1>=delta)break;
      j++;
    }
    out.push(classifyWave("DOWN",highIndex,troughIndex,high,trough,thresholdPct,rows,trades));
    if(j>=rows.length||rows[j].candle.openTime>=endTs)break;
    highIndex=j;high=rows[j].candle.close;i=j+1;
  }
  return out;
}
function summarizeWaves(waves:DirectionalWaveAudit[]){
  const groups=(["UP","DOWN"] as const).map(direction=>{
    const x=waves.filter(w=>w.direction===direction);
    return [direction,{
      waves:x.length,
      captured:x.filter(w=>w.classification==="CAPTURED").length,
      partialExitMiss:x.filter(w=>w.classification==="PARTIAL_EXIT_MISS").length,
      fullMiss:x.filter(w=>w.classification==="FULL_MISS").length,
      missedOrPartial:x.filter(w=>w.classification!=="CAPTURED").length,
      avgMovePct:x.length?x.reduce((a,w)=>a+w.movePct,0)/x.length:0,
      biggestMovePct:x.length?Math.max(...x.map(w=>w.movePct)):0,
    }] as const;
  });
  return Object.fromEntries(groups);
}
function waveAuditWindow(rows:PenguDualLsV2EvaluationRow[],trades:Trade[],startTs:number,endTs:number){
  const thresholds=[10,15,20,30];
  const byThreshold:any={};const all:DirectionalWaveAudit[]=[];
  for(const t of thresholds){
    const waves=[...detectUpWaves(rows,startTs,endTs,t,trades),...detectDownWaves(rows,startTs,endTs,t,trades)].sort((a,b)=>a.startTs-b.startTs||a.direction.localeCompare(b.direction));
    byThreshold[String(t)]={summary:summarizeWaves(waves),waves};
    all.push(...waves.map(w=>({...w})));
  }
  const major15=(byThreshold["15"].waves as DirectionalWaveAudit[]);
  const missedMajor=major15.filter(w=>w.classification!=="CAPTURED").sort((a,b)=>b.movePct-a.movePct);
  return {
    startIso:new Date(startTs).toISOString(),endIso:new Date(endTs).toISOString(),
    byThreshold,
    major15Missed:missedMajor,
    major15MissedCount:missedMajor.length,
    major15Total:major15.length,
  };
}


function rescueSummary(rows:PenguDualLsV2EvaluationRow[],baseline:Trade[],candidate:Trade[],start:number,end:number,direction:WaveDirection){
  const baseWaves=[...detectUpWaves(rows,start,end,15,baseline),...detectDownWaves(rows,start,end,15,baseline)].filter(w=>w.direction===direction);
  const missed=baseWaves.filter(w=>w.classification!=="CAPTURED");
  let captured=0,fullToAny=0,improved=0;
  const details=missed.map(w=>{
    const c=classifyWave(w.direction,w.startIndex,w.endIndex,w.startPrice,w.endPrice,w.thresholdPct,rows,candidate);
    if(c.classification==="CAPTURED")captured++;
    if(w.classification==="FULL_MISS"&&c.sameSideTradeCount>0)fullToAny++;
    const score=(x:WaveClass)=>x==="FULL_MISS"?0:x==="PARTIAL_EXIT_MISS"?1:2;
    if(score(c.classification)>score(w.classification))improved++;
    return {direction:w.direction,start:new Date(w.startTs).toISOString(),end:new Date(w.endTs).toISOString(),movePct:w.movePct,baseline:w.classification,candidate:c.classification,baselineRemaining:w.remainingAfterLastExitPct,candidateRemaining:c.remainingAfterLastExitPct,candidateSameSideReturnPct:c.sameSideAccountReturnPct};
  });
  return {baselineMissed:missed.length,rescuedToCaptured:captured,fullMissNowHasTrade:fullToAny,classificationImproved:improved,details};
}
async function main(){
  const [p,b,fp]=await Promise.all([candles("PENGUUSDT"),candles("BTCUSDT"),funding()]);
  const common=new Set(p.map(x=>x.openTime));const btc=b.filter(x=>common.has(x.openTime));const btcSet=new Set(btc.map(x=>x.openTime));const pengu=p.filter(x=>btcSet.has(x.openTime));
  assert.equal(pengu.length,btc.length);assert.ok(pengu.length>9000,\`insufficient common rows \${pengu.length}\`);
  const history:PenguDualLsV2History={pengu1h:pengu,btc1h:btc,penguFunding:fp};
  const rows=buildPenguDualLsV2EvaluationSeries(history,RECENT_END+1);
  const rollingStart=RECENT_END-365*24*HOUR;
  const variants:Variant[]=["BASELINE","LONG_CONT","LONG_SHORT_EXIT_FLIP","LONG_DEEP_RECLAIM","SHORT_CONT","SHORT_BLOWOFF_REVERSAL","SHORT_DIRECT_BREAKDOWN"];
  const windows=[{name:"FORMAL",start:FORMAL_START,end:FORMAL_END},{name:"ROLLING365",start:rollingStart,end:RECENT_END}];
  const result:any={schema:"pengu-wave-cover-stage1/v1",source:{venue:"ASTER_FUTURES_V3",productionSourceSha:process.env.PRODUCTION_SOURCE_SHA||null},candidateContracts:{
    LONG_CONT:{purpose:"extend profitable V64 Long trailing waves",arm:"profitable BASE_V64_LONG LONG_TRAILING_STOP, 24h",ret6Min:.03,distance18hHighAtrMax:.50,ret24Min:.10,ret72:[.15,.40],relative24Min:.05,btc24Min:0,rsi:[55,90],exit:"6% activation / 3% retrace"},
    LONG_SHORT_EXIT_FLIP:{purpose:"catch rebound after profitable Short exit",arm:"profitable SHORT_V20 exit, 36h",ret6Min:.03,ret24Min:-.02,ret72Max:.05,relative24Min:0,btc24Min:-.03,rsi:[45,75],requireCloseAboveEma72:true},
    LONG_DEEP_RECLAIM:{purpose:"catch V reversal after deep decline",ret72:[-.45,-.10],ret24Min:.02,ret6Min:.04,relative24Min:.015,btc24Min:-.03,rsi:[45,72],requireCloseAboveEma72:true},
    SHORT_CONT:{purpose:"extend profitable Short waves",arm:"profitable SHORT_V20 trail/maxhold, 24h",ret6Max:-.03,distance18hLowAtrMax:.50,ret24Max:-.10,ret72:[-.40,-.15],relative24Max:-.05,btc24Max:0,rsi:[10,45],exit:"6% activation / 3% retrace"},
    SHORT_BLOWOFF_REVERSAL:{purpose:"catch early reversal from strong bullish regime",ret72:[.12,.45],ret6Max:-.035,drawdown18hHighMin:.04,btc24Max:.04,rsi:[30,60],requireCloseBelowPreviousLow:true},
    SHORT_DIRECT_BREAKDOWN:{purpose:"direct breakdown without bounce/rearm requirement",ret6Max:-.035,ret24Max:-.03,ret72Max:.10,relative24Max:-.015,btc24Max:.04,rsi:[30,58],requireCloseBelowPreviousLowAndEma72:true},
  },windows:{},safety:{researchOnly:true,ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  const cache:any={};
  for(const mode of ["NORMAL","SEVERE"] as Mode[])for(const v of variants)cache[\`\${mode}:\${v}\`]=replay(rows,fp,v,mode);
  for(const w of windows){
    const baseN=between(cache["NORMAL:BASELINE"],w.start,w.end),baseS=between(cache["SEVERE:BASELINE"],w.start,w.end);
    const out:any={start:new Date(w.start).toISOString(),end:new Date(w.end).toISOString(),baseline:{NORMAL:metrics(baseN),SEVERE:metrics(baseS)},variants:{}};
    for(const v of variants.filter(x=>x!=="BASELINE")){
      const n=between(cache[\`NORMAL:\${v}\`],w.start,w.end),sv=between(cache[\`SEVERE:\${v}\`],w.start,w.end);
      const direction:WaveDirection=v.startsWith("LONG_")?"UP":"DOWN";
      const nm=metrics(n),sm=metrics(sv),bn=metrics(baseN),bs=metrics(baseS);
      out.variants[v]={
        NORMAL:nm,SEVERE:sm,
        delta:{normalReturnPct:nm.returnPct-bn.returnPct,severeReturnPct:sm.returnPct-bs.returnPct,normalWinRatePct:(nm.winRatePct??0)-(bn.winRatePct??0),severeWinRatePct:(sm.winRatePct??0)-(bs.winRatePct??0),normalPf:(nm.profitFactor??0)-(bn.profitFactor??0),severePf:(sm.profitFactor??0)-(bs.profitFactor??0),normalDdPct:nm.maxDrawdownPct-bn.maxDrawdownPct,severeDdPct:sm.maxDrawdownPct-bs.maxDrawdownPct},
        addedRoute:routeMetrics(n),
        wave15:rescueSummary(rows,baseN,n,w.start,w.end,direction),
        addedTrades:n.filter(t=>t.route===v).map(t=>({entry:new Date(t.entryTs).toISOString(),exit:new Date(t.exitTs).toISOString(),side:t.side,route:t.route,accountReturnPct:t.accountReturn*100,rawReturnPct:t.rawUnitReturn*100,exitReason:t.exitReason,features:{rsi:t.entryFeatures.rsi14,p24:t.entryFeatures.penguReturn24h,p72:t.entryFeatures.penguReturn72h,btc24:t.entryFeatures.btcReturn24h,rel24:t.entryFeatures.relativeReturn24h,vol:t.entryFeatures.volumeRatio6OverPrior36,atr:t.entryFeatures.atr24Ratio}})),
      };
    }
    result.windows[w.name]=out;
  }
  await fs.mkdir(".research-state/pengu-wave-cover-stage1",{recursive:true});
  await fs.writeFile(".research-state/pengu-wave-cover-stage1/result.json",JSON.stringify(result,null,2)+"\n");
  console.log("PENGU_WAVE_COVER_STAGE1="+JSON.stringify(result));
}
main().catch(e=>{console.error(e);process.exit(1);});
