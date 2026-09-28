import { copyFile, mkdir, open, lstat, readFile, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { normalizeLiveStateOwnership } from "../lib/disdex-live-state-ownership";
import {
  assertFlatHypeZecLongStateForMigration,
  buildHypeZecLongStateMigration,
} from "../lib/hype-zec-long-state-migration";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function migrateHypeZecLongState(input: {
  statePath: string;
  fromSha: string;
  toSha: string;
  backupPath?: string;
  now?: () => number;
}) {
  const statePath = resolve(input.statePath);
  const metadata = await lstat(statePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("HYPE_ZEC_STATE_MIGRATE_STATE_NOT_REGULAR_FILE");

  const beforeBytes = await readFile(statePath);
  const before = JSON.parse(beforeBytes.toString("utf8")) as Record<string, unknown>;
  assertFlatHypeZecLongStateForMigration(before, input.fromSha);

  const backupPath = resolve(input.backupPath || `${statePath}.before-${input.toSha}`);
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

  const after = buildHypeZecLongStateMigration(before, input.toSha, (input.now || Date.now)());
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

  const readback = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
  assertFlatHypeZecLongStateForMigration(readback, input.toSha);
  if (JSON.stringify(readback) !== JSON.stringify(after)) throw new Error("HYPE_ZEC_STATE_MIGRATE_READBACK_MISMATCH");
  return {
    status: "HYPE_ZEC_STATE_MIGRATE_PASS" as const,
    statePath,
    backupPath,
    fromSha: String(input.fromSha).toLowerCase(),
    toSha: String(input.toSha).toLowerCase(),
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  };
}

async function main() {
  if (process.argv.includes("--self-test")) {
    const from = "a".repeat(40);
    const to = "b".repeat(40);
    const before = { schema: "disdex-hype-zec-long/v1", runtimeCommitSha: from, mode: "LIVE", updatedAt: 1, failures: [], extra: true };
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
  console.log(JSON.stringify(await migrateHypeZecLongState({ statePath, fromSha, toSha, backupPath: arg("--backup-path") })));
}

if (process.argv[1]?.endsWith("disdex-hype-zec-long-state-migrate.ts")) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "HYPE_ZEC_STATE_MIGRATE_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    process.exitCode = 1;
  });
}
