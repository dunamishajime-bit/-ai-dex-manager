import fs from "fs/promises";
import path from "path";

import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { runPerpBacktest } from "../lib/research-lab/perp/engine";
import type { PerpBacktestResult, PerpExecutionAssumptions, PerpFundingPoint, PerpStrategyGenome } from "../lib/research-lab/perp/types";

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2023, 6, 1);
const DEV_END = Date.UTC(2024, 6, 1);
const VAL_END = Date.UTC(2025, 6, 1);
const END = Date.UTC(2026, 6, 1);
const WARMUP_START = START - 180 * 24 * HOUR;
const STARTING_EQUITY = 10_000;
const TARGET_MONTHLY = 6;
const DELAY_HOURS = 1;
const STRESS_FEE_BPS_PER_SIDE = 10;
const STRESS_SLIPPAGE_BPS_PER_SIDE = 5;

const FULL_UNIVERSE = [
  "BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ",
  "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR",
];

const NORMAL: PerpExecutionAssumptions = {
  feeBpsPerSide: 5,
  slippageBpsPerSide: 0,
  adverseFundingBpsPer8h: 0,
  maintenanceMarginRate: 0.005,
};

const BASE: PerpStrategyGenome["parameters"] = {
  timeframeHours: 4,
  leverage: 1,
  riskPerTradePct: 2.4,
  maxMarginUsagePct: 100,
  btcRegimeSmaBars: 36,
  btcRegimeMomentumBars: 30,
  regimeThresholdPct: 0.02,
  momentumBars: 24,
  breakoutBars: 12,
  breakoutBufferPct: 0.006,
  minimumMomentumPct: 0.015,
  minimumVolumeRatio: 0.9,
  minimumEdgeToCostRatio: 5,
  volatilityLookbackBars: 18,
  volatilityPenalty: 1.6,
  atrBars: 20,
  stopAtr: 2.5,
  takeProfitAtr: 4,
  trailingAtr: 1.2,
  maxHoldBars: 24,
  rebalanceBars: 8,
  cooldownBars: 1,
  allowLong: true,
  allowShort: true,
  allowNeutralRegime: false,
  neutralScoreThreshold: 1.2,
};

type Candidate = PerpStrategyGenome & { architecture: string };
function c(
  id: string,
  architecture: string,
  family: PerpStrategyGenome["family"],
  thesis: string,
  overrides: Partial<PerpStrategyGenome["parameters"]>,
): Candidate {
  return {
    id,
    architecture,
    generation: 13,
    parentIds: [],
    createdBy: "quant-regime",
    family,
    thesis,
    symbols: [...FULL_UNIVERSE],
    parameters: { ...BASE, ...overrides, leverage: 1 },
  };
}

