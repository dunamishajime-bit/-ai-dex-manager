import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";
import {
  buildPenguDualLsV2EvaluationSeries,
  evaluatePenguDualLsV2PositionBar,
  targetGrossForAtr,
  type PenguDualLsV2EvaluationRow,
  type PenguDualLsV2Features,
  type PenguDualLsV2History,
  type PenguDualLsV2Position,
} from "../lib/pengu-dual-ls-v2";
import {
  createPenguShortV20State,
  classifyPenguShortV20SizingState,
} from "../lib/pengu-short-v20";
import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";

const HOUR = 3_600_000;
const WARM_START = Date.parse("2025-07-01T00:00:00Z");
const EVAL_START = Date.parse("2025-08-10T00:00:00Z");
const EVAL_END = Date.parse("2026-08-10T00:00:00Z");
const HOLDOUT_CUTOFF = EVAL_START + Math.floor((EVAL_END - EVAL_START) * 2 / 3);
const BASE_URL = "https://fapi.asterdex.com";
const BASE_FEE_PER_SIDE = 0.0006;
const STRESS_ADVERSE_SLIPPAGE_PER_SIDE = 0.0035;
const OUTPUT_DIR = process.env.PENGU_DIAG_OUTPUT_DIR || ".research-state/pengu-v56-v20-diagnostics";
const SOURCE_SHA = process.env.PRODUCTION_SOURCE_SHA || "a76fd7aaa0788209532a5a2c6489135dd8e4a27e";

type Mode = "normal" | "stress";
type Side = "L" | "S";
type LongMode = "EDGE" | "RAW_REENTRY";
type ExitGroup = "hard" | "trail" | "time";
type NumericFeatureKey =
  | "atr24Ratio"
  | "btcEma168Distance"
  | "btcReturn24h"
  | "penguReturn24h"
  | "penguReturn72h"
  | "relativeReturn24h"
  | "volumeRatio6OverPrior36"
  | "rsi14"
  | "requestedGross";

type VetoRule = { feature: NumericFeatureKey; op: "gte" | "lte"; threshold: number };

interface FundingPoint { fundingTime: number; fundingRate: number }
interface RichTrade {
  side: Side;
  signalTs: number;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  requestedGross: number;
  rawUnitReturn: number;
  fundingUnitReturn: number;
  costUnitReturn: number;
  netUnitReturn: number;
  accountReturn: number;
  exitReason: ExitGroup;
  engineExitReason: string;
  sizingState?: string;
  counterwind?: boolean;
  entryFeatures: PenguDualLsV2Features;
  mfeUnit: number;
  maeUnit: number;
}

