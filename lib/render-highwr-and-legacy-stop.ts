/**
 * RENDER / BTC divergence independent SHORT and existing RENDER first-adverse exit.
 *
 * CODEX HANDOFF: pure causal decision contract; neither import nor evaluation
 * can place orders. Existing exchange protective STOPs and the shared-account
 * owner must remain authoritative. LIVE wiring is deliberately not present.
 *
 * Historical model: BTC_RENDER_DIVERGE / S6 shadow TP+1.5%, STOP-2%, max6h;
 * high-WR entry quality from exited SIX-HOUR hypothetical shadows, and
 * independent trade max6h (live TP2.5%, STOP2%; shadow TP1.5%, STOP2%).
 *
 * Upper wick threshold is 0.35% OF H1 OPEN (not 35% of candle range).
 * No OI requirement. Existing RENDER #4427/OI filters are unaffected.
 */

export const RENDER_INDEPENDENT_ROUTE = "IDLE_RENDER_INDEPENDENT_HIGHWR_WICK_SHARP_S6_SHORT" as const;
export const RENDER_SHADOW_VERSION = "render-independent-6h-shadow-to-55m/v1" as const;
export const RENDER_M5_MS = 300_000;
export const RENDER_H1_MS = 3_600_000;
export const RENDER_ENTRY_POLICY = Object.freeze({
  btcH1ReturnMinPct: 0.15,
  renderH1ReturnMaxPct: -0.5,
  renderCompletedH4ReturnMaxPct: -0.15,
  takerSellShareMin: 0.53,
  upperWickHeightAsPercentOfH1OpenMin: 0.35,
  shadowTakeProfitPct: 1.5,
  shadowStopLossPct: 2,
  shadowMaxMinutes: 360,
  independentRealMaxMinutes: 360,
  independentRequestedGross: 0.75,
  independentRealTakeProfitPct: 2.5,
  independentRealStopLossPct: 2,
  independentVenueLeverage: 5,
  shadowCostRoundTripBps: 30,
  newIndependentCooldownHours: 12,
  incumbentBonusScore: 8,
  minimumScoreUpgradeOverIncumbent: 8,
} as const);

export const RENDER_LEGACY_INITIAL_STOP_POLICY = Object.freeze({
  appliesTo: "EXISTING_RENDER_SHORT_ONLY",
  adverseTouchAtOrBelowPct: -1,
  watchMinutes: 120,
  stillAtOrBelowPct: -1,
  maxFavorableExcursionMustBeStrictlyBelowPct: 0.25,
  usesOnlyClosedM5: true,
  onTrigger: "REQUEST_EXISTING_PROTECTED_REDUCE_ONLY_CLOSE_AFTER_CANDLE_CLOSE",
} as const);

export type ClosedM5 = Readonly<{
  /** Candle OPEN timestamp, aligned to 5m; candle is complete only after ts+5m. */
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Base token volume, not quote-volume. */
  baseVolume?: number;
  /** Required on RENDER ENTRY signal; optional for BTC/price-only shadow exit. */
  takerBuyBaseVolume?: number;
}>;

export type IndependentFeatures = Readonly<{
  decisionTs: number;
  btcH1Pct: number;
  renderH1Pct: number;
  renderCompletedH4Pct: number;
  renderCompletedD1Pct: number;
  volumeRatio: number;
  sellerShare: number;
  upperWickPctOfOpen: number;
}>;

export type IndependentGateDecision = Readonly<{
  accepted: boolean;
  reason: string;
  features?: IndependentFeatures;
}>;

function safeNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
function pct(r: number): number { return r * 100; }

