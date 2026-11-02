import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  ALL_RUNNERS_LIVE_TASK, ALL_RUNNER_TASK_STEPS,
  ALL_RUNNERS_LIVE_PLAN_SHA256, allRunnerStepPlanSha256,
  validateAllRunnerTaskClaim, isAllRunnerTaskStep,
} from "../lib/deploy-all-runners-task";
import {
  DEPLOY_APPROVAL_OPERATION_POLICY,
  issueDeploymentApprovalToken,
} from "../lib/deploy-approval-token";

assert.equal(DEPLOY_APPROVAL_OPERATION_POLICY.ALL_RUNNERS_LIVE_RESTORE.scope, "FULL_PROJECT");
assert.equal(DEPLOY_APPROVAL_OPERATION_POLICY.ALL_RUNNERS_LIVE_RESTORE.ordersEnabled, false);
assert.equal(ALL_RUNNERS_LIVE_TASK.maxAgeMs, 24 * 60 * 60 * 1000);
assert.ok(ALL_RUNNERS_LIVE_TASK.maxClaims >= Object.keys(ALL_RUNNER_TASK_STEPS).length);
assert.equal(ALL_RUNNERS_LIVE_PLAN_SHA256.length, 64);

const plans = new Set<string>();
const { privateKey } = generateKeyPairSync("ed25519");
for (const [step, spec] of Object.entries(ALL_RUNNER_TASK_STEPS)) {
  assert.ok(isAllRunnerTaskStep(step));
  const name = step as keyof typeof ALL_RUNNER_TASK_STEPS;
  const plan = allRunnerStepPlanSha256(name);
  assert.match(plan, /^[0-9a-f]{64}$/);
  assert.ok(!plans.has(plan), `nonunique plan for ${step}`);
  plans.add(plan);
  const grant = {
    taskOperation: ALL_RUNNERS_LIVE_TASK.operation,
    taskScope: ALL_RUNNERS_LIVE_TASK.scope,
    taskTargetSha: ALL_RUNNERS_LIVE_TASK.baselineSha,
    taskPlanSha256: ALL_RUNNERS_LIVE_PLAN_SHA256,
    taskOrdersEnabled: false,
    step,
    stepTargetSha: spec.targetSha,
    stepPlanSha256: plan,
    stepOrdersEnabled: spec.ordersEnabled,
  };
  assert.equal(validateAllRunnerTaskClaim(grant), true, step);
  assert.equal(validateAllRunnerTaskClaim({ ...grant, taskOperation: "V12_V4_LIVE" }), false);
  assert.equal(validateAllRunnerTaskClaim({ ...grant, taskPlanSha256: "f".repeat(64) }), false);
  assert.equal(validateAllRunnerTaskClaim({ ...grant, taskOrdersEnabled: true }), false);
  assert.equal(validateAllRunnerTaskClaim({ ...grant, stepTargetSha: "f".repeat(40) }), false);
  assert.equal(validateAllRunnerTaskClaim({ ...grant, stepPlanSha256: "f".repeat(64) }), false);
  assert.equal(validateAllRunnerTaskClaim({ ...grant, stepOrdersEnabled: !spec.ordersEnabled }), false);
  const signed = issueDeploymentApprovalToken({
    targetSha: spec.targetSha,
    planSha256: plan,
    operator: "dunamishajime-bit",
    scope: spec.scope,
    ordersEnabled: spec.ordersEnabled,
    privateKey,
  });
  assert.equal(signed.payload.scope, spec.scope);
  assert.equal(signed.payload.ordersEnabled, spec.ordersEnabled);
  assert.equal(signed.payload.planSha256, plan);
  assert.ok(signed.payload.expiresAt - signed.payload.issuedAt <= 300);
}
assert.equal(validateAllRunnerTaskClaim({
  taskOperation: ALL_RUNNERS_LIVE_TASK.operation,
  taskScope: ALL_RUNNERS_LIVE_TASK.scope,
  taskTargetSha: ALL_RUNNERS_LIVE_TASK.baselineSha,
  taskPlanSha256: ALL_RUNNERS_LIVE_PLAN_SHA256,
  taskOrdersEnabled: false,
  step: "UNAUTHORIZED_TRADING_STAGE",
  stepTargetSha: ALL_RUNNERS_LIVE_TASK.baselineSha,
  stepPlanSha256: "0".repeat(64),
  stepOrdersEnabled: true,
}), false);
assert.equal(plans.size, 10);
console.log("DISDEX_ALL_RUNNERS_ONE_TASK_APPROVAL_SELFTEST=PASS");
