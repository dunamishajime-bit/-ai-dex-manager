import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { AsterV3Client } from "../lib/aster-v3-client";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { FileQuality102CausalV1StateStore } from "../lib/disdex-quality102-causal-v1-state";
import {
  FileV12X1AllRunnerStateStore,
  type V12X1AllRunnerState,
} from "../lib/v12-x1-all-runner-state";
import { normalizeLiveStateOwnership } from "../lib/disdex-live-state-ownership";

const SHA = /^[0-9a-f]{40}$/i;
export const ACK = "I_ACK_V12_ACTIVE_STATE_SHA_MIGRATION_AFTER_READONLY_RECONCILIATION";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function exactSha(value: unknown, field: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA.test(normalized)) throw new Error(`V12_ACTIVE_STATE_SHA_MIGRATE_${field}_INVALID`);
  return normalized;
}

function activePositions(state: V12X1AllRunnerState): NonNullable<V12X1AllRunnerState["activePositions"]> {
  return state.activePositions ?? (state.active ? [state.active] : []);
}

export function assertActiveV12StateForShaMigration(
  value: unknown,
  fromSha: string,
  toSha: string,
): asserts value is V12X1AllRunnerState {
  const state = value as Partial<V12X1AllRunnerState>;
  const source = exactSha(fromSha, "FROM_SHA");
  exactSha(toSha, "TO_SHA");
  if (!(["v12-x1-all-runner-state/v1", "v12-x1-all-runner-state/v2"] as string[]).includes(String(state.schema))) {
    throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_SCHEMA");
  }
  if (state.strategyId !== "V12_X1.00_ALL" || state.mode !== "LIVE") {
    throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_IDENTITY");
  }
  if (String(state.runtimeCommitSha || "").toLowerCase() !== source) {
    throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_SOURCE_SHA_MISMATCH");
  }
  if (state.pending) throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_PENDING_PRESENT");
  if (state.manualReview || state.killSwitch?.active === true) {
    throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_REVIEW_OR_KILLSWITCH");
  }
  const positions = activePositions(state as V12X1AllRunnerState);
  if (!positions.length) throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_NO_ACTIVE_POSITION");
  let aggregateGross = 0;
  for (const position of positions) {
    if (!position.protection) throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_PROTECTION_MISSING");
    if (position.protection.positionId !== position.positionId) throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_PROTECTION_ID_MISMATCH");
    if (Math.abs(position.protection.quantity - position.quantity) > Math.max(1e-8, position.quantity * 0.001)) {
      throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_PROTECTION_QTY_MISMATCH");
    }
    aggregateGross += Number(position.gross);
  }
  if (!Number.isFinite(aggregateGross) || aggregateGross <= 0 || aggregateGross > 2.0 + 1e-9) {
    throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_GROSS_INVALID");
  }
}

export function buildMigratedV12State(
  state: V12X1AllRunnerState,
  toSha: string,
  updatedAt = Date.now(),
): V12X1AllRunnerState {
  return { ...state, runtimeCommitSha: exactSha(toSha, "TO_SHA"), updatedAt };
}

function systemdProps(unit: string): Record<string, string> {
  const result = spawnSync("/usr/bin/systemctl", ["show", unit, "-p", "ActiveState", "-p", "MainPID", "--no-pager"], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`V12_ACTIVE_STATE_SHA_MIGRATE_SYSTEMD_CHECK_FAILED:${unit}`);
  return Object.fromEntries(String(result.stdout || "").split(/\r?\n/).filter(Boolean).map((line) => line.split("=", 2) as [string, string]));
}

function positionSide(row: Record<string, unknown>): "LONG" | "SHORT" {
  return Number(row.positionAmt) >= 0 ? "LONG" : "SHORT";
}

function finite(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`V12_ACTIVE_STATE_SHA_MIGRATE_${field}_INVALID`);
  return number;
}

