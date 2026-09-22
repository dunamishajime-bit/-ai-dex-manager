import { copyFile, mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SHA = /^[0-9a-f]{40}$/i;

type Strategy = "FET" | "V12";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function exactSha(value: unknown, field: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA.test(normalized)) throw new Error(`FLAT_STATE_SHA_MIGRATE_${field}_INVALID`);
  return normalized;
}

function assertFlatState(strategy: Strategy, raw: any, fromSha: string) {
  if (String(raw?.runtimeCommitSha || "").toLowerCase() !== fromSha) {
    throw new Error("FLAT_STATE_SHA_MIGRATE_SOURCE_SHA_MISMATCH");
  }
  if (raw?.pending) throw new Error("FLAT_STATE_SHA_MIGRATE_PENDING_PRESENT");
  if (raw?.manualReview) throw new Error("FLAT_STATE_SHA_MIGRATE_MANUAL_REVIEW_PRESENT");

  if (strategy === "FET") {
    if (raw?.schema !== "fet-brk48-residual-state/v1" || raw?.strategyId !== "FET_BRK48_RESIDUAL") {
      throw new Error("FLAT_STATE_SHA_MIGRATE_FET_IDENTITY");
    }
    if (raw?.position) throw new Error("FLAT_STATE_SHA_MIGRATE_FET_POSITION_PRESENT");
    return;
  }

  if (!["v12-x1-all-runner-state/v1", "v12-x1-all-runner-state/v2"].includes(String(raw?.schema))) {
    throw new Error("FLAT_STATE_SHA_MIGRATE_V12_SCHEMA");
  }
  if (raw?.strategyId !== "V12_X1.00_ALL" || raw?.mode !== "LIVE") {
    throw new Error("FLAT_STATE_SHA_MIGRATE_V12_IDENTITY");
  }
  if (raw?.active) throw new Error("FLAT_STATE_SHA_MIGRATE_V12_ACTIVE_PRESENT");
  if (Array.isArray(raw?.activePositions) && raw.activePositions.length) {
    throw new Error("FLAT_STATE_SHA_MIGRATE_V12_ACTIVE_POSITIONS_PRESENT");
  }
  if (raw?.killSwitch?.active === true) throw new Error("FLAT_STATE_SHA_MIGRATE_V12_LOCAL_KILL_ACTIVE");
}

export async function migrateFlatRuntimeState(input: {
  strategy: Strategy;
  statePath: string;
  fromSha: string;
  toSha: string;
  backupPath?: string;
}) {
  const fromSha = exactSha(input.fromSha, "FROM_SHA");
  const toSha = exactSha(input.toSha, "TO_SHA");
  if (fromSha === toSha) throw new Error("FLAT_STATE_SHA_MIGRATE_SHA_UNCHANGED");

  const statePath = resolve(input.statePath);
  const beforeBytes = await readFile(statePath);
  const before = JSON.parse(beforeBytes.toString("utf8"));
  assertFlatState(input.strategy, before, fromSha);

  const backupPath = resolve(input.backupPath || `${statePath}.before-${toSha}`);
  try {
    await stat(backupPath);
    throw new Error("FLAT_STATE_SHA_MIGRATE_BACKUP_EXISTS");
  } catch (error: any) {
    if (error?.message === "FLAT_STATE_SHA_MIGRATE_BACKUP_EXISTS") throw error;
    if (error?.code !== "ENOENT") throw error;
  }

  const metadata = await stat(statePath);
  await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });
  await copyFile(statePath, backupPath);
  if (!beforeBytes.equals(await readFile(backupPath))) throw new Error("FLAT_STATE_SHA_MIGRATE_BACKUP_NOT_EXACT");

  const after = { ...before, runtimeCommitSha: toSha };
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.migrate.tmp`;
  const handle = await open(tempPath, "wx", metadata.mode & 0o777);
  try {
    await handle.writeFile(`${JSON.stringify(after, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (process.platform !== "win32") {
    const { chown, chmod } = await import("node:fs/promises");
    await chown(tempPath, metadata.uid, metadata.gid);
    await chmod(tempPath, metadata.mode & 0o777);
  }
  await rename(tempPath, statePath);

  const readback = JSON.parse(await readFile(statePath, "utf8"));
  assertFlatState(input.strategy, readback, toSha);
  if (JSON.stringify(readback) !== JSON.stringify(after)) throw new Error("FLAT_STATE_SHA_MIGRATE_READBACK_MISMATCH");

  return {
    status: "FLAT_STATE_SHA_MIGRATE_PASS" as const,
    strategy: input.strategy,
    statePath,
    backupPath,
    fromSha,
    toSha,
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  };
}

async function main() {
  if (process.argv.includes("--self-test")) {
    const fet = { schema: "fet-brk48-residual-state/v1", strategyId: "FET_BRK48_RESIDUAL", runtimeCommitSha: "a".repeat(40), updatedAt: 1, failures: [] };
    assertFlatState("FET", fet, "a".repeat(40));
    const v12 = { schema: "v12-x1-all-runner-state/v2", strategyId: "V12_X1.00_ALL", mode: "LIVE", runtimeCommitSha: "a".repeat(40), updatedAt: 1 };
    assertFlatState("V12", v12, "a".repeat(40));
    console.log("FLAT_STATE_SHA_MIGRATE_SELFTEST_PASS");
    return;
  }
  const strategy = String(arg("--strategy") || "").toUpperCase() as Strategy;
  if (!["FET", "V12"].includes(strategy)) throw new Error("Usage: --strategy FET|V12 --state-path PATH --from-sha SHA --to-sha SHA [--backup-path PATH]");
  const statePath = arg("--state-path");
  const fromSha = arg("--from-sha");
  const toSha = arg("--to-sha");
  if (!statePath || !fromSha || !toSha) throw new Error("Usage: --strategy FET|V12 --state-path PATH --from-sha SHA --to-sha SHA [--backup-path PATH]");
  console.log(JSON.stringify(await migrateFlatRuntimeState({
    strategy,
    statePath,
    fromSha,
    toSha,
    backupPath: arg("--backup-path"),
  })));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "FLAT_STATE_SHA_MIGRATE_FAIL_CLOSED",
      message: error instanceof Error ? error.message : String(error),
      ordersSent: 0,
      cancelsSent: 0,
      positionChangesSent: 0,
    }));
    process.exitCode = 1;
  });
}