function checkedMap(bars: readonly ClosedM5[], decisionTs: number, requireTakerFlow = true): Map<number, ClosedM5> {
  if (!Number.isSafeInteger(decisionTs) || decisionTs <= 0 || decisionTs % RENDER_H1_MS !== 0) {
    throw new Error("RENDER_DECISION_NOT_CLOSED_H1_BOUNDARY");
  }
  const map = new Map<number, ClosedM5>();
  for (const b of bars) {
    if (!Number.isSafeInteger(b.ts) || b.ts % RENDER_M5_MS !== 0) throw new Error("RENDER_INVALID_M5_TS");
    if (b.ts + RENDER_M5_MS > decisionTs) continue; // forming/future bars are not used
    if ([b.open,b.high,b.low,b.close].some(z=>!safeNumber(z))) throw new Error("RENDER_M5_NONFINITE");
    if (b.open <= 0 || b.close <= 0 || b.high < Math.max(b.open,b.close) || b.low > Math.min(b.open,b.close)) {
      throw new Error("RENDER_M5_INVALID_PRICE_OR_VOLUME");
    }
    if (requireTakerFlow && (!safeNumber(b.baseVolume)||!safeNumber(b.takerBuyBaseVolume)||
      b.baseVolume < 0 || b.takerBuyBaseVolume < 0 || b.takerBuyBaseVolume > b.baseVolume*(1+1e-8))) {
      throw new Error("RENDER_M5_REQUIRED_TAKER_FLOW_INVALID");
    }
    if (map.has(b.ts)) throw new Error("RENDER_DUPLICATE_M5_TS");
    map.set(b.ts,b);
  }
  return map;
}
function exactWindow(map: Map<number,ClosedM5>, begin: number, end: number): ClosedM5[] {
  if (begin >= end || begin % RENDER_M5_MS !== 0 || end % RENDER_M5_MS !== 0) throw new Error("RENDER_INVALID_WINDOW");
  const result: ClosedM5[] = [];
  for (let t=begin;t<end;t+=RENDER_M5_MS) {
    const c=map.get(t);
    if (!c) throw new Error("RENDER_COMPLETED_M5_GAP");
    result.push(c);
  }
  return result;
}

/** Confirmed H1 and most recently fully completed H4, never an in-progress 4h block. */
export function evaluateRenderIndependentGate(input:{
  decisionTs:number;
  renderM5:readonly ClosedM5[];
  btcM5:readonly ClosedM5[];
}): IndependentGateDecision {
  const {decisionTs}=input;
  try {
    const r=checkedMap(input.renderM5,decisionTs,true), b=checkedMap(input.btcM5,decisionTs,false);
    const lastHour=exactWindow(r,decisionTs-RENDER_H1_MS,decisionTs);
    const btcHour=exactWindow(b,decisionTs-RENDER_H1_MS,decisionTs);
    const lastCompletedH4End=Math.floor(decisionTs/(4*RENDER_H1_MS))*4*RENDER_H1_MS;
    const priorH4=exactWindow(r,lastCompletedH4End-4*RENDER_H1_MS,lastCompletedH4End);
    const lastCompletedD1End=Math.floor(decisionTs/(24*RENDER_H1_MS))*24*RENDER_H1_MS;
    const priorD1=exactWindow(r,lastCompletedD1End-24*RENDER_H1_MS,lastCompletedD1End);
    const previousHourVolumes=Array.from({length:6},(_,i)=>{
      const start=decisionTs-(i+2)*RENDER_H1_MS;
      return exactWindow(r,start,start+RENDER_H1_MS).reduce((acc,x)=>acc+x.baseVolume!,0);
    }).sort((a,b)=>a-b);
    const previousVolumeMedian=(previousHourVolumes[2]!+previousHourVolumes[3]!)/2;
    if (!(previousVolumeMedian>0)) throw new Error("RENDER_M5_HOURLY_VOLUME_MEDIAN_ZERO");
    const first=lastHour[0]!,last=lastHour[lastHour.length-1]!;
    const bFirst=btcHour[0]!,bLast=btcHour[btcHour.length-1]!;
    const high=Math.max(...lastHour.map(x=>x.high));
    const vol=lastHour.reduce((a,x)=>a+x.baseVolume!,0);
    const buys=lastHour.reduce((a,x)=>a+x.takerBuyBaseVolume!,0);
    if (!(vol>0)) throw new Error("RENDER_M5_ZERO_VOLUME");
    const features:IndependentFeatures={
      decisionTs,btcH1Pct:pct(bLast.close/bFirst.open-1),
      renderH1Pct:pct(last.close/first.open-1),
      renderCompletedH4Pct:pct(priorH4[priorH4.length-1]!.close/priorH4[0]!.open-1),
      renderCompletedD1Pct:pct(priorD1[priorD1.length-1]!.close/priorD1[0]!.open-1),
      volumeRatio:vol/previousVolumeMedian,
      sellerShare:(vol-buys)/vol,
      upperWickPctOfOpen:pct((high-Math.max(first.open,last.close))/first.open),
    };
    const p=RENDER_ENTRY_POLICY;
    if (features.btcH1Pct < p.btcH1ReturnMinPct) return {accepted:false,reason:"BTC_H1_DIVERGENCE_NOT_MET",features};
    if (features.renderH1Pct > p.renderH1ReturnMaxPct) return {accepted:false,reason:"RENDER_H1_DOWN_NOT_MET",features};
    if (features.renderCompletedH4Pct > p.renderCompletedH4ReturnMaxPct) return {accepted:false,reason:"RENDER_COMPLETE_H4_DOWN_NOT_MET",features};
    if (features.sellerShare < p.takerSellShareMin) return {accepted:false,reason:"RENDER_TAKER_SELL_SHARE_NOT_MET",features};
    if (features.upperWickPctOfOpen < p.upperWickHeightAsPercentOfH1OpenMin) return {accepted:false,reason:"RENDER_H1_UPPER_WICK_NOT_MET",features};
    return {accepted:true,reason:"RENDER_INDEPENDENT_WICK_SHARP_SIGNAL",features};
  } catch(e) {
    return {accepted:false,reason:e instanceof Error?e.message:"RENDER_INDEPENDENT_DATA_INVALID"};
  }
}

