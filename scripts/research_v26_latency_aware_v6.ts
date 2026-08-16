import fs from "fs/promises";
import path from "path";

import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { runPerpBacktest } from "../lib/research-lab/perp/engine";
import { normalBacktestSummary, replayWithLatencyStress, type LatencyReplayMode } from "../lib/research-lab/perp/latency-stress";
import type { PerpBacktestResult, PerpExecutionAssumptions, PerpMarketData, PerpStrategyGenome, PerpTrade } from "../lib/research-lab/perp/types";

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

const GENOME: PerpStrategyGenome = {
  id: "v26-v6-v4-profit-guard-entry-failclosed",
  generation: 17,
  parentIds: ["v26-v4-profit-guard"],
  createdBy: "quant-regime",
  family: "relative_strength",
  thesis: "Keep the V4 loose lifecycle exit and cancel stale delayed entries whose one-hour fill no longer resembles the originating 2H signal state.",
  symbols: [...UNIVERSE],
  parameters: {
    timeframeHours: 2, leverage: 1, riskPerTradePct: 3.19, maxMarginUsagePct: 100,
    btcRegimeSmaBars: 53, btcRegimeMomentumBars: 52, regimeThresholdPct: 0.0377,
    momentumBars: 45, breakoutBars: 18, breakoutBufferPct: 0.0233,
    minimumMomentumPct: 0.0227, minimumVolumeRatio: 0.9845, minimumEdgeToCostRatio: 6.0879,
    volatilityLookbackBars: 15, volatilityPenalty: 2.3953, atrBars: 31,
    stopAtr: 3.2, takeProfitAtr: 8, trailingAtr: 3,
    maxHoldBars: 12, rebalanceBars: 6, cooldownBars: 1,
    allowLong: true, allowShort: true, allowNeutralRegime: true, neutralScoreThreshold: 1.4649,
  },
};

type EntryPolicy = {
  id: string;
  architecture: string;
  minDirectionalMovePct: number;
  maxDirectionalMovePct: number;
  requireLastHourAligned: boolean;
  minLastHourAlignedPct: number;
};

// Discrete causal policies, not a parameter grid.
const POLICIES: EntryPolicy[] = [
  { id: "v26-v6-control", architecture: "No stale-entry guard", minDirectionalMovePct: -100, maxDirectionalMovePct: 100, requireLastHourAligned: false, minLastHourAlignedPct: -100 },
  { id: "v26-v6-no-chase", architecture: "No-Chase Guard", minDirectionalMovePct: -1.5, maxDirectionalMovePct: 0.35, requireLastHourAligned: false, minLastHourAlignedPct: -100 },
  { id: "v26-v6-balanced-band", architecture: "Balanced State Band", minDirectionalMovePct: -1.25, maxDirectionalMovePct: 0.75, requireLastHourAligned: false, minLastHourAlignedPct: -100 },
  { id: "v26-v6-reacceleration", architecture: "Pullback Re-acceleration", minDirectionalMovePct: -1.25, maxDirectionalMovePct: 0.50, requireLastHourAligned: true, minLastHourAlignedPct: 0.05 },
  { id: "v26-v6-confirmed-continuation", architecture: "Confirmed Continuation", minDirectionalMovePct: -0.50, maxDirectionalMovePct: 0.90, requireLastHourAligned: true, minLastHourAlignedPct: 0.10 },
];

function directionalMovePct(trade: PerpTrade, rawEntry: number) {
  const dir = trade.side === "long" ? 1 : -1;
  return dir * (rawEntry / trade.entryPrice - 1) * 100;
}

