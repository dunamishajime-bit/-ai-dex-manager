import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { makeOwnerGoal } from "../lib/owner-goal-approval";

test("one Owner OTP survives concurrent publish, source SHA revisions, and unrelated approval history", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "disdex-goal-once-"));
  process.env.DISDEX_DEPLOY_APPROVAL_STORE_PATH = path.join(dir, "approvals.json");
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const store = await import("../lib/server/deploy-approval-store");
  const goal = makeOwnerGoal({
    kind: "RESTORE_RUNNER_LIVE",
    operation: "ALL_RUNNERS_LIVE_RESTORE",
    subject: "FULL_PROJECT",
  });
  const actor = "dunamishajime-bit";
  try {
    const requests = await Promise.all(Array.from({ length: 12 }, () =>
      store.createPendingOwnerGoal({ goal, actor })));
    assert.equal(new Set(requests.map(row => row.id)).size, 1);
    assert.ok(requests.every(row => row.status === "PENDING"));
    const first = requests[0];
    const saved = JSON.parse(await fs.readFile(process.env.DISDEX_DEPLOY_APPROVAL_STORE_PATH!, "utf8"));
    assert.equal(saved.filter((row: { id: string }) => row.id === first.id).length, 1);
    const ownerApproved = await store.saveDeploymentApproval({
      ...first, status: "APPROVED", approvedAt: Date.now(),
    });
    assert.equal((await store.createPendingOwnerGoal({ goal, actor })).id, first.id);

    const revisions = ["a".repeat(40), "b".repeat(40)];
    for (const candidateSha of revisions) {
      await store.mutateDeploymentApprovalAtomic(first.id, row => {
        assert.ok(row?.goal);
        const now = Date.now();
        return {
          next: {
            ...row, status: "DISPATCHED",
            goalActiveClaim: {
              runId: candidateSha === revisions[0] ? "123" : "124",
              candidateSha, planSha256: "e".repeat(64),
              ciRunId: "999", ordersEnabled: false, claimedAt: now,
            },
          },
          result: null,
        };
      });
      assert.equal((await store.createPendingOwnerGoal({ goal, actor })).id, first.id);
      await store.mutateDeploymentApprovalAtomic(first.id, row => {
        assert.ok(row);
        return { next: { ...row, status: "APPROVED", goalActiveClaim: undefined }, result: null };
      });
    }

    for (let i = 0; i < 65; i++) {
      const now = Date.now() + i;
      await store.saveDeploymentApproval({
        id: "other-" + i, scope: "V12_V4", operation: "V12_V4_LIVE",
        ordersEnabled: true, targetSha: "d".repeat(40),
        planSha256: "c".repeat(64), requestActor: actor,
        createdAt: now, requestExpiresAt: now + 1800000, updatedAt: now,
        status: "PENDING",
      });
    }
    assert.equal((await store.createPendingOwnerGoal({ goal, actor })).id, first.id);
    assert.equal((await store.createPendingOwnerGoal({
      goal, actor, existingGoalId: first.id,
    })).id, first.id);
    const finalRecord = await store.getDeploymentApproval(first.id);
    assert.ok(finalRecord);
    await store.saveDeploymentApproval({
      ...finalRecord, status: "COMPLETED", completedAt: Date.now(),
    });
    const freshTask = await store.createPendingOwnerGoal({ goal, actor });
    assert.notEqual(freshTask.id, first.id);
    assert.equal(freshTask.status, "PENDING");
    // A request may remain pending while other tasks fill the visible history.
    for (let i = 100; i < 155; i++) {
      const now = Date.now() + i;
      await store.saveDeploymentApproval({
        id: "other-" + i, scope: "V12_V4", operation: "V12_V4_LIVE",
        ordersEnabled: true, targetSha: "d".repeat(40),
        planSha256: "c".repeat(64), requestActor: actor,
        createdAt: now, requestExpiresAt: now + 1800000,
        updatedAt: now, status: "PENDING",
      });
    }
    assert.equal((await store.createPendingOwnerGoal({ goal, actor })).id, freshTask.id);

    const expired = await store.getDeploymentApproval(freshTask.id);
    assert.ok(expired);
    await store.saveDeploymentApproval({
      ...expired, requestExpiresAt: Date.now() - 1000,
    });
    const renewed = await store.createPendingOwnerGoal({ goal, actor });
    assert.notEqual(renewed.id, freshTask.id);
    assert.equal(renewed.status, "PENDING");
    assert.equal(ownerApproved.id, first.id);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
