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
const WARMUP_START = START - 240 * 24 * HOUR;
const TARGET_MONTHLY = 6;
const UNIVERSE = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR"];
const NORMAL: PerpExecutionAssumptions = { feeBpsPerSide: 5, slippageBpsPerSide: 0, adverseFundingBpsPer8h: 0, maintenanceMarginRate: 0.005 };
const STRESS = { delayHours: 1, feeBpsPerSide: 10, slippageBpsPerSide: 5 };

type P = PerpStrategyGenome["parameters"];
type Candidate = PerpStrategyGenome & { architecture: string; design: string };

const V26: P = {
  timeframeHours: 2, leverage: 1, riskPerTradePct: 3.19, maxMarginUsagePct: 100,
  btcRegimeSmaBars: 53, btcRegimeMomentumBars: 52, regimeThresholdPct: 0.0377,
  momentumBars: 45, breakoutBars: 18, breakoutBufferPct: 0.0233,
  minimumMomentumPct: 0.0227, minimumVolumeRatio: 0.9845, minimumEdgeToCostRatio: 6.0879,
  volatilityLookbackBars: 15, volatilityPenalty: 2.3953, atrBars: 31,
  stopAtr: 3.2, takeProfitAtr: 8, trailingAtr: 3,
  maxHoldBars: 12, rebalanceBars: 6, cooldownBars: 1,
  allowLong: true, allowShort: true, allowNeutralRegime: true, neutralScoreThreshold: 1.4649,
};

function c(id: string, architecture: string, design: string, family: PerpStrategyGenome["family"], parameters: P): Candidate {
  return {
    id, architecture, design, generation: 16, parentIds: ["v26-v4-profit-guard"], createdBy: "quant-regime",
    family, thesis: design, symbols: [...UNIVERSE], parameters: { ...parameters, leverage: 1 },
  };
}

// Clean structural alternatives only. No continuous/grid search.
// V4 showed exact-bar exit fragility can be removed, but then entry delay becomes the weakest stress.
// V5 therefore lengthens the signal state while retaining V4's loose profit guard lifecycle.
const CANDIDATES: Candidate[] = [
  c("v26-v5-control", "V4 Profit Guard Control", "V4 best exit architecture with original 2H entry state.", "relative_strength", { ...V26 }),
  c("v26-v5-4h-trend-persistence", "4H Trend Persistence", "Represent the same ~4-day momentum/regime state on 4H bars, disable neutral entries, and require the directional BTC regime to persist beyond a single 2H event.", "relative_strength", {
    ...V26, timeframeHours: 4, btcRegimeSmaBars: 27, btcRegimeMomentumBars: 26, momentumBars: 23,
    volatilityLookbackBars: 8, atrBars: 16, breakoutBars: 9, minimumVolumeRatio: 0.82,
    allowNeutralRegime: false, neutralScoreThreshold: 1.5, rebalanceBars: 3, maxHoldBars: 6,
  }),
  c("v26-v5-4h-relative-handoff", "4H Relative Handoff", "Use slower 4H cross-sectional ownership while allowing only strong neutral-regime leaders; reduce dependence on a single 2H volume print.", "relative_strength", {
    ...V26, timeframeHours: 4, btcRegimeSmaBars: 27, btcRegimeMomentumBars: 26, momentumBars: 24,
    volatilityLookbackBars: 8, atrBars: 16, breakoutBars: 9, minimumVolumeRatio: 0.75,
    neutralScoreThreshold: 1.9, rebalanceBars: 3, maxHoldBars: 6,
  }),
  c("v26-v5-6h-trend-persistence", "6H Trend Persistence", "Promote entry from an event to a 6H market state; preserve the original momentum horizon in clock time and remove neutral-regime entries.", "relative_strength", {
    ...V26, timeframeHours: 6, btcRegimeSmaBars: 18, btcRegimeMomentumBars: 18, momentumBars: 15,
    volatilityLookbackBars: 5, atrBars: 11, breakoutBars: 6, minimumVolumeRatio: 0.70,
    allowNeutralRegime: false, neutralScoreThreshold: 1.5, rebalanceBars: 2, maxHoldBars: 4,
  }),
  c("v26-v5-4h-compression-expansion", "4H Compression Expansion", "Require a true 4H breakout so expansion is large enough to survive a one-hour fill shift; keep lifecycle exits loose.", "breakout", {
    ...V26, timeframeHours: 4, btcRegimeSmaBars: 27, btcRegimeMomentumBars: 26, momentumBars: 24,
    volatilityLookbackBars: 8, atrBars: 16, breakoutBars: 8, breakoutBufferPct: 0.008,
    minimumMomentumPct: 0.025, minimumVolumeRatio: 0.9, allowNeutralRegime: false,
    rebalanceBars: 3, maxHoldBars: 6,
  }),
  c("v26-v5-4h-dual-expansion", "4H Dual-Direction Expansion", "Use directional 4H breakout confirmation in both long and short regimes so the signal is a sustained expansion state rather than an exact ranked event.", "dual_direction", {
    ...V26, timeframeHours: 4, btcRegimeSmaBars: 27, btcRegimeMomentumBars: 26, momentumBars: 24,
    volatilityLookbackBars: 8, atrBars: 16, breakoutBars: 8, breakoutBufferPct: 0.006,
    minimumMomentumPct: 0.022, minimumVolumeRatio: 0.8, allowNeutralRegime: false,
    rebalanceBars: 3, maxHoldBars: 6,
  }),
];

