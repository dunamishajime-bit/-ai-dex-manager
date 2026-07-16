import fs from "fs/promises";
import path from "path";

import { researchConfigFromEnvironment } from "../lib/research-lab/default-config";
import { HybridBacktestResearchAdapter } from "../lib/research-lab/hybrid-adapter";
import { runResearchLab } from "../lib/research-lab/orchestrator";
import type { ResearchLabResult, StrategyEvaluation } from "../lib/research-lab/types";

function safeTimestamp(value: string) {
  return value.replace(/[:.]/g, "-");
}

function renderValidation(item: StrategyEvaluation) {
  const validation = item.validation;
  if (!validation) return ["- OOS: 未検証", "- Stress: 未検証"];
  return [
    `- Validation average monthly: ${validation.validation.metrics.averageMonthlyReturnPct.toFixed(2)}%`,
    `- OOS average monthly: ${validation.oos.metrics.averageMonthlyReturnPct.toFixed(2)}%`,
    `- OOS median monthly: ${validation.oos.metrics.medianMonthlyReturnPct.toFixed(2)}%`,
    `- OOS target-month hit rate: ${validation.oos.metrics.targetMonthlyHitRatePct.toFixed(1)}%`,
    `- OOS MaxDD: ${validation.oos.metrics.maxDrawdownPct.toFixed(2)}%`,
    `- OOS retention: ${(validation.oosRetentionRatio * 100).toFixed(1)}%`,
    `- Walk-forward pass rate: ${validation.walkForwardPassRatePct.toFixed(1)}%`,
    `- Stress retention: ${(validation.stressRetentionRatio * 100).toFixed(1)}%`,
    `- Stress cases: ${validation.stress.map((stress) => `${stress.extraRoundTripCostBps}bps=${stress.metrics.averageMonthlyReturnPct.toFixed(2)}%`).join(" / ")}`,
    `- Final gate: ${validation.finalGateReasons.length ? validation.finalGateReasons.join(" / ") : "PASS"}`,
  ];
}

function renderCandidate(item: StrategyEvaluation, index: number) {
  const metrics = item.metrics;
  return [
    `### ${index + 1}. ${item.genome.id} / ${item.genome.family}`,
    "",
    `- Verdict: ${item.verdict}`,
    `- Score: ${item.score.toFixed(2)}`,
    `- CAGR: ${metrics.cagrPct.toFixed(2)}%`,
    `- Average monthly: ${metrics.averageMonthlyReturnPct.toFixed(2)}%`,
    `- Median monthly: ${metrics.medianMonthlyReturnPct.toFixed(2)}%`,
    `- 30% target-month hit rate: ${metrics.targetMonthlyHitRatePct.toFixed(1)}%`,
    `- Rolling 3-month target hit rate: ${metrics.rolling3MonthTargetHitRatePct.toFixed(1)}%`,
    `- Best / Worst month: ${metrics.bestMonthPct.toFixed(2)}% / ${metrics.worstMonthPct.toFixed(2)}%`,
    `- MaxDD: ${Math.abs(metrics.maxDrawdownPct).toFixed(2)}%`,
    `- Sharpe: ${metrics.sharpe.toFixed(2)}`,
    `- Sortino: ${metrics.sortino.toFixed(2)}`,
    `- Profit Factor: ${metrics.profitFactor.toFixed(2)}`,
    `- Trades: ${metrics.tradeCount}`,
    `- Positive Months: ${metrics.positiveMonthPct.toFixed(1)}%`,
    `- Validation: ${item.validationLevel}`,
    ...renderValidation(item),
    `- Researcher: ${item.genome.createdBy}`,
    `- Thesis: ${item.genome.thesis}`,
    `- Rejection: ${item.rejectionReasons.length ? item.rejectionReasons.join(" / ") : "none"}`,
    "",
  ].join("\n");
}

function renderMarkdown(result: ResearchLabResult) {
  const candidateCount = result.leaderboard.filter((item) => item.verdict !== "rejected").length;
  const target = result.config.thresholds.targetAverageMonthlyReturnPct;
  return [
    "# DisdexManager V2 - AI Hedge Fund Research Lab",
    "",
    `- Started: ${result.startedAt}`,
    `- Completed: ${result.completedAt}`,
    `- Research target: average monthly return ${target}%+`,
    `- Final OOS requirement: ${result.config.thresholds.finalMinOosAverageMonthlyReturnPct}%+ average monthly`,
    `- Final stress requirement: ${result.config.thresholds.finalMinStressAverageMonthlyReturnPct}%+ average monthly`,
    `- Rounds: ${result.config.rounds}`,
    `- Population per round: ${result.config.populationPerRound}`,
    `- Total discovery evaluations: ${result.totalEvaluations}`,
    `- Validated strategies: ${result.validatedStrategies}`,
    `- Candidates: ${candidateCount}`,
    `- Final candidates: ${result.finalCandidates.length}`,
    `- Cache: hits=${result.cacheStats?.hits ?? 0} misses=${result.cacheStats?.misses ?? 0} entries=${result.cacheStats?.entries ?? 0}`,
    "",
    "## Round Summary",
    "",
    "| Round | Evaluated | Rejected | Candidates | Best Score | Best CAGR | Best Avg Month | Best DD |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...result.rounds.map((round) => {
      const best = round.best;
      return `| ${round.round} | ${round.evaluated} | ${round.rejected} | ${round.candidates} | ${best?.score.toFixed(2) ?? "-"} | ${best?.metrics.cagrPct.toFixed(2) ?? "-"}% | ${best?.metrics.averageMonthlyReturnPct.toFixed(2) ?? "-"}% | ${best ? Math.abs(best.metrics.maxDrawdownPct).toFixed(2) : "-"}% |`;
    }),
    "",
    "## Leaderboard",
    "",
    ...result.leaderboard.slice(0, 20).map(renderCandidate),
    "## CIO Note",
    "",
    result.finalCandidates.length
      ? `OOS平均月利${target}%目標、Walk-forward、追加コストストレスまで通過した最終候補があります。実運用への昇格はForward Paperと別承認工程で行ってください。`
      : `月利${target}%は研究目標であり、現時点では最終条件を満たす戦略はありません。OOSやストレス未通過の高収益値は採用しません。`,
    "",
  ].join("\n");
}

async function main() {
  const config = researchConfigFromEnvironment();
  const adapter = new HybridBacktestResearchAdapter();
  console.log(
    `[ResearchLab] profile=${process.env.RESEARCH_PROFILE ?? "smoke"} rounds=${config.rounds} population=${config.populationPerRound} targetMonthly=${config.thresholds.targetAverageMonthlyReturnPct}%`,
  );

  const result = await runResearchLab(config, adapter);
  const outDir = path.join(process.cwd(), "reports", "research-lab", safeTimestamp(result.startedAt));
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(outDir, "report.md"), renderMarkdown(result), "utf8");

  console.log(`[ResearchLab] completed evaluations=${result.totalEvaluations} validated=${result.validatedStrategies}`);
  console.log(`[ResearchLab] finalCandidates=${result.finalCandidates.length}`);
  console.log(`[ResearchLab] report=${path.join(outDir, "report.md")}`);
}

main().catch((error) => {
  console.error("[ResearchLab] failed", error);
  process.exitCode = 1;
});
