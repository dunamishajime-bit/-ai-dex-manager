import fs from "node:fs/promises";
import path from "node:path";

import type { Candle1h } from "../lib/backtest/types";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import {
  buildMainStrategySnapshotReplay,
  type MainStrategySnapshotReplayEvent,
} from "../lib/research-lab/perp/main-strategy-snapshot-replay";
import type { PerpFundingPoint, PerpMarketData } from "../lib/research-lab/perp/types";

const HOUR_MS = 60 * 60 * 1000;
const SYMBOLS = ["ETH", "BNB", "SOL", "AVAX", "LINK"];
const DATA_SYMBOLS = ["BTC", ...SYMBOLS];
const START_TS = Date.UTC(2025, 6, 1);
const END_TS = Date.UTC(2026, 3, 7);
const DATA_START_TS = Date.UTC(2025, 5, 1);
const DATA_END_TS = Date.UTC(2026, 4, 1);
const FEE_BPS = 6;
const SLIPPAGE_BPS = 4;
const STRESS_SLIPPAGE_BPS = 12;

type Side = "long" | "short";
type Event = MainStrategySnapshotReplayEvent & {
  btc24hPct: number;
  btc72hPct: number;
  symbol24hPct: number;
  symbol72hPct: number;
};
type Router = {
  id: string;
  description: string;
  side: (event: Event) => Side | null;
};
type ExitSpec = {
  id: string;
  maxHoldHours: number;
  takeProfitPct?: number;
  stopLossPct?: number;
};
type Outcome = {
  symbol: string;
  side: Side;
  entryTs: number;
  returnPct: number;
  stressReturnPct: number;
};
type Metrics = {
  count: number;
  winRatePct: number | null;
  averagePct: number | null;
  profitFactor: number | null;
  stressProfitFactor: number | null;
  compoundedReturnPct: number | null;
  maxDrawdownPct: number | null;
  longCount: number;
  shortCount: number;
  symbolCounts: Record<string, number>;
};
type Evaluation = {
  routerId: string;
  routerDescription: string;
  exit: ExitSpec;
  metrics: Metrics;
};

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function indexAtOrBefore(candles: Candle1h[], ts: number) {
  let low = 0;
  let high = candles.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].ts <= ts) {
      result = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return result;
}

function pastReturnPct(candles: Candle1h[], ts: number, hours: number) {
  const index = indexAtOrBefore(candles, ts);
  if (index < hours || candles[index - hours].close <= 0) return 0;
  return ((candles[index].close / candles[index - hours].close) - 1) * 100;
}

function fundingPct(points: PerpFundingPoint[], startTs: number, endTs: number) {
  return points
    .filter((point) => point.ts >= startTs && point.ts <= endTs)
    .reduce((sum, point) => sum + point.rate * 100, 0);
}

function enrich(events: MainStrategySnapshotReplayEvent[], data: PerpMarketData): Event[] {
  const btc = data.bySymbol.BTC || [];
  return events.map((event) => {
    const candles = data.bySymbol[event.symbol] || [];
    return {
      ...event,
      btc24hPct: pastReturnPct(btc, event.snapshotTs, 24),
      btc72hPct: pastReturnPct(btc, event.snapshotTs, 72),
      symbol24hPct: pastReturnPct(candles, event.snapshotTs, 24),
      symbol72hPct: pastReturnPct(candles, event.snapshotTs, 72),
    };
  });
}

function exits(): ExitSpec[] {
  const result: ExitSpec[] = [24, 48, 72, 120].map((maxHoldHours) => ({
    id: `FIXED_${maxHoldHours}H`,
    maxHoldHours,
  }));
  for (const maxHoldHours of [24, 48, 72]) {
    for (const takeProfitPct of [2, 3, 4, 5, 6, 8]) {
      for (const stopLossPct of [2, 3, 4, 5, 6, 8]) {
        result.push({
          id: `TP${takeProfitPct}_SL${stopLossPct}_${maxHoldHours}H`,
          maxHoldHours,
          takeProfitPct,
          stopLossPct,
        });
      }
    }
  }
  return result;
}

