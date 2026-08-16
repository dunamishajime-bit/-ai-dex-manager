import fs from "fs/promises";
import path from "path";

import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import type { Candle1h } from "../lib/backtest/types";

const HOUR = 60 * 60 * 1000;
const BAR_HOURS = 12;
const BAR_MS = BAR_HOURS * HOUR;
const REBALANCE_BARS = 7; // 84H
const LOOKBACK = 50;
const MOM_BARS = 20;
const NORMAL_BPS = 10;
const STRESS_BPS = 30;
const STRESS_DELAY_HOURS = 1;
const START = Date.UTC(2023, 6, 1);
const DEV_END = Date.UTC(2024, 6, 1);
const VAL_END = Date.UTC(2025, 6, 1);
const END = Date.UTC(2026, 6, 1);
const SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "PENGU"] as const;

type SymbolName = typeof SYMBOLS[number];
type Bar12 = { ts: number; open: number; high: number; low: number; close: number; volume: number };
type Feature = { close: number; sma50: number; momentum20: number; normalizedMomentum20: number };
type Trade = {
  symbol: SymbolName;
  side: "LONG";
  sideSign: 1;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  grossReturnPct: number;
  netReturnPct: number;
  entryScore: number;
  exitReason: string;
  holdingHours: number;
};

function mean(xs: number[]) { return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length); }
function sd(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}
function median(xs: number[]) {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}
function pf(vals: number[]) {
  const g = vals.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const l = Math.abs(vals.filter((x) => x < 0).reduce((a, b) => a + b, 0));
  if (l <= 1e-12) return g > 0 ? 999 : null;
  return g / l;
}

function resample12h(rows: Candle1h[]): Bar12[] {
  const buckets = new Map<number, Candle1h[]>();
  for (const row of rows) {
    const bucket = Math.floor(row.ts / BAR_MS) * BAR_MS;
    const list = buckets.get(bucket) ?? [];
    list.push(row); buckets.set(bucket, list);
  }
  const out: Bar12[] = [];
  for (const [bucket, list0] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const list = [...list0].sort((a, b) => a.ts - b.ts);
    if (list.length < 10) continue;
    // Decision timestamp is the next 12H boundary, after the complete bar.
    out.push({
      ts: bucket + BAR_MS,
      open: list[0].open,
      high: Math.max(...list.map((r) => r.high)),
      low: Math.min(...list.map((r) => r.low)),
      close: list.at(-1)!.close,
      volume: list.reduce((s, r) => s + (r.volume ?? 0), 0),
    });
  }
  return out;
}

function buildFeatures(bars: Bar12[]) {
  const out = new Map<number, Feature>();
  const closes = bars.map((b) => b.close);
  const ret: number[] = [0];
  for (let i = 1; i < bars.length; i++) ret.push(closes[i - 1] > 0 ? closes[i] / closes[i - 1] - 1 : 0);
  for (let i = LOOKBACK - 1; i < bars.length; i++) {
    if (i < MOM_BARS) continue;
    const sma50 = mean(closes.slice(i - LOOKBACK + 1, i + 1));
    const momentum20 = closes[i] / closes[i - MOM_BARS] - 1;
    const vol20 = sd(ret.slice(i - MOM_BARS + 1, i + 1));
    const normalizedMomentum20 = vol20 > 1e-12 ? momentum20 / (vol20 * Math.sqrt(MOM_BARS)) : 0;
    out.set(bars[i].ts, { close: closes[i], sma50, momentum20, normalizedMomentum20 });
  }
  return out;
}

function hourlyIndex(rows: Candle1h[]) { return new Map(rows.map((r, i) => [r.ts, i])); }

function metric(trades: Trade[], start: number, end: number, maxDDPct: number) {
  const vals = trades.map((t) => t.netReturnPct);
  let eq = 1;
  for (const v of vals) eq *= Math.max(0.000001, 1 + v / 100);
  const years = (end - start) / (365.25 * 24 * HOUR);
  const cagrPct = (eq ** (1 / years) - 1) * 100;
  const wo = [...vals];
  if (wo.length) wo.splice(wo.indexOf(Math.max(...wo)), 1);
  const wins = vals.filter((v) => v > 0);
  const contribution = Object.fromEntries(SYMBOLS.map((s) => [s, trades.filter((t) => t.symbol === s).reduce((a, t) => a + t.netReturnPct, 0)]));
  return {
    trades: trades.length,
    returnPct: (eq - 1) * 100,
    cagrPct,
    pf: pf(vals),
    pfWithoutBest: pf(wo),
    maxDDPct,
    winRatePct: vals.length ? vals.filter((v) => v > 0).length / vals.length * 100 : null,
    medianTradePct: median(vals),
    bestWinningTradeShareOfGrossWins: wins.length ? Math.max(...wins) / wins.reduce((a, b) => a + b, 0) : 0,
    symbolContributionPctPoints: contribution,
    exitReasons: Object.fromEntries([...new Set(trades.map((t) => t.exitReason))].sort().map((r) => [r, trades.filter((t) => t.exitReason === r).length])),
  };
}

