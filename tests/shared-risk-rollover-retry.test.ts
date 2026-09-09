import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildSharedCryptoDailyRiskState,
  readSharedCryptoDailyRiskWithRolloverRetry,
  writeSharedCryptoDailyRisk,
} from "@/lib/disdex-shared-crypto-daily-risk";

function state(utcDay: string, updatedAt: number) {
  return buildSharedCryptoDailyRiskState({
    accountScope: "ASTER_FUTURES",
    utcDay,
    strategyIds: ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "QUALITY102_CAUSAL_V1"],
    lossPct: 0,
    maximumLossPct: 5,
    tripped: false,
    updatedAt,
    realizedPnl: 0,
    unrealizedPnl: 0,
    fees: 0,
    funding: 0,
    netDailyPnl: 0,
    referenceEquity: 100,
    sourceComplete: true,
  });
}test("retries a prior-day shared-risk snapshot only during UTC rollover grace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "disdex-risk-rollover-"));
  const path = join(dir, "risk.json");
  const midnight = Date.UTC(2026, 8, 9);
  let now = midnight + 5_000;
  let sleeps = 0;
  try {
    await writeSharedCryptoDailyRisk(path, state("2026-09-08", midnight - 1_000));
    const result = await readSharedCryptoDailyRiskWithRolloverRetry(path, {
      now: () => now,
      sleep: async (ms) => {
        sleeps += 1;
        now += ms;
        await writeSharedCryptoDailyRisk(path, state("2026-09-09", now));
      },
      pollMs: 2_000,
      maxAttempts: 4,
      rolloverGraceMs: 10_000,
    });
    assert.equal(result.ok, true);
    assert.equal(sleeps, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});test("does not wait on DAY_MISMATCH outside the UTC rollover grace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "disdex-risk-no-retry-"));
  const path = join(dir, "risk.json");
  const midnight = Date.UTC(2026, 8, 9);
  let sleeps = 0;
  try {
    await writeSharedCryptoDailyRisk(path, state("2026-09-08", midnight - 1_000));
    const result = await readSharedCryptoDailyRiskWithRolloverRetry(path, {
      now: () => midnight + 30_000,
      sleep: async () => { sleeps += 1; },
      rolloverGraceMs: 10_000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "DAY_MISMATCH");
    assert.equal(sleeps, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
