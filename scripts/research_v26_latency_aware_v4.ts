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
  timeframeHours: 2, leverage: 1, riskPerTradePct: 3.19, maxMarginUsagePct: 100,
  btcRegimeSmaBars: 53, btcRegimeMomentumBars: 52, regimeThresholdPct: 0.0377,
  momentumBars: 45, breakoutBars: 18, breakoutBufferPct: 0.0233,
  minimumMomentumPct: 0.0227, minimumVolumeRatio: 0.9845, minimumEdgeToCostRatio: 6.0879,
  volatilityLookbackBars: 15, volatilityPenalty: 2.3953, atrBars: 31,
  stopAtr: 2.477, takeProfitAtr: 3.1995, trailingAtr: 0.4,
  maxHoldBars: 23, rebalanceBars: 20, cooldownBars: 1,
  allowLong: true, allowShort: true, allowNeutralRegime: true, neutralScoreThreshold: 1.4649,
};

type Candidate = PerpStrategyGenome & { architecture: string; exitDesign: string };
function c(id: string, architecture: string, exitDesign: string, overrides: Partial<PerpStrategyGenome["parameters"]>): Candidate {
  return {
    id, architecture, exitDesign, generation: 15, parentIds: ["v26-v3-baseline"], createdBy: "quant-regime",
    family: "relative_strength", thesis: exitDesign, symbols: [...UNIVERSE], parameters: { ...V26, ...overrides, leverage: 1 },
  };
}

// Entry/regime/relative-strength logic is frozen. Only exit lifecycle changes.
const CANDIDATES: Candidate[] = [
  c("v26-v4-control", "V26 exact exit control", "Control: original 0.4 ATR intrabar trailing exit.", {}),
  c("v26-v4-fixed-12h", "12H Fixed Lifecycle", "Disable profit trailing/TP in practice; use protective stop plus a 12-hour state expiry.", {
    trailingAtr: 20, takeProfitAtr: 20, stopAtr: 3.2, maxHoldBars: 6, rebalanceBars: 6,
  }),
  c("v26-v4-fixed-24h", "24H Fixed Lifecycle", "Disable profit trailing/TP in practice; use protective stop plus a 24-hour state expiry.", {
    trailingAtr: 20, takeProfitAtr: 20, stopAtr: 3.2, maxHoldBars: 12, rebalanceBars: 12,
  }),
  c("v26-v4-rotate-12h", "12H Ownership Rotation", "Hold leadership at least 12 hours; then rotate only when the ranked signal changes, with a 48-hour fail-safe expiry.", {
    trailingAtr: 20, takeProfitAtr: 20, stopAtr: 3.2, rebalanceBars: 6, maxHoldBars: 24,
  }),
  c("v26-v4-rotate-24h", "24H Ownership Rotation", "Hold leadership at least 24 hours; then rotate only on signal change, with a 72-hour fail-safe expiry.", {
    trailingAtr: 20, takeProfitAtr: 20, stopAtr: 3.2, rebalanceBars: 12, maxHoldBars: 36,
  }),
  c("v26-v4-profit-guard", "Loose Profit Guard", "Replace the 0.4 ATR exact trailing exit with a loose 3 ATR guard and 8 ATR target; otherwise use 24-hour lifecycle.", {
    trailingAtr: 3, takeProfitAtr: 8, stopAtr: 3.2, rebalanceBars: 6, maxHoldBars: 12,
  }),
];

function evaluate(genome: Candidate, data: Awaited<ReturnType<typeof loadPerpMarketData>>, label: string, startTs: number, endTs: number) {
  return evaluateLatencyWindow({ genome, data, label, startTs, endTs, execution: NORMAL, stress: STRESS, targetMonthlyReturnPct: TARGET_MONTHLY });
}

