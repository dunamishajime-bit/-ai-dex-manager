import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveIntegratedGrossGovernor } from "../lib/disdex-integrated-gross-governor";
import {
  PENDING_EXPOSURE_MAX_AGE_MS,
  readPendingExposureRegistry,
  normalizePendingExposureRegistry,
} from "../lib/disdex-pending-exposure-registry";
import { buildSharedCryptoDailyRiskState } from "../lib/disdex-shared-crypto-daily-risk";
import type { PortfolioDdGovernorState } from "../lib/disdex-portfolio-dd-governor";
import { planStrictPortfolio } from "../lib/disdex-strict-portfolio-planner";

const NOW = Date.UTC(2026, 8, 22, 0, 0, 0);

function dd(twrIndex: number, currentDrawdownPct: number): PortfolioDdGovernorState {
  return {
    schema: "disdex-portfolio-dd-governor/v1",
    initializedAt: NOW - 3_600_000,
    updatedAt: NOW,
    baselineMode: "DEPLOYMENT_RESET",
    virtualEquityUsd: 100,
    twrIndex,
    twrPeak: twrIndex / (1 - currentDrawdownPct / 100),
    currentDrawdownPct,
    maximumDrawdownPct: currentDrawdownPct,
    lastProcessedTime: NOW,
    recentEventKeys: [],
    pendingCostsBySymbol: {},
    closedEvents: 10,
  };
}

function profitableRisk() {
  return buildSharedCryptoDailyRiskState({
    accountScope: "ASTER_FUTURES",
    utcDay: new Date(NOW).toISOString().slice(0, 10),
    strategyIds: ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "QUALITY102_CAUSAL_V1", "FET_BRK48_RESIDUAL"],
    lossPct: 0,
    maximumLossPct: 7.5,
    tripped: false,
    updatedAt: NOW,
    realizedPnl: 5,
    unrealizedPnl: 0,
    fees: 0,
    funding: 0,
    netDailyPnl: 5,
    referenceEquity: 100,
    sourceComplete: true,
  });
}

function pendingEntry(overrides: Record<string, unknown> = {}) {
  return {
    reservationId: "pending-1",
    strategyId: "V12_X1.00_ALL",
    sleeve: "CRYPTO",
    symbol: "DOGEUSDT",
    side: "LONG",
    gross: 0.25,
    notionalUsd: 25,
    status: "PENDING",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function pendingRegistry(entry: Record<string, unknown>) {
  return {
    schema: "disdex-pending-exposure/v1",
    accountScope: "ASTER_FUTURES",
    updatedAt: NOW,
    entries: [entry],
  };
}

test("formal production Gross caps do not expand from profit/DD evidence", () => {
  const result = resolveIntegratedGrossGovernor({
    now: NOW,
    equityUsd: 100,
    availableBalanceUsd: 100,
    currentCryptoGross: 0,
    currentTotalGross: 0,
    sharedDailyRisk: profitableRisk(),
    portfolioDdGovernor: dd(1.30, 0.5),
  });

  assert.equal(result.tier, "BASE");
  assert.equal(result.cryptoEntryCap, 3);
  assert.equal(result.totalEntryCap, 4.25);
  assert.equal(result.availableBalanceReservePct, 15);
  assert.equal(result.reason, "BASE_CAPS_DYNAMIC_GROSS_DISABLED");
});

test("explicit planner caps cannot re-enable research hard-cap Gross allocation", () => {
  const result = planStrictPortfolio({
    equity: 100,
    now: NOW,
    active: [],
    intents: [],
    entryGrossCaps: { cryptoGrossCap: 5, totalGrossCap: 8 },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "CRYPTO_ENTRY_GROSS_CAP_DYNAMIC_DISALLOWED");
});

test("pending exposure rejects missing, non-finite, and negative authority values", () => {
  assert.throws(() => normalizePendingExposureRegistry(pendingRegistry(pendingEntry({ gross: Number.NaN }))), /PENDING_EXPOSURE_GROSS_INVALID/);
  assert.throws(() => normalizePendingExposureRegistry(pendingRegistry(pendingEntry({ gross: Number.POSITIVE_INFINITY }))), /PENDING_EXPOSURE_GROSS_INVALID/);
  assert.throws(() => normalizePendingExposureRegistry(pendingRegistry(pendingEntry({ gross: -0.1 }))), /PENDING_EXPOSURE_GROSS_INVALID/);
  assert.throws(() => normalizePendingExposureRegistry(pendingRegistry(pendingEntry({ notionalUsd: Number.NaN }))), /PENDING_EXPOSURE_NOTIONAL_INVALID/);
  assert.throws(() => normalizePendingExposureRegistry(pendingRegistry(pendingEntry({ notionalUsd: Number.POSITIVE_INFINITY }))), /PENDING_EXPOSURE_NOTIONAL_INVALID/);
  const { notionalUsd: _missingNotional, ...missingNotional } = pendingEntry();
  assert.throws(() => normalizePendingExposureRegistry(pendingRegistry(missingNotional)), /PENDING_EXPOSURE_NOTIONAL_INVALID/);
});

test("stale or future active pending exposure fails closed before Gross aggregation", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-pending-stale-"));
  const path = join(root, "pending.json");
  try {
    await writeFile(path, JSON.stringify(pendingRegistry(pendingEntry({ updatedAt: Date.now() - PENDING_EXPOSURE_MAX_AGE_MS - 1 }))));
    await assert.rejects(readPendingExposureRegistry(path), /PENDING_EXPOSURE_STALE/);

    await writeFile(path, JSON.stringify(pendingRegistry(pendingEntry({ updatedAt: Date.now() + 60_000 }))));
    await assert.rejects(readPendingExposureRegistry(path), /PENDING_EXPOSURE_FUTURE/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pending publication uses an exclusive collision-resistant temporary inode", async () => {
  const source = await readFile(new URL("../lib/disdex-pending-exposure-registry.ts", import.meta.url), "utf8");
  assert.match(source, /randomUUID\(\)/);
  assert.match(source, /flag:\s*["']wx["']/);
});
