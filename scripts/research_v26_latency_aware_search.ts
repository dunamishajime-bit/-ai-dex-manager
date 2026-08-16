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
const FEE_BPS_PER_SIDE = 10;
const SLIPPAGE_BPS_PER_SIDE = 5;

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

const BASE_PARAMETERS: PerpStrategyGenome["parameters"] = {
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
const candidate = (
  id: string,
  architecture: string,
  family: PerpStrategyGenome["family"],
  thesis: string,
  overrides: Partial<PerpStrategyGenome["parameters"]>,
): Candidate => ({
  id,
  architecture,
  generation: 12,
  parentIds: [],
  createdBy: "quant-regime",
  family,
  thesis,
  symbols: [...FULL_UNIVERSE],
  parameters: { ...BASE_PARAMETERS, ...overrides, leverage: 1 },
});

// Deliberately small, causal architecture set. This is not a continuous parameter grid.
const CANDIDATES: Candidate[] = [
  candidate(
    "v26-la-trend-persistence-4h",
    "Trend Persistence",
    "regime_momentum",
    "Slow regime ownership and persistent momentum; avoid exact-bar breakout dependence.",
    {
      timeframeHours: 4,
      btcRegimeSmaBars: 42,
      btcRegimeMomentumBars: 30,
      regimeThresholdPct: 0.018,
      momentumBars: 30,
      minimumMomentumPct: 0.018,
      minimumVolumeRatio: 0.85,
      volatilityPenalty: 1.25,
      stopAtr: 2.8,
      takeProfitAtr: 4.5,
      trailingAtr: 1.4,
      maxHoldBars: 24,
      rebalanceBars: 10,
      allowNeutralRegime: false,
    },
  ),
  candidate(
    "v26-la-breakout-expansion-4h",
    "Compression Expansion",
    "breakout",
    "Require a multi-bar expansion beyond prior range with volume support; use wider lifecycle exits.",
    {
      timeframeHours: 4,
      btcRegimeSmaBars: 36,
      btcRegimeMomentumBars: 24,
      regimeThresholdPct: 0.015,
      momentumBars: 20,
      breakoutBars: 16,
      breakoutBufferPct: 0.004,
      minimumMomentumPct: 0.012,
      minimumVolumeRatio: 1.05,
      volatilityPenalty: 1.1,
      stopAtr: 2.7,
      takeProfitAtr: 4.8,
      trailingAtr: 1.5,
      maxHoldBars: 20,
      rebalanceBars: 8,
      allowNeutralRegime: false,
    },
  ),
  candidate(
    "v26-la-relative-handoff-4h",
    "Relative Handoff",
    "relative_strength",
    "Cross-sectional momentum ownership with slower handoff; tolerate neutral BTC only for strong relative score.",
    {
      timeframeHours: 4,
      btcRegimeSmaBars: 40,
      btcRegimeMomentumBars: 28,
      regimeThresholdPct: 0.02,
      momentumBars: 26,
      minimumMomentumPct: 0.014,
      minimumVolumeRatio: 0.9,
      volatilityPenalty: 1.8,
      stopAtr: 2.8,
      takeProfitAtr: 4.2,
      trailingAtr: 1.4,
      maxHoldBars: 22,
      rebalanceBars: 7,
      allowNeutralRegime: true,
      neutralScoreThreshold: 1.35,
    },
  ),
  candidate(
    "v26-la-dual-expansion-6h",
    "Dual-direction Expansion",
    "dual_direction",
    "Slower six-hour directional expansion to reduce dependence on a single one-hour fill.",
    {
      timeframeHours: 6,
      riskPerTradePct: 2.2,
      btcRegimeSmaBars: 28,
      btcRegimeMomentumBars: 20,
      regimeThresholdPct: 0.015,
      momentumBars: 18,
      breakoutBars: 10,
      breakoutBufferPct: 0.004,
      minimumMomentumPct: 0.012,
      minimumVolumeRatio: 1.0,
      minimumEdgeToCostRatio: 5.5,
      volatilityLookbackBars: 16,
      volatilityPenalty: 1.2,
      atrBars: 18,
      stopAtr: 2.8,
      takeProfitAtr: 4.8,
      trailingAtr: 1.6,
      maxHoldBars: 16,
      rebalanceBars: 6,
      allowNeutralRegime: true,
      neutralScoreThreshold: 1.45,
    },
  ),
  candidate(
    "v26-la-trend-state-6h",
    "Trend State Lifecycle",
    "regime_momentum",
    "Six-hour state-machine-like trend participation with wide stops and slow rotation.",
    {
      timeframeHours: 6,
      riskPerTradePct: 2.2,
      btcRegimeSmaBars: 32,
      btcRegimeMomentumBars: 24,
      regimeThresholdPct: 0.012,
      momentumBars: 22,
      minimumMomentumPct: 0.014,
      minimumVolumeRatio: 0.8,
      minimumEdgeToCostRatio: 4.5,
      volatilityLookbackBars: 18,
      volatilityPenalty: 1.0,
      atrBars: 20,
      stopAtr: 3.0,
      takeProfitAtr: 5.0,
      trailingAtr: 1.8,
      maxHoldBars: 18,
      rebalanceBars: 8,
      allowNeutralRegime: false,
    },
  ),
];

function w(label: string, startTs: number, endTs: number) {
  return { label, startTs, endTs };
}

function pf(pnls: number[]) {
  const gp = pnls.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const gl = Math.abs(pnls.filter((x) => x < 0).reduce((a, b) => a + b, 0));
  return gl > 0 ? gp / gl : gp > 0 ? 99 : 0;
}

function pfWithoutBest(pnls: number[]) {
  const x = [...pnls];
  if (x.length) x.splice(x.indexOf(Math.max(...x)), 1);
  return pf(x);
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

type DelayMode = "entry" | "exit" | "both";
function delayedReplay(input: {
  original: PerpBacktestResult;
  data: Awaited<ReturnType<typeof loadPerpMarketData>>;
  startTs: number;
  endTs: number;
  mode: DelayMode;
}) {
  const feeRate = FEE_BPS_PER_SIDE / 10_000;
  const slipRate = SLIPPAGE_BPS_PER_SIDE / 10_000;
  const indexes = Object.fromEntries(
    Object.entries(input.data.bySymbol).map(([s, rows]) => [s, new Map(rows.map((r, i) => [r.ts, i]))]),
  );
  let balance = STARTING_EQUITY;
  let peak = STARTING_EQUITY;
  let maxDrawdownPct = 0;
  const pnls: number[] = [];

  for (const trade of input.original.trades) {
    const rows = input.data.bySymbol[trade.symbol] ?? [];
    const idx = indexes[trade.symbol] as Map<number, number> | undefined;
    const entryTs = trade.entryTs + (input.mode === "entry" || input.mode === "both" ? DELAY_HOURS * HOUR : 0);
    const exitTs = trade.exitTs + (input.mode === "exit" || input.mode === "both" ? DELAY_HOURS * HOUR : 0);
    if (exitTs <= entryTs) continue;
    const ei = idx?.get(entryTs);
    const xi = idx?.get(exitTs);
    if (ei == null || xi == null) throw new Error(`DELAY_FILL_MISSING:${input.mode}:${trade.symbol}:${entryTs}:${exitTs}`);
    const entryOpen = rows[ei]?.open;
    const exitOpen = rows[xi]?.open;
    if (!(entryOpen > 0) || !(exitOpen > 0)) throw new Error(`DELAY_BAD_PRICE:${input.mode}:${trade.symbol}`);

    const dir = trade.side === "long" ? 1 : -1;
    const entryPrice = entryOpen * (trade.side === "long" ? 1 + slipRate : 1 - slipRate);
    const exitPrice = exitOpen * (trade.side === "long" ? 1 - slipRate : 1 + slipRate);
    const effectiveLeverage = Math.min(1, trade.effectiveLeverage);
    const notional = balance * effectiveLeverage;
    const qty = notional / entryPrice;
    const entryFee = notional * feeRate;
    const fundingRate = fundingRateBetween(input.data.fundingBySymbol[trade.symbol] ?? [], entryTs, exitTs);
    const fundingCost = notional * fundingRate * dir;
    const grossPnl = dir * qty * (exitPrice - entryPrice);
    const exitFee = qty * exitPrice * feeRate;
    const netPnl = grossPnl - entryFee - exitFee - fundingCost;
    const before = balance;

    for (let i = ei; i <= xi; i += 1) {
      const row = rows[i];
      if (!row || row.ts > exitTs) break;
      const accrued = notional * fundingRateBetween(input.data.fundingBySymbol[trade.symbol] ?? [], entryTs, row.ts) * dir;
      const unreal = dir * qty * (row.close - entryPrice);
      const exitReserve = qty * row.close * feeRate;
      const equity = Math.max(0, before - entryFee - accrued + unreal - exitReserve);
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
    tradeCount: pnls.length,
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

async function main() {
  if (FULL_UNIVERSE.includes("PENGU")) throw new Error("PENGU_MUST_BE_EXCLUDED");
  if (CANDIDATES.some((g) => g.symbols.length !== FULL_UNIVERSE.length || g.symbols.some((s) => !FULL_UNIVERSE.includes(s)))) {
    throw new Error("UNIVERSE_MUST_REMAIN_FIXED_14");
  }
  if (CANDIDATES.some((g) => g.parameters.leverage !== 1)) throw new Error("LEVERAGE_MUST_BE_ONE");

  const data = await loadPerpMarketData({ symbols: FULL_UNIVERSE, startTs: WARMUP_START, endTs: END + 2 * HOUR });
  const development = [] as Array<Record<string, unknown>>;

  for (const g of CANDIDATES) {
    const normal = runPerpBacktest({
      genome: g,
      data,
      window: w("development", START, DEV_END),
      execution: NORMAL,
      targetMonthlyReturnPct: TARGET_MONTHLY,
    });
    const entryDelay = delayedReplay({ original: normal, data, startTs: START, endTs: DEV_END, mode: "entry" });
    const exitDelay = delayedReplay({ original: normal, data, startTs: START, endTs: DEV_END, mode: "exit" });
    const bothDelay = delayedReplay({ original: normal, data, startTs: START, endTs: DEV_END, mode: "both" });
    const hardGate =
      normal.metrics.tradeCount >= 30 &&
      normal.metrics.cagrPct > 0 &&
      normal.metrics.profitFactor > 1 &&
      bothDelay.returnPct > 0 &&
      bothDelay.profitFactor > 1 &&
      entryDelay.returnPct > 0 &&
      entryDelay.profitFactor > 1 &&
      exitDelay.returnPct > 0 &&
      exitDelay.profitFactor > 1;
    const robustnessFloor = Math.min(entryDelay.profitFactor, exitDelay.profitFactor, bothDelay.profitFactor);
    const returnFloor = Math.min(entryDelay.returnPct, exitDelay.returnPct, bothDelay.returnPct);
    development.push({
      id: g.id,
      architecture: g.architecture,
      family: g.family,
      thesis: g.thesis,
      parameters: g.parameters,
      normal: normalSummary(normal),
      entryDelay,
      exitDelay,
      bothDelay,
      hardGate,
      robustnessFloor,
      returnFloor,
    });
  }

  development.sort((a, b) => {
    const ah = a.hardGate ? 1 : 0;
    const bh = b.hardGate ? 1 : 0;
    if (ah !== bh) return bh - ah;
    const apf = Number(a.robustnessFloor);
    const bpf = Number(b.robustnessFloor);
    if (apf !== bpf) return bpf - apf;
    const ar = Number(a.returnFloor);
    const br = Number(b.returnFloor);
    if (ar !== br) return br - ar;
    return Number((b.normal as { cagrPct: number }).cagrPct) - Number((a.normal as { cagrPct: number }).cagrPct);
  });

  const selectedDev = development.find((x) => x.hardGate === true) ?? null;
  const selectedGenome = selectedDev ? CANDIDATES.find((g) => g.id === selectedDev.id) ?? null : null;
  const untouchedValidation = selectedGenome === null;
  const validation: Record<string, unknown> | null = selectedGenome
    ? (() => {
        const r = runPerpBacktest({ genome: selectedGenome, data, window: w("validation", DEV_END, VAL_END), execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
        return {
          normal: normalSummary(r),
          entryDelay: delayedReplay({ original: r, data, startTs: DEV_END, endTs: VAL_END, mode: "entry" }),
          exitDelay: delayedReplay({ original: r, data, startTs: DEV_END, endTs: VAL_END, mode: "exit" }),
          bothDelay: delayedReplay({ original: r, data, startTs: DEV_END, endTs: VAL_END, mode: "both" }),
        };
      })()
    : null;

  const evaluation: Record<string, unknown> | null = selectedGenome
    ? (() => {
        const r = runPerpBacktest({ genome: selectedGenome, data, window: w("evaluation", VAL_END, END), execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
        return {
          normal: normalSummary(r),
          entryDelay: delayedReplay({ original: r, data, startTs: VAL_END, endTs: END, mode: "entry" }),
          exitDelay: delayedReplay({ original: r, data, startTs: VAL_END, endTs: END, mode: "exit" }),
          bothDelay: delayedReplay({ original: r, data, startTs: VAL_END, endTs: END, mode: "both" }),
        };
      })()
    : null;

  const combined3Y: Record<string, unknown> | null = selectedGenome
    ? (() => {
        const r = runPerpBacktest({ genome: selectedGenome, data, window: w("combined3y", START, END), execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
        return {
          normal: normalSummary(r),
          entryDelay: delayedReplay({ original: r, data, startTs: START, endTs: END, mode: "entry" }),
          exitDelay: delayedReplay({ original: r, data, startTs: START, endTs: END, mode: "exit" }),
          bothDelay: delayedReplay({ original: r, data, startTs: START, endTs: END, mode: "both" }),
        };
      })()
    : null;

  const diagnosis = selectedDev
    ? "DEVELOPMENT_SURVIVOR_FOUND"
    : (() => {
        const best = development[0] as any;
        if (!best) return "NO_CANDIDATES";
        const e = best.entryDelay.returnPct;
        const x = best.exitDelay.returnPct;
        const b = best.bothDelay.returnPct;
        if (e <= 0 && x > 0) return "ENTRY_TIMING_DOMINATES";
        if (x <= 0 && e > 0) return "EXIT_TIMING_DOMINATES";
        if (e <= 0 && x <= 0) return "ENTRY_AND_EXIT_TIMING_BOTH_FAIL";
        if (b <= 0) return "JOINT_DELAY_INTERACTION_FAIL";
        return "PF_OR_SAMPLE_GATE_FAIL";
      })();

  const acceptance = combined3Y
    ? (() => {
        const c = combined3Y as any;
        return {
          normal3YCagrAtLeast100: c.normal.cagrPct >= 100,
          normalPfAbove1: c.normal.profitFactor > 1,
          delayed3YReturnPositive: c.bothDelay.returnPct > 0,
          delayedPfAbove1: c.bothDelay.profitFactor > 1,
          delayedDDAtMost50: c.bothDelay.maxDrawdownPct <= 50,
          leverageAtMost1: c.normal.maximumEffectiveLeverage <= 1.000001,
          zeroLiquidations: c.normal.liquidationCount === 0,
        };
      })()
    : null;

  const out = {
    researchLine: "V26_LATENCY_AWARE_STRUCTURAL_SEARCH_V1",
    researchOnly: true,
    productionChanged: false,
    vpsChanged: false,
    liveChanged: false,
    realTradingEnabled: false,
    liveEligible: false,
    penguExcluded: true,
    leverage: 1,
    universe: FULL_UNIVERSE,
    selectionProtocol: {
      developmentOnlySelection: "2023-07-01 <= t < 2024-07-01",
      validationEvaluationUntouchedUntilDevSurvivor: true,
      continuousParameterGrid: false,
      candidateArchitectures: CANDIDATES.map((x) => x.architecture),
      delayedStress: { delayHours: 1, feeBpsPerSide: FEE_BPS_PER_SIDE, slippageBpsPerSide: SLIPPAGE_BPS_PER_SIDE, roundTripBps: 30 },
      lexicographicPriority: ["hardGate", "minimum delayed PF", "minimum delayed return", "normal CAGR"],
      hardGate: "trades>=30; normal return/PF positive; entry-only, exit-only, and both-delay return>0 and PF>1",
    },
    development,
    selectedDevelopmentCandidate: selectedDev?.id ?? null,
    validationEvaluationUntouched: untouchedValidation,
    diagnosis,
    validation,
    evaluation,
    combined3Y,
    acceptance,
  };

  const stateDir = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(stateDir, { recursive: true });
  const outputPath = path.join(stateDir, "v26-latency-aware-search.json");
  await fs.writeFile(outputPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    researchLine: out.researchLine,
    selectedDevelopmentCandidate: out.selectedDevelopmentCandidate,
    diagnosis: out.diagnosis,
    bestDevelopment: out.development[0] ?? null,
    acceptance: out.acceptance,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