// Frozen V1 architecture set. V2 changes the latency measurement only.
const CANDIDATES: Candidate[] = [
  c("v26-la-trend-persistence-4h", "Trend Persistence", "regime_momentum",
    "Slow regime ownership and persistent momentum; avoid exact-bar breakout dependence.", {
      timeframeHours: 4, btcRegimeSmaBars: 42, btcRegimeMomentumBars: 30,
      regimeThresholdPct: 0.018, momentumBars: 30, minimumMomentumPct: 0.018,
      minimumVolumeRatio: 0.85, volatilityPenalty: 1.25, stopAtr: 2.8,
      takeProfitAtr: 4.5, trailingAtr: 1.4, maxHoldBars: 24, rebalanceBars: 10,
      allowNeutralRegime: false,
    }),
  c("v26-la-breakout-expansion-4h", "Compression Expansion", "breakout",
    "Require a multi-bar expansion beyond prior range with volume support; use wider lifecycle exits.", {
      timeframeHours: 4, btcRegimeSmaBars: 36, btcRegimeMomentumBars: 24,
      regimeThresholdPct: 0.015, momentumBars: 20, breakoutBars: 16,
      breakoutBufferPct: 0.004, minimumMomentumPct: 0.012, minimumVolumeRatio: 1.05,
      volatilityPenalty: 1.1, stopAtr: 2.7, takeProfitAtr: 4.8, trailingAtr: 1.5,
      maxHoldBars: 20, rebalanceBars: 8, allowNeutralRegime: false,
    }),
  c("v26-la-relative-handoff-4h", "Relative Handoff", "relative_strength",
    "Cross-sectional momentum ownership with slower handoff; tolerate neutral BTC only for strong relative score.", {
      timeframeHours: 4, btcRegimeSmaBars: 40, btcRegimeMomentumBars: 28,
      regimeThresholdPct: 0.02, momentumBars: 26, minimumMomentumPct: 0.014,
      minimumVolumeRatio: 0.9, volatilityPenalty: 1.8, stopAtr: 2.8,
      takeProfitAtr: 4.2, trailingAtr: 1.4, maxHoldBars: 22, rebalanceBars: 7,
      allowNeutralRegime: true, neutralScoreThreshold: 1.35,
    }),
  c("v26-la-dual-expansion-6h", "Dual-direction Expansion", "dual_direction",
    "Slower six-hour directional expansion to reduce dependence on a single one-hour fill.", {
      timeframeHours: 6, riskPerTradePct: 2.2, btcRegimeSmaBars: 28,
      btcRegimeMomentumBars: 20, regimeThresholdPct: 0.015, momentumBars: 18,
      breakoutBars: 10, breakoutBufferPct: 0.004, minimumMomentumPct: 0.012,
      minimumVolumeRatio: 1, minimumEdgeToCostRatio: 5.5,
      volatilityLookbackBars: 16, volatilityPenalty: 1.2, atrBars: 18,
      stopAtr: 2.8, takeProfitAtr: 4.8, trailingAtr: 1.6, maxHoldBars: 16,
      rebalanceBars: 6, allowNeutralRegime: true, neutralScoreThreshold: 1.45,
    }),
  c("v26-la-trend-state-6h", "Trend State Lifecycle", "regime_momentum",
    "Six-hour state-machine-like trend participation with wide stops and slow rotation.", {
      timeframeHours: 6, riskPerTradePct: 2.2, btcRegimeSmaBars: 32,
      btcRegimeMomentumBars: 24, regimeThresholdPct: 0.012, momentumBars: 22,
      minimumMomentumPct: 0.014, minimumVolumeRatio: 0.8, minimumEdgeToCostRatio: 4.5,
      volatilityLookbackBars: 18, volatilityPenalty: 1, atrBars: 20,
      stopAtr: 3, takeProfitAtr: 5, trailingAtr: 1.8, maxHoldBars: 18,
      rebalanceBars: 8, allowNeutralRegime: false,
    }),
];

function window(label: string, startTs: number, endTs: number) {
  return { label, startTs, endTs };
}

function pf(pnls: number[]) {
  const gp = pnls.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const gl = Math.abs(pnls.filter((x) => x < 0).reduce((a, b) => a + b, 0));
  return gl > 0 ? gp / gl : gp > 0 ? 99 : 0;
}

function pfWithoutBest(pnls: number[]) {
  const copy = [...pnls];
  if (copy.length) copy.splice(copy.indexOf(Math.max(...copy)), 1);
  return pf(copy);
}

