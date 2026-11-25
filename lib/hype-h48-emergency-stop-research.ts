/**
 * OFFLINE H48 emergency -8% stop research overlay, NOT the certified
 * H48_TIME_ONLY LIVE policy and NOT a venue order implementation.
 *
 * This deliberately changes the original research exit semantics. A
 * separately approved H48+STOP8 plan, venue resident/emergency protection,
 * actual fill and gap/slippage verification are mandatory before LIVE.
 */
export const H48_EMERGENCY_RESEARCH_STOP8_PCT=8 as const;
const H=3_600_000;
const error=(why:string):never=>{throw Error("H48_STOP_RESEARCH_INVALID:"+why)};
export type H48ResearchHour=Readonly<{
  openTs:number;open:number;low:number;
}>;
export type H48ResearchStopScenario=Readonly<{
  exitReason:"H48_TIME48_NEXTOPEN"|"H48_RESEARCH_STOP_THRESHOLD"|"H48_RESEARCH_STOP_GAP_OPEN";
  exitTs:number;
  exitPrice:number;
  netReturn:number;
  feeBps:number;
  stopTriggered:boolean;
}>;
export function evaluateH48ResearchEmergencyStop(input:{
  logicalEntryTs:number;entryOpen:number;logicalExitTs:number;
  exitOpen:number;
  hours:readonly H48ResearchHour[];
  stopPct:5|8|0;
  feeBps:10|30;
}):H48ResearchStopScenario{
  const e=input.logicalEntryTs;
  if(!Number.isSafeInteger(e)||e<=0||e%(6*H)!==0
    ||!Number.isSafeInteger(input.logicalExitTs)
    ||input.logicalExitTs!==e+48*H
    ||!Number.isFinite(input.entryOpen)||input.entryOpen<=0
    ||!Number.isFinite(input.exitOpen)||input.exitOpen<=0
    ||![0,5,8].includes(input.stopPct)
    ||![10,30].includes(input.feeBps)
    ||!Array.isArray(input.hours)||input.hours.length!==48)
    error("CONTRACT_OR_HOURS");
  // A 48h historical replay must have all 48 H1 opening/lowest prices,
  // not a sparse list that silently understates stop frequency.
  for(let i=0;i<input.hours.length;i++){
    const b=input.hours[i];
    if(!b||b.openTs!==e+i*H||!Number.isFinite(b.open)
      ||!Number.isFinite(b.low)||b.open<=0||b.low<=0||b.low>b.open)
      error("HOURLY_BAR_UNTRUSTED");
  }
  if(Math.abs(input.hours[0].open-input.entryOpen)>1e-8)
    error("ENTRY_OPEN_MISMATCH");
  let exitPrice=input.exitOpen;
  let exitReason:H48ResearchStopScenario["exitReason"]="H48_TIME48_NEXTOPEN";
  let exitTs=input.logicalExitTs;
  if(input.stopPct){
    const trigger=input.entryOpen*(1-input.stopPct/100);
    for(const bar of input.hours){
      if(bar.open<=trigger){
        // Conservative H1 gap convention: do not pretend that a stop order
        // can fill at the higher threshold after a gap below its trigger.
        exitPrice=bar.open;exitTs=bar.openTs;
        exitReason="H48_RESEARCH_STOP_GAP_OPEN";break;
      }
      if(bar.low<=trigger){
        // Threshold fill has NO spread/slippage from the intra-hour low;
        // still an optimistic offline approximation, not a LIVE backtest.
        exitPrice=trigger;exitTs=bar.openTs;
        exitReason="H48_RESEARCH_STOP_THRESHOLD";break;
      }
    }
  }
  const gross=exitPrice/input.entryOpen-1;
  return Object.freeze({
    exitReason,exitTs,exitPrice,
    netReturn:gross-input.feeBps/10000,feeBps:input.feeBps,
    stopTriggered:exitReason!=="H48_TIME48_NEXTOPEN",
  });
}
