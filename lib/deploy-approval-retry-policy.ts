import type { DeploymentApprovalOperation } from "./deploy-approval-token";

/**
 * Only an already OTP-approved, non-order IDLE state repair gets retries.
 * Each Action run receives a fresh 300-second Ed25519 token with a new nonce.
 * This is never authorization to resume LIVE, disable a Kill Switch, change
 * STOPs, or perform a different operation.
 */
export const IDLE_REPAIR_RETRY_POLICY = {
  policy: "IDLE_NONORDER_RETRY_V1" as const,
  windowMs: 2 * 60 * 60 * 1000,
  maxAttempts: 5,
};

export function isRetryEligibleOperation(operation: DeploymentApprovalOperation, ordersEnabled: boolean) {
  return operation === "IDLE_FLAT_STALE_REPAIR" && ordersEnabled === false;
}

export function validatedRetryGrant(input: {
  policy?: string;
  operation: DeploymentApprovalOperation;
  ordersEnabled: boolean;
  approvedAt?: number;
  grantExpiresAt?: number;
  maxAttempts?: number;
  attemptCount?: number;
}, now: number) {
  const p = IDLE_REPAIR_RETRY_POLICY;
  return (
    isRetryEligibleOperation(input.operation, input.ordersEnabled) &&
    input.policy === p.policy &&
    Number.isSafeInteger(input.approvedAt) &&
    (input.approvedAt ?? 0) > 0 &&
    Number.isSafeInteger(input.grantExpiresAt) &&
    (input.grantExpiresAt ?? 0) <= (input.approvedAt ?? 0) + p.windowMs &&
    (input.grantExpiresAt ?? 0) > now &&
    input.maxAttempts === p.maxAttempts &&
    Number.isSafeInteger(input.attemptCount) &&
    (input.attemptCount ?? -1) >= 0 &&
    (input.attemptCount ?? p.maxAttempts + 1) <= p.maxAttempts
  );
}

export function mayClaimRetry(input: Parameters<typeof validatedRetryGrant>[0] & {
  status: string;
}, now: number) {
  return (
    validatedRetryGrant(input, now) &&
    (input.status === "APPROVED" || input.status === "RETRYABLE") &&
    (input.attemptCount ?? 5) < IDLE_REPAIR_RETRY_POLICY.maxAttempts
  );
}

export function eligibleRetryExpiry(approvedAt: number) {
  return approvedAt + IDLE_REPAIR_RETRY_POLICY.windowMs;
}
