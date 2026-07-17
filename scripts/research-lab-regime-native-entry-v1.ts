import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Candle1h } from "../lib/backtest/types";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import type { PerpFundingPoint, PerpMarketData } from "../lib/research-lab/perp/types";

const HOUR = 3_600_000;
const SYMBOLS = ["ETH", "BNB", "SOL", "AVAX", "LINK"];
const START = Date.UTC(2025, 6, 1);
const END = Date.UTC(2026, 3, 7);
const DATA_START = Date.UTC(2025, 5, 1);
const DATA_END = Date.UTC(2026, 4, 1);
const FEE_BPS = 6;
const SLIPPAGE_BPS = 4;
const STRESS_SLIPPAGE_BPS = 12;

type Side = "long" | "short";
type Family = "pullback" | "breakout" | "range";
type Model = {
  id: string;
  families: Family[];
  slow: 72 | 168;
  strict: boolean;
};
type Exit = { id: string; hold: number; stopAtr: number; takeAtr: number };
type Candidate = {
  symbol: string;
  side: Side;
  family: Family;
  signalTs: number;
  entryIndex: number;
  entryTs: number;
  atr: number;
  score: number;
};
type Trade = {
  symbol: string;
  side: Side;
  family: Family;
  entryTs: number;
  exitTs: number;
  hours: number;
  pnl: number;
  stressPnl: number;
};
type Metrics = {
  count: number;
  winRatePct: number | null;
  averagePct: number | null;
  medianPct: number | null;
  profitFactor: number | null;
  stressProfitFactor: number | null;
  stressAveragePct: number | null;
  compoundedReturnPct: number | null;
  maxDrawdownPct: number | null;
  bestPct: number | null;
  worstPct: number | null;
  averageHoldingHours: number | null;
  longCount: number;
  shortCount: number;
  symbolCounts: Record<string, number>;
  familyCounts: Record<string, number>;
};
type Evaluation = {
  modelId: string;
  exit: Exit;
  rawCandidates: number;
  metrics: Metrics;
};
type Selected = {
  development: Evaluation;
  validation: Evaluation;
  retentionRatio: number;
  score: number;
};

const r = (value: number, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const med = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const sd = (values: number[]) => {
  if (values.length < 2) return 0;
  const mean = avg(values);
  return Math.sqrt(avg(values.map((value) => (value - mean) ** 2)));
};

function indexAtOrBefore(candles: Candle1h[], ts: number) {
  let low = 0;
  let high = candles.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].ts <= ts) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

function meanClose(candles: Candle1h[], end: number, bars: number) {
  if (end - bars + 1 < 0) return null;
  return avg(candles.slice(end - bars + 1, end + 1).map((bar) => bar.close));
}
function momentum(candles: Candle1h[], end: number, bars: number) {
  const prior = end - bars;
  return prior >= 0 && candles[prior].close > 0 ? ((candles[end].close / candles[prior].close) - 1) * 100 : null;
}
function atr(candles: Candle1h[], end: number, bars = 24) {
  if (end - bars + 1 < 1) return null;
  const values: number[] = [];
  for (let i = end - bars + 1; i <= end; i += 1) {
    const previous = candles[i - 1].close;
    values.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - previous), Math.abs(candles[i].low - previous)));
  }
  return avg(values);
}
function high(candles: Candle1h[], start: number, end: number) {
  return start < 0 ? null : Math.max(...candles.slice(start, end + 1).map((bar) => bar.high));
}
function low(candles: Candle1h[], start: number, end: number) {
  return start < 0 ? null : Math.min(...candles.slice(start, end + 1).map((bar) => bar.low));
}
function volumeRatio(candles: Candle1h[], end: number) {
  if (end < 168) return null;
  const recent = avg(candles.slice(end - 23, end + 1).map((bar) => bar.volume));
  const base = avg(candles.slice(end - 167, end - 23).map((bar) => bar.volume));
  return base > 0 ? recent / base : null;
}
function zscore(candles: Candle1h[], end: number, bars: number) {
  if (end - bars + 1 < 0) return null;
  const values = candles.slice(end - bars + 1, end + 1).map((bar) => bar.close);
  const deviation = sd(values);
  return deviation > 0 ? (candles[end].close - avg(values)) / deviation : 0;
}
function funding(points: PerpFundingPoint[], start: number, end: number) {
  return points.filter((point) => point.ts >= start && point.ts <= end).reduce((sum, point) => sum + point.rate * 100, 0);
}

