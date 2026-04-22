import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import {
  buildIndicatorBars,
  latestIndicatorAtOrBefore,
  resampleTo12h,
  resampleToHours,
} from "../lib/backtest/indicators";
import type {
  BacktestResult,
  Candle1h,
  EquityPoint,
  IndicatorBar,
  RegimeSnapshot,
  TradePairRow,
} from "../lib/backtest/types";

const DEFAULT_REPORT_NAME = "doge-pengu-specialized";
const BASE_OPTIONS = {
  ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
  label: "base_pengu_idle_for_specialized",
};
const NORMAL_SYMBOLS = new Set(["ETH", "SOL", "AVAX"]);
const ALL_MEME_SYMBOLS = ["DOGE", "PENGU"] as const;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;
const DATA_START = Date.UTC(2022, 0, 1, 0, 0, 0);
const DATA_END = Date.UTC(2026, 0, 1, 0, 0, 0) - 1;

type MemeSymbol = (typeof ALL_MEME_SYMBOLS)[number];
type Pattern = "fast-exit" | "fast-exit-trailing" | "early-entry-fast-exit";

type Segment = {
  type: "normal" | "meme";
  startTs: number;
  endTs: number;
  points: EquityPoint[];
};

type MemeTrade = {
  trade_id: string;
  symbol: MemeSymbol;
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  qty: number;
  gross_pnl: number;
  fee: number;
  net_pnl: number;
  holding_bars: number;
  entry_reason: string;
  exit_reason: string;
};

type MemeSimulation = {
  points: EquityPoint[];
  trades: MemeTrade[];
  endEquity: number;
};

type LoadedMarket = {
  raw: Record<string, Candle1h[]>;
  bars12h: Record<string, IndicatorBar[]>;
  bars6h: Record<string, IndicatorBar[]>;
  timeline12h: number[];
  timeline6h: number[];
};

function parseCli() {
  const symbolsArg = process.argv.find((arg) => arg.startsWith("--symbols="));
  const reportArg = process.argv.find((arg) => arg.startsWith("--report="));
  const parsedSymbols = symbolsArg
    ? symbolsArg
      .slice("--symbols=".length)
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter((item): item is MemeSymbol => (ALL_MEME_SYMBOLS as readonly string[]).includes(item))
    : [...ALL_MEME_SYMBOLS];
  return {
    memeSymbols: (parsedSymbols.length ? parsedSymbols : [...ALL_MEME_SYMBOLS]) as MemeSymbol[],
    reportDir: path.join(process.cwd(), "reports", reportArg?.slice("--report=".length) || DEFAULT_REPORT_NAME),
  };
}

function formatIso(ts: number) {
  return new Date(ts).toISOString();
}

function calcMaxDrawdownPct(points: EquityPoint[]) {
  let peak = points[0]?.equity || 10000;
  let worst = 0;
  for (const point of points) {
    peak = Math.max(peak, point.equity);
    if (peak <= 0) continue;
    worst = Math.min(worst, ((point.equity / peak) - 1) * 100);
  }
  return worst;
}

function scaleTrade(trade: TradePairRow, scale: number): TradePairRow {
  return {
    ...trade,
    qty: trade.qty * scale,
    gross_pnl: trade.gross_pnl * scale,
    fee: trade.fee * scale,
    net_pnl: trade.net_pnl * scale,
  };
}

function percentChange(from: number, to: number) {
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to)) return 0;
  return (to / from) - 1;
}

function currentPriceAt(raw: Candle1h[], ts: number) {
  let lo = 0;
  let hi = raw.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (raw[mid].ts <= ts) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? raw[best] : null;
}

function calcEfficiencyRatio(bars: IndicatorBar[], endIndex: number, lookback: number) {
  if (endIndex <= 0 || endIndex - lookback < 0) return 0;
  const endClose = bars[endIndex]?.close;
  const startClose = bars[endIndex - lookback]?.close;
  if (!Number.isFinite(endClose) || !Number.isFinite(startClose)) return 0;
  let path = 0;
  for (let i = endIndex - lookback + 1; i <= endIndex; i += 1) {
    path += Math.abs(bars[i].close - bars[i - 1].close);
  }
  if (path <= 0) return 0;
  return Math.abs(endClose - startClose) / path;
}

