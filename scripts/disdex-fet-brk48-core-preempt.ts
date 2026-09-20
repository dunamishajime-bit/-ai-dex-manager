import "dotenv/config";

import { AsterV3Client } from "../lib/aster-v3-client";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import { reduceFetBrk48ForCoreConflict } from "../lib/fet-brk48-live-reduction";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function numberEnv(name: string, fallback: number) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  if (!/^(1|true|yes|on)$/i.test(String(process.env.FET_BRK48_CORE_PREEMPTION_READY || ""))) {
    throw new Error("FET_CORE_PREEMPTION_NOT_READY");
  }
  const caller = String(arg("--caller") || "").trim().toUpperCase();
  if (!["V12_CORE", "PENGU_CORE", "Q102_CORE", "V52_CORE"].includes(caller)) {
    throw new Error("FET_CORE_PREEMPT_CALLER_NOT_ALLOWED");
  }
  if (arg("--shared-lock-held") !== "true") {
    throw new Error("FET_CORE_PREEMPT_SHARED_LOCK_ASSERTION_REQUIRED");
  }
  const cause = String(arg("--cause") || "").trim();
  if (!cause) throw new Error("FET_CORE_PREEMPT_CAUSE_REQUIRED");

  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
    recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5_000),
    userAgent: "DisDex-FET-Core-Preempt/1.0",
  });
  if (!client.hasTradingCredentials()) throw new Error("FET_CORE_PREEMPT_ASTER_CREDENTIALS_REQUIRED");

  const adapter = new V12AsterLiveAdapter(client, {
    maxSlippageBps: numberEnv("FET_BRK48_MAX_SLIPPAGE_BPS", 20),
    reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
    reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1_500),
    readRequestSpacingMs: numberEnv("V12_X1_ALL_REQUEST_SPACING_MS", 100),
  });
  const result = await reduceFetBrk48ForCoreConflict({
    executor: adapter.executor,
    adapter,
    causeIdempotencyKey: cause,
    statePath: arg("--state-path") || process.env.FET_BRK48_STATE_PATH,
    maxSlippageBps: numberEnv("FET_BRK48_MAX_SLIPPAGE_BPS", 20),
    expectedRuntimeSha: process.env.DISDEX_RUNTIME_COMMIT_SHA,
  });
  console.log(JSON.stringify({ caller, cause, ...result }));
  if (result.status === "blocked") process.exitCode = 2;
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "blocked",
    message: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 2;
});
