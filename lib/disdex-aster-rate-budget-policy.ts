export type AsterRatePriority = "PROTECTIVE" | "RECONCILIATION" | "RISK_READ" | "MARKET_DATA" | "NEW_EXPOSURE";

export type AsterRateBudgetDeferred = {
  kind: "RATE_BUDGET_DEFERRED";
  reason: string;
  waitMs?: number;
};

const SATURATED = /^ASTER_GLOBAL_RATE_BUDGET_SATURATED:(\d+)$/;
const LOCK_FAILURES = new Set([
  "ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT",
  "ASTER_GLOBAL_RATE_BUDGET_LOCK_RELEASE_FAILED",
  "ASTER_GLOBAL_RATE_BUDGET_RECOVERY_LOCK_RELEASE_FAILED",
]);

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

export function classifyAsterRateBudgetFailure(error: unknown): AsterRateBudgetDeferred | undefined {
  const reason = messageOf(error).trim();
  const saturated = SATURATED.exec(reason);
  if (saturated) return { kind: "RATE_BUDGET_DEFERRED", reason, waitMs: Number(saturated[1]) };
  if (LOCK_FAILURES.has(reason)) return { kind: "RATE_BUDGET_DEFERRED", reason };
  return undefined;
}

export function nextAsterRateBudgetRetryMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  waitMs = 0,
  random = Math.random,
): number {
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error("ASTER_GLOBAL_RATE_BUDGET_RETRY_CONFIG_INVALID");
  if (!Number.isFinite(baseMs) || baseMs < 0 || !Number.isFinite(maxMs) || maxMs < 0) throw new Error("ASTER_GLOBAL_RATE_BUDGET_RETRY_CONFIG_INVALID");
  const exponential = Math.min(maxMs, baseMs * (2 ** attempt));
  const jitter = Math.min(maxMs, exponential * (0.5 + Math.min(1, Math.max(0, random())) * 0.5));
  return Math.min(maxMs, Math.max(0, waitMs, Math.ceil(jitter)));
}
