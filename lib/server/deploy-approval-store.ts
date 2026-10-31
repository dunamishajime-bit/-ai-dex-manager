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
  taskApprovedExpiresAt?: number;
  taskMaxClaims?: number;
  taskClaimCount?: number;
  taskActiveClaim?: {
    step: string;
    runId: string;
    claimedAt: number;
  };
  taskClaimHistory?: Array<{
    step: string;
    runId: string;
    claimedAt: number;
    finishedAt?: number;
    outcome?: "success" | "failure";
  }>;
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


/** File mode uses an exclusive directory lock for multi-Action task claims. */
export async function mutateDeploymentApprovalAtomic<T>(
  id: string,
  update: (current: DeploymentApprovalRecord | null) => {
    next?: DeploymentApprovalRecord;
    result: T;
  },
): Promise<T> {
  // A Redis transaction would be needed for atomic claims. Fail closed instead.
  if (USE_REDIS) throw new Error("TASK_CLAIMS_REQUIRE_ATOMIC_STORAGE");
  const lockPath = FILE_PATH + ".task-lock";
  let acquired = false;
  for (let i = 0; i < 50; i += 1) {
    try {
      await fs.promises.mkdir(lockPath, { mode: 0o700 });
      acquired = true;
      break;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!acquired) throw new Error("APPROVAL_STORE_BUSY_FAIL_CLOSED");
  try {
    if (!fs.existsSync(FILE_PATH)) throw new Error("APPROVAL_STORE_MISSING");
    const raw = JSON.parse(fs.readFileSync(FILE_PATH, "utf8")) as unknown;
    if (!Array.isArray(raw)) throw new Error("APPROVAL_STORE_INVALID");
    const records = raw as DeploymentApprovalRecord[];
    const current = records.find((item) => item.id === id) || null;
    const result = update(current);
    if (result.next) {
      const next = { ...result.next, updatedAt: Date.now() };
      const updated = records.filter((record) => record.id !== id);
      updated.push(next);
      updated.sort((a, b) => b.createdAt - a.createdAt);
      saveFileRecords(updated.slice(0, 50));
    }
    return result.result;
  } finally {
    await fs.promises.rmdir(lockPath);
  }
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
