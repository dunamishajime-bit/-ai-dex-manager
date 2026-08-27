import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";
import {
  buildPenguDualLsV2EvaluationSeries,
  evaluatePenguDualLsV2PositionBar,
  targetGrossForAtr,
  type PenguDualLsV2History,
  type PenguDualLsV2Position,
  type PenguDualLsV2EvaluationRow,
} from "../lib/pengu-dual-ls-v2";
import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";

const HOUR = 3_600_000;
const WARM_START = Date.parse("2024-12-17T00:00:00Z");
const EVAL_START = Date.parse("2024-12-24T00:00:00Z");
const EVAL_END = Date.parse("2026-08-01T00:00:00Z");
const BASE_URL = "https://api.bybit.com";
const BASE_FEE_PER_SIDE = 0.0006;
const STRESS_SLIPPAGE_PER_SIDE = 0.0035;

type Mode = "normal" | "stress";
type Side = "L" | "S";

interface FundingPoint {
  fundingTime: number;
  fundingRate: number;
}

interface Trade {
  kind: "BASE" | "REENTRY";
  side: Side;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  requestedGross: number;
  accountReturn: number;
  netUnitReturn: number;
  entryAtr24Ratio: number;
  btcEma168Distance: number;
  btcReturn24h: number;
  progressFail?: boolean;
  reentryFrom?: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bybit(pathname: string, query: Record<string, string>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const url = new URL(pathname, BASE_URL);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "DisDex-PENGU-V11-Holdout/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
      const json = await response.json() as any;
      if (json?.retCode !== 0 || !Array.isArray(json?.result?.list)) {
        throw new Error(`Bybit retCode=${json?.retCode} retMsg=${json?.retMsg}`);
      }
      return json.result.list as any[];
    } catch (error) {
      lastError = error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function downloadCandles(symbol: string) {
  const byTs = new Map<number, DisDexV35Candle>();
  let end = EVAL_END - 1;
  let previousOldest = Number.POSITIVE_INFINITY;
  for (let page = 0; page < 40 && end >= WARM_START; page += 1) {
    const list = await bybit("/v5/market/kline", {
      category: "linear",
      symbol,
      interval: "60",
      start: String(WARM_START),
      end: String(end),
      limit: "1000",
    });
    if (!list.length) break;
    let oldest = Number.POSITIVE_INFINITY;
    for (const row of list) {
      const ts = Number(row[0]);
      oldest = Math.min(oldest, ts);
      if (ts < WARM_START || ts >= EVAL_END) continue;
      byTs.set(ts, {
        openTime: ts,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: ts + HOUR - 1,
      });
    }
    if (!(oldest < previousOldest)) break;
    previousOldest = oldest;
    end = oldest - 1;
    await sleep(80);
  }
  const rows = [...byTs.values()].sort((a, b) => a.openTime - b.openTime);
  if (rows.length < 5_000) throw new Error(`Insufficient ${symbol} H1 rows=${rows.length}`);
  return rows;
}

async function downloadFunding() {
  const byTs = new Map<number, FundingPoint>();
  let end = EVAL_END - 1;
  let previousOldest = Number.POSITIVE_INFINITY;
  for (let page = 0; page < 80 && end >= WARM_START; page += 1) {
    const list = await bybit("/v5/market/funding/history", {
      category: "linear",
      symbol: "PENGUUSDT",
      endTime: String(end),
      limit: "200",
    });
    if (!list.length) break;
    let oldest = Number.POSITIVE_INFINITY;
    for (const row of list) {
      const ts = Number(row.fundingRateTimestamp);
      const rate = Number(row.fundingRate);
      oldest = Math.min(oldest, ts);
      if (ts >= WARM_START && ts < EVAL_END && Number.isFinite(rate)) {
        byTs.set(ts, { fundingTime: ts, fundingRate: rate });
      }
    }
    if (!(oldest < previousOldest)) break;
    previousOldest = oldest;
    end = oldest - 1;
    await sleep(80);
  }
  const rows = [...byTs.values()].sort((a, b) => a.fundingTime - b.fundingTime);
  if (rows.length < 100) throw new Error(`Insufficient PENGUUSDT funding rows=${rows.length}`);
  return rows;
}

function fundingBetween(points: FundingPoint[], start: number, end: number) {
  return points
    .filter((point) => point.fundingTime > start && point.fundingTime <= end)
    .reduce((sum, point) => sum + point.fundingRate, 0);
}

function replayBaseline(rows: PenguDualLsV2EvaluationRow[], funding: FundingPoint[], mode: Mode) {
  const trades: Trade[] = [];
  const costPerSide = BASE_FEE_PER_SIDE + (mode === "stress" ? STRESS_SLIPPAGE_PER_SIDE : 0);
  let index = 250;
  let cooldownUntil = -1;

  while (index < rows.length - 2) {
    if (index <= cooldownUntil) { index += 1; continue; }
    const side: Side | undefined = rows[index].shortSignal ? "S" : rows[index].longSignal ? "L" : undefined;
    const signalFeatures = rows[index].features;
    if (!side || !signalFeatures) { index += 1; continue; }

    const entryIndex = index + 1;
    const entry = rows[entryIndex].candle;
    const gross = targetGrossForAtr(signalFeatures.atr24Ratio);
    let position: PenguDualLsV2Position = {
      side: side === "L" ? 1 : -1,
      entryTs: entry.openTime,
      entryPrice: entry.open,
      quantity: 1,
      gross,
      highWaterMark: entry.open,
      lowWaterMark: entry.open,
    };
    const hold = side === "L" ? PENGU_DUAL_LS_V2.long.maxHoldHours : PENGU_DUAL_LS_V2.short.maxHoldHours;
    const last = Math.min(rows.length - 1, entryIndex + hold - 1);
    let exitIndex = last;
    let exitPrice = rows[last].candle.close;

    for (let cursor = entryIndex; cursor <= last; cursor += 1) {
      const features = rows[cursor].features;
      assert(features);
      const evaluation = evaluatePenguDualLsV2PositionBar(position, features);
      position = evaluation.updatedPosition;
      if (evaluation.exit) {
        exitIndex = cursor;
        exitPrice = evaluation.exit.stopPrice ?? rows[cursor].candle.close;
        break;
      }
    }

    if (entry.openTime >= EVAL_START && entry.openTime < EVAL_END) {
      const exitTs = rows[exitIndex].candle.openTime;
      const raw = side === "L" ? exitPrice / entry.open - 1 : entry.open / exitPrice - 1;
      const fundingReturn = fundingBetween(funding, entry.openTime, exitTs);
      const net = raw + (side === "L" ? -fundingReturn : fundingReturn) - 2 * costPerSide;
      trades.push({
        kind: "BASE",
        side,
        entryTs: entry.openTime,
        exitTs,
        entryPrice: entry.open,
        exitPrice,
        requestedGross: gross,
        accountReturn: gross * net,
        netUnitReturn: net,
        entryAtr24Ratio: signalFeatures.atr24Ratio,
        btcEma168Distance: signalFeatures.btcEma168Distance,
        btcReturn24h: signalFeatures.btcReturn24h,
      });
    }
    cooldownUntil = exitIndex + PENGU_DUAL_LS_V2.cooldownHours;
    index = exitIndex + 1;
  }
  return trades;
}

function nextBaselineEntry(baseline: Trade[], timestamp: number) {
  return baseline.find((trade) => trade.entryTs > timestamp)?.entryTs;
}

function transformShort(
  trade: Trade,
  baseline: Trade[],
  rows: PenguDualLsV2EvaluationRow[],
  funding: FundingPoint[],
  mode: Mode,
  rowIndex: Map<number, number>,
) {
  if (trade.side !== "S") return [trade];

  const counterwind = trade.btcEma168Distance >= 0 || trade.btcReturn24h >= 0;
  if (!counterwind) return [trade];

  const entryIndex = rowIndex.get(trade.entryTs);
  const originalExitIndex = rowIndex.get(trade.exitTs);
  assert(entryIndex !== undefined && originalExitIndex !== undefined);

  const unit = Math.min(trade.entryAtr24Ratio, PENGU_DUAL_LS_V2.short.hardStopPct / 2);
  const arm = unit;
  const goal = Math.min(2 * unit, PENGU_DUAL_LS_V2.short.hardStopPct);
  const failLevel = unit / 2;
  const costPerSide = BASE_FEE_PER_SIDE + (mode === "stress" ? STRESS_SLIPPAGE_PER_SIDE : 0);

  let armed = false;
  let progressed = false;
  let lowWater = trade.entryPrice;
  let failureExitIndex = -1;

  for (let cursor = entryIndex; cursor < originalExitIndex; cursor += 1) {
    const bar = rows[cursor].candle;
    lowWater = Math.min(lowWater, bar.low);
    const mfe = 1 - lowWater / trade.entryPrice;
    if (!armed && !progressed && mfe >= arm) armed = true;
    if (armed && mfe >= goal) { progressed = true; armed = false; }
    if (armed && !progressed && (1 - bar.close / trade.entryPrice) <= failLevel && cursor + 1 <= originalExitIndex) {
      failureExitIndex = cursor + 1;
      break;
    }
  }

  if (failureExitIndex < 0) return [trade];

  const failureExit = rows[failureExitIndex].candle;
  const failureExitTs = failureExit.openTime;
  const firstRaw = trade.entryPrice / failureExit.open - 1;
  const firstFunding = fundingBetween(funding, trade.entryTs, failureExitTs);
  const firstNet = firstRaw + firstFunding - 2 * costPerSide;
  const firstLeg: Trade = {
    ...trade,
    exitTs: failureExitTs,
    exitPrice: failureExit.open,
    accountReturn: trade.requestedGross * firstNet,
    netUnitReturn: firstNet,
    progressFail: true,
  };

  const nextBaseEntry = nextBaselineEntry(baseline, failureExitTs);
  let reentryIndex = -1;
  for (let cursor = failureExitIndex; cursor < Math.min(rows.length - 1, failureExitIndex + PENGU_DUAL_LS_V2.short.maxHoldHours); cursor += 1) {
    const features = rows[cursor].features;
    if (!features) continue;
    if (nextBaseEntry !== undefined && rows[cursor].candle.openTime >= nextBaseEntry) break;
    if (rows[cursor].candle.close < lowWater && rows[cursor].candle.close < features.ema72) {
      reentryIndex = cursor + 1;
      break;
    }
  }

  if (reentryIndex < 0 || reentryIndex >= rows.length) return [firstLeg];
  const reentry = rows[reentryIndex].candle;
  if (nextBaseEntry !== undefined && reentry.openTime >= nextBaseEntry) return [firstLeg];

  const reSignalFeatures = rows[reentryIndex - 1].features;
  assert(reSignalFeatures);
  const gross = targetGrossForAtr(reSignalFeatures.atr24Ratio);
  let position: PenguDualLsV2Position = {
    side: -1,
    entryTs: reentry.openTime,
    entryPrice: reentry.open,
    quantity: 1,
    gross,
    highWaterMark: reentry.open,
    lowWaterMark: reentry.open,
  };
  const last = Math.min(rows.length - 1, reentryIndex + PENGU_DUAL_LS_V2.short.maxHoldHours - 1);
  let exitIndex = last;
  let exitPrice = rows[last].candle.close;

  for (let cursor = reentryIndex; cursor <= last; cursor += 1) {
    if (nextBaseEntry !== undefined && rows[cursor].candle.openTime >= nextBaseEntry) {
      exitIndex = cursor;
      exitPrice = rows[cursor].candle.open;
      break;
    }
    const features = rows[cursor].features;
    if (!features) continue;
    const evaluation = evaluatePenguDualLsV2PositionBar(position, features);
    position = evaluation.updatedPosition;
    if (evaluation.exit) {
      exitIndex = cursor;
      exitPrice = evaluation.exit.stopPrice ?? rows[cursor].candle.close;
      break;
    }
  }

  const exitTs = rows[exitIndex].candle.openTime;
  const raw = reentry.open / exitPrice - 1;
  const fundingReturn = fundingBetween(funding, reentry.openTime, exitTs);
  const net = raw + fundingReturn - 2 * costPerSide;
  const reentryTrade: Trade = {
    kind: "REENTRY",
    side: "S",
    entryTs: reentry.openTime,
    exitTs,
    entryPrice: reentry.open,
    exitPrice,
    requestedGross: gross,
    accountReturn: gross * net,
    netUnitReturn: net,
    entryAtr24Ratio: reSignalFeatures.atr24Ratio,
    btcEma168Distance: reSignalFeatures.btcEma168Distance,
    btcReturn24h: reSignalFeatures.btcReturn24h,
    reentryFrom: trade.entryTs,
  };
  return [firstLeg, reentryTrade];
}

function metrics(trades: Trade[]) {
  let equity = 1, peak = 1, maxDrawdown = 0, grossProfit = 0, grossLoss = 0;
  for (const trade of [...trades].sort((a, b) => a.exitTs - b.exitTs)) {
    equity *= 1 + trade.accountReturn;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    if (trade.accountReturn > 0) grossProfit += trade.accountReturn;
    else grossLoss -= trade.accountReturn;
  }
  return {
    trades: trades.length,
    wins: trades.filter((trade) => trade.accountReturn > 0).length,
    returnPct: (equity - 1) * 100,
    winRatePct: trades.length ? trades.filter((trade) => trade.accountReturn > 0).length / trades.length * 100 : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdownPct: maxDrawdown * 100,
    progressionFailures: trades.filter((trade) => trade.progressFail).length,
    reentries: trades.filter((trade) => trade.kind === "REENTRY").length,
  };
}

function foldName(timestamp: number) {
  const ratio = (timestamp - EVAL_START) / (EVAL_END - EVAL_START);
  return ratio < 0.25 ? "Q1" : ratio < 0.5 ? "Q2" : ratio < 0.75 ? "Q3" : "Q4";
}

function removeBestReentry(baseline: Trade[], candidate: Trade[]) {
  const reentries = candidate.filter((trade) => trade.kind === "REENTRY");
  if (!reentries.length) return { returnDeltaPct: metrics(candidate).returnPct - metrics(baseline).returnPct, removed: null };
  let best = reentries[0];
  for (const trade of reentries) if (trade.accountReturn > best.accountReturn) best = trade;
  const reduced = candidate.filter((trade) => trade !== best);
  return {
    returnDeltaPct: metrics(reduced).returnPct - metrics(baseline).returnPct,
    removed: { entryTs: best.entryTs, accountReturn: best.accountReturn },
  };
}

async function main() {
  const [pengu, btc, funding] = await Promise.all([downloadCandles("PENGUUSDT"), downloadCandles("BTCUSDT"), downloadFunding()]);
  const btcByTs = new Map(btc.map((candle) => [candle.openTime, candle]));
  const alignedBtc = pengu.map((candle) => btcByTs.get(candle.openTime)).filter(Boolean) as DisDexV35Candle[];
  assert.equal(alignedBtc.length, pengu.length);

  const history: PenguDualLsV2History = { pengu1h: pengu, btc1h: alignedBtc, penguFunding: funding };
  const rows = buildPenguDualLsV2EvaluationSeries(history, EVAL_END + HOUR);
  const rowIndex = new Map(rows.map((row, index) => [row.candle.openTime, index]));
  const output: any = {
    status: "PASS_RESEARCH_ONLY",
    schema: "pengu-short-v11-bybit-holdout/v1",
    preRegistrationSha: "64b22dad74d1c026b2146d41d39cc8a3d3a819e3",
    preRegisteredCandidate: {
      name: "COUNTERWIND_PROGRESS_FAIL_REENTRY",
      candidateCount: 1,
      thresholdSweep: false,
      entryFiltering: false,
      baseOpportunityRemoval: false,
    },
    data: {
      venue: "Bybit",
      period: [new Date(EVAL_START).toISOString(), new Date(EVAL_END).toISOString()],
      penguRows: pengu.length,
      btcRows: btc.length,
      fundingRows: funding.length,
    },
    results: {},
    safety: { mode: "RESEARCH_ONLY", ordersSent: false, liveChanged: false, vpsChanged: false, productionChanged: false },
  };

  for (const mode of ["normal", "stress"] as Mode[]) {
    const baseline = replayBaseline(rows, funding, mode);
    const candidate = baseline.flatMap((trade) => transformShort(trade, baseline, rows, funding, mode, rowIndex));
    const folds: any = {};
    for (const fold of ["Q1", "Q2", "Q3", "Q4"]) {
      folds[fold] = {
        baseline: metrics(baseline.filter((trade) => foldName(trade.entryTs) === fold)),
        candidate: metrics(candidate.filter((trade) => foldName(trade.entryTs) === fold)),
      };
    }
    output.results[mode.toUpperCase()] = {
      BASELINE: metrics(baseline),
      CANDIDATE: metrics(candidate),
      FOLDS: folds,
      withoutBestReentry: removeBestReentry(baseline, candidate),
    };
  }

  const normal = output.results.NORMAL, stress = output.results.STRESS;
  const base = normal.BASELINE, candidate = normal.CANDIDATE;
  const stressBase = stress.BASELINE, stressCandidate = stress.CANDIDATE;
  const foldsNonWorseWinRate = ["Q1", "Q2", "Q3", "Q4"].filter((fold) =>
    (normal.FOLDS[fold].candidate.winRatePct ?? 0) >= (normal.FOLDS[fold].baseline.winRatePct ?? 0));
  const foldsNonWorseReturn = ["Q1", "Q2", "Q3", "Q4"].filter((fold) =>
    normal.FOLDS[fold].candidate.returnPct >= normal.FOLDS[fold].baseline.returnPct);

  output.promotion = {
    pass: base.trades >= 20
      && candidate.trades >= base.trades
      && candidate.reentries >= 2
      && (candidate.winRatePct ?? 0) >= (base.winRatePct ?? 0) + 5
      && candidate.returnPct >= base.returnPct
      && (candidate.profitFactor ?? 0) >= (base.profitFactor ?? 0)
      && candidate.maxDrawdownPct >= base.maxDrawdownPct
      && stressCandidate.returnPct >= stressBase.returnPct
      && (stressCandidate.profitFactor ?? 0) >= (stressBase.profitFactor ?? 0)
      && stressCandidate.maxDrawdownPct >= stressBase.maxDrawdownPct
      && normal.withoutBestReentry.returnDeltaPct >= 0
      && stress.withoutBestReentry.returnDeltaPct >= 0
      && foldsNonWorseWinRate.length >= 3
      && foldsNonWorseReturn.length >= 3,
    foldsNonWorseWinRate,
    foldsNonWorseReturn,
  };

  const outputPath = process.env.PENGU_V11_OUT || ".research-state/pengu-short-v11-bybit/result.json";
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
