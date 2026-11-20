import crypto from "node:crypto";
import {
  canonicalJson,
  DEPLOY_APPROVAL_OPERATION_POLICY,
  type DeploymentApprovalOperation,
  type DeploymentApprovalScope,
} from "@/lib/deploy-approval-token";

/**
 * One Owner OTP authorizes one stable, named objective and an immutable maximum
 * authority envelope. Each individual candidate still needs new exact-SHA
 * CI evidence, a short-lived Ed25519 token and normal production safety gates.
 */
export const GOAL_APPROVAL_SCHEMA = "disdex-owner-purpose-campaign/v1" as const;
export const GOAL_RELEASE_PLAN_SCHEMA = "disdex-owner-purpose-release/v1" as const;
export const GOAL_CI_WORKFLOW = ".github/workflows/disdex-owner-goal-candidate-ci.yml";
export const GOAL_CI_WORKFLOW_NAME = "DisDex Owner Goal Candidate CI";

export type GoalKind = "RESTORE_RUNNER_LIVE" | "SWITCH_STRATEGY_LOGIC";
export type GoalApproval = {
  schema: typeof GOAL_APPROVAL_SCHEMA;
  kind: GoalKind;
  operation: DeploymentApprovalOperation;
  scope: DeploymentApprovalScope;
  subject: string;
  strategyId?: string;
  ordersEnabled: boolean;
  target: "professional-dismanager.net";
  safeguardProfile: "FAIL_CLOSED_SIGNED_ROOT_V1";
  fingerprint: string;
};

const RESTORE_OPERATIONS = new Set<DeploymentApprovalOperation>([
  "ALL_RUNNERS_LIVE_RESTORE", "ALL_RUNNERS_ORDER_ENABLE",
  "V12_V4_LIVE", "PENGU_V8_LIVE",
  "V12_V4_SCOPED_ORDER_ENABLE", "PENGU_V8_SCOPED_ORDER_ENABLE",
  "QUALITY102_CAUSAL_V1_SCOPED_ORDER_ENABLE",
  "V52_SCOPED_ORDER_ENABLE", "FET_BRK48_RESIDUAL_SCOPED_ORDER_ENABLE",
  "IDLE_PRIORITY_SHORT_SCOPED_ORDER_ENABLE",
  "STABLE4_RUNNERS_SCOPED_ORDER_ENABLE_BUNDLE",
]);
const SWITCH_OPERATIONS = new Set<DeploymentApprovalOperation>([
  "V12_V4_LIVE", "PENGU_V8_LIVE", "V12_V4_SCOPED_ORDER_ENABLE",
  "PENGU_V8_SCOPED_ORDER_ENABLE", "QUALITY102_CAUSAL_V1_SCOPED_ORDER_ENABLE",
  "V52_SCOPED_ORDER_ENABLE", "FET_BRK48_RESIDUAL_SCOPED_ORDER_ENABLE",
  "IDLE_PRIORITY_SHORT_SCOPED_ORDER_ENABLE",
  "STABLE4_RUNNERS_SCOPED_ORDER_ENABLE_BUNDLE",
]);
const SHA_RE = /^[0-9a-f]{40}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const SUBJECT_RE = /^[A-Z0-9_]{2,64}$/;
const STRATEGY_RE = /^[A-Za-z0-9_.-]{2,80}$/;

