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
const FEE_BPS_PER_SIDE = 6;
const SLIPPAGE_BPS_PER_SIDE = 4;
const STRESS_SLIPPAGE_BPS_PER_SIDE = 12;

type ExitSpec = {
  id: string;
  maxHoldHours: number;
  takeProfitPct?: number;
  stopLossPct?: number;
};

type FeatureEvent = MainStrategySnapshotReplayEvent & {
  btc24hPct: number;
  btc72hPct: number;
  symbol24hPct: number;
  symbol72hPct: number;
  realizedVol24hPct: number;
  atr24hPct: number;
  trailingFunding24hPct: number;
};

type FilterRule = {
  id: string;
  description: string;
  test: (event: FeatureEvent) => boolean;
};

type TradeOutcome = {
  symbol: string;
  entryTs: number;
  exitTs: number;
  returnPct: number;
  stressReturnPct: number;
  exitReason: string;
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
  symbolCounts: Record<string, number>;
};

type Evaluation = {
  filterId: string;
  filterDescription: string;
  exit: ExitSpec;
  metrics: Metrics;
};

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function indexAtOrBefore(candles: Candle1h[], ts: number) {
  let low = 0;
  let high = candles.length - 1;
  let answer = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].ts <= ts) {
      answer = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer;
}

function pastReturnPct(candles: Candle1h[], ts: number, hours: number) {
  const index = indexAtOrBefore(candles, ts);
  const previous = index - hours;
  if (index < 0 || previous < 0 || candles[previous].close <= 0) return 0;
  return ((candles[index].close / candles[previous].close) - 1) * 100;
}

function realizedVolPct(candles: Candle1h[], ts: number, hours: number) {
  const index = indexAtOrBefore(candles, ts);
  if (index < hours) return 0;
  const returns: number[] = [];
  for (let current = index - hours + 1; current <= index; current += 1) {
    const previous = candles[current - 1]?.close;
    const close = candles[current]?.close;
    if (previous > 0 && close > 0) returns.push(Math.log(close / previous));
  }
  return standardDeviation(returns) * Math.sqrt(hours) * 100;
}

function atrPct(candles: Candle1h[], ts: number, hours: number) {
  const index = indexAtOrBefore(candles, ts);
  if (index < hours) return 0;
  const ranges: number[] = [];
  for (let current = index - hours + 1; current <= index; current += 1) {
    const candle = candles[current];
    const previousClose = candles[current - 1]?.close ?? candle.open;
    ranges.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    ));
  }
  return candles[index].close > 0 ? (mean(ranges) / candles[index].close) * 100 : 0;
}

function fundingPct(points: PerpFundingPoint[], startTs: number, endTs: number) {
  return points
    .filter((point) => point.ts >= startTs && point.ts <= endTs)
    .reduce((sum, point) => sum + point.rate * 100, 0);
}

function addFeatures(events: MainStrategySnapshotReplayEvent[], data: PerpMarketData): FeatureEvent[] {
  const btc = data.bySymbol.BTC || [];
  return events.map((event) => {
    const candles = data.bySymbol[event.symbol] || [];
    return {
      ...event,
      btc24hPct: round(pastReturnPct(btc, event.snapshotTs, 24)),
      btc72hPct: round(pastReturnPct(btc, event.snapshotTs, 72)),
      symbol24hPct: round(pastReturnPct(candles, event.snapshotTs, 24)),
      symbol72hPct: round(pastReturnPct(candles, event.snapshotTs, 72)),
      realizedVol24hPct: round(realizedVolPct(candles, event.snapshotTs, 24)),
      atr24hPct: round(atrPct(candles, event.snapshotTs, 24)),
      trailingFunding24hPct: round(fundingPct(
        data.fundingBySymbol[event.symbol] || [],
        event.snapshotTs - 24 * HOUR_MS,
        event.snapshotTs,
      )),
    };
  });
}

