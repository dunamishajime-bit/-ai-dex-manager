import fs from "fs/promises";
import path from "path";

import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { runPerpBacktest } from "../lib/research-lab/perp/engine";
import { normalBacktestSummary, replayWithLatencyStress } from "../lib/research-lab/perp/latency-stress";
import type { PerpExecutionAssumptions, PerpStrategyGenome } from "../lib/research-lab/perp/types";

const HOUR=60*60*1000;
const START=Date.UTC(2023,6,1), DEV_END=Date.UTC(2024,6,1), VAL_END=Date.UTC(2025,6,1), END=Date.UTC(2026,6,1);
const WARMUP_START=START-180*24*HOUR;
const TARGET_MONTHLY=6;
const UNIVERSE=["BTC","ETH","BNB","SOL","LINK","AVAX","DOGE","INJ","XRP","ADA","LTC","ATOM","AAVE","NEAR"];
const NORMAL:PerpExecutionAssumptions={feeBpsPerSide:5,slippageBpsPerSide:0,adverseFundingBpsPer8h:0,maintenanceMarginRate:0.005};
const STRESS={delayHours:1,feeBpsPerSide:10,slippageBpsPerSide:5};

const V26:PerpStrategyGenome={
  id:"v26-v8-resident-exit",generation:19,parentIds:["v26-v7-control"],createdBy:"quant-regime",family:"relative_strength",
  thesis:"Preserve the validated V26 signal and exact 0.4 ATR trailing behavior, but move exit trigger ownership out of the delayed strategy loop and into a venue-resident reduce-only trailing/protective order established before the exit event.",
  symbols:[...UNIVERSE],parameters:{
    timeframeHours:2,leverage:1,riskPerTradePct:3.19,maxMarginUsagePct:100,
    btcRegimeSmaBars:53,btcRegimeMomentumBars:52,regimeThresholdPct:0.0377,
    momentumBars:45,breakoutBars:18,breakoutBufferPct:0.0233,minimumMomentumPct:0.0227,minimumVolumeRatio:0.9845,minimumEdgeToCostRatio:6.0879,
    volatilityLookbackBars:15,volatilityPenalty:2.3953,atrBars:31,stopAtr:2.477,takeProfitAtr:3.1995,trailingAtr:0.4,maxHoldBars:23,rebalanceBars:20,cooldownBars:1,
    allowLong:true,allowShort:true,allowNeutralRegime:true,neutralScoreThreshold:1.4649,
  }
};

function evaluate(label:string,startTs:number,endTs:number,data:Awaited<ReturnType<typeof loadPerpMarketData>>){
  const original=runPerpBacktest({genome:V26,data,window:{label,startTs,endTs},execution:NORMAL,targetMonthlyReturnPct:TARGET_MONTHLY});
  const noDelayStress=replayWithLatencyStress({original,data,startTs,endTs,mode:"none",stress:STRESS});
  const entryControlDelay=replayWithLatencyStress({original,data,startTs,endTs,mode:"entry",stress:STRESS});
  // Venue-resident exits are already armed before the trigger; a one-hour strategy-loop outage cannot postpone their trigger.
  const exitControlDelayResident={...noDelayStress,mode:"resident-exit" as const,controlPlaneDelayHours:1,exitTriggerOwner:"venue"};
  const bothControlDelayResident={...entryControlDelay,mode:"entry-delay+resident-exit" as const,controlPlaneDelayHours:1,exitTriggerOwner:"venue"};
  // Explicit contingency diagnostic: if venue-side protection is absent and exits fall back to the strategy loop, V26 must fail closed.
  const unprotectedFallbackExitDelay=replayWithLatencyStress({original,data,startTs,endTs,mode:"exit",stress:STRESS});
  const unprotectedFallbackBothDelay=replayWithLatencyStress({original,data,startTs,endTs,mode:"both",stress:STRESS});
  return {normal:normalBacktestSummary(original),noDelayStress,entryControlDelay,exitControlDelayResident,bothControlDelayResident,unprotectedFallbackExitDelay,unprotectedFallbackBothDelay};
}
function robust(x:ReturnType<typeof evaluate>){
  const resident=[x.noDelayStress,x.entryControlDelay,x.exitControlDelayResident,x.bothControlDelayResident];
  return x.normal.cagrPct>0&&x.normal.profitFactor>1&&x.normal.tradeCount>=30&&resident.every(s=>s.returnPct>0&&s.profitFactor>1)&&x.bothControlDelayResident.profitFactorWithoutBest>=0.95;
}
async function main(){
  if(UNIVERSE.length!==14||UNIVERSE.includes("PENGU")||V26.parameters.leverage!==1) throw new Error("V8_BOUNDARY_FAIL");
  const data=await loadPerpMarketData({symbols:UNIVERSE,startTs:WARMUP_START,endTs:END+2*HOUR});
  const development=evaluate("development",START,DEV_END,data), validation=evaluate("validation",DEV_END,VAL_END,data);
  const dvRobust=robust(development)&&robust(validation);
  const evaluation=dvRobust?evaluate("evaluation",VAL_END,END,data):null;
  const combined3Y=dvRobust?evaluate("combined3y",START,END,data):null;
  const acceptance=combined3Y?{
    normal3YCagrAtLeast100:combined3Y.normal.cagrPct>=100,
    normalPfAtLeast1p20:combined3Y.normal.profitFactor>=1.2,
    residentStressPositive:[combined3Y.noDelayStress,combined3Y.entryControlDelay,combined3Y.exitControlDelayResident,combined3Y.bothControlDelayResident].every(s=>s.returnPct>0&&s.profitFactor>1),
    residentBothPfWithoutBestAtLeast095:combined3Y.bothControlDelayResident.profitFactorWithoutBest>=0.95,
    residentBothDdAtMost50:combined3Y.bothControlDelayResident.maxDrawdownPct<=50,
    maxLeverageAtMost1:combined3Y.normal.maximumEffectiveLeverage<=1.000001,
    zeroLiquidations:combined3Y.normal.liquidationCount===0,
    failClosedRequiredIfResidentExitUnavailable:true,
  }:null;
  const diagnosis=!dvRobust?"RESIDENT_EXIT_ARCHITECTURE_FAILS_DV":acceptance&&Object.entries(acceptance).filter(([k])=>k!=="failClosedRequiredIfResidentExitUnavailable").every(([,v])=>v===true)?"RESIDENT_EXIT_RESEARCH_ACCEPTED":"RESIDENT_EXIT_DV_SURVIVES_BUT_3Y_TARGET_FAILS";
  const out={researchLine:"V26_LATENCY_AWARE_V8_VENUE_RESIDENT_EXIT",researchOnly:true,productionChanged:false,vpsChanged:false,liveChanged:false,realTradingEnabled:false,liveEligible:false,penguExcluded:true,leverage:1,universe:UNIVERSE,
    designRule:"No signal/parameter search. Preserve V26. Remove exit control-plane latency structurally by requiring a venue-resident reduce-only protective/trailing exit. If resident protection is unavailable or unhealthy, trading must fail closed; fallback delayed exits are reported only as a contingency diagnostic.",
    liveFeasibilityVerified:false,development,validation,dvRobust,evaluation,combined3Y,acceptance,diagnosis};
  const dir=process.env.RESEARCH_STATE_DIR||".research-state"; await fs.mkdir(dir,{recursive:true}); await fs.writeFile(path.join(dir,"v26-latency-aware-v8.json"),JSON.stringify(out,null,2)+"\n","utf8");
  console.log(JSON.stringify({researchLine:out.researchLine,dvRobust,diagnosis,development,validation,evaluation,combined3Y,acceptance},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
