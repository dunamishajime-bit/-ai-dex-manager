import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import fs from "node:fs";
import {
  GOAL_RELEASE_PLAN_SCHEMA,
  GOAL_CI_WORKFLOW,
  GOAL_CI_WORKFLOW_NAME,
  makeOwnerGoal,
  isReusableOwnerGoal,
  assertOwnerGoalCandidate,
} from "../lib/owner-goal-approval";
import { verifyOwnerGoalRelease } from "../lib/server/owner-goal-attestation";

const GOAL_ID = "11111111-2222-3333-4444-555555555555";
const SHA = "a".repeat(40);
const CI_ID = "1122334455";
const FINGERPRINT_SHA = "b".repeat(40);

const baseGoal = makeOwnerGoal({
  kind: "RESTORE_RUNNER_LIVE",
  operation: "V12_V4_LIVE",
  subject: "V12_V4",
});
const switches = makeOwnerGoal({
  kind: "SWITCH_STRATEGY_LOGIC",
  operation: "V12_V4_LIVE",
  subject: "V12_V4",
  strategyId: "STABLE4",
});
const ROOT_PLAN = "e".repeat(64);
function planFor(goal = baseGoal, sha = SHA, ordersEnabled = false,
                 executionPlanSha256?: string) {
  return {
    schema: GOAL_RELEASE_PLAN_SCHEMA,
    goalFingerprint: goal.fingerprint,
    kind: goal.kind,
    operation: goal.operation,
    scope: goal.scope,
    subject: goal.subject,
    ...(goal.strategyId ? { strategyId: goal.strategyId } : {}),
    target: goal.target,
    sourceBinding: "GITHUB_RUN_HEAD_SHA",
    ...(executionPlanSha256 ? { executionPlanSha256 } : {}),
    ordersEnabled,
    safeguards: {
      failClosed: true,
      signedVenueReconciliation: true,
      protectExistingStops: true,
      noTestOrders: true,
      enforceSharedRisk: true,
      rollbackOnFailure: true,
    },
  };
}

test("Goal fingerprint is stable when implementation SHA and executable plan change", () => {
  assert.equal(baseGoal.fingerprint.length, 64);
  assert.equal(makeOwnerGoal({
    kind: "RESTORE_RUNNER_LIVE", operation: "V12_V4_LIVE", subject: "V12_V4",
  }).fingerprint, baseGoal.fingerprint);
  assert.notEqual(baseGoal.fingerprint, switches.fingerprint);
  assert.equal(isReusableOwnerGoal({
    goal: baseGoal, requested: baseGoal, status: "REDEEMED", approvedAt: 1,
  }), true);
  assert.equal(isReusableOwnerGoal({
    goal: baseGoal, requested: switches, status: "APPROVED", approvedAt: 1,
  }), false);
  assert.equal(isReusableOwnerGoal({
    goal: baseGoal, requested: baseGoal, status: "COMPLETED", approvedAt: 1,
  }), false);
});

test("Goal cannot silently expand the Runner, order authority, strategy, or exceptional HYPE scope", () => {
  assert.throws(() => makeOwnerGoal({
    kind: "RESTORE_RUNNER_LIVE", operation: "V12_V4_LIVE", subject: "FULL_PROJECT",
  }), /GOAL_SCOPE_MISMATCH/);
  assert.throws(() => makeOwnerGoal({
    kind: "SWITCH_STRATEGY_LOGIC", operation: "V12_V4_LIVE", subject: "V12_V4",
  }), /GOAL_STRATEGY_REQUIRED/);
  assert.throws(() => makeOwnerGoal({
    kind: "RESTORE_RUNNER_LIVE", operation: "HYPE_STABLE4_H48_TIME_ONLY_LIVE",
    subject: "HYPE_TREND_LONG",
  }), /GOAL_OPERATION_OUT_OF_SCOPE/);
  const monitorOnly = makeOwnerGoal({
    kind: "RESTORE_RUNNER_LIVE",
    operation: "ALL_RUNNERS_LIVE_RESTORE", subject: "FULL_PROJECT",
  });
  assert.throws(() => assertOwnerGoalCandidate({
    goal: monitorOnly, sha: SHA, planSha256: "f".repeat(64),
    executionPlanSha256: ROOT_PLAN, ordersEnabled: true, plan: planFor(monitorOnly, SHA, true),
  }), /GOAL_ORDER_PERMISSION_ESCALATION/);
});