export type ShadowSixHourResult = Readonly<{
  route:typeof RENDER_INDEPENDENT_ROUTE;
  signalTs:number;
  exitTs:number;
  /** When all data needed to compute this outcome was observably available. */
  settledAt:number;
  entryPrice:number;
  exitPrice:number;
  result:"TAKE"|"STOP"|"TIME";
  /** Historical round-trip 30bps net result, independent of actual 55m fill. */
  net30Pct:number;
}>;

/**
 * Reprice a *hypothetical*, independent 6h shadow from complete historical M5.
 * Does not require/assume a real trade. It remains alive after real 55m close.
 * Stops conservatively win same-bar ambiguities; M5 gaps do not pass.
 * TIME is marked only after the 6h expiry candle itself is complete.
 */
export function settleSixHourShadow(input:{
  signalTs:number;
  asOfTs:number;
  renderM5:readonly ClosedM5[];
}):ShadowSixHourResult|null {
  const {signalTs,asOfTs,renderM5}=input;
  if (!Number.isSafeInteger(signalTs) || signalTs%RENDER_H1_MS!==0 ||
      !Number.isSafeInteger(asOfTs) || asOfTs%RENDER_M5_MS!==0 || asOfTs<signalTs) {
    throw new Error("RENDER_SHADOW_TIME_INVALID");
  }
  const map=checkedMap(renderM5,Math.floor(asOfTs/RENDER_H1_MS)*RENDER_H1_MS+RENDER_H1_MS,false);
  const entry=map.get(signalTs);
  if (!entry) {
    if (signalTs+RENDER_M5_MS<=asOfTs) throw new Error("RENDER_SHADOW_ENTRY_M5_MISSING");
    return null;
  }
  if (signalTs+RENDER_M5_MS>asOfTs) return null;
  const entryPrice=entry.open;
  const end=signalTs+RENDER_ENTRY_POLICY.shadowMaxMinutes*60_000;
  const hardStop=entryPrice*(1+RENDER_ENTRY_POLICY.shadowStopLossPct/100);
  const tp=entryPrice*(1-RENDER_ENTRY_POLICY.shadowTakeProfitPct/100);
  const until=Math.min(end,asOfTs);
  for (let t=signalTs;t<until;t+=RENDER_M5_MS) {
    const candle=map.get(t);
    if (!candle) throw new Error("RENDER_SHADOW_M5_GAP");
    if (candle.high>=hardStop) {
      const price=Math.max(candle.open,hardStop);
      return {route:RENDER_INDEPENDENT_ROUTE,signalTs,exitTs:t,settledAt:t+RENDER_M5_MS,
        entryPrice,exitPrice:price,result:"STOP",
        net30Pct:pct(1-price/entryPrice)-RENDER_ENTRY_POLICY.shadowCostRoundTripBps/100};
    }
    if (candle.low<=tp) {
      return {route:RENDER_INDEPENDENT_ROUTE,signalTs,exitTs:t,settledAt:t+RENDER_M5_MS,
        entryPrice,exitPrice:tp,result:"TAKE",
        net30Pct:pct(1-tp/entryPrice)-RENDER_ENTRY_POLICY.shadowCostRoundTripBps/100};
    }
  }
  if (asOfTs<end+RENDER_M5_MS) return null;
  const expiry=map.get(end);
  if (!expiry) throw new Error("RENDER_SHADOW_EXPIRY_M5_MISSING");
  return {route:RENDER_INDEPENDENT_ROUTE,signalTs,exitTs:end,settledAt:end+RENDER_M5_MS,
    entryPrice,exitPrice:expiry.open,result:"TIME",
    net30Pct:pct(1-expiry.open/entryPrice)-RENDER_ENTRY_POLICY.shadowCostRoundTripBps/100};
}

