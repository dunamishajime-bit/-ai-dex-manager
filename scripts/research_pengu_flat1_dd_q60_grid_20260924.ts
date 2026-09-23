import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";
import { PENGU_RECOVERY_V8, PENGU_V8_V64_BASE } from "../config/penguRecoveryV8";
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

type Variant = "BASELINE" | "LONG_PAIR" | "SHORT_BLOWOFF_RAW" | "SHORT_BLOWOFF_FILTERED" | "COMBINED_RAW" | "COMBINED_FILTERED";
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
      const res=await fetch(url,{headers:{accept:"application/json","user-agent":"DisDex-PENGU-Flat1-DD-Q60-Grid/20260924"}});
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

function shortBlowoffFilteredRaw(rows:readonly PenguDualLsV2EvaluationRow[],i:number){
  const f=rows[i]?.features;if(!f)return false;
  return shortBlowoffRaw(rows,i)
    && f.btcReturn24h<=0.02
    && f.penguReturn24h<=0.06;
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

function usesLongPair(v:Variant){return v==="LONG_PAIR"||v==="COMBINED_RAW"||v==="COMBINED_FILTERED";}
function usesShortRaw(v:Variant){return v==="SHORT_BLOWOFF_RAW"||v==="COMBINED_RAW";}
function usesShortFiltered(v:Variant){return v==="SHORT_BLOWOFF_FILTERED"||v==="COMBINED_FILTERED";}
function supplementalRoute(
  rows:readonly PenguDualLsV2EvaluationRow[],
  i:number,
  v:Variant,
  arms:{longTrail?:ProfitExitArm;shortExit?:ProfitExitArm;shortTrail?:ProfitExitArm},
):EntryRoute|undefined{
  if(usesShortFiltered(v)&&risingEdge(rows,i,shortBlowoffFilteredRaw))return "SHORT_BLOWOFF_REVERSAL";
  if(usesShortRaw(v)&&risingEdge(rows,i,shortBlowoffRaw))return "SHORT_BLOWOFF_REVERSAL";
  if(usesLongPair(v)&&longContCondition(rows,i,arms.longTrail))return "LONG_CONT";
  if(usesLongPair(v)&&longShortExitFlipCondition(rows,i,arms.shortExit))return "LONG_SHORT_EXIT_FLIP";
  return undefined;
}
function routeSide(route:EntryRoute):"L"|"S"{
  return route==="SHORT_V20"||route.startsWith("SHORT_")?"S":"L";
}

type AllocationMode =
  | "CAP1_CURRENT_DESIGN"
  | "CAP1_LOW_SCALED"
  | "CAP1_RECOVERY_SCALED"
  | "CAP1_LOW_AND_RECOVERY_SCALED"
  | "CAP1_ALL_OLD_ORDERS_LINEAR"
  | "CAP1_EVERY_ENTRY_FLAT";
type DDMode =
  | "BASELINE_FLAT1"
  | "V64_PROTECT_6_8_3"
  | "RECOVERY_PROTECT_5_12_3"
  | "SHORT_PROTECT_6_10_3"
  | "HARDSTOP_COOLDOWN48"
  | "COMBINED_PROTECT"
  | "COMBINED_PROTECT_COOLDOWN48"
  | "ROUTE_HARDSTOP_Q72"
  | "ROUTE_HARDSTOP_Q120"
  | "ROUTE_HARDSTOP_Q168"
  | "SIDE_HARDSTOP_Q72"
  | "SIDE_HARDSTOP_Q120"
  | "LOSS2_GLOBAL_Q72"
  | "LOSS2_GLOBAL_Q120"
  | "ROUTE2LOSS14D_Q168"
  | "DD8_Q168"
  | "DD10_Q168"
  | "DD12_Q168"
  | "ROUTE120_LOSS2_Q72"
  | "ROUTE120_DD10_Q168"
  | "SMART_GOVERNOR"
  | "ROUTE_HARDSTOP_Q48"
  | "ROUTE_HARDSTOP_Q60"
  | "ROUTE_HARDSTOP_Q84"
  | "ROUTE_HARDSTOP_Q96"
  | "ROUTE72_RECOVERY96"
  | "ROUTE72_RECOVERY120"
  | "ROUTE72_SHORT96"
  | "ROUTE_LOSS4_Q72"
  | "ROUTE_ANYLOSS_Q72"
  | "ROUTE72_LOSS2_Q48"
  | "ROUTE72_DD15_Q72"
  | "ROUTE72_DD18_Q72"
  | "Q60_DD13_H48"
  | "Q60_DD14_H48"
  | "Q60_DD15_H48"
  | "Q60_DD16_H48"
  | "Q60_DD17_H48"
  | "Q60_DD13_H72"
  | "Q60_DD14_H72"
  | "Q60_DD15_H72"
  | "Q60_DD16_H72"
  | "Q60_DD17_H72"
  | "Q60_DD15_H96";
let ddMode:DDMode="BASELINE_FLAT1";
function v64Protect(){return ddMode==="V64_PROTECT_6_8_3"||ddMode==="COMBINED_PROTECT"||ddMode==="COMBINED_PROTECT_COOLDOWN48";}
function recoveryProtect(){return ddMode==="RECOVERY_PROTECT_5_12_3"||ddMode==="COMBINED_PROTECT"||ddMode==="COMBINED_PROTECT_COOLDOWN48";}
function shortProtect(){return ddMode==="SHORT_PROTECT_6_10_3"||ddMode==="COMBINED_PROTECT"||ddMode==="COMBINED_PROTECT_COOLDOWN48";}
function cooldown48(){return ddMode==="HARDSTOP_COOLDOWN48"||ddMode==="COMBINED_PROTECT_COOLDOWN48";}
function routeHardstopHours(route?:EntryRoute){
  if(ddMode==="ROUTE_HARDSTOP_Q48")return 48;
  if(ddMode==="ROUTE_HARDSTOP_Q60"||ddMode.startsWith("Q60_DD"))return 60;
  if(ddMode==="ROUTE_HARDSTOP_Q72"||ddMode==="ROUTE72_LOSS2_Q48"||ddMode==="ROUTE72_DD15_Q72"||ddMode==="ROUTE72_DD18_Q72")return 72;
  if(ddMode==="ROUTE_HARDSTOP_Q84")return 84;
  if(ddMode==="ROUTE_HARDSTOP_Q96")return 96;
  if(ddMode==="ROUTE_HARDSTOP_Q120"||ddMode==="ROUTE120_LOSS2_Q72"||ddMode==="ROUTE120_DD10_Q168"||ddMode==="SMART_GOVERNOR")return 120;
  if(ddMode==="ROUTE_HARDSTOP_Q168")return 168;
  if(ddMode==="ROUTE72_RECOVERY96")return route==="RECOVERY_V8"?96:72;
  if(ddMode==="ROUTE72_RECOVERY120")return route==="RECOVERY_V8"?120:72;
  if(ddMode==="ROUTE72_SHORT96")return routeSide(route as EntryRoute)==="S"?96:72;
  return 0;
}
function sideHardstopHours(){
  if(ddMode==="SIDE_HARDSTOP_Q72")return 72;
  if(ddMode==="SIDE_HARDSTOP_Q120")return 120;
  return 0;
}
function loss2GlobalHours(){
  if(ddMode==="ROUTE72_LOSS2_Q48")return 48;
  if(ddMode==="LOSS2_GLOBAL_Q72"||ddMode==="ROUTE120_LOSS2_Q72"||ddMode==="SMART_GOVERNOR")return 72;
  if(ddMode==="LOSS2_GLOBAL_Q120")return 120;
  return 0;
}
function route2Loss14dHours(){return ddMode==="ROUTE2LOSS14D_Q168"?168:0;}
function strategyDdGovernor(){
  if(ddMode==="DD8_Q168")return {threshold:-0.08,hours:168};
  if(ddMode==="DD10_Q168"||ddMode==="ROUTE120_DD10_Q168"||ddMode==="SMART_GOVERNOR")return {threshold:-0.10,hours:168};
  if(ddMode==="DD12_Q168")return {threshold:-0.12,hours:168};
  if(ddMode==="ROUTE72_DD15_Q72")return {threshold:-0.15,hours:72};
  if(ddMode==="ROUTE72_DD18_Q72")return {threshold:-0.18,hours:72};
  const q60=String(ddMode).match(/^Q60_DD(13|14|15|16|17)_H(48|72|96)$/);
  if(q60)return {threshold:-Number(q60[1])/100,hours:Number(q60[2])};
  return undefined;
}
function routeLossQuarantineHours(accountReturn:number){
  if(ddMode==="ROUTE_LOSS4_Q72"&&accountReturn<=-0.04)return 72;
  if(ddMode==="ROUTE_ANYLOSS_Q72"&&accountReturn<0)return 72;
  return 0;
}
const governorAuditStore:Record<string,any>={};


const CAP = 1.0 as const;
const OLD_CAP = 0.85 as const;
const FACTOR = CAP / OLD_CAP;
let allocationMode:AllocationMode = "CAP1_CURRENT_DESIGN";
function scaleLow(){return allocationMode==="CAP1_LOW_SCALED"||allocationMode==="CAP1_LOW_AND_RECOVERY_SCALED"||allocationMode==="CAP1_ALL_OLD_ORDERS_LINEAR";}
function scaleRecovery(){return allocationMode==="CAP1_RECOVERY_SCALED"||allocationMode==="CAP1_LOW_AND_RECOVERY_SCALED"||allocationMode==="CAP1_ALL_OLD_ORDERS_LINEAR";}
function effectiveFloor(){return PENGU_DUAL_LS_V2.sizing.grossFloor*(allocationMode==="CAP1_ALL_OLD_ORDERS_LINEAR"?FACTOR:1);}
function recoveryInitialGross(){return allocationMode==="CAP1_EVERY_ENTRY_FLAT"?CAP:PENGU_RECOVERY_V8.initialGross*(scaleRecovery()?FACTOR:1);}
function recoveryPartialGross(){return allocationMode==="CAP1_EVERY_ENTRY_FLAT"?CAP/2:PENGU_RECOVERY_V8.partial.gross*(scaleRecovery()?FACTOR:1);}
function researchTargetGrossForAtr(atr24Ratio:number){
  if(!Number.isFinite(atr24Ratio)||atr24Ratio<=0)return 0;
  return Math.min(CAP,Math.max(effectiveFloor(),CAP*PENGU_DUAL_LS_V2.sizing.targetVolatility/atr24Ratio));
}
function researchV64RequestedLongGross(f:PenguDualLsV2Features){
  if(!Number.isFinite(f.atr24Ratio)||f.atr24Ratio<=0)return 0;
  const multiplier=PENGU_V8_V64_BASE.longMultiplier;
  const floor=effectiveFloor()*multiplier;
  const target=CAP*PENGU_DUAL_LS_V2.sizing.targetVolatility/f.atr24Ratio*multiplier;
  const baseGross=Math.min(CAP*multiplier,Math.max(floor,target));
  const lowGross=PENGU_V8_V64_BASE.lowGross*(scaleLow()?FACTOR:1);
  return f.penguReturn72h<=PENGU_V8_V64_BASE.lowGrossRule.threshold?baseGross:Math.min(baseGross,lowGross);
}
function researchShortV20State(input:{entryPrice:number;requestedGross:number;entryAtr24Ratio:number;btcEma168Distance:number;btcReturn24h:number}){
  const state=createPenguShortV20State(input);
  const eps=1e-12;
  state.sizingState=Math.abs(input.requestedGross-CAP)<=eps
    ? "CAP"
    : Math.abs(input.requestedGross-effectiveFloor())<=eps
      ? "FLOOR"
      : "VOL_TARGET";
  return state;
}
function acceptedGross(route:EntryRoute,f:PenguDualLsV2Features){
  if(allocationMode==="CAP1_EVERY_ENTRY_FLAT")return CAP;
  if(route==="RECOVERY_V8")return Math.min(CAP,recoveryInitialGross());
  if(routeSide(route)==="S")return Math.min(CAP,researchTargetGrossForAtr(f.atr24Ratio));
  return Math.min(CAP,researchV64RequestedLongGross(f));
}
function legReturn(side:"L"|"S",gross:number,entry:number,exit:number,entryTs:number,exitTs:number,points:FundingPoint[],cost:number){
  const raw=side==="L"?exit/entry-1:entry/exit-1;
  const fr=fundingBetween(points,entryTs,exitTs);const fu=side==="L"?-fr:fr;const cu=-2*cost;
  return {raw,fu,cu,account:gross*(raw+fu+cu)};
}

function replay(rows:PenguDualLsV2EvaluationRow[],points:FundingPoint[],v:Variant,mode:Mode){
  const cost=BASE_FEE_PER_SIDE+(mode==="SEVERE"?STRESS_SLIPPAGE_PER_SIDE:0);const trades:Trade[]=[];
  let i=250,cooldownUntilTs=0,globalGovernorUntilTs=0;
  let longTrail:ProfitExitArm|undefined,shortExit:ProfitExitArm|undefined,shortTrail:ProfitExitArm|undefined;
  const routeGovernorUntil=new Map<EntryRoute,number>();
  const sideGovernorUntil:{L:number;S:number}={L:0,S:0};
  const recentRouteLosses=new Map<EntryRoute,number[]>();
  let consecutiveLosses=0,realizedEquity=1,realizedPeak=1;
  const governorEvents:Array<Record<string,unknown>>=[];
  const isAllowed=(route:EntryRoute,ts:number)=>{
    const side=routeSide(route);
    return ts>=globalGovernorUntilTs && ts>=(routeGovernorUntil.get(route)??0) && ts>=sideGovernorUntil[side];
  };
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
    const routeCandidates:EntryRoute[]=[];
    if(rows[i].shortSignal)routeCandidates.push("SHORT_V20");
    if(extraSide==="S"&&extra)routeCandidates.push(extra);
    if(baseLong)routeCandidates.push("BASE_V64_LONG");
    if(extraSide==="L"&&extra)routeCandidates.push(extra);
    if(recovery?.kind==="RECOVERY_V8")routeCandidates.push("RECOVERY_V8");
    route=routeCandidates.find(r=>isAllowed(r,currentReferenceTs));
    if(!route){
      if(routeCandidates.length>0 && routeCandidates.some(r=>!isAllowed(r,currentReferenceTs))){
        governorEvents.push({kind:"BLOCK",ts:currentReferenceTs,candidates:routeCandidates,globalUntil:globalGovernorUntilTs,
          routeUntil:Object.fromEntries(routeCandidates.map(r=>[r,routeGovernorUntil.get(r)??0])),
          sideUntil:{...sideGovernorUntil}});
      }
      i++;continue;
    }
    const side=routeSide(route);const entryIndex=i+1,entry=rows[entryIndex].candle,gross=acceptedGross(route,f);
    let exitIndex=entryIndex,exitPrice=entry.open,exitReason="WINDOW_END",partialDefense=false,partialAccountReturn=0,accountReturn=0,rawUnitReturn=0,fundingUnitReturn=0,costUnitReturn=0;
    if(route==="RECOVERY_V8"){
      let rp:RecoveryV8Position={side:1,entryTs:entry.openTime,entryPrice:entry.open,quantity:1,originalGross:gross,remainingGross:gross,partialDefenseTriggered:false,highWaterMark:entry.open};
      const naturalLast=entryIndex+PENGU_RECOVERY_V8.exit.maxHoldHours-1;const last=Math.min(rows.length-1,naturalLast);exitIndex=last;exitPrice=rows[last].candle.close;exitReason=last===naturalLast?"RECOVERY_V8_MAX_HOLD":"WINDOW_END";
      let remainingGross=gross;
      for(let j=entryIndex;j<=last;j++){
        const baseAtJ=baseLongSignal(rows,j);
        const rr=rows[j].recoveryV8?{...rows[j].recoveryV8,ordinaryLongEligible:baseAtJ,baseLongSignal:baseAtJ}:undefined;
        if(!rr)continue;
        if(recoveryProtect()){
          if(!partialDefense && rr.referenceTs>=entry.openTime+12*HOUR && rr.low<=entry.open*0.97){
            const pg=0.5,pp=entry.open*0.97;
            partialAccountReturn=legReturn("L",pg,entry.open,pp,entry.openTime,rows[j].candle.openTime,points,cost).account;
            partialDefense=true;remainingGross=0.5;
            rp={...rp,quantity:0.5,remainingGross:0.5,partialDefenseTriggered:true};
          }
          if(rr.low<=entry.open*0.95){
            exitIndex=j;exitPrice=entry.open*0.95;exitReason="RECOVERY_V8_RESEARCH_HARD_STOP_5";break;
          }
          const recoveryBest=Math.max(entry.open,rp.highWaterMark);
          if(recoveryBest/entry.open-1>=0.05 && rr.low<=recoveryBest*(1-0.025)){
            exitIndex=j;exitPrice=recoveryBest*(1-0.025);exitReason="RECOVERY_V8_RESEARCH_TRAILING_5_2P5";break;
          }
        }
        const ev=evaluateRecoveryV8PositionBar(rp,rr);
        if(ev.events.includes("PARTIAL_DEFENSE")&&!partialDefense){
          const pg=recoveryPartialGross();const pp=ev.triggerPrice??entry.open*(1-PENGU_RECOVERY_V8.partial.stopPct);
          partialAccountReturn=legReturn("L",pg,entry.open,pp,entry.openTime,rows[j].candle.openTime,points,cost).account;
          partialDefense=true;remainingGross=Math.max(0,gross-pg);
        }
        rp={...ev.updatedPosition,originalGross:gross,remainingGross};
        if(["HARD_STOP","TRAILING_STOP","MAX_HOLD","YIELD_BASE_LONG"].includes(ev.kind)){
          exitIndex=j;exitPrice=ev.stopPrice??rows[j].candle.close;exitReason=`RECOVERY_V8_${ev.kind}`;break;
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
          shortV20:route==="SHORT_V20"?researchShortV20State({entryPrice:entry.open,requestedGross:gross,entryAtr24Ratio:f.atr24Ratio,btcEma168Distance:f.btcEma168Distance,btcReturn24h:f.btcReturn24h}):undefined};
        const hold=side==="L"?PENGU_DUAL_LS_V2.long.maxHoldHours:PENGU_DUAL_LS_V2.short.maxHoldHours;
        const naturalLast=entryIndex+hold-1,last=Math.min(rows.length-1,naturalLast);exitIndex=last;exitPrice=rows[last].candle.close;exitReason=last===naturalLast?(side==="L"?"LONG_MAX_HOLD":"SHORT_MAX_HOLD"):"WINDOW_END";
        for(let j=entryIndex;j<=last;j++){
          const ff=rows[j].features;if(!ff)continue;
          if(route==="BASE_V64_LONG"&&v64Protect()){
            const hard=entry.open*0.94;
            if(ff.low<=hard){exitIndex=j;exitPrice=hard;exitReason="LONG_RESEARCH_HARD_STOP_6";break;}
            const best=Math.max(entry.open,pos.highWaterMark);
            if(best/entry.open-1>=0.08&&ff.low<=best*0.97){exitIndex=j;exitPrice=best*0.97;exitReason="LONG_RESEARCH_TRAILING_8_3";break;}
          }
          if(route==="SHORT_V20"&&shortProtect()){
            const hard=entry.open*1.06;
            if(ff.high>=hard){exitIndex=j;exitPrice=hard;exitReason="SHORT_RESEARCH_HARD_STOP_6";break;}
            const best=Math.min(entry.open,pos.lowWaterMark);
            if(entry.open/best-1>=0.10&&ff.high>=best*1.03){exitIndex=j;exitPrice=best*1.03;exitReason="SHORT_RESEARCH_TRAILING_10_3";break;}
          }
          const ev=evaluatePenguDualLsV2PositionBar(pos,ff);pos=ev.updatedPosition;
          if(ev.exit){exitIndex=j;exitPrice=ev.exit.stopPrice??rows[j].candle.close;exitReason=ev.exit.reason;break;}
        }
      }
      const leg=legReturn(side,gross,entry.open,exitPrice,entry.openTime,rows[exitIndex].candle.openTime,points,cost);accountReturn=leg.account;rawUnitReturn=leg.raw;fundingUnitReturn=leg.fu;costUnitReturn=leg.cu;
    }
    const trade:Trade={variant:v,mode,route,side,signalTs:rows[i].candle.openTime,entryTs:entry.openTime,exitTs:rows[exitIndex].candle.openTime,entryPrice:entry.open,exitPrice,requestedGross:gross,accountReturn,rawUnitReturn,fundingUnitReturn,costUnitReturn,exitReason,entryFeatures:{...f},partialDefense,partialAccountReturn,openAtWindowEnd:exitReason==="WINDOW_END"};
    trades.push(trade);

    const tradeExitTs=rows[exitIndex].candle.openTime;
    realizedEquity*=1+accountReturn;
    realizedPeak=Math.max(realizedPeak,realizedEquity);
    const realizedDd=realizedEquity/realizedPeak-1;
    if(accountReturn<0) consecutiveLosses+=1; else consecutiveLosses=0;

    const routeHours=routeHardstopHours(route);
    if(routeHours>0 && exitReason.includes("HARD_STOP")){
      const until=tradeExitTs+routeHours*HOUR;
      routeGovernorUntil.set(route,Math.max(routeGovernorUntil.get(route)??0,until));
      governorEvents.push({kind:"ROUTE_HARDSTOP",route,side,exitTs:tradeExitTs,until,returnPct:accountReturn*100});
    }

    const routeLossHours=routeLossQuarantineHours(accountReturn);
    if(routeLossHours>0){
      const until=tradeExitTs+routeLossHours*HOUR;
      routeGovernorUntil.set(route,Math.max(routeGovernorUntil.get(route)??0,until));
      governorEvents.push({kind:"ROUTE_LOSS",route,side,exitTs:tradeExitTs,until,returnPct:accountReturn*100});
    }

    const sideHours=sideHardstopHours();
    if(sideHours>0 && exitReason.includes("HARD_STOP")){
      const until=tradeExitTs+sideHours*HOUR;
      sideGovernorUntil[side]=Math.max(sideGovernorUntil[side],until);
      governorEvents.push({kind:"SIDE_HARDSTOP",route,side,exitTs:tradeExitTs,until,returnPct:accountReturn*100});
    }

    const lossHours=loss2GlobalHours();
    if(lossHours>0 && consecutiveLosses>=2){
      const until=tradeExitTs+lossHours*HOUR;
      globalGovernorUntilTs=Math.max(globalGovernorUntilTs,until);
      governorEvents.push({kind:"LOSS2_GLOBAL",route,side,exitTs:tradeExitTs,until,streak:consecutiveLosses,returnPct:accountReturn*100});
      consecutiveLosses=0;
    }

    const routeStrikeHours=route2Loss14dHours();
    if(routeStrikeHours>0 && accountReturn<0){
      const prior=(recentRouteLosses.get(route)??[]).filter(ts=>tradeExitTs-ts<=14*24*HOUR);
      prior.push(tradeExitTs);recentRouteLosses.set(route,prior);
      if(prior.length>=2){
        const until=tradeExitTs+routeStrikeHours*HOUR;
        routeGovernorUntil.set(route,Math.max(routeGovernorUntil.get(route)??0,until));
        governorEvents.push({kind:"ROUTE_2LOSS_14D",route,side,exitTs:tradeExitTs,until,count:prior.length});
        recentRouteLosses.set(route,[]);
      }
    }

    const ddGov=strategyDdGovernor();
    if(ddGov && realizedDd<=ddGov.threshold){
      const until=tradeExitTs+ddGov.hours*HOUR;
      globalGovernorUntilTs=Math.max(globalGovernorUntilTs,until);
      governorEvents.push({kind:"STRATEGY_DD",route,side,exitTs:tradeExitTs,until,drawdown:realizedDd,equity:realizedEquity,peak:realizedPeak});
    }

    const armBase={exitTs:rows[exitIndex].candle.openTime,exitPrice,sourceEntryTs:entry.openTime,sourceSignalTs:rows[i].candle.openTime,sourceAccountReturn:accountReturn};
    if(route==="BASE_V64_LONG"&&exitReason==="LONG_TRAILING_STOP"&&accountReturn>0)longTrail={...armBase,expiresTs:armBase.exitTs+24*HOUR};
    if(route==="SHORT_V20"&&accountReturn>0){
      shortExit={...armBase,expiresTs:armBase.exitTs+36*HOUR};
      if(exitReason==="SHORT_TRAILING_STOP"||exitReason==="SHORT_MAX_HOLD")shortTrail={...armBase,expiresTs:armBase.exitTs+24*HOUR};
    }
    const baseCooldown=cooldownHoursForPenguExit(exitReason as any);
    const researchCooldown=cooldown48()&&exitReason.includes("HARD_STOP")?Math.max(48,baseCooldown):baseCooldown;
    cooldownUntilTs=rows[exitIndex].candle.openTime+researchCooldown*HOUR;i=exitIndex+1;
  }
  governorAuditStore[`${ddMode}:${mode}`]={
    events:governorEvents,
    eventCounts:Object.fromEntries([...new Set(governorEvents.map(e=>String(e.kind)))].map(k=>[k,governorEvents.filter(e=>e.kind===k).length])),
    finalGlobalUntilTs:globalGovernorUntilTs,
    routeGovernorUntil:Object.fromEntries(routeGovernorUntil),
    sideGovernorUntil,
    realizedEquity,realizedPeak,finalDrawdown:realizedEquity/realizedPeak-1
  };
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

function supplementalTrades(ts:Trade[]){
  const base=new Set<EntryRoute>(["SHORT_V20","BASE_V64_LONG","RECOVERY_V8"]);
  return ts.filter(t=>!base.has(t.route)).map(t=>({
    entry:new Date(t.entryTs).toISOString(),exit:new Date(t.exitTs).toISOString(),side:t.side,route:t.route,
    accountReturnPct:t.accountReturn*100,rawReturnPct:t.rawUnitReturn*100,exitReason:t.exitReason,
    features:{rsi:t.entryFeatures.rsi14,p24:t.entryFeatures.penguReturn24h,p72:t.entryFeatures.penguReturn72h,btc24:t.entryFeatures.btcReturn24h,rel24:t.entryFeatures.relativeReturn24h,vol:t.entryFeatures.volumeRatio6OverPrior36,atr:t.entryFeatures.atr24Ratio}
  }));
}
function dualWaveSummary(rows:PenguDualLsV2EvaluationRow[],baseline:Trade[],candidate:Trade[],start:number,end:number){
  return {
    UP:rescueSummary(rows,baseline,candidate,start,end,"UP"),
    DOWN:rescueSummary(rows,baseline,candidate,start,end,"DOWN"),
  };
}

function routeSizingSummary(trades:Trade[]){
  const keys=[...new Set(trades.map(x=>x.route))].sort();
  return Object.fromEntries(keys.map(k=>{
    const ts=trades.filter(x=>x.route===k);
    return [k,{count:ts.length,minGross:Math.min(...ts.map(x=>x.requestedGross)),maxGross:Math.max(...ts.map(x=>x.requestedGross)),
      meanGross:ts.reduce((n,x)=>n+x.requestedGross,0)/ts.length,
      partialDefenses:ts.filter(x=>x.partialDefense).length,
      returns:metrics(ts)
    }];
  }));
}
function approx(actual:number,expected:number,label:string){
  assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=1e-7,`${label} expected ${expected} got ${actual}`);
}