function routers(): Router[] {
  const result: Router[] = [
    { id: "LONG_ALL", description: "現行SignalをすべてLong", side: () => "long" },
    { id: "CASH_WHEN_BTC72_NEG", description: "BTC72h<0は現金、その他Long", side: (event) => event.btc72hPct >= 0 ? "long" : null },
    { id: "CASH_WHEN_BOTH72_NEG", description: "BTC/Symbol72hが両方負なら現金", side: (event) => event.btc72hPct < 0 && event.symbol72hPct < 0 ? null : "long" },
  ];
  for (const score of [80, 82, 84, 86]) {
    for (const longThreshold of [0, 2, 5]) {
      for (const shortThreshold of [0, -2, -5]) {
        result.push({
          id: `DUAL_S${score}_L${longThreshold}_SH${shortThreshold}`,
          description: `Score>=${score}; BTC/Symbol72>=${longThreshold}%でLong、両方<=${shortThreshold}%でShort、その他現金`,
          side: (event) => {
            if (event.score < score) return null;
            if (event.btc72hPct >= longThreshold && event.symbol72hPct >= longThreshold) return "long";
            if (event.btc72hPct <= shortThreshold && event.symbol72hPct <= shortThreshold) return "short";
            return null;
          },
        });
      }
    }
  }
  for (const score of [80, 82, 84, 86]) {
    for (const shortThreshold of [0, -2, -5]) {
      result.push({
        id: `SHORT_BEAR_S${score}_SH${shortThreshold}`,
        description: `Score>=${score}; BTC/Symbol72<=${shortThreshold}%の時だけShort`,
        side: (event) => event.score >= score
          && event.btc72hPct <= shortThreshold
          && event.symbol72hPct <= shortThreshold
          ? "short"
          : null,
      });
    }
  }
  for (const score of [80, 82, 84]) {
    for (const pullbackMax of [0, -2, -5]) {
      result.push({
        id: `LONG_PULLBACK_S${score}_P${pullbackMax}`,
        description: `Score>=${score}; BTC72>=0、Symbol72>=0、Symbol24<=${pullbackMax}%でLong`,
        side: (event) => event.score >= score
          && event.btc72hPct >= 0
          && event.symbol72hPct >= 0
          && event.symbol24hPct <= pullbackMax
          ? "long"
          : null,
      });
    }
  }
  return result;
}

function simulate(event: Event, side: Side, exit: ExitSpec, data: PerpMarketData): Outcome | null {
  const candles = data.bySymbol[event.symbol] || [];
  const entryIndex = indexAtOrBefore(candles, event.entryTs);
  if (entryIndex < 0) return null;
  const entryPrice = candles[entryIndex].open;
  const lastIndex = Math.min(candles.length - 1, entryIndex + exit.maxHoldHours - 1);
  if (!(entryPrice > 0) || lastIndex <= entryIndex) return null;
  const takePrice = exit.takeProfitPct
    ? entryPrice * (side === "long" ? 1 + exit.takeProfitPct / 100 : 1 - exit.takeProfitPct / 100)
    : undefined;
  const stopPrice = exit.stopLossPct
    ? entryPrice * (side === "long" ? 1 - exit.stopLossPct / 100 : 1 + exit.stopLossPct / 100)
    : undefined;
  let exitIndex = lastIndex;
  let exitPrice = candles[lastIndex].close;
  for (let index = entryIndex; index <= lastIndex; index += 1) {
    const candle = candles[index];
    const stopHit = stopPrice !== undefined && (side === "long" ? candle.low <= stopPrice : candle.high >= stopPrice);
    const takeHit = takePrice !== undefined && (side === "long" ? candle.high >= takePrice : candle.low <= takePrice);
    if (stopHit) {
      exitIndex = index;
      exitPrice = stopPrice!;
      break;
    }
    if (takeHit) {
      exitIndex = index;
      exitPrice = takePrice!;
      break;
    }
  }
  const exitTs = candles[exitIndex].ts + HOUR_MS - 1;
  const funding = fundingPct(data.fundingBySymbol[event.symbol] || [], event.entryTs, exitTs);
  const directionalPct = side === "long"
    ? ((exitPrice / entryPrice) - 1) * 100
    : ((entryPrice / exitPrice) - 1) * 100;
  const fundingCost = side === "long" ? funding : -funding;
  const normalCosts = ((FEE_BPS + SLIPPAGE_BPS) * 2) / 100;
  const stressCosts = ((FEE_BPS + STRESS_SLIPPAGE_BPS) * 2) / 100;
  return {
    symbol: event.symbol,
    side,
    entryTs: event.entryTs,
    returnPct: directionalPct - normalCosts - fundingCost,
    stressReturnPct: directionalPct - stressCosts - fundingCost,
  };
}