function modelList(): Model[] {
  const sets: Family[][] = [["pullback"], ["breakout"], ["pullback", "breakout"], ["range"], ["pullback", "breakout", "range"]];
  return [72, 168].flatMap((slow) => [false, true].flatMap((strict) => sets.map((families) => ({
    id: `${families.join("_").toUpperCase()}_${slow}_${strict ? "STRICT" : "BALANCED"}`,
    families,
    slow: slow as 72 | 168,
    strict,
  }))));
}
function exitList(): Exit[] {
  const result: Exit[] = [];
  for (const hold of [24, 48, 72]) for (const stopAtr of [1.25, 1.75]) for (const takeAtr of [2, 3, 4]) {
    result.push({ id: `ATR_TP${takeAtr}_SL${stopAtr}_${hold}H`, hold, stopAtr, takeAtr });
  }
  return result;
}

function candidates(data: PerpMarketData, model: Model, startTs: number, endTs: number) {
  const result: Candidate[] = [];
  const btc = data.bySymbol.BTC || [];
  const fastBars = model.slow === 72 ? 24 : 48;
  const momentumBars = model.slow === 72 ? 72 : 168;
  const breakoutBars = model.slow === 72 ? 48 : 72;
  const rangeBars = model.slow === 72 ? 48 : 72;
  const minMomentum = model.strict ? (model.slow === 72 ? 1 : 2) : 0;
  const minRelative = model.strict ? 1 : 0;
  const minVolume = model.strict ? 1.1 : 0.9;
  const rangeLimit = model.strict ? 3 : 5;
  const rangeZ = model.strict ? 1.75 : 1.5;
  const breakoutBuffer = model.strict ? 0.15 : 0;
  const warmup = Math.max(192, model.slow + 2, momentumBars + 2);

  for (const symbol of SYMBOLS) {
    const bars = data.bySymbol[symbol] || [];
    for (let i = warmup; i < bars.length - 1; i += 1) {
      const bar = bars[i];
      if (bar.ts < startTs || bar.ts > endTs || Math.floor(bar.ts / HOUR) % 6 !== 0) continue;
      const btcIndex = indexAtOrBefore(btc, bar.ts);
      if (btcIndex < warmup) continue;
      const symbolFast = meanClose(bars, i, fastBars);
      const symbolSlow = meanClose(bars, i, model.slow);
      const btcFast = meanClose(btc, btcIndex, fastBars);
      const btcSlow = meanClose(btc, btcIndex, model.slow);
      const symbolMomentum = momentum(bars, i, momentumBars);
      const btcMomentum = momentum(btc, btcIndex, momentumBars);
      const volatility = atr(bars, i);
      const volume = volumeRatio(bars, i);
      if ([symbolFast, symbolSlow, btcFast, btcSlow, symbolMomentum, btcMomentum, volatility, volume].some((value) => value == null)) continue;
      const sf = symbolFast!;
      const ss = symbolSlow!;
      const bf = btcFast!;
      const bs = btcSlow!;
      const sm = symbolMomentum!;
      const bm = btcMomentum!;
      const a = volatility!;
      const vr = volume!;
      const relative = sm - bm;
      const previous = bars[i - 1];
      const common = { symbol, signalTs: bar.ts, entryIndex: i + 1, entryTs: bars[i + 1].ts, atr: a };
      const emit = (side: Side, family: Family, score: number) => result.push({ ...common, side, family, score: r(score, 6) });
      const longTrend = bar.close > ss && sf > ss && btc[btcIndex].close > bs && bf > bs && sm >= minMomentum && bm >= minMomentum && relative >= minRelative;
      const shortTrend = bar.close < ss && sf < ss && btc[btcIndex].close < bs && bf < bs && sm <= -minMomentum && bm <= -minMomentum && relative <= -minRelative;

      if (model.families.includes("pullback") && vr >= minVolume) {
        const recentLow = low(bars, i - (model.strict ? 17 : 11), i);
        const recentHigh = high(bars, i - (model.strict ? 17 : 11), i);
        const tolerance = a * (model.strict ? 0.25 : 0.5);
        if (longTrend && recentLow != null && recentLow <= sf && recentLow >= ss - tolerance && bar.close > sf && bar.close > previous.high) {
          emit("long", "pullback", Math.max(0, bm) + Math.max(0, sm) + Math.max(0, relative) + vr * 2);
        }
        if (shortTrend && recentHigh != null && recentHigh >= sf && recentHigh <= ss + tolerance && bar.close < sf && bar.close < previous.low) {
          emit("short", "pullback", Math.max(0, -bm) + Math.max(0, -sm) + Math.max(0, -relative) + vr * 2);
        }
      }
      if (model.families.includes("breakout") && vr >= minVolume) {
        const priorHigh = high(bars, i - breakoutBars, i - 1);
        const priorLow = low(bars, i - breakoutBars, i - 1);
        if (longTrend && priorHigh != null && bar.close > priorHigh + a * breakoutBuffer) {
          emit("long", "breakout", ((bar.close - priorHigh) / a) * 4 + Math.max(0, relative) + vr * 3);
        }
        if (shortTrend && priorLow != null && bar.close < priorLow - a * breakoutBuffer) {
          emit("short", "breakout", ((priorLow - bar.close) / a) * 4 + Math.max(0, -relative) + vr * 3);
        }
      }
      if (model.families.includes("range") && vr >= minVolume && Math.abs(bm) <= rangeLimit && Math.abs(sm) <= rangeLimit + 2) {
        const priorZ = zscore(bars, i - 1, rangeBars);
        if (priorZ != null && priorZ <= -rangeZ && bar.close > previous.close && bar.close > bar.open) emit("long", "range", Math.abs(priorZ) * 4 + vr);
        if (priorZ != null && priorZ >= rangeZ && bar.close < previous.close && bar.close < bar.open) emit("short", "range", Math.abs(priorZ) * 4 + vr);
      }
    }
  }
  return result.sort((a, b) => a.signalTs - b.signalTs || b.score - a.score);
}

