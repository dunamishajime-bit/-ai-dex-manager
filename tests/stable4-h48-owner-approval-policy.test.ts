import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  DEPLOY_APPROVAL_OPERATION_POLICY,
  STABLE4_H48_TIME_ONLY_APPROVAL,
  isExactStable4H48OwnerApprovalRequest,
} from "../lib/deploy-approval-token";

const p = STABLE4_H48_TIME_ONLY_APPROVAL;
const valid = {
  targetSha: p.targetSha,
  planSha256: p.planSha256,
  h48Policy: p.policy,
  actor: "dunamishajime-bit",
};

test("STABLE4 H48 only permits exact Owner, source, plan and policy", () => {
  assert.equal(isExactStable4H48OwnerApprovalRequest(valid), true);
  for (const diff of [
    { targetSha: "a".repeat(40) },
    { planSha256: "f".repeat(64) },
    { h48Policy: "HYPE_SHA_RESTORE" },
    { actor: "not-owner" },
    { targetSha: null },
    { planSha256: null },
    { h48Policy: null },
    { actor: null },
  ]) {
    assert.equal(isExactStable4H48OwnerApprovalRequest({ ...valid, ...diff }), false);
  }
});

test("STABLE4 H48 has explicit no-resident-STOP exception and reviewed gross bounds", () => {
  const operation = DEPLOY_APPROVAL_OPERATION_POLICY.HYPE_STABLE4_H48_TIME_ONLY_LIVE;
  assert.equal(operation.scope, p.scope);
  assert.equal(operation.ordersEnabled, true);
  assert.match(operation.label, /H48/);
  assert.match(operation.label, /常駐STOP/);
  assert.equal(p.residentStopRequired, false);
  assert.equal(p.residentTakeProfitRequired, false);
  assert.deepEqual(p.approvedGross, { crypto: 3, stock: 4, total: 4.25, hype: 1.5 });
});

test("Owner-triggered GitHub workflow is exact, isolated and non-trading", () => {
  const workflow = readFileSync(".github/workflows/disdex-v4-hp-approval-request.yml", "utf8");
  assert.match(workflow, /github\.actor == 'dunamishajime-bit'/);
  assert.match(workflow, /github\.event\.issue\.number == 317/);
  assert.ok(workflow.includes(p.targetSha));
  assert.ok(workflow.includes(p.planSha256));
  assert.ok(workflow.includes("POLICY=H48_TIME_ONLY"));
  assert.ok(workflow.includes("STABLE4_H48_EXACT_SOURCE_AND_POLICY_PLAN_REQUIRED"));
  assert.ok(workflow.includes("APPROVAL_REQUEST_PUBLISHED_VIA_API=TRUE"));
  assert.ok(workflow.includes("TRADING_MUTATION=0"));
});

test("HP risk disclosure describes time-only exit and does not override holds", () => {
  const ui = readFileSync("app/production-approval/page.tsx", "utf8");
  assert.ok(ui.includes("HYPE_STABLE4_H48_TIME_ONLY_LIVE"));
  assert.ok(ui.includes("常駐STOP注文・常駐TP注文を要求しません"));
  assert.ok(ui.includes("GLOBAL HOLD"));
  assert.ok(ui.includes("SHAまたはPlanが一致しません"));
});