function exitProfile(genome: Candidate, data: Awaited<ReturnType<typeof loadPerpMarketData>>) {
  const r = runPerpBacktest({ genome, data, window: { label: "development-exit-profile", startTs: START, endTs: DEV_END }, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
  const reasons: Record<string, number> = {};
  const holds: number[] = [];
  for (const t of r.trades) { reasons[t.exitReason] = (reasons[t.exitReason] ?? 0) + 1; holds.push(t.holdingBars); }
  holds.sort((a, b) => a - b);
  return {
    reasons,
    averageHoldingBars: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : 0,
    medianHoldingBars: holds.length ? holds[Math.floor(holds.length / 2)] ?? 0 : 0,
    oneBarOrLessPct: holds.length ? holds.filter((x) => x <= 1).length / holds.length * 100 : 0,
  };
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
      id: genome.id, architecture: genome.architecture, exitDesign: genome.exitDesign, parameters: genome.parameters,
      ...x, exitProfile: exitProfile(genome, data), robustGate, targetGate,
      robustnessFloor: Math.min(...stresses.map((s) => s.profitFactor)),
      returnFloor: Math.min(...stresses.map((s) => s.returnPct)),
    });
  }

  development.sort((a, b) => {
    if (a.targetGate !== b.targetGate) return Number(b.targetGate) - Number(a.targetGate);
    if (a.robustGate !== b.robustGate) return Number(b.robustGate) - Number(a.robustGate);
    if (a.normal.cagrPct !== b.normal.cagrPct && a.robustGate && b.robustGate) return b.normal.cagrPct - a.normal.cagrPct;
    if (a.robustnessFloor !== b.robustnessFloor) return b.robustnessFloor - a.robustnessFloor;
    return b.returnFloor - a.returnFloor;
  });

  const selected = development.find((x) => x.robustGate) ?? null;
  const genome = selected ? CANDIDATES.find((x) => x.id === selected.id) ?? null : null;
  const validation = genome ? evaluate(genome, data, "validation", DEV_END, VAL_END) : null;
  const evaluation = genome ? evaluate(genome, data, "evaluation", VAL_END, END) : null;
  const combined3Y = genome ? evaluate(genome, data, "combined3y", START, END) : null;

  const diagnosis = selected ? "EXIT_LIFECYCLE_SURVIVOR_FOUND" : (() => {
    const control = development.find((x) => x.id === "v26-v4-control");
    const best = development[0];
    if (control && control.stressedNoDelay.returnPct > 0 && control.entryDelay.returnPct > 0 && control.exitDelay.returnPct <= 0) return "CONTROL_EXIT_TIMING_CONFIRMED";
    if (best?.exitDelay.returnPct <= 0) return "STATE_EXIT_STILL_NOT_DELAY_ROBUST";
    if (best?.stressedNoDelay.returnPct <= 0) return "STATE_EXIT_DESTROYS_BASE_EDGE";
    if (best?.entryDelay.returnPct <= 0) return "ENTRY_DELAY_EMERGES_AFTER_EXIT_REBUILD";
    if (best?.bothDelay.returnPct <= 0) return "JOINT_DELAY_STILL_FAILS";
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
    researchLine: "V26_LATENCY_AWARE_V4_EXIT_LIFECYCLE_REBUILD",
    researchOnly: true, productionChanged: false, vpsChanged: false, liveChanged: false, realTradingEnabled: false, liveEligible: false,
    penguExcluded: true, leverage: 1, universe: UNIVERSE,
    diagnosisInput: { stressedNoDelay: "positive", entryDelay: "positive", exitDelay: "severely negative", trailingStopShare: "253/269", averageHoldingBars: 2.026 },
    designRule: "Freeze V26 entry. Replace exact intrabar profit trailing with state/time exits. No parameter grid.",
    development, selectedDevelopmentCandidate: selected?.id ?? null, diagnosis, validation, evaluation, combined3Y, acceptance,
  };

  const stateDir = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "v26-latency-aware-v4.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ researchLine: out.researchLine, selectedDevelopmentCandidate: out.selectedDevelopmentCandidate, diagnosis: out.diagnosis, development: out.development.map((x) => ({ id: x.id, normal: x.normal, stressedNoDelay: x.stressedNoDelay, entryDelay: x.entryDelay, exitDelay: x.exitDelay, bothDelay: x.bothDelay, exitProfile: x.exitProfile, robustGate: x.robustGate, targetGate: x.targetGate })), validation: out.validation, evaluation: out.evaluation, combined3Y: out.combined3Y, acceptance: out.acceptance }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