function simulate(candidate: Candidate, exit: Exit, data: PerpMarketData): Trade | null {
  const bars = data.bySymbol[candidate.symbol] || [];
  const entry = bars[candidate.entryIndex];
  if (!entry || entry.ts !== candidate.entryTs || entry.open <= 0) return null;
  const stop = candidate.side === "long" ? entry.open - candidate.atr * exit.stopAtr : entry.open + candidate.atr * exit.stopAtr;
  const take = candidate.side === "long" ? entry.open + candidate.atr * exit.takeAtr : entry.open - candidate.atr * exit.takeAtr;
  const last = Math.min(bars.length - 1, candidate.entryIndex + exit.hold - 1);
  if (last <= candidate.entryIndex) return null;
  let exitIndex = last;
  let price = bars[last].close;
  for (let i = candidate.entryIndex; i <= last; i += 1) {
    const stopHit = candidate.side === "long" ? bars[i].low <= stop : bars[i].high >= stop;
    const takeHit = candidate.side === "long" ? bars[i].high >= take : bars[i].low <= take;
    if (stopHit) { exitIndex = i; price = stop; break; }
    if (takeHit) { exitIndex = i; price = take; break; }
  }
  const exitTs = bars[exitIndex].ts + HOUR - 1;
  const gross = candidate.side === "long" ? ((price / entry.open) - 1) * 100 : ((entry.open / price) - 1) * 100;
  const fundingCost = funding(data.fundingBySymbol[candidate.symbol] || [], candidate.entryTs, exitTs) * (candidate.side === "long" ? 1 : -1);
  return {
    symbol: candidate.symbol,
    side: candidate.side,
    family: candidate.family,
    entryTs: candidate.entryTs,
    exitTs,
    hours: Math.max(1, Math.ceil((exitTs - candidate.entryTs + 1) / HOUR)),
    pnl: gross - ((FEE_BPS + SLIPPAGE_BPS) * 2) / 100 - fundingCost,
    stressPnl: gross - ((FEE_BPS + STRESS_SLIPPAGE_BPS) * 2) / 100 - fundingCost,
  };
}