function simulateTrade(event: FeatureEvent, data: PerpMarketData, exit: ExitSpec): TradeOutcome | null {
  const candles = data.bySymbol[event.symbol] || [];
  const entryIndex = candles.findIndex((candle) => candle.ts === event.entryTs);
  if (entryIndex < 0) return null;
  const entryPrice = candles[entryIndex].open;
  if (!(entryPrice > 0)) return null;
  const lastIndex = Math.min(candles.length - 1, entryIndex + exit.maxHoldHours - 1);
  if (lastIndex <= entryIndex) return null;

  let exitIndex = lastIndex;
  let exitPrice = candles[lastIndex].close;
  let exitReason = `TIME_${exit.maxHoldHours}H`;
  const takeProfitPrice = exit.takeProfitPct ? entryPrice * (1 + exit.takeProfitPct / 100) : undefined;
  const stopLossPrice = exit.stopLossPct ? entryPrice * (1 - exit.stopLossPct / 100) : undefined;

  for (let index = entryIndex; index <= lastIndex; index += 1) {
    const candle = candles[index];
    const stopHit = stopLossPrice !== undefined && candle.low <= stopLossPrice;
    const takeHit = takeProfitPrice !== undefined && candle.high >= takeProfitPrice;
    if (stopHit) {
      exitIndex = index;
      exitPrice = stopLossPrice!;
      exitReason = `SL_${exit.stopLossPct}`;
      break;
    }
    if (takeHit) {
      exitIndex = index;
      exitPrice = takeProfitPrice!;
      exitReason = `TP_${exit.takeProfitPct}`;
      break;
    }
  }

  const exitTs = candles[exitIndex].ts + HOUR_MS - 1;
  const fundingCostPct = fundingPct(data.fundingBySymbol[event.symbol] || [], event.entryTs, exitTs);
  const rawPct = ((exitPrice / entryPrice) - 1) * 100;
  const normalCostPct = ((FEE_BPS_PER_SIDE + SLIPPAGE_BPS_PER_SIDE) * 2) / 100;
  const stressCostPct = ((FEE_BPS_PER_SIDE + STRESS_SLIPPAGE_BPS_PER_SIDE) * 2) / 100;
  return {
    symbol: event.symbol,
    entryTs: event.entryTs,
    exitTs,
    returnPct: rawPct - normalCostPct - fundingCostPct,
    stressReturnPct: rawPct - stressCostPct - fundingCostPct,
    exitReason,
  };
}

function metrics(outcomes: TradeOutcome[]): Metrics {
  const values = outcomes.map((outcome) => outcome.returnPct);
  const stressValues = outcomes.map((outcome) => outcome.stressReturnPct);
  const wins = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);
  const stressWins = stressValues.filter((value) => value > 0);
  const stressLosses = stressValues.filter((value) => value < 0);
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
  const pf = losses.length ? wins.reduce((sum, value) => sum + value, 0) / Math.abs(losses.reduce((sum, value) => sum + value, 0)) : wins.length ? 999 : null;
  const stressPf = stressLosses.length ? stressWins.reduce((sum, value) => sum + value, 0) / Math.abs(stressLosses.reduce((sum, value) => sum + value, 0)) : stressWins.length ? 999 : null;
  return {
    count: values.length,
    winRatePct: values.length ? round((wins.length / values.length) * 100, 2) : null,
    averagePct: values.length ? round(mean(values)) : null,
    medianPct: values.length ? round(median(values)) : null,
    profitFactor: pf == null ? null : round(pf, 3),
    stressProfitFactor: stressPf == null ? null : round(stressPf, 3),
    stressAveragePct: stressValues.length ? round(mean(stressValues)) : null,
    compoundedReturnPct: values.length ? round((equity - 1) * 100) : null,
    maxDrawdownPct: values.length ? round(maxDrawdown) : null,
    bestPct: values.length ? round(Math.max(...values)) : null,
    worstPct: values.length ? round(Math.min(...values)) : null,
    symbolCounts,
  };
}

function buildExitSpecs(): ExitSpec[] {
  const specs: ExitSpec[] = [24, 48, 72, 120, 168].map((hours) => ({
    id: `FIXED_${hours}H`,
    maxHoldHours: hours,
  }));
  for (const maxHoldHours of [24, 48, 72, 120]) {
    for (const takeProfitPct of [2, 3, 4, 5, 6, 8]) {
      for (const stopLossPct of [2, 3, 4, 5, 6, 8]) {
        specs.push({
          id: `TP${takeProfitPct}_SL${stopLossPct}_${maxHoldHours}H`,
          maxHoldHours,
          takeProfitPct,
          stopLossPct,
        });
      }
    }
  }
  return specs;
}

