import fs from "fs/promises";
import path from "path";

import {
  buildAutonomousInitialPopulation,
  createDefaultAutonomousState,
  normalizeAutonomousState,
  reflectAutonomousRun,
  type PerpAutonomousState,
} from "../lib/research-lab/perp/autonomous";
import { perpResearchConfigFromEnvironment } from "../lib/research-lab/perp/config";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { compactPerpBacktestResult } from "../lib/research-lab/perp/evidence";
import { runPerpResearch } from "../lib/research-lab/perp/orchestrator";
import type {
  PerpResearchResult,
  PerpStrategyEvaluation,
  PerpValidationReport,
} from "../lib/research-lab/perp/types";

function safeTimestamp(value: string) {
  return value.replace(/[:.]/g, "-");
}

async function readState(filePath: string): Promise<PerpAutonomousState> {
  try {
    return normalizeAutonomousState(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[AutonomousResearch] invalid state ignored: ${error instanceof Error ? error.message : String(error)}`);
    }
    return createDefaultAutonomousState();
  }
}

function compactValidation(validation: PerpValidationReport): PerpValidationReport {
  return {
    ...validation,
    train: compactPerpBacktestResult(validation.train),
    validation: compactPerpBacktestResult(validation.validation),
    oos: compactPerpBacktestResult(validation.oos),
    walkForward: validation.walkForward.map((item) => ({
      ...item,
      result: compactPerpBacktestResult(item.result),
    })),
    stress: validation.stress.map((item) => ({
      ...item,
      result: compactPerpBacktestResult(item.result),
    })),
  };
}

function compactEvaluation(item: PerpStrategyEvaluation): PerpStrategyEvaluation {
  return {
    ...item,
    train: compactPerpBacktestResult(item.train),
    validation: item.validation ? compactValidation(item.validation) : undefined,
  };
}

function compactResult(result: PerpResearchResult): PerpResearchResult {
  return {
    ...result,
    rounds: result.rounds.map((round) => ({
      ...round,
      best: round.best ? compactEvaluation(round.best) : null,
    })),
    leaderboard: result.leaderboard.slice(0, 40).map(compactEvaluation),
    finalCandidates: result.finalCandidates.map(compactEvaluation),
  };
}

function fundingCoverage(resultSymbols: string[], fundingBySymbol: Record<string, Array<{ ts: number }>>) {
  const counts = Object.fromEntries(resultSymbols.map((symbol) => [symbol, fundingBySymbol[symbol]?.length ?? 0]));
  const covered = resultSymbols.filter((symbol) => counts[symbol] > 0).length;
  return {
    counts,
    ratio: resultSymbols.length ? covered / resultSymbols.length : 0,
  };
}

async function writeGithubOutput(values: Record<string, string | number>) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  await fs.appendFile(
    outputPath,
    Object.entries(values).map(([key, value]) => `${key}=${String(value).replace(/\r?\n/g, " ")}\n`).join(""),
    "utf8",
  );
}

function candidateMarkdown(result: PerpResearchResult) {
  if (!result.finalCandidates.length) return "";
  return [
    `# Forward Paper Candidates (${result.finalCandidates.length})`,
    "",
    ...result.finalCandidates.map((item, index) => [
      `## ${index + 1}. ${item.genome.id}`,
      "",
      `- Family: ${item.genome.family}`,
      `- OOS average monthly: ${item.validation?.oos.metrics.averageMonthlyReturnPct.toFixed(2) ?? "n/a"}%`,
      `- OOS MaxDD: ${item.validation?.oos.metrics.maxDrawdownPct.toFixed(2) ?? "n/a"}%`,
      `- OOS trades: ${item.validation?.oos.metrics.tradeCount ?? 0}`,
      `- Long / Short: ${item.validation?.oos.risk.longTrades ?? 0} / ${item.validation?.oos.risk.shortTrades ?? 0}`,
      `- Liquidations: ${item.validation?.oos.risk.liquidationCount ?? 0}`,
      `- Walk-forward: ${item.validation?.walkForwardPassRatePct.toFixed(1) ?? "n/a"}%`,
      "",
    ].join("\n")),
    "These candidates are approved for Forward Paper only. Real trading remains disabled.",
    "",
  ].join("\n");
}

async function main() {
  const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR ?? ".research-state");
  const statePath = path.join(stateDir, "autonomous-state.json");
  const previous = await readState(statePath);
  process.env.PERP_RESEARCH_PROFILE ??= previous.nextProfile;

  const config = perpResearchConfigFromEnvironment();
  config.seed = previous.seed;
  const initialPopulation = buildAutonomousInitialPopulation(previous, config);

  console.log(
    `[AutonomousResearch] cycle=${previous.cycle + 1} profile=${config.profile} rounds=${config.rounds} population=${config.populationPerRound} seed=${config.seed}`,
  );

  const data = await loadPerpMarketData({
    symbols: config.symbols,
    startTs: config.startTs,
    endTs: config.endTs,
  });
  if (data.source !== "binance-usdm-futures") {
    throw new Error(`Autonomous research requires Binance USD-M Futures data, received ${data.source}`);
  }
  const coverage = fundingCoverage(config.symbols, data.fundingBySymbol);
  if ((data.fundingBySymbol.BTC?.length ?? 0) < 100) {
    throw new Error(`BTC funding history is insufficient: ${data.fundingBySymbol.BTC?.length ?? 0}`);
  }
  if (coverage.ratio < 0.7) {
    throw new Error(`Funding coverage is insufficient: ${(coverage.ratio * 100).toFixed(1)}%`);
  }

  const result = await runPerpResearch(config, data, {
    initialPopulation,
    generationOffset: previous.generationOffset,
  });
  const reflection = reflectAutonomousRun(previous, result);
  const compact = compactResult(result);
  const timestamp = safeTimestamp(result.startedAt);
  const reportDir = path.resolve("reports", "research-lab-autonomous", timestamp);

  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(reflection.state, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "latest-report.md"), reflection.markdown, "utf8");
  await fs.writeFile(path.join(stateDir, "latest-result.json"), JSON.stringify(compact, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "funding-coverage.json"), JSON.stringify(coverage, null, 2), "utf8");
  await fs.writeFile(
    path.join(stateDir, "forward-paper-candidates.json"),
    JSON.stringify(compact.finalCandidates, null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(stateDir, "forward-paper-candidates.md"), candidateMarkdown(compact), "utf8");
  await fs.writeFile(path.join(reportDir, "cycle-report.md"), reflection.markdown, "utf8");
  await fs.writeFile(path.join(reportDir, "result.json"), JSON.stringify(compact, null, 2), "utf8");

  const bestOos = reflection.summary.bestOosMonthlyPct ?? -100;
  await writeGithubOutput({
    run_status: "success",
    cycle: reflection.state.cycle,
    profile: config.profile,
    final_candidates: result.finalCandidates.length,
    best_oos_monthly: bestOos.toFixed(4),
    consecutive_no_candidate: reflection.state.consecutiveNoCandidate,
  });

  console.log(
    `[AutonomousResearch] completed cycle=${reflection.state.cycle} evaluations=${result.totalEvaluations} finalCandidates=${result.finalCandidates.length} bestOos=${bestOos.toFixed(2)}%`,
  );
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("[AutonomousResearch] failed", message);
  const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR ?? ".research-state");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(stateDir, "last-error.json"),
    JSON.stringify({ failedAt: new Date().toISOString(), message }, null, 2),
    "utf8",
  );
  await writeGithubOutput({ run_status: "failed", final_candidates: 0 });
  process.exitCode = 1;
});
