import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  deferProductionUiAsterRateBudget,
  productionUiRateBudgetPath,
  waitForProductionUiAsterRateSlot,
} from "../lib/server/asterdex/rate-budget";

test("production UI uses the shared rate-budget path and writes a permit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-ui-rate-budget-"));
  const path = join(directory, "aster-rate-budget.json");
  const priorPath = process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH;
  const priorInterval = process.env.DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS;
  const priorQueue = process.env.DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS;
  process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH = path;
  process.env.DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS = "1";
  process.env.DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS = "100";
  try {
    assert.equal(productionUiRateBudgetPath(), path);
    await waitForProductionUiAsterRateSlot(5, "RISK_READ");
    const state = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    assert.equal(state.schema, "disdex-aster-rate-budget/v1");
    assert.equal(state.lastPriority, "RISK_READ");
  } finally {
    if (priorPath === undefined) delete process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH;
    else process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH = priorPath;
    if (priorInterval === undefined) delete process.env.DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS;
    else process.env.DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS = priorInterval;
    if (priorQueue === undefined) delete process.env.DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS;
    else process.env.DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS = priorQueue;
    await rm(directory, { recursive: true, force: true });
  }
});

test("UI 418/429 cooldown is persisted for trading peers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-ui-rate-budget-cooldown-"));
  const path = join(directory, "aster-rate-budget.json");
  const priorPath = process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH;
  process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH = path;
  try {
    const before = Date.now();
    await deferProductionUiAsterRateBudget(418, 1234);
    const state = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    assert.equal(state.schema, "disdex-aster-rate-budget/v1");
    assert.equal(state.lastRateLimitStatus, 418);
    assert.ok(Number(state.cooldownUntil) >= before + 1200);
  } finally {
    if (priorPath === undefined) delete process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH;
    else process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH = priorPath;
    await rm(directory, { recursive: true, force: true });
  }
});
