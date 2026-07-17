import fs from "fs/promises";
import path from "path";

import type {
  ResearchDiscussionIndex,
  ResearchDiscussionIndexEntry,
  ResearchDiscussionLog,
} from "../lib/research-lab/discussion-types";
import { purgeLegacyChampionResults } from "../lib/research-lab/perp/legacy-champion-cleanup";
import {
  MAIN_STRATEGY_RESEARCH_PROGRAM_ID,
  buildMainStrategyResearchProgramCycle,
  createMainStrategyResearchProgramState,
  normalizeMainStrategyResearchProgramState,
  type MainStrategyResearchProgramState,
} from "../lib/research-lab/perp/main-strategy-research-program";

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
  };
}

function discussionMarkdown(log: ResearchDiscussionLog) {
  return [
    `# ${log.title}`,
    "",
    `- Completed: ${log.completedAt}`,
    `- Main research iteration: ${log.cycle}`,
    `- Profile: ${log.profile}`,
    `- Strategy / experiments: ${log.topStrategyIds.join(", ")}`,
    "",
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
  const { discussion, nextState } = buildMainStrategyResearchProgramCycle({
    state: programState,
    contextCycle,
    profile,
  });
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
  await fs.writeFile(path.join(stateDir, "active-research-program.json"), JSON.stringify({
    version: 1,
    programId: MAIN_STRATEGY_RESEARCH_PROGRAM_ID,
    mainStrategyId: nextState.mainStrategyId,
    activatedAt: discussion.completedAt,
    oldChampionStateInherited: false,
    legacyChampionState: "DELETED_RESULTS_SOURCE_DATA_PRESERVED",
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
  });

  console.log(
    `[MainStrategyResearch] completed program=${MAIN_STRATEGY_RESEARCH_PROGRAM_ID} iteration=${nextState.iteration} main=${nextState.mainStrategyId} oldChampionInherited=false legacyStateRemoved=${cleanup.removedStateFiles} legacyDiscussionsRemoved=${cleanup.removedDiscussionFiles} sourceDataPreserved=true path=${relativePath}`,
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
