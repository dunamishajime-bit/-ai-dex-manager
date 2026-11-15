/**
 * Q102 pre-month research replay. Completes a closed-trade ledger from
 * synthetic / explicitly supplied H1 OHLCV using the pinned native grid,
 * exit simulator and native cost function. This is NOT S1/S2 stage membership
 * or proof of historical exchange executions.
 */
import {
  QUALITY102_DAY_MS, QUALITY102_HOUR_MS, QUALITY102_HIGH_VOL_MAX_HOLD_HOURS,
  QUALITY102_RESEARCH_COSTS, computeQuality102HighVolFeatures,
  matchQuality102HighVolGrid, quality102HighVolRuleKey,
  quality102NetFromGross, simulateQuality102HighVolExit,
  type Quality102Candle, type Quality102HighVolRule,
} from "./pinned-native-q102/disdex-quality102-causal-pipeline";
import {
  inspectQ102HvClosedTradeMonth,
  type Q102HvClosedResearchLedger,
  type Q102HvClosedResearchTrade,
  type Q102HvMonthlyResearchResult
} from "./q102-highvol-closed-ledger-monthly";

const H=QUALITY102_HOUR_MS;
const WARMUP=336;
const MAX_RULES=32;

export type Q102HvNativeClosedModelEvent = {
  id:string;ruleKey:string;side:1|-1;
  signalBarStartMs:number;signalAvailableAtMs:number;
  entryAtMs:number;entryModelPrice:number;
  exitBarStartMs:number;exitAvailableAtMs:number;
  exitModelPrice:number;exitReason:"hard_stop"|"trail_5pct_after_12pct"|"72h_time";
  holdHours:number;grossReturn:number;netReturn:number;
};

/** All returned trades are model outcomes for individually frozen grid scenarios. */
export type Q102HvCausalReplay = {
  schema:"disdex-bt-q102-180d-native-closed-model-replay-v1";
  source:"ARTIFICIAL_OR_EXPLICIT_H1_RESEARCH_ONLY";
  barCount:number;trainingDays:180;rulesTested:number;
  gridMatches:number;excludedOverlapping:number;
  rightCensored:number;closedModelTrades:number;
  closedTradeIds:readonly string[];
  modelEvents:readonly Q102HvNativeClosedModelEvent[];
  ledger:Q102HvClosedResearchLedger;
  selection:Q102HvMonthlyResearchResult;
  verifiedStageMembership:false;nativeS1S2Orders:0;
};

function assertBars(bars:readonly Quality102Candle[],first:number,last:number){
  const expected=(last-first)/H+1;
  if(bars.length!==expected)throw Error("Q102_180D_H1_EXACT_COVERAGE_REQUIRED");
  for(let i=0;i<bars.length;i++){
    const x=bars[i],ts=first+i*H;
    if(x.timestampMs!==ts||!Number.isSafeInteger(ts)||
      ![x.open,x.high,x.low,x.close,x.quoteVolume].every(Number.isFinite)||
      x.open<=0||x.close<=0||x.low<=0||x.quoteVolume<0||
      x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close))
      throw Error("Q102_180D_H1_NONCAUSAL_OR_INVALID_BAR");
  }
}
function isMatched(rule:Quality102HighVolRule,
  match:ReturnType<typeof matchQuality102HighVolGrid>[number]){
  return match.hardStop===rule.hardStop && (
    match.side===1
      ? match.threshold===rule.longDrop && match.rsi===rule.longRsi
      : match.threshold===rule.shortRally && match.rsi===rule.shortRsi
  );
}

/**
 * Requires 336 warmup candles before the first training hour, then all
 * completed H1 bars through trainingEnd-1h. This convention deliberately
 * lags the native bar-start exit timestamp by 1h for close availability.
 * All rules are supplied before replay; no optimizer chooses them from outcomes.
 */
