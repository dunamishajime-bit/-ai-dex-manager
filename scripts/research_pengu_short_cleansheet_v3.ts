import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";
import {
  buildPenguDualLsV2EvaluationSeries,
  evaluatePenguDualLsV2PositionBar,
  targetGrossForAtr,
  type PenguDualLsV2History,
  type PenguDualLsV2Position,
  type PenguDualLsV2EvaluationRow,
} from "../lib/pengu-dual-ls-v2";
import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";

const HOUR=3_600_000;
const WARM_START=Date.parse("2025-08-01T00:00:00Z");
const EVAL_START=Date.parse("2025-08-23T15:00:00Z");
const EVAL_END=Date.parse("2026-08-23T15:00:00Z");
const BASE_URL="https://fapi.asterdex.com";
const BASE_FEE_PER_SIDE=0.0006;
const STRESS_SLIPPAGE_PER_SIDE=0.0035;

type Side="L"|"S";
type Reason="hard"|"trail"|"time";
type Mode="normal"|"stress";
type ShortVariant="BASELINE"|"FAILED_RALLY_BREAKDOWN"|"COMPRESSION_BREAKDOWN"|"RELATIVE_WEAKNESS_REJECTION"|"ENSEMBLE";
interface FundingPoint { fundingTime:number; fundingRate:number }
interface Trade { variant:ShortVariant; side:Side; signalTs:number; entryTs:number; exitTs:number; requestedGross:number; accountReturn:number; netUnitReturn:number; exitReason:Reason }

