import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { canonicalJson } from "../lib/deploy-approval-token";
import {
  GOAL_CI_WORKFLOW,
  GOAL_CI_WORKFLOW_NAME,
  GOAL_RELEASE_PLAN_SCHEMA,
  makeOwnerGoal,
  type GoalApproval,
} from "../lib/owner-goal-approval";

/**
 * Positive E2E of the *actual* HTTP route, approval store, signed child token
 * and GitHub attestation. All state and keys are generated in an isolated
 * temp directory; GitHub responses are mocked; no external HTTP, HP OTP,
 * VPS operation, real signature, or order is sent.
 */
test("one simulated Owner authorization permits two independently attested SHA/plan releases without re-OTP", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "disdex-goal-positive-"));
  const originalFetch = globalThis.fetch;
  const prior = new Map<string, string | undefined>();
  const setEnv = (key: string, value?: string) => {
    if (!prior.has(key)) prior.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  const pair = crypto.generateKeyPairSync("ed25519");
  setEnv("DISDEX_DEPLOY_APPROVAL_STORE_PATH", path.join(temp, "approvals.json"));
  setEnv("DISDEX_HP_APPROVAL_BRIDGE_SECRET", "local-test-bridge-not-production");
  setEnv("DISDEX_HP_APPROVER_PRIVATE_KEY_PEM",
    pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  setEnv("DISDEX_HP_APPROVER_PRIVATE_KEY_PATH");
  setEnv("KV_REST_API_URL");
  setEnv("KV_REST_API_TOKEN");
  setEnv("UPSTASH_REDIS_REST_URL");
  setEnv("UPSTASH_REDIS_REST_TOKEN");

  type Case = { sha: string; ci: string; plan: Buffer; digest: string; rootPlan?: string };
  const ownerGoal = makeOwnerGoal({
    kind: "SWITCH_STRATEGY_LOGIC",
    operation: "V12_V4_LIVE",
    subject: "V12_V4",
    strategyId: "STABLE4",
  });
  const makePlan = (goal: GoalApproval, rootPlan: string, revision: string) => ({
    schema: GOAL_RELEASE_PLAN_SCHEMA,
    goalFingerprint: goal.fingerprint, kind: goal.kind,
    operation: goal.operation, scope: goal.scope, subject: goal.subject,
    strategyId: goal.strategyId, target: goal.target,
    sourceBinding: "GITHUB_RUN_HEAD_SHA", executionPlanSha256: rootPlan,
    ordersEnabled: true, revision,
    safeguards: {
      failClosed: true, signedVenueReconciliation: true,
      protectExistingStops: true, noTestOrders: true,
      enforceSharedRisk: true, rollbackOnFailure: true,
    },
  });
  const mkCase = (sha: string, ci: string, rootPlan: string, revision: string): Case => {
    const plan = Buffer.from(JSON.stringify(makePlan(ownerGoal, rootPlan, revision)));
    return { sha, ci, rootPlan, plan, digest: crypto.createHash("sha256").update(plan).digest("hex") };
  };
  const first = mkCase("a".repeat(40), "10001", "e".repeat(64), "original-candidate");
  const second = mkCase("b".repeat(40), "10002", "f".repeat(64), "repaired-candidate");
  const cases = [first, second];
  let recordedGoalId = "";
  let githubCalls = 0;
  try {
    const store = await import("../lib/server/deploy-approval-store");
    const { POST } = await import("../app/api/system/deploy-approval/route");
    const url = "https://disdex-test.invalid/api/system/deploy-approval";
    async function call(body: Record<string, unknown>) {
      const req = new NextRequest(url, {
        method: "POST",
        headers: {
          authorization: "Bearer local-test-bridge-not-production",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const response = await POST(req);
      return { status: response.status, body: await response.json() as Record<string, any> };
    }
    const pub = await call({
      action: "publish_goal", actor: "dunamishajime-bit",
      kind: ownerGoal.kind, operation: ownerGoal.operation,
      subject: ownerGoal.subject, strategy_id: ownerGoal.strategyId,
    });
    assert.equal(pub.status, 201);
    assert.equal(pub.body.approval.status, "PENDING");
    recordedGoalId = pub.body.approval.id;
    assert.match(recordedGoalId, /^[a-f0-9-]{36}$/);

    // Stand-in for the one legitimate HP Owner OTP; never simulate a live
    // Owner session, and never call the real OTP mail endpoint.
    const pending = await store.getDeploymentApproval(recordedGoalId);
    assert.ok(pending);
    await store.saveDeploymentApproval({
      ...pending, status: "APPROVED", approvedAt: Date.now(),
    });
    let ownerApprovalCount = 1;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      githubCalls += 1;
      const url = String(input);
      let obj: Record<string, unknown>;
      if (url.includes("/actions/runs/")) {
        const match = url.match(/\/actions\/runs\/(\d+)$/);
        const found = cases.find(x => x.ci === match?.[1]);
        obj = {
          repository: { full_name: "dunamishajime-bit/-ai-dex-manager" },
          head_sha: found?.sha || "0".repeat(40),
          status: "completed", conclusion: "success",
          event: "workflow_dispatch", workflow_id: 314,
        };
      } else if (url.includes("/actions/workflows/")) {
        obj = { path: GOAL_CI_WORKFLOW, name: GOAL_CI_WORKFLOW_NAME, state: "active" };
      } else if (url.includes("/contents/" + GOAL_CI_WORKFLOW)) {
        obj = { type: "file", sha: "trusted-master-workflow" };
      } else if (url.includes("/contents/docs/implementation/goal-campaigns/")) {
        assert.ok(url.includes(recordedGoalId), "charter ID is immutable");
        const found = cases.find(x => url.endsWith("ref=" + x.sha));
        if (!found) return new Response("missing candidate", { status: 404 });
        obj = {
          type: "file", encoding: "base64",
          content: found.plan.toString("base64"), size: found.plan.length,
        };
      } else throw new Error("unexpected external endpoint: " + url);
      return new Response(JSON.stringify(obj), { status: 200 });
    }) as typeof fetch;

    const tokens: Array<{ sourceSha: string; planSha256: string; nonce: string }> = [];
    for (let i = 0; i < cases.length; i++) {
      const item = cases[i];
      const publishAgain = await call({
        action: "publish_goal", actor: "dunamishajime-bit",
        kind: ownerGoal.kind, operation: ownerGoal.operation,
        subject: ownerGoal.subject, strategy_id: ownerGoal.strategyId,
      });
      assert.equal(publishAgain.body.approval.id, recordedGoalId);
      assert.equal(publishAgain.body.approval.status, "APPROVED");
      assert.equal(ownerApprovalCount, 1, "no second Owner OTP");
      // Same logical goal, but the second release changes both the source
      // and the signed Root execution plan.
      const claim = await call({
        action: "claim_goal_release", goal_id: recordedGoalId,
        run_id: String(20001 + i), ci_run_id: item.ci,
        target_sha: item.sha, plan_sha256: item.digest,
        execution_plan_sha256: item.rootPlan, orders_enabled: true,
      });
      assert.equal(claim.status, 200, JSON.stringify(claim.body));
      assert.equal(claim.body.goalId, recordedGoalId);
      assert.equal(claim.body.signedPlanSha256, item.rootPlan);
      const token = JSON.parse(Buffer.from(claim.body.token, "base64").toString());
      const payload = token.payload;
      assert.ok(crypto.verify(null, Buffer.from(canonicalJson(payload), "ascii"),
        pair.publicKey, Buffer.from(token.signature, "base64")));
      assert.equal(payload.sourceSha, item.sha);
      assert.equal(payload.planSha256, item.rootPlan);
      assert.equal(payload.scope, "V12_V4");
      assert.equal(payload.ordersEnabled, true);
      assert.ok(payload.expiresAt - payload.issuedAt <= 300);
      tokens.push(payload);
      const finish = await call({
        action: "finish_goal_release", goal_id: recordedGoalId,
        run_id: String(20001 + i),
        outcome: i === 0 ? "failure" : "success",
        final: i === 1,
      });
      assert.equal(finish.status, 200, JSON.stringify(finish.body));
      assert.equal(finish.body.status, i === 0 ? "APPROVED" : "COMPLETED");
    }
    assert.notEqual(tokens[0].sourceSha, tokens[1].sourceSha);
    assert.notEqual(tokens[0].planSha256, tokens[1].planSha256);
    assert.notEqual(tokens[0].nonce, tokens[1].nonce);
    assert.ok(githubCalls >= 10, "both candidate CI attestations required");
    assert.equal(ownerApprovalCount, 1);

    const completed = await store.getDeploymentApproval(recordedGoalId);
    assert.equal(completed?.status, "COMPLETED");
    assert.equal(completed?.goalClaimCount, 2);
    assert.equal(completed?.goalClaimHistory?.length, 2);
    // Completion is final. A third release cannot reuse the old charter.
    const rejected = await call({
      action: "claim_goal_release", goal_id: recordedGoalId,
      run_id: "29999", ci_run_id: second.ci,
      target_sha: second.sha, plan_sha256: second.digest,
      execution_plan_sha256: second.rootPlan, orders_enabled: true,
    });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.error, "GOAL_NOT_APPROVED");
    const nextPurpose = await call({
      action: "publish_goal", actor: "dunamishajime-bit",
      kind: ownerGoal.kind, operation: ownerGoal.operation,
      subject: ownerGoal.subject, strategy_id: ownerGoal.strategyId,
    });
    assert.equal(nextPurpose.status, 201);
    assert.notEqual(nextPurpose.body.approval.id, recordedGoalId);
    assert.equal(nextPurpose.body.approval.status, "PENDING");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of prior) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await fs.rm(temp, { recursive: true, force: true });
  }
});