function evaluate(genome: Candidate, data: Awaited<ReturnType<typeof loadPerpMarketData>>, label: string, startTs: number, endTs: number) {
  return evaluateLatencyWindow({ genome, data, label, startTs, endTs, execution: NORMAL, stress: STRESS, targetMonthlyReturnPct: TARGET_MONTHLY });
}

async function main() {
  if (UNIVERSE.length !== 14 || UNIVERSE.includes("PENGU")) throw new Error("UNIVERSE_BOUNDARY_FAIL");
  if (CANDIDATES.some((x) => x.parameters.leverage !== 1 || x.symbols.length !== 14 || x.symbols.includes("PENGU"))) throw new Error("CANDIDATE_BOUNDARY_FAIL");
  const data = await loadPerpMarketData({ symbols: UNIVERSE, startTs: WARMUP_START, endTs: END + 2 * HOUR });
  const development: any[] = [];

  for (const genome of CANDIDATES) {
    const x = evaluate(genome, data, "development", START, DEV_END);
    const stresses = [x.stressedNoDelay, x.entryDelay, x.exitDelay, x.bothDelay];
    const robustGate = x.normal.cagrPct > 0 && x.normal.profitFactor > 1 && x.normal.tradeCount >= 30
      && stresses.every((s) => s.returnPct > 0 && s.profitFactor > 1)
      && x.bothDelay.profitFactorWithoutBest >= 0.95;
    const targetGate = robustGate && x.normal.cagrPct >= 80 && x.bothDelay.cagrPct >= 20;
    development.push({
      id: genome.id, architecture: genome.architecture, design: genome.design, family: genome.family,
      parameters: genome.parameters, ...x, robustGate, targetGate,
      robustnessFloor: Math.min(...stresses.map((s) => s.profitFactor)),
      returnFloor: Math.min(...stresses.map((s) => s.returnPct)),
    });
  }

  development.sort((a, b) => {
    if (a.targetGate !== b.targetGate) return Number(b.targetGate) - Number(a.targetGate);
    if (a.robustGate !== b.robustGate) return Number(b.robustGate) - Number(a.robustGate);
    if (a.robustnessFloor !== b.robustnessFloor) return b.robustnessFloor - a.robustnessFloor;
    if (a.returnFloor !== b.returnFloor) return b.returnFloor - a.returnFloor;
    return b.normal.cagrPct - a.normal.cagrPct;
  });

  const selected = development.find((x) => x.robustGate) ?? null;
  const genome = selected ? CANDIDATES.find((x) => x.id === selected.id) ?? null : null;
  const validation = genome ? evaluate(genome, data, "validation", DEV_END, VAL_END) : null;
  const evaluation = genome ? evaluate(genome, data, "evaluation", VAL_END, END) : null;
  const combined3Y = genome ? evaluate(genome, data, "combined3y", START, END) : null;

  const diagnosis = selected ? "PERSISTENT_ENTRY_SURVIVOR_FOUND" : (() => {
    const control = development.find((x) => x.id === "v26-v5-control");
    const best = development[0];
    if (best?.normal.returnPct <= 0) return "SLOW_STATE_DESTROYS_BASE_EDGE";
    if (best?.entryDelay.returnPct <= 0) return "ENTRY_EDGE_STILL_TOO_EVENT_SENSITIVE";
    if (best?.exitDelay.returnPct <= 0) return "ENTRY_REBUILD_REINTRODUCES_EXIT_FRAGILITY";
    if (best?.bothDelay.returnPct <= 0) return "JOINT_DELAY_INTERACTION_FAIL";
    if (control?.entryDelay.returnPct <= 0 && best?.entryDelay.returnPct > 0) return "ENTRY_DELAY_FIXED_BUT_PF_GATE_FAIL";
    return "PF_OR_SAMPLE_GATE_FAIL";
  })();

  const acceptance = combined3Y ? {
    normal3YCagrAtLeast100: combined3Y.normal.cagrPct >= 100,
    normalPfAtLeast1p20: combined3Y.normal.profitFactor >= 1.2,
    allStressPositive: [combined3Y.stressedNoDelay, combined3Y.entryDelay, combined3Y.exitDelay, combined3Y.bothDelay].every((s) => s.returnPct > 0 && s.profitFactor > 1),
    bothDelayCagrAtLeast20: combined3Y.bothDelay.cagrPct >= 20,
    bothDelayPfWithoutBestAtLeast095: combined3Y.bothDelay.profitFactorWithoutBest >= 0.95,
    bothDelayDdAtMost50: combined3Y.bothDelay.maxDrawdownPct <= 50,
    maxLeverageAtMost1: combined3Y.normal.maximumEffectiveLeverage <= 1.000001,
    zeroLiquidations: combined3Y.normal.liquidationCount === 0,
  } : null;

  const out = {
    researchLine: "V26_LATENCY_AWARE_V5_PERSISTENT_ENTRY_REBUILD",
    researchOnly: true, productionChanged: false, vpsChanged: false, liveChanged: false, realTradingEnabled: false, liveEligible: false,
    penguExcluded: true, leverage: 1, universe: UNIVERSE,
    diagnosisInput: { v4ControlEntryDelay: "positive", v4ControlExitDelay: "severely negative", v4ProfitGuardExitDelay: "positive", v4ProfitGuardEntryDelay: "negative" },
    designRule: "Keep 14 symbols and 1x. Rebuild entry as slower persistent state; retain loose lifecycle exit. No parameter grid.",
    development, selectedDevelopmentCandidate: selected?.id ?? null, diagnosis, validation, evaluation, combined3Y, acceptance,
  };

  const stateDir = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "v26-latency-aware-v5.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ researchLine: out.researchLine, selectedDevelopmentCandidate: out.selectedDevelopmentCandidate, diagnosis: out.diagnosis, development: out.development.map((x) => ({ id: x.id, architecture: x.architecture, normal: x.normal, stressedNoDelay: x.stressedNoDelay, entryDelay: x.entryDelay, exitDelay: x.exitDelay, bothDelay: x.bothDelay, robustGate: x.robustGate, targetGate: x.targetGate })), validation: out.validation, evaluation: out.evaluation, combined3Y: out.combined3Y, acceptance: out.acceptance }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
