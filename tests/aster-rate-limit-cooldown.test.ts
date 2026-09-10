import { strict as assert } from "node:assert";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AsterApiError, AsterV3Client } from "../lib/aster-v3-client";

test("HTTP 429 publishes a shared cooldown and is not retried locally", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-429-cooldown-"));
  const path = join(directory, "aster-rate-budget.json");
  const prior = process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH;
  process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH = path;
  process.env.DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS = "50";
  process.env.DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS = "5000";
  let calls = 0;
  try {
    const client = new AsterV3Client({ fetchImpl: async () => { calls += 1; return new Response('{"code":-1003,"msg":"Too many requests"}', { status: 429 }); }, readOnlyRateLimitMaxRetries: 3, readOnlyRateLimitBackoffBaseMs: 1, readOnlyRateLimitBackoffMaxMs: 1 });
    await assert.rejects(client.ping(), (e: unknown) => e instanceof AsterApiError && e.status === 429);
    assert.equal(calls, 1);
    const state = JSON.parse(await readFile(path, "utf8"));
    assert.equal(state.lastRateLimitStatus, 429);
    assert.ok(state.nextAllowedAt > Date.now() + 50_000);
  } finally {
    if (prior === undefined) delete process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH; else process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH = prior;
    await rm(directory, { recursive: true, force: true });
  }
});
