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
const WARM_START = Date.parse("2024-07-01T00:00:00Z");
const FORMAL_START = Date.parse("2024-08-10T00:00:00Z");
const FORMAL_END = Date.parse("2026-08-10T00:00:00Z");
const RECENT_END = Date.parse("2026-09-23T13:00:00Z");
const BASE_URL = "https://fapi.asterdex.com";
const BASE_FEE_PER_SIDE = 0.0006;
const STRESS_SLIPPAGE_PER_SIDE = 0.0035;
let MOMENTUM_RET6_MIN = 0.03;
let MOMENTUM_DISTANCE_ATR_MAX = 0.40;
let CONTINUATION_RET72_MAX = 999;

type Variant = "BASELINE" | "TRAIL_RECLAIM" | "TRAIL_MOMENTUM" | "TRAIL_CONFIRMED";
type Mode = "NORMAL" | "SEVERE";
type EntryRoute = "SHORT_V20" | "BASE_V64_LONG" | "TRAIL_RECLAIM_LONG" | "TRAIL_MOMENTUM_LONG" | "TRAIL_CONFIRMED_LONG" | "RECOVERY_V8";
type ExitReason = string;

interface FundingPoint { fundingTime:number; fundingRate:number; }
interface Trade {
  variant:Variant; mode:Mode; route:EntryRoute; side:"L"|"S"; signalTs:number; entryTs:number; exitTs:number;
  entryPrice:number; exitPrice:number; requestedGross:number; accountReturn:number; rawUnitReturn:number;
  fundingUnitReturn:number; costUnitReturn:number; exitReason:ExitReason; entryFeatures:PenguDualLsV2Features;
  partialDefense?:boolean; partialAccountReturn?:number; openAtWindowEnd?:boolean;
  continuationSourceExitTs?:number; continuationSourceExitPrice?:number;
}
interface ContinuationArm { exitTs:number; exitPrice:number; expiresTs:number; sourceEntryTs:number; sourceSignalTs:number; sourceAccountReturn:number; }

