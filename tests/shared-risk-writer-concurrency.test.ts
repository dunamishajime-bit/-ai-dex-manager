import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  buildSharedCryptoDailyRiskState,
  SHARED_CRYPTO_STRATEGIES,
  writeSharedCryptoDailyRisk,
} from "../lib/disdex-shared-crypto-daily-risk";

test("shared daily-risk writer uses UUID-bearing exclusive temporary files", () => {
  const source = readFileSync(resolve("lib/disdex-shared-crypto-daily-risk.ts"), "utf8");
  assert.match(source, /randomUUID/);
  assert.match(source, /flag:\s*["']wx["']/);
  assert.doesNotMatch(source, /\$\{process\.pid\}\.\$\{Date\.now\(\)\}\.tmp/);
});

test("eighty shared daily-risk publications remain parseable with no temp debris", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "disdex-shared-risk-80-"));
  const path = join(directory, "risk.json");
  const now = 1_800_000_000_000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const state = buildSharedCryptoDailyRiskState({
      accountScope: "ASTER_FUTURES",
      utcDay: "2027-01-15",
      strategyIds: [...SHARED_CRYPTO_STRATEGIES],
      lossPct: 0,
      maximumLossPct: 7.5,
      tripped: false,
      updatedAt: now,
      realizedPnl: 0,
      unrealizedPnl: 0,
      fees: 0,
      funding: 0,
      netDailyPnl: 0,
      referenceEquity: 100,
      sourceComplete: true,
    });
    await Promise.all(Array.from({ length: 80 }, () => writeSharedCryptoDailyRisk(path, state)));
    assert.equal(JSON.parse(await readFile(path, "utf8")).schema, "disdex-shared-crypto-daily-risk/v1");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await readdir(directory)).some((name) => name.endsWith(".tmp")), false);
  } finally {
    Date.now = originalNow;
    await rm(directory, { recursive: true, force: true });
  }
});
