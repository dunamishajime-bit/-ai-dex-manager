import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { join, resolve } from "node:path";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { deferAsterGlobalRateBudget, reserveAsterGlobalRateSlot } from "../lib/disdex-aster-global-rate-budget";

test("shared Aster rate budget module exists", () => {
  assert.equal(existsSync(resolve("lib/disdex-aster-global-rate-budget.ts")), true);
});

test("shared Aster rate budget exposes a slot reservation API", () => {
  const source = readFileSync(resolve("lib/disdex-aster-global-rate-budget.ts"), "utf8");
  assert.match(source, /export async function reserveAsterGlobalRateSlot/);
});

test("shared Aster rate budget serializes permits in the Python-compatible JSON format", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-aster-budget-"));
  const path = join(directory, "aster-rate-budget.json");
  try {
    const first = await reserveAsterGlobalRateSlot({ path, minIntervalMs: 20, maxQueueMs: 1000, nowMs: 1_000 });
    const second = await reserveAsterGlobalRateSlot({ path, minIntervalMs: 20, maxQueueMs: 1000, nowMs: 1_000 });
    assert.equal(first.permitAt, 1_000);
    assert.equal(second.permitAt, 1_020);
    const state = JSON.parse(await readFile(path, "utf8"));
    assert.equal(state.schema, "disdex-aster-rate-budget/v1");
    assert.equal(state.nextAllowedAt, 1_040);
    if (process.platform !== "win32") {
      assert.equal((await stat(path)).mode & 0o777, 0o660, "all daemon users must retain shared budget write access");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared Aster rate budget charges request weight, not HTTP count", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-aster-budget-weight-"));
  const path = join(directory, "aster-rate-budget.json");
  try {
    const first = await reserveAsterGlobalRateSlot({ path, minIntervalMs: 20, maxQueueMs: 1000, nowMs: 1_000, weight: 1 });
    const second = await reserveAsterGlobalRateSlot({ path, minIntervalMs: 20, maxQueueMs: 1000, nowMs: 1_000, weight: 5 });
    assert.equal(first.nextAllowedAt, 1_020);
    assert.equal(second.permitAt, 1_020);
    assert.equal(second.nextAllowedAt, 1_120);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("AsterV3Client routes every request attempt through the shared global rate budget", () => {
  const source = readFileSync(resolve("lib/aster-v3-client.ts"), "utf8");
  assert.match(source, /waitForAsterGlobalRateSlot/);
  const requestBody = source.split("private async request<T>", 2)[1] || "";
  assert.match(requestBody, /await waitForAsterGlobalRateSlot\(asterFuturesRequestWeight\(method, input\.path, params\)\)/);
});

test("shared budget rejects a non-empty document without the canonical schema", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-aster-budget-malformed-"));
  const path = join(directory, "aster-rate-budget.json");
  try {
    await import("node:fs/promises").then(({ writeFile }) => writeFile(path, '{"nextAllowedAt":1000}\n', "utf8"));
    await assert.rejects(
      reserveAsterGlobalRateSlot({ path, minIntervalMs: 20, maxQueueMs: 1000, nowMs: 1_000 }),
      /ASTER_GLOBAL_RATE_BUDGET_MALFORMED/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared budget rejects non-finite configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-aster-budget-config-"));
  const path = join(directory, "aster-rate-budget.json");
  try {
    await assert.rejects(
      reserveAsterGlobalRateSlot({ path, minIntervalMs: Number.NaN, maxQueueMs: 1000 }),
      /ASTER_GLOBAL_RATE_BUDGET_CONFIG_INVALID/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("shared budget publishes state with atomic rename", () => {
  const source = readFileSync(resolve("lib/disdex-aster-global-rate-budget.ts"), "utf8");
  assert.match(source, /rename\(temporary, path\)/);
  assert.doesNotMatch(source, /writeFile\(path, `\$\{JSON\.stringify\(state/);
});

test("shared budget never evicts an old lock owned by a live process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-aster-budget-live-lock-"));
  const path = join(directory, "aster-rate-budget.json");
  const lockPath = `${path}.lock`;
  try {
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({
      schema: "disdex-aster-rate-budget-lock/v1",
      pid: process.pid,
      createdAt: Date.now() - 30_000,
      token: "live-owner",
    }));
    const old = new Date(Date.now() - 30_000);
    await utimes(lockPath, old, old);
    await assert.rejects(
      reserveAsterGlobalRateSlot({ path, minIntervalMs: 20, maxQueueMs: 20, nowMs: 1_000 }),
      /ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT/,
    );
    assert.equal((await readFile(join(lockPath, "owner.json"), "utf8")).includes("live-owner"), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("shared budget survives concurrent stale ownerless lock recovery without duplicate permits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-aster-budget-race-"));
  const path = join(directory, "aster-rate-budget.json");
  const lockPath = `${path}.lock`;
  try {
    await mkdir(lockPath);
    const old = new Date(Date.now() - 30_000);
    await utimes(lockPath, old, old);
    const queueMs = process.platform === "win32" ? 15_000 : 5_000;
    const results = await Promise.allSettled(Array.from({ length: 48 }, () =>
      reserveAsterGlobalRateSlot({ path, minIntervalMs: 2, maxQueueMs: queueMs })));
    const rejected = results.filter((result) => result.status === "rejected");
    assert.deepEqual(rejected, []);
    const permits = results.map((result) => result.status === "fulfilled" ? result.value.permitAt : -1);
    assert.equal(new Set(permits).size, permits.length, "every reservation must receive a distinct serialized permit");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared budget detects PID reuse using Linux process start ticks", { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-aster-budget-pid-reuse-"));
  const path = join(directory, "aster-rate-budget.json");
  const lockPath = `${path}.lock`;
  try {
    const raw = await readFile(`/proc/${process.pid}/stat`, "utf8");
    const fields = raw.slice(raw.lastIndexOf(")") + 1).trim().split(/\s+/);
    const currentStartTicks = fields[19];
    assert.ok(currentStartTicks && /^\d+$/.test(currentStartTicks));
    await mkdir(lockPath);
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({
      schema: "disdex-aster-rate-budget-lock/v1",
      pid: process.pid,
      createdAt: Date.now(),
      token: "reused-pid-owner",
      processStartTicks: String(BigInt(currentStartTicks) + 1n),
    }));
    const result = await reserveAsterGlobalRateSlot({ path, minIntervalMs: 2, maxQueueMs: 1_000 });
    assert.ok(result.nextAllowedAt > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared budget reclaims a stale ownerless recovery mutex after a crashed recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-aster-budget-stale-recovery-"));
  const path = join(directory, "aster-rate-budget.json");
  const lockPath = `${path}.lock`;
  const recoveryPath = `${lockPath}.recovery`;
  try {
    await mkdir(lockPath);
    await mkdir(recoveryPath);
    const old = new Date(Date.now() - 30_000);
    await utimes(lockPath, old, old);
    await utimes(recoveryPath, old, old);
    const result = await reserveAsterGlobalRateSlot({ path, minIntervalMs: 2, maxQueueMs: 1_000 });
    assert.ok(result.nextAllowedAt > 0);
    assert.equal(existsSync(recoveryPath), false, "recovery mutex must be released after successful reservation");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared budget never evicts a recovery mutex owned by a live process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-aster-budget-live-recovery-"));
  const path = join(directory, "aster-rate-budget.json");
  const lockPath = `${path}.lock`;
  const recoveryPath = `${lockPath}.recovery`;
  try {
    await mkdir(lockPath);
    await mkdir(recoveryPath);
    await writeFile(join(recoveryPath, "owner.json"), JSON.stringify({
      schema: "disdex-aster-rate-budget-lock/v1",
      pid: process.pid,
      createdAt: Date.now() - 30_000,
      token: "live-recovery-owner",
    }));
    const old = new Date(Date.now() - 30_000);
    await utimes(lockPath, old, old);
    await utimes(recoveryPath, old, old);
    await assert.rejects(
      reserveAsterGlobalRateSlot({ path, minIntervalMs: 2, maxQueueMs: 20 }),
      /ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT/,
    );
    assert.equal((await readFile(join(recoveryPath, "owner.json"), "utf8")).includes("live-recovery-owner"), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared Aster budget propagates venue cooldown across daemons", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-aster-budget-cooldown-"));
  const path = join(directory, "aster-rate-budget.json");
  try {
    await deferAsterGlobalRateBudget({ path, cooldownMs: 60_000, status: 429, nowMs: 1_000 });
    const state = JSON.parse(await readFile(path, "utf8"));
    assert.equal(state.nextAllowedAt, 61_000);
    assert.equal(state.lastRateLimitStatus, 429);
    await assert.rejects(reserveAsterGlobalRateSlot({ path, minIntervalMs: 50, maxQueueMs: 5_000, nowMs: 1_000 }), /ASTER_GLOBAL_RATE_BUDGET_SATURATED/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