interface ReplayOptions {
  mode: Mode;
  longMode: LongMode;
  shortVeto?: VetoRule | null;
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchJson(url: URL) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "DisDex-PENGU-V56-V20-Diagnostics/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("Aster response is not an array");
      return payload as unknown[];
    } catch (error) {
      lastError = error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error(`Aster download failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function downloadCandles(symbol: string) {
  const rows: unknown[][] = [];
  let cursor = WARM_START;
  while (cursor < EVAL_END) {
    const url = new URL("/fapi/v3/klines", BASE_URL);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", "1h");
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(EVAL_END - 1));
    url.searchParams.set("limit", "1500");
    const batch = await fetchJson(url) as unknown[][];
    if (!batch.length) break;
    rows.push(...batch);
    const next = Number(batch.at(-1)?.[0]) + HOUR;
    if (!(next > cursor)) throw new Error(`${symbol} pagination did not advance`);
    cursor = next;
    await sleep(50);
  }
  const byTs = new Map<number, DisDexV35Candle>();
  for (const raw of rows) {
    const openTime = Number(raw[0]);
    const candle: DisDexV35Candle = {
      openTime,
      open: Number(raw[1]), high: Number(raw[2]), low: Number(raw[3]), close: Number(raw[4]), volume: Number(raw[5]),
      closeTime: Number(raw[6] ?? openTime + HOUR - 1),
    };
    if (openTime >= WARM_START && openTime < EVAL_END && Object.values(candle).every(Number.isFinite)) byTs.set(openTime, candle);
  }
  return [...byTs.values()].sort((a, b) => a.openTime - b.openTime);
}

async function downloadFunding(symbol: string) {
  const rows: FundingPoint[] = [];
  let cursor = WARM_START;
  while (cursor < EVAL_END) {
    const url = new URL("/fapi/v3/fundingRate", BASE_URL);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(EVAL_END - 1));
    url.searchParams.set("limit", "1000");
    const batch = await fetchJson(url) as Array<{ fundingTime?: unknown; fundingRate?: unknown }>;
    if (!batch.length) break;
    for (const raw of batch) {
      const fundingTime = Number(raw.fundingTime);
      const fundingRate = Number(raw.fundingRate);
      if (fundingTime >= WARM_START && fundingTime < EVAL_END && Number.isFinite(fundingRate)) rows.push({ fundingTime, fundingRate });
    }
    const next = Number(batch.at(-1)?.fundingTime) + 1;
    if (!(next > cursor)) throw new Error("funding pagination did not advance");
    cursor = next;
    await sleep(50);
  }
  return [...new Map(rows.map((x) => [x.fundingTime, x])).values()].sort((a, b) => a.fundingTime - b.fundingTime);
}

function fundingBetween(points: FundingPoint[], entryTs: number, exitTs: number) {
  return points.filter((p) => p.fundingTime > entryTs && p.fundingTime <= exitTs).reduce((sum, p) => sum + p.fundingRate, 0);
}

function ruleValue(features: PenguDualLsV2Features, requestedGross: number, key: NumericFeatureKey) {
  return key === "requestedGross" ? requestedGross : Number(features[key]);
}

function vetoed(features: PenguDualLsV2Features, requestedGross: number, rule?: VetoRule | null) {
  if (!rule) return false;
  const value = ruleValue(features, requestedGross, rule.feature);
  return rule.op === "gte" ? value >= rule.threshold : value <= rule.threshold;
}

function metrics(trades: RichTrade[]) {
  let equity = 1, peak = 1, maxDrawdown = 0, grossProfit = 0, grossLoss = 0;
  for (const trade of trades) {
    equity *= 1 + trade.accountReturn;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    if (trade.accountReturn > 0) grossProfit += trade.accountReturn; else grossLoss -= trade.accountReturn;
  }
  return {
    trades: trades.length,
    returnPct: (equity - 1) * 100,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdownPct: maxDrawdown * 100,
    winRatePct: trades.length ? trades.filter((t) => t.accountReturn > 0).length / trades.length * 100 : null,
    hardStops: trades.filter((t) => t.exitReason === "hard").length,
    trailingExits: trades.filter((t) => t.exitReason === "trail").length,
    timeExits: trades.filter((t) => t.exitReason === "time").length,
    longTrades: trades.filter((t) => t.side === "L").length,
    shortTrades: trades.filter((t) => t.side === "S").length,
  };
}

function replay(rows: PenguDualLsV2EvaluationRow[], funding: FundingPoint[], options: ReplayOptions) {
  const trades: RichTrade[] = [];
  const costPerSide = BASE_FEE_PER_SIDE + (options.mode === "stress" ? STRESS_ADVERSE_SLIPPAGE_PER_SIDE : 0);
  let index = 250;
  let cooldown = -1;
  let cooldownSuppressedLongRaw = 0;
  let occupiedSuppressedLongRaw = 0;
  let shortVetoes = 0;
  while (index < rows.length - 2) {
    if (index <= cooldown) {
      if (rows[index].features && rows[index].longRaw) cooldownSuppressedLongRaw += 1;
      index += 1;
      continue;
    }
    const features = rows[index].features;
    if (!features) { index += 1; continue; }
    const longSignal = options.longMode === "RAW_REENTRY" ? rows[index].longRaw : rows[index].longSignal;
    let side: Side | undefined = rows[index].shortSignal ? "S" : longSignal ? "L" : undefined;
    if (!side) { index += 1; continue; }
    const requestedGross = targetGrossForAtr(features.atr24Ratio, side === "L" ? 1 : -1);
    if (side === "S" && vetoed(features, requestedGross, options.shortVeto)) {
      shortVetoes += 1;
      index += 1;
      continue;
    }
    const entryIndex = index + 1;
    const entry = rows[entryIndex].candle;
    let position: PenguDualLsV2Position = {
      side: side === "L" ? 1 : -1,
      entryTs: entry.openTime,
      entryPrice: entry.open,
      quantity: 1,
      gross: requestedGross,
      highWaterMark: entry.open,
      lowWaterMark: entry.open,
      entryVersion: side === "S" ? "SHORT_V20" : "LONG_V2_FINAL",
      shortV20: side === "S" ? createPenguShortV20State({
        entryPrice: entry.open,
        requestedGross,
        entryAtr24Ratio: features.atr24Ratio,
        btcEma168Distance: features.btcEma168Distance,
        btcReturn24h: features.btcReturn24h,
      }) : undefined,
    };
    const initialShortState = position.shortV20 ? { ...position.shortV20 } : undefined;
    const hold = side === "L" ? PENGU_DUAL_LS_V2.long.maxHoldHours : PENGU_DUAL_LS_V2.short.maxHoldHours;
    const last = Math.min(rows.length - 1, entryIndex + hold - 1);
    let exitIndex = last;
    let exitPrice = rows[last].candle.close;
    let engineExitReason = side === "L" ? "LONG_MAX_HOLD" : "SHORT_MAX_HOLD";
    let exitReason: ExitGroup = "time";
    let bestFavorable = 0;
    let worstAdverse = 0;
    for (let cursor = entryIndex; cursor <= last; cursor += 1) {
      const f = rows[cursor].features;
      assert(f, `features missing at ${cursor}`);
      if (side === "L") {
        bestFavorable = Math.max(bestFavorable, f.high / entry.open - 1);
        worstAdverse = Math.min(worstAdverse, f.low / entry.open - 1);
      } else {
        bestFavorable = Math.max(bestFavorable, 1 - f.low / entry.open);
        worstAdverse = Math.min(worstAdverse, 1 - f.high / entry.open);
      }
      const evaluation = evaluatePenguDualLsV2PositionBar(position, f);
      position = evaluation.updatedPosition;
      if (evaluation.exit) {
        exitIndex = cursor;
        exitPrice = evaluation.exit.stopPrice ?? rows[cursor].candle.close;
        engineExitReason = evaluation.exit.reason;
        exitReason = evaluation.exit.reason.includes("HARD") ? "hard" : evaluation.exit.reason.includes("TRAILING") ? "trail" : "time";
        break;
      }
      if (cursor > entryIndex && rows[cursor].longRaw) occupiedSuppressedLongRaw += 1;
    }
    if (entry.openTime >= EVAL_START && entry.openTime < EVAL_END) {
      const exitTs = rows[exitIndex].candle.openTime;
      const rawUnitReturn = side === "L" ? exitPrice / entry.open - 1 : entry.open / exitPrice - 1;
      const fundingRate = fundingBetween(funding, entry.openTime, exitTs);
      const fundingUnitReturn = side === "L" ? -fundingRate : fundingRate;
      const costUnitReturn = -2 * costPerSide;
      const netUnitReturn = rawUnitReturn + fundingUnitReturn + costUnitReturn;
      trades.push({
        side, signalTs: rows[index].candle.openTime, entryTs: entry.openTime, exitTs,
        entryPrice: entry.open, exitPrice, requestedGross, rawUnitReturn, fundingUnitReturn, costUnitReturn, netUnitReturn,
        accountReturn: requestedGross * netUnitReturn, exitReason, engineExitReason,
        sizingState: side === "S" ? classifyPenguShortV20SizingState(requestedGross) : undefined,
        counterwind: initialShortState?.counterwind,
        entryFeatures: { ...features }, mfeUnit: bestFavorable, maeUnit: worstAdverse,
      });
    }
    cooldown = exitIndex + PENGU_DUAL_LS_V2.cooldownHours;
    index = exitIndex + 1;
  }
  return { trades, diagnostics: { shortVetoes, cooldownSuppressedLongRaw, occupiedSuppressedLongRaw } };
}

const longGateOrder = [
  "regime72", "breakout18", "return24", "relative24", "btc24", "rsiMin", "rsiMax", "volumeMin", "volumeMax", "atrMax", "ema168",
] as const;
type LongGate = typeof longGateOrder[number];

function longGatePasses(f: PenguDualLsV2Features): Record<LongGate, boolean> {
  const r = PENGU_DUAL_LS_V2.long;
  return {
    regime72: f.penguReturn72h >= r.regimeReturn72hMinimum,
    breakout18: f.close > f.priorHigh18h,
    return24: f.penguReturn24h >= r.penguReturn24hMinimum,
    relative24: f.relativeReturn24h >= r.relativeReturn24hMinimum,
    btc24: f.btcReturn24h >= r.btcReturn24hMinimum,
    rsiMin: f.rsi14 >= r.rsiMinimum,
    rsiMax: f.rsi14 <= r.rsiMaximum,
    volumeMin: f.volumeRatio6OverPrior36 >= r.volumeRatioMinimum,
    volumeMax: f.volumeRatio6OverPrior36 <= r.volumeRatioMaximum,
    atrMax: f.atr24Ratio <= r.atr24RatioMaximum,
    ema168: f.close > f.ema168,
  };
}

function longDiagnostics(rows: PenguDualLsV2EvaluationRow[]) {
  const evalRows = rows.filter((r) => r.features && r.candle.openTime >= EVAL_START && r.candle.openTime < EVAL_END);
  const standalone = Object.fromEntries(longGateOrder.map((g) => [g, 0])) as Record<LongGate, number>;
  const sequential = Object.fromEntries(longGateOrder.map((g) => [g, { before: 0, after: 0, dropped: 0 }])) as Record<LongGate, {before:number;after:number;dropped:number}>;
  const allButOne = Object.fromEntries(longGateOrder.map((g) => [g, 0])) as Record<LongGate, number>;
  for (const row of evalRows) {
    const p = longGatePasses(row.features!);
    for (const g of longGateOrder) if (p[g]) standalone[g] += 1;
    let alive = true;
    for (const g of longGateOrder) {
      if (!alive) continue;
      sequential[g].before += 1;
      if (p[g]) sequential[g].after += 1;
      else { sequential[g].dropped += 1; alive = false; }
    }
    for (const g of longGateOrder) {
      if (!p[g] && longGateOrder.every((other) => other === g || p[other])) allButOne[g] += 1;
    }
  }
  const episodes: number[] = [];
  let current = 0;
  for (const row of evalRows) {
    if (row.longRaw) current += 1;
    else if (current) { episodes.push(current); current = 0; }
  }
  if (current) episodes.push(current);
  return {
    eligibleFeatureBars: evalRows.length,
    longRawBars: evalRows.filter((r) => r.longRaw).length,
    longEdgeSignals: evalRows.filter((r) => r.longSignal).length,
    edgeSuppressedRawBars: evalRows.filter((r) => r.longRaw && !r.longSignal).length,
    rawEpisodes: episodes.length,
    episodeLengthsHours: episodes,
    episodeMaxHours: episodes.length ? Math.max(...episodes) : 0,
    standalonePassCounts: standalone,
    standalonePassRatesPct: Object.fromEntries(longGateOrder.map((g) => [g, standalone[g] / Math.max(1, evalRows.length) * 100])),
    sequentialDropoff: sequential,
    allButOneNearMissCounts: allButOne,
  };
}

function quantile(values: number[], q: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function cohortSummary(trades: RichTrade[]) {
  const keys: NumericFeatureKey[] = ["atr24Ratio","btcEma168Distance","btcReturn24h","penguReturn24h","penguReturn72h","relativeReturn24h","volumeRatio6OverPrior36","rsi14","requestedGross"];
  const values: Record<string, unknown> = {};
  for (const key of keys) {
    const arr = trades.map((t) => ruleValue(t.entryFeatures, t.requestedGross, key)).filter(Number.isFinite);
    values[key] = { min: arr.length ? Math.min(...arr) : null, q25: quantile(arr,.25), median: quantile(arr,.5), q75: quantile(arr,.75), max: arr.length ? Math.max(...arr) : null };
  }
  return {
    count: trades.length,
    metrics: metrics(trades),
    sizingStates: Object.fromEntries(["CAP","FLOOR","VOL_TARGET"].map((s) => [s, trades.filter((t) => t.sizingState === s).length])),
    counterwind: { true: trades.filter((t) => t.counterwind === true).length, false: trades.filter((t) => t.counterwind === false).length },
    entryFeatures: values,
    mfeMedian: quantile(trades.map((t) => t.mfeUnit), .5),
    maeMedian: quantile(trades.map((t) => t.maeUnit), .5),
  };
}

function sliceByTime(trades: RichTrade[], start: number, end: number) {
  return trades.filter((t) => t.signalTs >= start && t.signalTs < end);
}

function protectedTrailingSignalIds(trades: RichTrade[]) {
  return new Set(trades.filter((t) => t.side === "S" && t.exitReason === "trail" && t.accountReturn > 0).map((t) => t.signalTs));
}

function candidatesFromTraining(trades: RichTrade[]) {
  const keys: NumericFeatureKey[] = ["atr24Ratio","btcEma168Distance","btcReturn24h","penguReturn24h","penguReturn72h","relativeReturn24h","volumeRatio6OverPrior36","rsi14","requestedGross"];
  const out: VetoRule[] = [];
  for (const feature of keys) {
    const vals = [...new Set(trades.map((t) => ruleValue(t.entryFeatures, t.requestedGross, feature)).filter(Number.isFinite))].sort((a,b)=>a-b);
    for (let i=0;i<vals.length-1;i+=1) {
      const threshold = (vals[i]+vals[i+1])/2;
      out.push({ feature, op:"gte", threshold }, { feature, op:"lte", threshold });
    }
  }
  return out;
}

function chooseShortVeto(rows: PenguDualLsV2EvaluationRow[], funding: FundingPoint[], baseline: RichTrade[]) {
  const baselineTrain = sliceByTime(baseline.filter((t)=>t.side==="S"), EVAL_START, HOLDOUT_CUTOFF);
  const baselineHoldout = sliceByTime(baseline.filter((t)=>t.side==="S"), HOLDOUT_CUTOFF, EVAL_END);
  const trainHardIds = new Set(baselineTrain.filter((t)=>t.exitReason==="hard").map((t)=>t.signalTs));
  const trainProtected = protectedTrailingSignalIds(baselineTrain);
  const requiredHardRemoval = Math.max(1, Math.ceil(trainHardIds.size * 0.40));
  const baselineTrainMetrics = metrics(baselineTrain);
  const qualifying: Array<{rule:VetoRule; hardRemoved:number; trainMetrics:ReturnType<typeof metrics>; trainTrades:number}> = [];
  for (const rule of candidatesFromTraining(baselineTrain)) {
    const candidate = replay(rows, funding, {mode:"normal", longMode:"EDGE", shortVeto:rule}).trades;
    const train = sliceByTime(candidate.filter((t)=>t.side==="S"), EVAL_START, HOLDOUT_CUTOFF);
    const ids = new Set(train.map((t)=>t.signalTs));
    if ([...trainProtected].some((id)=>!ids.has(id))) continue;
    const hardRemoved = [...trainHardIds].filter((id)=>!ids.has(id)).length;
    if (hardRemoved < requiredHardRemoval) continue;
    const m = metrics(train);
    if (m.trades < Math.max(5, Math.floor(baselineTrain.length*0.70))) continue;
    if (!(m.returnPct > baselineTrainMetrics.returnPct + 1e-9)) continue;
    if ((m.profitFactor ?? 0) + 1e-9 < (baselineTrainMetrics.profitFactor ?? 0)) continue;
    if (m.maxDrawdownPct + 1e-9 < baselineTrainMetrics.maxDrawdownPct) continue;
    qualifying.push({rule, hardRemoved, trainMetrics:m, trainTrades:train.length});
  }
  qualifying.sort((a,b)=> b.hardRemoved-a.hardRemoved || b.trainMetrics.returnPct-a.trainMetrics.returnPct || (b.trainMetrics.profitFactor??0)-(a.trainMetrics.profitFactor??0));
  const selected = qualifying[0] ?? null;
  if (!selected) return { selected:null, passedHoldout:false, baselineTrain:cohortSummary(baselineTrain), baselineHoldout:cohortSummary(baselineHoldout), qualifyingCount:0 };
  const fullCandidate = replay(rows, funding, {mode:"normal", longMode:"EDGE", shortVeto:selected.rule}).trades;
  const holdout = sliceByTime(fullCandidate.filter((t)=>t.side==="S"), HOLDOUT_CUTOFF, EVAL_END);
  const holdoutIds = new Set(holdout.map((t)=>t.signalTs));
  const holdoutProtected = protectedTrailingSignalIds(baselineHoldout);
  const baseH = metrics(baselineHoldout), candH = metrics(holdout);
  const passedHoldout = [...holdoutProtected].every((id)=>holdoutIds.has(id))
    && candH.returnPct + 1e-9 >= baseH.returnPct
    && (candH.profitFactor ?? 0) + 1e-9 >= (baseH.profitFactor ?? 0) * 0.95
    && candH.maxDrawdownPct + 1e-9 >= baseH.maxDrawdownPct - 0.5
    && candH.hardStops <= baseH.hardStops;
  return {
    selected: { ...selected, holdoutMetrics:candH, baselineHoldoutMetrics:baseH },
    passedHoldout,
    baselineTrain:cohortSummary(baselineTrain), baselineHoldout:cohortSummary(baselineHoldout), qualifyingCount:qualifying.length,
    topTrainingCandidates: qualifying.slice(0,10),
  };
}

function evaluateLongReentry(rows: PenguDualLsV2EvaluationRow[], funding: FundingPoint[], baseline: RichTrade[]) {
  const candidate = replay(rows, funding, {mode:"normal", longMode:"RAW_REENTRY"}).trades;
  const bTrain = sliceByTime(baseline.filter((t)=>t.side==="L"), EVAL_START, HOLDOUT_CUTOFF);
  const cTrain = sliceByTime(candidate.filter((t)=>t.side==="L"), EVAL_START, HOLDOUT_CUTOFF);
  const bHold = sliceByTime(baseline.filter((t)=>t.side==="L"), HOLDOUT_CUTOFF, EVAL_END);
  const cHold = sliceByTime(candidate.filter((t)=>t.side==="L"), HOLDOUT_CUTOFF, EVAL_END);
  const bmT=metrics(bTrain), cmT=metrics(cTrain), bmH=metrics(bHold), cmH=metrics(cHold);
  const trainImproves = cmT.trades >= bmT.trades && cmT.returnPct > bmT.returnPct + 1e-9 && cmT.maxDrawdownPct >= bmT.maxDrawdownPct - 1.0;
  const holdoutPass = cmH.returnPct + 1e-9 >= bmH.returnPct && cmH.maxDrawdownPct >= bmH.maxDrawdownPct - 0.5;
  return { trainImproves, holdoutPass, pass:trainImproves && holdoutPass, baselineTrain:bmT, candidateTrain:cmT, baselineHoldout:bmH, candidateHoldout:cmH, candidateFull:metrics(candidate.filter((t)=>t.side==="L")) };
}

function publicTrade(t: RichTrade) {
  const { entryFeatures, engineExitReason, sizingState, counterwind, mfeUnit, maeUnit, ...ledger } = t;
  return ledger;
}

async function main() {
  assert.equal(PENGU_DUAL_LS_V2.id, "PENGU_DUAL_LS_V2_FINAL");
  const [penguRaw, btcRaw, funding] = await Promise.all([downloadCandles("PENGUUSDT"), downloadCandles("BTCUSDT"), downloadFunding("PENGUUSDT")]);
  const btcByTs = new Set(btcRaw.map((r)=>r.openTime));
  const pengu = penguRaw.filter((r)=>btcByTs.has(r.openTime));
  const penguByTs = new Set(pengu.map((r)=>r.openTime));
  const btc = btcRaw.filter((r)=>penguByTs.has(r.openTime));
  assert.equal(pengu.length, btc.length);
  assert.ok(pengu.length >= 250);
  const history: PenguDualLsV2History = { pengu1h:pengu, btc1h:btc, penguFunding:funding.map((r)=>({...r})) };
  const rows = buildPenguDualLsV2EvaluationSeries(history, EVAL_END + HOUR);

  const baselineNormalReplay = replay(rows,funding,{mode:"normal",longMode:"EDGE"});
  const baselineStressReplay = replay(rows,funding,{mode:"stress",longMode:"EDGE"});
  const baselineNormal = baselineNormalReplay.trades;
  const baselineStress = baselineStressReplay.trades;
  const baselineNormalMetrics = metrics(baselineNormal), baselineStressMetrics = metrics(baselineStress);
  assert.equal(baselineNormalMetrics.trades, 33, `baseline replay drift: ${JSON.stringify(baselineNormalMetrics)}`);
  assert.equal(baselineNormalMetrics.longTrades, 5);
  assert.equal(baselineNormalMetrics.shortTrades, 28);
  assert.ok(Math.abs(baselineNormalMetrics.returnPct - 152.82887236975503) < 0.25, `baseline return drift: ${baselineNormalMetrics.returnPct}`);

  const longDiag = longDiagnostics(rows);
  const shortBaseline = baselineNormal.filter((t)=>t.side==="S");
  const shortHard = shortBaseline.filter((t)=>t.exitReason==="hard");
  const shortTrailingWinners = shortBaseline.filter((t)=>t.exitReason==="trail" && t.accountReturn>0);
  const shortOther = shortBaseline.filter((t)=>t.exitReason!=="hard");
  const shortDiag = {
    baseline: cohortSummary(shortBaseline), hardStops: cohortSummary(shortHard), nonHard: cohortSummary(shortOther), protectedTrailingWinners: cohortSummary(shortTrailingWinners),
    hardStopTrades: shortHard.map((t)=>({signalTs:t.signalTs, signalIso:new Date(t.signalTs).toISOString(), requestedGross:t.requestedGross, sizingState:t.sizingState, counterwind:t.counterwind, accountReturn:t.accountReturn, entryFeatures:t.entryFeatures, mfeUnit:t.mfeUnit, maeUnit:t.maeUnit})),
  };

  const shortSelection = chooseShortVeto(rows,funding,baselineNormal);
  const longSelection = evaluateLongReentry(rows,funding,baselineNormal);
  const longMode:LongMode = longSelection.pass ? "RAW_REENTRY" : "EDGE";
  const shortRule:VetoRule|null = shortSelection.passedHoldout && shortSelection.selected ? shortSelection.selected.rule : null;
  const candidateNormalReplay = replay(rows,funding,{mode:"normal",longMode,shortVeto:shortRule});
  const candidateStressReplay = replay(rows,funding,{mode:"stress",longMode,shortVeto:shortRule});
  const candidateNormal = candidateNormalReplay.trades, candidateStress = candidateStressReplay.trades;
  const candidateNormalMetrics=metrics(candidateNormal), candidateStressMetrics=metrics(candidateStress);
  const baselineHoldout = metrics(sliceByTime(baselineNormal,HOLDOUT_CUTOFF,EVAL_END));
  const candidateHoldout = metrics(sliceByTime(candidateNormal,HOLDOUT_CUTOFF,EVAL_END));
  const fullValidationPass = candidateNormalMetrics.returnPct > baselineNormalMetrics.returnPct + 1e-9
    && (candidateNormalMetrics.profitFactor??0) >= (baselineNormalMetrics.profitFactor??0)*0.95
    && candidateNormalMetrics.maxDrawdownPct >= baselineNormalMetrics.maxDrawdownPct - 1.0
    && candidateStressMetrics.returnPct >= baselineStressMetrics.returnPct
    && (candidateStressMetrics.profitFactor??0) >= (baselineStressMetrics.profitFactor??0)*0.95
    && candidateHoldout.returnPct + 1e-9 >= baselineHoldout.returnPct
    && candidateHoldout.maxDrawdownPct >= baselineHoldout.maxDrawdownPct - 0.5;
  const promoted = fullValidationPass && (longMode!=="EDGE" || shortRule!==null);
  const finalNormal = promoted ? candidateNormal : baselineNormal;
  const finalStress = promoted ? candidateStress : baselineStress;
  const finalNormalMetrics = promoted ? candidateNormalMetrics : baselineNormalMetrics;
  const finalStressMetrics = promoted ? candidateStressMetrics : baselineStressMetrics;

  const diagnosticPayload = {
    schema:"pengu-v56-v20-diagnostics/v1", status:"PASS_RESEARCH_ONLY", period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    holdout:{cutoff:new Date(HOLDOUT_CUTOFF).toISOString(), selectionFraction:2/3, note:"Candidate thresholds are selected only on the first 2/3 of time; the final 1/3 is validation-only within this study."},
    source:{productionLogicSha:SOURCE_SHA, venue:"Aster perpetual public REST V3"},
    longDiagnostics:longDiag, shortDiagnostics:shortDiag, longCandidate:longSelection, shortCandidate:shortSelection,
    baseline:{normal:baselineNormalMetrics,stress:baselineStressMetrics, replayDiagnostics:baselineNormalReplay.diagnostics},
    candidate:{longMode,shortRule,normal:candidateNormalMetrics,stress:candidateStressMetrics,holdout:{baseline:baselineHoldout,candidate:candidateHoldout},replayDiagnostics:candidateNormalReplay.diagnostics,fullValidationPass,promoted},
    safety:{mode:"RESEARCH_ONLY",ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };

  const ledgerPayload = {
    schema:"pengu-dual-ls-v2-aster-ledger/v1", strategyId:PENGU_DUAL_LS_V2.id,
    longVariant: promoted && longMode==="RAW_REENTRY" ? "PENGU_DUAL_LS_V2_FINAL_V56_RAW_REENTRY_RESEARCH" : "PENGU_DUAL_LS_V2_FINAL_V56_SIDE_AWARE",
    shortVariant: promoted && shortRule ? `V20_ENTRY_VETO_RESEARCH_${shortRule.feature}_${shortRule.op}_${shortRule.threshold}` : "COUNTERWIND_VOL_TARGET_FAILURE_EXIT",
    shortPreRegistrationSha:"ad7cedb3cafaf9f9680e390112f72375d84b50ac", currentProductionSourceSha:SOURCE_SHA, researchOnly:true,
    researchCandidate:{promoted,longMode:promoted?longMode:"EDGE",shortVeto:promoted?shortRule:null,diagnosticsSchema:"pengu-v56-v20-diagnostics/v1"},
    period:{startInclusive:new Date(EVAL_START).toISOString(),endExclusive:new Date(EVAL_END).toISOString()},
    source:{venue:"Aster perpetual public REST V3",productionLogicSha:SOURCE_SHA}, costs:{normalFeeBpsPerSide:6,stressAdditionalAdverseBpsPerSide:35,actualFunding:true},
    data:{penguRows:pengu.length,btcRows:btc.length,fundingRows:funding.length,availableStart:new Date(pengu[0].openTime).toISOString(),availableEndExclusive:new Date(pengu.at(-1)!.openTime+HOUR).toISOString(),requestedStart:new Date(EVAL_START).toISOString(),requestedEndExclusive:new Date(EVAL_END).toISOString(),coverageNote:"No pre-listing PENGU data is synthesized; replay begins at the first common Aster PENGU/BTC H1 timestamp."},
    researchCheckpoint:{frozenReference:{trades:33,returnPctWithActualFunding:152.82887236975503},matched:baselineNormalMetrics.trades===33,interpretation:"Baseline parity checked against Run 32902090423 before any candidate is admitted."},
    integrity:{noOverlap:finalNormal.every((t,i)=>i===0||t.entryTs>finalNormal[i-1].exitTs),maximumRequestedGross:Math.max(...finalNormal.map((t)=>t.requestedGross))},
    modes:{normal:{metrics:finalNormalMetrics,trades:finalNormal.map(publicTrade)},stress:{metrics:finalStressMetrics,trades:finalStress.map(publicTrade)}},
    safety:{ordersSent:false,liveChanged:false,vpsChanged:false,productionChanged:false},
  };
  assert.equal(ledgerPayload.integrity.noOverlap,true);
  assert.ok(ledgerPayload.integrity.maximumRequestedGross<=0.9375+1e-12);
  assert.ok(finalNormal.filter((t)=>t.side==="S").every((t)=>t.requestedGross<=0.75+1e-12));
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"diagnostics.json"),JSON.stringify(diagnosticPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"candidate-pengu-ledger.json"),JSON.stringify(ledgerPayload,null,2)+"\n","utf8");
  console.log("PENGU_DIAGNOSTICS="+JSON.stringify({long:longDiag,short:{hardStops:shortHard.length,protectedTrailingWinners:shortTrailingWinners.length},shortCandidate:shortSelection.selected?{rule:shortSelection.selected.rule,passedHoldout:shortSelection.passedHoldout}:null,longCandidate:longSelection,candidate:diagnosticPayload.candidate},null,2));
}

main().catch((error)=>{console.error(error instanceof Error ? error.stack||error.message : String(error)); process.exitCode=1;});
