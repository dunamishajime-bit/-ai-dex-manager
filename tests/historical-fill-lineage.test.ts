import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  forcedExitCauseFromEvidence,
  loadFillLineageEvidence,
  routeFromFillEvidence,
} from "@/lib/server/fill-lineage-evidence";
import { loadLivePerformanceAnalytics } from "@/lib/server/live-performance-analytics";

test("historical Aster order read-back restores V12 Dynamic, PENGU Recovery V8 and FET lineage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "disdex-lineage-"));
  const spool = join(dir, "fills.jsonl");
  try {
    // Live spool can contain a generic record; audited historical route evidence must survive the merge.
    await writeFile(spool, JSON.stringify({
      strategyId: "V12_X1.00_ALL",
      eventType: "ENTRY_FILL",
      orderId: "1547929214",
      symbol: "LINKUSDT",
      reason: "V12_X1.00_ALL_ENTRY",
    }) + "\n", "utf8");

    const evidence = await loadFillLineageEvidence(spool);
    assert.equal(evidence.get("1547929214")?.strategyId, "V12_X1.00_ALL");
    assert.equal(routeFromFillEvidence(evidence.get("1547929214")), "Dynamic Residual");
    assert.equal(routeFromFillEvidence(evidence.get("1120664114")), "Recovery V8");
    assert.equal(evidence.get("543410575")?.strategyId, "FET_BRK48_RESIDUAL");
    assert.equal(forcedExitCauseFromEvidence(evidence.get("1547976000")), "RISK_FORCED_EXIT");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("LIVE performance uses audited order lineage without changing Aster PnL truth", async () => {
  const dir = await mkdtemp(join(tmpdir(), "disdex-live-lineage-"));
  const historyPath = join(dir, "history.json");
  const fillSpoolPath = join(dir, "fills.jsonl");
  const marginGuardPath = join(dir, "guard.json");

  try {
    await writeFile(historyPath, JSON.stringify({
      entries: [
        { id: "dynamic", orderId: "1548021388", symbol: "LINKUSDT", side: "BUY", realizedPnl: 0, commission: 0.01, time: 1789796868150 },
        { id: "recovery", orderId: "1120664114", symbol: "PENGUUSDT", side: "BUY", realizedPnl: 0, commission: 0.02, time: 1789690714800 },
        { id: "fet", orderId: "543410575", symbol: "FETUSDT", side: "BUY", realizedPnl: 1.25, commission: 0.03, time: 1790067625050 },
      ],
    }), "utf8");
    await writeFile(fillSpoolPath, "", "utf8");
    await writeFile(marginGuardPath, JSON.stringify({ totalMarginBalanceUsd: 100 }), "utf8");

    const result = await loadLivePerformanceAnalytics({ historyPath, fillSpoolPath, marginGuardPath });
    assert.equal(result.attribution.matched, 3);
    assert.equal(result.trades.find((row) => row.orderId === "1548021388")?.variant, "V12 別ルート / Dynamic Residual");
    assert.equal(result.trades.find((row) => row.orderId === "1120664114")?.variant, "PENGU Recovery V8");
    assert.equal(result.trades.find((row) => row.orderId === "543410575")?.logic, "FET");
    assert.equal(result.totals.realizedPnlUsd, 1.25);
    assert.equal(result.totals.commissionUsd, 0.06);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