function firstFundingIndexAfter(points: PerpFundingPoint[], ts: number) {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const m = Math.floor((lo + hi) / 2);
    if ((points[m]?.ts ?? Number.POSITIVE_INFINITY) <= ts) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function fundingRateBetween(points: PerpFundingPoint[], fromExclusive: number, toInclusive: number) {
  let i = firstFundingIndexAfter(points, fromExclusive);
  let total = 0;
  while (i < points.length) {
    const p = points[i];
    if (!p || p.ts > toInclusive) break;
    total += p.rate;
    i += 1;
  }
  return total;
}

type ReplayMode = "none" | "entry" | "exit" | "both";

function adverseEntry(raw: number, side: "long" | "short", slipRate: number) {
  return side === "long" ? raw * (1 + slipRate) : raw * (1 - slipRate);
}
function adverseExit(raw: number, side: "long" | "short", slipRate: number) {
  return side === "long" ? raw * (1 - slipRate) : raw * (1 + slipRate);
}

/**
 * Corrected V2 replay:
 * - only a leg explicitly marked delayed is replaced with the +1h raw 1h open;
 * - an undelayed leg preserves the engine's original entry/exit execution price,
 *   so stop/TP/trailing prices are not silently replaced by candle open;
 * - the same +30bps round-trip fee/slippage stress applies to every replay mode.
 */
function stressedReplay(input: {
  original: PerpBacktestResult;
  data: Awaited<ReturnType<typeof loadPerpMarketData>>;
  startTs: number;
  endTs: number;
  mode: ReplayMode;
}) {
  const feeRate = STRESS_FEE_BPS_PER_SIDE / 10_000;
  const slipRate = STRESS_SLIPPAGE_BPS_PER_SIDE / 10_000;
  const indexBySymbol = Object.fromEntries(
    Object.entries(input.data.bySymbol).map(([symbol, rows]) => [symbol, new Map(rows.map((row, i) => [row.ts, i]))]),
  );

  let balance = STARTING_EQUITY;
  let peak = STARTING_EQUITY;
  let maxDrawdownPct = 0;
  let skippedShortTrades = 0;
  const pnls: number[] = [];

  for (const trade of input.original.trades) {
    const delayEntry = input.mode === "entry" || input.mode === "both";
    const delayExit = input.mode === "exit" || input.mode === "both";
    const entryTs = trade.entryTs + (delayEntry ? DELAY_HOURS * HOUR : 0);
    const exitTs = trade.exitTs + (delayExit ? DELAY_HOURS * HOUR : 0);
    if (exitTs <= entryTs) {
      skippedShortTrades += 1;
      continue;
    }

    const rows = input.data.bySymbol[trade.symbol] ?? [];
    const idx = indexBySymbol[trade.symbol] as Map<number, number> | undefined;
    const entryIndex = idx?.get(entryTs);
    const exitIndex = idx?.get(exitTs);
    if (entryIndex == null || exitIndex == null) {
      throw new Error(`STRESS_FILL_MISSING:${input.mode}:${trade.symbol}:${entryTs}:${exitTs}`);
    }

    const delayedEntryOpen = rows[entryIndex]?.open;
    const delayedExitOpen = rows[exitIndex]?.open;
    const rawEntry = delayEntry ? delayedEntryOpen : trade.entryPrice;
    const rawExit = delayExit ? delayedExitOpen : trade.exitPrice;
    if (!(rawEntry > 0) || !(rawExit > 0)) throw new Error(`STRESS_BAD_PRICE:${input.mode}:${trade.symbol}`);

    const side = trade.side;
    const dir = side === "long" ? 1 : -1;
    const entryPrice = adverseEntry(rawEntry, side, slipRate);
    const exitPrice = adverseExit(rawExit, side, slipRate);
    const effectiveLeverage = Math.min(1, trade.effectiveLeverage);
    const notional = balance * effectiveLeverage;
    const quantity = notional / entryPrice;
    const entryFee = notional * feeRate;
    const fundingRate = fundingRateBetween(input.data.fundingBySymbol[trade.symbol] ?? [], entryTs, exitTs);
    const fundingCost = notional * fundingRate * dir;
    const grossPnl = dir * quantity * (exitPrice - entryPrice);
    const exitFee = quantity * exitPrice * feeRate;
    const netPnl = grossPnl - entryFee - exitFee - fundingCost;
    const before = balance;

    for (let i = entryIndex; i <= exitIndex; i += 1) {
      const row = rows[i];
      if (!row || row.ts > exitTs) break;
      const accruedFunding = notional * fundingRateBetween(input.data.fundingBySymbol[trade.symbol] ?? [], entryTs, row.ts) * dir;
      const unrealized = dir * quantity * (row.close - entryPrice);
      const exitReserve = quantity * row.close * feeRate;
      const equity = Math.max(0, before - entryFee - accruedFunding + unrealized - exitReserve);
      peak = Math.max(peak, equity);
      maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - equity) / peak) * 100 : 100);
    }

    balance = Math.max(0, before + netPnl);
    peak = Math.max(peak, balance);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - balance) / peak) * 100 : 100);
    pnls.push(netPnl);
  }

  const years = (input.endTs - input.startTs) / (365.25 * 24 * HOUR);
  return {
    mode: input.mode,
    tradeCount: pnls.length,
    skippedShortTrades,
    endingEquity: balance,
    returnPct: (balance / STARTING_EQUITY - 1) * 100,
    cagrPct: (Math.pow(balance / STARTING_EQUITY, 1 / years) - 1) * 100,
    maxDrawdownPct,
    profitFactor: pf(pnls),
    profitFactorWithoutBest: pfWithoutBest(pnls),
    winRatePct: pnls.length ? (pnls.filter((x) => x > 0).length / pnls.length) * 100 : 0,
  };
}

