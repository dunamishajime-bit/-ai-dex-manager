import { copyFile, mkdir, open, lstat, readFile, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { normalizeLiveStateOwnership } from "./disdex-live-state-ownership";

const SHA = /^[0-9a-f]{40}$/i;
const SCHEMA = "disdex-hype-zec-long/v1";

export type HypeZecMigrationState = Record<string, unknown>;

function exactSha(value: unknown, label: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA.test(normalized)) throw new Error(`HYPE_ZEC_STATE_MIGRATE_${label}_INVALID`);
  return normalized;
}

/**
 * A lineage-only migration is safe only for a provably flat state.  It must
 * not be used to clear exposure, pending execution, or manual review.
 * Unknown fields are deliberately retained by buildHypeZecLongStateMigration.
 */
export function assertFlatHypeZecLongStateForMigration(value: unknown, fromSha: string): HypeZecMigrationState {
  const sourceSha = exactSha(fromSha, "SOURCE_SHA");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("HYPE_ZEC_STATE_MIGRATE_SCHEMA");
  }
  const state = value as HypeZecMigrationState;
  if (state.schema !== SCHEMA) throw new Error("HYPE_ZEC_STATE_MIGRATE_SCHEMA");
  if (String(state.runtimeCommitSha || "").trim().toLowerCase() !== sourceSha) {
    throw new Error("HYPE_ZEC_STATE_MIGRATE_SOURCE_SHA_MISMATCH");
  }
  if (state.mode !== "LIVE") throw new Error("HYPE_ZEC_STATE_MIGRATE_MODE_MISMATCH");
  if (state.pending !== undefined && state.pending !== null) {
    throw new Error("HYPE_ZEC_STATE_MIGRATE_PENDING_PRESENT");
  }
  if (state.manualReview !== undefined && state.manualReview !== null && String(state.manualReview).trim()) {
    throw new Error("HYPE_ZEC_STATE_MIGRATE_MANUAL_REVIEW_PRESENT");
  }
  if (state.positions !== undefined && !Array.isArray(state.positions)) {
    throw new Error("HYPE_ZEC_STATE_MIGRATE_POSITIONS_MALFORMED");
  }
  if (Array.isArray(state.positions) && state.positions.length > 0) {
    throw new Error("HYPE_ZEC_STATE_MIGRATE_POSITIONS_PRESENT");
  }
  return state;
}

export function buildHypeZecLongStateMigration<T extends HypeZecMigrationState>(
  state: T,
  targetSha: string,
  updatedAt: number,
): T {
  const target = exactSha(targetSha, "TARGET_SHA");
  if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) {
    throw new Error("HYPE_ZEC_STATE_MIGRATE_UPDATED_AT_INVALID");
  }
  return { ...state, runtimeCommitSha: target, updatedAt } as T;
}

export async function migrateFlatHypeZecLongState(input: {
  statePath: string;
  fromSha: string;
  toSha: string;
  backupPath?: string;
  now?: () => number;
}) {
  const fromSha = exactSha(input.fromSha, "SOURCE_SHA");
  const toSha = exactSha(input.toSha, "TARGET_SHA");
  if (fromSha === toSha) throw new Error("HYPE_ZEC_STATE_MIGRATE_SHA_UNCHANGED");

  const statePath = resolve(input.statePath);
  const metadata = await lstat(statePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("HYPE_ZEC_STATE_MIGRATE_STATE_NOT_REGULAR_FILE");
  }
  const beforeBytes = await readFile(statePath);
  const before = JSON.parse(beforeBytes.toString("utf8")) as HypeZecMigrationState;
  assertFlatHypeZecLongStateForMigration(before, fromSha);

  const backupPath = resolve(input.backupPath || `${statePath}.before-${toSha}`);
  try {
    await stat(backupPath);
    throw new Error("HYPE_ZEC_STATE_MIGRATE_BACKUP_EXISTS");
  } catch (error) {
    if (error instanceof Error && error.message === "HYPE_ZEC_STATE_MIGRATE_BACKUP_EXISTS") throw error;
    if (!(error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "ENOENT")) throw error;
  }

  await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });
  await copyFile(statePath, backupPath);
  if (!beforeBytes.equals(await readFile(backupPath))) throw new Error("HYPE_ZEC_STATE_MIGRATE_BACKUP_NOT_EXACT");

  const after = buildHypeZecLongStateMigration(before, toSha, (input.now || Date.now)());
  const temporary = `${statePath}.${process.pid}.${Date.now()}.migrate.tmp`;
  const handle = await open(temporary, "wx", metadata.mode & 0o777);
  try {
    await handle.writeFile(`${JSON.stringify(after, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, statePath);
  await normalizeLiveStateOwnership(statePath, { label: "HYPE_ZEC_STATE_MIGRATE_STATE" });

  const readback = JSON.parse(await readFile(statePath, "utf8")) as HypeZecMigrationState;
  assertFlatHypeZecLongStateForMigration(readback, toSha);
  if (JSON.stringify(readback) !== JSON.stringify(after)) throw new Error("HYPE_ZEC_STATE_MIGRATE_READBACK_MISMATCH");

  return {
    status: "HYPE_ZEC_STATE_MIGRATE_PASS" as const,
    statePath,
    backupPath,
    fromSha,
    toSha,
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  };
}

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    const from = "a".repeat(40);
    const to = "b".repeat(40);
    const before = { schema: SCHEMA, runtimeCommitSha: from, mode: "LIVE", updatedAt: 1, failures: [], extra: true };
    const after = buildHypeZecLongStateMigration(before, to, 2);
    assertFlatHypeZecLongStateForMigration(after, to);
    if (after.extra !== true || after.runtimeCommitSha !== to) throw new Error("HYPE_ZEC_STATE_MIGRATE_SELFTEST_PRESERVE_FAILED");
    for (const invalid of [{ pending: {} }, { positions: [{}] }, { manualReview: "REVIEW" }]) {
      try {
        assertFlatHypeZecLongStateForMigration({ ...before, ...invalid }, from);
        throw new Error("HYPE_ZEC_STATE_MIGRATE_SELFTEST_REJECT_FAILED");
      } catch (error) {
        if (error instanceof Error && error.message === "HYPE_ZEC_STATE_MIGRATE_SELFTEST_REJECT_FAILED") throw error;
      }
    }
    console.log("HYPE_ZEC_STATE_MIGRATE_SELFTEST_PASS");
    return;
  }

  const statePath = arg("--state-path");
  const fromSha = arg("--from-sha");
  const toSha = arg("--to-sha");
  if (!statePath || !fromSha || !toSha) throw new Error("Usage: --state-path PATH --from-sha SHA --to-sha SHA [--backup-path PATH]");
  console.log(JSON.stringify(await migrateFlatHypeZecLongState({ statePath, fromSha, toSha, backupPath: arg("--backup-path") })));
}

if (process.argv[1]?.endsWith("hype-zec-long-state-migrate.ts")) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "HYPE_ZEC_STATE_MIGRATE_FAIL_CLOSED",
      message: error instanceof Error ? error.message : String(error),
      ordersSent: 0,
      cancelsSent: 0,
      positionChangesSent: 0,
    }));
    process.exitCode = 1;
  });
}
