import fs from "fs/promises";
import path from "path";

import type { ResearchDiscussionIndex, ResearchDiscussionIndexEntry } from "../discussion-types";

export const LEGACY_CHAMPION_RESULT_FILES = [
  "autonomous-state.json",
  "champion-deep-state.json",
  "latest-result.json",
  "latest-deep-research.json",
  "tested-logic-fingerprints.json",
  "funding-coverage.json",
  "deduplication-stats.json",
  "forward-paper-candidates.json",
  "forward-paper-candidates.md",
  path.join("archive", "champion-deep-state-before-main-program-v2.json"),
] as const;

export function isLegacyChampionDiscussionEntry(item: Pick<ResearchDiscussionIndexEntry, "id" | "title" | "topStrategyIds">) {
  return item.id.startsWith("cycle-")
    || item.title.includes("Champion深掘り")
    || item.topStrategyIds.some((strategyId) => strategyId.startsWith("deep-c") || strategyId.startsWith("unique-g"));
}

function directMainIteration(item: Pick<ResearchDiscussionIndexEntry, "id">) {
  const match = /^main-research-(\d{4})-/.exec(item.id);
  return match ? Number(match[1]) : null;
}

export function sanitizeDiscussionIndex(index: ResearchDiscussionIndex): ResearchDiscussionIndex {
  const items = (Array.isArray(index.items) ? index.items : [])
    .filter((item) => !isLegacyChampionDiscussionEntry(item))
    .map((item) => {
      const iteration = directMainIteration(item);
      if (iteration == null) return item;
      return { ...item, cycle: iteration };
    })
    .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
  return {
    version: 1,
    updatedAt: items[0]?.completedAt ?? index.updatedAt,
    items,
  };
}

async function removeIfExists(filePath: string) {
  try {
    await fs.rm(filePath, { force: true, recursive: true });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function removeLegacyDiscussionFiles(directory: string): Promise<number> {
  let removed = 0;
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      removed += await removeLegacyDiscussionFiles(target);
      const remaining = await fs.readdir(target).catch(() => []);
      if (remaining.length === 0) await fs.rmdir(target).catch(() => undefined);
      continue;
    }
    if (/^cycle-\d{6}-.*\.json$/i.test(entry.name)) {
      await fs.rm(target, { force: true });
      removed += 1;
    }
  }
  return removed;
}

export async function purgeLegacyChampionResults(input: {
  stateDir: string;
  reportsDir?: string;
  discussionIndex?: ResearchDiscussionIndex;
}) {
  let removedStateFiles = 0;
  for (const relativePath of LEGACY_CHAMPION_RESULT_FILES) {
    if (await removeIfExists(path.join(input.stateDir, relativePath))) removedStateFiles += 1;
  }
  const removedDiscussionFiles = await removeLegacyDiscussionFiles(path.join(input.stateDir, "discussions"));
  const reportsDir = input.reportsDir ?? path.resolve("reports", "research-lab-autonomous");
  const removedReportsDirectory = await removeIfExists(reportsDir);
  const sanitizedIndex = input.discussionIndex ? sanitizeDiscussionIndex(input.discussionIndex) : undefined;
  return {
    removedStateFiles,
    removedDiscussionFiles,
    removedReportsDirectory,
    sanitizedIndex,
    sourceDataPreserved: true as const,
  };
}
