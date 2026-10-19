import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadLivePerformanceAnalytics } from "@/lib/server/live-performance-analytics";

test("live performance joins Aster official trades to production fill metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "disdex-live-performance-"));
  const historyPath = join(dir, "history.json");
  const fillSpoolPath = join(dir, "fills.jsonl");
  const marginGuardPath = join(dir, "guard.json");
  const equityHistoryPath = join(dir, "equity.json");

  try {
    await writeFile(historyPath, JSON.stringify({
      generatedAt: "2026-09-22T00:10:00.000Z",
      entries: [
        { id: "1", orderId: "101", symbol: "DOGEUSDT", side: "BUY", realizedPnl: 0, commission: 0.1, time: Date.parse("2026-09-22T00:01:00.000Z") },
        { id: "2", orderId: "102", symbol: "DOGEUSDT", side: "SELL", realizedPnl: 2, commission: 0.1, time: Date.parse("2026-09-22T00:02:00.000Z") },
        { id: "3", orderId: "103", symbol: "PENGUUSDT", side: "BUY", realizedPnl: -1, commission: 0.05, time: Date.parse("2026-09-22T00:03:00.000Z") },
      ],
    }), "utf8");

    await writeFile(fillSpoolPath, [
      JSON.stringify({ strategyId: "V12_X1.00_ALL", eventType: "ENTRY_FILL", orderId: "101", symbol: "DOGEUSDT", clientOrderId: "v12-entry-a", reason: "V12_X1.00_ALL_ENTRY" }),
      JSON.stringify({ strategyId: "V12_X1.00_ALL", eventType: "EXIT_FILL", orderId: "102", symbol: "DOGEUSDT", clientOrderId: "v12-stop-b", reason: "V12_PROTECTION_FILL_RECONCILED" }),
      JSON.stringify({ strategyId: "PENGU_DUAL_LS_V2_FINAL", eventType: "EXIT_FILL", orderId: "103", symbol: "PENGUUSDT", clientOrderId: "pengu-c", reason: "exit entryVersion=SHORT_V20" }),
    ].join("\n") + "\n", "utf8");

    await writeFile(marginGuardPath, JSON.stringify({
      checkedAt: Date.parse("2026-09-22T00:10:00.000Z"),
      totalMarginBalanceUsd: 100,
      availableBalanceUsd: 90,
    }), "utf8");

    const result = await loadLivePerformanceAnalytics({
      historyPath,
      fillSpoolPath,
      marginGuardPath,
      equityHistoryPath,
    });

    assert.equal(result.attribution.matched, 3);
    assert.equal(result.attribution.total, 3);
    assert.equal(result.attribution.coveragePct, 100);
    assert.equal(result.balance.currentAssetUsd, 100);
    assert.equal(result.balance.source, "MARGIN_GUARD");
    assert.equal(result.totals.realizedPnlUsd, 1);
    assert.equal(result.totals.commissionUsd, 0.25);
    assert.equal(result.totals.netPnlUsd, 0.75);
    assert.equal(result.assetSeriesBasis, "RECONSTRUCTED_REALIZED_WALLET");
    assert.ok(Math.abs(Number(result.assetSeries.at(-1)?.assetUsd) - 100) < 1e-9);
    assert.equal(result.coverage.source, "LOCAL_FALLBACK");
    assert.equal(result.coverage.status, "PARTIAL");
    assert.equal(result.coverage.totalFills, result.trades.length);

    const v12 = result.logicSummaries.find((row) => row.logic === "V12");
    const pengu = result.logicSummaries.find((row) => row.logic === "PENGU");
    assert.ok(Math.abs(Number(v12?.netPnlUsd) - 1.8) < 1e-9);
    assert.ok(Math.abs(Number(pengu?.netPnlUsd) + 1.05) < 1e-9);
    assert.equal(result.trades.find((row) => row.logic === "PENGU")?.variant, "PENGU Short V20");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("performance summaries include IDLE and retain the same normalized fill set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "disdex-live-performance-idle-"));
  const historyPath = join(dir, "history.json");
  const marginGuardPath = join(dir, "guard.json");
  try {
    await writeFile(historyPath, JSON.stringify({
      entries: [{
        id: "idle-1",
        orderId: "idle-order-1",
        symbol: "DOTUSDT",
        side: "SELL",
        realizedPnl: 1.5,
        commission: 0.02,
        time: 1000,
        strategyId: "IDLE",
      }],
    }), "utf8");
    await writeFile(marginGuardPath, JSON.stringify({ totalMarginBalanceUsd: 50 }), "utf8");
    const result = await loadLivePerformanceAnalytics({ historyPath, marginGuardPath });
    assert.equal(result.trades.length, 1);
    assert.equal(result.logicSummaries.find((row) => row.logic === "IDLE")?.fillCount, 1);
    assert.equal(result.monthly.reduce((sum, row) => sum + Object.values(row.byLogic).reduce((inner, value) => inner + value, 0), 0), 1.48);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unmatched official Aster fills remain explicitly unattributed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "disdex-live-performance-unattributed-"));
  const historyPath = join(dir, "history.json");
  const fillSpoolPath = join(dir, "fills.jsonl");
  const marginGuardPath = join(dir, "guard.json");

  try {
    await writeFile(historyPath, JSON.stringify({
      entries: [{ id: "x", orderId: "999", symbol: "XRPUSDT", side: "SELL", realizedPnl: 1.2, commission: 0.02, time: 1000 }],
    }), "utf8");
    await writeFile(fillSpoolPath, "", "utf8");
    await writeFile(marginGuardPath, JSON.stringify({ totalMarginBalanceUsd: 50 }), "utf8");

    const result = await loadLivePerformanceAnalytics({ historyPath, fillSpoolPath, marginGuardPath });
    assert.equal(result.attribution.coveragePct, 0);
    assert.equal(result.trades[0]?.logic, "UNATTRIBUTED");
    assert.equal(result.logicSummaries.find((row) => row.logic === "UNATTRIBUTED")?.netPnlUsd, 1.18);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
