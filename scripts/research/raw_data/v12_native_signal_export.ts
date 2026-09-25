/**
 * Research-only native V12 signal export. Runs the actual, unmodified pure
 * TypeScript lib/v12-x1-all.ts decision/sizing functions on frozen raw bars.
 * Does not call exchange clients, activate a runner or create LIVE orders.
 *
 * Example:
 *   npx tsx scripts/research/raw_data/v12_native_signal_export.ts \
 *     .raw-data/repaired-binance-2025-2026.json.gz /tmp/v12-native.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { V12_X1_ALL } from "../../../config/v12X1AllRuntime";
import {
  buildV12Signals,
  protectiveLevels,
  resampleV12H1ToH2,
  sizeV12Position,
  type V12Bar,
  type V12H1Candle,
} from "../../../lib/v12-x1-all";

type RawBar = { ts_ms: number; open: number; high: number; low: number; close: number; volume: number };
type Bundle = { bars: Record<string, RawBar[]> };
const H2_MS = 7_200_000;
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("USAGE: v12_native_signal_export.ts <raw.json.gz> <output.json>");
const bundle = JSON.parse(gunzipSync(readFileSync(input)).toString("utf8")) as Bundle;
const symbols = [...V12_X1_ALL.universe];
const bars: Record<string, V12Bar[]> = {};
for (const symbol of symbols) {
  const src = bundle.bars[symbol + "USDT"];
  if (!src?.length) throw new Error("MISSING_V12_SOURCE:" + symbol);
  for (let i = 0; i < src.length; i++) {
    const b = src[i];
    if (
      !Number.isSafeInteger(b.ts_ms) ||
      ![b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) ||
      Math.min(b.open, b.high, b.low, b.close) <= 0 ||
      b.volume < 0 ||
      b.high < Math.max(b.open, b.close) ||
      b.low > Math.min(b.open, b.close)
    ) throw new Error("V12_INVALID_SOURCE_BAR:" + symbol + ":" + i);
    if (i && b.ts_ms <= src[i - 1].ts_ms) throw new Error("V12_NON_MONOTONIC_SOURCE:" + symbol);
  }
  const inputBars: V12H1Candle[] = src.map(b => ({
    ts: b.ts_ms, open: b.open, high: b.high, low: b.low,
    close: b.close, volume: b.volume, closed: true,
  }));
  bars[symbol] = resampleV12H1ToH2(inputBars);
}
const btc = bars.BTC;
for (const symbol of symbols) {
  const rows = bars[symbol];
  if (rows.length !== btc.length) throw new Error("V12_H2_COUNT_MISMATCH:" + symbol);
  if (rows.some((b, i) => b.ts !== btc[i].ts || b.endTs !== btc[i].endTs)) {
    throw new Error("V12_H2_TIME_MISMATCH:" + symbol);
  }
}
const signals: Array<Record<string, number | string | boolean>> = [];
const rankCount = { "1": 0, "2": 0, "3": 0 };
const sides = { LONG: 0, SHORT: 0 };
for (let i = 0; i < btc.length - 1; i++) {
  for (const signal of buildV12Signals(bars, i)) {
    const bar = bars[signal.symbol][i];
    const next = bars[signal.symbol][i + 1];
    if (next.ts !== bar.endTs || signal.entryTs !== next.ts || signal.referenceTs !== bar.endTs) {
      throw new Error("V12_NEXT_BAR_PARITY_FAILURE:" + signal.symbol);
    }
    const sizing = sizeV12Position(1, bar.close, signal.atr, signal.side);
    const requestedGross = Math.min(
      sizing.requestedGross,
      signal.rank === 3 ? V12_X1_ALL.rank3EntryGrossCap : V12_X1_ALL.perPositionEntryGrossCap,
    );
    const levels = protectiveLevels(bar.close, signal.atr, signal.side);
    signals.push({
      positionId: "v12:" + signal.symbol + "USDT:" + signal.entryTs + ":" + signal.rank,
      symbol: signal.symbol + "USDT",
      side: signal.side, rank: signal.rank, score: signal.score,
      momentum: signal.momentum, volatility: signal.volatility,
      volumeRatio: signal.volumeRatio, atr: signal.atr,
      regime: signal.regime, signalClose: bar.close,
      signalTs: signal.referenceTs - 1, entryTs: signal.entryTs,
      featureSourceTs: signal.referenceTs - 1,
      requestedGross,
      hardStopPct: Math.abs(levels.initialStop / bar.close - 1),
      takeProfitPct: Math.abs(levels.takeProfit / bar.close - 1),
      trailingPct: levels.trailingDistance / bar.close,
      maxHoldHours: V12_X1_ALL.maxHoldBars * V12_X1_ALL.timeframeHours,
      productionSignalFunction: "buildV12Signals",
      researchOnly: true,
    });
    rankCount[String(signal.rank) as keyof typeof rankCount] += 1;
    sides[signal.side] += 1;
  }
}
const report = {
  schema: "v12-native-pure-signal-dump/v1",
  disclaimer: "Native production PURE SIGNAL only; execution, allocator, original Top3 venue parity NOT verified",
  v12Source: "lib/v12-x1-all.ts",
  v12ConfigSource: "config/v12X1AllRuntime.ts",
  sourceCommit: process.env.GITHUB_SHA ?? "UNRECORDED",
  h2Bars: btc.length,
  candidates: signals.length,
  rankCount, sides,
  signals,
};
writeFileSync(output, JSON.stringify(report));
console.log(JSON.stringify({
  status: "NATIVE_PURE_V12_SIGNAL_EXPORT_ONLY",
  candidates: signals.length, h2Bars: btc.length, rankCount, sides, sourceCommit: report.sourceCommit,
}));