function buildFilterRules(): FilterRule[] {
  const rules: FilterRule[] = [{ id: "ALL", description: "現行全Signal", test: () => true }];
  const scoreValues = [80, 82, 84, 86, 88, 90];
  for (const score of scoreValues) {
    rules.push({ id: `SCORE_${score}`, description: `Score>=${score}`, test: (event) => event.score >= score });
  }
  for (const score of [80, 82, 84, 86]) {
    for (const rr of [1.2, 1.5, 2, 3]) {
      for (const volume of [0.72, 0.9, 1.2, 1.5, 2]) {
        rules.push({
          id: `QUALITY_S${score}_R${rr}_V${volume}`,
          description: `Score>=${score}, RR>=${rr}, Volume>=${volume}`,
          test: (event) => event.score >= score && event.rr >= rr && event.volumeRatio >= volume,
        });
      }
    }
  }
  for (const score of [80, 82, 84, 86]) {
    for (const symbol72 of [0, 3, 5]) {
      for (const btc72 of [0, 3]) {
        rules.push({
          id: `TREND_S${score}_SYM72_${symbol72}_BTC72_${btc72}`,
          description: `Score>=${score}, Symbol72>=${symbol72}%, BTC72>=${btc72}%`,
          test: (event) => event.score >= score && event.symbol72hPct >= symbol72 && event.btc72hPct >= btc72,
        });
      }
    }
  }
  for (const score of [80, 82, 84]) {
    for (const symbol72 of [3, 5]) {
      for (const symbol24Max of [0, -2]) {
        for (const rr of [1.2, 1.5, 2]) {
          rules.push({
            id: `PULLBACK_S${score}_SYM72_${symbol72}_SYM24_${symbol24Max}_R${rr}`,
            description: `上昇72h中の押し目: Score>=${score}, Symbol72>=${symbol72}%, Symbol24<=${symbol24Max}%, BTC72>=0%, RR>=${rr}`,
            test: (event) => event.score >= score
              && event.symbol72hPct >= symbol72
              && event.symbol24hPct <= symbol24Max
              && event.btc72hPct >= 0
              && event.rr >= rr,
          });
        }
      }
    }
  }
  for (const score of [80, 82, 84]) {
    for (const rr of [1.2, 1.5, 2]) {
      for (const fundingMax of [0.02, 0.05, 0.1]) {
        rules.push({
          id: `COST_TREND_S${score}_R${rr}_F${fundingMax}`,
          description: `Score>=${score}, RR>=${rr}, BTC72/Symbol72>=0, 過去24hFunding<=${fundingMax}%`,
          test: (event) => event.score >= score
            && event.rr >= rr
            && event.btc72hPct >= 0
            && event.symbol72hPct >= 0
            && event.trailingFunding24hPct <= fundingMax,
        });
      }
    }
  }
  for (const symbol of ["ETH", "SOL"] as const) {
    for (const score of [80, 82, 84, 86, 88]) {
      rules.push({
        id: `${symbol}_SCORE_${score}`,
        description: `${symbol}のみ Score>=${score}`,
        test: (event) => event.symbol === symbol && event.score >= score,
      });
    }
  }
  return rules;
}

function evaluate(events: FeatureEvent[], data: PerpMarketData, rule: FilterRule, exit: ExitSpec): Evaluation {
  const outcomes = events
    .filter(rule.test)
    .map((event) => simulateTrade(event, data, exit))
    .filter((outcome): outcome is TradeOutcome => outcome !== null)
    .sort((left, right) => left.entryTs - right.entryTs);
  return {
    filterId: rule.id,
    filterDescription: rule.description,
    exit,
    metrics: metrics(outcomes),
  };
}

function objective(item: Evaluation) {
  const value = item.metrics.compoundedReturnPct ?? -9999;
  const drawdownPenalty = Math.abs(item.metrics.maxDrawdownPct ?? -100) * 0.35;
  const pfBonus = Math.min(5, item.metrics.profitFactor ?? 0) * 3;
  return value - drawdownPenalty + pfBonus;
}

function passesDevelopment(item: Evaluation) {
  return item.metrics.count >= 12
    && (item.metrics.averagePct ?? -1) > 0
    && (item.metrics.profitFactor ?? 0) >= 1.2
    && (item.metrics.stressProfitFactor ?? 0) >= 1;
}

function passesValidation(item: Evaluation) {
  return item.metrics.count >= 5
    && (item.metrics.averagePct ?? -1) > 0
    && (item.metrics.profitFactor ?? 0) >= 1.1
    && (item.metrics.stressProfitFactor ?? 0) >= 1;
}

function markdownTable(items: Evaluation[]) {
  const rows = [
    "| Filter | Exit | N | Win | Avg | PF | Stress PF | Compound | MaxDD |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const item of items) {
    rows.push(`| ${item.filterId} | ${item.exit.id} | ${item.metrics.count} | ${item.metrics.winRatePct?.toFixed(2) ?? "—"}% | ${item.metrics.averagePct?.toFixed(2) ?? "—"}% | ${item.metrics.profitFactor?.toFixed(2) ?? "—"} | ${item.metrics.stressProfitFactor?.toFixed(2) ?? "—"} | ${item.metrics.compoundedReturnPct?.toFixed(2) ?? "—"}% | ${item.metrics.maxDrawdownPct?.toFixed(2) ?? "—"}% |`);
  }
  return rows.join("\n");
}

