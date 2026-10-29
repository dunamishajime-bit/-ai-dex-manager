import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { AsterV3Client } from "../lib/aster-v3-client";
import { deferAsterGlobalRateBudget, reserveAsterGlobalRateSlot } from "../lib/disdex-aster-global-rate-budget";
import { nextAsterRateBudgetRetryMs } from "../lib/disdex-aster-rate-budget-policy";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { emptyIdleState, writeIdleState } from "../lib/idle-priority-short-state";
import { emptyIdleResidualLongState, writeIdleResidualLongState } from "../lib/idle-residual-long-state";
import { FileHypeZecLongRunnerStateStore } from "../lib/hype-zec-long-runner-state";

const SHA = "a".repeat(40);
const sourceByFile = Object.fromEntries([
  "lib/disdex-aster-global-rate-budget.ts",
  "lib/idle-priority-short-state.ts",
  "lib/idle-residual-long-state.ts",
  "lib/hype-zec-long-runner-state.ts",
].map((file) => [file, readFileSync(resolve(file), "utf8")])) as Record<string, string>;

test("shared writers use UUID-bearing exclusive temporary files", () => {
  for (const [file, source] of Object.entries(sourceByFile)) {
    assert.match(source, /randomUUID/, file);
    assert.match(source, /(?:flag:\s*["']wx["']|open\(temporary,\s*["']wx["'])/, file);
    assert.doesNotMatch(source, /\$\{(?:path|this\.path)\}\.\$\{process\.pid\}\.\$\{Date\.now\(\)\}\.tmp/, file);
  }
});

test("shared budget emits non-secret contention and cooldown diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-shared-diagnostics-"));
  const path = join(directory, "aster-rate-budget.json");
  const events: Array<Record<string, unknown>> = [];
  try {
    await deferAsterGlobalRateBudget({ path, cooldownMs: 1_000, status: 429, nowMs: 1_000, onDiagnostic: (event) => events.push(event) });
    await assert.rejects(
      reserveAsterGlobalRateSlot({ path, minIntervalMs: 50, maxQueueMs: 100, nowMs: 1_000, onDiagnostic: (event) => events.push(event) }),
      /ASTER_GLOBAL_RATE_BUDGET_SATURATED/,
    );
    assert.ok(events.some((event) => event.event === "COOLDOWN_PUBLISHED"));
    assert.ok(events.some((event) => event.event === "SLOT_DEFERRED"));
    for (const event of events) {
      assert.equal(event.schema, "disdex-aster-rate-budget-event/v1");
      assert.equal("signature" in event, false);
      assert.equal("apiKey" in event, false);
      assert.equal("orderPayload" in event, false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("eighty shared budget reservations serialize to distinct permits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-shared-budget-80-"));
  const path = join(directory, "aster-rate-budget.json");
  try {
    const results = await Promise.all(Array.from({ length: 80 }, () => reserveAsterGlobalRateSlot({
      path,
      minIntervalMs: 1,
      maxQueueMs: process.platform === "win32" ? 15_000 : 5_000,
      priority: "RISK_READ",
    })));
    assert.equal(new Set(results.map((result) => result.permitAt)).size, results.length);
    const parsed = JSON.parse(await readFile(path, "utf8"));
    assert.equal(parsed.schema, "disdex-aster-rate-budget/v1");
    assert.equal((await readdir(directory)).some((name) => name.endsWith(".tmp")), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("eighty state publications preserve parseable JSON and private file modes", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-state-80-"));
  const idlePath = join(directory, "idle", "state.json");
  const residualPath = join(directory, "residual", "state.json");
  const hypePath = join(directory, "hype", "runner.json");
  const fixedNow = 1_700_000_000_000;
  const originalNow = Date.now;
  Date.now = () => fixedNow;
  try {
    const idle = emptyIdleState(SHA, fixedNow);
    const residual = emptyIdleResidualLongState(SHA, fixedNow);
    const hype = new FileHypeZecLongRunnerStateStore(hypePath, SHA, "LIVE");
    const hypeState = { schema: "disdex-hype-zec-long/v1" as const, runtimeCommitSha: SHA, mode: "LIVE" as const, updatedAt: fixedNow, failures: [] };
    await Promise.all([
      ...Array.from({ length: 27 }, () => writeIdleState(idlePath, idle)),
      ...Array.from({ length: 27 }, () => writeIdleResidualLongState(residualPath, residual)),
      ...Array.from({ length: 26 }, () => hype.save(hypeState)),
    ]);
    assert.equal(JSON.parse(await readFile(idlePath, "utf8")).schema, "disdex-idle-priority-state/v2");
    assert.equal(JSON.parse(await readFile(residualPath, "utf8")).schema, "disdex-idle-residual-long-state/v1");
    assert.equal(JSON.parse(await readFile(hypePath, "utf8")).schema, "disdex-hype-zec-long/v1");
    for (const path of [idlePath, residualPath, hypePath]) {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      assert.equal((await readdir(join(path, ".."))).some((name) => name.endsWith(".tmp")), false);
    }
  } finally {
    Date.now = originalNow;
    await rm(directory, { recursive: true, force: true });
  }
});

test("read-only retry jitter is bounded and injectable", () => {
  assert.equal(nextAsterRateBudgetRetryMs(0, 100, 1_000, 0, () => 0), 50);
  assert.equal(nextAsterRateBudgetRetryMs(0, 100, 1_000, 0, () => 1), 100);
  assert.equal(nextAsterRateBudgetRetryMs(10, 100, 250, 0, () => 1), 250);
  assert.equal(nextAsterRateBudgetRetryMs(0, 100, 1_000, 350, () => 0), 350);
});

test("Aster client exposes an injectable read-only retry random source", () => {
  const source = readFileSync(resolve("lib/aster-v3-client.ts"), "utf8");
  assert.match(source, /readOnlyRateLimitRandom/);
  assert.match(source, /nextAsterRateBudgetRetryMs/);
  assert.match(source, /input\.orderMutation !== true/);
});

test("account lock preserves owner mismatch and exclusive temporary writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-account-lock-"));
  const path = join(directory, "account.lock");
  const events: Array<Record<string, unknown>> = [];
  try {
    const lock = new FileAccountOrderLock(path, 10_000, join(directory, "pending.json"), (event) => events.push(event));
    const handle = await lock.acquire("owner-a");
    assert.ok(handle);
    const other = await new FileAccountOrderLock(path, 10_000, join(directory, "pending.json"), (event) => events.push(event)).acquire("owner-b");
    assert.equal(other, null);
    const current = JSON.parse(await readFile(path, "utf8"));
    await import("node:fs/promises").then(({ writeFile }) => writeFile(path, JSON.stringify({ ...current, ownerId: "owner-b", leaseId: "other-lease" })));
    await handle.release();
    assert.equal(JSON.parse(await readFile(path, "utf8")).ownerId, "owner-b");
    assert.ok(events.some((event) => event.event === "CONTENDED" && event.ownerId === "owner-a" && event.contenderId === "owner-b"));
    assert.ok(events.some((event) => event.event === "RELEASE_SKIPPED_OWNER_MISMATCH"));
    for (const event of events) {
      assert.equal(event.schema, "disdex-account-lock-event/v1");
      assert.equal("leaseId" in event, false);
      assert.equal("apiKey" in event, false);
    }
    const accountLockSource = readFileSync(resolve("lib/disdex-account-order-lock.ts"), "utf8");
    assert.match(accountLockSource, /flag:\s*["']wx["']/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
