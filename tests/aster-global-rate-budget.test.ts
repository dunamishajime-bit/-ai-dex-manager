import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { join, resolve } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