export type HistoricalQuality = Readonly<{n:number;wins:number;winRate:number;profitFactor:number;meanNetPct:number}>;
function historicalQuality(values:readonly number[]):HistoricalQuality{
  const gain=values.filter(x=>x>0).reduce((a,b)=>a+b,0);
  const loss=-values.filter(x=>x<0).reduce((a,b)=>a+b,0);
  return {n:values.length,wins:values.filter(x=>x>0).length,
    winRate:values.length?values.filter(x=>x>0).length/values.length:0,
    profitFactor:loss>0?gain/loss:values.length>=3?5:0,
    meanNetPct:values.length?values.reduce((a,b)=>a+b,0)/values.length:0};
}

export type IndependentPriority = Readonly<{
  accepted:boolean;
  reason:string;
  score?:number;
  qualityLifetime?:HistoricalQuality;
  quality365?:HistoricalQuality;
  chosenRoute?:string;
  /** A same-symbol incumbent wins on missing/uncertain evidence. */
  incumbentPreserved:boolean;
}>;

export function evaluateIndependentPriority(input:{
  decisionTs:number;
  gate:IndependentGateDecision;
  /** All hypothetical S6 outcomes, including those not entered into real wallet. */
  fullySettledSixHourShadows:readonly ShadowSixHourResult[];
  /** When false, shadow WR/PF/sample count are diagnostic only, not entry gates. */
  requireShadowQuality?:boolean;
  /** Optional incumbent candidate; passed in by existing owner after own gate. */
  incumbent?:{route:string;score?:number};
  /** All source/owner/margin/venue safety gates still must be satisfied by Codex. */
  sameSymbolPositionOrPending:boolean;
  cooldownUntil:number;
}):IndependentPriority{
  const reject=(reason:string):IndependentPriority=>({accepted:false,reason,incumbentPreserved:true,
    chosenRoute:input.incumbent?.route});
  if (!input.gate.accepted||!input.gate.features) return reject("RENDER_INDEPENDENT_RAW_GATE_FAILED");
  const t=input.decisionTs;
  if (input.gate.features.decisionTs!==t) return reject("RENDER_INDEPENDENT_DECISION_TS_MISMATCH");
  if (input.sameSymbolPositionOrPending) return reject("RENDER_INDEPENDENT_SYMBOL_OWNED_OR_PENDING");
  if (!Number.isSafeInteger(input.cooldownUntil)||t<input.cooldownUntil) return reject("RENDER_INDEPENDENT_COOLDOWN");
  const valid=input.fullySettledSixHourShadows.every(v=>
    v.route===RENDER_INDEPENDENT_ROUTE && Number.isSafeInteger(v.signalTs) &&
    Number.isSafeInteger(v.settledAt) && v.settledAt>=v.signalTs &&
    Number.isFinite(v.net30Pct) && Number.isFinite(v.entryPrice) && Number.isFinite(v.exitPrice));
  if(!valid) return reject("RENDER_SHADOW_LEDGER_INVALID");
  const id=new Set<number>();
  for(const v of input.fullySettledSixHourShadows){
    if(id.has(v.signalTs)) return reject("RENDER_SHADOW_DUPLICATE_SIGNAL");
    id.add(v.signalTs);
  }
  const known=input.fullySettledSixHourShadows.filter(v=>v.settledAt<t);
  const scores=known.map(v=>v.net30Pct);
  const p365=known.filter(v=>v.settledAt>=t-365*24*RENDER_H1_MS).map(v=>v.net30Pct);
  const lifetime=historicalQuality(scores),year=historicalQuality(p365);
  if (input.requireShadowQuality!==false && !(lifetime.n>=24 && lifetime.winRate>=.75 && lifetime.profitFactor>=1.35 &&
      lifetime.meanNetPct>=.10 && year.n>=3 && year.winRate>=.60 && year.meanNetPct>=0)) {
    return {...reject("RENDER_INDEPENDENT_SIX_HOUR_SHADOW_QUALITY_NOT_MET"),qualityLifetime:lifetime,quality365:year};
  }
  const f=input.gate.features;
  const prev180=historicalQuality(known.filter(v=>v.settledAt>=t-180*24*RENDER_H1_MS).map(v=>v.net30Pct));
  // Original #4427 research score, frozen family score + incumbent bonus.
  const wrSmoothed=(prev180.wins+4)/(prev180.n+8);
  const meanSmoothed=(prev180.meanNetPct*prev180.n)/(prev180.n+8);
  const score=50*wrSmoothed+18*Math.max(-1,Math.min(1,meanSmoothed))+
    12*Math.max(0,Math.min(1,(f.sellerShare-.5)*10))+
    8*Math.max(0,Math.min(1,-f.renderCompletedH4Pct/2))+
    5*Math.max(0,Math.min(1,-f.renderCompletedD1Pct/3))+
    4*Math.max(0,Math.min(1,f.volumeRatio-1));
  if (input.incumbent) {
    // Without a causally scored incumbent there is no permission to replace it.
    if(typeof input.incumbent.score!=="number" || !Number.isFinite(input.incumbent.score)) return {...reject("RENDER_INCUMBENT_SCORE_UNPROVEN"),score,qualityLifetime:lifetime,quality365:year};
    if(score < input.incumbent.score! + RENDER_ENTRY_POLICY.minimumScoreUpgradeOverIncumbent)
      return {...reject("RENDER_INCUMBENT_HIGHER_QUALITY_PRIORITY"),score,qualityLifetime:lifetime,quality365:year};
  }
  return {accepted:true,reason:"RENDER_INDEPENDENT_HIGH_WR_PRIORITY_PASS",
    score,qualityLifetime:lifetime,quality365:year,chosenRoute:RENDER_INDEPENDENT_ROUTE,incumbentPreserved:false};
}

