import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { AsterV3Client } from "../lib/aster-v3-client";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { normalizeLiveStateOwnership } from "../lib/disdex-live-state-ownership";
import { FileQuality102CausalV1StateStore } from "../lib/disdex-quality102-causal-v1-state";
import { Q102_PENDING_RECOVERY_ACK, reconcilePlannedQ102Pending } from "../lib/disdex-quality102-pending-recovery";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string) {
  const value = String(arg(name) || "").trim();
  if (!value) throw new Error(`Q102_PENDING_RECOVERY_ARGUMENT_REQUIRED:${name}`);
  return value;
}

async function main() {
  const sha = required("--sha").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("Q102_PENDING_RECOVERY_RUNTIME_SHA_INVALID");
  const statePath = resolve(process.env.QUALITY102_CAUSAL_V1_STATE_PATH || "/var/lib/disdex/quality102-causal-v1/state.json");
  const store = new FileQuality102CausalV1StateStore(statePath, "LIVE", sha);
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    readOnlyRateLimitMaxRetries: 0,
    userAgent: `DisDex-Q102-Pending-Recovery/${sha.slice(0, 12)}`,
  });
  if (!client.hasTradingCredentials()) throw new Error("Q102_PENDING_RECOVERY_ASTER_CREDENTIALS_MISSING");

  const apply = process.argv.includes("--apply");
  const archiveDir = resolve(process.env.QUALITY102_CAUSAL_V1_RECOVERY_ARCHIVE || "/var/lib/disdex/quality102-causal-v1/recovery-archive");
  const backupPath = resolve(archiveDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${sha.slice(0, 12)}-pending-recovery.json`);
  if (apply) await mkdir(archiveDir, { recursive: true, mode: 0o700 });

  const lock = new FileAccountOrderLock(resolve(process.env.DISDEX_ACCOUNT_LOCK_PATH || "/var/lib/disdex/shared/account-order.lock"), 120_000);
  const handle = await lock.acquire(`Q102_PENDING_RECOVERY:${process.pid}`);
  if (!handle) throw new Error("Q102_PENDING_RECOVERY_ACCOUNT_LOCK_UNAVAILABLE");
  try {
    const before = await store.load();
    if (!before.pending) {
      if (!process.argv.includes("--allow-no-pending")) throw new Error("Q102_PENDING_RECOVERY_PENDING_REQUIRED");
      console.log(JSON.stringify({
        status: "Q102_PENDING_RECOVERY_NOT_REQUIRED",
        statePath,
        runtimeCommitSha: sha,
        ordersSent: 0,
        cancelsSent: 0,
        positionChangesSent: 0,
      }));
      return;
    }
    const result = await reconcilePlannedQ102Pending({
      stateStore: store,
      readonlyDeps: {
        getOrder: (symbol, clientOrderId) => client.getOrder(symbol, clientOrderId),
        getUserTrades: async (symbol, input) => {
          const rows = await client.getUserTrades(symbol, input);
          return { rows, complete: rows.length < (input.limit || 1_000) };
        },
        getPositions: () => client.getPositions(),
        getOpenOrders: () => client.getOpenOrders(),
      },
      expectedRuntimeSha: sha,
      expectedIdempotencyKey: before.pending.idempotencyKey,
      expectedClientOrderId: before.pending.clientOrderId,
      statePath,
      ...(apply ? { apply: true, ack: arg("--ack"), requiredAck: Q102_PENDING_RECOVERY_ACK, backupPath } : {}),
    });
    if (apply) await normalizeLiveStateOwnership(statePath, { label: "Q102_PENDING_RECOVERY_STATE" });
    console.log(JSON.stringify({ ...result, statePath, runtimeCommitSha: sha }));
  } finally {
    await handle.release();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "Q102_PENDING_RECOVERY_FAIL_CLOSED",
    message: error instanceof Error ? error.message : String(error),
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  }));
  process.exitCode = 1;
});
