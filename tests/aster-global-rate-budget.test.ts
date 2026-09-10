import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { join, resolve } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { reserveAsterGlobalRateSlot } from "../lib/disdex-aster-global-rate-budget";

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

test("AsterV3Client routes every request attempt through the shared global rate budget", () => {
  const source = readFileSync(resolve("lib/aster-v3-client.ts"), "utf8");
  assert.match(source, /waitForAsterGlobalRateSlot/);
  const requestBody = source.split("private async request<T>", 2)[1] || "";
  assert.match(requestBody, /await waitForAsterGlobalRateSlot\(\)/);
});
