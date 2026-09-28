import "dotenv/config";

import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { AsterV3Client } from "../lib/aster-v3-client";
import { runAsterReadOnlyRecoveryGate } from "../lib/aster-readonly-recovery-gate";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { normalizeLiveStateOwnership } from "../lib/disdex-live-state-ownership";
import { isRecoverableHypeZecMarketDataError } from "../lib/hype-zec-long-runner";
import { HYPE_ZEC_LONG_STATE_SCHEMA, type HypeZecLongRunnerState } from "../lib/hype-zec-long-runner-state";

export const HYPE_MARKET_DATA_RECOVERY_ACK = "I_ACK_HYPE_BENIGN_MARKET_DATA_RECOVERY_AFTER_READONLY_ABSENCE";
const SHA = /^[0-9a-f]{40}$/i;
const REVIEW_PREFIX = "HYPE_ZEC_RUNNER_FAIL_CLOSED:";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function exactSha(value: unknown, label: string) {
  const sha = String(value || "").trim().toLowerCase();
  if (!SHA.test(sha)) throw new Error(`HYPE_MARKET_DATA_RECOVERY_${label}_SHA_REQUIRED`);
  return sha;
}

export function assertRecoverableHypeMarketDataState(value: unknown, targetSha: string): HypeZecLongRunnerState {
  const state = value as HypeZecLongRunnerState;
  if (!state || state.schema !== HYPE_ZEC_LONG_STATE_SCHEMA || state.mode !== "LIVE") {
    throw new Error("HYPE_MARKET_DATA_RECOVERY_STATE_SCHEMA");
  }
  if (!SHA.test(targetSha) || String(state.runtimeCommitSha || "").toLowerCase() !== targetSha.toLowerCase()) {
    throw new Error("HYPE_MARKET_DATA_RECOVERY_RUNTIME_SHA_MISMATCH");
  }
  if ((state.positions || []).length > 0 || state.pending) {
    throw new Error("HYPE_MARKET_DATA_RECOVERY_LOCAL_EXPOSURE_PRESENT");
  }
  const review = String(state.manualReview || "");
  if (!review.startsWith(REVIEW_PREFIX) || !isRecoverableHypeZecMarketDataError(review.slice(REVIEW_PREFIX.length))) {
    throw new Error("HYPE_MARKET_DATA_RECOVERY_REASON_NOT_EXACT");
  }
  return state;
}

export function buildRecoveredHypeMarketDataState(state: HypeZecLongRunnerState, targetSha: string, updatedAt = Date.now()): HypeZecLongRunnerState {
  assertRecoverableHypeMarketDataState(state, targetSha);
  const reason = "HYPE_ZEC_BENIGN_MARKET_DATA_RECOVERY";
  return {
    ...state,
    runtimeCommitSha: targetSha,
    updatedAt,
    manualReview: undefined,
    lastDecisionTs: updatedAt,
    lastDecision: { strategy: "HYPE_LONG", signalTs: null, accepted: false, reason },
    failures: [...state.failures, { message: reason, occurredAt: updatedAt }].slice(-100),
  };
}

function assertStopped(unit: string) {
  const result = spawnSync("/usr/bin/systemctl", ["show", unit, "-p", "ActiveState", "-p", "MainPID", "--no-pager"], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`HYPE_MARKET_DATA_RECOVERY_SYSTEMD_CHECK_FAILED:${unit}`);
  const props = Object.fromEntries(String(result.stdout || "").split(/\r?\n/).filter(Boolean).map((line) => line.split("=", 2) as [string, string]));
  if (!(props.ActiveState === "inactive" || props.ActiveState === "failed") || props.MainPID !== "0") {
    throw new Error(`HYPE_MARKET_DATA_RECOVERY_UNIT_NOT_STOPPED:${unit}:${props.ActiveState || "unknown"}`);
  }
}