function guardPass(trade: PerpTrade, data: PerpMarketData, entryTs: number, policy: EntryPolicy) {
  const rows = data.bySymbol[trade.symbol] ?? [];
  const index = new Map(rows.map((row, i) => [row.ts, i])).get(entryTs);
  if (index == null) throw new Error(`V6_GUARD_FILL_MISSING:${trade.symbol}:${entryTs}`);
  const row = rows[index];
  if (!row || !(row.open > 0)) throw new Error(`V6_GUARD_BAD_PRICE:${trade.symbol}:${entryTs}`);
  const movePct = directionalMovePct(trade, row.open);
  if (movePct < policy.minDirectionalMovePct || movePct > policy.maxDirectionalMovePct) return false;
  if (!policy.requireLastHourAligned) return true;
  const prior = rows[index - 1];
  if (!prior || !(prior.open > 0) || !(prior.close > 0)) return false;
  const dir = trade.side === "long" ? 1 : -1;
  const alignedPct = dir * (prior.close / prior.open - 1) * 100;
  return alignedPct >= policy.minLastHourAlignedPct;
}

function guardedReplay(input: {
  original: PerpBacktestResult;
  data: PerpMarketData;
  startTs: number;
  endTs: number;
  mode: LatencyReplayMode;
  policy: EntryPolicy;
}) {
  const delayedEntry = input.mode === "entry" || input.mode === "both";
  let canceledByGuard = 0;
  const trades = delayedEntry ? input.original.trades.filter((trade) => {
    const pass = guardPass(trade, input.data, trade.entryTs + STRESS.delayHours * HOUR, input.policy);
    if (!pass) canceledByGuard += 1;
    return pass;
  }) : input.original.trades;
  const replay = replayWithLatencyStress({
    original: { ...input.original, trades }, data: input.data, startTs: input.startTs, endTs: input.endTs,
    mode: input.mode, stress: STRESS,
  });
  return { ...replay, canceledByGuard, guardRetentionPct: input.original.trades.length ? trades.length / input.original.trades.length * 100 : 0 };
}

