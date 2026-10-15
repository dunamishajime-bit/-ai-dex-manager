export type AccountConfigReadinessRateBudgetDeferral = {
  status: "CONFIG_DEFER_RATE_BUDGET";
  reason: string;
};

const SATURATED = /^ASTER_GLOBAL_RATE_BUDGET_SATURATED:\d+$/;
const LOCK_TIMEOUT = /^ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT$/;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

/**
 * Account configuration is a periodic readiness check. A shared Aster rate
 * budget that is temporarily saturated means "try again later", not that the
 * account configuration is invalid. This helper deliberately accepts only
 * those two pre-request conditions; malformed config, credential failures,
 * HTTP errors, and lock-release failures remain fail-closed.
 */
export function classifyAccountConfigReadinessRateBudgetDeferral(
  error: unknown,
): AccountConfigReadinessRateBudgetDeferral | undefined {
  const reason = messageOf(error).trim();
  if (SATURATED.test(reason) || LOCK_TIMEOUT.test(reason)) {
    return { status: "CONFIG_DEFER_RATE_BUDGET", reason };
  }
  return undefined;
}