function drawdownDecomposition(ts:Trade[]){
  const closed=ts.filter(t=>!t.openAtWindowEnd);
  let equity=1,peak=1,peakBeforeIndex=-1,maxDd=0,troughIndex=-1,peakIndex=-1;
  const equityPath:number[]=[];
  for(let i=0;i<closed.length;i++){
    equity*=1+closed[i].accountReturn;equityPath.push(equity);
    if(equity>peak){peak=equity;peakBeforeIndex=i;}
    const dd=equity/peak-1;
    if(dd<maxDd){maxDd=dd;troughIndex=i;peakIndex=peakBeforeIndex;}
  }
  const from=Math.max(0,peakIndex+1),to=troughIndex;
  const episode=to>=from?closed.slice(from,to+1):[];
  let maxStreak=0,currentStreak=0,streakStart=-1,bestStart=-1,bestEnd=-1;
  for(let i=0;i<closed.length;i++){
    if(closed[i].accountReturn<0){if(currentStreak===0)streakStart=i;currentStreak++;if(currentStreak>maxStreak){maxStreak=currentStreak;bestStart=streakStart;bestEnd=i;}}
    else currentStreak=0;
  }
  const byRoute=Object.fromEntries([...new Set(closed.map(t=>t.route))].map(route=>{
    const xs=closed.filter(t=>t.route===route),losses=xs.filter(t=>t.accountReturn<0);
    return [route,{trades:xs.length,losses:losses.length,sumLossPct:losses.reduce((a,t)=>a+t.accountReturn,0)*100,worstLossPct:losses.length?Math.min(...losses.map(t=>t.accountReturn))*100:0,dd:metrics(xs).maxDrawdownPct}];
  }));
  const byExit=Object.fromEntries([...new Set(closed.map(t=>t.exitReason))].map(reason=>{
    const xs=closed.filter(t=>t.exitReason===reason),losses=xs.filter(t=>t.accountReturn<0);
    return [reason,{trades:xs.length,losses:losses.length,sumReturnPct:xs.reduce((a,t)=>a+t.accountReturn,0)*100,sumLossPct:losses.reduce((a,t)=>a+t.accountReturn,0)*100}];
  }));
  const worst=[...closed].sort((a,b)=>a.accountReturn-b.accountReturn).slice(0,12).map(t=>({route:t.route,entry:new Date(t.entryTs).toISOString(),exit:new Date(t.exitTs).toISOString(),returnPct:t.accountReturn*100,exitReason:t.exitReason,partial:t.partialDefense}));
  return {
    maxDrawdownPct:maxDd*100,
    peakTradeIndex:peakIndex,troughTradeIndex:troughIndex,
    episodeStart:episode[0]?new Date(episode[0].entryTs).toISOString():null,
    episodeEnd:episode.at(-1)?new Date(episode.at(-1)!.exitTs).toISOString():null,
    episodeTrades:episode.map(t=>({route:t.route,entry:new Date(t.entryTs).toISOString(),exit:new Date(t.exitTs).toISOString(),returnPct:t.accountReturn*100,exitReason:t.exitReason})),
    maxConsecutiveLosses:maxStreak,
    lossStreak:bestStart>=0?closed.slice(bestStart,bestEnd+1).map(t=>({route:t.route,entry:new Date(t.entryTs).toISOString(),returnPct:t.accountReturn*100,exitReason:t.exitReason})):[],
    byRoute,byExit,worst
  };
}
async function main(){
  allocationMode="CAP1_EVERY_ENTRY_FLAT";
  const [p,b,fp]=await Promise.all([candles("PENGUUSDT"),candles("BTCUSDT"),funding()]);
  const common=new Set(p.map(x=>x.openTime));const btc=b.filter(x=>common.has(x.openTime));const btcSet=new Set(btc.map(x=>x.openTime));const pengu=p.filter(x=>btcSet.has(x.openTime));
  assert.equal(pengu.length,btc.length);assert.ok(pengu.length>9000,`insufficient common rows ${pengu.length}`);
  const history:PenguDualLsV2History={pengu1h:pengu,btc1h:btc,penguFunding:fp};
  const rows=buildPenguDualLsV2EvaluationSeries(history,RECENT_END+1);
  const rollingStart=RECENT_END-365*24*HOUR;
  const windows=[{name:"FORMAL",start:FORMAL_START,end:FORMAL_END},{name:"ROLLING365",start:rollingStart,end:RECENT_END}];
  const variants:DDMode[]=[
    "BASELINE_FLAT1",
    "ROUTE_HARDSTOP_Q60",
    "ROUTE72_DD15_Q72",
    "Q60_DD13_H48","Q60_DD14_H48","Q60_DD15_H48","Q60_DD16_H48","Q60_DD17_H48",
    "Q60_DD13_H72","Q60_DD14_H72","Q60_DD15_H72","Q60_DD16_H72","Q60_DD17_H72",
    "Q60_DD15_H96"
  ];
  const result:any={
    schema:"pengu-flat1-dd-q60-grid/v4",
    source:{venue:"ASTER_FUTURES_V3",productionSourceSha:process.env.PRODUCTION_SOURCE_SHA||null,logic:"COMBINED_FILTERED fixed"},
    fixedContract:{penguMaximumGross:1.0,everyEntryGross:1.0,entries:"COMBINED_FILTERED unchanged",normalFees:"6bps/side",severe:"6bps/side +35bps slippage/side"},
    candidates:{
      HARDSTOP_COOLDOWN48:"legacy benchmark: global 48h after any hard stop",
      COMBINED_PROTECT_COOLDOWN48:"legacy benchmark: tighter exits plus global 48h hard-stop cooldown",
      ROUTE_HARDSTOP_Q72:"after hard stop quarantine only the same route for72h",
      ROUTE_HARDSTOP_Q120:"after hard stop quarantine only the same route for120h",
      ROUTE_HARDSTOP_Q168:"after hard stop quarantine only the same route for168h",
      SIDE_HARDSTOP_Q72:"after hard stop quarantine the same side for72h",
      SIDE_HARDSTOP_Q120:"after hard stop quarantine the same side for120h",
      LOSS2_GLOBAL_Q72:"after two consecutive losing closed trades pause all new entries72h",
      LOSS2_GLOBAL_Q120:"after two consecutive losing closed trades pause all new entries120h",
      ROUTE2LOSS14D_Q168:"if same route loses twice within14d quarantine that route168h",
      DD8_Q168:"if realized strategy equity is >=8% below peak after a close pause all entries168h",
      DD10_Q168:"same at10% drawdown",
      DD12_Q168:"same at12% drawdown",
      ROUTE120_LOSS2_Q72:"same-route hard-stop120h plus two-loss global72h",
      ROUTE120_DD10_Q168:"same-route hard-stop120h plus10% strategy-DD pause168h",
      SMART_GOVERNOR:"same-route hard-stop120h + two-loss global72h +10% strategy-DD pause168h",
      ROUTE_HARDSTOP_Q48:"same-route hard-stop quarantine48h",
      ROUTE_HARDSTOP_Q60:"same-route hard-stop quarantine60h",
      ROUTE_HARDSTOP_Q84:"same-route hard-stop quarantine84h",
      ROUTE_HARDSTOP_Q96:"same-route hard-stop quarantine96h",
      ROUTE72_RECOVERY96:"72h same-route quarantine, Recovery hard-stop uses96h",
      ROUTE72_RECOVERY120:"72h same-route quarantine, Recovery hard-stop uses120h",
      ROUTE72_SHORT96:"72h same-route quarantine, Short routes use96h",
      ROUTE_LOSS4_Q72:"same route quarantined72h after any <=-4% closed loss",
      ROUTE_ANYLOSS_Q72:"same route quarantined72h after any losing trade",
      ROUTE72_LOSS2_Q48:"route hard-stop72h plus48h global pause after2 consecutive losses",
      ROUTE72_DD15_Q72:"route hard-stop72h plus72h global pause when realized equity DD reaches15%",
      ROUTE72_DD18_Q72:"route hard-stop72h plus72h global pause when realized equity DD reaches18%",
      Q60_DD13_H48:"same-route hard-stop60h + strategy DD13% pause48h",
      Q60_DD14_H48:"same-route hard-stop60h + strategy DD14% pause48h",
      Q60_DD15_H48:"same-route hard-stop60h + strategy DD15% pause48h",
      Q60_DD16_H48:"same-route hard-stop60h + strategy DD16% pause48h",
      Q60_DD17_H48:"same-route hard-stop60h + strategy DD17% pause48h",
      Q60_DD13_H72:"same-route hard-stop60h + strategy DD13% pause72h",
      Q60_DD14_H72:"same-route hard-stop60h + strategy DD14% pause72h",
      Q60_DD15_H72:"same-route hard-stop60h + strategy DD15% pause72h",
      Q60_DD16_H72:"same-route hard-stop60h + strategy DD16% pause72h",
      Q60_DD17_H72:"same-route hard-stop60h + strategy DD17% pause72h",
      Q60_DD15_H96:"same-route hard-stop60h + strategy DD15% pause96h",
    },
    windows:{},safety:{researchOnly:true,ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}
  };
  const cache:Record<string,Trade[]>={};
  for(const candidate of variants){
    ddMode=candidate;
    for(const stress of ["NORMAL","SEVERE"] as Mode[]){
      const ts=replay(rows,fp,"COMBINED_FILTERED",stress);
      assert.equal(ts.filter(t=>Math.abs(t.requestedGross-1)>1e-12).length,0,`NOT_FLAT1:${candidate}:${stress}`);
      cache[`${candidate}:${stress}`]=ts;
    }
  }
  for(const w of windows){
    const cases:any={};
    for(const candidate of variants){
      const normal=between(cache[`${candidate}:NORMAL`],w.start,w.end);
      const severe=between(cache[`${candidate}:SEVERE`],w.start,w.end);
      cases[candidate]={
        NORMAL:metrics(normal),SEVERE:metrics(severe),
        decompositionNormal:drawdownDecomposition(normal),
        decompositionSevere:drawdownDecomposition(severe),
        byRouteNormal:routeMetrics(normal),byRouteSevere:routeMetrics(severe),
        governorNormal:governorAuditStore[`${candidate}:NORMAL`],
        governorSevere:governorAuditStore[`${candidate}:SEVERE`],
        folds:w.name==="FORMAL"?{NORMAL:formalFolds(normal),SEVERE:formalFolds(severe)}:undefined
      };
    }
    const base=cases.BASELINE_FLAT1;
    for(const candidate of variants.slice(1)){
      const row=cases[candidate];
      row.deltaVsBaseline={
        normalReturnPct:row.NORMAL.returnPct-base.NORMAL.returnPct,
        severeReturnPct:row.SEVERE.returnPct-base.SEVERE.returnPct,
        normalPf:(row.NORMAL.profitFactor??0)-(base.NORMAL.profitFactor??0),
        severePf:(row.SEVERE.profitFactor??0)-(base.SEVERE.profitFactor??0),
        normalDdPct:row.NORMAL.maxDrawdownPct-base.NORMAL.maxDrawdownPct,
        severeDdPct:row.SEVERE.maxDrawdownPct-base.SEVERE.maxDrawdownPct,
        normalTrades:row.NORMAL.trades-base.NORMAL.trades,
        severeTrades:row.SEVERE.trades-base.SEVERE.trades
      };
    }
    result.windows[w.name]={start:new Date(w.start).toISOString(),end:new Date(w.end).toISOString(),cases};
  }
  const formal=result.windows.FORMAL.cases.BASELINE_FLAT1,rolling=result.windows.ROLLING365.cases.BASELINE_FLAT1;
  approx(formal.NORMAL.returnPct,1307.9130447891462,"formal flat1 normal parity");
  approx(formal.SEVERE.returnPct,769.7792392486292,"formal flat1 severe parity");
  approx(rolling.NORMAL.returnPct,978.2039888080867,"rolling flat1 normal parity");
  approx(rolling.SEVERE.returnPct,550.8813814669275,"rolling flat1 severe parity");
  await fs.mkdir(".research-state/pengu-flat1-dd-q60-grid",{recursive:true});
  await fs.writeFile(".research-state/pengu-flat1-dd-q60-grid/result.json",JSON.stringify(result,null,2)+"\n");
  const compact=Object.fromEntries(Object.entries(result.windows).map(([window,value]:any)=>[window,Object.fromEntries(variants.map(candidate=>[candidate,{
    NORMAL:value.cases[candidate].NORMAL,SEVERE:value.cases[candidate].SEVERE,delta:value.cases[candidate].deltaVsBaseline,
    ddNormal:value.cases[candidate].decompositionNormal,ddSevere:value.cases[candidate].decompositionSevere,
    folds:value.cases[candidate].folds
  }]))]));
  console.log("PENGU_FLAT1_DD_Q60_GRID="+JSON.stringify(compact));
  console.log("PENGU_FLAT1_DD_Q60_GRID_CONTRACT_PASS="+JSON.stringify({gross:1,logic:"COMBINED_FILTERED",variants:variants.length,baselineParity:true,researchOnly:true}));
}
main().catch(e=>{console.error(e);process.exit(1);});