function evaluate(policy: EntryPolicy, data: PerpMarketData, label: string, startTs: number, endTs: number) {
  const original = runPerpBacktest({ genome: GENOME, data, window: { label, startTs, endTs }, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
  return {
    normal: normalBacktestSummary(original),
    stressedNoDelay: guardedReplay({ original, data, startTs, endTs, mode: "none", policy }),
    entryDelay: guardedReplay({ original, data, startTs, endTs, mode: "entry", policy }),
    exitDelay: guardedReplay({ original, data, startTs, endTs, mode: "exit", policy }),
    bothDelay: guardedReplay({ original, data, startTs, endTs, mode: "both", policy }),
  };
}

async function main() {
  if (UNIVERSE.length !== 14 || UNIVERSE.includes("PENGU") || GENOME.parameters.leverage !== 1) throw new Error("V6_BOUNDARY_FAIL");
  const data = await loadPerpMarketData({ symbols: UNIVERSE, startTs: WARMUP_START, endTs: END + 2 * HOUR });
  const development: any[] = [];

  for (const policy of POLICIES) {
    const x = evaluate(policy, data, "development", START, DEV_END);
    const stresses = [x.stressedNoDelay, x.entryDelay, x.exitDelay, x.bothDelay];
    const robustGate = x.normal.cagrPct > 0 && x.normal.profitFactor > 1 && x.normal.tradeCount >= 30
      && stresses.every((s) => s.returnPct > 0 && s.profitFactor > 1)
      && x.bothDelay.profitFactorWithoutBest >= 0.95
      && x.entryDelay.guardRetentionPct >= 35;
    const targetGate = robustGate && x.normal.cagrPct >= 40 && x.bothDelay.cagrPct >= 10;
    development.push({
      ...policy, ...x, robustGate, targetGate,
      robustnessFloor: Math.min(...stresses.map((s) => s.profitFactor)),
      returnFloor: Math.min(...stresses.map((s) => s.returnPct)),
    });
  }

  development.sort((a, b) => {
    if (a.targetGate !== b.targetGate) return Number(b.targetGate) - Number(a.targetGate);
    if (a.robustGate !== b.robustGate) return Number(b.robustGate) - Number(a.robustGate);
    if (a.robustnessFloor !== b.robustnessFloor) return b.robustnessFloor - a.robustnessFloor;
    if (a.returnFloor !== b.returnFloor) return b.returnFloor - a.returnFloor;
    return b.entryDelay.guardRetentionPct - a.entryDelay.guardRetentionPct;
  });

  const selected = development.find((x) => x.robustGate) ?? null;
  const policy = selected ? POLICIES.find((x) => x.id === selected.id) ?? null : null;
  const validation = policy ? evaluate(policy, data, "validation", DEV_END, VAL_END) : null;
  const evaluation = policy ? evaluate(policy, data, "evaluation", VAL_END, END) : null;
  const combined3Y = policy ? evaluate(policy, data, "combined3y", START, END) : null;

  const diagnosis = selected ? "STALE_ENTRY_GUARD_SURVIVOR_FOUND" : (() => {
    const best = development[0];
    if (best?.entryDelay.returnPct <= 0) return "STALE_CANCEL_NOT_ENOUGH_FOR_ENTRY_DELAY";
    if (best?.exitDelay.returnPct <= 0) return "EXIT_LIFECYCLE_REGRESSION";
    if (best?.bothDelay.returnPct <= 0) return "JOINT_DELAY_REMAINS_NEGATIVE";
    if (best?.entryDelay.guardRetentionPct < 35) return "ROBUSTNESS_ONLY_BY_EXCESSIVE_TRADE_CANCELLATION";
    return "PF_OR_BEST_TRADE_GATE_FAIL";
  })();

  const acceptance = combined3Y ? {
    normal3YCagrAtLeast100: combined3Y.normal.cagrPct >= 100,
    allStressPositive: [combined3Y.stressedNoDelay, combined3Y.entryDelay, combined3Y.exitDelay, combined3Y.bothDelay].every((s) => s.returnPct > 0 && s.profitFactor > 1),
    bothDelayPfWithoutBestAtLeast095: combined3Y.bothDelay.profitFactorWithoutBest >= 0.95,
    bothDelayDdAtMost50: combined3Y.bothDelay.maxDrawdownPct <= 50,
    entryGuardRetentionAtLeast35: combined3Y.entryDelay.guardRetentionPct >= 35,
    maxLeverageAtMost1: combined3Y.normal.maximumEffectiveLeverage <= 1.000001,
    zeroLiquidations: combined3Y.normal.liquidationCount === 0,
  } : null;

  const out = {
    researchLine: "V26_LATENCY_AWARE_V6_FAIL_CLOSED_STALE_ENTRY_GUARD",
    researchOnly: true, productionChanged: false, vpsChanged: false, liveChanged: false, realTradingEnabled: false, liveEligible: false,
    penguExcluded: true, leverage: 1, universe: UNIVERSE,
    diagnosisInput: { v5: "slower 4H/6H state destroyed base edge", v4ProfitGuard: "exit delay positive; entry delay negative" },
    designRule: "Keep the profitable 2H signal and V4 lifecycle. On delayed fills only, cancel stale orders when price state has moved outside a predeclared causal band. No post-hoc symbol deletion and no threshold grid.",
    development, selectedDevelopmentCandidate: selected?.id ?? null, diagnosis, validation, evaluation, combined3Y, acceptance,
  };

  const stateDir = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "v26-latency-aware-v6.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ researchLine: out.researchLine, selectedDevelopmentCandidate: out.selectedDevelopmentCandidate, diagnosis: out.diagnosis, development: out.development.map((x) => ({ id: x.id, architecture: x.architecture, normal: x.normal, stressedNoDelay: x.stressedNoDelay, entryDelay: x.entryDelay, exitDelay: x.exitDelay, bothDelay: x.bothDelay, robustGate: x.robustGate, targetGate: x.targetGate })), validation: out.validation, evaluation: out.evaluation, combined3Y: out.combined3Y, acceptance: out.acceptance }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