function normalSummary(r: PerpBacktestResult) {
  return {
    cagrPct: r.metrics.cagrPct,
    maxDrawdownPct: r.metrics.maxDrawdownPct,
    profitFactor: r.metrics.profitFactor,
    tradeCount: r.metrics.tradeCount,
    winRatePct: r.metrics.winRatePct,
    endingEquity: r.risk.endingEquity,
    maximumEffectiveLeverage: r.risk.maximumEffectiveLeverage,
    liquidationCount: r.risk.liquidationCount,
  };
}

function evaluateWindow(
  genome: Candidate,
  data: Awaited<ReturnType<typeof loadPerpMarketData>>,
  label: string,
  startTs: number,
  endTs: number,
) {
  const normal = runPerpBacktest({
    genome, data, window: window(label, startTs, endTs), execution: NORMAL,
    targetMonthlyReturnPct: TARGET_MONTHLY,
  });
  return {
    normal: normalSummary(normal),
    stressedNoDelay: stressedReplay({ original: normal, data, startTs, endTs, mode: "none" }),
    entryDelay: stressedReplay({ original: normal, data, startTs, endTs, mode: "entry" }),
    exitDelay: stressedReplay({ original: normal, data, startTs, endTs, mode: "exit" }),
    bothDelay: stressedReplay({ original: normal, data, startTs, endTs, mode: "both" }),
  };
}

