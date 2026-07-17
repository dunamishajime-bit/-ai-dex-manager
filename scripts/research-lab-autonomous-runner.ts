import fs from "fs/promises";
import path from "path";

import type { ResearchDiscussionIndex, ResearchDiscussionLog } from "../lib/research-lab/discussion-types";
import {
  createDefaultAutonomousState,
  normalizeAutonomousState,
  type PerpAutonomousState,
} from "../lib/research-lab/perp/autonomous";
import { perpResearchConfigFromEnvironment } from "../lib/research-lab/perp/config";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { reflectChampionDeepResearchRun } from "../lib/research-lab/perp/deep-autonomous";
import {
  createEmptyChampionDeepState,
  normalizeChampionDeepState,
  runChampionDeepResearch,
  type ChampionDeepResearchState,
} from "../lib/research-lab/perp/deep-research";
import { buildChampionDeepDiscussion } from "../lib/research-lab/perp/deep-discussion";
import {
  buildMainStrategyResearchAnchors,
  focusChampionStateOnMainStrategyLineage,
  focusPreviousResultOnMainStrategyLineage,
  isMainStrategyLineageGenome,
  MAIN_STRATEGY_RESEARCH_POLICY,
  mainStrategyResearchPolicyMarkdown,
} from "../lib/research-lab/perp/main-strategy-research-policy";
import { discussionIndexEntry } from "../lib/research-lab/perp/discussion";
import { compactPerpBacktestResult } from "../lib/research-lab/perp/evidence";
import {
  createEmptyPerpLogicRegistry,
  mergePerpLogicRegistry,
  normalizePerpLogicRegistry,
  type PerpLogicRegistry,
} from "../lib/research-lab/perp/logic-registry";
import type { PerpResearchDeduplicationStats } from "../lib/research-lab/perp/orchestrator";
import type {
  PerpResearchResult,
  PerpStrategyEvaluation,
  PerpValidationReport,
} from "../lib/research-lab/perp/types";

function safeTimestamp(value: string) {
  return value.replace(/[:.]/g, "-");
}

function integerEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

async function readState(filePath: string): Promise<PerpAutonomousState> {
  try {
    return normalizeAutonomousState(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[ChampionDeepResearch] invalid autonomous state ignored: ${error instanceof Error ? error.message : String(error)}`);
    }
    return createDefaultAutonomousState();
  }
}

async function readDeepState(filePath: string): Promise<ChampionDeepResearchState> {
  try {
    return normalizeChampionDeepState(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[ChampionDeepResearch] invalid deep state ignored: ${error instanceof Error ? error.message : String(error)}`);
    }
    return createEmptyChampionDeepState();
  }
}

async function readPreviousResult(filePath: string): Promise<PerpResearchResult | null> {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8")) as PerpResearchResult;
    return value && Array.isArray(value.leaderboard) && typeof value.completedAt === "string" ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[ChampionDeepResearch] invalid previous result ignored: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}

