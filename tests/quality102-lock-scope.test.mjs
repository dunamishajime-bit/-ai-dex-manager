import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const sourcePath = new URL("../lib/disdex-quality102-causal-v1-runner.ts", import.meta.url);

test("Q102 preloads idle-entry market history before taking the shared account lock", async () => {
  const source = await readFile(sourcePath, "utf8");
  const tick = source.slice(source.indexOf("async tick(): Promise<Quality102CausalV1TickResult>"));
  const preload = tick.indexOf("preloadedHistory = await this.dependencies.marketData.load()");
  const acquire = tick.indexOf("this.dependencies.lock.acquire");
  assert.ok(preload >= 0, "idle-entry history preload is missing");
  assert.ok(acquire >= 0, "account lock acquisition is missing");
  assert.ok(preload < acquire, "market history must be loaded before the shared lock for idle entries");
});