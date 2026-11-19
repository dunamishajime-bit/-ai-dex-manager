import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("approval inbox keeps expired and approved records out of pending", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "disdex-approval-history-test-"));
  const storePath = path.join(dir, "approvals.json");
  process.env.DISDEX_DEPLOY_APPROVAL_STORE_PATH = storePath;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const store = await import("../lib/server/deploy-approval-store");
  const now = Date.now();
  try {
    await store.saveDeploymentApproval({
      id: "expired-request",
      scope: "V12_V4",
      operation: "V12_V4_LIVE",
      ordersEnabled: true,
      targetSha: "a".repeat(40),
      planSha256: "b".repeat(64),
      requestActor: "dunamishajime-bit",
      createdAt: now - 120_000,
      requestExpiresAt: now - 60_000,
      updatedAt: now - 60_000,
      status: "PENDING",
    });
    await store.saveDeploymentApproval({
      id: "approved-request",
      scope: "V12_V4",
      operation: "V12_V4_LIVE",
      ordersEnabled: true,
      targetSha: "c".repeat(40),
      planSha256: "d".repeat(64),
      requestActor: "dunamishajime-bit",
      createdAt: now - 90_000,
      requestExpiresAt: now - 30_000,
      updatedAt: now - 20_000,
      status: "APPROVED",
      approvedAt: now - 50_000,
    });
    await store.saveDeploymentApproval({
      id: "active-request",
      scope: "V12_V4",
      operation: "V12_V4_LIVE",
      ordersEnabled: true,
      targetSha: "e".repeat(40),
      planSha256: "f".repeat(64),
      requestActor: "dunamishajime-bit",
      createdAt: now - 10_000,
      requestExpiresAt: now + 60_000,
      updatedAt: now - 10_000,
      status: "PENDING",
    });

    const inbox = await store.getDeploymentApprovalInbox(now);
    assert.deepEqual(inbox.pending.map((record) => record.id), ["active-request"]);
    assert.deepEqual(inbox.history.map((record) => record.id), ["approved-request", "expired-request"]);
    assert.equal(inbox.history[1]?.status, "EXPIRED");
    assert.equal(inbox.history[1]?.lastError, "request expired");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
