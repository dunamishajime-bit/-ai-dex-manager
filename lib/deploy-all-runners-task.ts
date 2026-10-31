import crypto from "crypto";

/**
 * Single owner request: restore the seven existing production runner families.
 * The authorization covers only these named stages, never strategy changes,
 * unrelated deploys, unlisted orders, STOP cancellation, or unsafe risk overrides.
 */
export const ALL_RUNNERS_LIVE_TASK = {
  operation: "ALL_RUNNERS_LIVE_RESTORE" as const,
  scope: "FULL_PROJECT" as const,
  baselineSha: "7688ed7c93a1918d8b44837339b7da5584a868f5",
  label: "全Runner LIVE復旧（V52・IDLE・V4・HYPE・Q102・PENGU・FET）",
  maxAgeMs: 24 * 60 * 60 * 1000,
  maxClaims: 30,
  safeguards: [
    "signed_venue_gets",
    "resident_stop_preserved",
    "no_test_orders",
    "no_unapproved_stop_or_order_cancellation",
    "shared_margin_and_gross",
    "fail_closed",
    "one_runner_owner_per_family",
    "reversible_version_change",
    "operator_reviewed_github_ci",
  ],
} as const;

export const ALL_RUNNER_TASK_STEPS = {
  V52_VERIFY: { scope: "V52", targetSha: "4d33d8244c0b50a7e461ffd8aaf493c32bfdfd81", ordersEnabled: false },
  IDLE_FLAT_STALE_REPAIR: { scope: "IDLE_PRIORITY_SHORT", targetSha: ALL_RUNNERS_LIVE_TASK.baselineSha, ordersEnabled: false },
  SHARED_HOLD_RECOVERY: { scope: "SHARED_CRYPTO_RISK_ONLY", targetSha: ALL_RUNNERS_LIVE_TASK.baselineSha, ordersEnabled: false },
  V4_LIVE_RECOVER: { scope: "V12_V4", targetSha: "53a0be396719f0284af4e11b35c66a4ac7d58f79", ordersEnabled: true },
  IDLE_LIVE_RESUME: { scope: "IDLE_PRIORITY_SHORT", targetSha: ALL_RUNNERS_LIVE_TASK.baselineSha, ordersEnabled: true },
  HYPE_LIVE_RECOVER: { scope: "HYPE_TREND_LONG", targetSha: ALL_RUNNERS_LIVE_TASK.baselineSha, ordersEnabled: true },
  Q102_LIVE_VERIFY: { scope: "QUALITY102_CAUSAL_V1", targetSha: "ef1ab178e26a7bf5bddb6473467765edba242e1d", ordersEnabled: true },
  PENGU_LIVE_VERIFY: { scope: "PENGU_V8", targetSha: ALL_RUNNERS_LIVE_TASK.baselineSha, ordersEnabled: true },
  FET_LIVE_VERIFY: { scope: "FET_BRK48_RESIDUAL", targetSha: ALL_RUNNERS_LIVE_TASK.baselineSha, ordersEnabled: true },
  FINAL_ALL_RUNNERS_AUDIT: { scope: "FULL_PROJECT", targetSha: ALL_RUNNERS_LIVE_TASK.baselineSha, ordersEnabled: false },
} as const;

export type AllRunnerTaskStep = keyof typeof ALL_RUNNER_TASK_STEPS;

export function isAllRunnerTaskStep(name: string): name is AllRunnerTaskStep {
  return Object.prototype.hasOwnProperty.call(ALL_RUNNER_TASK_STEPS, name);
}

const planSource = JSON.stringify({
  operation: ALL_RUNNERS_LIVE_TASK.operation,
  scope: ALL_RUNNERS_LIVE_TASK.scope,
  baselineSha: ALL_RUNNERS_LIVE_TASK.baselineSha,
  safeguardVersion: 1,
  safeguards: ALL_RUNNERS_LIVE_TASK.safeguards,
  steps: ALL_RUNNER_TASK_STEPS,
});

export const ALL_RUNNERS_LIVE_PLAN_SHA256 = crypto.createHash("sha256").update(planSource).digest("hex");

/** Maintain compatibility with the already certified exact non-order IDLE workflow. */
export function allRunnerStepPlanSha256(step: AllRunnerTaskStep): string {
  const info = ALL_RUNNER_TASK_STEPS[step];
  const context = step === "IDLE_FLAT_STALE_REPAIR"
    ? `IDLE_FLAT_STALE_REPAIR_AFTER_THREE_SIGNED_GETS\n${info.targetSha}\n`
    : `DISDEX_ALL_RUNNERS_LIVE_TASK_V1\n${ALL_RUNNERS_LIVE_PLAN_SHA256}\n${step}\n${info.targetSha}\n`;
  return crypto.createHash("sha256").update(context, "ascii").digest("hex");
}

export function validateAllRunnerTaskClaim(input: {
  taskOperation?: string;
  taskScope?: string;
  taskTargetSha?: string;
  taskPlanSha256?: string;
  taskOrdersEnabled?: boolean;
  step: string;
  stepTargetSha: string;
  stepPlanSha256: string;
  stepOrdersEnabled?: boolean;
}) {
  if (!isAllRunnerTaskStep(input.step)) return false;
  const step = ALL_RUNNER_TASK_STEPS[input.step];
  return (
    input.taskOperation === ALL_RUNNERS_LIVE_TASK.operation &&
    input.taskScope === ALL_RUNNERS_LIVE_TASK.scope &&
    input.taskTargetSha === ALL_RUNNERS_LIVE_TASK.baselineSha &&
    input.taskPlanSha256 === ALL_RUNNERS_LIVE_PLAN_SHA256 &&
    input.taskOrdersEnabled === true &&
    step.targetSha === input.stepTargetSha &&
    allRunnerStepPlanSha256(input.step) === input.stepPlanSha256 &&
    step.ordersEnabled === input.stepOrdersEnabled
  );
}
