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
} from "../lib/pengu-dual-ls-v2";
import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";

const HOUR = 3_600_000;
const WARM_START = Date.parse("2025-07-20T00:00:00Z");
const EVAL_START = Date.parse("2025-08-10T00:00:00Z");
const EVAL_END = Date.parse("2026-08-10T00:00:00Z");
const BASE_URL = "https://fapi.asterdex.com";
const BASE_FEE_PER_SIDE = 0.0006;
const STRESS_ADVERSE_SLIPPAGE_PER_SIDE = 0.0035;

type Mode = "normal" | "stress";
type Side = "L" | "S";
type Reason = "hard" | "trail" | "time";

interface FundingPoint {
  fundingTime: number;
  fundingRate: number;
}

interface LedgerTrade {
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
  exitReason: Reason;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: URL) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "DisDex-PENGU-V2-Aster-Ledger/1.0" },
      });
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
    if (!(next > cursor)) throw new Error(`${symbol} Aster pagination did not advance`);
    cursor = next;
    await sleep(50);
  }
  const byTs = new Map<number, DisDexV35Candle>();
  for (const raw of rows) {
    const openTime = Number(raw[0]);
    const candle: DisDexV35Candle = {
      openTime,
      open: Number(raw[1]),
      high: Number(raw[2]),
      low: Number(raw[3]),
      close: Number(raw[4]),
      volume: Number(raw[5]),
      closeTime: Number(raw[6] ?? openTime + HOUR - 1),
    };
    if (openTime >= WARM_START && openTime < EVAL_END && Object.values(candle).every(Number.isFinite)) byTs.set(openTime, candle);
  }
  return [...byTs.values()].sort((left, right) => left.openTime - right.openTime);
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
    if (!(next > cursor)) throw new Error("PENGU funding pagination did not advance");
    cursor = next;
    await sleep(50);
  }
  return [...new Map(rows.map((row) => [row.fundingTime, row])).values()].sort((a, b) => a.fundingTime - b.fundingTime);
}

function fundingBetween(points: FundingPoint[], entryTs: number, exitTs: number) {
  return points
    .filter((point) => point.fundingTime > entryTs && point.fundingTime <= exitTs)
    .reduce((sum, point) => sum + point.fundingRate, 0);
}

function replay(history: PenguDualLsV2History, funding: FundingPoint[], mode: Mode) {
  const rows = buildPenguDualLsV2EvaluationSeries(history, EVAL_END + HOUR);
  const trades: LedgerTrade[] = [];
  const costPerSide = BASE_FEE_PER_SIDE + (mode === "stress" ? STRESS_ADVERSE_SLIPPAGE_PER_SIDE : 0);
  let index = 250;
  let cooldown = -1;
  while (index < rows.length - 2) {
    if (index <= cooldown) { index += 1; continue; }
    const side: Side | undefined = rows[index].shortSignal ? "S" : rows[index].longSignal ? "L" : undefined;
    if (!side || !rows[index].features) { index += 1; continue; }
    const entryIndex = index + 1;
    const entry = rows[entryIndex].candle;
    let position: PenguDualLsV2Position = {
      side: side === "L" ? 1 : -1,
      entryTs: entry.openTime,
      entryPrice: entry.open,
      quantity: 1,
      gross: targetGrossForAtr(rows[index].features!.atr24Ratio),
      highWaterMark: entry.open,
      lowWaterMark: entry.open,
    };
    const hold = side === "L" ? PENGU_DUAL_LS_V2.long.maxHoldHours : PENGU_DUAL_LS_V2.short.maxHoldHours;
    const last = Math.min(rows.length - 1, entryIndex + hold - 1);
    let exitIndex = last;
    let exitPrice = rows[last].candle.close;
    let exitReason: Reason = "time";
    for (let cursor = entryIndex; cursor <= last; cursor += 1) {
      const features = rows[cursor].features;
      assert(features, `Production features missing at ${cursor}`);
      const evaluation = evaluatePenguDualLsV2PositionBar(position, features);
      position = evaluation.updatedPosition;
      if (evaluation.exit) {
        exitIndex = cursor;
        exitPrice = evaluation.exit.stopPrice ?? rows[cursor].candle.close;
        exitReason = evaluation.exit.reason.includes("HARD") ? "hard" : evaluation.exit.reason.includes("TRAILING") ? "trail" : "time";
        break;
      }
    }
    if (entry.openTime >= EVAL_START && entry.openTime < EVAL_END) {
      const exitTs = rows[exitIndex].candle.openTime;
      const rawUnitReturn = side === "L" ? exitPrice / entry.open - 1 : entry.open / exitPrice - 1;
      const fundingRate = fundingBetween(funding, entry.openTime, exitTs);
      const fundingUnitReturn = side === "L" ? -fundingRate : fundingRate;
      const costUnitReturn = -2 * costPerSide;
      const netUnitReturn = rawUnitReturn + fundingUnitReturn + costUnitReturn;
      trades.push({
        side,
        signalTs: rows[index].candle.openTime,
        entryTs: entry.openTime,
        exitTs,
        entryPrice: entry.open,
        exitPrice,
        requestedGross: position.gross,
        rawUnitReturn,
        fundingUnitReturn,
        costUnitReturn,
        netUnitReturn,
        accountReturn: position.gross * netUnitReturn,
        exitReason,
      });
    }
    cooldown = exitIndex + PENGU_DUAL_LS_V2.cooldownHours;
    index = exitIndex + 1;
  }
  return trades;
}

