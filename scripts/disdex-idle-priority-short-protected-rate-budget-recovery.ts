import { chmod, chown, copyFile, lstat, mkdir, open, readFile, rename, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AsterV3Client } from "../lib/aster-v3-client";
import { normalizeIdleState, type IdleState } from "../lib/idle-priority-short-state";

const SHA = /^[0-9a-f]{40}$/i;
const ACTIVE_ORDER_STATUSES = new Set(["NEW", "PARTIALLY_FILLED", "PENDING_NEW"]);
const BENIGN_RATE_BUDGET_REVIEW = /^IDLE_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:\d+$/;

export type IdleProtectedVenuePosition = {
  symbol: string;
  quantity: number;
  positionSide?: string;
};

export type IdleProtectedVenueOrder = {
  symbol: string;
  clientOrderId: string;
  type?: string;
  side?: string;
  status?: string;
  quantity: number;
  executedQuantity?: number;
  reduceOnly?: boolean;
  stopPrice?: number;
};

export type IdleProtectedVenueReadback = {
  getPositions(symbol: string): Promise<readonly IdleProtectedVenuePosition[]>;
  getOpenOrders(symbol: string): Promise<readonly IdleProtectedVenueOrder[]>;
};

function exactSha(value: unknown, field: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA.test(normalized)) throw new Error(`IDLE_PROTECTED_RATE_BUDGET_RECOVERY_${field}_INVALID`);
  return normalized;
}

function active(order: IdleProtectedVenueOrder) {
  return ACTIVE_ORDER_STATUSES.has(String(order.status || "").toUpperCase());
}

function sameQuantity(actual: number, expected: number) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 0.01);
}

function samePrice(actual: number | undefined, expected: number) {
  return Number.isFinite(Number(actual)) && Math.abs(Number(actual) - expected) <= Math.max(1e-12, Math.abs(expected) * 1e-6);
}

function isShort(position: IdleProtectedVenuePosition) {
  const side = String(position.positionSide || "").toUpperCase();
  return side === "SHORT" || (side === "BOTH" && position.quantity < 0);
}

function assertVenuePosition(position: IdleProtectedVenuePosition, expected: IdleState["positions"][number]) {
  if (position.symbol.toUpperCase() !== expected.symbol || !isShort(position) || !sameQuantity(Math.abs(position.quantity), expected.quantity)) {
    throw new Error(`IDLE_PROTECTED_RATE_BUDGET_RECOVERY_POSITION_INVALID:${expected.symbol}`);
  }
}

async function assertProtectedVenueReadback(state: IdleState, venue: IdleProtectedVenueReadback) {
  for (const expected of state.positions) {
    const [positions, orders] = await Promise.all([
      venue.getPositions(expected.symbol),
      venue.getOpenOrders(expected.symbol),
    ]);
    const actual = positions.find((row) => row.symbol.toUpperCase() === expected.symbol && Math.abs(row.quantity) > 1e-12);
    if (!actual) throw new Error(`IDLE_PROTECTED_RATE_BUDGET_RECOVERY_POSITION_MISSING:${expected.symbol}`);
    assertVenuePosition(actual, expected);
    const activeOrders = orders.filter((row) => row.symbol.toUpperCase() === expected.symbol && active(row));
    const stop = activeOrders.find((row) => row.clientOrderId === expected.stopClientOrderId);
    const takeProfit = activeOrders.find((row) => row.clientOrderId === expected.takeProfitClientOrderId);
    if (!stop || !takeProfit
      || String(stop.type || "").toUpperCase() !== "STOP_MARKET"
      || String(takeProfit.type || "").toUpperCase() !== "TAKE_PROFIT_MARKET"
      || String(stop.side || "").toUpperCase() !== "BUY"
      || String(takeProfit.side || "").toUpperCase() !== "BUY"
      || stop.reduceOnly !== true
      || takeProfit.reduceOnly !== true
      || !sameQuantity(stop.quantity, expected.quantity)
      || !sameQuantity(takeProfit.quantity, expected.quantity)
      || !samePrice(stop.stopPrice, expected.stopPrice)
      || !samePrice(takeProfit.stopPrice, expected.takeProfitPrice)) {
      throw new Error(`IDLE_PROTECTED_RATE_BUDGET_RECOVERY_PROTECTION_INVALID:${expected.symbol}`);
    }
    const expectedOrderIds = new Set([expected.stopClientOrderId, expected.takeProfitClientOrderId]);
    if (activeOrders.some((row) => !expectedOrderIds.has(row.clientOrderId))) {
      throw new Error(`IDLE_PROTECTED_RATE_BUDGET_RECOVERY_UNMANAGED_ORDER:${expected.symbol}`);
    }
  }
}