async function main() {
  const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR || ".research-state");
  const data = await loadPerpMarketData({
    symbols: DATA_SYMBOLS,
    startTs: DATA_START_TS,
    endTs: DATA_END_TS,
  });
  const replay = buildMainStrategySnapshotReplay({
    data,
    config: {
      datasetId: "WIN80_PROFIT_OPTIMIZATION_SOURCE_V1",
      symbols: SYMBOLS,
      startTs: START_TS,
      endTs: END_TS,
      intervalHours: 6,
      warmupHours: 48,
      sameSymbolCooldownHours: 24,
      feeBpsPerSide: FEE_BPS_PER_SIDE,
      slippageBpsPerSide: SLIPPAGE_BPS_PER_SIDE,
      stressSlippageBpsPerSide: STRESS_SLIPPAGE_BPS_PER_SIDE,
      historyHours: 30 * 24,
      maxEventsStored: 500,
    },
  });
  const events = addFeatures(replay.events, data).sort((left, right) => left.entryTs - right.entryTs);
  const developmentEnd = Math.floor(events.length * 0.5);
  const validationEnd = Math.floor(events.length * 0.75);
  const development = events.slice(0, developmentEnd);
  const validation = events.slice(developmentEnd, validationEnd);
  const holdout = events.slice(validationEnd);
  const rules = buildFilterRules();
  const exits = buildExitSpecs();

  const developmentResults: Evaluation[] = [];
  for (const rule of rules) {
    for (const exit of exits) developmentResults.push(evaluate(development, data, rule, exit));
  }
  const developmentShortlist = developmentResults
    .filter(passesDevelopment)
    .sort((left, right) => objective(right) - objective(left))
    .slice(0, 40);

  const validationResults = developmentShortlist
    .map((candidate) => {
      const rule = rules.find((item) => item.id === candidate.filterId)!;
      return evaluate(validation, data, rule, candidate.exit);
    })
    .filter(passesValidation)
    .sort((left, right) => objective(right) - objective(left));

  const selectedValidation = validationResults[0] ?? null;
  const selectedRule = selectedValidation ? rules.find((item) => item.id === selectedValidation.filterId)! : null;
  const selectedDevelopment = selectedValidation
    ? developmentShortlist.find((item) => item.filterId === selectedValidation.filterId && item.exit.id === selectedValidation.exit.id) ?? null
    : null;
  const selectedHoldout = selectedValidation && selectedRule
    ? evaluate(holdout, data, selectedRule, selectedValidation.exit)
    : null;
  const selectedAll = selectedValidation && selectedRule
    ? evaluate(events, data, selectedRule, selectedValidation.exit)
    : null;

  const baselineExit: ExitSpec = { id: "FIXED_72H", maxHoldHours: 72 };
  const baselineRule = rules[0];
  const baselineDevelopment = evaluate(development, data, baselineRule, baselineExit);
  const baselineValidation = evaluate(validation, data, baselineRule, baselineExit);
  const baselineHoldout = evaluate(holdout, data, baselineRule, baselineExit);
  const baselineAll = evaluate(events, data, baselineRule, baselineExit);

  const holdoutPass = Boolean(selectedHoldout
    && selectedHoldout.metrics.count >= 5
    && (selectedHoldout.metrics.averagePct ?? -1) > 0
    && (selectedHoldout.metrics.profitFactor ?? 0) >= 1
    && (selectedHoldout.metrics.stressProfitFactor ?? 0) >= 1);
  const perSymbolOosEnough = Boolean(selectedHoldout
    && Object.values(selectedHoldout.metrics.symbolCounts).every((count) => count >= 30));
  const liveGatePassed = holdoutPass
    && (selectedHoldout?.metrics.count ?? 0) >= 100
    && perSymbolOosEnough
    && (selectedHoldout?.metrics.winRatePct ?? 0) >= 70
    && (selectedHoldout?.metrics.profitFactor ?? 0) >= 1.2
    && (selectedHoldout?.metrics.stressProfitFactor ?? 0) >= 1;

  const result = {
    version: 1,
    generatedAt: new Date().toISOString(),
    status: liveGatePassed ? "LIVE_GATE_PASSED" : holdoutPass ? "PAPER_CANDIDATE_ONLY" : "NO_ROBUST_IMPROVEMENT",
    productionChanged: false,
    realTradingEnabled: false,
    source: {
      replayFingerprint: replay.fingerprint,
      totalEvents: events.length,
      developmentEvents: development.length,
      validationEvents: validation.length,
      holdoutEvents: holdout.length,
      split: "50% development / 25% validation / 25% frozen holdout",
      candidateFilters: rules.length,
      exitSpecs: exits.length,
    },
    baseline: {
      development: baselineDevelopment,
      validation: baselineValidation,
      holdout: baselineHoldout,
      all: baselineAll,
    },
    selected: selectedValidation ? {
      filterId: selectedValidation.filterId,
      description: selectedValidation.filterDescription,
      exit: selectedValidation.exit,
      development: selectedDevelopment,
      validation: selectedValidation,
      holdout: selectedHoldout,
      all: selectedAll,
      holdoutPass,
      liveGatePassed,
      liveGateReasons: [
        ...((selectedHoldout?.metrics.count ?? 0) < 100 ? ["凍結Holdout取引数が100件未満"] : []),
        ...(!perSymbolOosEnough ? ["通貨別Holdout件数30件未満"] : []),
        ...((selectedHoldout?.metrics.winRatePct ?? 0) < 70 ? ["Holdout勝率70%未達"] : []),
        ...((selectedHoldout?.metrics.profitFactor ?? 0) < 1.2 ? ["Holdout PF1.20未達"] : []),
        ...((selectedHoldout?.metrics.stressProfitFactor ?? 0) < 1 ? ["Holdout Stress PF1.00未達"] : []),
      ],
    } : null,
    validationTop10: validationResults.slice(0, 10),
    limitations: [
      "同一2025-07-01〜2026-04-07期間内の時系列分割であり、完全に新しい将来期間ではありません。",
      "Asterの過去Order BookではなくBinance USD-M 1h OHLCV/Fundingを使用しています。",
      "同一1時間足でTPとSLが両方到達した場合は保守的にSL先行としています。",
      "発注額98%・50/50分割・70/30 Rotationを含む口座Portfolio全体ではなく、独立SignalのEntry/Exit改善検証です。",
      "本番コード、実売買runner、.env、VPS、実売買フラグは変更していません。",
    ],
  };

  const selected = result.selected;
  const report = [
    "# WIN80 / ULTRA90 Profit Optimization V1",
    "",
    `- Status: **${result.status}**`,
    `- Source events: ${events.length}`,
    `- Split: ${result.source.split}`,
    `- Filters / exits tested: ${rules.length} / ${exits.length}`,
    `- Production changed: NO`,
    `- Real trading: DISABLED`,
    "",
    "## Baseline — current signals, fixed 72h",
    "",
    markdownTable([baselineDevelopment, baselineValidation, baselineHoldout, baselineAll]),
    "",
    "## Selected by development then validation",
    "",
    ...(selected ? [
      `- Filter: **${selected.filterId}** — ${selected.description}`,
      `- Exit: **${selected.exit.id}**`,
      `- Frozen holdout pass: **${selected.holdoutPass ? "YES" : "NO"}**`,
      `- Live gate: **${selected.liveGatePassed ? "PASS" : "BLOCKED"}**`,
      `- Live gate reasons: ${selected.liveGateReasons.join(" / ") || "none"}`,
      "",
      markdownTable([
        selected.development!,
        selected.validation,
        selected.holdout!,
        selected.all!,
      ]),
    ] : ["Development/Validationを連続通過した候補はありませんでした。"]),
    "",
    "## Validation top candidates",
    "",
    validationResults.length ? markdownTable(validationResults.slice(0, 10)) : "Validation通過候補なし。",
    "",
    "## Conclusion",
    "",
    selected && selected.holdoutPass
      ? "独立Signal検証ではPaper候補が残りました。ただし100件OOS・通貨別30件・勝率70%などのLive Gateを満たしていないため、本番採用は禁止です。"
      : "時系列Validationと凍結Holdoutを通じて、利益・PF・Stressを同時改善する堅牢な候補は確認できませんでした。現行ロジックを実売買へ進めず、特徴量またはEntry構造の再設計が必要です。",
    "",
    "## Limitations",
    "",
    ...result.limitations.map((item) => `- ${item}`),
  ].join("\n");

  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "win80-profit-optimization-v1.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "win80-profit-optimization-v1.md"), report, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, report, "utf8");
  }
  console.log(report);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
