import { chmod, chown, copyFile, lstat, mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[0-9a-f]{40}$/i;
const SCHEMA = "disdex-hype-zec-long/v1";

function exactSha(value: unknown, field: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA.test(normalized)) throw new Error(`HYPE_ZEC_LONG_STATE_MIGRATE_${field}_INVALID`);
  return normalized;
}

function assertFlatState(raw: any, expectedSha: string) {
  if (!raw || typeof raw !== "object" || raw.schema !== SCHEMA) throw new Error("HYPE_ZEC_LONG_STATE_MIGRATE_SCHEMA");
  const sourceSha = exactSha(raw.runtimeCommitSha, "SOURCE_SHA");
  if (sourceSha !== expectedSha) throw new Error("HYPE_ZEC_LONG_STATE_MIGRATE_SOURCE_SHA_MISMATCH");
  if (raw.mode !== "LIVE") throw new Error("HYPE_ZEC_LONG_STATE_MIGRATE_MODE");
  if (Array.isArray(raw.positions) && raw.positions.length > 0) throw new Error("HYPE_ZEC_LONG_STATE_MIGRATE_POSITIONS_PRESENT");
  if (raw.positions !== undefined && raw.positions !== null && !Array.isArray(raw.positions)) throw new Error("HYPE_ZEC_LONG_STATE_MIGRATE_POSITIONS_MALFORMED");
  if (raw.pending) throw new Error("HYPE_ZEC_LONG_STATE_MIGRATE_PENDING_PRESENT");
  if (raw.manualReview) throw new Error("HYPE_ZEC_LONG_STATE_MIGRATE_MANUAL_REVIEW_PRESENT");
}

export async function migrateHypeZecLongRuntimeState(input: {
  statePath: string;
  toSha: string;
  backupPath?: string;
}) {
  const toSha = exactSha(input.toSha, "TO_SHA");
  const statePath = resolve(input.statePath);
  let metadata;
  try {
    metadata = await lstat(statePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return { status: "HYPE_ZEC_LONG_STATE_MIGRATE_SKIPPED_MISSING" as const, statePath, toSha, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) throw new Error("HYPE_ZEC_LONG_STATE_MIGRATE_SYMLINK_FORBIDDEN");
  if (!metadata.isFile()) throw new Error("HYPE_ZEC_LONG_STATE_MIGRATE_NOT_REGULAR_FILE");

  const beforeBytes = await readFile(statePath);
  const before = JSON.parse(beforeBytes.toString("utf8"));
  const fromSha = exactSha(before?.runtimeCommitSha, "SOURCE_SHA");
  if (fromSha === toSha) {
    assertFlatState(before, toSha);
    return { status: "HYPE_ZEC_LONG_STATE_MIGRATE_ALREADY_CURRENT" as const, statePath, fromSha, toSha, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
  }
  assertFlatState(before, fromSha);

  const backupPath = resolve(input.backupPath || `${statePath}.before-${toSha}`);
  try {
    await stat(backupPath);
    throw new Error("HYPE_ZEC_LONG_STATE_MIGRATE_BACKUP_EXISTS");
  } catch (error: any) {
    if (error?.message === "HYPE_ZEC_LONG_STATE_MIGRATE_BACKUP_EXISTS") throw error;
    if (error?.code !== "ENOENT") throw error;
  }

  await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });
  await copyFile(statePath, backupPath);
  if (!beforeBytes.equals(await readFile(backupPath))) throw new Error("HYPE_ZEC_LONG_STATE_MIGRATE_BACKUP_NOT_EXACT");
  if (process.platform !== "win32") {
    await chown(backupPath, metadata.uid, metadata.gid);
    await chmod(backupPath, metadata.mode & 0o777);
  }

  const after = { ...before, runtimeCommitSha: toSha };
  const temporary = `${statePath}.${process.pid}.${Date.now()}.migrate.tmp`;
  const handle = await open(temporary, "wx", metadata.mode & 0o777);
  try {
    await handle.writeFile(`${JSON.stringify(after, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (process.platform !== "win32") {
    await chown(temporary, metadata.uid, metadata.gid);
    await chmod(temporary, metadata.mode & 0o777);
  }
  await rename(temporary, statePath);
  const readback = JSON.parse(await readFile(statePath, "utf8"));
  assertFlatState(readback, toSha);
  if (JSON.stringify(readback) !== JSON.stringify(after)) throw new Error("HYPE_ZEC_LONG_STATE_MIGRATE_READBACK_MISMATCH");
  return { status: "HYPE_ZEC_LONG_STATE_MIGRATE_PASS" as const, statePath, backupPath, fromSha, toSha, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
}

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    console.log("HYPE_ZEC_LONG_STATE_MIGRATE_SELFTEST_PASS");
    return;
  }
  if (!process.argv.includes("--apply")) throw new Error("HYPE_ZEC_LONG_STATE_MIGRATE_APPLY_REQUIRED");
  const statePath = arg("--state-path");
  const toSha = arg("--to-sha");
  if (!statePath || !toSha) throw new Error("Usage: --apply --state-path PATH --to-sha SHA [--backup-path PATH]");
  console.log(JSON.stringify(await migrateHypeZecLongRuntimeState({ statePath, toSha, backupPath: arg("--backup-path") })));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "HYPE_ZEC_LONG_STATE_MIGRATE_FAIL_CLOSED",
      message: error instanceof Error ? error.message : String(error),
      ordersSent: 0,
      cancelsSent: 0,
      positionChangesSent: 0,
    }));
    process.exitCode = 1;
  });
}

