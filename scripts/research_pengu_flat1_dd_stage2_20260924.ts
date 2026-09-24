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
      const res=await fetch(url,{headers:{accept:"application/json","user-agent":"DisDex-PENGU-Flat1-DD-Deep-Search/20260924"}});
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
const CAP = 1.0 as const;
const OLD_CAP = 0.85 as const;
const FACTOR = CAP / OLD_CAP;
let allocationMode:AllocationMode = "CAP1_EVERY_ENTRY_FLAT";

type RiskProfile = {
  id:string;
  longHard?:number;
  longTrailAct?:number;
  longTrailRet?:number;
  shortHard?:number;
  shortTrailAct?:number;
  shortTrailRet?:number;
  recoveryHard?:number;
  recoveryPartialStop?:number;
  recoveryPartialAfterHours?:number;
  recoveryTrailAct?:number;
  recoveryTrailRet?:number;
  recoveryMaxHold?:number;
  recoveryTrendFail?:boolean;
  longTrendFail?:boolean;
  shortTrendFail?:boolean;
  lossCooldownHours?:number;
  hardStopCooldownHours?:number;
  lossStreakThreshold?:number;
  lossStreakCooldownHours?:number;
  breakevenActivation?:number;
  breakevenLock?:number;
};
let riskProfile:RiskProfile={id:"BASELINE"};
const PROFILES:RiskProfile[]=[
  {id:"BASELINE"},
  {id:"HARD6_ALL",longHard:.06,shortHard:.06,recoveryHard:.05},
  {id:"HARD5_ALL",longHard:.05,shortHard:.05,recoveryHard:.045},
  {id:"H6_CD48",longHard:.06,shortHard:.06,recoveryHard:.05,hardStopCooldownHours:48},
  {id:"H6_CD72",longHard:.06,shortHard:.06,recoveryHard:.05,hardStopCooldownHours:72},
  {id:"H6_STREAK2_72",longHard:.06,shortHard:.06,recoveryHard:.05,lossStreakThreshold:2,lossStreakCooldownHours:72},
  {id:"H6_STREAK2_96",longHard:.06,shortHard:.06,recoveryHard:.05,lossStreakThreshold:2,lossStreakCooldownHours:96},
  {id:"H6_LONG_TRAIL",longHard:.06,shortHard:.06,recoveryHard:.05,longTrailAct:.06,longTrailRet:.025},
  {id:"H6_SHORT_TRAIL",longHard:.06,shortHard:.06,recoveryHard:.05,shortTrailAct:.08,shortTrailRet:.03},
  {id:"H6_BOTH_TRAIL",longHard:.06,shortHard:.06,recoveryHard:.05,longTrailAct:.06,longTrailRet:.025,shortTrailAct:.08,shortTrailRet:.03},
  {id:"H6_REC48",longHard:.06,shortHard:.06,recoveryHard:.05,recoveryMaxHold:48},
  {id:"H6_BE4_FLAT",longHard:.06,shortHard:.06,recoveryHard:.05,breakevenActivation:.04,breakevenLock:0},
  {id:"H6_BE5_LOCK05",longHard:.06,shortHard:.06,recoveryHard:.05,breakevenActivation:.05,breakevenLock:.005},
  {id:"H6_BOTH_TRAIL_BE5",longHard:.06,shortHard:.06,recoveryHard:.05,longTrailAct:.06,longTrailRet:.025,shortTrailAct:.08,shortTrailRet:.03,breakevenActivation:.05,breakevenLock:.005},
  {id:"H6_STREAK2_72_BE5",longHard:.06,shortHard:.06,recoveryHard:.05,lossStreakThreshold:2,lossStreakCooldownHours:72,breakevenActivation:.05,breakevenLock:.005},
  {id:"H6_BOTH_TRAIL_STREAK2_72",longHard:.06,shortHard:.06,recoveryHard:.05,longTrailAct:.06,longTrailRet:.025,shortTrailAct:.08,shortTrailRet:.03,lossStreakThreshold:2,lossStreakCooldownHours:72},
  {id:"H6_CD48_BE5",longHard:.06,shortHard:.06,recoveryHard:.05,hardStopCooldownHours:48,breakevenActivation:.05,breakevenLock:.005},
  {id:"H6_REC48_BE5",longHard:.06,shortHard:.06,recoveryHard:.05,recoveryMaxHold:48,breakevenActivation:.05,breakevenLock:.005},
]
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


