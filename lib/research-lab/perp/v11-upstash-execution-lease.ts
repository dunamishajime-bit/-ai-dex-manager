import { Redis } from "@upstash/redis";

import type { V11ExecutionLease, V11LeaseGrant } from "./v11-execution-safety";

type RedisEval = Pick<Redis, "eval">;

export interface UpstashV11ExecutionLeaseOptions {
  prefix?: string;
  claimSafetyMs?: number;
  committedTtlMs?: number;
}

const TRY_ACQUIRE_SCRIPT = `
-- V11_TRY_ACQUIRE
local committed = redis.call("GET", KEYS[3])
if committed then
  local sep = string.find(committed, "|", 1, true)
  local fence = sep and tonumber(string.sub(committed, 1, sep - 1)) or 0
  return {0, fence, "COMMITTED"}
end

local active = redis.call("GET", KEYS[1])
if active then
  local sep = string.find(active, "|", 1, true)
  local fence = sep and tonumber(string.sub(active, 1, sep - 1)) or 0
  local owner = sep and string.sub(active, sep + 1) or "UNKNOWN"
  return {0, fence, owner}
end

local fence = redis.call("INCR", KEYS[2])
local value = tostring(fence) .. "|" .. ARGV[1]
redis.call("SET", KEYS[1], value, "PX", ARGV[2])
redis.call("PEXPIRE", KEYS[2], ARGV[3])
return {1, fence, ARGV[1]}
`;

const MARK_COMMITTED_SCRIPT = `
-- V11_MARK_COMMITTED
local active = redis.call("GET", KEYS[1])
local expected = ARGV[1] .. "|" .. ARGV[2]
if active ~= expected then
  return 0
end
redis.call("SET", KEYS[3], expected, "PX", ARGV[3])
redis.call("PEXPIRE", KEYS[2], ARGV[3])
redis.call("DEL", KEYS[1])
return 1
`;

function normalizePart(value: string, label: string, maxLength: number) {
  const normalized = value.trim().replace(/[^.A-Z:/a-z0-9_-]/g, "-").slice(0, maxLength);
  if (!normalized) throw new Error(`${label} is empty after sanitization.`);
  return normalized;
}

function numericReply(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * An at-most-once claim spans the decision's entire remaining freshness window.
 * A standby can own an unclaimed fresh tick, but it must not take over after a
 * peer has claimed it: Aster only documents client-order-id uniqueness among
 * open orders, so a filled MARKET id is not treated as a permanent idempotency
 * key. A claimed-owner crash intentionally skips that entry instead of risking
 * a duplicate fill. A committed marker records the completed decision.
 */
export class UpstashV11ExecutionLease implements V11ExecutionLease {
  private readonly prefix: string;
  private readonly claimSafetyMs: number;
  private readonly committedTtlMs: number;

  constructor(
    private readonly redis: RedisEval,
    options: UpstashV11ExecutionLeaseOptions = {},
  ) {
    this.prefix = normalizePart(options.prefix || "disdex:v11:entry", "prefix", 64);
    this.claimSafetyMs = Math.max(60_000, Math.floor(options.claimSafetyMs ?? 5 * 60_000));
    this.committedTtlMs = Math.max(60 * 60 * 1000, Math.floor(options.committedTtlMs ?? 2 * 60 * 60 * 1000));
  }

  static fromEnv(options?: UpstashV11ExecutionLeaseOptions) {
    return new UpstashV11ExecutionLease(Redis.fromEnv(), options);
  }

  private keysFor(key: string) {
    const decision = normalizePart(key, "lease key", 96);
    // The hash tag keeps all keys in one Redis cluster slot for the Lua script.
    const tag = `{${decision}}`;
    return [
      `${this.prefix}:${tag}:lease`,
      `${this.prefix}:${tag}:fence`,
      `${this.prefix}:${tag}:committed`,
    ];
  }

  async tryAcquire(input: { key: string; owner: string; now: number; expiresAt: number }): Promise<V11LeaseGrant> {
    const owner = normalizePart(input.owner, "lease owner", 48);
    if (!Number.isFinite(input.now) || !Number.isFinite(input.expiresAt)) {
      throw new Error("V11 lease timestamps must be finite.");
    }
    const remainingMs = Math.floor(input.expiresAt - input.now);
    if (remainingMs <= 0) return { acquired: false, fence: 0, owner: "EXPIRED" };

    // Keep the claim beyond the absolute entry deadline. No live peer may
    // recover a claimed decision; only an unclaimed decision is eligible.
    const ttlMs = remainingMs + this.claimSafetyMs;
    const stateTtlMs = Math.max(ttlMs, this.committedTtlMs);
    const result = await this.redis.eval<string[], [number | string, number | string, string]>(
      TRY_ACQUIRE_SCRIPT,
      this.keysFor(input.key),
      [owner, String(ttlMs), String(stateTtlMs)],
    );
    if (!Array.isArray(result) || result.length < 3) throw new Error("Unexpected V11 lease acquire response.");
    return {
      acquired: numericReply(result[0]) === 1,
      fence: numericReply(result[1]),
      owner: String(result[2] || "UNKNOWN"),
    };
  }

  async markCommitted(input: { key: string; owner: string; fence: number }): Promise<void> {
    const owner = normalizePart(input.owner, "lease owner", 48);
    if (!Number.isInteger(input.fence) || input.fence <= 0) throw new Error("V11 lease fence must be a positive integer.");
    const result = await this.redis.eval<string[], number>(
      MARK_COMMITTED_SCRIPT,
      this.keysFor(input.key),
      [String(input.fence), owner, String(this.committedTtlMs)],
    );
    if (numericReply(result) !== 1) throw new Error("V11 lease fence was lost before commit.");
  }
}

export const V11_UPSTASH_LEASE_SCRIPTS = {
  tryAcquire: TRY_ACQUIRE_SCRIPT,
  markCommitted: MARK_COMMITTED_SCRIPT,
} as const;