function latestIndexAtOrBefore(series: IndicatorBar[], ts: number) {
  let lo = 0;
  let hi = series.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (series[mid].ts <= ts) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function buildRegimeSnapshot(ts: number, bars12h: Record<string, IndicatorBar[]>) {
  const btc = latestIndicatorAtOrBefore(bars12h.BTC, ts);
  const eth = latestIndicatorAtOrBefore(bars12h.ETH, ts);
  const sol = latestIndicatorAtOrBefore(bars12h.SOL, ts);
  const avax = latestIndicatorAtOrBefore(bars12h.AVAX, ts);
  if (!btc || !eth || !sol || !avax || !btc.ready || !eth.ready || !sol.ready || !avax.ready) return null;

  const tradeBars = [eth, sol, avax];
  const breadth40 = tradeBars.filter((bar) => bar.close > bar.sma40).length;
  const breadth45 = tradeBars.filter((bar) => bar.close > bar.sma45).length;
  const core2_45 = [eth, sol].filter((bar) => bar.close > bar.sma45).length;
  const best = [...tradeBars].sort((left, right) => right.mom20 - left.mom20 || right.close - left.close)[0];
  const bestMom20 = best?.mom20 || 0;
  const bestMomAccel = best?.momAccel || 0;
  const avgMom20EthSol = (eth.mom20 + sol.mom20) / 2;
  const weak2022Regime =
    [
      breadth45 <= 1,
      Math.abs((btc.close / Math.max(1, btc.sma85)) - 1) < 0.01,
      btc.adx14 < 18,
      bestMom20 < 0.10,
    ].filter(Boolean).length >= 4;
  const trendAllowed = btc.close > btc.sma90;
  const regimeLabel = trendAllowed
    ? (weak2022Regime ? "trend_weak" : "trend_strong")
    : (weak2022Regime ? "range_only" : "ambiguous");

  return {
    ts,
    btc,
    breadth40,
    breadth45,
    core2_45,
    bestMom20,
    bestMomAccel,
    avgMom20EthSol,
    weak2022Regime,
    regimeLabel,
    trendAllowed,
    rangeAllowed: false,
  } satisfies RegimeSnapshot;
}

function evaluateMemeCandidate(
  symbol: MemeSymbol,
  ts: number,
  bars: Record<string, IndicatorBar[]>,
  snapshot: RegimeSnapshot,
  minEfficiency: number,
) {
  const series = bars[symbol];
  const idx = latestIndexAtOrBefore(series, ts);
  const bar = idx >= 0 ? series[idx] : null;
  if (!bar || !bar.ready) return null;

  const weakGateOk = snapshot.regimeLabel !== "trend_weak" || (
    snapshot.core2_45 === 2 &&
    snapshot.avgMom20EthSol >= 0.08 &&
    snapshot.bestMomAccel >= -0.02
  );
  const efficiency = calcEfficiencyRatio(series, idx, 6);
  const eligible =
    snapshot.trendAllowed &&
    weakGateOk &&
    bar.close > bar.sma40 &&
    bar.mom20 > 0 &&
    efficiency >= minEfficiency;
  const distanceFromSmaPct = bar.sma40 > 0 ? ((bar.close / bar.sma40) - 1) * 100 : 0;
  const score = (bar.mom20 * 100) + distanceFromSmaPct + (bar.adx14 / 5);

  return {
    symbol,
    bar,
    score,
    eligible,
    efficiency,
  };
}

function makeSegments(points: EquityPoint[]) {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  for (const point of points) {
    const type = NORMAL_SYMBOLS.has(point.position_symbol) ? "normal" : "meme";
    if (!current || current.type !== type) {
      current = {
        type,
        startTs: point.ts,
        endTs: point.ts,
        points: [point],
      };
      segments.push(current);
    } else {
      current.endTs = point.ts;
      current.points.push(point);
    }
  }
  return segments;
}

async function loadMarket(memeSymbols: readonly MemeSymbol[]): Promise<LoadedMarket> {
  const symbols = ["BTC", "ETH", "SOL", "AVAX", ...memeSymbols];
  const raw: Record<string, Candle1h[]> = {};
  for (const symbol of symbols) {
    raw[symbol] = await loadHistoricalCandles({
      symbol: `${symbol}USDT`,
      cacheRoot: path.join(process.cwd(), ".cache", "doge-pengu-specialized"),
      startMs: DATA_START,
      endMs: DATA_END,
    });
  }
  const bars12h: Record<string, IndicatorBar[]> = {};
  const bars6h: Record<string, IndicatorBar[]> = {};
  for (const symbol of symbols) {
    bars12h[symbol] = buildIndicatorBars(resampleTo12h(raw[symbol]));
    bars6h[symbol] = buildIndicatorBars(resampleToHours(raw[symbol], 6));
  }
  return {
    raw,
    bars12h,
    bars6h,
    timeline12h: bars12h.BTC.filter((bar) => bar.ready).map((bar) => bar.ts),
    timeline6h: bars6h.BTC.filter((bar) => bar.ready).map((bar) => bar.ts),
  };
}

function simulateMemeWindow(
  market: LoadedMarket,
  memeSymbols: readonly MemeSymbol[],
  pattern: Pattern,
  startEquity: number,
  startTs: number,
  endTs: number,
  tradeCounterStart: number,
): MemeSimulation {
  const useTrailing = pattern === "fast-exit-trailing";
  const useEarlyEntry = pattern === "early-entry-fast-exit";
  const times = [...new Set(
    [
      ...market.timeline12h.filter((ts) => ts >= startTs && ts <= endTs),
      ...market.timeline6h.filter((ts) => ts >= startTs && ts <= endTs),
    ],
  )].sort((a, b) => a - b);

  let cash = startEquity;
  let counter = tradeCounterStart;
  let qty = 0;
  let symbol: MemeSymbol | null = null;
  let entryPrice = 0;
  let entryTs = 0;
  let entryReason = "";
  let peakPrice = 0;
  const points: EquityPoint[] = [];
  const trades: MemeTrade[] = [];
  const is12h = new Set(market.timeline12h.filter((ts) => ts >= startTs && ts <= endTs));
  const is6h = new Set(market.timeline6h.filter((ts) => ts >= startTs && ts <= endTs));

  const closePosition = (ts: number, exitPrice: number, reason: string) => {
    if (!symbol || qty <= 0) return;
    const grossProceeds = qty * exitPrice;
    const grossPnl = grossProceeds - (qty * entryPrice);
    const fee = (qty * entryPrice * FEE_RATE) + (grossProceeds * FEE_RATE);
    const netPnl = grossPnl - fee;
    cash += grossProceeds * (1 - FEE_RATE);
    trades.push({
      trade_id: `meme-${String(counter).padStart(4, "0")}`,
      symbol,
      entry_time: formatIso(entryTs),
      exit_time: formatIso(ts),
      entry_price: entryPrice,
      exit_price: exitPrice,
      qty,
      gross_pnl: grossPnl,
      fee,
      net_pnl: netPnl,
      holding_bars: Math.max(1, Math.round((ts - entryTs) / (12 * 60 * 60 * 1000))),
      entry_reason: entryReason,
      exit_reason: reason,
    });
    symbol = null;
    qty = 0;
    entryPrice = 0;
    entryTs = 0;
    entryReason = "";
    peakPrice = 0;
    counter += 1;
  };

  for (const ts of times) {
    const snapshot = buildRegimeSnapshot(ts, market.bars12h);
    if (!snapshot) continue;

    if (symbol && is6h.has(ts)) {
      const bar6 = latestIndicatorAtOrBefore(market.bars6h[symbol], ts);
      const raw = currentPriceAt(market.raw[symbol], ts);
      if (bar6 && raw) {
        peakPrice = Math.max(peakPrice, raw.high, raw.close);
        const gainFromEntry = percentChange(entryPrice, peakPrice);
        const retraceFromPeak = peakPrice > 0 ? 1 - (raw.close / peakPrice) : 0;
        const fastExit = bar6.close <= bar6.sma40;
        const weakExit = snapshot.weak2022Regime && snapshot.bestMom20 < 0.05 && snapshot.btc.adx14 < 18;
        const trailExit = useTrailing && gainFromEntry >= 0.12 && retraceFromPeak >= 0.06;
        if (fastExit || weakExit || trailExit) {
          closePosition(ts, raw.close, trailExit ? "meme-trailing" : fastExit ? "meme-6h-sma40" : "meme-weak-exit");
        }
      }
    }

    if (!symbol && is12h.has(ts)) {
      const evaluations = memeSymbols
        .map((candidate) => evaluateMemeCandidate(candidate, ts, market.bars12h, snapshot, 0.22))
        .filter((item): item is NonNullable<typeof item> => item !== null && item.eligible)
        .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
      const top = evaluations[0];
      if (top) {
        const raw = currentPriceAt(market.raw[top.symbol], ts);
        if (raw) {
          const nextQty = Math.floor((cash / (raw.open * (1 + FEE_RATE))) * 1000) / 1000;
          const notional = nextQty * raw.open;
          if (nextQty > 0 && notional >= 10) {
            cash -= notional * (1 + FEE_RATE);
            symbol = top.symbol;
            qty = nextQty;
            entryPrice = raw.open;
            entryTs = ts;
            entryReason = "12h-meme-entry";
            peakPrice = raw.high;
          }
        }
      }
    }

    if (!symbol && useEarlyEntry && is6h.has(ts) && !is12h.has(ts)) {
      const evaluations = memeSymbols
        .map((candidate) => evaluateMemeCandidate(candidate, ts, market.bars6h, snapshot, 0.18))
        .filter((item): item is NonNullable<typeof item> => item !== null && item.eligible)
        .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
      const top = evaluations[0];
      if (top) {
        const raw = currentPriceAt(market.raw[top.symbol], ts);
        if (raw) {
          const nextQty = Math.floor((cash / (raw.open * (1 + FEE_RATE))) * 1000) / 1000;
          const notional = nextQty * raw.open;
          if (nextQty > 0 && notional >= 10) {
            cash -= notional * (1 + FEE_RATE);
            symbol = top.symbol;
            qty = nextQty;
            entryPrice = raw.open;
            entryTs = ts;
            entryReason = "6h-early-meme-entry";
            peakPrice = raw.high;
          }
        }
      }
    }

    const mark = symbol ? currentPriceAt(market.raw[symbol], ts)?.close || entryPrice : 0;
    points.push({
      ts,
      iso_time: formatIso(ts),
      equity: symbol ? cash + (qty * mark * (1 - FEE_RATE)) : cash,
      cash,
      position_symbol: symbol || "CASH",
      position_side: symbol ? "trend" : "cash",
      position_qty: qty,
      position_entry_price: entryPrice,
    });
  }

  if (symbol) {
    const raw = currentPriceAt(market.raw[symbol], endTs);
    closePosition(endTs, raw?.close || entryPrice, "window-end");
    points.push({
      ts: endTs,
      iso_time: formatIso(endTs),
      equity: cash,
      cash,
      position_symbol: "CASH",
      position_side: "cash",
      position_qty: 0,
      position_entry_price: 0,
    });
  }

  return {
    points,
    trades,
    endEquity: points.at(-1)?.equity ?? cash,
  };
}

function buildSummary(points: EquityPoint[], trades: TradePairRow[]) {
  const startEquity = points[0]?.equity || 10000;
  const endEquity = points.at(-1)?.equity || startEquity;
  const firstTs = points[0]?.ts || DATA_START;
  const lastTs = points.at(-1)?.ts || firstTs;
  const periodDays = Math.max(1, (lastTs - firstTs) / (24 * 60 * 60 * 1000));
  const wins = trades.filter((trade) => trade.net_pnl > 0).length;
  const grossWins = trades.filter((trade) => trade.net_pnl > 0).reduce((sum, trade) => sum + trade.net_pnl, 0);
  const grossLosses = Math.abs(trades.filter((trade) => trade.net_pnl <= 0).reduce((sum, trade) => sum + trade.net_pnl, 0));
  return {
    end_equity: endEquity,
    cagr_pct: (Math.pow(endEquity / startEquity, 365 / periodDays) - 1) * 100,
    max_drawdown_pct: calcMaxDrawdownPct(points),
    profit_factor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0,
    trade_count: trades.length,
    win_rate_pct: trades.length ? (wins / trades.length) * 100 : 0,
  };
}

async function main() {
  const { memeSymbols, reportDir } = parseCli();
  await fs.mkdir(reportDir, { recursive: true });

  const base = await runHybridBacktest("RETQ22", BASE_OPTIONS);
  const market = await loadMarket(memeSymbols);
  const segments = makeSegments(base.equity_curve);
  const normalTrades = base.trade_pairs.filter((trade) => NORMAL_SYMBOLS.has(trade.symbol));
  const patterns: Pattern[] = ["fast-exit", "fast-exit-trailing", "early-entry-fast-exit"];
  const results: Record<string, unknown> = {};

  for (const pattern of patterns) {
    const stitched: EquityPoint[] = [];
    const trades: TradePairRow[] = [];
    let currentEquity = base.equity_curve[0]?.equity || 10000;
    let memeTradeCounter = 1;

    for (const segment of segments) {
      const baseStart = segment.points[0]?.equity || currentEquity;
      if (segment.type === "normal") {
        const scale = baseStart > 0 ? currentEquity / baseStart : 1;
        for (const point of segment.points) {
          const scaledPoint: EquityPoint = {
            ...point,
            equity: point.equity * scale,
            cash: point.cash * scale,
            position_qty: point.position_qty * scale,
            position_entry_price: point.position_entry_price,
          };
          if (!stitched.length || stitched.at(-1)?.ts !== scaledPoint.ts) {
            stitched.push(scaledPoint);
          }
        }
        currentEquity = stitched.at(-1)?.equity || currentEquity;
        const segmentTrades = normalTrades
          .filter((trade) => {
            const entryTs = Date.parse(trade.entry_time);
            return entryTs >= segment.startTs && entryTs <= segment.endTs;
          })
          .map((trade) => scaleTrade(trade, scale));
        trades.push(...segmentTrades);
      } else {
        const sim = simulateMemeWindow(market, memeSymbols, pattern, currentEquity, segment.startTs, segment.endTs, memeTradeCounter);
        memeTradeCounter += sim.trades.length;
        for (const point of sim.points) {
          if (!stitched.length || stitched.at(-1)?.ts !== point.ts) {
            stitched.push(point);
          }
        }
        currentEquity = sim.endEquity;
        trades.push(...sim.trades.map((trade) => ({
          ...trade,
          strategy_type: "trend",
          sub_variant: pattern,
        })));
      }
    }

    const summary = buildSummary(stitched, trades);
    results[pattern] = {
      summary,
      meme_contribution: trades
        .filter((trade) => memeSymbols.includes(trade.symbol as MemeSymbol))
        .reduce<Record<string, number>>((acc, trade) => {
          acc[trade.symbol] = (acc[trade.symbol] || 0) + trade.net_pnl;
          return acc;
        }, {}),
    };
  }

  await fs.writeFile(path.join(reportDir, "result.json"), JSON.stringify({
    meme_symbols: memeSymbols,
    base: {
      end_equity: base.summary.end_equity,
      cagr_pct: base.summary.cagr_pct,
      max_drawdown_pct: base.summary.max_drawdown_pct,
      profit_factor: base.summary.profit_factor,
      trade_count: base.summary.trade_count,
      win_rate_pct: base.summary.win_rate_pct,
    },
    results,
  }, null, 2), "utf8");

  console.log(JSON.stringify({
    base: {
      end_equity: base.summary.end_equity,
      cagr_pct: base.summary.cagr_pct,
      max_drawdown_pct: base.summary.max_drawdown_pct,
      profit_factor: base.summary.profit_factor,
      trade_count: base.summary.trade_count,
      win_rate_pct: base.summary.win_rate_pct,
    },
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