function assertExchangeMatchesState(
  state: V12X1AllRunnerState,
  positionRows: readonly Record<string, unknown>[],
  openOrders: readonly Record<string, unknown>[],
): void {
  const positions = activePositions(state);
  const managedSymbols = new Set(positions.map((position) => position.symbol.toUpperCase()));
  const actual = positionRows.filter((row) => Math.abs(finite(row.positionAmt, "POSITION_QTY")) > 1e-12);
  if (actual.length !== positions.length) throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_POSITION_COUNT_MISMATCH");
  const managedOrderIds = new Set<string>();
  for (const position of positions) {
    const row = actual.find((candidate) => String(candidate.symbol || "").toUpperCase() === position.symbol.toUpperCase());
    if (!row || positionSide(row) !== position.side || Math.abs(Math.abs(finite(row.positionAmt, "POSITION_QTY")) - position.quantity) > Math.max(1e-8, position.quantity * 0.01)) {
      throw new Error(`V12_ACTIVE_STATE_SHA_MIGRATE_POSITION_MISMATCH:${position.symbol}`);
    }
    const protection = position.protection;
    for (const clientOrderId of [protection.stopClientOrderId, protection.takeProfitClientOrderId]) {
      if (!clientOrderId) throw new Error(`V12_ACTIVE_STATE_SHA_MIGRATE_PROTECTION_ID_MISSING:${position.symbol}`);
      managedOrderIds.add(clientOrderId);
      const order = openOrders.find((candidate) => String(candidate.clientOrderId || "") === clientOrderId);
      if (!order || order.reduceOnly !== true || !["NEW", "OPEN"].includes(String(order.status || "").toUpperCase())) {
        throw new Error(`V12_ACTIVE_STATE_SHA_MIGRATE_PROTECTION_MISMATCH:${position.symbol}`);
      }
      if (Math.abs(finite(order.origQty, "ORDER_QTY") - position.quantity) > Math.max(1e-8, position.quantity * 0.001)) {
        throw new Error(`V12_ACTIVE_STATE_SHA_MIGRATE_PROTECTION_QTY_MISMATCH:${position.symbol}`);
      }
    }
  }
  if (actual.some((row) => !managedSymbols.has(String(row.symbol || "").toUpperCase()))) {
    throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_UNKNOWN_POSITION");
  }
  if (openOrders.some((order) => !managedOrderIds.has(String(order.clientOrderId || "")))) {
    throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_UNKNOWN_OPEN_ORDER");
  }
}

