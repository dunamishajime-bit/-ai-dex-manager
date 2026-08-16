import fs from "fs/promises";
import path from "path";

import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { evaluateLatencyWindow } from "../lib/research-lab/perp/latency-stress";
import type { PerpExecutionAssumptions, PerpStrategyGenome } from "../lib/research-lab/perp/types";

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2023, 6, 1);
const DEV_END = Date.UTC(2024, 6, 1);
const VAL_END = Date.UTC(2025, 6, 1);
const END = Date.UTC(2026, 6, 1);
const WARMUP_START = START - 180 * 24 * HOUR;
const TARGET_MONTHLY = 6;
const UNIVERSE = ["BTC","ETH","BNB","SOL","LINK","AVAX","DOGE","INJ","XRP","ADA","LTC","ATOM","AAVE","NEAR"];
const NORMAL: PerpExecutionAssumptions = { feeBpsPerSide: 5, slippageBpsPerSide: 0, adverseFundingBpsPer8h: 0, maintenanceMarginRate: 0.005 };
const STRESS = { delayHours: 1, feeBpsPerSide: 10, slippageBpsPerSide: 5 };

type P = PerpStrategyGenome["parameters"];
type Candidate = PerpStrategyGenome & { architecture: string; exitDesign: string };
const BASE: P = {
  timeframeHours:2, leverage:1, riskPerTradePct:3.19, maxMarginUsagePct:100,
  btcRegimeSmaBars:53, btcRegimeMomentumBars:52, regimeThresholdPct:0.0377,
  momentumBars:45, breakoutBars:18, breakoutBufferPct:0.0233,
  minimumMomentumPct:0.0227, minimumVolumeRatio:0.9845, minimumEdgeToCostRatio:6.0879,
  volatilityLookbackBars:15, volatilityPenalty:2.3953, atrBars:31,
  stopAtr:2.477, takeProfitAtr:3.1995, trailingAtr:0.4,
  maxHoldBars:23, rebalanceBars:20, cooldownBars:1,
  allowLong:true, allowShort:true, allowNeutralRegime:true, neutralScoreThreshold:1.4649,
};
function c(id:string, architecture:string, exitDesign:string, overrides:Partial<P>):Candidate {
  return { id, architecture, exitDesign, generation:18, parentIds:["v26-control"], createdBy:"quant-regime", family:"relative_strength", thesis:exitDesign, symbols:[...UNIVERSE], parameters:{...BASE,...overrides,leverage:1} };
}

// Structural exit alternatives only; no continuous threshold grid.
const CANDIDATES: Candidate[] = [
  c("v26-v7-control","Exact Intrabar Trail Control","Original V26 0.4 ATR intrabar trailing control.",{}),
  c("v26-v7-resident-bracket","Resident Fixed Bracket","Disable dynamic trailing; preserve original protective stop and 3.2 ATR target as orders that can reside at venue; retain slow ownership rotation.",{trailingAtr:20}),
  c("v26-v7-bracket-short-lifecycle","Resident Bracket + 24H Lifecycle","Fixed stop/target with a deterministic 24-hour lifecycle instead of exact profit trailing.",{trailingAtr:20,maxHoldBars:12,rebalanceBars:12}),
  c("v26-v7-moderate-trail","Moderate Trail","Replace the exact 0.4 ATR scalp-like trail with a materially wider 1.5 ATR trail while preserving original stop/target and ownership horizon.",{trailingAtr:1.5}),
  c("v26-v7-wide-trail","Wide Trail","Use a 2.5 ATR trail to make profit protection a state rather than a one-bar event, while preserving original target.",{trailingAtr:2.5}),
  c("v26-v7-target-first","Target-First Lifecycle","Use a wide 4 ATR trail so the predeclared 3.2 ATR target or structural rotation dominates exits.",{trailingAtr:4}),
];

function evalWindow(g:Candidate,data:Awaited<ReturnType<typeof loadPerpMarketData>>,label:string,startTs:number,endTs:number){
  return evaluateLatencyWindow({genome:g,data,label,startTs,endTs,execution:NORMAL,stress:STRESS,targetMonthlyReturnPct:TARGET_MONTHLY});
}
function gate(x:ReturnType<typeof evalWindow>){
  const ss=[x.stressedNoDelay,x.entryDelay,x.exitDelay,x.bothDelay];
  return x.normal.cagrPct>0 && x.normal.profitFactor>1 && x.normal.tradeCount>=30 && ss.every(s=>s.returnPct>0&&s.profitFactor>1) && x.bothDelay.profitFactorWithoutBest>=0.95;
}
function floor(x:ReturnType<typeof evalWindow>){ return Math.min(x.stressedNoDelay.profitFactor,x.entryDelay.profitFactor,x.exitDelay.profitFactor,x.bothDelay.profitFactor); }