export function replayQ102HvNativeClosed180d(input:{
  monthStartMs:number;
  bars:readonly Quality102Candle[];
  frozenRules:readonly Quality102HighVolRule[];
}):Q102HvCausalReplay {
  const {monthStartMs,bars,frozenRules}=input;
  const missing=inspectQ102HvClosedTradeMonth(monthStartMs,null);
  const start=monthStartMs-180*QUALITY102_DAY_MS;
  const end=monthStartMs-H;
  const first=start-WARMUP*H;
  assertBars(bars,first,end-H);
  if(!frozenRules.length||frozenRules.length>MAX_RULES)
    throw Error("Q102_180D_FROZEN_RULESET_REQUIRED");
  const ruleKeys=new Set<string>();
  for(const rule of frozenRules){
    const key=quality102HighVolRuleKey(rule);
    if(ruleKeys.has(key))throw Error("Q102_180D_DUPLICATE_FROZEN_RULE");
    ruleKeys.add(key);
  }

  const rows:Q102HvClosedResearchTrade[]=[];
  const modelEvents:Q102HvNativeClosedModelEvent[]=[];
  let matched=0,overlapping=0,rightCensored=0;
  for(const rule of frozenRules){
    const key=quality102HighVolRuleKey(rule);
    let unavailableUntil=-Infinity;
    // Current bar is fully closed at (timestamp+H); decisions use that bar
    // and earlier only, with next-hour entry.open as a modeled quote.
    for(let i=WARMUP;i+1<bars.length;i++){
      const signal=bars[i],entry=bars[i+1];
      const features=computeQuality102HighVolFeatures(bars.slice(i-WARMUP,i+1),WARMUP);
      if(!matchQuality102HighVolGrid(features).some(m=>isMatched(rule,m)))continue;
      matched++;
      if(entry.timestampMs<start||entry.timestampMs>end)continue;
      if(entry.timestampMs<unavailableUntil){overlapping++;continue;}
      const side=features.ret14d>=0?1 as const:-1 as const;
      const nextBars=bars.slice(i+1,i+1+QUALITY102_HIGH_VOL_MAX_HOLD_HOURS);
      let exit:ReturnType<typeof simulateQuality102HighVolExit>;
      try{
        exit=simulateQuality102HighVolExit({
          side,entryPrice:entry.open,hardStop:rule.hardStop,bars:nextBars
        });
      }catch(e){
        if(e instanceof Error&&e.message==="QUALITY102_HV_EXIT_BARS_INSUFFICIENT_FOR_72H"){
          rightCensored++;unavailableUntil=Infinity;continue;
        }
        throw e;
      }
      // Exit timestamps in the native function denote the OPEN of the
      // exit candle; its complete OHLC is only known at that candle's CLOSE.
      const exitAvailableAt=exit.exitTs+H;
      if(exitAvailableAt>end){rightCensored++;unavailableUntil=Infinity;continue;}
      const net=quality102NetFromGross(
        exit.grossReturn,exit.holdHours,
        QUALITY102_RESEARCH_COSTS.normal.perSide,
        QUALITY102_RESEARCH_COSTS.normal.fundingPerDay
      );
      if(net<=-1||!Number.isFinite(net))
        throw Error("Q102_180D_INVALID_MODEL_NET_RETURN");
      const id="GRID_RESEARCH:"+key+":"+entry.timestampMs;
      rows.push({
        id,rule,openedAtMs:entry.timestampMs,closedAtMs:exitAvailableAt,
        netReturn:net
      });
      modelEvents.push({
        id,ruleKey:key,side,signalBarStartMs:signal.timestampMs,
        signalAvailableAtMs:signal.timestampMs+H,
        entryAtMs:entry.timestampMs,entryModelPrice:entry.open,
        exitBarStartMs:exit.exitTs,exitAvailableAtMs:exitAvailableAt,
        exitModelPrice:exit.exitPrice,exitReason:exit.exitReason,
        holdHours:exit.holdHours,grossReturn:exit.grossReturn,netReturn:net
      });
      unavailableUntil=exitAvailableAt;
    }
  }
  const ledger:Q102HvClosedResearchLedger={
    kind:"ISOLATED_RESEARCH_COMPLETED_TRADES",windowStartMs:start,
    windowEndMs:end,rows
  };
  const selection=inspectQ102HvClosedTradeMonth(monthStartMs,ledger);
  if(missing.sourceOutcome!=="MISSING_COMPLETED_LEDGER" ||
     selection.fills!==0||selection.liveEntryEnabled)
    throw Error("Q102_180D_SOURCE_SELECTOR_TRADING_BOUNDARY_CHANGED");
  return {
    schema:"disdex-bt-q102-180d-native-closed-model-replay-v1",
    source:"ARTIFICIAL_OR_EXPLICIT_H1_RESEARCH_ONLY",
    barCount:bars.length,trainingDays:180,rulesTested:frozenRules.length,
    gridMatches:matched,excludedOverlapping:overlapping,
    rightCensored,closedModelTrades:rows.length,
    closedTradeIds:rows.map(r=>r.id),modelEvents,
    ledger,selection,verifiedStageMembership:false,nativeS1S2Orders:0
  };
}
