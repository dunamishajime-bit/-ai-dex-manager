import fs from "fs/promises";
import path from "path";

import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { runPerpBacktest } from "../lib/research-lab/perp/engine";
import { evaluateLatencyWindow } from "../lib/research-lab/perp/latency-stress";
import type { PerpExecutionAssumptions, PerpStrategyGenome } from "../lib/research-lab/perp/types";

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2023, 6, 1);
const DEV_END = Date.UTC(2024, 6, 1);
const VAL_END = Date.UTC(2025, 6, 1);
const END = Date.UTC(2026, 6, 1);
const WARMUP_START = START - 180 * 24 * HOUR;
const TARGET_MONTHLY = 6;

const UNIVERSE = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR"];
const NORMAL: PerpExecutionAssumptions = { feeBpsPerSide: 5, slippageBpsPerSide: 0, adverseFundingBpsPer8h: 0, maintenanceMarginRate: 0.005 };
const STRESS = { delayHours: 1, feeBpsPerSide: 10, slippageBpsPerSide: 5 };

const V26: PerpStrategyGenome["parameters"] = {
  timeframeHours: 2,
  leverage: 1,
  riskPerTradePct: 3.19,
  maxMarginUsagePct: 100,
  btcRegimeSmaBars: 53,
  btcRegimeMomentumBars: 52,
  regimeThresholdPct: 0.0377,
  momentumBars: 45,
  breakoutBars: 18,
  breakoutBufferPct: 0.0233,
  minimumMomentumPct: 0.0227,
  minimumVolumeRatio: 0.9845,
  minimumEdgeToCostRatio: 6.0879,
  volatilityLookbackBars: 15,
  volatilityPenalty: 2.3953,
  atrBars: 31,
  stopAtr: 2.477,
  takeProfitAtr: 3.1995,
  trailingAtr: 0.4,
  maxHoldBars: 23,
  rebalanceBars: 20,
  cooldownBars: 1,
  allowLong: true,
  allowShort: true,
  allowNeutralRegime: true,
  neutralScoreThreshold: 1.4649,
};

type C = PerpStrategyGenome & { architecture: string; structuralChange: string };
function candidate(id: string, architecture: string, structuralChange: string, overrides: Partial<PerpStrategyGenome["parameters"]>): C {
  return {
    id,
    architecture,
    structuralChange,
    generation: 14,
    parentIds: ["bp11-0015-no-pengu-dev-latency-prune"],
    createdBy: "quant-regime",
    family: "relative_strength",
    thesis: structuralChange,
    symbols: [...UNIVERSE],
    parameters: { ...V26, ...overrides, leverage: 1 },
  };
}

// Clean causal set from V2 diagnosis: realized edge is too thin for 30bps.
// No continuous grid. Each candidate changes one lifecycle concept or combines proven concepts.
const CANDIDATES: C[] = [
  candidate("v26-v3-baseline", "Frozen V26 baseline", "Control only; exact V26 14-coin 2h relative-strength structure.", {}),
  candidate("v26-v3-trailing-release", "Trailing Release", "Remove the ultra-tight 0.4 ATR profit giveback trigger; allow winners to develop before exit.", {
    trailingAtr: 1.2,
  }),
  candidate("v26-v3-wide-lifecycle", "Wide Lifecycle", "Increase realized move per trade with wider trailing/stop/target and a longer maximum holding lifecycle.", {
    trailingAtr: 1.2,
    stopAtr: 3.0,
    takeProfitAtr: 5.0,
    maxHoldBars: 36,
  }),
  candidate("v26-v3-conviction-lifecycle", "Conviction Lifecycle", "Require momentum at least 10x the 30bps round-trip stress and combine it with the wider lifecycle.", {
    minimumMomentumPct: 0.03,
    minimumEdgeToCostRatio: 30,
    trailingAtr: 1.2,
    stopAtr: 3.0,
    takeProfitAtr: 5.0,
    maxHoldBars: 36,
  }),
  candidate("v26-v3-ownership-state", "Ownership State", "Treat relative-strength leadership as a state: stronger conviction, slower handoff, and broad exits rather than exact-bar profit capture.", {
    minimumMomentumPct: 0.03,
    minimumEdgeToCostRatio: 30,
    trailingAtr: 1.6,
    stopAtr: 3.2,
    takeProfitAtr: 6.0,
    maxHoldBars: 48,
    rebalanceBars: 24,
  }),
  candidate("v26-v3-4h-ownership", "4H Ownership State", "Move the same ownership concept to a slower 4h state so a one-hour fill is a smaller fraction of the signal horizon.", {
    timeframeHours: 4,
    btcRegimeSmaBars: 27,
    btcRegimeMomentumBars: 26,
    momentumBars: 23,
    volatilityLookbackBars: 8,
    atrBars: 16,
    minimumMomentumPct: 0.03,
    minimumEdgeToCostRatio: 30,
    trailingAtr: 1.6,
    stopAtr: 3.2,
    takeProfitAtr: 6.0,
    maxHoldBars: 24,
    rebalanceBars: 12,
  }),
];

function evalWindow(genome: C, data: Awaited<ReturnType<typeof loadPerpMarketData>>, label: string, startTs: number, endTs: number) {
  return evaluateLatencyWindow({ genome, data, label, startTs, endTs, execution: NORMAL, stress: STRESS, targetMonthlyReturnPct: TARGET_MONTHLY });
}

