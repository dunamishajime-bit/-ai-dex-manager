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

    const first = await store.getDeploymentApproval("worker-0-0");
    const stale = await store.getDeploymentApproval("worker-0-0");
    assert.ok(first && stale);
    await store.saveDeploymentApproval({ ...first, status: "FAILED" });
    await assert.rejects(store.saveDeploymentApproval({ ...stale, status: "APPROVED" }), /STALE/);
    assert.equal((await store.getDeploymentApproval("worker-0-0"))?.status, "FAILED");

    const beforeAtomic = await store.getDeploymentApproval("worker-1-0");
    assert.ok(beforeAtomic);
    await store.mutateDeploymentApprovalAtomic("worker-1-0", (current) => {
      assert.ok(current);
      return { next: { ...current, status: "DISPATCHED" }, result: null };
    });
    await assert.rejects(store.saveDeploymentApproval({ ...beforeAtomic, status: "APPROVED" }), /STALE/);
    assert.equal((await store.getDeploymentApproval("worker-1-0"))?.status, "DISPATCHED");


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