function assertStateShape(raw: unknown, sourceSha: string, expectedSha: string) {
  if (!raw || typeof raw !== "object") throw new Error("IDLE_PROTECTED_RATE_BUDGET_RECOVERY_STATE_INVALID");
  const state = normalizeIdleState(raw, sourceSha);
  const alreadyReconciled = state.manualReview === null;
  if (!alreadyReconciled && !BENIGN_RATE_BUDGET_REVIEW.test(state.manualReview || "")) {
    throw new Error("IDLE_PROTECTED_RATE_BUDGET_RECOVERY_REVIEW_INVALID");
  }
  if (state.pending) throw new Error("IDLE_PROTECTED_RATE_BUDGET_RECOVERY_PENDING_PRESENT");
  if (!state.positions.length || state.positions.some((position) => position.protectionVerified !== true)) {
    throw new Error("IDLE_PROTECTED_RATE_BUDGET_RECOVERY_PROTECTION_STATE_INVALID");
  }
  void expectedSha;
  return { state, alreadyReconciled };
}

async function exactBackup(statePath: string, backupPath: string, beforeBytes: Buffer, metadata: Awaited<ReturnType<typeof lstat>>) {
  try {
    await stat(backupPath);
    throw new Error("IDLE_PROTECTED_RATE_BUDGET_RECOVERY_BACKUP_EXISTS");
  } catch (error: any) {
    if (error?.message === "IDLE_PROTECTED_RATE_BUDGET_RECOVERY_BACKUP_EXISTS") throw error;
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(backupPath), { recursive: true, mode: 0o700 });
  await copyFile(statePath, backupPath);
  if (!(await readFile(backupPath)).equals(beforeBytes)) throw new Error("IDLE_PROTECTED_RATE_BUDGET_RECOVERY_BACKUP_NOT_EXACT");
  if (process.platform !== "win32") {
    await chown(backupPath, Number(metadata.uid), Number(metadata.gid));
    await chmod(backupPath, Number(metadata.mode) & 0o777);
  }
}