export function makeOwnerGoal(input: {
  kind: string;
  operation: string;
  subject: string;
  strategyId?: string;
}): GoalApproval {
  if (input.kind !== "RESTORE_RUNNER_LIVE" && input.kind !== "SWITCH_STRATEGY_LOGIC") {
    throw new Error("GOAL_KIND_UNSUPPORTED");
  }
  if (!Object.prototype.hasOwnProperty.call(DEPLOY_APPROVAL_OPERATION_POLICY, input.operation)) {
    throw new Error("GOAL_OPERATION_UNSUPPORTED");
  }
  const kind = input.kind as GoalKind;
  const operation = input.operation as DeploymentApprovalOperation;
  const policy = DEPLOY_APPROVAL_OPERATION_POLICY[operation];
  const allowed = kind === "RESTORE_RUNNER_LIVE" ? RESTORE_OPERATIONS : SWITCH_OPERATIONS;
  if (!allowed.has(operation)) throw new Error("GOAL_OPERATION_OUT_OF_SCOPE");
  if (!SUBJECT_RE.test(input.subject)) throw new Error("GOAL_SUBJECT_INVALID");
  if (input.subject !== policy.scope) throw new Error("GOAL_SCOPE_MISMATCH");
  const strategyId = String(input.strategyId || "").trim();
  if (kind === "SWITCH_STRATEGY_LOGIC" && !STRATEGY_RE.test(strategyId)) {
    throw new Error("GOAL_STRATEGY_REQUIRED");
  }
  if (kind !== "SWITCH_STRATEGY_LOGIC" && strategyId) {
    throw new Error("GOAL_STRATEGY_NOT_ALLOWED");
  }
  const base = {
    schema: GOAL_APPROVAL_SCHEMA,
    kind,
    operation,
    scope: policy.scope,
    subject: input.subject,
    ...(strategyId ? { strategyId } : {}),
    ordersEnabled: policy.ordersEnabled,
    target: "professional-dismanager.net" as const,
    safeguardProfile: "FAIL_CLOSED_SIGNED_ROOT_V1" as const,
  };
  const fingerprint = crypto.createHash("sha256").update(canonicalJson(base)).digest("hex");
  return { ...base, fingerprint };
}

export function assertSameOwnerGoal(goal: GoalApproval): void {
  const expected = makeOwnerGoal({
    kind: goal.kind, operation: goal.operation,
    subject: goal.subject, strategyId: goal.strategyId,
  });
  if (canonicalJson(goal) !== canonicalJson(expected)) {
    throw new Error("GOAL_IDENTITY_TAMPERED");
  }
}

export function assertOwnerGoalCandidate(input: {
  goal: GoalApproval;
  sha: string;
  planSha256: string;
  ordersEnabled: boolean;
  plan: unknown;
}): void {
  assertSameOwnerGoal(input.goal);
  if (!SHA_RE.test(input.sha) || !HASH_RE.test(input.planSha256)) {
    throw new Error("GOAL_CANDIDATE_DIGEST_INVALID");
  }
  if (typeof input.ordersEnabled !== "boolean" ||
      (input.ordersEnabled && !input.goal.ordersEnabled)) {
    throw new Error("GOAL_ORDER_PERMISSION_ESCALATION");
  }
  const plan = input.plan as Record<string, unknown> | null;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("GOAL_PLAN_INVALID");
  }
  if (
    plan.schema !== GOAL_RELEASE_PLAN_SCHEMA ||
    plan.goalFingerprint !== input.goal.fingerprint ||
    plan.kind !== input.goal.kind ||
    plan.operation !== input.goal.operation ||
    plan.scope !== input.goal.scope ||
    plan.subject !== input.goal.subject ||
    (plan.strategyId ?? undefined) !== input.goal.strategyId ||
    // A plan committed *inside* its own release cannot contain that final
    // commit SHA without a circular hash dependency. GitHub run.head_sha and
    // the SHA-addressed contents API independently bind it to the candidate.
    plan.sourceBinding !== "GITHUB_RUN_HEAD_SHA" ||
    plan.ordersEnabled !== input.ordersEnabled ||
    plan.target !== input.goal.target
  ) {
    throw new Error("GOAL_PLAN_OUTSIDE_APPROVED_PURPOSE");
  }
  const safeguards = plan.safeguards as Record<string, unknown> | undefined;
  if (!safeguards ||
      safeguards.failClosed !== true ||
      safeguards.signedVenueReconciliation !== true ||
      safeguards.protectExistingStops !== true ||
      safeguards.noTestOrders !== true ||
      safeguards.enforceSharedRisk !== true ||
      safeguards.rollbackOnFailure !== true) {
    throw new Error("GOAL_REQUIRED_SAFEGUARDS_MISSING");
  }
}

export function isReusableOwnerGoal(input: {
  approvedAt?: number;
  status: string;
  goal?: GoalApproval;
  requested: GoalApproval;
}): boolean {
  return Boolean(
    input.goal &&
    input.approvedAt &&
    ["APPROVED", "DISPATCHED", "REDEEMED"].includes(input.status) &&
    canonicalJson(input.goal) === canonicalJson(input.requested)
  );
}