async function archiveState(path: string, targetSha: string) {
  const directory = resolve(dirname(path), "recovery-archive");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}-${targetSha.slice(0, 12)}-hype-market-data-state.json`);
  await copyFile(path, target);
  return target;
}

async function atomicWrite(path: string, state: HypeZecLongRunnerState) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function main() {
  if (process.argv.includes("--self-test")) {
    const sha = "a".repeat(40);
    const state: HypeZecLongRunnerState = {
      schema: HYPE_ZEC_LONG_STATE_SCHEMA,
      runtimeCommitSha: sha,
      mode: "LIVE",
      updatedAt: 1,
      manualReview: `${REVIEW_PREFIX}HYPE_ZEC_MARKET_DATA_ROW_INVALID`,
      failures: [],
    };
    const recovered = buildRecoveredHypeMarketDataState(state, sha, 2);
    if (recovered.manualReview || recovered.lastDecision?.accepted || recovered.runtimeCommitSha !== sha) throw new Error("HYPE_MARKET_DATA_RECOVERY_SELFTEST_FAILED");
    let rejected = false;
    try { assertRecoverableHypeMarketDataState({ ...state, manualReview: `${REVIEW_PREFIX}ASTER_AUTH_FAILURE` }, sha); } catch { rejected = true; }
    if (!rejected) throw new Error("HYPE_MARKET_DATA_RECOVERY_UNKNOWN_REASON_SELFTEST_FAILED");
    console.log("HYPE_MARKET_DATA_RECOVERY_SELFTEST_PASS");
    return;
  }

  const targetSha = exactSha(arg("--sha"), "TARGET");
  if (arg("--ack") !== HYPE_MARKET_DATA_RECOVERY_ACK) throw new Error("HYPE_MARKET_DATA_RECOVERY_ACK_REQUIRED");
  const currentSha = (await readFile("/home/deploy/disdex-trading/current/.disdex-release-sha", "utf8")).trim().toLowerCase();
  if (currentSha !== targetSha) throw new Error("HYPE_MARKET_DATA_RECOVERY_CURRENT_SHA_MISMATCH");
  assertStopped(`disdex-hype-long@${targetSha}.service`);

  const statePath = resolve(process.env.DISDEX_HYPE_ZEC_STATE_PATH || "/var/lib/disdex/hype-zec-long/runner.json");
  const before = JSON.parse(await readFile(statePath, "utf8")) as HypeZecLongRunnerState;
  assertRecoverableHypeMarketDataState(before, targetSha);
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    readOnlyRateLimitMaxRetries: 0,
    userAgent: `DisDex-HYPE-MarketData-Recovery/${targetSha.slice(0, 12)}`,
  });
  if (!client.hasTradingCredentials()) throw new Error("HYPE_MARKET_DATA_RECOVERY_ASTER_CREDENTIALS_MISSING");
  const lock = new FileAccountOrderLock(resolve(process.env.DISDEX_ACCOUNT_LOCK_PATH || "/var/lib/disdex/shared/account-order.lock"), 120_000);
  const handle = await lock.acquire(`HYPE_MARKET_DATA_RECOVERY:${process.pid}`);
  if (!handle) throw new Error("HYPE_MARKET_DATA_RECOVERY_ACCOUNT_LOCK_UNAVAILABLE");
  try {
    const gate = await runAsterReadOnlyRecoveryGate(client, { requiredConsecutiveSuccesses: 3, requestSpacingMs: 750, roundSpacingMs: 5_000, requireFlat: false });
    const [positions, openOrders] = await Promise.all([client.getPositions(), client.getOpenOrders()]);
    const sidecarPositions = positions.filter((row) => ["HYPEUSDT", "ZECUSDT"].includes(String(row.symbol || "").toUpperCase()) && Math.abs(Number(row.positionAmt) || 0) > 1e-12);
    const sidecarOrders = openOrders.filter((row) => ["HYPEUSDT", "ZECUSDT"].includes(String(row.symbol || "").toUpperCase()) && ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(String(row.status || "").toUpperCase()));
    if (sidecarPositions.length) throw new Error(`HYPE_MARKET_DATA_RECOVERY_POSITION_PRESENT:${sidecarPositions.map((row) => row.symbol).join(",")}`);
    if (sidecarOrders.length) throw new Error(`HYPE_MARKET_DATA_RECOVERY_OPEN_ORDER_PRESENT:${sidecarOrders.map((row) => row.clientOrderId).join(",")}`);
    const backupPath = await archiveState(statePath, targetSha);
    const recovered = buildRecoveredHypeMarketDataState(before, targetSha);
    await atomicWrite(statePath, recovered);
    await normalizeLiveStateOwnership(statePath, { label: "HYPE_MARKET_DATA_RECOVERY_STATE" });
    const after = JSON.parse(await readFile(statePath, "utf8")) as HypeZecLongRunnerState;
    if (after.manualReview || after.pending || (after.positions || []).length) throw new Error("HYPE_MARKET_DATA_RECOVERY_POSTCHECK_FAILED");
    console.log(JSON.stringify({ ...gate, status: "HYPE_MARKET_DATA_RECOVERY_PASS", targetSha, statePath, backupPath, sidecarPositions: 0, sidecarOpenOrders: 0, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
  } finally {
    await handle.release();
  }
}

if (process.argv[1]?.endsWith("disdex-hype-market-data-recovery.ts")) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "HYPE_MARKET_DATA_RECOVERY_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    process.exitCode = 1;
  });
}
