import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  DEPLOY_APPROVAL_SCOPE,
  type DeploymentApprovalOperation,
  type DeploymentApprovalScope,
} from "@/lib/deploy-approval-token";

export type DeploymentApprovalStatus =
  | "PENDING"
  | "OTP_SENT"
  | "APPROVED"
  | "DISPATCHED"
  | "REDEEMED"
  | "RETRYABLE"
  | "COMPLETED"
  | "EXPIRED"
  | "FAILED";

export type DeploymentApprovalRecord = {
  id: string;
  scope: DeploymentApprovalScope;
  operation?: DeploymentApprovalOperation;
  ordersEnabled?: boolean;
  targetSha: string;
  planSha256: string;
  requestActor: string;
  requestCommentId?: string;
  createdAt: number;
  requestExpiresAt: number;
  updatedAt: number;
  status: DeploymentApprovalStatus;
  otpHash?: string;
  otpSentAt?: number;
  otpExpiresAt?: number;
  otpAttemptsRemaining?: number;
  approvedAt?: number;
  approvalToken?: string;
  approvalTokenExpiresAt?: number;
  dispatchedAt?: number;
  redeemedAt?: number;
  redeemedByRunId?: string;
  approverIpHash?: string;
  lastError?: string;
  retryPolicy?: "IDLE_NONORDER_RETRY_V1";
  grantExpiresAt?: number;
  maxAttempts?: number;
  attemptCount?: number;
  lastRunOutcome?: "success" | "failure";
  completedAt?: number;
};

export type DeploymentApprovalSummary = Omit<
  DeploymentApprovalRecord,
  "otpHash" | "approvalToken"
>;

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = Boolean(KV_URL && KV_TOKEN);
const KEY_PREFIX = "disdex:deploy-approval:";
const LATEST_KEY = "disdex:deploy-approval:latest";
const FILE_PATH =
  process.env.DISDEX_DEPLOY_APPROVAL_STORE_PATH ||
  path.join(process.cwd(), "data", "deploy-approvals.json");

async function redisClient() {
  const { Redis } = await import("@upstash/redis");
  return new Redis({ url: KV_URL!, token: KV_TOKEN! });
}

function loadFileRecords(): DeploymentApprovalRecord[] {
  try {
    if (!fs.existsSync(FILE_PATH)) return [];
    return JSON.parse(fs.readFileSync(FILE_PATH, "utf8")) as DeploymentApprovalRecord[];
  } catch (error) {
    console.error("[DeployApproval] failed to read approval store", error);
    return [];
  }
}

function saveFileRecords(records: DeploymentApprovalRecord[]) {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${FILE_PATH}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, FILE_PATH);
}


/**
 * Serializes claims of a grant across HP workers. Never recover a stale lock
 * automatically: fail-closed until an operator verifies the old process.
 * The publish workflow also uses this same directory lock.
 */
