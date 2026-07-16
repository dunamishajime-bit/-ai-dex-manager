import fs from "fs/promises";
import path from "path";

import { perpResearchConfigFromEnvironment } from "../lib/research-lab/perp/config";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { runPerpResearch } from "../lib/research-lab/perp/orchestrator";
import type { PerpResearchResult, PerpStrategyEvaluation } from "../lib/research-lab/perp/types";

function safeTimestamp(value: string) {
  return value.replace(/[:.]/g, "-");
}

function metricsLine(label: string, evaluation: PerpStrategyEvaluation) {
  const metrics = evaluation.train.metrics;
  const risk = evaluation.train.risk;
  return [
    `- ${label} average monthly: ${metrics.averageMonthlyReturnPct.toFixed(2)}%`,
    `- ${label} CAGR: ${metrics.cagrPct.toFixed(2)}%`,
    `- ${label} MaxDD: ${metrics.maxDrawdownPct.toFixed(2)}%`,
    `- ${label} Sharpe / PF: ${metrics.sharpe.toFixed(2)} / ${metrics.profitFactor.toFixed(2)}`,
    `- ${label} trades: ${metrics.tradeCount} (Long ${risk.longTrades} / Short ${risk.shortTrades})`,
    `- ${label} liquidation: ${risk.liquidationCount}`,
    `- ${label} leverage avg / max: ${risk.averageEffectiveLeverage.toFixed(2)}x / ${risk.maximumEffectiveLeverage.toFixed(2)}x`,
  ];
}

function renderEvaluation(item: PerpStrategyEvaluation, index: number) {
  const validation = item.validation;
  return [
    `### ${index + 1}. ${item.genome.id} / ${item.genome.family}`,
    "",
    `- Verdict: ${item.verdict}`,
    `- Score: ${item.score.toFixed(2)}`,
    `- Symbols: ${item.genome.symbols.join(", ")}`,
    `- Timeframe: ${item.genome.parameters.timeframeHours}h`,
    `- Requested leverage: ${item.genome.parameters.leverage.toFixed(2)}x`,
    `- Risk per trade: ${item.genome.parameters.riskPerTradePct.toFixed(2)}%`,
    ...metricsLine("Train", item),
    validation
      ? `- Validation average monthly: ${validation.validation.metrics.averageMonthlyReturnPct.toFixed(2)}%`
      : "- Validation: 未検証",
    validation ? `- OOS average monthly: ${validation.oos.metrics.averageMonthlyReturnPct.toFixed(2)}%` : "- OOS: 未検証",
    validation ? `- OOS CAGR / MaxDD: ${validation.oos.metrics.cagrPct.toFixed(2)}% / ${validation.oos.metrics.maxDrawdownPct.toFixed(2)}%` : "",
    validation ? `- OOS Long / Short / Liquidation: ${validation.oos.risk.longTrades} / ${validation.oos.risk.shortTrades} / ${validation.oos.risk.liquidationCount}` : "",
    validation ? `- Walk-forward pass rate: ${validation.walkForwardPassRatePct.toFixed(1)}%` : "",
    validation ? `- OOS retention: ${(validation.oosReturnRetentionRatio * 100).toFixed(1)}%` : "",
    validation ? `- Stress retention: ${(validation.stressReturnRetentionRatio * 100).toFixed(1)}%` : "",
    validation
      ? `- Stress monthly: ${validation.stress.map((stress) => `${stress.label}=${stress.result.metrics.averageMonthlyReturnPct.toFixed(2)}%`).join(" / ")}`
      : "",
    validation
      ? `- Final gate: ${validation.finalGateReasons.length ? validation.finalGateReasons.join(" / ") : "PASS"}`
      : "",
    `- Discovery reasons: ${item.reasons.length ? item.reasons.join(" / ") : "none"}`,
    `- Thesis: ${item.genome.thesis}`,
    "",
  ].filter(Boolean).join("\n");
}

function renderMarkdown(result: PerpResearchResult) {
  const target = result.config.thresholds.targetAverageMonthlyReturnPct;
  return [
    "# DisdexManager V2 - Phase 3 Perpetual Long / Short Research",
    "",
    `- Started: ${result.startedAt}`,
    `- Completed: ${result.completedAt}`,
    `- Target average monthly: ${target}%+`,
    `- Period: ${new Date(result.config.startTs).toISOString()} - ${new Date(result.config.endTs).toISOString()}`,
    `- Symbols: ${result.config.symbols.join(", ")}`,
    `- Discovery evaluations: ${result.totalEvaluations}`,
    `- Validated strategies: ${result.validatedStrategies}`,
    `- Final candidates: ${result.finalCandidates.length}`,
    `- Base execution: fee ${result.config.baseExecution.feeBpsPerSide}bps/side, slippage ${result.config.baseExecution.slippageBpsPerSide}bps/side, adverse funding ${result.config.baseExecution.adverseFundingBpsPer8h}bps/8h`,
    "",
    "## Round Summary",
    "",
    "| Round | Evaluated | Survivors | Best Score | Best Avg Month | Best CAGR | Best DD | Trades | Liquidations |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...result.rounds.map((round) => {
      const best = round.best;
      return `| ${round.round} | ${round.evaluated} | ${round.survivors} | ${best?.score.toFixed(2) ?? "-"} | ${best?.train.metrics.averageMonthlyReturnPct.toFixed(2) ?? "-"}% | ${best?.train.metrics.cagrPct.toFixed(2) ?? "-"}% | ${best?.train.metrics.maxDrawdownPct.toFixed(2) ?? "-"}% | ${best?.train.metrics.tradeCount ?? "-"} | ${best?.train.risk.liquidationCount ?? "-"} |`;
    }),
    "",
    "## Leaderboard",
    "",
    ...result.leaderboard.slice(0, 20).map(renderEvaluation),
    "## CIO Decision",
    "",
    result.finalCandidates.length
      ? `OOS平均月利${target}%、DD、Long/Short、Funding・Fee・Slippage stress、清算0件を通過した最終研究候補があります。実売買ではなくForward Paperへ進めます。`
      : `最終候補はありません。Trainの高収益値だけでは採用せず、OOS・Stress・清算Gateの失敗理由を次世代へ反映します。`,
    "",
  ].join("\n");
}

async function main() {
  const config = perpResearchConfigFromEnvironment();
  console.log(
    `[PerpResearch] rounds=${config.rounds} population=${config.populationPerRound} symbols=${config.symbols.length} targetMonthly=${config.thresholds.targetAverageMonthlyReturnPct}%`,
  );
  const data = await loadPerpMarketData({
    symbols: config.symbols,
    startTs: config.startTs,
    endTs: config.endTs,
  });
  const result = await runPerpResearch(config, data);
  const outDir = path.join(process.cwd(), "reports", "research-lab-perp", safeTimestamp(result.startedAt));
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(outDir, "report.md"), renderMarkdown(result), "utf8");
  console.log(`[PerpResearch] completed evaluations=${result.totalEvaluations} validated=${result.validatedStrategies}`);
  console.log(`[PerpResearch] finalCandidates=${result.finalCandidates.length}`);
  console.log(`[PerpResearch] report=${path.join(outDir, "report.md")}`);
}

main().catch((error) => {
  console.error("[PerpResearch] failed", error);
  process.exitCode = 1;
});
