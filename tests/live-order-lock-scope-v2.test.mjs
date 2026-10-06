import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function source(relative) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("V12 preloads market data before taking the shared account lock", async () => {
  const text = await source("../lib/v12-live-execution-engine.ts");
  const tick = text.slice(text.indexOf("async tick(): Promise<V12LiveTickResult>"));
  const load = tick.indexOf("this.d.marketData.load()");
  const acquire = tick.indexOf("this.d.lock.acquire");
  assert.ok(load >= 0 && acquire >= 0 && load < acquire);
});

test("PENGU preloads H1 history before taking the shared account lock", async () => {
  const text = await source("../lib/pengu-dual-ls-v2-portfolio-runner.ts");
  const tick = text.slice(text.indexOf("async tick(): Promise<PenguDualLsV2TickResult>"));
  const load = tick.indexOf("this.dependencies.marketData.load()");
  const acquire = tick.indexOf("this.dependencies.lock.acquire");
  assert.ok(load >= 0 && acquire >= 0 && load < acquire);
});

test("V52 prepares session/reference data before taking the shared account lock", async () => {
  const text = await source("../scripts/disdex_v52_aster_only_legacy_engine.py");
  const run = text.slice(text.indexOf("    def run(self, daemon: bool) -> None:"));
  const prepare = run.indexOf("self.prepare_tick_inputs()");
  const acquire = run.indexOf("self.lock.acquire()");
  assert.ok(prepare >= 0 && acquire >= 0 && prepare < acquire);
});

test("V52 runs a fresh preorder Margin Guard before opening exposure", async () => {
  const text = await source("../scripts/disdex_v52_aster_only_live_engine.py");
  const open = text.slice(text.indexOf("    def open_basis_position"));
  const guard = open.indexOf("self.require_fresh_preorder_margin_guard()");
  const parentOpen = open.indexOf("super().open_basis_position");
  assert.ok(guard >= 0 && parentOpen >= 0 && guard < parentOpen);
});

test("HYPE preloads flat signal history before taking the shared account lock", async () => {
  const text = await source("../lib/hype-zec-long-runner.ts");
  const tick = text.slice(text.indexOf("async tick(): Promise<HypeZecLongTickResult>"));
  const preload = tick.indexOf("preloadedMarket = await this.dependencies.marketData.load()");
  const acquire = tick.indexOf("this.dependencies.lock.acquire");
  assert.ok(preload >= 0 && acquire >= 0 && preload < acquire);
});

test("FET classifies account lock contention as locked for the short daemon retry path", async () => {
  const runner = await source("../lib/fet-brk48-live-runner.ts");
  const script = await source("../scripts/disdex-fet-brk48-live-runner.ts");
  assert.match(runner, /status:\s*"locked",\s*message:\s*"FET_ACCOUNT_ORDER_LOCK_BUSY"/);
  assert.match(script, /nextAccountLockAwareWaitMs\(result\.status,\s*normalWaitMs,\s*lockRetryMs\)/);
  assert.match(script, /FET_BRK48_LOCK_RETRY_MS/);
});
