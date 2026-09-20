import type { AsterKline } from "@/lib/aster-v3-client";
import { FET_BRK48_RESIDUAL } from "@/config/fetBrk48Runtime";

export interface FetBrk48Bar { openTs:number; closeTs:number; open:number; high:number; low:number; close:number; volume:number; }
export interface FetBrk48Signal { strategyId:string; symbol:"FETUSDT"; side:"LONG"; referenceTs:number; entryTs:number; entryPrice:number; prior48hHigh:number; volumeMedian72h:number; volumeRatio:number; hardStopPrice:number; exitTs:number; }
function n(v:unknown){const x=Number(v);return Number.isFinite(x)?x:0;}
export function normalizeFetH1(rows: readonly AsterKline[], now:number): FetBrk48Bar[] {
  return rows.map(r=>({openTs:n(r[0]),open:n(r[1]),high:n(r[2]),low:n(r[3]),close:n(r[4]),volume:n(r[5]),closeTs:n(r[6])}))
    .filter(r=>r.openTs>0&&r.closeTs>0&&r.closeTs<now&&r.open>0&&r.high>0&&r.low>0&&r.close>0&&r.volume>=0)
    .sort((a,b)=>a.openTs-b.openTs);
}
function median(values:number[]){const a=[...values].sort((x,y)=>x-y); if(!a.length)return 0; const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
export function buildFetBrk48Signal(rows: readonly FetBrk48Bar[], now:number): FetBrk48Signal | undefined {
  const entryTs=Math.floor(now/3_600_000)*3_600_000;
  const entryHour=new Date(entryTs).getUTCHours();
  if(entryHour%FET_BRK48_RESIDUAL.decisionEntryHourModulo!==FET_BRK48_RESIDUAL.decisionEntryHourRemainder)return undefined;
  if(now-entryTs>FET_BRK48_RESIDUAL.liveEntryWindowMs)return undefined;
  const completed=rows.filter(r=>r.closeTs<entryTs);
  if(completed.length<73)return undefined;
  const signal=completed[completed.length-1];
  if(signal.openTs!==entryTs-3_600_000)return undefined;
  const prior48=completed.slice(-49,-1);
  const prior72=completed.slice(-73,-1);
  if(prior48.length!==48||prior72.length!==72)return undefined;
  const prior48hHigh=Math.max(...prior48.map(r=>r.high));
  const volumeMedian72h=median(prior72.map(r=>r.volume));
  const volumeRatio=volumeMedian72h>0?signal.volume/volumeMedian72h:0;
  if(!(signal.close>prior48hHigh)||volumeRatio+1e-12<FET_BRK48_RESIDUAL.minimumVolumeRatio)return undefined;
  const entryPrice=signal.close; // live sizing uses fresh executable quote; this is causal signal anchor only.
  return {strategyId:FET_BRK48_RESIDUAL.strategyId,symbol:"FETUSDT",side:"LONG",referenceTs:signal.closeTs,entryTs,entryPrice,prior48hHigh,volumeMedian72h,volumeRatio,hardStopPrice:entryPrice*(1-FET_BRK48_RESIDUAL.hardStopPct),exitTs:entryTs+FET_BRK48_RESIDUAL.holdHours*3_600_000};
}
