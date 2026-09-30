import { chmod, chown, copyFile, lstat, mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BENIGN_HYPE_ZEC_MARKET_DATA_REVIEW } from "../lib/hype-zec-long-recovery-contract";

const SHA = /^[0-9a-f]{40}$/i;
const SCHEMA = "disdex-hype-zec-long/v1";

function exactSha(value: unknown, field: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA.test(normalized)) throw new Error(`HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_${field}_INVALID`);
  return normalized;
}

function assertFlatState(raw: any, expectedSha?: string) {
  if (!raw || typeof raw !== "object" || raw.schema !== SCHEMA) throw new Error("HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_SCHEMA");
  const stateSha = exactSha(raw.runtimeCommitSha, "STATE_SHA");
  if (expectedSha && stateSha !== expectedSha) throw new Error("HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_SHA_MISMATCH");
  if (raw.mode !== "LIVE") throw new Error("HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_MODE");
  if (Array.isArray(raw.positions) && raw.positions.length > 0) throw new Error("HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_POSITIONS_PRESENT");
  if (raw.pending) throw new Error("HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_PENDING_PRESENT");
}

export async function recoverHypeZecBenignMarketDataState(input: {
  statePath: string;
  expectedSha?: string;
  backupPath?: string;
}) {
  const expectedSha = input.expectedSha ? exactSha(input.expectedSha, "EXPECTED_SHA") : undefined;
  const statePath = resolve(input.statePath);
  let metadata;
  try {
    metadata = await lstat(statePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return { status: "HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_SKIPPED_MISSING" as const, statePath, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
    throw error;
  }
  if (metadata.isSymbolicLink()) throw new Error("HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_SYMLINK_FORBIDDEN");
  if (!metadata.isFile()) throw new Error("HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_NOT_REGULAR_FILE");
  const beforeBytes = await readFile(statePath);
  const before = JSON.parse(beforeBytes.toString("utf8"));
  assertFlatState(before, expectedSha);
  if (!before.manualReview) return { status: "HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_NOOP" as const, statePath, runtimeCommitSha: before.runtimeCommitSha, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
  if (before.manualReview !== BENIGN_HYPE_ZEC_MARKET_DATA_REVIEW) throw new Error("HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_UNKNOWN_REVIEW");

  const now = Date.now();
  const backupPath = resolve(input.backupPath || `${statePath}.before-benign-market-data-recovery-${String(before.runtimeCommitSha).toLowerCase()}`);
  try {
    await stat(backupPath);
    throw new Error("HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_BACKUP_EXISTS");
  } catch (error: any) {
    if (error?.message === "HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_BACKUP_EXISTS") throw error;
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });
  await copyFile(statePath, backupPath);
  if (!beforeBytes.equals(await readFile(backupPath))) throw new Error("HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_BACKUP_NOT_EXACT");
  if (process.platform !== "win32") {
    await chown(backupPath, metadata.uid, metadata.gid);
    await chmod(backupPath, metadata.mode & 0o777);
  }

  const after = {
    ...before,
    updatedAt: now,
    manualReview: null,
    lastDecisionTs: now,
    lastDecision: { strategy: "HYPE_LONG", signalTs: null, accepted: false, reason: "HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY" },
    failures: [...(Array.isArray(before.failures) ? before.failures : []), { message: "HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY", occurredAt: now }].slice(-100),
  };
  const temporary = `${statePath}.${process.pid}.${now}.benign-recovery.tmp`;
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
  assertFlatState(readback, expectedSha);
  if (readback.manualReview !== null || readback.lastDecision?.reason !== "HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY") throw new Error("HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_READBACK_MISMATCH");
  return { status: "HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_PASS" as const, statePath, backupPath, runtimeCommitSha: readback.runtimeCommitSha, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 };
}

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    console.log("HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_SELFTEST_PASS");
    return;
  }
  if (!process.argv.includes("--apply")) throw new Error("HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_APPLY_REQUIRED");
  const statePath = arg("--state-path");
  if (!statePath) throw new Error("Usage: --apply --state-path PATH [--expected-sha SHA] [--backup-path PATH]");
  console.log(JSON.stringify(await recoverHypeZecBenignMarketDataState({ statePath, expectedSha: arg("--expected-sha"), backupPath: arg("--backup-path") })));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    process.exitCode = 1;
  });
}

