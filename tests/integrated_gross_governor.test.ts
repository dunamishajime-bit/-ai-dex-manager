import assert from "node:assert/strict";
import test from "node:test";

import { resolveIntegratedGrossGovernor } from "../lib/disdex-integrated-gross-governor";
import { INTEGRATED_PRODUCTION_RISK_POLICY } from "../config/integratedProductionRiskPolicy";
import type { PortfolioDdGovernorState } from "../lib/disdex-portfolio-dd-governor";
import { buildSharedCryptoDailyRiskState } from "../lib/disdex-shared-crypto-daily-risk";

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
function risk(netDailyPnl: number) {
  return buildSharedCryptoDailyRiskState({
    accountScope: "ASTER_FUTURES",
    utcDay: new Date(NOW).toISOString().slice(0, 10),
    strategyIds: ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "QUALITY102_CAUSAL_V1", "FET_BRK48_RESIDUAL"],
    lossPct: Math.min(0, netDailyPnl),
    maximumLossPct: 7.5,
    tripped: false,
    updatedAt: NOW,
    realizedPnl: netDailyPnl,
    unrealizedPnl: 0,
    fees: 0,
    funding: 0,
    netDailyPnl,
    referenceEquity: 100,
    sourceComplete: true,
  });
}

test("missing profit/DD evidence fail-closes to normal entry caps", () => {
  const out = resolveIntegratedGrossGovernor({
    now: NOW,
    equityUsd: 100,
    currentCryptoGross: 0,
    currentTotalGross: 0,
  });
  assert.equal(out.tier, "BASE");
  assert.equal(out.cryptoEntryCap, 3);
  assert.equal(out.totalEntryCap, 4.25);
  assert.equal(out.cryptoHardCap, 5);
  assert.equal(out.totalHardCap, 8);
});
test("profit tier expands only with fresh profit/DD evidence", () => {
  const out = resolveIntegratedGrossGovernor({
    now: NOW,
    equityUsd: 100,
    availableBalanceUsd: 100,
    currentCryptoGross: 0,
    currentTotalGross: 0,
    sharedDailyRisk: risk(2),
    portfolioDdGovernor: dd(1.10, 2),
  });
  assert.equal(out.tier, "PROFIT_2");
  assert.equal(out.cryptoEntryCap, 3.5);
  assert.equal(out.totalEntryCap, 4.5);
  assert.equal(out.availableBalanceReservePct, 10);
});

test("5x Cross margin capacity prevents an 8x hard ceiling from becoming 8x exposure", () => {
  const out = resolveIntegratedGrossGovernor({
    now: NOW,
    equityUsd: 100,
    availableBalanceUsd: 100,
    currentCryptoGross: 0,
    currentTotalGross: 0,
    sharedDailyRisk: risk(5),
    portfolioDdGovernor: dd(1.30, 0.5),
  });
  assert.equal(out.tier, "PROFIT_4");
  assert.equal(out.cryptoEntryCap, 5);
  assert.equal(out.totalEntryCap, 5);
  assert.equal(out.totalHardCap, 8);
});
test("existing exposure above a reduced effective cap is preserved, not force-trimmed", () => {
  const out = resolveIntegratedGrossGovernor({
    now: NOW,
    equityUsd: 100,
    availableBalanceUsd: 8,
    currentCryptoGross: 3.4,
    currentTotalGross: 4.6,
  });
  assert.equal(out.tier, "BASE");
  assert.equal(out.cryptoEntryCap, 3.4);
  assert.equal(out.totalEntryCap, 4.6);
});

test("final integrated production constants stay pinned", () => {
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.v12BaseAggregateGross, 2);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.penguMaximumGross, 0.85);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.fetResidualMaximumGross, 2.25);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.q102CausalV4MaximumGross, 3);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap, 3);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossHardCap, 5);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.stockGrossCap, 4);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.stockSlotGrossCap, 2);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap, 4.25);
  assert.equal(INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossHardCap, 8);
});