/**
 * Scoped: original RENDER (not independent) initial negative close.
 * Must be persisted across restarts by the runner alongside existing resident
 * STOP/TP, position and partial-fill state. State never sends an order.
 */
export type LegacyRenderAdverseState = Readonly<{
  originalRoute:string;
  entryTs:number;
  entryPrice:number;
  lastClosedM5Ts:number|null;
  watchStartedAt:number|null;
  maxFavorableExcursionPct:number;
  completed:boolean;
}>;
export function startLegacyRenderAdverse(input:{originalRoute:string;entryTs:number;entryPrice:number}):LegacyRenderAdverseState {
  if (!(input.entryPrice>0)||!Number.isSafeInteger(input.entryTs)||input.entryTs%RENDER_M5_MS!==0||
      !input.originalRoute || input.originalRoute===RENDER_INDEPENDENT_ROUTE)
    throw new Error("RENDER_LEGACY_ENTRY_INVALID");
  return {...input,lastClosedM5Ts:null,watchStartedAt:null,maxFavorableExcursionPct:0,completed:false};
}
export function advanceLegacyRenderAdverse(state:LegacyRenderAdverseState,bar:ClosedM5):{
  state:LegacyRenderAdverseState;
  requestProtectedReduceOnlyClose:boolean;
  reason:string;
  /** Earliest next M5 OPEN for a model fill; venue must reconcile live quote. */
  eligibleAfterTs:number;
} {
  const closeTs=bar.ts+RENDER_M5_MS;
  if(state.completed) return {state,requestProtectedReduceOnlyClose:false,reason:"ALREADY_TRIGGERED",eligibleAfterTs:closeTs};
  if (state.originalRoute===RENDER_INDEPENDENT_ROUTE) throw new Error("RENDER_STOP_WRONG_ROUTE");
  if(!Number.isSafeInteger(bar.ts)||bar.ts%RENDER_M5_MS!==0||bar.ts<state.entryTs||
     (state.lastClosedM5Ts===null&&bar.ts!==state.entryTs)||
     (state.lastClosedM5Ts!==null&&bar.ts!==state.lastClosedM5Ts)) {
    throw new Error("RENDER_LEGACY_M5_GAP_OR_DUPLICATE");
  }
  if (![bar.open,bar.high,bar.low,bar.close].every(safeNumber) ||
      bar.open<=0||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)) {
    throw new Error("RENDER_LEGACY_BAD_M5");
  }
  const maxMfe=Math.max(state.maxFavorableExcursionPct,pct(1-bar.low/state.entryPrice));
  const gainClose=pct(1-bar.close/state.entryPrice);
  const watchStartedAt=state.watchStartedAt ?? (gainClose<=-1?closeTs:null);
  const next={...state,lastClosedM5Ts:closeTs,watchStartedAt,maxFavorableExcursionPct:maxMfe};
  const ready=watchStartedAt!==null && closeTs>=watchStartedAt+RENDER_LEGACY_INITIAL_STOP_POLICY.watchMinutes*60_000;
  const adverse=gainClose<=RENDER_LEGACY_INITIAL_STOP_POLICY.stillAtOrBelowPct;
  const noMeaningfulGain=maxMfe<RENDER_LEGACY_INITIAL_STOP_POLICY.maxFavorableExcursionMustBeStrictlyBelowPct;
  if (ready&&adverse&&noMeaningfulGain) {
    return {state:{...next,completed:true},requestProtectedReduceOnlyClose:true,
      reason:"RENDER_LEGACY_NEGATIVE1_WATCH2H_MFE_LT_025",eligibleAfterTs:closeTs};
  }
  // Matches frozen BT WATCH semantics: after the 2h checkpoint, a recovery
  // cancels this watch; a *new* confirmed -1% candle can start a fresh watch.
  const resetOnRecovery=ready && !adverse;
  return {state:resetOnRecovery?{...next,watchStartedAt:null}:next,requestProtectedReduceOnlyClose:false,
    reason:ready?(adverse?"RENDER_LEGACY_MFE_EXCEEDED":"RENDER_LEGACY_RECOVERED"):"RENDER_LEGACY_WATCHING",
    eligibleAfterTs:closeTs};
}

/** Exact fixed time and resident order levels. A runner must verify venue STOP/TP readback. */
export function independentProtectiveLevels(entryPrice:number,entryTs:number){
  if (!(entryPrice>0)||!Number.isFinite(entryPrice)||!Number.isSafeInteger(entryTs)||entryTs%RENDER_M5_MS!==0) {
    throw new Error("RENDER_INDEPENDENT_PRICE_OR_ENTRY_TS_INVALID");
  }
  return {side:"SHORT" as const,
    stopLossPrice:entryPrice*(1+RENDER_ENTRY_POLICY.independentRealStopLossPct/100),
    takeProfitPrice:entryPrice*(1-RENDER_ENTRY_POLICY.independentRealTakeProfitPct/100),
    maxHoldExitTs:entryTs+RENDER_ENTRY_POLICY.independentRealMaxMinutes*60_000,
    requestedGross:RENDER_ENTRY_POLICY.independentRequestedGross};
}