function metrics(trades: Trade[]): Metrics {
  const values = trades.map((trade) => trade.pnl);
  const stress = trades.map((trade) => trade.stressPnl);
  const wins = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);
  const stressWins = stress.filter((value) => value > 0);
  const stressLosses = stress.filter((value) => value < 0);
  const pf = losses.length ? wins.reduce((sum, value) => sum + value, 0) / Math.abs(losses.reduce((sum, value) => sum + value, 0)) : wins.length ? 999 : null;
  const stressPf = stressLosses.length ? stressWins.reduce((sum, value) => sum + value, 0) / Math.abs(stressLosses.reduce((sum, value) => sum + value, 0)) : stressWins.length ? 999 : null;
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  for (const value of values) {
    equity *= Math.max(0.001, 1 + value / 100);
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, ((equity / peak) - 1) * 100);
  }
  const countBy = (key: "symbol" | "family") => trades.reduce<Record<string, number>>((result, trade) => {
    result[trade[key]] = (result[trade[key]] || 0) + 1;
    return result;
  }, {});
  return {
    count: values.length,
    winRatePct: values.length ? r((wins.length / values.length) * 100, 2) : null,
    averagePct: values.length ? r(avg(values)) : null,
    medianPct: values.length ? r(med(values)) : null,
    profitFactor: pf == null ? null : r(pf, 3),
    stressProfitFactor: stressPf == null ? null : r(stressPf, 3),
    stressAveragePct: stress.length ? r(avg(stress)) : null,
    compoundedReturnPct: values.length ? r((equity - 1) * 100) : null,
    maxDrawdownPct: values.length ? r(drawdown) : null,
    bestPct: values.length ? r(Math.max(...values)) : null,
    worstPct: values.length ? r(Math.min(...values)) : null,
    averageHoldingHours: trades.length ? r(avg(trades.map((trade) => trade.hours)), 2) : null,
    longCount: trades.filter((trade) => trade.side === "long").length,
    shortCount: trades.filter((trade) => trade.side === "short").length,
    symbolCounts: countBy("symbol"),
    familyCounts: countBy("family"),
  };
}

function evaluate(raw: Candidate[], model: Model, exit: Exit, data: PerpMarketData, maxExitTs: number): Evaluation {
  const trades: Trade[] = [];
  let busyUntil = -Infinity;
  for (let i = 0; i < raw.length;) {
    const ts = raw[i].signalTs;
    const sameTime: Candidate[] = [];
    while (i < raw.length && raw[i].signalTs === ts) sameTime.push(raw[i++]);
    if (ts <= busyUntil) continue;
    const eligible = sameTime.filter((candidate) => candidate.entryTs + exit.hold * HOUR - 1 <= maxExitTs);
    if (!eligible.length) continue;
    const trade = simulate(eligible.sort((a, b) => b.score - a.score)[0], exit, data);
    if (trade) { trades.push(trade); busyUntil = trade.exitTs; }
  }
  return { modelId: model.id, exit, rawCandidates: raw.length, metrics: metrics(trades) };
}