function metrics(outcomes: Outcome[]): Metrics {
  const values = outcomes.map((outcome) => outcome.returnPct);
  const stress = outcomes.map((outcome) => outcome.stressReturnPct);
  const wins = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);
  const stressWins = stress.filter((value) => value > 0);
  const stressLosses = stress.filter((value) => value < 0);
  const pf = losses.length ? wins.reduce((sum, value) => sum + value, 0) / Math.abs(losses.reduce((sum, value) => sum + value, 0)) : wins.length ? 999 : null;
  const stressPf = stressLosses.length ? stressWins.reduce((sum, value) => sum + value, 0) / Math.abs(stressLosses.reduce((sum, value) => sum + value, 0)) : stressWins.length ? 999 : null;
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of values) {
    equity *= Math.max(0.001, 1 + value / 100);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, ((equity / peak) - 1) * 100);
  }
  const symbolCounts = outcomes.reduce<Record<string, number>>((accumulator, outcome) => {
    accumulator[outcome.symbol] = (accumulator[outcome.symbol] || 0) + 1;
    return accumulator;
  }, {});
  return {
    count: values.length,
    winRatePct: values.length ? round((wins.length / values.length) * 100, 2) : null,
    averagePct: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    profitFactor: pf == null ? null : round(pf, 3),
    stressProfitFactor: stressPf == null ? null : round(stressPf, 3),
    compoundedReturnPct: values.length ? round((equity - 1) * 100) : null,
    maxDrawdownPct: values.length ? round(maxDrawdown) : null,
    longCount: outcomes.filter((outcome) => outcome.side === "long").length,
    shortCount: outcomes.filter((outcome) => outcome.side === "short").length,
    symbolCounts,
  };
}

function evaluate(events: Event[], router: Router, exit: ExitSpec, data: PerpMarketData): Evaluation {
  const outcomes = events
    .map((event) => {
      const side = router.side(event);
      return side ? simulate(event, side, exit, data) : null;
    })
    .filter((outcome): outcome is Outcome => outcome !== null)
    .sort((left, right) => left.entryTs - right.entryTs);
  return {
    routerId: router.id,
    routerDescription: router.description,
    exit,
    metrics: metrics(outcomes),
  };
}

function objective(item: Evaluation) {
  return (item.metrics.compoundedReturnPct ?? -9999)
    - Math.abs(item.metrics.maxDrawdownPct ?? -100) * 0.35
    + Math.min(5, item.metrics.profitFactor ?? 0) * 3;
}

function developmentPass(item: Evaluation) {
  return item.metrics.count >= 12
    && (item.metrics.averagePct ?? -1) > 0
    && (item.metrics.profitFactor ?? 0) >= 1.2
    && (item.metrics.stressProfitFactor ?? 0) >= 1;
}

function validationPass(item: Evaluation) {
  return item.metrics.count >= 5
    && (item.metrics.averagePct ?? -1) > 0
    && (item.metrics.profitFactor ?? 0) >= 1.1
    && (item.metrics.stressProfitFactor ?? 0) >= 1;
}