function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}
async function fetchJson(url:URL){
  let last:unknown;
  for(let a=0;a<6;a++){
    try{
      const r=await fetch(url,{headers:{accept:"application/json","user-agent":"DisDex-PENGU-Short-V3-Research/1.0"}});
      if(!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0,200)}`);
      const j=await r.json(); if(!Array.isArray(j)) throw new Error("not array"); return j as unknown[];
    }catch(e){last=e; await sleep(400*(a+1));}
  }
  throw last;
}
async function downloadCandles(symbol:string){
  const raws:unknown[][]=[]; let cursor=WARM_START;
  while(cursor<EVAL_END){
    const u=new URL("/fapi/v3/klines",BASE_URL); u.searchParams.set("symbol",symbol); u.searchParams.set("interval","1h"); u.searchParams.set("startTime",String(cursor)); u.searchParams.set("endTime",String(EVAL_END-1)); u.searchParams.set("limit","1500");
    const b=await fetchJson(u) as unknown[][]; if(!b.length) break; raws.push(...b); const n=Number(b.at(-1)?.[0])+HOUR; if(!(n>cursor)) throw new Error("pagination"); cursor=n; await sleep(40);
  }
  const m=new Map<number,DisDexV35Candle>();
  for(const x of raws){const t=Number(x[0]); const c={openTime:t,open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),volume:Number(x[5]),closeTime:Number(x[6]??t+HOUR-1)}; if(t>=WARM_START&&t<EVAL_END&&Object.values(c).every(Number.isFinite))m.set(t,c);}
  return [...m.values()].sort((a,b)=>a.openTime-b.openTime);
}
async function downloadFunding(){
  const out:FundingPoint[]=[]; let cursor=WARM_START;
  while(cursor<EVAL_END){
    const u=new URL("/fapi/v3/fundingRate",BASE_URL);u.searchParams.set("symbol","PENGUUSDT");u.searchParams.set("startTime",String(cursor));u.searchParams.set("endTime",String(EVAL_END-1));u.searchParams.set("limit","1000");
    const b=await fetchJson(u) as Array<{fundingTime?:unknown;fundingRate?:unknown}>; if(!b.length)break;
    for(const x of b){const t=Number(x.fundingTime),r=Number(x.fundingRate);if(t>=WARM_START&&t<EVAL_END&&Number.isFinite(r))out.push({fundingTime:t,fundingRate:r});}
    const n=Number(b.at(-1)?.fundingTime)+1;if(!(n>cursor))throw new Error("funding pagination");cursor=n;await sleep(40);
  }
  return [...new Map(out.map(x=>[x.fundingTime,x])).values()].sort((a,b)=>a.fundingTime-b.fundingTime);
}
function fundingBetween(p:FundingPoint[],a:number,b:number){return p.filter(x=>x.fundingTime>a&&x.fundingTime<=b).reduce((s,x)=>s+x.fundingRate,0);}

function hasFeatures(rows:PenguDualLsV2EvaluationRow[],i:number){return i>=0&&i<rows.length&&Boolean(rows[i].features);}
function downRegime(r:PenguDualLsV2EvaluationRow){const f=r.features!;return f.close<f.ema72&&f.ema72<f.ema168&&f.penguReturn72h<0&&f.relativeReturn24h<0;}

function failedRallyBreakdown(rows:PenguDualLsV2EvaluationRow[],i:number){
  if(i<14||!rows[i].features||!downRegime(rows[i]))return false;
  const f=rows[i].features!; const prior=rows.slice(i-12,i);
  const low=Math.min(...prior.map(x=>x.candle.low)); const li=prior.findIndex(x=>x.candle.low===low); const after=prior.slice(li);
  const bounceHigh=Math.max(...after.map(x=>x.candle.high)); const bounce=(bounceHigh/low-1);
  const oneAtr=f.atr24Ratio;
  const rebroke=rows[i].candle.close<rows[i-1].candle.low&&rows[i].candle.close<rows[i-1].candle.close;
  return bounce>=oneAtr&&rebroke;
}
function compressionBreakdown(rows:PenguDualLsV2EvaluationRow[],i:number){
  if(i<10||!rows[i].features||!downRegime(rows[i]))return false;
  const f=rows[i].features!; const prior=rows.slice(i-8,i); const hi=Math.max(...prior.map(x=>x.candle.high)); const lo=Math.min(...prior.map(x=>x.candle.low));
  const width=hi/lo-1; const barRange=(rows[i].candle.high-rows[i].candle.low)/rows[i].candle.close;
  return width<=2*f.atr24Ratio&&rows[i].candle.close<lo&&barRange>=f.atr24Ratio&&f.volumeRatio6OverPrior36>=1;
}
function relativeWeaknessRejection(rows:PenguDualLsV2EvaluationRow[],i:number){
  if(i<8||!rows[i].features||!downRegime(rows[i]))return false;
  const f=rows[i].features!; const prior=rows.slice(i-6,i).filter(x=>x.features);
  if(prior.length<6)return false;
  const attemptedReclaim=prior.some(x=>x.candle.high>=x.features!.ema72);
  const prevRel=rows[i-1].features?.relativeReturn24h;
  const rejection=rows[i].candle.close<rows[i-1].candle.low&&rows[i].candle.close<f.ema72;
  return attemptedReclaim&&rejection&&Number.isFinite(prevRel)&&f.relativeReturn24h<(prevRel as number);
}
function shortRaw(v:ShortVariant,rows:PenguDualLsV2EvaluationRow[],i:number){
  if(v==="BASELINE")return rows[i].shortSignal;
  const a=failedRallyBreakdown(rows,i),b=compressionBreakdown(rows,i),c=relativeWeaknessRejection(rows,i);
  if(v==="FAILED_RALLY_BREAKDOWN")return a;
  if(v==="COMPRESSION_BREAKDOWN")return b;
  if(v==="RELATIVE_WEAKNESS_REJECTION")return c;
  return a||b||c;
}
function shortSignal(v:ShortVariant,rows:PenguDualLsV2EvaluationRow[],i:number){
  if(v==="BASELINE")return rows[i].shortSignal;
  const now=shortRaw(v,rows,i); const prev=i>0?shortRaw(v,rows,i-1):false; return now&&!prev;
}

function replay(history:PenguDualLsV2History,funding:FundingPoint[],variant:ShortVariant,mode:Mode){
  const rows=buildPenguDualLsV2EvaluationSeries(history,EVAL_END+HOUR); const trades:Trade[]=[]; const cps=BASE_FEE_PER_SIDE+(mode==="stress"?STRESS_SLIPPAGE_PER_SIDE:0);
  let i=250,cooldown=-1;
  while(i<rows.length-2){
    if(i<=cooldown){i++;continue;}
    const side:Side|undefined=shortSignal(variant,rows,i)?"S":rows[i].longSignal?"L":undefined;
    if(!side||!rows[i].features){i++;continue;}
    const ei=i+1,entry=rows[ei].candle,gross=targetGrossForAtr(rows[i].features!.atr24Ratio);
    let pos:PenguDualLsV2Position={side:side==="L"?1:-1,entryTs:entry.openTime,entryPrice:entry.open,quantity:1,gross,highWaterMark:entry.open,lowWaterMark:entry.open};
    const hold=side==="L"?PENGU_DUAL_LS_V2.long.maxHoldHours:PENGU_DUAL_LS_V2.short.maxHoldHours; const last=Math.min(rows.length-1,ei+hold-1); let xi=last,xp=rows[last].candle.close,reason:Reason="time";
    for(let c=ei;c<=last;c++){const f=rows[c].features;assert(f);const e=evaluatePenguDualLsV2PositionBar(pos,f);pos=e.updatedPosition;if(e.exit){xi=c;xp=e.exit.stopPrice??rows[c].candle.close;reason=e.exit.reason.includes("HARD")?"hard":e.exit.reason.includes("TRAILING")?"trail":"time";break;}}
    if(entry.openTime>=EVAL_START&&entry.openTime<EVAL_END){const xt=rows[xi].candle.openTime;const raw=side==="L"?xp/entry.open-1:entry.open/xp-1;const fr=fundingBetween(funding,entry.openTime,xt);const fund=side==="L"?-fr:fr;const net=raw+fund-2*cps;trades.push({variant,side,signalTs:rows[i].candle.openTime,entryTs:entry.openTime,exitTs:xt,requestedGross:gross,accountReturn:gross*net,netUnitReturn:net,exitReason:reason});}
    cooldown=xi+PENGU_DUAL_LS_V2.cooldownHours;i=xi+1;
  }
  return trades;
}
function metrics(ts:Trade[]){let eq=1,peak=1,dd=0,gp=0,gl=0;for(const t of ts){eq*=1+t.accountReturn;peak=Math.max(peak,eq);dd=Math.min(dd,eq/peak-1);if(t.accountReturn>0)gp+=t.accountReturn;else gl-=t.accountReturn;}return{trades:ts.length,returnPct:(eq-1)*100,winRatePct:ts.length?ts.filter(t=>t.accountReturn>0).length/ts.length*100:null,profitFactor:gl>0?gp/gl:null,maxDrawdownPct:dd*100,hardStops:ts.filter(t=>t.exitReason==="hard").length,trailWins:ts.filter(t=>t.exitReason==="trail"&&t.accountReturn>0).length};}
function foldName(ts:number){const a=Date.parse("2025-12-23T15:00:00Z"),b=Date.parse("2026-04-23T15:00:00Z");return ts<a?"EARLY":ts<b?"MID":"LATE";}
function summarize(ts:Trade[]){const shorts=ts.filter(t=>t.side==="S"),longs=ts.filter(t=>t.side==="L");const folds:any={};for(const n of ["EARLY","MID","LATE"])folds[n]=metrics(shorts.filter(t=>foldName(t.entryTs)===n));return{ALL:metrics(ts),SHORT:metrics(shorts),LONG:metrics(longs),SHORT_FOLDS:folds};}

async function main(){
  const [pengu,btc,funding]=await Promise.all([downloadCandles("PENGUUSDT"),downloadCandles("BTCUSDT"),downloadFunding()]);
  const expected=Math.floor((EVAL_END-EVAL_START)/HOUR);assert.equal(pengu.filter(x=>x.openTime>=EVAL_START&&x.openTime<EVAL_END).length,expected);assert.equal(btc.filter(x=>x.openTime>=EVAL_START&&x.openTime<EVAL_END).length,expected);
  const pTs=new Set(pengu.map(x=>x.openTime));const aligned=btc.filter(x=>pTs.has(x.openTime));assert.equal(aligned.length,pengu.length);
  const history:PenguDualLsV2History={pengu1h:pengu,btc1h:aligned,penguFunding:funding};
  const variants:ShortVariant[]=["BASELINE","FAILED_RALLY_BREAKDOWN","COMPRESSION_BREAKDOWN","RELATIVE_WEAKNESS_REJECTION","ENSEMBLE"];
  const out:any={status:"PASS_RESEARCH_ONLY",schema:"pengu-short-cleansheet-v3/v1",period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},design:{principle:"clean-sheet short entry structures; current long and current exit engine frozen; no loss-trade filtering",variants},results:{},promotion:{},safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false}};
  for(const v of variants){out.results[v]={NORMAL:summarize(replay(history,funding,v,"normal")),SEVERE:summarize(replay(history,funding,v,"stress"))};}
  const base=out.results.BASELINE;
  for(const v of variants.filter(x=>x!=="BASELINE")){
    const n=out.results[v].NORMAL.SHORT,s=out.results[v].SEVERE.SHORT,bn=base.NORMAL.SHORT,bs=base.SEVERE.SHORT;
    const folds=["EARLY","MID","LATE"].filter(k=>{const x=out.results[v].NORMAL.SHORT_FOLDS[k],y=base.NORMAL.SHORT_FOLDS[k];return x.trades>=y.trades&&x.winRatePct!==null&&y.winRatePct!==null&&x.winRatePct>y.winRatePct;}).length;
    const pass=n.trades>=bn.trades&&(n.winRatePct??0)>=(bn.winRatePct??0)+5&&n.returnPct>=bn.returnPct&&(n.profitFactor??0)>=(bn.profitFactor??0)&&n.maxDrawdownPct>=bn.maxDrawdownPct&&s.returnPct>=bs.returnPct&&(s.profitFactor??0)>=(bs.profitFactor??0)&&folds>=2;
    out.promotion[v]={pass,improvedFolds:folds,requirements:{shortTradesAtLeastBaseline:true,winRatePlus5pp:true,normalReturnAtLeastBaseline:true,normalPFAtLeastBaseline:true,normalDDNoWorse:true,severeReturnAtLeastBaseline:true,severePFAtLeastBaseline:true,twoOfThreeFoldsImprove:true}};
  }
  const outPath=process.env.PENGU_SHORT_V3_OUT||".research-state/pengu-short-v3/result.json";await fs.mkdir(path.dirname(outPath),{recursive:true});await fs.writeFile(outPath,JSON.stringify(out,null,2)+"\n");console.log(JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
