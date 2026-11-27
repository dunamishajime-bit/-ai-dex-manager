/** Read-only historical public market data reconstruction for research observation. */
import {buildPenguDualLsV2EvaluationSeries,type PenguDualLsV2History} from "./pengu-dual-ls-v2";
import type {P91Input} from "./stable4-research-decision-observation";
const H=3600000,M=300000;
export type Raw=readonly (number|string)[];
type Candle={openTime:number;closeTime:number;open:number;high:number;low:number;close:number;volume:number};
export function closedRows(raw:readonly Raw[],asof:number,width=H):Candle[]{
 if(!Number.isSafeInteger(asof)||asof<=0)throw Error("INVALID_ASOF");
 const rows:Candle[]=[];const seen=new Set<number>();
 for(const r of raw){
  if(r.length<7)throw Error("MISSING_BAR_FIELDS");
  const [t,o,h,l,c,v,end]=r.slice(0,7).map(Number);
  if(!Number.isSafeInteger(t)||t%width!==0||end!==t+width-1)throw Error("INVALID_BAR_CLOCK");
  if(t+width>asof)continue;
  if(seen.has(t))throw Error("DUPLICATE_BAR");seen.add(t);
  if(![o,h,l,c,v].every(Number.isFinite)||!(l>0&&l<=Math.min(o,c)&&Math.max(o,c)<=h)||v<0)throw Error("INVALID_BAR");
  rows.push({openTime:t,closeTime:end,open:o,high:h,low:l,close:c,volume:v});
 }
 rows.sort((a,b)=>a.openTime-b.openTime);
 return rows;
}
function contiguous(rows:Candle[],asof:number){
 if(rows.length<400||rows.at(-1)?.openTime!==Math.floor(asof/H)*H-H||rows.some((r,i)=>i>0&&r.openTime!==rows[i-1].openTime+H))throw Error("H1_MISSING_OR_STALE");
 return rows;
}
export function nativeBinanceTimes(pengu:readonly Raw[],btc:readonly Raw[],asof:number):number[]{
 const p=contiguous(closedRows(pengu,asof),asof),b=contiguous(closedRows(btc,asof),asof);
 if(p.length!==b.length||p.some((r,i)=>r.openTime!==b[i].openTime))throw Error("BINANCE_H1_ALIGNMENT");
 const history:PenguDualLsV2History={pengu1h:p,btc1h:b,penguFunding:[]};
 return buildPenguDualLsV2EvaluationSeries(history,asof).filter(x=>x.features&&x.shortSignal).map(x=>x.features!.referenceTs+H);
}
type Bucket={start:number;end:number;close:number;printed:number};
const tf=[168,24,12,4,1];
function aggregate(rows:Candle[],hours:number):Bucket[]{
 const width=hours*H,offset=hours===168?4*24*H:0;
 const map=new Map<number,Candle[]>();
 for(const r of rows){const start=Math.floor((r.openTime-offset)/width)*width+offset;const group=map.get(start)??[];group.push(r);map.set(start,group);}
 return [...map.entries()].sort((a,b)=>a[0]-b[0]).flatMap(([start,a])=>{
  if(a.length!==hours||a[0].openTime!==start||a.at(-1)!.openTime+H!==start+width)return [];
  if(a.some((r,i)=>i>0&&r.openTime!==a[i-1].openTime+H))throw Error("BUCKET_GAP");
  return [{start,end:start+width,close:a.at(-1)!.close,printed:a.filter(r=>r.volume>0).length}];
 });
}
function tail(a:Bucket[],t:number,n:number){return a.filter(x=>x.end<=t).slice(-n);}
function isContiguous(a:Bucket[],n:number){return a.length===n&&a.every((x,i)=>i===0||x.start===a[i-1].end);}
function trend(a:Bucket[],t:number){
 const z=tail(a,t,3);if(!isContiguous(z,3)||z.some(x=>x.printed===0))return 0;
 return z[0].close>z[1].close&&z[1].close>z[2].close?1:z[0].close<z[1].close&&z[1].close<z[2].close?-1:0;
}
function macro(a:Bucket[],t:number,n:number,threshold:number){
 const z=tail(a,t,n+1);if(!isContiguous(z,n+1))return "UNKNOWN";
 const last=z.at(-1)!.close,ret=last/z[0].close-1,mean=z.slice(1).reduce((s,x)=>s+x.close,0)/n;
 return ret>=threshold&&last>mean?"UP":ret<=-threshold&&last<mean?"DOWN":"MIXED";
}
export type P91Raw={asterPengu:readonly Raw[];asterBtc:readonly Raw[];binancePengu:readonly Raw[];binanceBtc:readonly Raw[];binanceEth:readonly Raw[];asterM5:readonly Raw[]};
export function reconstructP91Inputs(raw:P91Raw,signalTimes:number[],asof:number):P91Input[]{
 const ap=closedRows(raw.asterPengu,asof),ab=closedRows(raw.asterBtc,asof),bp=closedRows(raw.binancePengu,asof),bb=closedRows(raw.binanceBtc,asof),be=closedRows(raw.binanceEth,asof);
 const m=closedRows(raw.asterM5,asof,M),byM=new Map(m.map(x=>[x.openTime,x])),byH=new Map(ap.map(x=>[x.openTime,x]));
 const cache=(r:Candle[])=>tf.map(h=>aggregate(r,h));
 const ac=cache(ap),bc=cache(bp),am=cache(ab),bm=cache(bb),em=cache(be);
 return signalTimes.map(t=>{
  if(t%H!==0||t+M>asof)throw Error("SIGNAL_NOT_M5_OBSERVABLE");
  const prev=byH.get(t-H);if(!prev)throw Error("MISSING_PRIOR_ASTER_H1");
  const bar=byM.get(t);
  const asterPoints=ac.reduce((s,x,i)=>s+trend(x,t)*[5,4,3,2,1][i],0);
  const binancePoints=bc.reduce((s,x,i)=>s+trend(x,t)*[3,2,2,1,1][i],0);
  const macroBull=macro(am[0],t,4,.03)==="UP"&&macro(bm[0],t,4,.03)==="UP"&&(macro(em[0],t,4,.03)==="UP"||macro(em[1],t,7,.02)==="UP");
  return {signalTs:t,asof:t+M,macroBull,asterPoints,binancePoints,priorH1Close:prev.close,bar:bar?[bar.openTime,bar.open,bar.high,bar.low,bar.close,bar.volume]:null};
 });
}
