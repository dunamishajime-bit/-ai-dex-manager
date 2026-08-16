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
const WARMUP_START = START - 120 * 24 * HOUR;
const STARTING_EQUITY = 10_000;
const TARGET_MONTHLY = 6;
const DELAY_HOURS = 1;
const FEE_BPS_PER_SIDE = 10;
const SLIPPAGE_BPS_PER_SIDE = 5;

const FULL_UNIVERSE = [
  "BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ",
  "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR",
];

const FROZEN: PerpStrategyGenome = {
  id: "bp11-0015-no-pengu-dev-latency-prune",
  generation: 11,
  parentIds: ["bp10-0012", "bp10-0007"],
  createdBy: "quant-regime",
  family: "relative_strength",
  thesis: "Frozen V26 No-PENGU winner; Development delayed-stress net PnL < 0 symbols are removed once, then universe is frozen.",
  symbols: [...FULL_UNIVERSE],
  parameters: {
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
  },
};

const NORMAL: PerpExecutionAssumptions = {
  feeBpsPerSide: 5,
  slippageBpsPerSide: 0,
  adverseFundingBpsPer8h: 0,
  maintenanceMarginRate: 0.005,
};
const ENGINE_STRESS: PerpExecutionAssumptions = {
  feeBpsPerSide: 10,
  slippageBpsPerSide: 5,
  adverseFundingBpsPer8h: 0,
  maintenanceMarginRate: 0.005,
};

function w(label: string, startTs: number, endTs: number) { return { label, startTs, endTs }; }
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
  let lo = 0, hi = points.length;
  while (lo < hi) {
    const m = Math.floor((lo + hi) / 2);
    if ((points[m]?.ts ?? Number.POSITIVE_INFINITY) <= ts) lo = m + 1; else hi = m;
  }
  return lo;
}
function fundingRateBetween(points: PerpFundingPoint[], fromExclusive: number, toInclusive: number) {
  let i = firstFundingIndexAfter(points, fromExclusive), total = 0;
  while (i < points.length) {
    const p = points[i];
    if (!p || p.ts > toInclusive) break;
    total += p.rate; i += 1;
  }
  return total;
}
function delayedReplay(input: {
  original: PerpBacktestResult;
  data: Awaited<ReturnType<typeof loadPerpMarketData>>;
  startTs: number;
  endTs: number;
}) {
  const feeRate = FEE_BPS_PER_SIDE / 10_000;
  const slipRate = SLIPPAGE_BPS_PER_SIDE / 10_000;
  const indexes = Object.fromEntries(Object.entries(input.data.bySymbol).map(([s, rows]) => [s, new Map(rows.map((r, i) => [r.ts, i]))]));
  let balance = STARTING_EQUITY, peak = STARTING_EQUITY, maxDrawdownPct = 0;
  const trades: Array<Record<string, number | string>> = [];
  const pnls: number[] = [];
  for (const trade of input.original.trades) {
    const rows = input.data.bySymbol[trade.symbol] ?? [];
    const idx = indexes[trade.symbol] as Map<number, number> | undefined;
    const entryTs = trade.entryTs + DELAY_HOURS * HOUR;
    const exitTs = trade.exitTs + DELAY_HOURS * HOUR;
    const ei = idx?.get(entryTs), xi = idx?.get(exitTs);
    if (ei == null || xi == null) throw new Error(`DELAY_FILL_MISSING:${trade.symbol}:${entryTs}:${exitTs}`);
    const er = rows[ei]?.open, xr = rows[xi]?.open;
    if (!(er > 0) || !(xr > 0)) throw new Error(`DELAY_BAD_PRICE:${trade.symbol}`);
    const dir = trade.side === "long" ? 1 : -1;
    const entryPrice = er * (trade.side === "long" ? 1 + slipRate : 1 - slipRate);
    const exitPrice = xr * (trade.side === "long" ? 1 - slipRate : 1 + slipRate);
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
      const row = rows[i]; if (!row || row.ts > exitTs) break;
      const accrued = notional * fundingRateBetween(input.data.fundingBySymbol[trade.symbol] ?? [], entryTs, row.ts) * dir;
      const unreal = dir * qty * (row.close - entryPrice);
      const exitReserve = qty * row.close * feeRate;
      const equity = Math.max(0, before - entryFee - accrued + unreal - exitReserve);
      peak = Math.max(peak, equity);
      maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? (peak - equity) / peak * 100 : 100);
    }
    balance = Math.max(0, before + netPnl);
    peak = Math.max(peak, balance);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? (peak - balance) / peak * 100 : 100);
    pnls.push(netPnl);
    trades.push({ symbol: trade.symbol, side: trade.side, netPnl, entryTs, exitTs, balanceBefore: before, balanceAfter: balance });
  }
  const years = (input.endTs - input.startTs) / (365.25 * 24 * HOUR);
  return {
    trades: trades.length,
    endingEquity: balance,
    returnPct: (balance / STARTING_EQUITY - 1) * 100,
    cagrPct: (Math.pow(balance / STARTING_EQUITY, 1 / years) - 1) * 100,
    maxDrawdownPct,
    profitFactor: pf(pnls),
    profitFactorWithoutBest: pfWithoutBest(pnls),
    winRatePct: pnls.length ? pnls.filter((x) => x > 0).length / pnls.length * 100 : 0,
    replayTrades: trades,
  };
}
function bySymbol(trades: Array<Record<string, number | string>>) {
  const out: Record<string, { trades: number; netPnl: number; grossProfit: number; grossLoss: number; pf: number }> = {};
  for (const t of trades) {
    const s = String(t.symbol), p = Number(t.netPnl);
    const x = out[s] ?? { trades: 0, netPnl: 0, grossProfit: 0, grossLoss: 0, pf: 0 };
    x.trades += 1; x.netPnl += p; if (p > 0) x.grossProfit += p; if (p < 0) x.grossLoss += -p; out[s] = x;
  }
  for (const x of Object.values(out)) x.pf = x.grossLoss > 0 ? x.grossProfit / x.grossLoss : x.grossProfit > 0 ? 99 : 0;
  return out;
}
function summary(r: PerpBacktestResult) {
  return { cagrPct: r.metrics.cagrPct, maxDrawdownPct: r.metrics.maxDrawdownPct, profitFactor: r.metrics.profitFactor, tradeCount: r.metrics.tradeCount, winRatePct: r.metrics.winRatePct, endingEquity: r.risk.endingEquity, maximumEffectiveLeverage: r.risk.maximumEffectiveLeverage, liquidationCount: r.risk.liquidationCount };
}

