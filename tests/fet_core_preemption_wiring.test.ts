import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("FET Core preemption is wired through all four Core families", async () => {
  const [planner, v12, pengu, q102, v52, managed, wiring] = await Promise.all([
    readFile("lib/disdex-strict-portfolio-planner.ts", "utf8"),
    readFile("lib/v12-strict-live-adapter.ts", "utf8"),
    readFile("lib/pengu-dual-ls-v2-portfolio-runner.ts", "utf8"),
    readFile("lib/disdex-quality102-causal-v1-runner.ts", "utf8"),
    readFile("scripts/disdex_v52_aster_only_live_engine.py", "utf8"),
    readFile("lib/disdex-managed-protective-orders.ts", "utf8"),
    readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8"),
  ]);

  assert.match(planner, /function isCoreStrategy/);
  assert.match(planner, /strategy === "FET_RESIDUAL"/);
  assert.match(planner, /FET_RESIDUAL_MTM_SOURCE_UNVERIFIED/);
  const plannerPreempt = planner.indexOf('const currentFet = active.find((row) => row.strategy === "FET_RESIDUAL")');
  const plannerCapacity = planner.indexOf("const baseOtherTotalNotional", plannerPreempt);
  assert.ok(plannerPreempt >= 0 && plannerCapacity > plannerPreempt, "FET preemption must precede Core capacity allocation");

  for (const source of [v12, pengu, q102]) {
    assert.match(source, /reduceFetBrk48ForCoreConflict/);
    assert.match(source, /"FET_RESIDUAL"/);
  }
  for (const source of [v12, pengu]) {
    assert.match(source, /findManagedFetBrk48ProtectiveOrders/);
  }
  assert.match(managed, /export function findManagedFetBrk48ProtectiveOrders/);

  const fet = v52.indexOf("_prepare_fet_for_stock_entry");
  const open = v52.indexOf("def open_basis_position", fet);
  const callFet = v52.indexOf("self._prepare_fet_for_stock_entry", open);
  const callQ102 = v52.indexOf("self._prepare_quality102_for_stock_entry", open);
  const callV12 = v52.indexOf("self._prepare_v12_dynamic_for_stock_entry", open);
  assert.ok(fet >= 0 && callFet > open && callQ102 > callFet && callV12 > callQ102, "V52 must preempt FET before Q102/V12 residual preparation");
  assert.match(v52, /scripts\/disdex-fet-brk48-core-preempt\.ts/);

  assert.match(wiring, /FET_BRK48_CORE_PREEMPTION_READY=false/);
});

test("preemption implementations re-read live state before continuing Core entry", async () => {
  const [v12, pengu, q102] = await Promise.all([
    readFile("lib/v12-strict-live-adapter.ts", "utf8"),
    readFile("lib/pengu-dual-ls-v2-portfolio-runner.ts", "utf8"),
    readFile("lib/disdex-quality102-causal-v1-runner.ts", "utf8"),
  ]);
  assert.match(v12, /workingAccount, workingPositions.*getAccountSnapshot\(\).*getPositions\(\)/s);
  assert.match(pengu, /workingAccount, workingPositions.*getAccountSnapshot\(\).*getPositions\(\)/s);
  assert.match(q102, /freshAccount, freshPositions.*getAccountSnapshot\(\).*getPositions\(\)/s);
});