async function archiveState(statePath: string, targetSha: string): Promise<string> {
  const directory = resolve(dirname(statePath), "recovery-archive");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${targetSha.slice(0, 12)}-active-state-sha-migrate.json`);
  await copyFile(statePath, target);
  return target;
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-test")) {
    const sample = {
      schema: "v12-x1-all-runner-state/v2" as const,
      strategyId: "V12_X1.00_ALL" as const,
      mode: "LIVE" as const,
      updatedAt: 1,
      runtimeCommitSha: "a".repeat(40),
      activePositions: [{
        symbol: "DOGEUSDT", side: "LONG" as const, quantity: 1, gross: 0.5,
        baseQuantity: 1, dynamicQuantity: 0, baseGross: 0.5, dynamicGross: 0,
        entryRank: 1, positionId: "p", entryPrice: 1, atrAtEntry: 0.1,
        entrySignalTs: 1, holdingBars: 1, peakPrice: 1, troughPrice: 1,
        protection: { strategyId: "V12_X1.00_ALL", symbol: "DOGEUSDT", side: "LONG" as const, positionId: "p", quantity: 1, entryPrice: 1, atrAtEntry: 0.1, initialStop: 0.9, lastAckStop: 0.95, takeProfit: 1.1, peakOrTrough: 1, stopClientOrderId: "s", takeProfitClientOrderId: "t" },
      }],
    };
    assertActiveV12StateForShaMigration(sample, "a".repeat(40), "b".repeat(40));
    const migrated = buildMigratedV12State(sample as V12X1AllRunnerState, "b".repeat(40), 2);
    if (migrated.runtimeCommitSha !== "b".repeat(40) || migrated.activePositions?.length !== 1) throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_SELFTEST_FAILED");
    console.log("V12_ACTIVE_STATE_SHA_MIGRATE_SELFTEST_PASS");
    return;
  }

  const fromSha = exactSha(arg("--from-sha"), "FROM_SHA");
  const toSha = exactSha(arg("--to-sha"), "TO_SHA");
  if (arg("--ack") !== ACK) throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_ACK_REQUIRED");
  const currentSha = (await readFile("/home/deploy/disdex-trading/current/.disdex-release-sha", "utf8")).trim().toLowerCase();
  if (currentSha !== toSha) throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_CURRENT_SHA_MISMATCH");
  const unit = `disdex-v12-x1-all@${toSha}.service`;
  const props = systemdProps(unit);
  if (!(props.ActiveState === "inactive" || props.ActiveState === "failed") || props.MainPID !== "0") throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_RUNNER_NOT_STOPPED");

  const statePath = resolve(arg("--state-path") || "/var/lib/disdex/v12-x1-all/runner.json");
  const q102Path = resolve(process.env.QUALITY102_CAUSAL_V1_STATE_PATH || "/var/lib/disdex/quality102-causal-v1/state.json");
  const stateStore = new FileV12X1AllRunnerStateStore(statePath, "LIVE");
  const before = await stateStore.load();
  assertActiveV12StateForShaMigration(before, fromSha, toSha);
  const q102 = await new FileQuality102CausalV1StateStore(q102Path, "LIVE", toSha).load();
  if (q102.runtimeCommitSha.toLowerCase() !== toSha || q102.pending || q102.position) throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_Q102_NOT_FLAT_CURRENT");
  const kill = await readSharedKillSwitch();
  if (kill.active) throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_SHARED_KILL_ACTIVE");
  const risk = await readSharedCryptoDailyRisk(resolve(process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH || "/var/lib/disdex/shared/crypto-daily-risk.json"));
  if (!risk.ok) throw new Error(`V12_ACTIVE_STATE_SHA_MIGRATE_RISK_NOT_READY:${risk.reason}`);
  const margin = JSON.parse(await readFile(resolve(process.env.DISDEX_V96_V52_MARGIN_GUARD_STATE_FILE || "/var/lib/disdex/shared/margin-risk/guard-live.json"), "utf8")) as { stage?: unknown; ordersAllowed?: unknown };
  if (margin.stage !== "HEALTHY" || margin.ordersAllowed !== true) throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_MARGIN_NOT_HEALTHY");

  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    readOnlyRateLimitMaxRetries: 0,
    userAgent: `DisDex-V12-Active-State-Sha-Migrate/${toSha.slice(0, 12)}`,
  });
  if (!client.hasTradingCredentials()) throw new Error("V12_ACTIVE_STATE_SHA_MIGRATE_ASTER_CREDENTIALS_MISSING");
  const [positionRows, openOrders] = await Promise.all([client.getPositions(), client.getOpenOrders()]);
  assertExchangeMatchesState(before, positionRows as unknown as Record<string, unknown>[], openOrders as unknown as Record<string, unknown>[]);
  const backupPath = await archiveState(statePath, toSha);
  const migrated = buildMigratedV12State(before, toSha);
  await stateStore.save(migrated);
  await normalizeLiveStateOwnership(statePath, { label: "V12_ACTIVE_STATE_SHA_MIGRATE_STATE" });
  const after = await stateStore.load();
  assertActiveV12StateForShaMigration(after, toSha, toSha);
  const metadata = await stat(statePath);
  console.log(JSON.stringify({
    status: "V12_ACTIVE_STATE_SHA_MIGRATE_PASS",
    statePath,
    backupPath,
    fromRuntimeSha: fromSha,
    toRuntimeSha: toSha,
    activePositions: activePositions(after).map((position) => ({ symbol: position.symbol, quantity: position.quantity, gross: position.gross })),
    protectiveOrderCount: activePositions(after).length * 2,
    stateOwner: `${metadata.uid}:${metadata.gid}`,
    stateMode: metadata.mode.toString(8),
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "V12_ACTIVE_STATE_SHA_MIGRATE_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    process.exitCode = 1;
  });
}
