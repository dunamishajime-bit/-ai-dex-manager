import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

test("file-backed approvals serialize concurrent writers and reject corrupt data", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "disdex-approval-store-test-"));
  const storePath = path.join(dir, "approvals.json");
  process.env.DISDEX_DEPLOY_APPROVAL_STORE_PATH = storePath;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const store = await import("../lib/server/deploy-approval-store");
  const record = (id: string): import("../lib/server/deploy-approval-store").DeploymentApprovalRecord => ({
    id,
    scope: "V12_V4",
    targetSha: "a".repeat(40),
    planSha256: "b".repeat(64),
    requestActor: "synthetic-test",
    createdAt: Date.now(),
    requestExpiresAt: Date.now() + 60_000,
    updatedAt: Date.now(),
    status: "PENDING",
  });

  try {
    await Promise.all(Array.from({ length: 16 }, (_, i) => new Promise<void>((resolve, reject) => {
      const worker = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/approval-store-writer.ts", `worker-${i}`], {
        env: process.env,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      worker.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      worker.on("error", reject);
      worker.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`worker failed: ${code}: ${stderr}`)));
    })));
    const saved = JSON.parse(await fs.readFile(storePath, "utf8"));
    assert.equal(saved.length, 50);
    assert.equal(new Set(saved.map((row: { id: string }) => row.id)).size, 50);

    const retainedIds = saved.map((row: { id: string }) => row.id);
    const firstId = retainedIds[0];
    const secondId = retainedIds[1];
    assert.ok(firstId && secondId && firstId !== secondId);
    const first = await store.getDeploymentApproval(firstId);
    const stale = await store.getDeploymentApproval(firstId);
    assert.ok(first && stale);
    await store.saveDeploymentApproval({ ...first, status: "FAILED" });
    await assert.rejects(store.saveDeploymentApproval({ ...stale, status: "APPROVED" }), /STALE/);
    assert.equal((await store.getDeploymentApproval(firstId))?.status, "FAILED");

    const beforeAtomic = await store.getDeploymentApproval(secondId);
    assert.ok(beforeAtomic);
    await store.mutateDeploymentApprovalAtomic(secondId, (current) => {
      assert.ok(current);
      return { next: { ...current, status: "DISPATCHED" }, result: null };
    });
    await assert.rejects(store.saveDeploymentApproval({ ...beforeAtomic, status: "APPROVED" }), /STALE/);
    assert.equal((await store.getDeploymentApproval(secondId))?.status, "DISPATCHED");


    const redeemable = await store.saveDeploymentApproval({
      ...record("single-redeem"),
      status: "APPROVED",
      approvalToken: "token-for-test",
      approvalTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
    });
    assert.ok(redeemable.storeRevision);
    const claims = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
      store.mutateDeploymentApprovalAtomic("single-redeem", (current) => {
        assert.ok(current);
        if (current.status !== "APPROVED") throw new Error("ALREADY_REDEEMED");
        return {
          next: {
            ...current,
            status: "REDEEMED",
            redeemedAt: Date.now(),
            redeemedByRunId: String(i + 1),
          },
          result: i,
        };
      }),
    ));
    assert.equal(claims.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(claims.filter((x) => x.status === "rejected").length, 19);
    assert.equal((await store.getDeploymentApproval("single-redeem"))?.status, "REDEEMED");

    const durableApproved = await store.saveDeploymentApproval({
      ...record("durable-approved"),
      requestExpiresAt: Date.now() - 60_000,
      status: "APPROVED",
      approvedAt: Date.now() - 120_000,
      approvalToken: "expired-transport-token",
      approvalTokenExpiresAt: Math.floor(Date.now() / 1000) - 60,
    });
    const reused = await store.createPendingDeploymentApproval({
      targetSha: durableApproved.targetSha,
      planSha256: durableApproved.planSha256,
      scope: "V12_V4",
      operation: "V12_V4_LIVE",
      ordersEnabled: true,
      requestActor: "synthetic-test",
      requestCommentId: "same-task-retry",
    });
    assert.equal(reused.id, durableApproved.id);
    assert.equal(reused.status, "APPROVED");
    assert.equal((await store.getDeploymentApproval(durableApproved.id))?.status, "APPROVED");

    const base = Date.now();
    const redeemedMonitor = await store.saveDeploymentApproval({
      ...record("monitor-redeemed"),
      scope: "FULL_PROJECT",
      operation: "ALL_RUNNERS_MONITOR_REFRESH",
      ordersEnabled: false,
      status: "REDEEMED",
      approvedAt: base - 5 * 60_000,
      requestExpiresAt: base - 60_000,
      redeemedByRunId: "12345678",
      createdAt: base + 10_000,
      updatedAt: base,
    });
    const retry = (targetSha: string, planSha256: string) =>
      store.createPendingDeploymentApproval({
        targetSha,
        planSha256,
        scope: "FULL_PROJECT",
        operation: "ALL_RUNNERS_MONITOR_REFRESH",
        ordersEnabled: false,
        requestActor: "synthetic-test",
        requestCommentId: "post-failure-republish",
      });
    const reusedRedeemed = await retry(redeemedMonitor.targetSha, redeemedMonitor.planSha256);
    assert.equal(reusedRedeemed.id, redeemedMonitor.id);
    assert.equal(reusedRedeemed.status, "REDEEMED");
    assert.equal((await store.getDeploymentApproval(redeemedMonitor.id))?.status, "REDEEMED");

    // A changed SHA or plan is a different immutable approval identity.
    const changedSha = await retry("c".repeat(40), redeemedMonitor.planSha256);
    assert.notEqual(changedSha.id, redeemedMonitor.id);
    assert.equal(changedSha.status, "PENDING");
    const changedPlan = await retry(redeemedMonitor.targetSha, "d".repeat(64));
    assert.notEqual(changedPlan.id, redeemedMonitor.id);
    assert.equal(changedPlan.status, "PENDING");

    // Order-enabled operations can never republish a REDEEMED approval.
    const redeemedLive = await store.saveDeploymentApproval({
      ...record("live-redeemed"),
      operation: "V12_V4_LIVE",
      ordersEnabled: true,
      status: "REDEEMED",
      approvedAt: base,
      redeemedByRunId: "12345679",
      createdAt: base + 20_000,
      updatedAt: base,
    });
    const liveRetry = await store.createPendingDeploymentApproval({
      targetSha: redeemedLive.targetSha,
      planSha256: redeemedLive.planSha256,
      scope: redeemedLive.scope,
      operation: "V12_V4_LIVE",
      ordersEnabled: true,
      requestActor: "synthetic-test",
    });
    assert.notEqual(liveRetry.id, redeemedLive.id);
    assert.equal(liveRetry.status, "PENDING");

    // Do not silently extend monitor approval beyond the 24-hour retry window.
    const expiredMonitor = await store.saveDeploymentApproval({
      ...redeemedMonitor,
      id: "monitor-expired",
      approvedAt: base - 25 * 60 * 60_000,
      createdAt: base + 30_000,
      updatedAt: base,
    });
    const expiredRetry = await retry(expiredMonitor.targetSha, expiredMonitor.planSha256);
    assert.notEqual(expiredRetry.id, expiredMonitor.id);
    assert.equal(expiredRetry.status, "PENDING");

    await fs.writeFile(storePath, "{corrupt");
    await assert.rejects(store.saveDeploymentApproval(record("must-not-overwrite")));
    assert.equal(await fs.readFile(storePath, "utf8"), "{corrupt");
    await assert.rejects(store.getDeploymentApproval("id-0"));
    await fs.writeFile(storePath, JSON.stringify({ invalid: "not-an-array" }));
    await assert.rejects(store.saveDeploymentApproval(record("must-not-overwrite")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
