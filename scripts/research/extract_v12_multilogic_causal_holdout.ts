import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildV12Signals, resampleV12H1ToH2, type V12Bar, type V12H1Candle } from "../../lib/v12-x1-all";
import { V12_X1_ALL } from "../../config/v12X1AllRuntime";

const H = 3_600_000;
const ROOT = process.cwd();
const BASE = join(ROOT, "docs/research/results/v12-untouched-holdout-20261008");
const DATA = join(BASE, "data/klines");
const OUT = join(ROOT, "docs/research/results/v12-multilogic-causal-holdout-20261009");
const START = Date.parse("2026-08-11T00:00:00Z");
const DATA_END = Date.parse("2026-10-08T00:00:00Z");
// Longest frozen route is delay2 + 72h.
const ENTRY_END = DATA_END - 74 * H;

function loadH1(symbol: string): V12H1Candle[] {
  const path = join(DATA, `${symbol}USDT.jsonl`);
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    const x = JSON.parse(line);
    return {
      ts: Number(x.event_time_ms),
      open: Number(x.open),
      high: Number(x.high),
      low: Number(x.low),
      close: Number(x.close),
      volume: Number(x.base_volume),
      closed: true,
    };
  });
}
function ema(values: number[], n: number) {
  if (!values.length) return NaN;
  let x = values[0];
  const alpha = 2 / (n + 1);
  for (const p of values.slice(1)) x += alpha * (p - x);
  return x;
}

const h1BySymbol = new Map<string, V12H1Candle[]>();
const h1MapBySymbol = new Map<string, Map<number, V12H1Candle>>();
const rawH2 = new Map<string, V12Bar[]>();
for (const symbol of V12_X1_ALL.universe) {
  const h1 = loadH1(symbol);
  h1BySymbol.set(symbol, h1);
  h1MapBySymbol.set(symbol, new Map(h1.map((b) => [b.ts, b])));
  rawH2.set(symbol, resampleV12H1ToH2(h1));
}
let common: Set<number> | undefined;
for (const symbol of V12_X1_ALL.universe) {
  const ts = new Set((rawH2.get(symbol) || []).map((b) => b.endTs));
  common = common ? new Set([...common].filter((t) => ts.has(t))) : ts;
}
if (!common) throw new Error("no common H2 timestamps");
const universe: Record<string, V12Bar[]> = {};
for (const symbol of V12_X1_ALL.universe) {
  universe[symbol] = (rawH2.get(symbol) || []).filter((b) => common!.has(b.endTs));
}
const ref = universe.BTC;
for (const symbol of V12_X1_ALL.universe) {
  const arr = universe[symbol];
  if (arr.length !== ref.length || arr.some((b, i) => b.endTs !== ref[i].endTs)) {
    throw new Error(`alignment mismatch ${symbol}`);
  }
}

const candidates: any[] = [];
for (let i = 60; i < ref.length - 1; i += 1) {
  const signals = buildV12Signals(universe, i);
  for (const signal of signals) {
    if (signal.entryTs < START || signal.entryTs >= ENTRY_END) continue;
    const bars = universe[signal.symbol];
    const sg = signal.side === "LONG" ? 1 : -1;
    let ageH = 0;
    for (let j = i; j >= Math.max(45, i - 47); j -= 1) {
      if (j - 45 < 0) break;
      const signed90 = sg * (bars[j].close / bars[j - 45].close - 1);
      if (signed90 < 0.0227) break;
      ageH += 2;
    }
    const closes = bars.slice(Math.max(0, i - 120), i + 1).map((b) => b.close);
    const signedRet6 = sg * (bars[i].close / bars[i - 3].close - 1);
    const distanceEma12Atr = sg * (bars[i].close - ema(closes, 12)) / signal.atr;
    const entryBar = h1MapBySymbol.get(signal.symbol)!.get(signal.entryTs);
    if (!entryBar) continue;
    candidates.push({
      symbol: signal.symbol + "USDT",
      v12Symbol: signal.symbol,
      side: signal.side,
      rank: signal.rank,
      entry_ts_ms: signal.entryTs,
      entry_price: entryBar.open,
      atr: signal.atr,
      maxHoldHours: 46,
      requested_gross: (signal as any).requestedGross ?? 1,
      age: ageH,
      diag_ret6: signedRet6,
      diag_ema: distanceEma12Atr,
      score: signal.score,
      momentum: signal.momentum,
      volumeRatio: signal.volumeRatio,
      entryGateReason: signal.entryGateReason,
    });
  }
}
mkdirSync(OUT, {recursive: true});
writeFileSync(join(OUT, "baseline-candidates.jsonl"), candidates.map((x) => JSON.stringify(x)).join("\n") + "\n");
writeFileSync(join(OUT, "extract-report.json"), JSON.stringify({
  research_only: true,
  live_changes: false,
  production_changes: false,
  source_engine: "buildV12Signals exact current library",
  period: {start: new Date(START).toISOString(), entry_end: new Date(ENTRY_END).toISOString(), data_end: new Date(DATA_END).toISOString()},
  candidate_count: candidates.length,
  universe: V12_X1_ALL.universe,
}, null, 2));
console.log(JSON.stringify({candidate_count:candidates.length,start:new Date(START).toISOString(),entry_end:new Date(ENTRY_END).toISOString()}, null, 2));