function exitProfile(genome: C, data: Awaited<ReturnType<typeof loadPerpMarketData>>) {
  const r = runPerpBacktest({ genome, data, window: { label: "development-exit-profile", startTs: START, endTs: DEV_END }, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
  const reasons: Record<string, number> = {};
  const holds: number[] = [];
  for (const t of r.trades) {
    reasons[t.exitReason] = (reasons[t.exitReason] ?? 0) + 1;
    holds.push(t.holdingBars);
  }
  holds.sort((a, b) => a - b);
  const avg = holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : 0;
  const median = holds.length ? holds[Math.floor(holds.length / 2)] ?? 0 : 0;
  const oneBarOrLess = holds.filter((x) => x <= 1).length;
  return { reasons, averageHoldingBars: avg, medianHoldingBars: median, oneBarOrLessPct: holds.length ? oneBarOrLess / holds.length * 100 : 0 };
}

async function main() {
  if (UNIVERSE.length !== 14 || UNIVERSE.includes("PENGU")) throw new Error("UNIVERSE_BOUNDARY_FAIL");
  if (CANDIDATES.some((x) => x.parameters.leverage !== 1 || x.symbols.length !== 14 || x.symbols.includes("PENGU"))) throw new Error("CANDIDATE_BOUNDARY_FAIL");

  const data = await loadPerpMarketData({ symbols: UNIVERSE, startTs: WARMUP_START, endTs: END + 2 * HOUR });
  const development: any[] = [];

  for (const genome of CANDIDATES) {
    const x = evalWindow(genome, data, "development", START, DEV_END);
    const stressModes = [x.stressedNoDelay, x.entryDelay, x.exitDelay, x.bothDelay];
    const robustGate = x.normal.cagrPct > 0 && x.normal.profitFactor > 1 && x.normal.tradeCount >= 30
      && stressModes.every((s) => s.returnPct > 0 && s.profitFactor > 1)
      && x.bothDelay.profitFactorWithoutBest >= 0.95;
    const targetGate = robustGate && x.normal.cagrPct >= 80 && x.bothDelay.cagrPct >= 20;
    development.push({
      id: genome.id,
      architecture: genome.architecture,
      structuralChange: genome.structuralChange,
      parameters: genome.parameters,
      ...x,
      exitProfile: exitProfile(genome, data),
      robustGate,
      targetGate,
      robustnessFloor: Math.min(...stressModes.map((s) => s.profitFactor)),
      returnFloor: Math.min(...stressModes.map((s) => s.returnPct)),
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
  const validation = genome ? evalWindow(genome, data, "validation", DEV_END, VAL_END) : null;
  const evaluation = genome ? evalWindow(genome, data, "evaluation", VAL_END, END) : null;
  const combined3Y = genome ? evalWindow(genome, data, "combined3y", START, END) : null;

  const diagnosis = selected ? "DEVELOPMENT_ROBUST_SURVIVOR_FOUND" : (() => {
    const best = development[0];
    if (!best) return "NO_CANDIDATES";
    if (best.stressedNoDelay.returnPct <= 0 || best.stressedNoDelay.profitFactor <= 1) return "REALIZED_EDGE_STILL_BELOW_COST";
    if (best.entryDelay.returnPct <= 0 && best.exitDelay.returnPct > 0) return "ENTRY_TIMING_DOMINATES";
    if (best.exitDelay.returnPct <= 0 && best.entryDelay.returnPct > 0) return "EXIT_TIMING_DOMINATES";
    if (best.entryDelay.returnPct <= 0 && best.exitDelay.returnPct <= 0) return "ENTRY_AND_EXIT_TIMING_BOTH_FAIL";
    if (best.bothDelay.returnPct <= 0 || best.bothDelay.profitFactor <= 1) return "JOINT_DELAY_INTERACTION_FAIL";
    return "PF_WITHOUT_BEST_OR_NORMAL_GATE_FAIL";
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
    researchLine: "V26_LATENCY_AWARE_V3_COST_EDGE_RECOVERY",
    researchOnly: true,
    productionChanged: false,
    vpsChanged: false,
    liveChanged: false,
    realTradingEnabled: false,
    liveEligible: false,
    penguExcluded: true,
    leverage: 1,
    universe: UNIVERSE,
    priorDiagnosis: "COST_ROBUSTNESS_FAIL",
    designRule: "Recover realized edge per trade before optimizing delay timing. Frozen causal architectures only; no continuous parameter grid.",
    development,
    selectedDevelopmentCandidate: selected?.id ?? null,
    diagnosis,
    validation,
    evaluation,
    combined3Y,
    acceptance,
  };

  const stateDir = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "v26-latency-aware-v3.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ researchLine: out.researchLine, selectedDevelopmentCandidate: out.selectedDevelopmentCandidate, diagnosis: out.diagnosis, development: out.development.map((x) => ({ id: x.id, normal: x.normal, stressedNoDelay: x.stressedNoDelay, entryDelay: x.entryDelay, exitDelay: x.exitDelay, bothDelay: x.bothDelay, exitProfile: x.exitProfile, robustGate: x.robustGate, targetGate: x.targetGate })), validation: out.validation, evaluation: out.evaluation, acceptance: out.acceptance }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
