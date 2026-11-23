import { appendFile, readFile, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import type { Quality102CausalV4DecisionSnapshot } from "./disdex-quality102-causal-v4-observability";

const PREFIX = "decision-ranking-history-";
const SUFFIX = ".jsonl";
const DEFAULT_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

function historyFileName(referenceTs: number): string {
  const day = new Date(referenceTs).toISOString().slice(0, 10);
  return `${PREFIX}${day}${SUFFIX}`;
}

function lastReferenceTs(text: string): number | undefined {
  const line = text.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) return undefined;
  try {
    const parsed = JSON.parse(line) as { referenceTs?: unknown };
    const value = Number(parsed.referenceTs);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

async function pruneOldRankingHistory(stateRoot: string, now: number, retentionDays: number): Promise<void> {
  const cutoff = now - retentionDays * DAY_MS;
  const names = await readdir(stateRoot);
  await Promise.all(names.map(async (name) => {
    const match = /^decision-ranking-history-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
    if (!match) return;
    const fileDay = Date.parse(`${match[1]}T00:00:00.000Z`);
    if (Number.isFinite(fileDay) && fileDay < cutoff) {
      await unlink(resolve(stateRoot, name)).catch(() => undefined);
    }
  }));
}

export async function persistQuality102RankingHistory(input: {
  stateRoot: string;
  snapshot: Quality102CausalV4DecisionSnapshot;
  retentionDays?: number;
}): Promise<{ appended: boolean; path: string }> {
  const referenceTs = Number(input.snapshot.referenceTs);
  if (!Number.isFinite(referenceTs) || referenceTs <= 0) throw new Error("Q102_RANKING_HISTORY_REFERENCE_TS_INVALID");
  if (input.snapshot.schemaVersion !== 2 || input.snapshot.rankingModelVersion !== "Q102_PROXIMITY_V1") {
    throw new Error("Q102_RANKING_HISTORY_SCHEMA_UNSUPPORTED");
  }

  const path = resolve(input.stateRoot, historyFileName(referenceTs));
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  if (lastReferenceTs(existing) === referenceTs) return { appended: false, path };

  await appendFile(path, JSON.stringify(input.snapshot) + "\n", { encoding: "utf8", mode: 0o600 });
  await pruneOldRankingHistory(input.stateRoot, Date.now(), input.retentionDays ?? DEFAULT_RETENTION_DAYS);
  return { appended: true, path };
}
