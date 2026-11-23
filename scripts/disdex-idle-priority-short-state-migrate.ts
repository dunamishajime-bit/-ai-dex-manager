import { copyFile, lstat, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { normalizeLiveStateOwnership } from "../lib/disdex-live-state-ownership";
import { normalizeIdleState, writeIdleState, type IdleState } from "../lib/idle-priority-short-state";

const SHA = /^[0-9a-f]{40}$/i;

function exactSha(value: unknown, field: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA.test(normalized)) throw new Error(`IDLE_STATE_SHA_MIGRATE_${field}_INVALID`);
  return normalized;
}

export type IdleStateMigrationResult =
  | { status: "IDLE_STATE_SHA_MIGRATE_PASS"; statePath: string; backupPath: string; fromSha: string; toSha: string; ordersSent: 0; cancelsSent: 0; positionChangesSent: 0 }
  | { status: "IDLE_STATE_SHA_MIGRATE_ALREADY_CURRENT"; statePath: string; toSha: string; ordersSent: 0; cancelsSent: 0; positionChangesSent: 0 };

export async function migrateIdlePriorityShortState(input: {
  statePath: string;
  toSha: string;
  backupPath?: string;
}): Promise<IdleStateMigrationResult> {
  const toSha = exactSha(input.toSha, "TO_SHA");
  const statePath = resolve(input.statePath);
  let metadata;
  try {
    metadata = await lstat(statePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "IDLE_STATE_SHA_MIGRATE_ALREADY_CURRENT", statePath, toSha, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("IDLE_STATE_SHA_MIGRATE_STATE_NOT_REGULAR_FILE");

  const beforeBytes = await readFile(statePath);
  const raw = JSON.parse(beforeBytes.toString("utf8")) as Partial<IdleState>;
  const fromSha = exactSha(raw.runtimeSha, "FROM_SHA");
  if (fromSha === toSha) {
    normalizeIdleState(raw, toSha);
    return { status: "IDLE_STATE_SHA_MIGRATE_ALREADY_CURRENT", statePath, toSha, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
  }
  const before = normalizeIdleState(raw, fromSha);
  if (before.positions.length > 0 || before.pending || before.manualReview) {
    throw new Error("IDLE_STATE_SHA_MIGRATE_REVIEW_OR_EXPOSURE_PRESENT");
  }

  const backupPath = resolve(input.backupPath || `${statePath}.before-${toSha}`);
  try {
    await stat(backupPath);
    throw new Error("IDLE_STATE_SHA_MIGRATE_BACKUP_EXISTS");
  } catch (error) {
    if (error instanceof Error && error.message === "IDLE_STATE_SHA_MIGRATE_BACKUP_EXISTS") throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await copyFile(statePath, backupPath);
  if (!(await readFile(backupPath)).equals(beforeBytes)) throw new Error("IDLE_STATE_SHA_MIGRATE_BACKUP_NOT_EXACT");

  const target = { ...before, runtimeSha: toSha, updatedAt: Date.now() };
  await writeIdleState(statePath, target);
  if (process.platform !== "win32") {
    await normalizeLiveStateOwnership(statePath, { label: "IDLE_STATE_SHA_MIGRATE_STATE" });
  }
  const after = normalizeIdleState(JSON.parse(await readFile(statePath, "utf8")), toSha);
  if (after.runtimeSha !== toSha || after.positions.length > 0 || after.pending || after.manualReview) {
    throw new Error("IDLE_STATE_SHA_MIGRATE_READBACK_FAILED");
  }
  return { status: "IDLE_STATE_SHA_MIGRATE_PASS", statePath, backupPath, fromSha, toSha, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
}

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const statePath = arg("--state-path") || "/var/lib/disdex/idle-priority/state.json";
  const toSha = arg("--to-sha");
  if (!toSha) throw new Error("Usage: --state-path PATH --to-sha SHA [--backup-path PATH]");
  migrateIdlePriorityShortState({ statePath, toSha, backupPath: arg("--backup-path") })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(JSON.stringify({ status: "IDLE_STATE_SHA_MIGRATE_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
      process.exitCode = 1;
    });
}
