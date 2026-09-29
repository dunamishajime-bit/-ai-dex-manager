import { IDLE_PRIORITY_SHORT_POLICY, type IdlePrioritySymbol } from "../config/idlePriorityShortPolicy";

export type IdleH1Candle = { ts:number; open:number; high:number; low:number; close:number; quoteVolume:number };
export type IdleFeatures = { decisionTs:number; signalTs:number; ret12:number; ret24:number; btc24:number; rel24:number; atrRatio:number; volumeRatio:number; breakdown24:boolean };
export type IdleSignal = { accepted:boolean; symbol:IdlePrioritySymbol; route:string; side:"SHORT"|"FLAT"; holdHours:number; features:IdleFeatures; reason:string };

const HOUR=3_600_000;
function ordered(rows:readonly IdleH1Candle[]){ return [...rows].sort((a,b)=>a.ts-b.ts); }
function exact(rows:IdleH1Candle[], ts:number){ return rows.find(x=>x.ts===ts) ?? null; }
function valid(c:IdleH1Candle|null){ return !!c && [c.open,c.high,c.low,c.close,c.quoteVolume].every(Number.isFinite) && c.close>0 && c.high>=c.low && c.quoteVolume>=0; }
function median(v:number[]){ const a=[...v].sort((x,y)=>x-y), n=a.length; return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2; }

export function computeIdlePriorityFeatures(decisionTs:number, symbolRows:readonly IdleH1Candle[], btcRows:readonly IdleH1Candle[]):IdleFeatures {
  if (!Number.isFinite(decisionTs) || decisionTs%HOUR!==0) throw new Error("IDLE_DECISION_TS_NOT_H1_BOUNDARY");
  const s=ordered(symbolRows), b=ordered(btcRows), signalTs=decisionTs-HOUR;
  const s1=exact(s,signalTs), s13=exact(s,decisionTs-13*HOUR), s25=exact(s,decisionTs-25*HOUR);
  const b1=exact(b,signalTs), b25=exact(b,decisionTs-25*HOUR);
  if (![s1,s13,s25,b1,b25].every(valid)) throw new Error("IDLE_INSUFFICIENT_EXACT_CLOSED_H1_HISTORY");
  const prior24=Array.from({length:24},(_,i)=>exact(s,decisionTs-(i+2)*HOUR));
  const prior72=Array.from({length:72},(_,i)=>exact(s,decisionTs-(i+2)*HOUR));
  const atr14=Array.from({length:14},(_,i)=>exact(s,decisionTs-(i+1)*HOUR));
  if (![...prior24,...prior72,...atr14].every(valid)) throw new Error("IDLE_H1_HISTORY_GAP");
  const tr=atr14.map((row)=>{
    const prev=exact(s,row!.ts-HOUR); if(!valid(prev)) throw new Error("IDLE_ATR_PREVCLOSE_GAP");
    return Math.max(row!.high-row!.low,Math.abs(row!.high-prev!.close),Math.abs(row!.low-prev!.close));
  });
  const ret12=s1!.close/s13!.close-1, ret24=s1!.close/s25!.close-1, btc24=b1!.close/b25!.close-1;
  return { decisionTs, signalTs, ret12, ret24, btc24, rel24:ret24-btc24,
    atrRatio:tr.reduce((a,x)=>a+x,0)/14/s1!.close,
    volumeRatio:s1!.quoteVolume/median(prior72.map(x=>x!.quoteVolume)),
    breakdown24:s1!.close<Math.min(...prior24.map(x=>x!.close)) };
}

export function evaluateIdlePriorityShort(symbol:IdlePrioritySymbol, features:IdleFeatures):IdleSignal {
  const p=IDLE_PRIORITY_SHORT_POLICY, r=p.routes[symbol];
  let generic=false;
  if(r.archetype==="BREAKOUT") generic=features.breakdown24 && features.volumeRatio>=p.generic.breakout.volumeRatioMin && features.atrRatio>=p.generic.breakout.atrRatioMin;
  if(r.archetype==="MOMENTUM") generic=features.ret12<=p.generic.momentum.ret12Max && features.volumeRatio>=p.generic.momentum.volumeRatioMin && features.atrRatio>=p.generic.momentum.atrRatioMin;
  if(r.archetype==="RELATIVE") generic=features.rel24<=p.generic.relative.rel24Max && features.volumeRatio>=p.generic.relative.volumeRatioMin && features.atrRatio>=p.generic.relative.atrRatioMin;
  if(!generic) return {accepted:false,symbol,route:r.route,side:"FLAT",holdHours:r.holdHours,features,reason:"GENERIC_CANDIDATE_GATE_NOT_MET"};
  if(symbol==="TAOUSDT" && features.rel24>r.rel24Max) return {accepted:false,symbol,route:r.route,side:"FLAT",holdHours:r.holdHours,features,reason:"TAO_REL24_NOT_MET"};
  if(symbol==="TIAUSDT" && features.volumeRatio>r.volumeRatioMax) return {accepted:false,symbol,route:r.route,side:"FLAT",holdHours:r.holdHours,features,reason:"TIA_VOLUME_CAP_NOT_MET"};
  if(symbol==="DOTUSDT" && (features.btc24>r.btc24Max || features.rel24>r.rel24Max)) return {accepted:false,symbol,route:r.route,side:"FLAT",holdHours:r.holdHours,features,reason:"DOT_BTCREL_NOT_MET"};
  return {accepted:true,symbol,route:r.route,side:"SHORT",holdHours:r.holdHours,features,reason:r.route};
}