test("Revised SHA is accepted only when the new plan still matches approved purpose and safeguards", () => {
  const plan = planFor(switches, FINGERPRINT_SHA, true, ROOT_PLAN);
  assert.doesNotThrow(() => assertOwnerGoalCandidate({
    goal: switches, sha: FINGERPRINT_SHA, planSha256: "f".repeat(64),
    executionPlanSha256: ROOT_PLAN, ordersEnabled: true, plan,
  }));
  assert.throws(() => assertOwnerGoalCandidate({
    goal: switches, sha: FINGERPRINT_SHA, planSha256: "f".repeat(64),
    executionPlanSha256: ROOT_PLAN, ordersEnabled: false, plan,
  }), /GOAL_PLAN_OUTSIDE_APPROVED_PURPOSE/);
  // The same plan can be used with another candidate commit only after that
  // new run's head_sha / source tree / plan bytes are independently attested.
  assert.doesNotThrow(() => assertOwnerGoalCandidate({
    goal: switches, sha: SHA, planSha256: "f".repeat(64),
    executionPlanSha256: ROOT_PLAN, ordersEnabled: true, plan,
  }));
  assert.throws(() => assertOwnerGoalCandidate({
    goal: switches, sha: FINGERPRINT_SHA, planSha256: "f".repeat(64),
    executionPlanSha256: ROOT_PLAN, ordersEnabled: true, plan: { ...plan, safeguards: { ...plan.safeguards, protectExistingStops: false } },
  }), /GOAL_REQUIRED_SAFEGUARDS_MISSING/);
  assert.throws(() => assertOwnerGoalCandidate({
    goal: switches, sha: SHA, planSha256: "f".repeat(64),
    ordersEnabled: true, plan,
  }), /GOAL_ROOT_PLAN_REQUIRED_FOR_TRADING/);
  assert.throws(() => assertOwnerGoalCandidate({
    goal: switches, sha: SHA, planSha256: "f".repeat(64),
    executionPlanSha256: "d".repeat(64), ordersEnabled: true, plan,
  }), /GOAL_PLAN_OUTSIDE_APPROVED_PURPOSE/);
});

type StubConfig = { good?: boolean; candidate?: string; masterBlob?: string; candidateBlob?: string; corrupted?: boolean; changedPlan?: boolean };
function githubStub(config: StubConfig = {}) {
  const raw = Buffer.from(JSON.stringify(planFor()), "utf8");
  const bytes = config.changedPlan ? Buffer.from("{}", "utf8") : raw;
  const out = {
    planSha: crypto.createHash("sha256").update(raw).digest("hex"),
    fetcher: (async (input: RequestInfo | URL) => {
      const url = String(input);
      let payload: Record<string, unknown>;
      if (url.includes("/actions/runs/")) {
        payload = {
          repository: { full_name: "dunamishajime-bit/-ai-dex-manager" },
          head_sha: config.candidate ?? SHA,
          event: "workflow_dispatch", workflow_id: 123,
          status: "completed", conclusion: config.good === false ? "failure" : "success",
        };
      } else if (url.includes("/actions/workflows/")) {
        payload = { path: GOAL_CI_WORKFLOW, name: GOAL_CI_WORKFLOW_NAME, state: "active" };
      } else if (url.includes("/contents/" + GOAL_CI_WORKFLOW)) {
        payload = {
          sha: url.includes("ref=master") ? (config.masterBlob ?? "workflow-blob")
            : (config.candidateBlob ?? "workflow-blob"),
          type: "file",
        };
      } else if (url.includes("/contents/docs/implementation/goal-campaigns/")) {
        payload = {
          type: "file", encoding: "base64",
          content: bytes.toString("base64"), size: bytes.length,
        };
      } else { return new Response("Not Found", { status: 404 }); }
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as typeof fetch,
  };
  return out;
}

test("Fresh exact-SHA token eligibility comes only from verified immutable workflow + plan", async () => {
  const stub = githubStub();
  await verifyOwnerGoalRelease({
    approvalId: GOAL_ID, goal: baseGoal,
    candidateSha: SHA, planSha256: stub.planSha,
    ordersEnabled: false, ciRunId: CI_ID, fetcher: stub.fetcher,
  });
  const params = {
    approvalId: GOAL_ID, goal: baseGoal, candidateSha: SHA,
    planSha256: stub.planSha, ordersEnabled: false, ciRunId: CI_ID,
  };
  await assert.rejects(verifyOwnerGoalRelease({ ...params, fetcher: githubStub({ good: false }).fetcher }), /GOAL_CI_RUN_NOT_ELIGIBLE/);
  await assert.rejects(verifyOwnerGoalRelease({ ...params, fetcher: githubStub({ candidate: "c".repeat(40) }).fetcher }), /GOAL_CI_RUN_NOT_ELIGIBLE/);
  await assert.rejects(verifyOwnerGoalRelease({ ...params, fetcher: githubStub({ candidateBlob: "untrusted" }).fetcher }), /GOAL_CI_WORKFLOW_MODIFIED/);
  await assert.rejects(verifyOwnerGoalRelease({ ...params, fetcher: githubStub({ changedPlan: true }).fetcher }), /GOAL_PLAN_SHA_MISMATCH/);
});

test("Goal attestation fetches independent evidence concurrently after the CI run gate", async () => {
  const stub = githubStub();
  let active = 0;
  let maxActive = 0;
  let ciVerifiedFirst = false;
  const observed: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/actions/runs/")) {
      observed.push("ci");
      const response = await stub.fetcher(input);
      ciVerifiedFirst = true;
      return response;
    }
    assert.equal(ciVerifiedFirst, true, "all independent requests must follow the CI run gate");
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return await stub.fetcher(input);
    } finally {
      active -= 1;
    }
  }) as typeof fetch;
  await verifyOwnerGoalRelease({
    approvalId: GOAL_ID, goal: baseGoal,
    candidateSha: SHA, planSha256: stub.planSha,
    ordersEnabled: false, ciRunId: CI_ID, fetcher,
  });
  assert.deepEqual(observed, ["ci"]);
  assert.equal(maxActive, 4, "four independent GitHub reads should overlap");
});

