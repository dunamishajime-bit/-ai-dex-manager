import { dirname, join } from "node:path";

import { AsterV3Client } from "../lib/aster-v3-client";
import {
  managedAsterHistorySymbols,
  syncAsterTradeHistorySnapshot,
  writeAsterTradeHistoryPreservedStatus,
} from "../lib/disdex-aster-trade-history-sync";

const targetPath = process.env.DISDEX_GIT_HISTORY_SNAPSHOT_PATH?.trim()
  || "/home/deploy/ai-dex-manager/data/trade-history-git.json";
const statusPath = process.env.DISDEX_GIT_HISTORY_SYNC_STATUS_PATH?.trim()
  || join(dirname(targetPath), "trade-history-git-sync-status.json");

function numberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
    recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5_000),
    readOnlyRateLimitMaxRetries: 1,
    userAgent: "DisDex-Aster-Trade-History-ReadOnly/1.0",
  });
  if (!client.hasTradingCredentials()) throw new Error("ASTER_HISTORY_SYNC_CREDENTIALS_MISSING");
  const result = await syncAsterTradeHistorySnapshot({
    client,
    symbols: managedAsterHistorySymbols(process.env),
    targetPath,
    statusPath,
  });
  console.log(JSON.stringify(result));
}

main().catch(async (error) => {
  try {
    await writeAsterTradeHistoryPreservedStatus(statusPath, error);
  } catch {
    // Preserve the original error; this helper is read-only and never mutates trading state.
  }
  console.error(JSON.stringify({
    status: "ASTER_GIT_HISTORY_SYNC_PRESERVED",
    error: error instanceof Error ? error.message : String(error),
    targetPath,
    statusPath,
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
    tradingMutation: 0,
  }));
  process.exitCode = 1;
});
