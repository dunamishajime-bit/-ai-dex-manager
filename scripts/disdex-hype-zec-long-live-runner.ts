import "dotenv/config";

import { resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor } from "../lib/direct-trade-executor";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { HypeZecLongRunner } from "../lib/hype-zec-long-runner";
import { HypeZecAsterMarketDataProvider } from "../lib/hype-zec-long-market-data";
import { FileHypeZecLongRunnerStateStore } from "../lib/hype-zec-long-runner-state";
import { resolveHypeZecLongRuntime } from "../config/hypeZecLongRuntime";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import { createInterruptibleDelay } from "../lib/interruptible-delay";

function numberEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name: string) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

function runtimeSha(runtimeSha: string) {
  if (/^[0-9a-f]{40}$/i.test(runtimeSha)) return runtimeSha.toLowerCase();
  // Shadow/PAPER state is still lineage-tagged, but must never be promoted to
  // LIVE by omission. The LIVE gate rejects this value before any order path.
  return "shadow-unpinned";
}

async function main() {
  const runtime = resolveHypeZecLongRuntime();
  if (process.argv.includes("--self-test")) {
    if (runtime.mode === "LIVE" && !boolEnv("DISDEX_HYPE_ZEC_OPERATOR_ARMED")) throw new Error("HYPE_ZEC_SELFTEST_MUST_NOT_ARM_LIVE");
    console.log(JSON.stringify({ event: "hype-zec-runner-selftest", status: "PASS", mode: runtime.mode, enabled: runtime.enabled, liveOrders: 0, cancelOrders: 0, positionChanges: 0 }));
    return;
  }
  if (!runtime.enabled) {
    console.log(JSON.stringify({ event: "hype-zec-runtime", status: "disabled", mode: runtime.mode, liveOrders: 0, cancelOrders: 0, positionChanges: 0 }));
    return;
  }

  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
    recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5_000),
    userAgent: `DisDex-HYPE-ZEC-LONG/${runtimeSha(runtime.runtimeSha).slice(0, 12)}`,
  });
  if (!client.hasTradingCredentials()) throw new Error("HYPE_ZEC_REQUIRES_ASTER_READONLY_CREDENTIALS");
  const executor = new AsterDirectTradeExecutor(client, {
    exchangeInfoTtlMs: numberEnv("ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
    reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
    reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1_500),
  });
  const adapter = new V12AsterLiveAdapter(client, {
    maxSlippageBps: runtime.maximumSlippageBps,
    reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
    reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1_500),
    readRequestSpacingMs: numberEnv("V12_X1_ALL_REQUEST_SPACING_MS", 100),
  });
  const lock = new FileAccountOrderLock(process.env.DISDEX_ACCOUNT_LOCK_PATH || "/var/lib/disdex/shared/account-order.lock", numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000));
  const stateStore = new FileHypeZecLongRunnerStateStore(resolve(runtime.statePath), runtimeSha(runtime.runtimeSha), runtime.mode);
  const runner = new HypeZecLongRunner({
    marketData: new HypeZecAsterMarketDataProvider(client, {
      fifteenMinuteLimit: numberEnv("DISDEX_HYPE_ZEC_15M_LIMIT", 240),
      oneMinuteLimit: numberEnv("DISDEX_HYPE_ZEC_1M_LIMIT", 240),
    }),
    executor,
    adapter,
    stateStore,
    lock,
    runtime: { ...runtime, runtimeSha: runtimeSha(runtime.runtimeSha) },
  });

  const daemon = process.argv.includes("--daemon");
  const delay = createInterruptibleDelay();
  let stopping = false;
  const stop = () => { stopping = true; delay.interrupt(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  do {
    const result = await runner.tick();
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), event: "hype-zec-runner-tick", mode: runtime.mode, ...result, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    if (!daemon || stopping || result.status === "manual-review") break;
    await delay.wait(Math.max(5_000, Math.min(15 * 60_000, runtime.maximumEntryDelayMs)));
  } while (!stopping);
}

main().catch((error) => {
  console.error(JSON.stringify({ level: "fatal", event: "hype-zec-runner", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
  process.exitCode = 1;
});