const devPass = (item: Evaluation) => item.metrics.count >= 12 && (item.metrics.averagePct ?? -1) > 0
  && (item.metrics.profitFactor ?? 0) >= 1.15 && (item.metrics.stressProfitFactor ?? 0) >= 1
  && (item.metrics.maxDrawdownPct ?? -100) >= -35;
const valPass = (dev: Evaluation, val: Evaluation) => {
  const retention = (dev.metrics.averagePct ?? 0) > 0 ? (val.metrics.averagePct ?? -1) / dev.metrics.averagePct! : -1;
  return val.metrics.count >= 6 && (val.metrics.averagePct ?? -1) > 0 && (val.metrics.profitFactor ?? 0) >= 1.05
    && (val.metrics.stressProfitFactor ?? 0) >= 1 && (val.metrics.maxDrawdownPct ?? -100) >= -30 && retention >= 0.2;
};
const holdoutPass = (item: Evaluation | null) => Boolean(item && item.metrics.count >= 6 && (item.metrics.averagePct ?? -1) > 0
  && (item.metrics.profitFactor ?? 0) >= 1 && (item.metrics.stressProfitFactor ?? 0) >= 1 && (item.metrics.maxDrawdownPct ?? -100) >= -30);
const devScore = (item: Evaluation) => (item.metrics.compoundedReturnPct ?? -9999) + Math.min(5, item.metrics.profitFactor ?? 0) * 4
  + Math.min(5, item.metrics.stressProfitFactor ?? 0) * 4 - Math.abs(item.metrics.maxDrawdownPct ?? -100) * 0.4;
const selectScore = (dev: Evaluation, val: Evaluation) => Math.min(dev.metrics.averagePct ?? -10, val.metrics.averagePct ?? -10) * 12
  + Math.min(dev.metrics.profitFactor ?? 0, val.metrics.profitFactor ?? 0) * 5
  + Math.min(dev.metrics.stressProfitFactor ?? 0, val.metrics.stressProfitFactor ?? 0) * 5
  + (val.metrics.compoundedReturnPct ?? -100) - Math.abs(val.metrics.maxDrawdownPct ?? -100) * 0.35;

function table(items: Evaluation[]) {
  return [
    "| Model | Exit | Raw | N | L/S | Win | Avg | Median | PF | Stress PF | Compound | DD |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...items.map((item) => `| ${item.modelId} | ${item.exit.id} | ${item.rawCandidates} | ${item.metrics.count} | ${item.metrics.longCount}/${item.metrics.shortCount} | ${item.metrics.winRatePct?.toFixed(2) ?? "—"}% | ${item.metrics.averagePct?.toFixed(2) ?? "—"}% | ${item.metrics.medianPct?.toFixed(2) ?? "—"}% | ${item.metrics.profitFactor?.toFixed(2) ?? "—"} | ${item.metrics.stressProfitFactor?.toFixed(2) ?? "—"} | ${item.metrics.compoundedReturnPct?.toFixed(2) ?? "—"}% | ${item.metrics.maxDrawdownPct?.toFixed(2) ?? "—"}% |`),
  ].join("\n");
}

