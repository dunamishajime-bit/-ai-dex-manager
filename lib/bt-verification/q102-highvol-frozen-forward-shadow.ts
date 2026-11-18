/**
 * Time-frozen Q102 HIGH_VOL forward observation for a SYNTHETIC 180d
 * training month. Calls the pinned native signal generator with a TEST-ONLY
 * stage label because original upstream S1/S2 stage membership is missing.
 * All outputs are research shadows: never portfolio admissions or orders.
 */
import {
  QUALITY102_HOUR_MS,QUALITY102_HIGH_VOL_MAX_HOLD_HOURS,
  QUALITY102_RESEARCH_COSTS,quality102HighVolRuleKey,
  generateQuality102HighVolSignals,simulateQuality102HighVolExit,
  quality102NetFromGross,
  type Quality102HighVolRule,type Quality102Candle
} from "./pinned-native-q102/disdex-quality102-causal-pipeline";
import type {Q102HvCausalReplay} from "./q102-highvol-180d-native-replay";

const H=QUALITY102_HOUR_MS;
export type Q102HvForwardTradeShadow={
  id:string;symbol:string;side:1|-1;
  signalBarStartMs:number;signalAvailableMs:number;
  entryAtMs:number;entryModelPrice:number;
  exitBarStartMs:number;exitAvailableMs:number;
  exitModelPrice:number;exitReason:string;holdHours:number;
  grossReturn:number;normalNet:number;stressNet:number;
};
export type Q102HvForwardReturnStats={
  count:number;wins:number;winRate:number|null;
  profitFactor:number|null;modelCompoundedFactor:number;
  modelRealizedMaxDd:number;
};
export type Q102HvForwardShadow={
  schema:"bt481-q102-month-frozen-forward-research-v1";
  source:"SYNTHETIC_NATIVE_GENERATOR_WITH_TEST_ONLY_S1_LABEL";
  monthStartMs:number;endExclusiveMs:number;symbol:string;
  outcome:"NO_ELIGIBLE_TRAINING_MONTHLY_RULE"|"FORWARD_RESEARCH_ONLY";
  frozenRuleKey:string|null;
  testOnlyNativeRawCandidates:number;
  oneSymbolOneSlotBlocked:number;
  rightCensoredAtForwardEnd:number;
  closedResearchModels:number;
  modelEvents:readonly Q102HvForwardTradeShadow[];
  normal:Q102HvForwardReturnStats;
  stress:Q102HvForwardReturnStats;
  authenticUpstreamStageMembershipVerified:false;
  portfolioAdmissions:0;nativeExecutableS1S2Entries:0;venueFills:0;
};
const emptyStats:Q102HvForwardReturnStats={
 count:0,wins:0,winRate:null,profitFactor:null,
 modelCompoundedFactor:1,modelRealizedMaxDd:0
};
function computeStats(events:readonly Q102HvForwardTradeShadow[],
 key:"normalNet"|"stressNet"):Q102HvForwardReturnStats{
 if(!events.length)return {...emptyStats};
 let e=1,peak=1,dd=0,positive=0,negative=0,wins=0;
 for(const item of [...events].sort((a,b)=>a.exitAvailableMs-b.exitAvailableMs||
    a.id.localeCompare(b.id))){
   const net=item[key];
   if(!Number.isFinite(net)||net<=-1)throw Error("Q102_FORWARD_INVALID_NET");
   if(net>0){wins++;positive+=net;}
   else{negative-=net;}
   e*=1+net;peak=Math.max(peak,e);dd=Math.min(dd,e/peak-1);
 }
 return {
  count:events.length,wins,winRate:wins/events.length,
  profitFactor:negative===0?null:positive/negative,
  modelCompoundedFactor:e,modelRealizedMaxDd:dd
 };
}
export function inspectQ102HvSyntheticFrozenForward(input:{
  symbol:string;
  monthStartMs:number;
  endExclusiveMs:number;
  bars:readonly Quality102Candle[];
  training:Q102HvCausalReplay;
  frozenRules:readonly Quality102HighVolRule[];
}):Q102HvForwardShadow{
 const {symbol,monthStartMs,endExclusiveMs,bars,training,frozenRules}=input;
 const monthDate=new Date(monthStartMs);
 if(!symbol||monthStartMs<=0||monthStartMs%H!==0||
    monthDate.getUTCDate()!==1||monthDate.getUTCHours()!==0||
    monthDate.getUTCMinutes()!==0||endExclusiveMs<=monthStartMs||
    endExclusiveMs%H!==0)
   throw Error("Q102_FORWARD_INVALID_MONTH_OR_PERIOD");
 if(training.selection.monthStartMs!==monthStartMs ||
    training.selection.windowEndMs!==monthStartMs-H||
    training.selection.liveEntryEnabled||training.selection.fills!==0||
    training.verifiedStageMembership||training.nativeS1S2Orders!==0)
   throw Error("Q102_FORWARD_UNVERIFIED_TRAINING_PROVENANCE");
 if(training.modelEvents.some(x=>x.exitAvailableAtMs>monthStartMs-H))
   throw Error("Q102_FORWARD_TRAINING_FUTURE_EXIT");
 const first=monthStartMs-336*H;
 if(bars.length!==(endExclusiveMs-first)/H)
   throw Error("Q102_FORWARD_336H_AND_MONTH_WINDOW_REQUIRED");
 for(let i=0;i<bars.length;i++){
  const x=bars[i];
  if(x.timestampMs!==first+i*H||
     ![x.open,x.high,x.low,x.close,x.quoteVolume].every(Number.isFinite)||
     x.open<=0||x.close<=0||x.low<=0||x.quoteVolume<0||
     x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close))
    throw Error("Q102_FORWARD_NONCAUSAL_OR_MISSING_CLOSED_H1");
 }
 const selectedKey=training.selection.selectedRuleKey;
 const base={
  schema:"bt481-q102-month-frozen-forward-research-v1" as const,
  source:"SYNTHETIC_NATIVE_GENERATOR_WITH_TEST_ONLY_S1_LABEL" as const,
  monthStartMs,endExclusiveMs,symbol,
  frozenRuleKey:selectedKey,
  authenticUpstreamStageMembershipVerified:false as const,
  portfolioAdmissions:0 as const,nativeExecutableS1S2Entries:0 as const,
  venueFills:0 as const
 };
 if(training.selection.sourceOutcome!=="SELECTED_RESEARCH_ONLY"||
   !selectedKey)
  return {...base,outcome:"NO_ELIGIBLE_TRAINING_MONTHLY_RULE",
   testOnlyNativeRawCandidates:0,oneSymbolOneSlotBlocked:0,
   rightCensoredAtForwardEnd:0,closedResearchModels:0,
   modelEvents:[],normal:{...emptyStats},stress:{...emptyStats}};
 const found=frozenRules.filter(x=>quality102HighVolRuleKey(x)===selectedKey);
 if(found.length!==1)throw Error("Q102_FORWARD_FROZEN_TRAINING_RULE_NOT_PRESENT");
 const rule=found[0];
 // The "S1" label is REQUIRED BY THE ORIGINAL PURE SOURCE API but is
 // demonstrably a TEST placeholder. No authentic stage IDs are asserted.
 const candidates=generateQuality102HighVolSignals({
  symbol,stage:"S1",bars,
  monthlyRules:new Map([[monthStartMs,rule]])
 });
 const events:Q102HvForwardTradeShadow[]=[];
 let blocked=0,censored=0,busyUntil=-Infinity;
 for(const candidate of candidates){
  if(candidate.entryTs>=endExclusiveMs ||
    candidate.signalTs<monthStartMs)
    throw Error("Q102_FORWARD_SOURCE_GENERATOR_OUTSIDE_MONTH");
  if(candidate.entryTs<busyUntil){blocked++;continue;}
  const i=(candidate.entryTs-first)/H;
  if(!Number.isSafeInteger(i)||i<0||i>=bars.length)
    throw Error("Q102_FORWARD_INVALID_NATIVE_ENTRY");
  const tail=bars.slice(i,i+QUALITY102_HIGH_VOL_MAX_HOLD_HOURS);
  let exit:ReturnType<typeof simulateQuality102HighVolExit>;
  try{
   exit=simulateQuality102HighVolExit({
    side:candidate.side,entryPrice:candidate.entryPrice,
    hardStop:rule.hardStop,bars:tail
   });
  }catch(e){
   if(e instanceof Error&&e.message==="QUALITY102_HV_EXIT_BARS_INSUFFICIENT_FOR_72H"){
    censored++;busyUntil=Infinity;continue;
   }
   throw e;
  }
  const closeAt=exit.exitTs+H;
  if(closeAt>=endExclusiveMs){
   censored++;busyUntil=Infinity;continue;
  }
  events.push({
    id:candidate.id,symbol,side:candidate.side,
    signalBarStartMs:candidate.signalTs,
    signalAvailableMs:candidate.signalTs+H,
    entryAtMs:candidate.entryTs,
    entryModelPrice:candidate.entryPrice,
    exitBarStartMs:exit.exitTs,exitAvailableMs:closeAt,
    exitModelPrice:exit.exitPrice,
    exitReason:exit.exitReason,holdHours:exit.holdHours,
    grossReturn:exit.grossReturn,
    normalNet:quality102NetFromGross(
     exit.grossReturn,exit.holdHours,QUALITY102_RESEARCH_COSTS.normal.perSide,
     QUALITY102_RESEARCH_COSTS.normal.fundingPerDay
    ),
    stressNet:quality102NetFromGross(
     exit.grossReturn,exit.holdHours,QUALITY102_RESEARCH_COSTS.stress.perSide,
     QUALITY102_RESEARCH_COSTS.stress.fundingPerDay
    )
  });
  busyUntil=closeAt;
 }
 return {...base,outcome:"FORWARD_RESEARCH_ONLY",
  testOnlyNativeRawCandidates:candidates.length,
  oneSymbolOneSlotBlocked:blocked,
  rightCensoredAtForwardEnd:censored,
  closedResearchModels:events.length,
  modelEvents:events,
  normal:computeStats(events,"normalNet"),
  stress:computeStats(events,"stressNet")
 };
}
