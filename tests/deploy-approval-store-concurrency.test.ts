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
    // 16 workers x 5 writes = 80 concurrent writes. The store intentionally
    // retains only the newest 50 records; all retained records must be unique
    // and the JSON must remain valid after the 80-write contention burst.
    assert.equal(saved.length, 50);
    assert.equal(new Set(saved.map((row: { id: string }) => row.id)).size, 50);

    const fresh = await store.saveDeploymentApproval(record("cas-target"));
    const stale = await store.getDeploymentApproval("cas-target");
    assert.ok(fresh && stale);
    await store.saveDeploymentApproval({ ...fresh, status: "FAILED" });
    await assert.rejects(store.saveDeploymentApproval({ ...stale, status: "APPROVED" }), /STALE/);
    assert.equal((await store.getDeploymentApproval("cas-target"))?.status, "FAILED");

    const atomicSeed = await store.saveDeploymentApproval(record("atomic-target"));
    const beforeAtomic = await store.getDeploymentApproval("atomic-target");
    assert.ok(atomicSeed && beforeAtomic);
    await store.mutateDeploymentApprovalAtomic("atomic-target", (current) => {
      assert.ok(current);
      return { next: { ...current, status: "DISPATCHED" }, result: null };
    });
    await assert.rejects(store.saveDeploymentApproval({ ...beforeAtomic, status: "APPROVED" }), /STALE/);
    assert.equal((await store.getDeploymentApproval("atomic-target"))?.status, "DISPATCHED");

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


test("approval request workflows never write the approval JSON store directly", async () => {
  const workflows = [
    ".github/workflows/disdex-v4-hp-approval-request.yml",
    ".github/workflows/disdex-v4-doge-missed-time-exit-approval-request.yml",
  ];
  for (const workflow of workflows) {
    const source = await fs.readFile(workflow, "utf8");
    assert.doesNotMatch(source, /deploy-approvals\.json/);
    assert.doesNotMatch(source, /json\.dump\s*\(\s*records/);
    assert.doesNotMatch(source, /os\.replace\s*\(\s*tmp_name\s*,\s*path\s*\)/);
    assert.match(source, /disdex_deployment_approval_store\.py/);
  }
});