async function readLogicRegistry(filePath: string): Promise<PerpLogicRegistry> {
  try {
    return normalizePerpLogicRegistry(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[ChampionDeepResearch] invalid logic registry ignored: ${error instanceof Error ? error.message : String(error)}`);
    }
    return createEmptyPerpLogicRegistry();
  }
}

async function readDiscussionIndex(filePath: string): Promise<ResearchDiscussionIndex> {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<ResearchDiscussionIndex>;
    return {
      version: 1,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
      items: Array.isArray(value.items)
        ? value.items.filter((item) => item && typeof item.id === "string" && typeof item.path === "string")
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[ChampionDeepResearch] invalid discussion index ignored: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { version: 1, updatedAt: new Date(0).toISOString(), items: [] };
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

function deduplicationMarkdown(input: {
  stats: PerpResearchDeduplicationStats;
  registryBefore: PerpLogicRegistry;
  registryAfter: PerpLogicRegistry;
  added: number;
}) {
  return [
    "## Tested Logic Deduplication",
    "",
    `- Historical fingerprints loaded: ${input.registryBefore.fingerprints.length}`,
    `- New unique child logic tested this cycle: ${input.added}`,
    `- Duplicate or near-identical child logic skipped: ${input.stats.duplicateStrategiesSkipped}`,
    `- Alternative hypotheses considered: ${input.stats.replacementCandidatesGenerated}`,
    `- Total unique logic in registry: ${input.registryAfter.fingerprints.length}`,
    `- Unfilled experiment slots: ${input.stats.exhaustedPopulationSlots}`,
    "",
    "Parent baselines are deliberately re-evaluated for a fair same-cycle comparison but are not counted as new logic.",
    "",
  ].join("\n");
}

function discussionRelativePath(log: ResearchDiscussionLog) {
  const completed = new Date(log.completedAt);
  const year = String(completed.getUTCFullYear());
  const month = String(completed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(completed.getUTCDate()).padStart(2, "0");
  return path.posix.join("discussions", year, month, day, `${log.id}.json`);
}

function discussionMarkdown(log: ResearchDiscussionLog) {
  return [
    `# ${log.title}`,
    "",
    `- Completed: ${log.completedAt}`,
    `- Profile: ${log.profile}`,
    `- Final candidates: ${log.finalCandidates}`,
    `- Best OOS monthly: ${log.bestOosMonthlyPct == null ? "none" : `${log.bestOosMonthlyPct.toFixed(2)}%`}`,
    `- Best OOS MaxDD: ${log.bestOosDrawdownPct == null ? "none" : `${log.bestOosDrawdownPct.toFixed(2)}%`}`,
    `- Best Stress monthly: ${log.bestWorstStressMonthlyPct == null ? "none" : `${log.bestWorstStressMonthlyPct.toFixed(2)}%`}`,
    "",
    "## Methodology",
    "",
    log.methodology,
    "",
    "## Summary",
    "",
    log.summary,
    "",
    "## Decision",
    "",
    log.decision,
    "",
    "## Full Transcript",
    "",
    ...log.messages.flatMap((item) => [
      `### ${item.sequence}. ${item.speakerName} (${item.role})`,
      "",
      `- Time: ${item.createdAt}`,
      `- Strategy: ${item.strategyId ?? "cycle-wide"}`,
      `- Stance: ${item.stance}`,
      "",
      item.content,
      "",
      ...(item.evidence.length
        ? ["Evidence:", ...item.evidence.map((entry) => `- ${entry.label}: ${entry.value} [${entry.assessment}]`), ""]
        : []),
    ]),
  ].join("\n");
}

async function main() {
  const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR ?? ".research-state");
  const statePath = path.join(stateDir, "autonomous-state.json");
  const deepStatePath = path.join(stateDir, "champion-deep-state.json");
  const previousResultPath = path.join(stateDir, "latest-result.json");
  const logicRegistryPath = path.join(stateDir, "tested-logic-fingerprints.json");
  const discussionIndexPath = path.join(stateDir, "discussions", "index.json");
  const previous = await readState(statePath);
  const previousDeepState = await readDeepState(deepStatePath);
  const previousResult = await readPreviousResult(previousResultPath);
  const previousLogicRegistry = await readLogicRegistry(logicRegistryPath);
  const previousDiscussionIndex = await readDiscussionIndex(discussionIndexPath);
  process.env.PERP_RESEARCH_PROFILE ??= previous.nextProfile;

  const config = perpResearchConfigFromEnvironment();
  config.seed = previous.seed;
  config.rounds = 1;
  const mainStrategyAnchors = buildMainStrategyResearchAnchors(config);
  const focusedDeepState = focusChampionStateOnMainStrategyLineage(previousDeepState);
  const focusedPreviousResult = focusPreviousResultOnMainStrategyLineage(previousResult);
  const previousLineageElites = previous.eliteGenomes.filter(isMainStrategyLineageGenome);
  const championCount = integerEnv("PERP_DEEP_CHAMPIONS", 3, 1, 3);
  const experimentsPerChampion = integerEnv("PERP_DEEP_EXPERIMENTS_PER_CHAMPION", 2, 1, 3);
  const evaluatedLogicFingerprints = new Set<string>();
  const deduplicationStats: PerpResearchDeduplicationStats = {
    duplicateStrategiesSkipped: 0,
    replacementCandidatesGenerated: 0,
    exhaustedPopulationSlots: 0,
  };

  console.log(
    `[MainLineageResearch] cycle=${previous.cycle + 1} main=${MAIN_STRATEGY_RESEARCH_POLICY.mainStrategyId} profile=${config.profile} champions=${championCount} experimentsPerChampion=${experimentsPerChampion} previousLineageChampions=${focusedDeepState.champions.length} historicalLogic=${previousLogicRegistry.fingerprints.length}`,
  );

  const data = await loadPerpMarketData({
    symbols: config.symbols,
    startTs: config.startTs,
    endTs: config.endTs,
  });
  if (data.source !== "binance-usdm-futures") {
    throw new Error(`Champion deep research requires Binance USD-M Futures data, received ${data.source}`);
  }
  const coverage = fundingCoverage(config.symbols, data.fundingBySymbol);
  if ((data.fundingBySymbol.BTC?.length ?? 0) < 100) {
    throw new Error(`BTC funding history is insufficient: ${data.fundingBySymbol.BTC?.length ?? 0}`);
  }
  if (coverage.ratio < 0.7) {
    throw new Error(`Funding coverage is insufficient: ${(coverage.ratio * 100).toFixed(1)}%`);
  }

  const deep = await runChampionDeepResearch({
    cycle: previous.cycle + 1,
    previousState: focusedDeepState,
    previousResult: focusedPreviousResult,
    fallbackGenomes: [...mainStrategyAnchors, ...previousLineageElites],
    data,
    config,
    championCount,
    experimentsPerChampion,
    excludedLogicFingerprints: previousLogicRegistry.fingerprints,
    evaluatedLogicFingerprints,
    deduplicationStats,
  });
  const result = deep.researchResult;
  const reflection = reflectChampionDeepResearchRun(previous, deep);
  const discussion = buildChampionDeepDiscussion(deep);
  const discussionPath = discussionRelativePath(discussion);
  const discussionIndex: ResearchDiscussionIndex = {
    version: 1,
    updatedAt: result.completedAt,
    items: [
      discussionIndexEntry(discussion, discussionPath),
      ...previousDiscussionIndex.items.filter((item) => item.id !== discussion.id),
    ].sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt)),
  };
  const registryMerge = mergePerpLogicRegistry({
    previous: previousLogicRegistry,
    evaluatedFingerprints: evaluatedLogicFingerprints,
    duplicateStrategiesSkipped: deduplicationStats.duplicateStrategiesSkipped,
    updatedAt: result.completedAt,
  });
  const dedupReport = deduplicationMarkdown({
    stats: deduplicationStats,
    registryBefore: previousLogicRegistry,
    registryAfter: registryMerge.registry,
    added: registryMerge.added,
  });
  const reportMarkdown = `${mainStrategyResearchPolicyMarkdown()}\n\n${reflection.markdown}\n## Deep Discussion Summary\n\n${discussion.summary}\n\n**CIO Decision:** ${discussion.decision}\n\n${dedupReport}`;
  const compact = compactResult(result);
  const latestDeepEvidence = {
    version: 1,
    cycle: deep.cycle,
    startedAt: deep.startedAt,
    completedAt: deep.completedAt,
    profile: deep.profile,
    researchFocus: MAIN_STRATEGY_RESEARCH_POLICY,
    championsBefore: deep.championsBefore,
    championsAfter: deep.championsAfter,
    experiments: deep.experiments,
    nextPlan: deep.nextPlan,
  };
  const timestamp = safeTimestamp(result.startedAt);
  const reportDir = path.resolve("reports", "research-lab-autonomous", timestamp);
  const archivedDiscussionPath = path.join(stateDir, ...discussionPath.split("/"));

  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(reportDir, { recursive: true });
  await fs.mkdir(path.dirname(archivedDiscussionPath), { recursive: true });
  await fs.mkdir(path.dirname(discussionIndexPath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(reflection.state, null, 2), "utf8");
  await fs.writeFile(
    deepStatePath,
    JSON.stringify({ ...deep.state, researchFocus: MAIN_STRATEGY_RESEARCH_POLICY }, null, 2),
    "utf8",
  );
  await fs.writeFile(logicRegistryPath, JSON.stringify(registryMerge.registry, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "latest-report.md"), reportMarkdown, "utf8");
  await fs.writeFile(path.join(stateDir, "latest-result.json"), JSON.stringify(compact, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "latest-deep-research.json"), JSON.stringify(latestDeepEvidence, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "latest-discussion.json"), JSON.stringify(discussion, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "latest-discussion.md"), discussionMarkdown(discussion), "utf8");
  await fs.writeFile(archivedDiscussionPath, JSON.stringify(discussion, null, 2), "utf8");
  await fs.writeFile(discussionIndexPath, JSON.stringify(discussionIndex, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "funding-coverage.json"), JSON.stringify(coverage, null, 2), "utf8");
  await fs.writeFile(
    path.join(stateDir, "deduplication-stats.json"),
    JSON.stringify({
      cycle: reflection.state.cycle,
      mode: "win80_ultra90_lineage",
      parentBaselinesReevaluated: deep.baselineEvaluations.length,
      experiments: deep.experiments.length,
      acceptedExperiments: deep.experiments.filter((item) => item.accepted).length,
      ...deduplicationStats,
      historicalFingerprintsLoaded: previousLogicRegistry.fingerprints.length,
      newUniqueLogicTested: registryMerge.added,
      totalUniqueLogic: registryMerge.registry.fingerprints.length,
    }, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(stateDir, "forward-paper-candidates.json"),
    JSON.stringify(compact.finalCandidates, null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(stateDir, "forward-paper-candidates.md"), candidateMarkdown(compact), "utf8");
  await fs.writeFile(path.join(reportDir, "cycle-report.md"), reportMarkdown, "utf8");
  await fs.writeFile(path.join(reportDir, "result.json"), JSON.stringify(compact, null, 2), "utf8");
  await fs.writeFile(path.join(reportDir, "deep-research.json"), JSON.stringify(latestDeepEvidence, null, 2), "utf8");
  await fs.writeFile(path.join(reportDir, "discussion.json"), JSON.stringify(discussion, null, 2), "utf8");
  await fs.writeFile(path.join(reportDir, "discussion.md"), discussionMarkdown(discussion), "utf8");

  const bestOos = reflection.summary.bestOosMonthlyPct ?? -100;
  const acceptedExperiments = deep.experiments.filter((item) => item.accepted).length;
  await writeGithubOutput({
    run_status: "success",
    cycle: reflection.state.cycle,
    profile: config.profile,
    research_mode: "win80_ultra90_lineage",
    champions: deep.championsAfter.length,
    experiments: deep.experiments.length,
    accepted_experiments: acceptedExperiments,
    final_candidates: result.finalCandidates.length,
    best_oos_monthly: bestOos.toFixed(4),
    consecutive_no_candidate: reflection.state.consecutiveNoCandidate,
    duplicate_logic_skipped: deduplicationStats.duplicateStrategiesSkipped,
    total_unique_logic: registryMerge.registry.fingerprints.length,
    discussion_messages: discussion.messages.length,
  });

  console.log(
    `[MainLineageResearch] completed cycle=${reflection.state.cycle} baselines=${deep.baselineEvaluations.length} experiments=${deep.experiments.length} accepted=${acceptedExperiments} uniqueAdded=${registryMerge.added} duplicateSkipped=${deduplicationStats.duplicateStrategiesSkipped} finalCandidates=${result.finalCandidates.length} bestOos=${bestOos.toFixed(2)}% discussionMessages=${discussion.messages.length}`,
  );
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("[MainLineageResearch] failed", message);
  const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR ?? ".research-state");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(stateDir, "last-error.json"),
    JSON.stringify({ failedAt: new Date().toISOString(), mode: "win80_ultra90_lineage", message }, null, 2),
    "utf8",
  );
  await writeGithubOutput({ run_status: "failed", final_candidates: 0 });
  process.exitCode = 1;
});