function table(items: Evaluation[]) {
  return [
    "| Router | Exit | N | L/S | Win | Avg | PF | Stress PF | Compound | DD |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...items.map((item) => `| ${item.routerId} | ${item.exit.id} | ${item.metrics.count} | ${item.metrics.longCount}/${item.metrics.shortCount} | ${item.metrics.winRatePct?.toFixed(2) ?? "—"}% | ${item.metrics.averagePct?.toFixed(2) ?? "—"}% | ${item.metrics.profitFactor?.toFixed(2) ?? "—"} | ${item.metrics.stressProfitFactor?.toFixed(2) ?? "—"} | ${item.metrics.compoundedReturnPct?.toFixed(2) ?? "—"}% | ${item.metrics.maxDrawdownPct?.toFixed(2) ?? "—"}% |`),
  ].join("\n");
}

async function main() {
  const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR || ".research-state");
  const data = await loadPerpMarketData({ symbols: DATA_SYMBOLS, startTs: DATA_START_TS, endTs: DATA_END_TS });
  const replay = buildMainStrategySnapshotReplay({
    data,
    config: {
      datasetId: "WIN80_REGIME_ROUTER_SOURCE_V1",
      symbols: SYMBOLS,
      startTs: START_TS,
      endTs: END_TS,
      intervalHours: 6,
      warmupHours: 48,
      sameSymbolCooldownHours: 24,
      feeBpsPerSide: FEE_BPS,
      slippageBpsPerSide: SLIPPAGE_BPS,
      stressSlippageBpsPerSide: STRESS_SLIPPAGE_BPS,
      historyHours: 30 * 24,
      maxEventsStored: 500,
    },
  });
  const events = enrich(replay.events, data).sort((left, right) => left.entryTs - right.entryTs);
  const developmentEnd = Math.floor(events.length * 0.5);
  const validationEnd = Math.floor(events.length * 0.75);
  const development = events.slice(0, developmentEnd);
  const validation = events.slice(developmentEnd, validationEnd);
  const holdout = events.slice(validationEnd);
  const routerList = routers();
  const exitList = exits();
  const developmentResults: Evaluation[] = [];
  for (const router of routerList) {
    for (const exit of exitList) developmentResults.push(evaluate(development, router, exit, data));
  }
  const shortlist = developmentResults.filter(developmentPass).sort((a, b) => objective(b) - objective(a)).slice(0, 40);
  const validationResults = shortlist
    .map((candidate) => evaluate(
      validation,
      routerList.find((router) => router.id === candidate.routerId)!,
      candidate.exit,
      data,
    ))
    .filter(validationPass)
    .sort((a, b) => objective(b) - objective(a));
  const selectedValidation = validationResults[0] ?? null;
  const selectedRouter = selectedValidation ? routerList.find((router) => router.id === selectedValidation.routerId)! : null;
  const selectedDevelopment = selectedValidation
    ? shortlist.find((item) => item.routerId === selectedValidation.routerId && item.exit.id === selectedValidation.exit.id) ?? null
    : null;
  const selectedHoldout = selectedValidation && selectedRouter ? evaluate(holdout, selectedRouter, selectedValidation.exit, data) : null;
  const selectedAll = selectedValidation && selectedRouter ? evaluate(events, selectedRouter, selectedValidation.exit, data) : null;
  const holdoutPass = Boolean(selectedHoldout
    && selectedHoldout.metrics.count >= 5
    && (selectedHoldout.metrics.averagePct ?? -1) > 0
    && (selectedHoldout.metrics.profitFactor ?? 0) >= 1
    && (selectedHoldout.metrics.stressProfitFactor ?? 0) >= 1);
  const baselineRouter = routerList[0];
  const baselineExit = exitList.find((exit) => exit.id === "FIXED_72H")!;
  const baseline = {
    development: evaluate(development, baselineRouter, baselineExit, data),
    validation: evaluate(validation, baselineRouter, baselineExit, data),
    holdout: evaluate(holdout, baselineRouter, baselineExit, data),
    all: evaluate(events, baselineRouter, baselineExit, data),
  };
  const result = {
    version: 1,
    generatedAt: new Date().toISOString(),
    status: holdoutPass ? "PAPER_CANDIDATE_ONLY" : "NO_ROBUST_REGIME_ROUTER",
    productionChanged: false,
    realTradingEnabled: false,
    source: {
      fingerprint: replay.fingerprint,
      totalEvents: events.length,
      developmentEvents: development.length,
      validationEvents: validation.length,
      holdoutEvents: holdout.length,
      routers: routerList.length,
      exits: exitList.length,
    },
    baseline,
    selected: selectedValidation ? {
      routerId: selectedValidation.routerId,
      description: selectedValidation.routerDescription,
      exit: selectedValidation.exit,
      development: selectedDevelopment,
      validation: selectedValidation,
      holdout: selectedHoldout,
      all: selectedAll,
      holdoutPass,
      liveGatePassed: false,
      liveGateReasons: [
        "凍結Holdout100件未満",
        "通貨別OOS30件未満",
        ...((selectedHoldout?.metrics.winRatePct ?? 0) < 70 ? ["Holdout勝率70%未達"] : []),
        ...((selectedHoldout?.metrics.profitFactor ?? 0) < 1.2 ? ["Holdout PF1.20未達"] : []),
      ],
    } : null,
    validationTop10: validationResults.slice(0, 10),
    limitations: [
      "現行Long Signalを起点に方向だけを切り替えるSibling研究であり、独立したShort Entryモデルではありません。",
      "同一期間内時系列分割で、完全な将来OOSではありません。",
      "Aster過去Order BookではなくBinance USD-M 1h OHLCV/Fundingを使用しています。",
      "Portfolioの50/50・70/30 Rotationは含みません。",
      "本番コード、runner、VPS、実売買フラグは変更していません。",
    ],
  };
  const selected = result.selected;
  const report = [
    "# WIN80 Regime Direction Router V1",
    "",
    `- Status: **${result.status}**`,
    `- Signals: ${events.length}`,
    `- Routers / exits: ${routerList.length} / ${exitList.length}`,
    "- Production changed: NO",
    "- Real trading: DISABLED",
    "",
    "## Baseline",
    "",
    table([baseline.development, baseline.validation, baseline.holdout, baseline.all]),
    "",
    "## Selected",
    "",
    ...(selected ? [
      `- Router: **${selected.routerId}** — ${selected.description}`,
      `- Exit: **${selected.exit.id}**`,
      `- Frozen holdout pass: **${selected.holdoutPass ? "YES" : "NO"}**`,
      `- Live gate: **BLOCKED**`,
      `- Reasons: ${selected.liveGateReasons.join(" / ")}`,
      "",
      table([selected.development!, selected.validation, selected.holdout!, selected.all!]),
    ] : ["Development/Validationを連続通過した方向Routerはありませんでした。"]),
    "",
    "## Validation top",
    "",
    validationResults.length ? table(validationResults.slice(0, 10)) : "Validation通過候補なし。",
    "",
    "## Conclusion",
    "",
    selected && selected.holdoutPass
      ? "方向別Routerで凍結Holdoutが改善し、Paper専用候補が残りました。ただしShort Entry自体は独立設計ではなく、サンプルGateも不足しているためLiveは禁止です。"
      : "Long/Short/Cashの単純な72時間Trend Routerでも、ValidationとHoldoutを連続通過する改善は確認できませんでした。新しいEntry特徴量と独立Shortモデルが必要です。",
    "",
    "## Limitations",
    "",
    ...result.limitations.map((item) => `- ${item}`),
  ].join("\n");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "win80-regime-router-v1.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "win80-regime-router-v1.md"), report, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `\n\n${report}`, "utf8");
  console.log(report);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
