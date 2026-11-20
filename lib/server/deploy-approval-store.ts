import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  DEPLOY_APPROVAL_SCOPE,
  type DeploymentApprovalOperation,
  type DeploymentApprovalScope,
} from "@/lib/deploy-approval-token";
import { redisApprovalCompareAndSwap } from "@/lib/server/deploy-approval-redis-cas";
import {
  type GoalApproval, assertSameOwnerGoal, isReusableOwnerGoal,
} from "@/lib/owner-goal-approval";

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
  /** Opaque compare-and-swap version for file-backed updates. */
  storeRevision?: string;
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
  completedAt?: number;
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
  /** One Owner OTP for this stable goal, not for any particular code SHA. */
  goal?: GoalApproval;
  goalClaimCount?: number;
  goalActiveClaim?: {
    runId: string;
    candidateSha: string;
    planSha256: string;
    ciRunId: string;
    ordersEnabled: boolean;
    claimedAt: number;
  };
  goalClaimHistory?: Array<{
    runId: string;
    candidateSha: string;
    planSha256: string;
    ciRunId: string;
    ordersEnabled: boolean;
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
const HISTORY_KEY = "disdex:deploy-approval:history";
const GOAL_INDEX_PREFIX = "disdex:deploy-goal:";
const HISTORY_LIMIT = 50;
const MONITOR_ONLY_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MONITOR_ONLY_RETENTION_LIMIT = 100;
const FILE_PATH =
  process.env.DISDEX_DEPLOY_APPROVAL_STORE_PATH ||
  path.join(process.cwd(), "data", "deploy-approvals.json");

async function redisClient() {
  const { Redis } = await import("@upstash/redis");
  return new Redis({ url: KV_URL!, token: KV_TOKEN! });
}

function loadFileRecords(): DeploymentApprovalRecord[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(FILE_PATH, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("APPROVAL_STORE_INVALID");
    return parsed as DeploymentApprovalRecord[];
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw new Error("APPROVAL_STORE_INVALID_OR_UNREADABLE", { cause: error });
  }
}

function saveFileRecords(records: DeploymentApprovalRecord[]) {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const sorted = records.slice().sort((a, b) => b.createdAt - a.createdAt);
  // The UI history remains bounded, but an exact orders-disabled monitor
  // approval must survive that display bound until its retry window ends.
  // Otherwise a later bounded GitHub Actions retry would incorrectly return
  // APPROVAL_NOT_FOUND and force the Owner through OTP again.
  const retryableMonitor = sorted
    .filter((record) =>
      record.operation === "ALL_RUNNERS_MONITOR_REFRESH" &&
      record.ordersEnabled === false &&
      Number.isFinite(record.approvedAt) &&
      Number(record.approvedAt) + MONITOR_ONLY_RETRY_WINDOW_MS > Date.now(),
    )
    .slice(0, MONITOR_ONLY_RETENTION_LIMIT);
  const retained = new Map<string, DeploymentApprovalRecord>();
  for (const record of sorted.slice(0, HISTORY_LIMIT)) retained.set(record.id, record);
  for (const record of retryableMonitor) retained.set(record.id, record);
  // Goal approvals remain durable until the requested objective completes or
  // the Owner revokes it. The signed child tokens remain 300-second one-use.
  const activeGoals = sorted.filter((record) =>
    record.goal &&
    ["APPROVED", "DISPATCHED", "REDEEMED"].includes(record.status));
  for (const record of activeGoals) retained.set(record.id, record);
  const persisted = Array.from(retained.values()).sort((a, b) => b.createdAt - a.createdAt);
  const tmp = `${FILE_PATH}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(tmp, JSON.stringify(persisted, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    fs.renameSync(tmp, FILE_PATH);
  } finally {
    try { fs.unlinkSync(tmp); } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
  }
}

async function withFileLock<T>(fn: () => T): Promise<T> {
  await fs.promises.mkdir(path.dirname(FILE_PATH), { recursive: true, mode: 0o700 });
  const lockPath = FILE_PATH + ".task-lock";
  let acquired = false;
  for (let i = 0; i < 200; i += 1) {
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
    return fn();
  } finally {
    await fs.promises.rmdir(lockPath);
  }
}

/** File mode uses an exclusive directory lock for multi-Action task claims. */
export async function mutateDeploymentApprovalAtomic<T>(
  id: string,
  update: (current: DeploymentApprovalRecord | null) => {
    next?: DeploymentApprovalRecord;
    result: T;
  },
): Promise<T> {
  if (USE_REDIS) {
    const redis = await redisClient();
    const recordKey = KEY_PREFIX + id;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = (await redis.get<DeploymentApprovalRecord>(recordKey)) || null;
      const result = update(current);
      if (!result.next) return result.result;
      const next = {
        ...result.next,
        updatedAt: Date.now(),
        storeRevision: crypto.randomUUID(),
      };
      const cas = await redisApprovalCompareAndSwap(redis, {
        recordKey,
        latestKey: LATEST_KEY,
        historyKey: HISTORY_KEY,
        current,
        next,
        touchLatest: false,
        persistentRecord: Boolean(next.goal && !["COMPLETED", "EXPIRED", "FAILED"].includes(next.status)),
        ...(next.goal ? {
          goalIndexKey: GOAL_INDEX_PREFIX + next.goal.fingerprint,
          goalActive: !["COMPLETED", "EXPIRED", "FAILED"].includes(next.status),
        } : {}),
      });
      if (cas === "SWAPPED") return result.result;
      if (cas === "INVALID_STORED_VALUE") {
        throw new Error("APPROVAL_STORE_INVALID_OR_UNREADABLE");
      }
    }
    throw new Error("APPROVAL_STORE_BUSY_FAIL_CLOSED");
  }
  return withFileLock(() => {
    if (!fs.existsSync(FILE_PATH)) throw new Error("APPROVAL_STORE_MISSING");
    const raw = JSON.parse(fs.readFileSync(FILE_PATH, "utf8")) as unknown;
    if (!Array.isArray(raw)) throw new Error("APPROVAL_STORE_INVALID");
    const records = raw as DeploymentApprovalRecord[];
    const current = records.find((item) => item.id === id) || null;
    const result = update(current);
    if (result.next) {
      const next = { ...result.next, updatedAt: Date.now(), storeRevision: crypto.randomUUID() };
      const updated = records.filter((record) => record.id !== id);
      updated.push(next);
      updated.sort((a, b) => b.createdAt - a.createdAt);
      saveFileRecords(updated);
    }
    return result.result;
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

async function getDeploymentApprovalHistory(): Promise<DeploymentApprovalRecord[]> {
  if (!USE_REDIS) {
    return loadFileRecords()
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, HISTORY_LIMIT);
  }

  const redis = await redisClient();
  const rawHistory = await redis.get<unknown>(HISTORY_KEY);
  const ids = Array.isArray(rawHistory)
    ? rawHistory.filter((value): value is string => typeof value === "string").slice(0, HISTORY_LIMIT)
    : [];
  const records: DeploymentApprovalRecord[] = [];
  for (const id of ids) {
    const record = await redis.get<DeploymentApprovalRecord>(KEY_PREFIX + id);
    if (record) records.push(record);
  }

  // Older Redis stores predate the history index. Keep the existing latest
  // record visible until the next write seeds the index.
  if (records.length === 0) {
    const latestId = await redis.get<string>(LATEST_KEY);
    if (latestId) {
      const latest = await redis.get<DeploymentApprovalRecord>(KEY_PREFIX + latestId);
      if (latest) records.push(latest);
    }
  }
  return records.sort((a, b) => b.createdAt - a.createdAt).slice(0, HISTORY_LIMIT);
}

function classifyDeploymentApprovalForInbox(
  record: DeploymentApprovalRecord,
  now: number,
): DeploymentApprovalSummary {
  const summary = sanitizeDeploymentApproval(record)!;
  if (
    ["PENDING", "OTP_SENT"].includes(summary.status) &&
    summary.requestExpiresAt <= now
  ) {
    return {
      ...summary,
      status: "EXPIRED",
      lastError: summary.lastError || "request expired",
    };
  }
  return summary;
}

export async function getDeploymentApprovalInbox(now = Date.now()): Promise<{
  pending: DeploymentApprovalSummary[];
  history: DeploymentApprovalSummary[];
}> {
  const pending: DeploymentApprovalSummary[] = [];
  const history: DeploymentApprovalSummary[] = [];
  for (const record of await getDeploymentApprovalHistory()) {
    const summary = classifyDeploymentApprovalForInbox(record, now);
    if (summary.status === "PENDING" || summary.status === "OTP_SENT") {
      pending.push(summary);
    } else {
      history.push(summary);
    }
  }
  return { pending, history };
}

export async function saveDeploymentApproval(record: DeploymentApprovalRecord) {
  const next = { ...record, updatedAt: Date.now() };
  if (USE_REDIS) {
    const redis = await redisClient();
    const recordKey = KEY_PREFIX + next.id;
    const current = (await redis.get<DeploymentApprovalRecord>(recordKey)) || null;
    if (current && current.storeRevision !== next.storeRevision) {
      throw new Error("APPROVAL_STORE_STALE_WRITE_FAIL_CLOSED");
    }
    if (!current && next.storeRevision) {
      throw new Error("APPROVAL_STORE_STALE_WRITE_FAIL_CLOSED");
    }
    const persisted = { ...next, storeRevision: crypto.randomUUID() };
    const cas = await redisApprovalCompareAndSwap(redis, {
      recordKey,
      latestKey: LATEST_KEY,
      historyKey: HISTORY_KEY,
      current,
      next: persisted,
      touchLatest: true,
      persistentRecord: Boolean(persisted.goal && !["COMPLETED", "EXPIRED", "FAILED"].includes(persisted.status)),
      ...(persisted.goal ? {
        goalIndexKey: GOAL_INDEX_PREFIX + persisted.goal.fingerprint,
        goalActive: !["COMPLETED", "EXPIRED", "FAILED"].includes(persisted.status),
      } : {}),
    });
    if (cas === "INVALID_STORED_VALUE") {
      throw new Error("APPROVAL_STORE_INVALID_OR_UNREADABLE");
    }
    if (cas !== "SWAPPED") {
      throw new Error("APPROVAL_STORE_STALE_WRITE_FAIL_CLOSED");
    }
    return persisted;
  }
  return withFileLock(() => {
    const existing = loadFileRecords();
    const current = existing.find((item) => item.id === next.id);
    if (current && current.storeRevision !== next.storeRevision) {
      throw new Error("APPROVAL_STORE_STALE_WRITE_FAIL_CLOSED");
    }
    if (!current && next.storeRevision) throw new Error("APPROVAL_STORE_STALE_WRITE_FAIL_CLOSED");
    const persisted = { ...next, storeRevision: crypto.randomUUID() };
    const records = existing.filter((item) => item.id !== next.id);
    records.push(persisted);
    records.sort((a, b) => b.createdAt - a.createdAt);
    saveFileRecords(records);
    return persisted;
  });
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
    current?.operation === "ALL_RUNNERS_LIVE_RESTORE" &&
    input.operation === "ALL_RUNNERS_LIVE_RESTORE" &&
    current.scope === "FULL_PROJECT" &&
    current.ordersEnabled === false &&
    input.ordersEnabled === false &&
    current.targetSha === input.targetSha &&
    current.planSha256 === input.planSha256 &&
    ["APPROVED", "DISPATCHED"].includes(current.status) &&
    (current.taskApprovedExpiresAt ?? 0) > now
  ) {
    return current;
  }

  const sameIdentity = Boolean(
    current &&
    current.targetSha === input.targetSha &&
    current.planSha256 === input.planSha256 &&
    current.scope === (input.scope ?? DEPLOY_APPROVAL_SCOPE) &&
    (current.operation ?? "V12_V4_LIVE") === (input.operation ?? "V12_V4_LIVE") &&
    (current.ordersEnabled ?? true) === (input.ordersEnabled ?? true)
  );

  // Owner approval is durable for the exact immutable deployment identity.
  // requestExpiresAt only limits the pre-approval request/OTP stage.
  if (current && sameIdentity && ["APPROVED", "DISPATCHED"].includes(current.status)) {
    return current;
  }

  // A failed orders-disabled monitor cutover may redeem an approval before a
  // later preflight fails. Republishing the *same* immutable identity must
  // reuse that approval ID instead of sending the Owner another OTP.
  // Redeem has an identical 24-hour, monitor-only cross-run retry allowance.
  // Never extend this to LIVE/order-enabled approvals or a changed SHA/plan.
  if (
    current &&
    sameIdentity &&
    current.status === "REDEEMED" &&
    current.operation === "ALL_RUNNERS_MONITOR_REFRESH" &&
    current.ordersEnabled === false &&
    Number.isFinite(current.approvedAt) &&
    now < Number(current.approvedAt) + 24 * 60 * 60 * 1000
  ) {
    return current;
  }

  if (
    current &&
    sameIdentity &&
    ["PENDING", "OTP_SENT"].includes(current.status) &&
    current.requestExpiresAt > now
  ) {
    return current;
  }

  if (
    current &&
    ["PENDING", "OTP_SENT"].includes(current.status) &&
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


/** Publish one immutable Owner objective; subsequent candidate SHA/plan
 * revisions are claimed against this approved record, not via a new OTP. */
export async function createPendingOwnerGoal(input: {
  goal: GoalApproval;
  actor: string;
  existingGoalId?: string;
}) {
  assertSameOwnerGoal(input.goal);
  if (!/^[A-Za-z0-9-]{1,39}$/.test(input.actor)) {
    throw new Error("GOAL_ACTOR_INVALID");
  }
  if (input.existingGoalId) {
    const record = await getDeploymentApproval(input.existingGoalId);
    if (!record?.goal || record.requestActor !== input.actor ||
        record.goal.fingerprint !== input.goal.fingerprint) {
      throw new Error("GOAL_IDENTITY_MISMATCH");
    }
    if (isReusableOwnerGoal({
      status: record.status, approvedAt: record.approvedAt,
      goal: record.goal, requested: input.goal,
    })) return record;
    if (["PENDING", "OTP_SENT"].includes(record.status) &&
        record.requestExpiresAt > Date.now()) return record;
    throw new Error("GOAL_NOT_REUSABLE");
  }
  const reusable = (row: DeploymentApprovalRecord) =>
    row.requestActor === input.actor &&
    row.goal?.fingerprint === input.goal.fingerprint &&
    (isReusableOwnerGoal({
      status: row.status, approvedAt: row.approvedAt,
      goal: row.goal, requested: input.goal,
    }) ||
    (["PENDING", "OTP_SENT"].includes(row.status) &&
      row.requestExpiresAt > Date.now()));

  const buildRecord = (): DeploymentApprovalRecord => {
    const now = Date.now();
    return {
      id: crypto.randomUUID(),
      goal: input.goal,
      scope: input.goal.scope,
      operation: input.goal.operation,
      ordersEnabled: input.goal.ordersEnabled,
      targetSha: "0".repeat(40), // goal charter, not executable source
      planSha256: input.goal.fingerprint,
      requestActor: input.actor,
      createdAt: now,
      requestExpiresAt: now + 30 * 60 * 1000,
      updatedAt: now,
      status: "PENDING",
      goalClaimCount: 0,
      goalClaimHistory: [],
    };
  };

  if (!USE_REDIS) {
    // Resolve and write under *one* lock. Concurrent requests for the same
    // purpose must result in one Owner OTP, even on the file-backed HP.
    return withFileLock(() => {
      const records = loadFileRecords();
      const active = records.find(reusable);
      if (active) return active;
      const next = { ...buildRecord(), storeRevision: crypto.randomUUID() };
      saveFileRecords([...records, next]);
      return next;
    });
  }

  // Durable Redis goal index is independent of the last-50 UI history.
  // The Redis CAS also refuses another ID for an active same-goal index.
  const redis = await redisClient();
  const index = GOAL_INDEX_PREFIX + input.goal.fingerprint;
  const id = await redis.get<string>(index);
  if (id) {
    const row = await getDeploymentApproval(id);
    if (row && reusable(row)) return row;
  }
  const active = (await getDeploymentApprovalHistory()).find(reusable);
  if (active) return active;

  try {
    return await saveDeploymentApproval(buildRecord());
  } catch (error) {
    // A competing request may have just created this exact goal. In that
    // case reuse its ID, not a second OTP; all other conflicts fail closed.
    const concurrentId = await redis.get<string>(index);
    const concurrent = concurrentId ? await getDeploymentApproval(concurrentId) : null;
    if (concurrent && reusable(concurrent)) return concurrent;
    throw error;
  }
}
