import fs from "fs/promises";
import path from "path";

import type {
  ResearchDiscussionIndex,
  ResearchDiscussionIndexEntry,
  ResearchDiscussionLog,
} from "../lib/research-lab/discussion-types";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { purgeLegacyChampionResults } from "../lib/research-lab/perp/legacy-champion-cleanup";
import { MAIN_STRATEGY_RESEARCH_POLICY } from "../lib/research-lab/perp/main-strategy-research-policy";
import {
  MAIN_STRATEGY_RESEARCH_PROGRAM_ID,
  buildMainStrategyResearchProgramCycle,
  createMainStrategyResearchProgramState,
  normalizeMainStrategyResearchProgramState,
  type MainStrategyResearchProgramState,
} from "../lib/research-lab/perp/main-strategy-research-program";
import { attachMainStrategySnapshotReplay } from "../lib/research-lab/perp/main-strategy-snapshot-discussion";
import {
  buildMainStrategySnapshotReplay,
  type MainStrategySnapshotReplayArtifact,
  type MainStrategySnapshotReplayConfig,
} from "../lib/research-lab/perp/main-strategy-snapshot-replay";

const HOUR_MS = 60 * 60 * 1000;
const SNAPSHOT_REPLAY_FILE = "main-strategy-snapshot-replay-v1.json";
const SNAPSHOT_SYMBOLS = ["ETH", "BNB", "SOL", "ADA", "AVAX", "LINK", "AAVE", "INJ"];

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[MainStrategyResearch] invalid JSON ignored: ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return fallback;
  }
}

