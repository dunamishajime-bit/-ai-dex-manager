import { copyFile, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  FileQuality102CausalV1StateStore,
  type Quality102CausalV1State,
} from "../lib/disdex-quality102-causal-v1-state";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export interface Quality102CausalV1StateMigrationInput {
  statePath: string;
  fromRuntimeSha: string;
  toRuntimeSha: string;
  backupPath?: string;
}

export interface Quality102CausalV1StateMigrationResult {
  status: "QUALITY102_STATE_MIGRATION_PASS";
  statePath: string;
  backupPath: string;
  fromRuntimeSha: string;
  toRuntimeSha: string;
  positionPresent: false;
  pendingPresent: false;
  ordersSent: 0;
  positionChangesSent: 0;
}

function assertSha(value: string, field: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA_PATTERN.test(normalized)) throw new Error(`QUALITY102_STATE_MIGRATION_${field}_INVALID`);
  return normalized;
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function stateWithRuntimeSha(state: Quality102CausalV1State, runtimeCommitSha: string): Quality102CausalV1State {
  return { ...state, runtimeCommitSha };
}

/**
 * Migrate only a flat, reconciled Q102 state between release SHAs.  This is a
 * deployment operation, not a way to bypass the runtime state contract: the
 * old SHA must validate, pending/position state must be absent, a backup must
 * be created first, and the atomic state-store write must validate afterward.
 */
export async function migrateQuality102CausalV1State(
  input: Quality102CausalV1StateMigrationInput,
): Promise<Quality102CausalV1StateMigrationResult> {
  const fromRuntimeSha = assertSha(input.fromRuntimeSha, "FROM_SHA");
  const toRuntimeSha = assertSha(input.toRuntimeSha, "TO_SHA");
  if (fromRuntimeSha === toRuntimeSha) throw new Error("QUALITY102_STATE_MIGRATION_SHA_UNCHANGED");

  const statePath = resolve(input.statePath);
  const backupPath = resolve(input.backupPath || `${statePath}.before-${toRuntimeSha}`);
  if (statePath === backupPath) throw new Error("QUALITY102_STATE_MIGRATION_BACKUP_EQUALS_STATE");
  if (!(await exists(statePath))) throw new Error("QUALITY102_STATE_MIGRATION_STATE_MISSING");
  if (await exists(backupPath)) throw new Error("QUALITY102_STATE_MIGRATION_BACKUP_EXISTS");

  const beforeRaw = await readFile(statePath, "utf8");
  const before = await new FileQuality102CausalV1StateStore(statePath, "LIVE", fromRuntimeSha).load();
  if (before.runtimeCommitSha.toLowerCase() !== fromRuntimeSha) {
    throw new Error("QUALITY102_STATE_MIGRATION_FROM_SHA_MISMATCH");
  }
  if (before.pending) throw new Error("QUALITY102_STATE_MIGRATION_PENDING_REQUIRES_RECONCILIATION");
  if (before.position) throw new Error("QUALITY102_STATE_MIGRATION_POSITION_REQUIRES_HANDOFF");

  // Copy the exact original bytes before the state store's atomic rename.
  await copyFile(statePath, backupPath);
  const targetState = stateWithRuntimeSha(before, toRuntimeSha);
  await new FileQuality102CausalV1StateStore(statePath, "LIVE", toRuntimeSha).save(targetState);
  const after = await new FileQuality102CausalV1StateStore(statePath, "LIVE", toRuntimeSha).load();
  if (JSON.stringify(after) !== JSON.stringify(targetState)) {
    throw new Error("QUALITY102_STATE_MIGRATION_POSTCHECK_MISMATCH");
  }
  if ((await readFile(backupPath, "utf8")) !== beforeRaw) {
    throw new Error("QUALITY102_STATE_MIGRATION_BACKUP_NOT_EXACT");
  }

  return {
    status: "QUALITY102_STATE_MIGRATION_PASS",
    statePath,
    backupPath,
    fromRuntimeSha,
    toRuntimeSha,
    positionPresent: false,
    pendingPresent: false,
    ordersSent: 0,
    positionChangesSent: 0,
  };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-test")) {
    console.log("Use scripts/disdex-quality102-causal-v1-state-migrate-selftest.ts for the self-test.");
    return;
  }
  const statePath = arg("--state-path");
  const fromRuntimeSha = arg("--from-sha");
  const toRuntimeSha = arg("--to-sha");
  if (!statePath || !fromRuntimeSha || !toRuntimeSha) {
    throw new Error("Usage: --state-path PATH --from-sha SHA --to-sha SHA [--backup-path PATH]");
  }
  const result = await migrateQuality102CausalV1State({
    statePath,
    fromRuntimeSha,
    toRuntimeSha,
    backupPath: arg("--backup-path"),
  });
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "QUALITY102_STATE_MIGRATION_FAIL_CLOSED",
      message: error instanceof Error ? error.message : String(error),
      ordersSent: 0,
      positionChangesSent: 0,
    }));
    process.exitCode = 1;
  });
}