function gate(combined: ReturnType<typeof metric>, stress: ReturnType<typeof metric>, annual: Record<string, ReturnType<typeof metric>>, annualStress: Record<string, ReturnType<typeof metric>>) {
  const annualVals = Object.values(annual).map((x) => x.returnPct);
  const stressVals = Object.values(annualStress).map((x) => x.returnPct);
  const checks = {
    everyAnnualAtLeast80: annualVals.every((x) => x >= 80),
    medianAnnualAtLeast100: median(annualVals) >= 100,
    cagrAtLeast100: combined.cagrPct >= 100,
    pfAtLeast1p40: (combined.pf ?? 0) >= 1.40,
    pfWithoutBestAtLeast1p25: (combined.pfWithoutBest ?? 0) >= 1.25,
    maxDDNoWorseThan40: combined.maxDDPct >= -40,
    tradesAtLeast24: combined.trades >= 24,
    stressCagrAtLeast45: stress.cagrPct >= 45,
    stressPfAtLeast1p08: (stress.pf ?? 0) >= 1.08,
    stressPfWithoutBestAtLeast1: (stress.pfWithoutBest ?? 0) >= 1.0,
    stressDDNoWorseThan50: stress.maxDDPct >= -50,
    atLeastTwoStressPositiveYears: stressVals.filter((x) => x > 0).length >= 2,
    worstStressYearAboveMinus25: Math.min(...stressVals) > -25,
  };
  return { checks, historicalCandidatePass: Object.values(checks).every(Boolean) };
}

async function simulate(input: {
  data: Awaited<ReturnType<typeof loadPerpMarketData>>;
  features: Record<string, Map<number, Feature>>;
  start: number; end: number; costBps: number; delayHours: number;
}) {
  const { data, features, start, end, costBps, delayHours } = input;
  const indexes = Object.fromEntries(SYMBOLS.map((s) => [s, hourlyIndex(data.bySymbol[s] ?? [])])) as Record<SymbolName, Map<number, number>>;
  const decisionTs = [...features.BTC.keys()].filter((ts) => ts >= start && ts < end).sort((a, b) => a - b);
  let equity = 1; let peak = 1; let maxDD = 0;
  let position: { symbol: SymbolName; entryTs: number; entryPrice: number; entryScore: number; entryEquity: number } | null = null;
  const trades: Trade[] = [];

  const updateMtm = (ts: number) => {
    if (!position) { peak = Math.max(peak, equity); maxDD = Math.min(maxDD, (equity / peak - 1) * 100); return; }
    const idx = indexes[position.symbol].get(ts - HOUR);
    if (idx == null) return;
    const px = data.bySymbol[position.symbol][idx].close;
    const mtm = position.entryEquity * Math.max(0.000001, px / position.entryPrice);
    peak = Math.max(peak, mtm); maxDD = Math.min(maxDD, (mtm / peak - 1) * 100);
  };

  const closeAt = (ts: number, reason: string) => {
    if (!position) return;
    const execTs = ts + delayHours * HOUR;
    const idx = indexes[position.symbol].get(execTs);
    if (idx == null) return;
    const px = data.bySymbol[position.symbol][idx].open;
    const gross = (px / position.entryPrice - 1) * 100;
    const net = gross - costBps / 100;
    equity = position.entryEquity * Math.max(0.000001, 1 + net / 100);
    trades.push({ symbol: position.symbol, side: "LONG", sideSign: 1, entryTs: position.entryTs, exitTs: execTs, entryPrice: position.entryPrice, exitPrice: px, grossReturnPct: gross, netReturnPct: net, entryScore: position.entryScore, exitReason: reason, holdingHours: Math.round((execTs - position.entryTs) / HOUR) });
    position = null;
    peak = Math.max(peak, equity); maxDD = Math.min(maxDD, (equity / peak - 1) * 100);
  };

  const openAt = (ts: number, desired: { symbol: SymbolName; score: number } | null) => {
    if (!desired) return;
    const execTs = ts + delayHours * HOUR;
    const idx = indexes[desired.symbol].get(execTs);
    if (idx == null) return;
    const px = data.bySymbol[desired.symbol][idx].open;
    position = { symbol: desired.symbol, entryTs: execTs, entryPrice: px, entryScore: desired.score, entryEquity: equity };
  };

  for (const ts of decisionTs) {
    updateMtm(ts);
    if ((ts - START) % (REBALANCE_BARS * BAR_MS) !== 0) continue;
    const available: Array<{ symbol: SymbolName; f: Feature }> = [];
    for (const symbol of SYMBOLS) {
      const f = features[symbol]?.get(ts);
      if (f) available.push({ symbol, f });
    }
    if (available.length < 6) continue;
    const aligned = available.filter(({ f }) => f.close > f.sma50 && f.momentum20 > 0);
    const majorityLong = aligned.length > available.length / 2;
    const ranked = majorityLong
      ? aligned.map(({ symbol, f }) => ({ symbol, score: f.normalizedMomentum20 })).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
      : [];

    if (position && majorityLong) {
      const rank = ranked.findIndex((r) => r.symbol === position!.symbol) + 1;
      if (rank > 0 && rank <= 2) continue;
    }
    const desired = ranked[0] ?? null;
    if (!position && !desired) continue;
    if (position && desired?.symbol === position.symbol) continue;
    if (position) closeAt(ts, desired ? "SCHEDULED_ROTATION" : "SCHEDULED_TO_CASH");
    if (!position && desired) openAt(ts, desired);
  }

  if (position) {
    const rows = data.bySymbol[position.symbol].filter((r) => r.ts >= start && r.ts < end);
    const last = rows.at(-1);
    if (last) {
      const gross = (last.close / position.entryPrice - 1) * 100;
      const net = gross - costBps / 100;
      equity = position.entryEquity * Math.max(0.000001, 1 + net / 100);
      trades.push({ symbol: position.symbol, side: "LONG", sideSign: 1, entryTs: position.entryTs, exitTs: last.ts, entryPrice: position.entryPrice, exitPrice: last.close, grossReturnPct: gross, netReturnPct: net, entryScore: position.entryScore, exitReason: "PERIOD_END", holdingHours: Math.round((last.ts - position.entryTs) / HOUR) });
      position = null;
    }
  }
  return { metric: metric(trades, start, end, maxDD), trades };
}