async function main() {
  if (FULL_UNIVERSE.length !== 14 || FULL_UNIVERSE.includes("PENGU")) throw new Error("UNIVERSE_BOUNDARY_FAIL");
  if (CANDIDATES.some((g) => g.parameters.leverage !== 1 || g.symbols.length !== 14 || g.symbols.includes("PENGU"))) {
    throw new Error("CANDIDATE_BOUNDARY_FAIL");
  }

  const data = await loadPerpMarketData({ symbols: FULL_UNIVERSE, startTs: WARMUP_START, endTs: END + 2 * HOUR });
  const development: any[] = [];

  for (const genome of CANDIDATES) {
    const result = evaluateWindow(genome, data, "development", START, DEV_END);
    const stressModes = [result.stressedNoDelay, result.entryDelay, result.exitDelay, result.bothDelay];
    const hardGate =
      result.normal.tradeCount >= 30 &&
      result.normal.cagrPct > 0 && result.normal.profitFactor > 1 &&
      stressModes.every((x) => x.returnPct > 0 && x.profitFactor > 1) &&
      result.bothDelay.profitFactorWithoutBest >= 0.95;
    development.push({
      id: genome.id,
      architecture: genome.architecture,
      family: genome.family,
      thesis: genome.thesis,
      parameters: genome.parameters,
      ...result,
      hardGate,
      robustnessFloor: Math.min(...stressModes.map((x) => x.profitFactor)),
      returnFloor: Math.min(...stressModes.map((x) => x.returnPct)),
    });
  }

  development.sort((a, b) => {
    if (a.hardGate !== b.hardGate) return Number(b.hardGate) - Number(a.hardGate);
    if (a.robustnessFloor !== b.robustnessFloor) return b.robustnessFloor - a.robustnessFloor;
    if (a.returnFloor !== b.returnFloor) return b.returnFloor - a.returnFloor;
    return b.normal.cagrPct - a.normal.cagrPct;
  });

  const selected = development.find((x) => x.hardGate) ?? null;
  const selectedGenome = selected ? CANDIDATES.find((g) => g.id === selected.id) ?? null : null;
  const validation = selectedGenome ? evaluateWindow(selectedGenome, data, "validation", DEV_END, VAL_END) : null;
  const evaluation = selectedGenome ? evaluateWindow(selectedGenome, data, "evaluation", VAL_END, END) : null;
  const combined3Y = selectedGenome ? evaluateWindow(selectedGenome, data, "combined3y", START, END) : null;

  let diagnosis = "DEVELOPMENT_SURVIVOR_FOUND";
  if (!selected) {
    const best = development[0];
    if (!best) diagnosis = "NO_CANDIDATES";
    else if (best.stressedNoDelay.returnPct <= 0 || best.stressedNoDelay.profitFactor <= 1) diagnosis = "COST_ROBUSTNESS_FAIL";
    else if (best.entryDelay.returnPct <= 0 && best.exitDelay.returnPct > 0) diagnosis = "ENTRY_TIMING_DOMINATES";
    else if (best.exitDelay.returnPct <= 0 && best.entryDelay.returnPct > 0) diagnosis = "EXIT_TIMING_DOMINATES";
    else if (best.entryDelay.returnPct <= 0 && best.exitDelay.returnPct <= 0) diagnosis = "ENTRY_AND_EXIT_TIMING_BOTH_FAIL";
    else if (best.bothDelay.returnPct <= 0 || best.bothDelay.profitFactor <= 1) diagnosis = "JOINT_DELAY_INTERACTION_FAIL";
    else diagnosis = "NORMAL_OR_BEST_TRADE_GATE_FAIL";
  }

  const acceptance = combined3Y ? {
    normal3YCagrAtLeast100: combined3Y.normal.cagrPct >= 100,
    normalPfAbove1: combined3Y.normal.profitFactor > 1,
    stressNoDelayPositive: combined3Y.stressedNoDelay.returnPct > 0 && combined3Y.stressedNoDelay.profitFactor > 1,
    delayed3YReturnPositive: combined3Y.bothDelay.returnPct > 0,
    delayedPfAbove1: combined3Y.bothDelay.profitFactor > 1,
    delayedPfWithoutBestAtLeast095: combined3Y.bothDelay.profitFactorWithoutBest >= 0.95,
    delayedDDAtMost50: combined3Y.bothDelay.maxDrawdownPct <= 50,
    leverageAtMost1: combined3Y.normal.maximumEffectiveLeverage <= 1.000001,
    zeroLiquidations: combined3Y.normal.liquidationCount === 0,
  } : null;

  const out = {
    researchLine: "V26_LATENCY_AWARE_STRUCTURAL_SEARCH_V2_CORRECTED_REPLAY",
    researchOnly: true,
    productionChanged: false,
    vpsChanged: false,
    liveChanged: false,
    realTradingEnabled: false,
    liveEligible: false,
    penguExcluded: true,
    leverage: 1,
    universe: FULL_UNIVERSE,
    correction: {
      priorReplayDefect: "undelayed legs were incorrectly replaced by raw 1h opens, losing actual engine stop/TP/trailing execution prices",
      v2Rule: "only delayed legs use +1h open; undelayed legs preserve original engine execution price; +30bps round-trip stress remains applied",
      architectureSetChangedFromV1: false,
    },
    selectionProtocol: {
      developmentOnlySelection: "2023-07-01 <= t < 2024-07-01",
      validationEvaluationUntouchedUntilDevSurvivor: true,
      continuousParameterGrid: false,
      candidateArchitectures: CANDIDATES.map((x) => x.architecture),
      stressModes: ["stressedNoDelay", "entryDelay", "exitDelay", "bothDelay"],
      delayedStress: { delayHours: 1, feeBpsPerSide: STRESS_FEE_BPS_PER_SIDE, slippageBpsPerSide: STRESS_SLIPPAGE_BPS_PER_SIDE, roundTripBps: 30 },
      lexicographicPriority: ["hardGate", "minimum stress PF", "minimum stress return", "normal CAGR"],
      hardGate: "trades>=30; normal CAGR>0/PF>1; all stress modes return>0/PF>1; both-delay PF without best>=0.95",
    },
    development,
    selectedDevelopmentCandidate: selected?.id ?? null,
    validationEvaluationUntouched: selected === null,
    diagnosis,
    validation,
    evaluation,
    combined3Y,
    acceptance,
  };

  const stateDir = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(stateDir, { recursive: true });
  const outputPath = path.join(stateDir, "v26-latency-aware-search-v2.json");
  await fs.writeFile(outputPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    researchLine: out.researchLine,
    selectedDevelopmentCandidate: out.selectedDevelopmentCandidate,
    diagnosis: out.diagnosis,
    bestDevelopment: out.development[0] ?? null,
    validation: out.validation,
    evaluation: out.evaluation,
    acceptance: out.acceptance,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