async function main() {
  if (FULL_UNIVERSE.includes("PENGU")) throw new Error("PENGU_MUST_BE_EXCLUDED");
  const data = await loadPerpMarketData({ symbols: FULL_UNIVERSE, startTs: WARMUP_START, endTs: END + 2 * HOUR });

  // Phase 1: Development only. V/E are not touched before universe is frozen.
  const baselineDev = runPerpBacktest({ genome: FROZEN, data, window: w("development", START, DEV_END), execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
  if (Math.abs(baselineDev.metrics.cagrPct - 106.21179473771285) > 1e-8 || baselineDev.metrics.tradeCount !== 269) {
    throw new Error(`NO_PENGU_BASELINE_REPRO_FAIL:${baselineDev.metrics.cagrPct}:${baselineDev.metrics.tradeCount}`);
  }
  const baselineDevDelay = delayedReplay({ original: baselineDev, data, startTs: START, endTs: DEV_END });
  const devLatencyBySymbol = bySymbol(baselineDevDelay.replayTrades);
  const excludedSymbols = FULL_UNIVERSE.filter((s) => (devLatencyBySymbol[s]?.netPnl ?? 0) < 0);
  const frozenUniverse = FULL_UNIVERSE.filter((s) => !excludedSymbols.includes(s));
  if (!frozenUniverse.length) throw new Error("PRUNE_REMOVED_ALL_SYMBOLS");

  // Freeze exactly once from predeclared rule: Development delayed-stress netPnL < 0.
  const pruned: PerpStrategyGenome = { ...FROZEN, id: "bp11-0015-no-pengu-dev-latency-pruned", symbols: [...frozenUniverse] };

  // Phase 2: only now touch Validation/Evaluation.
  const periods = {
    development: [START, DEV_END],
    validation: [DEV_END, VAL_END],
    evaluation: [VAL_END, END],
  } as const;
  const normal: Record<string, ReturnType<typeof summary>> = {};
  const delayed: Record<string, Omit<ReturnType<typeof delayedReplay>, "replayTrades">> = {};
  for (const [label, [startTs, endTs]] of Object.entries(periods)) {
    const r = runPerpBacktest({ genome: pruned, data, window: w(label, startTs, endTs), execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
    normal[label] = summary(r);
    const d = delayedReplay({ original: r, data, startTs, endTs });
    const { replayTrades: _omit, ...ds } = d; delayed[label] = ds;
  }
  const combined = runPerpBacktest({ genome: pruned, data, window: w("combined3y", START, END), execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
  const engineStress = runPerpBacktest({ genome: pruned, data, window: w("combined3y-stress", START, END), execution: ENGINE_STRESS, targetMonthlyReturnPct: TARGET_MONTHLY });
  const delayedCombinedRaw = delayedReplay({ original: combined, data, startTs: START, endTs: END });
  const delayedCombinedBySymbol = bySymbol(delayedCombinedRaw.replayTrades);
  const { replayTrades: _omitCombined, ...delayedCombined } = delayedCombinedRaw;

  const annualNormal = [normal.development.cagrPct, normal.validation.cagrPct, normal.evaluation.cagrPct];
  const annualDelay = [delayed.development.cagrPct, delayed.validation.cagrPct, delayed.evaluation.cagrPct];
  const checks = {
    penguExcluded: !frozenUniverse.includes("PENGU"),
    pruneRuleExact: excludedSymbols.every((s) => (devLatencyBySymbol[s]?.netPnl ?? 0) < 0) && FULL_UNIVERSE.filter((s) => (devLatencyBySymbol[s]?.netPnl ?? 0) < 0).length === excludedSymbols.length,
    normalEveryPeriodAtLeast80: annualNormal.every((x) => x >= 80),
    normal3YCagrAtLeast100: combined.metrics.cagrPct >= 100,
    normalPfAtLeast1p40: combined.metrics.profitFactor >= 1.40,
    normalDDAtMost40: combined.metrics.maxDrawdownPct <= 40,
    delayedEveryPeriodPositive: annualDelay.every((x) => x > 0),
    delayed3YCagrAtLeast45: delayedCombined.cagrPct >= 45,
    delayedPfAtLeast1p08: delayedCombined.profitFactor >= 1.08,
    delayedPfWithoutBestAtLeast1: delayedCombined.profitFactorWithoutBest >= 1,
    delayedDDAtMost50: delayedCombined.maxDrawdownPct <= 50,
    maxLeverageAtMost1: combined.risk.maximumEffectiveLeverage <= 1.000001,
    zeroLiquidations: combined.risk.liquidationCount === 0,
  };

  const out = {
    researchLine: "V26_NO_PENGU_DEV_LATENCY_NEGATIVE_SYMBOL_PRUNE",
    researchOnly: true, productionChanged: false, vpsChanged: false, liveChanged: false, realTradingEnabled: false, liveEligible: false,
    freshOosRead: false, freshOosConsumed: false,
    selectionProtocol: {
      selectionData: "Development 2023-07-01 <= t < 2024-07-01 only",
      stress: { delayHours: 1, feeBpsPerSide: FEE_BPS_PER_SIDE, slippageBpsPerSide: SLIPPAGE_BPS_PER_SIDE },
      pruneRule: "exclude every symbol with Development delayed-stress netPnl < 0; no ranking, no threshold, no V/E input",
      validationReadOnlyAfterUniverseFrozen: true,
      evaluationReadOnlyAfterUniverseFrozen: true,
    },
    baselineDevelopment: { normal: summary(baselineDev), delayed: { ...baselineDevDelay, replayTrades: undefined }, delayedBySymbol: devLatencyBySymbol },
    excludedSymbols,
    frozenUniverse,
    frozenGenome: pruned,
    normal,
    combined3Y: summary(combined),
    engineStressNoLatency: summary(engineStress),
    delayedStress: { periods: delayed, combined3Y: delayedCombined, combinedBySymbol: delayedCombinedBySymbol },
    checks,
    candidatePass: Object.values(checks).every(Boolean),
  };
  const root = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "v26-no-pengu-dev-latency-prune.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