export async function recoverIdleProtectedRateBudgetState(input: {
  statePath: string;
  expectedSha: string;
  sourceSha?: string;
  backupPath?: string;
  venue: IdleProtectedVenueReadback;
  now?: () => number;
}) {
  const expectedSha = exactSha(input.expectedSha, "EXPECTED_SHA");
  const sourceSha = exactSha(input.sourceSha || expectedSha, "SOURCE_SHA");
  const statePath = resolve(input.statePath);
  const metadata = await lstat(statePath);
  if (metadata.isSymbolicLink()) throw new Error("IDLE_PROTECTED_RATE_BUDGET_RECOVERY_SYMLINK_FORBIDDEN");
  if (!metadata.isFile()) throw new Error("IDLE_PROTECTED_RATE_BUDGET_RECOVERY_NOT_REGULAR_FILE");
  const beforeBytes = await readFile(statePath);
  const before = JSON.parse(beforeBytes.toString("utf8"));
  const { state: checked, alreadyReconciled } = assertStateShape(before, sourceSha, expectedSha);
  await assertProtectedVenueReadback(checked, input.venue);
  const now = input.now || Date.now;
  const backupPath = resolve(input.backupPath || `${statePath}.before-protected-rate-budget-recovery-${sourceSha}-${now()}`);
  await exactBackup(statePath, backupPath, beforeBytes, metadata);
  const after = {
    ...before,
    runtimeSha: expectedSha,
    updatedAt: now(),
    ...(alreadyReconciled ? {} : {
      manualReview: null,
      lastDecision: { decisionTs: now(), accepted: false, reason: "IDLE_PROTECTED_RATE_BUDGET_RECOVERY" },
      failures: [...(Array.isArray(before.failures) ? before.failures : []), { message: "IDLE_PROTECTED_RATE_BUDGET_RECOVERY", occurredAt: now() }].slice(-100),
    }),
  };
  normalizeIdleState(after, expectedSha);
  const temporary = `${statePath}.${process.pid}.${now()}.protected-rate-budget-recovery.tmp`;
  const fileMode = Number(metadata.mode) & 0o777;
  const handle = await open(temporary, "wx", fileMode);
  try {
    await handle.writeFile(`${JSON.stringify(after, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (process.platform !== "win32") {
    await chown(temporary, metadata.uid, metadata.gid);
    await chmod(temporary, fileMode);
  }
  await rename(temporary, statePath);
  const readback = JSON.parse(await readFile(statePath, "utf8"));
  const checkedReadback = normalizeIdleState(readback, expectedSha);
  if (checkedReadback.manualReview !== null || checkedReadback.positions.length !== checked.positions.length || checkedReadback.runtimeSha !== expectedSha) {
    throw new Error("IDLE_PROTECTED_RATE_BUDGET_RECOVERY_READBACK_MISMATCH");
  }
  return {
    status: "IDLE_PROTECTED_RATE_BUDGET_RECOVERY_PASS" as const,
    statePath,
    backupPath,
    sourceSha,
    runtimeSha: expectedSha,
    protectedPositions: checkedReadback.positions.length,
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  };
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    console.log("IDLE_PROTECTED_RATE_BUDGET_RECOVERY_SELFTEST_PASS");
    return;
  }
  if (!process.argv.includes("--apply")) throw new Error("IDLE_PROTECTED_RATE_BUDGET_RECOVERY_APPLY_REQUIRED");
  const statePath = arg("--state-path");
  const expectedSha = arg("--expected-sha");
  if (!statePath || !expectedSha) throw new Error("Usage: --apply --state-path PATH --expected-sha SHA [--source-sha SHA] [--backup-path PATH]");
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
    recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5_000),
    readOnlyRateLimitMaxRetries: 0,
    userAgent: `DisDex-IdleProtectedRecovery/${expectedSha.slice(0, 12)}`,
  });
  if (!client.hasTradingCredentials()) throw new Error("IDLE_PROTECTED_RATE_BUDGET_RECOVERY_REQUIRES_ASTER_CREDENTIALS");
  const venue: IdleProtectedVenueReadback = {
    async getPositions(symbol) {
      const rows = await client.getPositions(symbol);
      return rows.map((row) => ({ symbol: row.symbol, quantity: Number(row.positionAmt), positionSide: row.positionSide }));
    },
    async getOpenOrders(symbol) {
      const rows = await client.getOpenOrders(symbol);
      return rows.map((row) => ({
        symbol: row.symbol,
        clientOrderId: String(row.clientOrderId || ""),
        type: row.type,
        side: row.side,
        status: row.status,
        quantity: Number(row.origQty),
        executedQuantity: Number(row.executedQty),
        reduceOnly: row.reduceOnly === true,
        stopPrice: Number(row.stopPrice),
      }));
    },
  };
  console.log(JSON.stringify(await recoverIdleProtectedRateBudgetState({
    statePath,
    expectedSha,
    sourceSha: arg("--source-sha"),
    backupPath: arg("--backup-path"),
    venue,
  })));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "IDLE_PROTECTED_RATE_BUDGET_RECOVERY_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    process.exitCode = 1;
  });
}