async function main() {
  const data = await loadPerpMarketData({ symbols: [...SYMBOLS], startTs: START - 40 * 24 * HOUR, endTs: END });
  const bars = Object.fromEntries(SYMBOLS.map((s) => [s, resample12h(data.bySymbol[s] ?? [])])) as Record<SymbolName, Bar12[]>;
  const features = Object.fromEntries(SYMBOLS.map((s) => [s, buildFeatures(bars[s])])) as Record<SymbolName, Map<number, Feature>>;
  const periods = { development: [START, DEV_END], validation: [DEV_END, VAL_END], evaluation: [VAL_END, END] } as const;
  const annual: Record<string, ReturnType<typeof metric>> = {};
  const annualStress: Record<string, ReturnType<typeof metric>> = {};
  for (const [label, [start, end]] of Object.entries(periods)) {
    annual[label] = (await simulate({ data, features, start, end, costBps: NORMAL_BPS, delayHours: 0 })).metric;
    annualStress[label] = (await simulate({ data, features, start, end, costBps: STRESS_BPS, delayHours: STRESS_DELAY_HOURS })).metric;
  }
  const combinedRun = await simulate({ data, features, start: START, end: END, costBps: NORMAL_BPS, delayHours: 0 });
  const stressRun = await simulate({ data, features, start: START, end: END, costBps: STRESS_BPS, delayHours: STRESS_DELAY_HOURS });
  const historicalGate = gate(combinedRun.metric, stressRun.metric, annual, annualStress);
  const coverage = Object.fromEntries(SYMBOLS.map((s) => [s, { hourlyBars: data.bySymbol[s]?.filter((r) => r.ts >= START && r.ts < END).length ?? 0, firstTs: data.bySymbol[s]?.[0]?.ts ?? null, lastTs: data.bySymbol[s]?.at(-1)?.ts ?? null }]));
  const out = {
    researchLine: "PORTFOLIO_PROFIT_ENGINE_V23_DYNAMIC_UNIVERSE_OWNERSHIP",
    researchOnly: true, productionChanged: false, vpsChanged: false, liveChanged: false, realTradingEnabled: false, liveEligible: false,
    freshOosRead: false, freshOosConsumed: false, freshOosPermission: historicalGate.historicalCandidatePass,
    target: { main3YCagrPct: 100, progressFloorCagrPct: 80, grossExposureCapPct: 100, leverageMultiplier: 1.0 },
    architecture: "Dynamic available universe -> strict-majority 12H long breadth -> strongest normalized 20-bar momentum -> globally anchored 84H ownership/top2 retention",
    universe: SYMBOLS,
    dynamicListingPolicy: "symbol participates only after its own 50 completed 12H bars; no backfill before listing",
    antiOverfit: { parameterGrid: false, perSymbolParameters: false, yearSpecificParameters: false, validationUsedForSelection: false, evaluationUsedForSelection: false, freshOosUsedForTuning: false, leverageUsedToReachTarget: false },
    costs: { normalTotalBpsPerRoundTrip: NORMAL_BPS, stressTotalBpsPerRoundTrip: STRESS_BPS, stressExtraDelayHours: STRESS_DELAY_HOURS },
    periods, coverage, annual, annualStress, combined3Y: combinedRun.metric, combined3YStress: stressRun.metric, historicalGate,
  };
  const root = process.env.RESEARCH_STATE_DIR || ".research-state";
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "portfolio-profit-engine-v23.json"), JSON.stringify(out, null, 2), "utf8");
  await fs.writeFile(path.join(root, "portfolio-profit-engine-v23-trades.jsonl"), combinedRun.trades.map((t) => JSON.stringify(t)).join("\n") + "\n", "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
