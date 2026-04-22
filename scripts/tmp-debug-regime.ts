import path from "path";

import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { buildIndicatorBars, latestIndicatorAtOrBefore, resampleTo12h } from "../lib/backtest/indicators";

const symbols = ["BTC", "ETH", "SOL", "AVAX"] as const;
const localZipPaths: Record<(typeof symbols)[number], string | null> = {
  BTC: path.join("C:\\Users\\dis\\Desktop", "2022BTC.zip"),
  ETH: path.join("C:\\Users\\dis\\Desktop", "2022ETH.zip"),
  SOL: path.join("C:\\Users\\dis\\Desktop", "2022SOL.zip"),
  AVAX: null,
};

async function main() {
  const startTs = Date.UTC(2022, 0, 1, 0, 0, 0);
  const endTs = Date.UTC(2026, 0, 1, 0, 0, 0) - 1;
  const cacheRoot = path.join(process.cwd(), ".cache", "hybrid-retq22");
  const bySymbol = {} as Record<(typeof symbols)[number], Awaited<ReturnType<typeof loadHistoricalCandles>>>;
  for (const symbol of symbols) {
    bySymbol[symbol] = await loadHistoricalCandles({
      symbol: `${symbol}USDT`,
      localZipPath: localZipPaths[symbol] || undefined,
      cacheRoot,
      startMs: startTs,
      endMs: endTs,
    });
  }
  const indicators = {} as Record<(typeof symbols)[number], ReturnType<typeof buildIndicatorBars>>;
  for (const symbol of symbols) indicators[symbol] = buildIndicatorBars(resampleTo12h(bySymbol[symbol]));

  const times = [
    "2023-03-18T12:00:00.000Z",
    "2023-03-07T12:00:00.000Z",
    "2023-03-28T00:00:00.000Z",
    "2023-03-29T12:00:00.000Z",
    "2023-04-03T00:00:00.000Z",
    "2023-04-04T00:00:00.000Z",
    "2023-04-07T12:00:00.000Z",
    "2023-04-09T12:00:00.000Z",
    "2023-04-10T00:00:00.000Z",
    "2024-04-01T00:00:00.000Z",
    "2024-06-01T00:00:00.000Z",
    "2024-06-03T12:00:00.000Z",
    "2024-06-17T00:00:00.000Z",
    "2024-06-17T12:00:00.000Z",
    "2024-06-18T00:00:00.000Z",
    "2024-12-18T12:00:00.000Z",
    "2025-02-03T00:00:00.000Z",
    "2025-11-05T00:00:00.000Z",
    "2025-05-01T00:00:00.000Z",
    "2023-07-01T00:00:00.000Z",
    "2023-05-12T12:00:00.000Z",
    "2023-06-09T00:00:00.000Z",
    "2023-07-28T12:00:00.000Z",
    "2023-07-24T12:00:00.000Z",
    "2023-08-19T12:00:00.000Z",
    "2023-10-02T12:00:00.000Z",
    "2023-10-12T12:00:00.000Z",
    "2023-12-29T12:00:00.000Z",
    "2024-01-04T12:00:00.000Z",
    "2024-01-10T12:00:00.000Z",
    "2024-03-31T12:00:00.000Z",
  ];

  for (const iso of times) {
    const ts = Date.parse(iso);
    const btc = latestIndicatorAtOrBefore(indicators.BTC, ts);
    const eth = latestIndicatorAtOrBefore(indicators.ETH, ts);
    const sol = latestIndicatorAtOrBefore(indicators.SOL, ts);
    const avax = latestIndicatorAtOrBefore(indicators.AVAX, ts);
    if (!btc || !eth || !sol || !avax || !btc.ready || !eth.ready || !sol.ready || !avax.ready) {
      console.log(iso, "not-ready");
      continue;
    }

    const tradeBars = [eth, sol, avax];
    const breadth40 = tradeBars.filter((bar) => bar.close > bar.sma40).length;
    const breadth45 = tradeBars.filter((bar) => bar.close > bar.sma45).length;
    const core2_45 = [eth, sol].filter((bar) => bar.close > bar.sma45).length;
    const best = [...tradeBars].sort((left, right) => right.mom20 - left.mom20 || right.close - left.close)[0];
    const bestMom20 = best?.mom20 || 0;
    const bestMomAccel = best?.momAccel || 0;
    const avgMom20EthSol = (eth.mom20 + sol.mom20) / 2;
    const weak2022Regime = [
      breadth45 <= 1,
      Math.abs((btc.close / Math.max(1, btc.sma85)) - 1) < 0.01,
      btc.adx14 < 18,
      bestMom20 < 0.10,
    ].filter(Boolean).length >= 4;
    const trendAllowed = btc.close > btc.sma90;
    const regimeLabel = trendAllowed
      ? (weak2022Regime ? "trend_weak" : "trend_strong")
      : (weak2022Regime ? "range_only" : "ambiguous");
    const rangeAllowed = regimeLabel === "range_only" && breadth40 <= 0 && bestMom20 < 0.08;
    console.log(JSON.stringify({
      iso,
      btcClose: btc.close,
      btcSma90: btc.sma90,
      btcAdx14: btc.adx14,
      breadth40,
      breadth45,
      core2_45,
      bestMom20,
      bestMomAccel,
      avgMom20EthSol,
      weak2022Regime,
      regimeLabel,
      trendAllowed,
      rangeAllowed,
    }));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