async function withFileApprovalLock<T>(action: () => Promise<T>): Promise<T> {
  const lock = FILE_PATH + ".approval-lock";
  for (let tries = 0; tries < 50; tries += 1) {
    try {
      await fs.promises.mkdir(lock, { mode: 0o700 });
      try {
        return await action();
      } finally {
        await fs.promises.rmdir(lock);
      }
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  throw new Error("DEPLOY_APPROVAL_STORE_LOCK_UNAVAILABLE");
}

export async function mutateDeploymentApprovalAtomic(
  id: string,
  update: (value: DeploymentApprovalRecord | null) =>
    Promise<{ next?: DeploymentApprovalRecord; result: unknown }>,
): Promise<unknown> {
  // Upstash is a separate store. Do not claim multi-run grants if an atomic
  // transaction is not implemented for that backend.
  if (USE_REDIS) throw new Error("ATOMIC_RETRY_NOT_AVAILABLE_ON_REDIS");
  return withFileApprovalLock(async () => {
    const records = loadFileRecords();
    const existing = records.find((entry) => entry.id === id) ?? null;
    const outcome = await update(existing);
    if (outcome.next) {
      const next = { ...outcome.next, updatedAt: Date.now() };
      const updated = records.filter((entry) => entry.id !== id);
      updated.push(next);
      updated.sort((a, b) => b.createdAt - a.createdAt);
      saveFileRecords(updated.slice(0, 50));
    }
    return outcome.result;
  });
}

export function sanitizeDeploymentApproval(
  record?: DeploymentApprovalRecord | null,
): DeploymentApprovalSummary | null {
  if (!record) return null;
  const { otpHash: _otpHash, approvalToken: _approvalToken, ...summary } = record;
  return summary;
}

export async function getDeploymentApproval(id: string) {
  if (!id) return null;
  if (USE_REDIS) {
    const redis = await redisClient();
    return (await redis.get<DeploymentApprovalRecord>(KEY_PREFIX + id)) || null;
  }
  return loadFileRecords().find((item) => item.id === id) || null;
}

export async function saveDeploymentApproval(record: DeploymentApprovalRecord) {
  const next = { ...record, updatedAt: Date.now() };
  if (USE_REDIS) {
    const redis = await redisClient();
    await redis.set(KEY_PREFIX + next.id, next, { ex: 60 * 60 * 2 });
    await redis.set(LATEST_KEY, next.id, { ex: 60 * 60 * 2 });
    return next;
  }
  const records = loadFileRecords().filter((item) => item.id !== next.id);
  records.push(next);
  records.sort((a, b) => b.createdAt - a.createdAt);
  saveFileRecords(records.slice(0, 50));
  return next;
}

export async function getLatestDeploymentApproval() {
  if (USE_REDIS) {
    const redis = await redisClient();
    const latestId = await redis.get<string>(LATEST_KEY);
    return latestId ? getDeploymentApproval(latestId) : null;
  }
  return loadFileRecords().slice().sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

export async function getLatestDeploymentApprovalSummary() {
  return sanitizeDeploymentApproval(await getLatestDeploymentApproval());
}

export async function createPendingDeploymentApproval(input: {
  targetSha: string;
  planSha256: string;
  scope?: DeploymentApprovalScope;
  operation?: DeploymentApprovalOperation;
  ordersEnabled?: boolean;
  requestActor: string;
  requestCommentId?: string;
}) {
  const now = Date.now();
  const current = await getLatestDeploymentApproval();
  if (
    current &&
    ["PENDING", "OTP_SENT", "APPROVED", "DISPATCHED"].includes(current.status) &&
    current.requestExpiresAt > now &&
    current.targetSha === input.targetSha &&
    current.planSha256 === input.planSha256 &&
    current.scope === (input.scope ?? DEPLOY_APPROVAL_SCOPE) &&
    (current.operation ?? "V12_V4_LIVE") === (input.operation ?? "V12_V4_LIVE") &&
    (current.ordersEnabled ?? true) === (input.ordersEnabled ?? true)
  ) {
    return current;
  }

  if (
    current &&
    ["PENDING", "OTP_SENT", "APPROVED"].includes(current.status) &&
    current.requestExpiresAt <= now
  ) {
    await saveDeploymentApproval({ ...current, status: "EXPIRED", lastError: "request expired" });
  }

  const record: DeploymentApprovalRecord = {
    id: crypto.randomUUID(),
    scope: input.scope ?? DEPLOY_APPROVAL_SCOPE,
    operation: input.operation ?? "V12_V4_LIVE",
    ordersEnabled: input.ordersEnabled ?? true,
    targetSha: input.targetSha,
    planSha256: input.planSha256,
    requestActor: input.requestActor,
    requestCommentId: input.requestCommentId,
    createdAt: now,
    requestExpiresAt: now + 30 * 60 * 1000,
    updatedAt: now,
    status: "PENDING",
  };
  return saveDeploymentApproval(record);
}
