import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

export const ASTER_GLOBAL_RATE_BUDGET_SCHEMA = "disdex-aster-rate-budget/v1";

export type AsterGlobalRateSlotOptions = {
  path: string;
  minIntervalMs: number;
  maxQueueMs: number;
  weight?: number;
  nowMs?: number;
};

type BudgetState = {
  schema: typeof ASTER_GLOBAL_RATE_BUDGET_SCHEMA;
  nextAllowedAt: number;
  updatedAt: number;
  pid: number;
  cooldownUntil?: number;
  lastRateLimitStatus?: number;
};

const sleep = (ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));
const errorCode = (error: unknown) => error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
const LOCK_OWNER_SCHEMA = "disdex-aster-rate-budget-lock/v1";
const LOCK_RECOVERY_GRACE_MS = 5_000;

type BudgetLockOwner = {
  schema: typeof LOCK_OWNER_SCHEMA;
  pid: number;
  createdAt: number;
  token: string;
};

function validLockOwner(value: unknown): value is BudgetLockOwner {
  if (!value || typeof value !== "object") return false;
  const owner = value as Partial<BudgetLockOwner>;
  const pid = owner.pid;
  const createdAt = owner.createdAt;
  return owner.schema === LOCK_OWNER_SCHEMA
    && typeof pid === "number" && Number.isInteger(pid) && pid > 0
    && typeof createdAt === "number" && Number.isFinite(createdAt) && createdAt > 0
    && typeof owner.token === "string" && owner.token.length > 0;
}

async function readLockOwner(lockPath: string): Promise<BudgetLockOwner | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as unknown;
    return validLockOwner(parsed) ? parsed : undefined;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    return undefined;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

async function lockIsStale(lockPath: string): Promise<boolean> {
  const owner = await readLockOwner(lockPath);
  if (owner) return !processAlive(owner.pid);
  try {
    const metadata = await stat(lockPath);
    return Date.now() - metadata.mtimeMs > LOCK_RECOVERY_GRACE_MS;
  } catch (error) {
    return errorCode(error) === "ENOENT";
  }
}

async function writeLockOwner(lockPath: string, owner: BudgetLockOwner) {
  await writeFile(join(lockPath, "owner.json"), `${JSON.stringify(owner)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function readBudget(path: string): Promise<Partial<BudgetState>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Partial<BudgetState>;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return {};
    throw error;
  }
}
async function atomicWriteBudget(path: string, state: BudgetState) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o660 });
    await rename(temporary, path);
    await chmod(path, 0o660);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function acquireBudgetLock(lockPath: string, maxQueueMs: number): Promise<BudgetLockOwner> {
  const deadline = Date.now() + maxQueueMs;
  const owner: BudgetLockOwner = {
    schema: LOCK_OWNER_SCHEMA,
    pid: process.pid,
    createdAt: Date.now(),
    token: randomUUID(),
  };
  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        await writeLockOwner(lockPath, owner);
        return owner;
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (await lockIsStale(lockPath)) {
        await rm(lockPath, { recursive: true, force: true }).catch((removeError) => {
          if (errorCode(removeError) !== "ENOENT") throw removeError;
        });
        continue;
      }
      if (Date.now() >= deadline) throw new Error("ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT");
      await sleep(5);
    }
  }
}

async function releaseBudgetLock(lockPath: string, owner: BudgetLockOwner) {
  const current = await readLockOwner(lockPath);
  if (!current || current.token !== owner.token) return;
  await rm(lockPath, { recursive: true, force: true }).catch((error) => {
    if (errorCode(error) !== "ENOENT") throw error;
  });
}

export async function reserveAsterGlobalRateSlot(options: AsterGlobalRateSlotOptions) {
  const path = resolve(options.path);
  const lockPath = `${path}.lock`;
  if (!Number.isFinite(options.minIntervalMs) || !Number.isFinite(options.maxQueueMs)
      || (options.weight !== undefined && !Number.isFinite(options.weight))
      || (options.nowMs !== undefined && !Number.isFinite(options.nowMs))) {
    throw new Error("ASTER_GLOBAL_RATE_BUDGET_CONFIG_INVALID");
  }
  const minIntervalMs = Math.max(1, Math.min(1_000, Math.floor(options.minIntervalMs)));
  const maxQueueMs = Math.max(minIntervalMs, Math.min(30_000, Math.floor(options.maxQueueMs)));
  const weight = Math.max(1, Math.min(100, Math.floor(options.weight ?? 1)));
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const owner = await acquireBudgetLock(lockPath, maxQueueMs);
  try {
    const current = await readBudget(path);
    if (Object.keys(current).length > 0 && current.schema !== ASTER_GLOBAL_RATE_BUDGET_SCHEMA) {
      throw new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED");
    }
    const now = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const nextAllowedAt = Number(current.nextAllowedAt || 0);
    if (!Number.isFinite(nextAllowedAt) || nextAllowedAt < 0) throw new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED");
    const permitAt = Math.max(now, nextAllowedAt);
    const waitMs = permitAt - now;
    if (waitMs > maxQueueMs) throw new Error(`ASTER_GLOBAL_RATE_BUDGET_SATURATED:${waitMs}`);
    const state: BudgetState = {
      schema: ASTER_GLOBAL_RATE_BUDGET_SCHEMA,
      nextAllowedAt: permitAt + (minIntervalMs * weight),
      updatedAt: now,
      pid: process.pid,
    };
    await atomicWriteBudget(path, state);
    return { permitAt, waitMs, nextAllowedAt: state.nextAllowedAt };
  } finally {
    await releaseBudgetLock(lockPath, owner);
  }
}

export async function deferAsterGlobalRateBudget(options: { path: string; cooldownMs: number; status: 418 | 429; nowMs?: number }) {
  if (!Number.isFinite(options.cooldownMs) || options.cooldownMs < 0 || (options.nowMs !== undefined && !Number.isFinite(options.nowMs))) throw new Error("ASTER_GLOBAL_RATE_BUDGET_CONFIG_INVALID");
  const path = resolve(options.path); const lockPath = `${path}.lock`; const now = options.nowMs ?? Date.now();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const owner = await acquireBudgetLock(lockPath, 2_000);
  try {
    const current = await readBudget(path);
    if (Object.keys(current).length > 0 && current.schema !== ASTER_GLOBAL_RATE_BUDGET_SCHEMA) throw new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED");
    const existing = Number(current.nextAllowedAt || 0);
    if (!Number.isFinite(existing) || existing < 0) throw new Error("ASTER_GLOBAL_RATE_BUDGET_MALFORMED");
    const cooldownUntil = Math.max(existing, now + Math.floor(options.cooldownMs));
    await atomicWriteBudget(path, { schema: ASTER_GLOBAL_RATE_BUDGET_SCHEMA, nextAllowedAt: cooldownUntil, updatedAt: now, pid: process.pid, cooldownUntil, lastRateLimitStatus: options.status });
    return { cooldownUntil };
  } finally { await releaseBudgetLock(lockPath, owner); }
}

export async function waitForAsterGlobalRateSlot(weight = 1) {
  const path = String(process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH || "").trim();
  if (!path) return;
  const minIntervalMs = Number(process.env.DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS || 50);
  const maxQueueMs = Number(process.env.DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS || 5_000);
  const slot = await reserveAsterGlobalRateSlot({ path, minIntervalMs, maxQueueMs, weight });
  if (slot.waitMs > 0) await sleep(slot.waitMs);
}
