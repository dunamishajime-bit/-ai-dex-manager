import { IDLE_PRIORITY_SHORT_POLICY, type IdlePrioritySymbol } from "../config/idlePriorityShortPolicy";

export type IdleH1Candle = { ts:number; open:number; high:number; low:number; close:number; quoteVolume:number };
export type IdleFeatures = {
  decisionTs:number;
  signalTs:number;
  ret12:number;
  ret24:number;
  btc24:number;
  rel24:number;
  atrRatio:number;
  volumeRatio:number;
  breakoutLong24:boolean;
  breakoutShort24:boolean;
  /** Backward-compatible alias for the historical SHORT breakdown flag. */
  breakdown24:boolean;
};
export type IdleGenericArchetype = "BREAKOUT" | "MOMENTUM" | "RELATIVE";
export type IdleGenericSide = "LONG" | "SHORT";
export type IdleGenericCandidate = {
  accepted:boolean;
  archetype:IdleGenericArchetype|null;
  side:IdleGenericSide|"FLAT";
  features:IdleFeatures;
  reason:string;
};
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
  const quoteMedian=median(prior72.map(x=>x!.quoteVolume));
  if (!(quoteMedian>0)) throw new Error("IDLE_VOLUME_MEDIAN_INVALID");
  const ret12=s1!.close/s13!.close-1, ret24=s1!.close/s25!.close-1, btc24=b1!.close/b25!.close-1;
  const breakoutLong24=s1!.close>Math.max(...prior24.map(x=>x!.high));
  const breakoutShort24=s1!.close<Math.min(...prior24.map(x=>x!.low));
  return {
    decisionTs,
    signalTs,
    ret12,
    ret24,
    btc24,
    rel24:ret24-btc24,
    atrRatio:tr.reduce((a,x)=>a+x,0)/14/s1!.close,
    volumeRatio:s1!.quoteVolume/quoteMedian,
    breakoutLong24,
    breakoutShort24,
    breakdown24:breakoutShort24,
  };
}

function genericCommon(features:IdleFeatures, volumeRatioMin:number, atrRatioMin:number) {
  return features.volumeRatio>=volumeRatioMin && features.atrRatio>=atrRatioMin;
}

/**
 * Reconstruct the historical generic candidate stream BEFORE route filtering.
 * Priority is BREAKOUT -> RELATIVE -> MOMENTUM.  This candidate, including a
 * LONG candidate that will never become an Idle SHORT order, owns the
 * per-symbol 12h candidate lifecycle slot when baseline Idle admission holds.
 */
export function evaluateIdleGenericCandidate(features:IdleFeatures):IdleGenericCandidate {
  const p=IDLE_PRIORITY_SHORT_POLICY.generic;

  if (genericCommon(features,p.breakout.volumeRatioMin,p.breakout.atrRatioMin)) {
    if (features.breakoutLong24 && features.ret24>=p.breakout.ret24AbsMin) {
      return {accepted:true,archetype:"BREAKOUT",side:"LONG",features,reason:"GENERIC_BREAKOUT_LONG"};
    }
    if (features.breakoutShort24 && features.ret24<=-p.breakout.ret24AbsMin) {
      return {accepted:true,archetype:"BREAKOUT",side:"SHORT",features,reason:"GENERIC_BREAKOUT_SHORT"};
    }
  }

  if (genericCommon(features,p.relative.volumeRatioMin,p.relative.atrRatioMin)
      && Math.abs(features.ret24)>=p.relative.ret24AbsMin) {
    if (features.rel24>=p.relative.rel24AbsMin) {
      return {accepted:true,archetype:"RELATIVE",side:"LONG",features,reason:"GENERIC_RELATIVE_LONG"};
    }
    if (features.rel24<=-p.relative.rel24AbsMin) {
      return {accepted:true,archetype:"RELATIVE",side:"SHORT",features,reason:"GENERIC_RELATIVE_SHORT"};
    }
  }

  if (genericCommon(features,p.momentum.volumeRatioMin,p.momentum.atrRatioMin)) {
    if (features.ret12>=p.momentum.ret12AbsMin) {
      return {accepted:true,archetype:"MOMENTUM",side:"LONG",features,reason:"GENERIC_MOMENTUM_LONG"};
    }
    if (features.ret12<=-p.momentum.ret12AbsMin) {
      return {accepted:true,archetype:"MOMENTUM",side:"SHORT",features,reason:"GENERIC_MOMENTUM_SHORT"};
    }
  }

  return {accepted:false,archetype:null,side:"FLAT",features,reason:"GENERIC_CANDIDATE_GATE_NOT_MET"};
}

export function evaluateIdlePriorityShort(
  symbol:IdlePrioritySymbol,
  features:IdleFeatures,
  generic:IdleGenericCandidate=evaluateIdleGenericCandidate(features),
):IdleSignal {
  const p=IDLE_PRIORITY_SHORT_POLICY, r=p.routes[symbol];
  if(!generic.accepted || generic.side!=="SHORT" || generic.archetype!==r.archetype) {
    return {accepted:false,symbol,route:r.route,side:"FLAT",holdHours:r.holdHours,features,reason:"GENERIC_ROUTE_MISMATCH"};
  }
  if(symbol==="TAOUSDT" && features.rel24>p.routes.TAOUSDT.rel24Max) return {accepted:false,symbol,route:r.route,side:"FLAT",holdHours:r.holdHours,features,reason:"TAO_REL24_NOT_MET"};
  if(symbol==="TIAUSDT" && features.volumeRatio>p.routes.TIAUSDT.volumeRatioMax) return {accepted:false,symbol,route:r.route,side:"FLAT",holdHours:r.holdHours,features,reason:"TIA_VOLUME_CAP_NOT_MET"};
  if(symbol==="DOTUSDT" && (features.btc24>p.routes.DOTUSDT.btc24Max || features.rel24>p.routes.DOTUSDT.rel24Max)) return {accepted:false,symbol,route:r.route,side:"FLAT",holdHours:r.holdHours,features,reason:"DOT_BTCREL_NOT_MET"};
  return {accepted:true,symbol,route:r.route,side:"SHORT",holdHours:r.holdHours,features,reason:r.route};
}