function discussionRelativePath(log: ResearchDiscussionLog) {
  const completed = new Date(log.completedAt);
  const year = String(completed.getUTCFullYear());
  const month = String(completed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(completed.getUTCDate()).padStart(2, "0");
  return path.posix.join("discussions", year, month, day, `${log.id}.json`);
}

function discussionIndexEntry(log: ResearchDiscussionLog, discussionPath: string): ResearchDiscussionIndexEntry {
  return {
    id: log.id,
    path: discussionPath,
    cycle: log.cycle,
    completedAt: log.completedAt,
    profile: log.profile,
    title: log.title,
    summary: log.summary,
    decision: log.decision,
    messageCount: log.messages.length,
    finalCandidates: log.finalCandidates,
    bestOosMonthlyPct: log.bestOosMonthlyPct,
    bestOosDrawdownPct: log.bestOosDrawdownPct,
    bestWorstStressMonthlyPct: log.bestWorstStressMonthlyPct,
    topStrategyIds: [...log.topStrategyIds],
    snapshotEvidenceAvailable: Boolean(log.snapshotReplay),
    snapshotSignalCount: log.snapshotReplay?.selectedSignalCount,
  };
}

function pct(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`;
}

function discussionMarkdown(log: ResearchDiscussionLog) {
  const replay = log.snapshotReplay;
  return [
    `# ${log.title}`,
    "",
    `- Completed: ${log.completedAt}`,
    `- Main research iteration: ${log.cycle}`,
    `- Profile: ${log.profile}`,
    `- Strategy / experiments: ${log.topStrategyIds.join(", ")}`,
    `- BT Snapshot evidence: ${replay ? "READY" : "MISSING"}`,
    "",
    ...(replay ? [
      "## BT Snapshot Replay",
      "",
      `- Dataset: ${replay.datasetId}`,
      `- Source: ${replay.source}`,
      `- Period: ${replay.period.startIso} - ${replay.period.endIso}`,
      `- Symbols: ${replay.symbols.join(", ")}`,
      `- Snapshot interval: ${replay.intervalHours}h`,
      `- Snapshot / selected signal: ${replay.snapshotCount} / ${replay.selectedSignalCount}`,
      `- Forward 24h win / avg: ${pct(replay.metrics.winRate24hPct)} / ${pct(replay.metrics.average24hPct)}`,
      `- Forward 72h win / avg / PF: ${pct(replay.metrics.winRate72hPct)} / ${pct(replay.metrics.average72hPct)} / ${replay.metrics.profitFactor72h?.toFixed(2) ?? "—"}`,
      `- Forward 168h win / avg: ${pct(replay.metrics.winRate168hPct)} / ${pct(replay.metrics.average168hPct)}`,
      `- Stress 72h avg / event sequence DD: ${pct(replay.metrics.stressAverage72hPct)} / ${pct(replay.metrics.eventSequenceMaxDrawdownPct)}`,
      `- Fingerprint: ${replay.fingerprint}`,
      "",
      "### Recent snapshot events",
      "",
      "| Snapshot | Symbol | Tier | Score | Trigger | 24h | 72h | 168h | Stress72h |",
      "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...replay.events.map((event) => `| ${event.snapshotIso} | ${event.symbol} | ${event.tier} | ${event.score.toFixed(2)} | ${event.triggerProgressPct.toFixed(2)}% | ${event.forward24hPct.toFixed(2)}% | ${event.forward72hPct.toFixed(2)}% | ${event.forward168hPct.toFixed(2)}% | ${event.stress72hPct.toFixed(2)}% |`),
      "",
      "### Limitations",
      "",
      ...replay.limitations.map((item) => `- ${item}`),
      "",
    ] : []),
    "## Methodology",
    "",
    log.methodology,
    "",
    "## Summary",
    "",
    log.summary,
    "",
    "## CIO Decision",
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

function parseHistoricalReferencePeriod() {
  const [startDate, endDate] = MAIN_STRATEGY_RESEARCH_POLICY.historicalReference.period.split("/");
  const startTs = Date.parse(`${startDate}T00:00:00.000Z`);
  const endTs = Date.parse(`${endDate}T23:59:59.999Z`) + 1;
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) {
    throw new Error(`Invalid main strategy historical period: ${MAIN_STRATEGY_RESEARCH_POLICY.historicalReference.period}`);
  }
  return { startTs, endTs };
}

async function buildSnapshotArtifact(): Promise<MainStrategySnapshotReplayArtifact> {
  const period = parseHistoricalReferencePeriod();
  const replayConfig: MainStrategySnapshotReplayConfig = {
    datasetId: "WIN80_USDM_1H_REFERENCE_2025H2_2026Q1_V1",
    symbols: SNAPSHOT_SYMBOLS,
    startTs: period.startTs,
    endTs: period.endTs,
    intervalHours: 6,
    warmupHours: 48,
    sameSymbolCooldownHours: 24,
    feeBpsPerSide: 6,
    slippageBpsPerSide: 4,
    stressSlippageBpsPerSide: 12,
    historyHours: 30 * 24,
    maxEventsStored: 500,
  };
  const dataStartTs = replayConfig.startTs - replayConfig.historyHours * HOUR_MS;
  const dataEndTs = Date.UTC(2026, 4, 1);
  const marketData = await loadPerpMarketData({
    symbols: replayConfig.symbols,
    startTs: dataStartTs,
    endTs: Math.max(dataEndTs, replayConfig.endTs + 8 * 24 * HOUR_MS),
  });
  return buildMainStrategySnapshotReplay({ data: marketData, config: replayConfig });
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

async function main() {
  const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR ?? ".research-state");
  const programStatePath = path.join(stateDir, "main-strategy-research-state.json");
  const discussionIndexPath = path.join(stateDir, "discussions", "index.json");
  const rawProgramState = await readJson<unknown>(programStatePath, null);
  const programState: MainStrategyResearchProgramState = rawProgramState
    ? normalizeMainStrategyResearchProgramState(rawProgramState)
    : createMainStrategyResearchProgramState();
  const rawPreviousIndex = await readJson<ResearchDiscussionIndex>(discussionIndexPath, {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    items: [],
  });
  const cleanup = await purgeLegacyChampionResults({
    stateDir,
    reportsDir: path.resolve("reports", "research-lab-autonomous"),
    discussionIndex: rawPreviousIndex,
  });
  const previousIndex = cleanup.sanitizedIndex ?? rawPreviousIndex;
  const profile = "attack" as const;
  const contextCycle = programState.iteration + 1;
  const snapshotArtifact = await buildSnapshotArtifact();
  const programCycle = buildMainStrategyResearchProgramCycle({
    state: programState,
    contextCycle,
    profile,
  });
  const discussion = attachMainStrategySnapshotReplay(programCycle.discussion, snapshotArtifact);
  const nextState = programCycle.nextState;
  const relativePath = discussionRelativePath(discussion);
  const archivedPath = path.join(stateDir, ...relativePath.split("/"));
  const markdown = discussionMarkdown(discussion);
  const index: ResearchDiscussionIndex = {
    version: 1,
    updatedAt: discussion.completedAt,
    items: [
      discussionIndexEntry(discussion, relativePath),
      ...(Array.isArray(previousIndex.items) ? previousIndex.items : []).filter((item) => item.id !== discussion.id),
    ]
      .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
      .slice(0, 500),
  };

  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(path.dirname(archivedPath), { recursive: true });
  await fs.mkdir(path.dirname(discussionIndexPath), { recursive: true });
  await fs.writeFile(programStatePath, JSON.stringify(nextState, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, SNAPSHOT_REPLAY_FILE), JSON.stringify(snapshotArtifact, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "active-research-program.json"), JSON.stringify({
    version: 1,
    programId: MAIN_STRATEGY_RESEARCH_PROGRAM_ID,
    mainStrategyId: nextState.mainStrategyId,
    activatedAt: discussion.completedAt,
    oldChampionStateInherited: false,
    legacyChampionState: "DELETED_RESULTS_SOURCE_DATA_PRESERVED",
    snapshotReplay: {
      status: "READY",
      datasetId: snapshotArtifact.datasetId,
      fingerprint: snapshotArtifact.fingerprint,
      snapshotCount: snapshotArtifact.snapshotCount,
      selectedSignalCount: snapshotArtifact.selectedSignalCount,
    },
    legacyChampionCleanup: {
      removedStateFiles: cleanup.removedStateFiles,
      removedDiscussionFiles: cleanup.removedDiscussionFiles,
      removedReportsDirectory: cleanup.removedReportsDirectory,
    },
  }, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "latest-discussion.json"), JSON.stringify(discussion, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "latest-discussion.md"), markdown, "utf8");
  await fs.writeFile(path.join(stateDir, "latest-main-strategy-research.json"), JSON.stringify(discussion, null, 2), "utf8");
  await fs.writeFile(path.join(stateDir, "latest-main-strategy-research.md"), markdown, "utf8");
  await fs.writeFile(path.join(stateDir, "latest-report.md"), markdown, "utf8");
  await fs.writeFile(archivedPath, JSON.stringify(discussion, null, 2), "utf8");
  await fs.writeFile(discussionIndexPath, JSON.stringify(index, null, 2), "utf8");

  await writeGithubOutput({
    run_status: "success",
    discussion_mode: "main_strategy_research",
    research_iteration: nextState.iteration,
    final_candidates: 0,
    discussion_messages: discussion.messages.length,
    main_strategy: nextState.mainStrategyId,
    old_champion_inherited: "false",
    legacy_state_files_removed: cleanup.removedStateFiles,
    legacy_discussions_removed: cleanup.removedDiscussionFiles,
    source_data_preserved: "true",
    snapshot_replay_status: "ready",
    snapshot_count: snapshotArtifact.snapshotCount,
    snapshot_signals: snapshotArtifact.selectedSignalCount,
    snapshot_fingerprint: snapshotArtifact.fingerprint,
  });

  console.log(
    `[MainStrategyResearch] completed program=${MAIN_STRATEGY_RESEARCH_PROGRAM_ID} iteration=${nextState.iteration} main=${nextState.mainStrategyId} snapshotCount=${snapshotArtifact.snapshotCount} snapshotSignals=${snapshotArtifact.selectedSignalCount} snapshotFingerprint=${snapshotArtifact.fingerprint.slice(0, 16)} oldChampionInherited=false legacyStateRemoved=${cleanup.removedStateFiles} legacyDiscussionsRemoved=${cleanup.removedDiscussionFiles} sourceDataPreserved=true path=${relativePath}`,
  );
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("[MainStrategyResearch] failed", message);
  const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR ?? ".research-state");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(stateDir, "last-error.json"),
    JSON.stringify({ failedAt: new Date().toISOString(), mode: "main_strategy_research", message }, null, 2),
    "utf8",
  );
  await writeGithubOutput({ run_status: "failed", discussion_mode: "main_strategy_research", final_candidates: 0 });
  process.exitCode = 1;
});