function sleep(ms:number){ return new Promise(r=>setTimeout(r,ms)); }
async function fetchArray(url:URL){
  let last:unknown;
  for(let a=0;a<6;a++){
    try{
      const res=await fetch(url,{headers:{accept:"application/json","user-agent":"DisDex-PENGU-Continuation-Reentry-Research/20260923"}});
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
function continuationCommon(rows:readonly PenguDualLsV2EvaluationRow[],i:number,arm:ContinuationArm){
  const f=rows[i]?.features;if(!f)return false;
  const ts=f.referenceTs;
  return ts>=arm.exitTs+PENGU_DUAL_LS_V2.cooldownHours*HOUR
    && ts<=arm.expiresTs
    && f.close>=arm.exitPrice
    && f.penguReturn24h>=0.10
    && f.penguReturn72h>=0.15
    && f.penguReturn72h<=CONTINUATION_RET72_MAX
    && f.relativeReturn24h>=0.05
    && f.btcReturn24h>=0
    && f.rsi14>=55 && f.rsi14<=90
    && f.volumeRatio6OverPrior36>=PENGU_DUAL_LS_V2.long.volumeRatioMinimum
    && f.volumeRatio6OverPrior36<=PENGU_DUAL_LS_V2.long.volumeRatioMaximum
    && f.atr24Ratio<=PENGU_DUAL_LS_V2.long.atr24RatioMaximum
    && f.close>f.ema168;
}
function continuationRoute(rows:readonly PenguDualLsV2EvaluationRow[],i:number,v:Variant,arm?:ContinuationArm):EntryRoute|undefined{
  if(v==="BASELINE"||!arm||!continuationCommon(rows,i,arm))return undefined;
  const f=rows[i]!.features!;
  if(v==="TRAIL_RECLAIM")return "TRAIL_RECLAIM_LONG";
  if(v==="TRAIL_MOMENTUM"){
    const atrAbs=Math.max(1e-12,f.close*f.atr24Ratio);
    const distanceAtr=Math.abs(f.close-f.priorHigh18h)/atrAbs;
    return ret6(rows,i)>=MOMENTUM_RET6_MIN&&distanceAtr<=MOMENTUM_DISTANCE_ATR_MAX?"TRAIL_MOMENTUM_LONG":undefined;
  }
  if(v==="TRAIL_CONFIRMED"){
    return f.close>f.priorHigh18h&&penguV8BreakoutAtrScore(f)>=0.50?"TRAIL_CONFIRMED_LONG":undefined;
  }
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
  let i=250,cooldownUntilTs=0;let arm:ContinuationArm|undefined;
  while(i<rows.length-2){
    const currentReferenceTs=rows[i]?.features?.referenceTs ?? rows[i]?.candle.openTime ?? 0;
    if(arm&&currentReferenceTs>arm.expiresTs)arm=undefined;
    if(currentReferenceTs<cooldownUntilTs){i++;continue;}
    const f=rows[i].features;if(!f){i++;continue;}
    const baseSignal=baseLongSignal(rows,i);
    const contRoute=!baseSignal?continuationRoute(rows,i,v,arm):undefined;
    const anyLongSignal=baseSignal||Boolean(contRoute);
    const adjustedRecovery=rows[i].recoveryV8?{...rows[i].recoveryV8,ordinaryLongEligible:anyLongSignal,baseLongSignal:anyLongSignal}:undefined;
    const recovery=adjustedRecovery?evaluateRecoveryV8Entry(adjustedRecovery):undefined;
    let route:EntryRoute|undefined;
    if(rows[i].shortSignal)route="SHORT_V20";
    else if(baseSignal)route="BASE_V64_LONG";
    else if(contRoute)route=contRoute;
    else if(recovery?.kind==="RECOVERY_V8")route="RECOVERY_V8";
    if(!route){i++;continue;}
    const usedArm=route.startsWith("TRAIL_")?arm:undefined;
    const side:"L"|"S"=route==="SHORT_V20"?"S":"L";const entryIndex=i+1,entry=rows[entryIndex].candle,gross=acceptedGross(route,f);
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
    const trade:Trade={variant:v,mode,route,side,signalTs:rows[i].candle.openTime,entryTs:entry.openTime,exitTs:rows[exitIndex].candle.openTime,entryPrice:entry.open,exitPrice,requestedGross:gross,accountReturn,rawUnitReturn,fundingUnitReturn,costUnitReturn,exitReason,entryFeatures:{...f},partialDefense,partialAccountReturn,openAtWindowEnd:exitReason==="WINDOW_END",continuationSourceExitTs:usedArm?.exitTs,continuationSourceExitPrice:usedArm?.exitPrice};
    trades.push(trade);
    arm=undefined;
    if(route==="BASE_V64_LONG"&&exitReason==="LONG_TRAILING_STOP"&&accountReturn>0){
      arm={exitTs:rows[exitIndex].candle.openTime,exitPrice,expiresTs:rows[exitIndex].candle.openTime+24*HOUR,sourceEntryTs:entry.openTime,sourceSignalTs:rows[i].candle.openTime,sourceAccountReturn:accountReturn};
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
function routeMetrics(ts:Trade[]){return Object.fromEntries((["SHORT_V20","BASE_V64_LONG","TRAIL_RECLAIM_LONG","TRAIL_MOMENTUM_LONG","TRAIL_CONFIRMED_LONG","RECOVERY_V8"] as EntryRoute[]).map(r=>[r,metrics(ts.filter(t=>t.route===r))]));}
function formalFolds(ts:Trade[]){
  const span=FORMAL_END-FORMAL_START;const a=FORMAL_START+Math.floor(span/3),b=FORMAL_START+Math.floor(span*2/3);
  return {FOLD1:metrics(between(ts,FORMAL_START,a)),FOLD2:metrics(between(ts,a,b)),FOLD3:metrics(between(ts,b,FORMAL_END))};
}
function continuationLedger(ts:Trade[]){return ts.filter(t=>t.route.startsWith("TRAIL_")).map(t=>({route:t.route,signalTs:new Date(t.signalTs).toISOString(),entryTs:new Date(t.entryTs).toISOString(),exitTs:new Date(t.exitTs).toISOString(),entryPrice:t.entryPrice,exitPrice:t.exitPrice,gross:t.requestedGross,accountReturnPct:t.accountReturn*100,exitReason:t.exitReason,openAtWindowEnd:t.openAtWindowEnd??false,sourceExitTs:t.continuationSourceExitTs?new Date(t.continuationSourceExitTs).toISOString():null,sourceExitPrice:t.continuationSourceExitPrice??null,features:{rsi14:t.entryFeatures.rsi14,penguReturn24h:t.entryFeatures.penguReturn24h,penguReturn72h:t.entryFeatures.penguReturn72h,relativeReturn24h:t.entryFeatures.relativeReturn24h,btcReturn24h:t.entryFeatures.btcReturn24h,volumeRatio:t.entryFeatures.volumeRatio6OverPrior36,atr24Ratio:t.entryFeatures.atr24Ratio,ret6h:null}}));}
async function main(){
  const [p,b,fp]=await Promise.all([candles("PENGUUSDT"),candles("BTCUSDT"),funding()]);
  const common=new Set(p.map(x=>x.openTime));const btc=b.filter(x=>common.has(x.openTime));const btcSet=new Set(btc.map(x=>x.openTime));const pengu=p.filter(x=>btcSet.has(x.openTime));
  assert.equal(pengu.length,btc.length);assert.ok(pengu.length>9000,`insufficient common rows ${pengu.length}`);
  console.log(`PENGU_ASTER_SWEEP_RANGE=${new Date(pengu[0].openTime).toISOString()}..${new Date(pengu.at(-1)!.openTime+HOUR).toISOString()} rows=${pengu.length}`);
  const history:PenguDualLsV2History={pengu1h:pengu,btc1h:btc,penguFunding:fp};
  const rows=buildPenguDualLsV2EvaluationSeries(history,RECENT_END+1);
  const configs=[
    {label:"BASE",ret6:.03,dist:.40,r72:999},
    {label:"R72_035",ret6:.03,dist:.40,r72:.35},
    {label:"R72_040",ret6:.03,dist:.40,r72:.40},
    {label:"R72_045",ret6:.03,dist:.40,r72:.45},
    {label:"R72_040_R6_025",ret6:.025,dist:.40,r72:.40},
    {label:"R72_040_R6_035",ret6:.035,dist:.40,r72:.40},
    {label:"R72_040_D030",ret6:.03,dist:.30,r72:.40},
    {label:"R72_040_D050",ret6:.03,dist:.50,r72:.40},
    {label:"R72_038_D050",ret6:.03,dist:.50,r72:.38},
    {label:"R72_040_D045",ret6:.03,dist:.45,r72:.40},
    {label:"R72_040_D055",ret6:.03,dist:.55,r72:.40},
    {label:"R72_040_D050_R6_040",ret6:.04,dist:.50,r72:.40},
  ];
  const out:any={schema:"pengu-continuation-momentum-sweep-aster/v1",venue:"ASTER",configs:{}};
  for(const cfg of configs){
    MOMENTUM_RET6_MIN=cfg.ret6;MOMENTUM_DISTANCE_ATR_MAX=cfg.dist;CONTINUATION_RET72_MAX=cfg.r72;
    const row:any={thresholds:cfg};
    for(const mode of ["NORMAL","SEVERE"] as Mode[]){
      const baseAll=replay(rows,fp,"BASELINE",mode);
      const momAll=replay(rows,fp,"TRAIL_MOMENTUM",mode);
      const baseFormal=between(baseAll,FORMAL_START,FORMAL_END),momFormal=between(momAll,FORMAL_START,FORMAL_END);
      const baseRecent=between(baseAll,FORMAL_END,RECENT_END),momRecent=between(momAll,FORMAL_END,RECENT_END);
      row[mode]={
        baselineFormal:metrics(baseFormal),momentumFormal:metrics(momFormal),
        baselineRecent:metrics(baseRecent),momentumRecent:metrics(momRecent),
        continuationFormal:continuationLedger(momFormal),
        continuationRecent:continuationLedger(momRecent),
        deltaFormalReturnPct:metrics(momFormal).returnPct-metrics(baseFormal).returnPct,
        deltaFormalWinRatePct:(metrics(momFormal).winRatePct??0)-(metrics(baseFormal).winRatePct??0),
        deltaFormalPf:(metrics(momFormal).profitFactor??0)-(metrics(baseFormal).profitFactor??0),
        deltaFormalDdPct:metrics(momFormal).maxDrawdownPct-metrics(baseFormal).maxDrawdownPct,
        deltaRecentClosedReturnPct:metrics(momRecent).returnPct-metrics(baseRecent).returnPct,
        deltaRecentMarkedReturnPct:metrics(momRecent).markToWindowReturnPct-metrics(baseRecent).markToWindowReturnPct
      };
    }
    out.configs[cfg.label]=row;
  }
  const outDir=".research-state/pengu-continuation-momentum-sweep-aster";
  await fs.mkdir(outDir,{recursive:true});await fs.writeFile(path.join(outDir,"result.json"),JSON.stringify(out,null,2)+"\n");
  console.log("PENGU_ASTER_MOMENTUM_SWEEP="+JSON.stringify(out));
}
main().catch(e=>{console.error(e);process.exit(1);});