function metrics(trades: LedgerTrade[]) {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  for (const trade of trades) {
    equity *= 1 + trade.accountReturn;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    if (trade.accountReturn > 0) grossProfit += trade.accountReturn;
    else grossLoss -= trade.accountReturn;
  }
  return {
    trades: trades.length,
    returnPct: (equity - 1) * 100,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdownPct: maxDrawdown * 100,
    winRatePct: trades.length ? trades.filter((trade) => trade.accountReturn > 0).length / trades.length * 100 : null,
    longTrades: trades.filter((trade) => trade.side === "L").length,
    shortTrades: trades.filter((trade) => trade.side === "S").length,
  };
}

async function main() {
  assert.equal(PENGU_DUAL_LS_V2.id, "PENGU_DUAL_LS_V2_FINAL");
  const [pengu, btc, funding] = await Promise.all([
    downloadCandles("PENGUUSDT"),
    downloadCandles("BTCUSDT"),
    downloadFunding("PENGUUSDT"),
  ]);
  assert.ok(pengu.length >= 9_200 && btc.length >= 9_200, `Insufficient Aster rows: PENGU=${pengu.length}, BTC=${btc.length}`);
  const history: PenguDualLsV2History = { pengu1h: pengu, btc1h: btc, penguFunding: funding.map((row) => ({ fundingTime: row.fundingTime, fundingRate: row.fundingRate })) };
  const normal = replay(history, funding, "normal");
  const stress = replay(history, funding, "stress");
  const normalMetrics = metrics(normal);
  const stressMetrics = metrics(stress);
  const frozenResearchReference = {
    trades: 30,
    returnPctWithActualFunding: 137.56,
    profitFactorWithActualFunding: 2.993,
    stressReturnPct: 103.71,
  };
  const frozenResearchCheckpointMatched = normalMetrics.trades === frozenResearchReference.trades
    && Math.abs(normalMetrics.returnPct - frozenResearchReference.returnPctWithActualFunding) <= 0.75
    && Math.abs(stressMetrics.returnPct - frozenResearchReference.stressReturnPct) <= 0.90;
  assert.ok(normalMetrics.trades >= 25 && normalMetrics.trades <= 40, `Implausible Aster production replay trade count: ${normalMetrics.trades}`);
  assert.ok(normalMetrics.returnPct > 0 && finiteMetric(normalMetrics.profitFactor) > 1.5, `Aster production replay lost its normal edge: ${JSON.stringify(normalMetrics)}`);
  assert.ok(stressMetrics.returnPct > 0 && finiteMetric(stressMetrics.profitFactor) > 1.2, `Aster production replay lost its stress edge: ${JSON.stringify(stressMetrics)}`);
  const payload = {
    schema: "pengu-dual-ls-v2-aster-ledger/v1",
    strategyId: PENGU_DUAL_LS_V2.id,
    researchOnly: true,
    period: { startInclusive: new Date(EVAL_START).toISOString(), endExclusive: new Date(EVAL_END).toISOString() },
    source: { venue: "Aster perpetual public REST V3", productionLogicSha: process.env.PRODUCTION_SOURCE_SHA || null },
    costs: { normalFeeBpsPerSide: 6, stressAdditionalAdverseBpsPerSide: 35, actualFunding: true },
    data: { penguRows: pengu.length, btcRows: btc.length, fundingRows: funding.length },
    researchCheckpoint: {
      frozenReference: frozenResearchReference,
      matched: frozenResearchCheckpointMatched,
      interpretation: frozenResearchCheckpointMatched
        ? "Current production replay matches the frozen Aster research checkpoint."
        : "Current production TypeScript replay is controlling for the VPS-combined test; the frozen Aster Python research checkpoint differs and is retained as a data-quality warning without retuning.",
    },
    integrity: {
      noOverlap: normal.every((trade, i) => i === 0 || trade.entryTs > normal[i - 1].exitTs),
      maximumRequestedGross: Math.max(...normal.map((trade) => trade.requestedGross)),
    },
    modes: {
      normal: { metrics: normalMetrics, trades: normal },
      stress: { metrics: stressMetrics, trades: stress },
    },
    safety: { ordersSent: false, liveChanged: false, vpsChanged: false, productionChanged: false },
  };
  assert.equal(payload.integrity.noOverlap, true);
  const output = process.env.PENGU_LEDGER_OUT || ".research-state/v12-v52-pengu-v2-combined/pengu-v2-ledgers.json";
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ status: "PENGU_V2_ASTER_LEDGER_PASS", data: payload.data, researchCheckpoint: payload.researchCheckpoint, normal: normalMetrics, stress: stressMetrics }, null, 2));
}

function finiteMetric(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