async function main() {
  const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR || ".research-state");
  const data = await loadPerpMarketData({ symbols: ["BTC", ...SYMBOLS], startTs: DATA_START, endTs: DATA_END });
  const models = modelList();
  const exits = exitList();
  const developmentEnd = START + Math.floor((END - START) * 0.5);
  const validationEnd = START + Math.floor((END - START) * 0.75);
  const ranges = {
    development: { start: START, end: developmentEnd },
    validation: { start: developmentEnd + 1, end: validationEnd },
    holdout: { start: validationEnd + 1, end: END },
    all: { start: START, end: END },
  };
  const cache = new Map<string, Candidate[]>();
  const getCandidates = (model: Model, range: { start: number; end: number }) => {
    const key = `${model.id}:${range.start}:${range.end}`;
    if (!cache.has(key)) cache.set(key, candidates(data, model, range.start, range.end));
    return cache.get(key)!;
  };

  const development: Evaluation[] = [];
  for (const model of models) for (const exit of exits) development.push(evaluate(getCandidates(model, ranges.development), model, exit, data, ranges.development.end));
  const shortlist = development.filter(devPass).sort((a, b) => devScore(b) - devScore(a)).slice(0, 40);
  const validated: Selected[] = [];
  for (const dev of shortlist) {
    const model = models.find((item) => item.id === dev.modelId)!;
    const val = evaluate(getCandidates(model, ranges.validation), model, dev.exit, data, ranges.validation.end);
    if (!valPass(dev, val)) continue;
    validated.push({
      development: dev,
      validation: val,
      retentionRatio: r((val.metrics.averagePct ?? 0) / dev.metrics.averagePct!, 4),
      score: r(selectScore(dev, val), 6),
    });
  }
  validated.sort((a, b) => b.score - a.score);
  const chosen = validated[0] ?? null;
  const chosenModel = chosen ? models.find((item) => item.id === chosen.validation.modelId)! : null;
  const holdout = chosen && chosenModel ? evaluate(getCandidates(chosenModel, ranges.holdout), chosenModel, chosen.validation.exit, data, ranges.holdout.end) : null;
  const all = chosen && chosenModel ? evaluate(getCandidates(chosenModel, ranges.all), chosenModel, chosen.validation.exit, data, ranges.all.end) : null;
  const passed = holdoutPass(holdout);
  const status = !shortlist.length ? "NO_DEVELOPMENT_EDGE" : !chosen ? "NO_ROBUST_IMPROVEMENT" : passed ? "PAPER_CANDIDATE_ONLY" : "HOLDOUT_REJECTED";
  const liveReasons = holdout ? [
    ...(holdout.metrics.count < 100 ? ["Frozen Holdout 100 trades未満"] : []),
    ...SYMBOLS.filter((symbol) => (holdout.metrics.symbolCounts[symbol] || 0) < 30).map((symbol) => `${symbol} OOS ${holdout.metrics.symbolCounts[symbol] || 0}/30 trades`),
    ...((holdout.metrics.winRatePct ?? 0) < 70 ? ["Frozen Holdout勝率70%未達"] : []),
    ...((holdout.metrics.profitFactor ?? 0) < 1.2 ? ["Frozen Holdout PF1.20未達"] : []),
    "Aster実約定Spread/Slippage未検証",
    "Forward Paper未実施",
  ] : ["Validation通過候補なし", "Forward Paper未実施"];
  const fingerprint = createHash("sha256").update(JSON.stringify({
    source: data.source,
    ranges,
    models,
    exits,
    bars: ["BTC", ...SYMBOLS].map((symbol) => [symbol, data.bySymbol[symbol]?.length || 0, data.bySymbol[symbol]?.[0]?.ts, data.bySymbol[symbol]?.at(-1)?.ts]),
  })).digest("hex");
  const selected = chosen ? {
    strategyId: "REGIME_NATIVE_ENTRY_V1",
    modelId: chosen.validation.modelId,
    exit: chosen.validation.exit,
    development: chosen.development,
    validation: chosen.validation,
    retentionRatio: chosen.retentionRatio,
    frozenHoldout: holdout,
    all,
    holdoutPass: passed,
    paperEligible: passed,
    liveGatePassed: false,
    liveGateReasons: liveReasons,
  } : null;
  const limitations = [
    "同一2025-07-01〜2026-04-07期間内の時系列分割で、完全な将来Forward OOSではありません。",
    "Aster過去Order BookではなくBinance USD-M 1h OHLCV/Fundingを使用しています。",
    "既存WIN80 Signalは使わず、次足Open Entry・同時保有なしTop1として評価しています。",
    "同一足でTP/SLが両方到達した場合は保守的にSL先行です。",
    "多重検定リスクはValidationと一度だけのFrozen Holdoutで抑制しますが、完全には消えません。",
    "本番コード、runner、VPS、.env、実売買フラグは変更していません。",
  ];
  const result = {
    version: 1,
    generatedAt: new Date().toISOString(),
    strategyId: "REGIME_NATIVE_ENTRY_V1",
    status,
    productionChanged: false,
    realTradingEnabled: false,
    source: {
      fingerprint,
      split: ranges,
      symbols: SYMBOLS,
      signalIntervalHours: 6,
      independentFromWin80Signals: true,
      oneGlobalPositionAtATime: true,
      entryAtNextBarOpen: true,
      models: models.length,
      exits: exits.length,
      combinations: models.length * exits.length,
      developmentPassCount: shortlist.length,
      validationPassCount: validated.length,
      frozenHoldoutEvaluated: Boolean(chosen),
    },
    selected,
    developmentTop10: shortlist.slice(0, 10),
    validationTop10: validated.slice(0, 10),
    limitations,
  };
  const report = [
    "# REGIME_NATIVE_ENTRY_V1 Research",
    "",
    `- Status: **${status}**`,
    `- Models / exits / combinations: ${models.length} / ${exits.length} / ${models.length * exits.length}`,
    `- Development pass: ${shortlist.length}`,
    `- Validation pass: ${validated.length}`,
    `- Frozen Holdout evaluated: ${chosen ? "YES" : "NO"}`,
    "- Production changed: NO",
    "- Real trading: DISABLED",
    "",
    "## Architecture",
    "",
    "- Existing WIN80 signal timestamps are not used.",
    "- 1h OHLCV/Funding, 6h decisions, next-bar-open entry.",
    "- Pullback reclaim, confirmed breakout, and neutral-range reversal are separate families.",
    "- One global Top1 position at a time; Development → Validation → one-time Frozen Holdout.",
    "",
    "## Selected",
    "",
    ...(selected ? [
      `- Model: **${selected.modelId}**`,
      `- Exit: **${selected.exit.id}**`,
      `- Validation retention: **${selected.retentionRatio.toFixed(2)}**`,
      `- Frozen Holdout pass: **${selected.holdoutPass ? "YES" : "NO"}**`,
      "- Live gate: **BLOCKED**",
      `- Reasons: ${selected.liveGateReasons.join(" / ")}`,
      "",
      table([selected.development, selected.validation, selected.frozenHoldout!, selected.all!]),
      "",
      `- Holdout symbols: ${JSON.stringify(selected.frozenHoldout?.metrics.symbolCounts || {})}`,
      `- Holdout families: ${JSON.stringify(selected.frozenHoldout?.metrics.familyCounts || {})}`,
    ] : ["Development/Validationを連続通過した独立Entry候補はありませんでした。"]),
    "",
    "## Development top",
    "",
    shortlist.length ? table(shortlist.slice(0, 10)) : "Development通過候補なし。",
    "",
    "## Validation top",
    "",
    validated.length ? table(validated.slice(0, 10).map((item) => item.validation)) : "Validation通過候補なし。",
    "",
    "## Conclusion",
    "",
    status === "PAPER_CANDIDATE_ONLY"
      ? "独立Entry構造でFrozen Holdoutまで通過したPaper専用候補が残りました。Liveは引き続き禁止です。"
      : status === "HOLDOUT_REJECTED"
        ? "Development/Validation通過候補はFrozen Holdoutで棄却されました。Paper・Live採用は禁止です。"
        : "独立Entry構造でもValidationを安定通過する候補は確認できませんでした。Paper・Live採用は禁止です。",
    "",
    "## Limitations",
    "",
    ...limitations.map((item) => `- ${item}`),
  ].join("\n");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "regime-native-entry-v1.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "regime-native-entry-v1.md"), report, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n\n${report}`, "utf8");
  console.log(report);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
