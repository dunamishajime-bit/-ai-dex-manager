import fs from "fs/promises";
import path from "path";

import { researchConfigFromEnvironment } from "../lib/research-lab/default-config";
import { HybridBacktestResearchAdapter } from "../lib/research-lab/hybrid-adapter";
import { runResearchLab } from "../lib/research-lab/orchestrator";
import type { ResearchLabResult, StrategyEvaluation } from "../lib/research-lab/types";

function safeTimestamp(value: string) {
  return value.replace(/[:.]/g, "-");
}

function renderCandidate(item: StrategyEvaluation, index: number) {
  const metrics = item.metrics;
  return [
    `### ${index + 1}. ${item.genome.id} / ${item.genome.family}`,
    "",
    `- Verdict: ${item.verdict}`,
    `- Score: ${item.score.toFixed(2)}`,
    `- CAGR: ${metrics.cagrPct.toFixed(2)}%`,
    `- MaxDD: ${Math.abs(metrics.maxDrawdownPct).toFixed(2)}%`,
    `- Sharpe: ${metrics.sharpe.toFixed(2)}`,
    `- Sortino: ${metrics.sortino.toFixed(2)}`,
    `- Profit Factor: ${metrics.profitFactor.toFixed(2)}`,
    `- Trades: ${metrics.tradeCount}`,
    `- Positive Months: ${metrics.positiveMonthPct.toFixed(1)}%`,
    `- Validation: ${item.validationLevel}`,
    `- Researcher: ${item.genome.createdBy}`,
    `- Thesis: ${item.genome.thesis}`,
    `- Rejection: ${item.rejectionReasons.length ? item.rejectionReasons.join(" / ") : "none"}`,
    "",
  ].join("\n");
}

function renderMarkdown(result: ResearchLabResult) {
  const candidateCount = result.leaderboard.filter((item) => item.verdict !== "rejected").length;
  return [
    "# DisdexManager V2 - AI Hedge Fund Research Lab",
    "",
    `- Started: ${result.startedAt}`,
    `- Completed: ${result.completedAt}`,
    `- Rounds: ${result.config.rounds}`,
    `- Population per round: ${result.config.populationPerRound}`,
    `- Total evaluations: ${result.totalEvaluations}`,
    `- Candidates: ${candidateCount}`,
    `- Final candidates: ${result.finalCandidates.length}`,
    "",
    "## Round Summary",
    "",
    "| Round | Evaluated | Rejected | Candidates | Best Score | Best CAGR | Best DD |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...result.rounds.map((round) => {
      const best = round.best;
      return `| ${round.round} | ${round.evaluated} | ${round.rejected} | ${round.candidates} | ${best?.score.toFixed(2) ?? "-"} | ${best?.metrics.cagrPct.toFixed(2) ?? "-"}% | ${best ? Math.abs(best.metrics.maxDrawdownPct).toFixed(2) : "-"}% |`;
    }),
    "",
    "## Leaderboard",
    "",
    ...result.leaderboard.slice(0, 20).map(renderCandidate),
    "## CIO Note",
    "",
    result.finalCandidates.length
      ? "独立期間検証とストレス検証まで通過した最終候補があります。実運用への昇格は別の承認工程で行ってください。"
      : "現段階は単発バックテスト中心です。候補が基準を通っても、独立期間検証と手数料・スリッページストレスを通過するまで最終採用しません。",
    "",
  ].join("\n");
}

async function main() {
  const config = researchConfigFromEnvironment();
  const adapter = new HybridBacktestResearchAdapter();
  console.log(`[ResearchLab] profile=${process.env.RESEARCH_PROFILE ?? "smoke"} rounds=${config.rounds} population=${config.populationPerRound}`);

  const result = await runResearchLab(config, adapter);
  const outDir = path.join(process.cwd(), "reports", "research-lab", safeTimestamp(result.startedAt));
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(outDir, "report.md"), renderMarkdown(result), "utf8");

  console.log(`[ResearchLab] completed evaluations=${result.totalEvaluations}`);
  console.log(`[ResearchLab] report=${path.join(outDir, "report.md")}`);
}

main().catch((error) => {
  console.error("[ResearchLab] failed", error);
  process.exitCode = 1;
});