test("Legacy redeem rejects goal charter, and only admin OTP can approve the charter", () => {
  const route = fs.readFileSync("app/api/system/deploy-approval/route.ts", "utf8");
  const admin = fs.readFileSync("app/api/admin/deploy-approval/route.ts", "utf8");
  assert.match(route, /GOAL_MUST_USE_CI_ATTESTED_RELEASE_CLAIM/);
  assert.match(route, /verifyOwnerGoalRelease/);
  assert.match(route, /mutateDeploymentApprovalAtomic\(id/);
  assert.match(admin, /if \(current.goal\) assertSameOwnerGoal\(current.goal\)/);
  assert.match(admin, /consumeOtpChallenge/);
  assert.match(admin, /GOAL_REVOKED_BY_OWNER/);
});


test("Goal request Action only publishes a charter and cannot deploy or redeem production authority", () => {
  const workflow = fs.readFileSync(".github/workflows/disdex-owner-goal-approval-request.yml", "utf8");
  assert.match(workflow, /"action": "publish_goal"/);
  assert.match(workflow, /environment:\s*\n\s+name:\s*disdex-production/);
  assert.match(workflow, /body\["goal_id"\] = os\.environ\["GOAL_ID"\]/);
  assert.doesNotMatch(workflow, /\bssh\b|systemctl|disdex_owner_approval\.py verify/);
  assert.doesNotMatch(workflow, /"action": "redeem"/);
  assert.match(workflow, /GOAL_APPROVAL_ID=/);
});


test("Official protected V4 cutover consumes goal once but verifies every new SHA and Root plan", () => {
  const source = fs.readFileSync(".github/workflows/disdex-v4-formal-production-live.yml","utf8");
  assert.match(source, /goal_id:/);
  assert.match(source, /environment:\s*\n\s+name:\s*disdex-production/);
  assert.match(source, /"action":"get_goal_status"/);
  assert.match(source, /"action":"claim_goal_release"/);
  assert.match(source, /"execution_plan_sha256":os\.environ\["ROOT_PLAN"\]/);
  assert.match(source, /"orders_enabled":True/);
  assert.match(source, /goal\["operation"\]=="V12_V4_LIVE"/);
  assert.match(source, /signed\["signedPlanSha256"\]==os\.environ\["ROOT_PLAN"\]/);
  assert.match(source, /"action":"finish_goal_release"/);
  assert.match(source, /--preflight-readonly --read-approval-stdin/);
  assert.match(source, /--execute --read-approval-stdin/);
  assert.match(source, /cat "\$RUNNER_TEMP\/disdex-owner-token" \| ssh/);
  assert.doesNotMatch(source, /echo ["']\$TOKEN["']/);
});

test("Existing certified Runner resume accepts a goal charter without sacrificing scoped restoration", () => {
  const source = fs.readFileSync(".github/workflows/disdex-allrunner-v4-idle-live-resume.yml", "utf8");
  assert.match(source, /goal_id:/);
  assert.match(source, /"action":"claim_goal_release"/);
  assert.match(source, /goal\["operation"\]=="ALL_RUNNERS_LIVE_RESTORE"/);
  assert.match(source, /goal\["ordersEnabled"\] is False/);
  assert.match(source, /"final":False/);
  assert.match(source, /--orders-enabled false/);
  assert.match(source, /environment:\s*\n\s+name:\s*disdex-production/);
});
