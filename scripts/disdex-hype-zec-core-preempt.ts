import "dotenv/config";

import { readFile } from "node:fs/promises";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor } from "../lib/direct-trade-executor";
import { aggregatePendingExposure, readPendingExposureRegistry } from "../lib/disdex-pending-exposure-registry";
import { releaseHypeZecCapacityForPriorityEntry } from "../lib/hype-zec-priority-capacity";
import type { StrictPortfolioIntent, StrictStrategy } from "../lib/disdex-strict-portfolio-planner";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(name: string) {
  const value = Number(arg(name));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`HYPE_ZEC_CORE_PREEMPT_INVALID:${name}`);
  return value;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

async function sharedLockDocument() {
  const path = process.env.DISDEX_ACCOUNT_LOCK_PATH || "/var/lib/disdex/shared/account-order.lock";
  const value = JSON.parse(await readFile(path, "utf8")) as { schema?: string; expiresAt?: number; ownerId?: string; leaseId?: string };
  if (value.schema !== "disdex-account-lock/v1" || !value.ownerId || !value.leaseId || Number(value.expiresAt) <= Date.now()) {
    throw new Error("HYPE_ZEC_CORE_PREEMPT_SHARED_LOCK_UNCONFIRMED");
  }
  return value;
}

async function main() {
  const caller = String(arg("--caller") || "").trim().toUpperCase();
  if (caller !== "V52_CORE") throw new Error("HYPE_ZEC_CORE_PREEMPT_CALLER_NOT_ALLOWED");
  if (arg("--shared-lock-held") !== "true") throw new Error("HYPE_ZEC_CORE_PREEMPT_SHARED_LOCK_ASSERTION_REQUIRED");
  if (!/^(1|true|yes|on)$/i.test(String(process.env.DISDEX_HYPE_ZEC_PREEMPTION_ENABLED || ""))) {
    throw new Error("HYPE_ZEC_PREEMPTION_OPERATOR_DISABLED");
  }
  const runtimeSha = String(process.env.DISDEX_RUNTIME_COMMIT_SHA || process.env.DISDEX_RELEASE_SHA || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(runtimeSha)) throw new Error("HYPE_ZEC_CORE_PREEMPT_RUNTIME_SHA_REQUIRED");
  const strategy = String(arg("--candidate-strategy") || "V50_POST_OPEN_BASIS").trim().toUpperCase() as StrictStrategy;
  if (strategy !== "V11_EQ" && strategy !== "V50_POST_OPEN_BASIS") throw new Error("HYPE_ZEC_CORE_PREEMPT_STOCK_STRATEGY_REQUIRED");
  const symbol = String(arg("--candidate-symbol") || "").trim().toUpperCase();
  if (!symbol) throw new Error("HYPE_ZEC_CORE_PREEMPT_SYMBOL_REQUIRED");
  const gross = numberArg("--candidate-gross");
  const equityUsd = numberArg("--equity");
  const signalTs = numberArg("--signal-ts");
  const causeIdempotencyKey = String(arg("--cause") || "").trim();
  if (!causeIdempotencyKey) throw new Error("HYPE_ZEC_CORE_PREEMPT_CAUSE_REQUIRED");

  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
    recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5_000),
    userAgent: `DisDex-HYPE-ZEC-Core-Preempt/${runtimeSha.slice(0, 12)}`,
  });
  if (!client.hasTradingCredentials()) throw new Error("HYPE_ZEC_CORE_PREEMPT_ASTER_CREDENTIALS_REQUIRED");
  const adapter = new V12AsterLiveAdapter(client, {
    maxSlippageBps: numberEnv("V12_X1_ALL_MAX_SLIPPAGE_BPS", 20),
    reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
    reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1_500),
    readRequestSpacingMs: numberEnv("V12_X1_ALL_REQUEST_SPACING_MS", 100),
  });
  const executor = new AsterDirectTradeExecutor(client, {
    exchangeInfoTtlMs: numberEnv("ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
    reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
    reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1_500),
  });
  const positions = await executor.getPositions();
  const pending = aggregatePendingExposure(await readPendingExposureRegistry());
  const candidate: StrictPortfolioIntent = {
    idempotencyKey: causeIdempotencyKey,
    strategy,
    symbol,
    side: "LONG",
    gross,
    requestedGross: gross,
    notionalUsd: gross * equityUsd,
    signalTs,
  };
  const lock = { document: sharedLockDocument };
  const result = await releaseHypeZecCapacityForPriorityEntry({
    adapter,
    executor,
    lock,
    positions,
    equityUsd,
    candidate,
    pendingCryptoGross: pending.cryptoGross,
    pendingTotalGross: pending.cryptoGross + pending.stockGross,
    cryptoEntryCap: Number(process.env.CRYPTO_GROSS_CAP || 3),
    totalEntryCap: Number(process.env.TOTAL_GROSS_CAP || 4.25),
    causeIdempotencyKey,
    expectedRuntimeSha: runtimeSha,
    enabled: true,
    statePath: process.env.DISDEX_HYPE_ZEC_PREEMPTION_STATE_PATH,
    maxSlippageBps: numberEnv("V12_X1_ALL_MAX_SLIPPAGE_BPS", 20),
  });
  console.log(JSON.stringify({ caller, causeIdempotencyKey, ...result, ordersSent: result.status === "reduced" ? result.result?.results?.length || 0 : 0 }));
  if (result.status === "blocked") process.exitCode = 2;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "blocked", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
  process.exitCode = 2;
});
