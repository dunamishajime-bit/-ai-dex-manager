import "dotenv/config";

import { AsterV3Client } from "../lib/aster-v3-client";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import { FetBrk48LiveRunner } from "../lib/fet-brk48-live-runner";
import { createInterruptibleDelay } from "../lib/interruptible-delay";

function numberEnv(name: string, fallback: number) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const runtimeSha = String(process.env.DISDEX_RUNTIME_COMMIT_SHA || process.env.DISDEX_RELEASE_SHA || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(runtimeSha)) throw new Error("FET_RUNTIME_SHA_REQUIRED");
  if (!/^(1|true|yes|on)$/i.test(String(process.env.FET_BRK48_LIVE_ENABLED || ""))) {
    throw new Error("FET_BRK48_LIVE_NOT_ENABLED");
  }

  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
    recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5_000),
    userAgent: "DisDex-FET-BRK48-LIVE/1.0",
  });
  if (!client.hasTradingCredentials()) throw new Error("FET_ASTER_CREDENTIALS_REQUIRED");

  if (process.argv.includes("--preflight")) {
    const [balances, positions, openOrders, klines] = await Promise.all([
      client.getBalances(),
      client.getPositions("FETUSDT"),
      client.getOpenOrders("FETUSDT"),
      client.getKlines("FETUSDT", "1h", 120),
    ]);
    const row = positions.find((item) => String(item.symbol || "").toUpperCase() === "FETUSDT");
    if (!row) throw new Error("FET_PREFLIGHT_POSITION_RISK_MISSING");
    const leverage = Number(row.leverage);
    const marginType = String(row.marginType || "").trim().toLowerCase();
    if (leverage !== 5) throw new Error(`FET_PREFLIGHT_LEVERAGE_MISMATCH:${leverage}`);
    if (marginType !== "cross") throw new Error(`FET_PREFLIGHT_MARGIN_MODE_MISMATCH:${marginType}`);
    if (!Array.isArray(balances) || !Array.isArray(openOrders) || !Array.isArray(klines) || klines.length < 73) {
      throw new Error("FET_PREFLIGHT_READONLY_EVIDENCE_INCOMPLETE");
    }
    console.log(JSON.stringify({
      status: "FET_READONLY_PREFLIGHT_PASS",
      runtimeSha,
      symbol: "FETUSDT",
      leverage,
      marginType,
      openOrders: openOrders.length,
      klines: klines.length,
      ordersSent: 0,
      cancelSent: 0,
      positionChangesSent: 0,
    }));
    return;
  }

  const adapter = new V12AsterLiveAdapter(client, {
    maxSlippageBps: numberEnv("FET_BRK48_MAX_SLIPPAGE_BPS", 20),
    reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
    reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1_500),
    readRequestSpacingMs: numberEnv("V12_X1_ALL_REQUEST_SPACING_MS", 100),
  });
  const runner = new FetBrk48LiveRunner({
    client,
    executor: adapter.executor,
    adapter,
    statePath: process.env.FET_BRK48_STATE_PATH || "/var/lib/disdex/fet-brk48-residual/state.json",
    runtimeSha,
    sharedRiskPath: process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_FILE,
    maxSlippageBps: numberEnv("FET_BRK48_MAX_SLIPPAGE_BPS", 20),
    minimumOrderNotionalUsd: numberEnv("FET_BRK48_MIN_ORDER_NOTIONAL_USD", 5),
  });

  const daemon = process.argv.includes("--daemon");
  const delay = createInterruptibleDelay();
  let stop = false;
  const shutdown = () => { stop = true; delay.interrupt(); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  do {
    const result = await runner.tick();
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), strategyId: "FET_BRK48_RESIDUAL", runtimeSha, ...result }));
    if (!daemon || stop) break;
    await delay.wait(numberEnv("FET_BRK48_POLL_MS", 30_000));
  } while (!stop);
}

main().catch((error) => {
  console.error(JSON.stringify({
    level: "fatal",
    strategyId: "FET_BRK48_RESIDUAL",
    message: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