async function main(){
  if(UNIVERSE.length!==14||UNIVERSE.includes("PENGU")||CANDIDATES.some(x=>x.parameters.leverage!==1)) throw new Error("V7_BOUNDARY_FAIL");
  const data=await loadPerpMarketData({symbols:UNIVERSE,startTs:WARMUP_START,endTs:END+2*HOUR});
  const rows:any[]=[];
  for(const g of CANDIDATES){
    const development=evalWindow(g,data,"development",START,DEV_END);
    const validation=evalWindow(g,data,"validation",DEV_END,VAL_END);
    const developmentGate=gate(development), validationGate=gate(validation);
    rows.push({id:g.id,architecture:g.architecture,exitDesign:g.exitDesign,parameters:g.parameters,development,validation,developmentGate,validationGate,dvRobust:developmentGate&&validationGate,robustnessFloor:Math.min(floor(development),floor(validation)),normalCagrFloor:Math.min(development.normal.cagrPct,validation.normal.cagrPct)});
  }
  rows.sort((a,b)=>Number(b.dvRobust)-Number(a.dvRobust)||b.robustnessFloor-a.robustnessFloor||b.normalCagrFloor-a.normalCagrFloor);
  const selected=rows.find(x=>x.dvRobust)??null;
  const genome=selected?CANDIDATES.find(x=>x.id===selected.id)??null:null;
  const evaluation=genome?evalWindow(genome,data,"evaluation",VAL_END,END):null;
  const combined3Y=genome?evalWindow(genome,data,"combined3y",START,END):null;
  const acceptance=combined3Y?{
    normal3YCagrAtLeast100:combined3Y.normal.cagrPct>=100,
    normalPfAtLeast1p20:combined3Y.normal.profitFactor>=1.2,
    allStressPositive:[combined3Y.stressedNoDelay,combined3Y.entryDelay,combined3Y.exitDelay,combined3Y.bothDelay].every(s=>s.returnPct>0&&s.profitFactor>1),
    bothDelayPfWithoutBestAtLeast095:combined3Y.bothDelay.profitFactorWithoutBest>=0.95,
    bothDelayDdAtMost50:combined3Y.bothDelay.maxDrawdownPct<=50,
    maxLeverageAtMost1:combined3Y.normal.maximumEffectiveLeverage<=1.000001,
    zeroLiquidations:combined3Y.normal.liquidationCount===0,
  }:null;
  const best=rows[0];
  const diagnosis=selected?"DV_DELAY_SAFE_EXIT_SURVIVOR_FOUND":best?.developmentGate&&!best?.validationGate?"EXIT_ARCHITECTURE_DEV_ONLY_NOT_STABLE":"NO_BRACKET_EXIT_SURVIVES_DV";
  const out={researchLine:"V26_LATENCY_AWARE_V7_DV_BRACKET_EXIT_ARCHITECTURES",researchOnly:true,productionChanged:false,vpsChanged:false,liveChanged:false,realTradingEnabled:false,liveEligible:false,penguExcluded:true,leverage:1,universe:UNIVERSE,designRule:"Freeze V26 entry. Test only structurally distinct delay-safe exit architectures on Development and Validation; require both to pass before Evaluation is read.",candidates:rows,selectedDevelopmentValidationCandidate:selected?.id??null,diagnosis,evaluation,combined3Y,acceptance};
  const stateDir=process.env.RESEARCH_STATE_DIR||".research-state"; await fs.mkdir(stateDir,{recursive:true}); await fs.writeFile(path.join(stateDir,"v26-latency-aware-v7.json"),JSON.stringify(out,null,2)+"\n","utf8");
  console.log(JSON.stringify({researchLine:out.researchLine,selected:out.selectedDevelopmentValidationCandidate,diagnosis:out.diagnosis,candidates:rows.map(x=>({id:x.id,architecture:x.architecture,development:x.development,validation:x.validation,developmentGate:x.developmentGate,validationGate:x.validationGate,dvRobust:x.dvRobust,robustnessFloor:x.robustnessFloor,normalCagrFloor:x.normalCagrFloor})),evaluation,combined3Y,acceptance},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