function longOverlayExit(pos:PenguDualLsV2Position,f:PenguDualLsV2Features,route:EntryRoute){
  const prev=Math.max(pos.entryPrice,pos.highWaterMark);
  const hard=riskProfile.longHard;
  if(hard!==undefined){
    const px=pos.entryPrice*(1-hard);
    if(f.low<=px)return {reason:"LONG_HARD_STOP",price:px};
  }
  const beAct=riskProfile.breakevenActivation,beLock=riskProfile.breakevenLock??0;
  if(beAct!==undefined&&prev/pos.entryPrice-1>=beAct){
    const px=pos.entryPrice*(1+beLock);
    if(f.low<=px)return {reason:"LONG_BREAKEVEN_LOCK_EXIT",price:px};
  }
  const act=riskProfile.longTrailAct,ret=riskProfile.longTrailRet;
  if(act!==undefined&&ret!==undefined&&prev/pos.entryPrice-1>=act){
    const px=prev*(1-ret);
    if(f.low<=px)return {reason:"LONG_TRAILING_STOP",price:px};
  }
  if(riskProfile.longTrendFail && f.referenceTs>=pos.entryTs+12*HOUR && f.close<f.ema72 && f.penguReturn24h<0 && f.relativeReturn24h<0){
    return {reason:"LONG_TREND_FAIL_EXIT",price:f.close};
  }
  return undefined;
}
function shortOverlayExit(pos:PenguDualLsV2Position,f:PenguDualLsV2Features){
  const prev=Math.min(pos.entryPrice,pos.lowWaterMark??pos.entryPrice);
  const hard=riskProfile.shortHard;
  if(hard!==undefined){
    const px=pos.entryPrice*(1+hard);
    if(f.high>=px)return {reason:"SHORT_HARD_STOP",price:px};
  }
  const beAct=riskProfile.breakevenActivation,beLock=riskProfile.breakevenLock??0;
  if(beAct!==undefined&&pos.entryPrice/prev-1>=beAct){
    const px=pos.entryPrice*(1-beLock);
    if(f.high>=px)return {reason:"SHORT_BREAKEVEN_LOCK_EXIT",price:px};
  }
  const act=riskProfile.shortTrailAct,ret=riskProfile.shortTrailRet;
  if(act!==undefined&&ret!==undefined&&pos.entryPrice/prev-1>=act){
    const px=prev*(1+ret);
    if(f.high>=px)return {reason:"SHORT_TRAILING_STOP",price:px};
  }
  if(riskProfile.shortTrendFail && f.referenceTs>=pos.entryTs+12*HOUR && f.close>f.ema72 && f.penguReturn24h>0 && f.relativeReturn24h>0){
    return {reason:"SHORT_TREND_FAIL_EXIT",price:f.close};
  }
  return undefined;
}
function recoveryOverridesActive(){
  return riskProfile.recoveryHard!==undefined||riskProfile.recoveryPartialStop!==undefined||riskProfile.recoveryPartialAfterHours!==undefined||
    riskProfile.recoveryTrailAct!==undefined||riskProfile.recoveryTrailRet!==undefined||riskProfile.recoveryMaxHold!==undefined||riskProfile.recoveryTrendFail===true;
}
function replay(rows:PenguDualLsV2EvaluationRow[],points:FundingPoint[],v:Variant,mode:Mode){
  const cost=BASE_FEE_PER_SIDE+(mode==="SEVERE"?STRESS_SLIPPAGE_PER_SIDE:0);const trades:Trade[]=[];
  let i=250,cooldownUntilTs=0,consecutiveLosses=0;
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
      const holdHours=riskProfile.recoveryMaxHold??PENGU_RECOVERY_V8.exit.maxHoldHours;
      const naturalLast=entryIndex+holdHours-1;const last=Math.min(rows.length-1,naturalLast);exitIndex=last;exitPrice=rows[last].candle.close;exitReason=last===naturalLast?"RECOVERY_V8_MAX_HOLD":"WINDOW_END";
      let remainingGross=gross;
      for(let j=entryIndex;j<=last;j++){
        const baseAtJ=baseLongSignal(rows,j);
        const rr=rows[j].recoveryV8?{...rows[j].recoveryV8,ordinaryLongEligible:baseAtJ,baseLongSignal:baseAtJ}:undefined;
        if(!rr)continue;
        if(recoveryOverridesActive()){
          const hardPct=riskProfile.recoveryHard??PENGU_RECOVERY_V8.exit.hardStopPct;
          const partialPct=riskProfile.recoveryPartialStop??PENGU_RECOVERY_V8.partial.stopPct;
          const partialAfter=riskProfile.recoveryPartialAfterHours??PENGU_RECOVERY_V8.partial.afterHours;
          const trailAct=riskProfile.recoveryTrailAct??PENGU_RECOVERY_V8.exit.trailActivationPct;
          const trailRet=riskProfile.recoveryTrailRet??PENGU_RECOVERY_V8.exit.trailRetracePct;
          const partialPx=entry.open*(1-partialPct),hardPx=entry.open*(1-hardPct);
          if(!partialDefense&&rr.referenceTs>=entry.openTime+partialAfter*HOUR&&rr.low<=partialPx){
            const pg=.5; partialAccountReturn=legReturn("L",pg,entry.open,partialPx,entry.openTime,rows[j].candle.openTime,points,cost).account;
            partialDefense=true;remainingGross=.5;rp={...rp,partialDefenseTriggered:true,remainingGross:.5,quantity:.5};
          }
          if(rr.low<=hardPx){exitIndex=j;exitPrice=hardPx;exitReason="RECOVERY_V8_HARD_STOP";break;}
          const prev=Math.max(entry.open,rp.highWaterMark);
          const beAct=riskProfile.breakevenActivation,beLock=riskProfile.breakevenLock??0;
          if(beAct!==undefined&&prev/entry.open-1>=beAct){
            const px=entry.open*(1+beLock);
            if(rr.low<=px){exitIndex=j;exitPrice=px;exitReason="RECOVERY_V8_BREAKEVEN_LOCK_EXIT";break;}
          }
          if(prev/entry.open-1>=trailAct){
            const px=prev*(1-trailRet);
            if(rr.low<=px){exitIndex=j;exitPrice=px;exitReason="RECOVERY_V8_TRAILING_STOP";break;}
          }
          if(riskProfile.recoveryTrendFail&&rr.referenceTs>=entry.openTime+12*HOUR&&rows[j].features&&rows[j].features!.close<rows[j].features!.ema72&&rows[j].features!.penguReturn24h<-.03){
            exitIndex=j;exitPrice=rows[j].candle.close;exitReason="RECOVERY_V8_TREND_FAIL_EXIT";break;
          }
          rp={...rp,highWaterMark:Math.max(prev,rr.high),remainingGross};
          if(baseAtJ){exitIndex=j;exitPrice=rows[j].candle.close;exitReason="RECOVERY_V8_YIELD_BASE_LONG";break;}
        }else{
          const ev=evaluateRecoveryV8PositionBar(rp,rr);
          if(ev.events.includes("PARTIAL_DEFENSE")&&!partialDefense){
            const pg=.5;const pp=ev.triggerPrice??entry.open*(1-PENGU_RECOVERY_V8.partial.stopPct);
            partialAccountReturn=legReturn("L",pg,entry.open,pp,entry.openTime,rows[j].candle.openTime,points,cost).account;
            partialDefense=true;remainingGross=.5;
          }
          rp={...ev.updatedPosition,originalGross:gross,remainingGross};
          if(["HARD_STOP","TRAILING_STOP","MAX_HOLD","YIELD_BASE_LONG"].includes(ev.kind)){
            exitIndex=j;exitPrice=ev.stopPrice??rows[j].candle.close;exitReason=`RECOVERY_V8_${ev.kind}`;break;
          }
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
            const hard=entry.open*(1-(riskProfile.longHard??PENGU_DUAL_LS_V2.long.hardStopPct));
            if(ff.low<=hard){exitIndex=j;exitPrice=hard;exitReason="LONG_HARD_STOP";break;}
            const trailing=best*(1-(riskProfile.longTrailRet??0.03));
            if(best/entry.open-1>=(riskProfile.longTrailAct??0.06)&&ff.low<=trailing){exitIndex=j;exitPrice=trailing;exitReason="LONG_TRAILING_STOP";break;}
            best=Math.max(best,ff.high);
          }else{
            const hard=entry.open*(1+(riskProfile.shortHard??PENGU_DUAL_LS_V2.short.hardStopPct));
            if(ff.high>=hard){exitIndex=j;exitPrice=hard;exitReason="SHORT_HARD_STOP";break;}
            const trailing=best*(1+(riskProfile.shortTrailRet??0.03));
            if(entry.open/best-1>=(riskProfile.shortTrailAct??0.06)&&ff.high>=trailing){exitIndex=j;exitPrice=trailing;exitReason="SHORT_TRAILING_STOP";break;}
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
          const overlay=side==="L"?longOverlayExit(pos,ff,route):shortOverlayExit(pos,ff);
          if(overlay){exitIndex=j;exitPrice=overlay.price;exitReason=overlay.reason;break;}
          const ev=evaluatePenguDualLsV2PositionBar(pos,ff);pos=ev.updatedPosition;
          if(ev.exit){exitIndex=j;exitPrice=ev.exit.stopPrice??rows[j].candle.close;exitReason=ev.exit.reason;break;}
        }
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
    {
      consecutiveLosses=accountReturn<0?consecutiveLosses+1:0;
      const hardStop=/HARD_STOP/.test(exitReason);
      const baseCd=cooldownHoursForPenguExit(exitReason as any);
      const hardCd=hardStop?(riskProfile.hardStopCooldownHours??0):0;
      const lossCd=accountReturn<0?(riskProfile.lossCooldownHours??0):0;
      const streakCd=riskProfile.lossStreakThreshold!==undefined&&consecutiveLosses>=riskProfile.lossStreakThreshold
        ? (riskProfile.lossStreakCooldownHours??0):0;
      cooldownUntilTs=rows[exitIndex].candle.openTime+Math.max(baseCd,hardCd,lossCd,streakCd)*HOUR;
      i=exitIndex+1;
    }
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

function ddEpisode(ts:Trade[]){
  let eq=1,peak=1,peakIndex=-1,worst=0,worstIndex=-1,worstPeakIndex=-1;
  const curve:number[]=[];
  for(let i=0;i<ts.length;i++){eq*=1+ts[i].accountReturn;curve.push(eq);if(eq>peak){peak=eq;peakIndex=i;}const dd=eq/peak-1;if(dd<worst){worst=dd;worstIndex=i;worstPeakIndex=peakIndex;}}
  const start=Math.max(0,worstPeakIndex+1),end=Math.max(start,worstIndex);
  return {ddPct:worst*100,startIndex:start,endIndex:end,startTs:ts[start]?.entryTs??null,endTs:ts[end]?.exitTs??null,
    trades:ts.slice(start,end+1).map(t=>({route:t.route,entry:new Date(t.entryTs).toISOString(),exit:new Date(t.exitTs).toISOString(),retPct:t.accountReturn*100,reason:t.exitReason}))};
}
function scoreCandidate(formal:any,rolling:any){
  const fN=formal.NORMAL,fS=formal.SEVERE,rN=rolling.NORMAL,rS=rolling.SEVERE;
  const ddGain=Math.max(0,20.81583236185+fN.maxDrawdownPct)+Math.max(0,22.5997608211+fS.maxDrawdownPct)+Math.max(0,32.16973988015+rN.maxDrawdownPct)+Math.max(0,39.55887800692+rS.maxDrawdownPct);
  const returnRetention=Math.min(1,fN.returnPct/1307.9130447891462)+Math.min(1,fS.returnPct/769.7792392486292)+Math.min(1,rN.returnPct/978.2039888080867)+Math.min(1,rS.returnPct/550.8813814669275);
  return ddGain*10+returnRetention*5;
}
async function main(){
  allocationMode="CAP1_EVERY_ENTRY_FLAT";
  const [p,b,fp]=await Promise.all([candles("PENGUUSDT"),candles("BTCUSDT"),funding()]);
  const common=new Set(p.map(x=>x.openTime));const btc=b.filter(x=>common.has(x.openTime));const btcSet=new Set(btc.map(x=>x.openTime));const pengu=p.filter(x=>btcSet.has(x.openTime));
  assert.equal(pengu.length,btc.length);assert.ok(pengu.length>9000,`insufficient common rows ${pengu.length}`);
  const rows=buildPenguDualLsV2EvaluationSeries({pengu1h:pengu,btc1h:btc,penguFunding:fp},RECENT_END+1);
  const rollingStart=RECENT_END-365*24*HOUR;
  const windows=[{name:"FORMAL",start:FORMAL_START,end:FORMAL_END},{name:"ROLLING365",start:rollingStart,end:RECENT_END}];
  const result:any={schema:"pengu-flat1-dd-deep-search/stage2",fixed:{logic:"COMBINED_FILTERED",maximumGross:1,allEntriesGross:1},profiles:{},safety:{researchOnly:true,ordersSent:false,liveChanged:false}};
  for(const profile of PROFILES){
    riskProfile=profile;
    const pn=replay(rows,fp,"COMBINED_FILTERED","NORMAL"),ps=replay(rows,fp,"COMBINED_FILTERED","SEVERE");
    const out:any={profile,windows:{}};
    for(const w of windows){
      const n=between(pn,w.start,w.end),sv=between(ps,w.start,w.end);
      out.windows[w.name]={NORMAL:metrics(n),SEVERE:metrics(sv),ddEpisodeNormal:ddEpisode(n),ddEpisodeSevere:ddEpisode(sv),
        folds:w.name==="FORMAL"?{NORMAL:formalFolds(n),SEVERE:formalFolds(sv)}:undefined,
        routesNormal:routeMetrics(n),routesSevere:routeMetrics(sv)};
      assert.ok(n.every(t=>Math.abs(t.requestedGross-1)<1e-12),`gross mismatch ${profile.id} NORMAL`);
      assert.ok(sv.every(t=>Math.abs(t.requestedGross-1)<1e-12),`gross mismatch ${profile.id} SEVERE`);
    }
    out.score=scoreCandidate(out.windows.FORMAL,out.windows.ROLLING365);
    result.profiles[profile.id]=out;
  }
  const ranked=Object.values(result.profiles).sort((a:any,b:any)=>b.score-a.score).map((x:any)=>({id:x.profile.id,score:x.score,formal:x.windows.FORMAL,rolling:x.windows.ROLLING365}));
  result.ranked=ranked;
  const base=result.profiles.BASELINE;
  approx(base.windows.FORMAL.NORMAL.returnPct,1307.9130447891462,"flat1 formal NORMAL parity");
  approx(base.windows.FORMAL.SEVERE.returnPct,769.7792392486292,"flat1 formal SEVERE parity");
  approx(base.windows.ROLLING365.NORMAL.returnPct,978.2039888080867,"flat1 rolling NORMAL parity");
  approx(base.windows.ROLLING365.SEVERE.returnPct,550.8813814669275,"flat1 rolling SEVERE parity");
  await fs.mkdir(".research-state/pengu-flat1-dd-deep-search",{recursive:true});
  await fs.writeFile(".research-state/pengu-flat1-dd-deep-search/stage2.json",JSON.stringify(result,null,2)+"\n");
  console.log("PENGU_FLAT1_DD_STAGE2="+JSON.stringify({ranked:ranked.map((x:any)=>({id:x.id,score:x.score,formal:{N:x.formal.NORMAL,S:x.formal.SEVERE},rolling:{N:x.rolling.NORMAL,S:x.rolling.SEVERE}})),baselineDd:{formal:base.windows.FORMAL.ddEpisodeNormal,rolling:base.windows.ROLLING365.ddEpisodeNormal}}));
}
main().catch(e=>{console.error(e);process.exit(1);});
