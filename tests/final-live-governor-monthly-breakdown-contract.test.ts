import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const payload = JSON.parse(
  readFileSync("docs/research-results/final-live-governor-monthly-breakdown-20260922.json", "utf8"),
)[0];

test("final monthly BT breakdown pins the selected final replay", () => {
  assert.equal(payload.NORMAL.asset, 1448665533.0239232);
  assert.equal(payload.NORMAL.pf, 4.14112335);
  assert.equal(payload.NORMAL.dd, -19.61179353);
  assert.equal(payload.SEVERE.asset, 75982803.52048858);
  assert.equal(payload.SEVERE.pf, 3.01497717);
  assert.equal(payload.SEVERE.dd, -19.97886021);
});

test("every monthly strategy decomposition reconciles exactly to trading PnL", () => {
  for (const scenario of ["NORMAL", "SEVERE"]) {
    assert.equal(payload[scenario].monthlyBreakdown.length, 13);
    for (const row of payload[scenario].monthlyBreakdown) {
      assert.ok(Math.abs(Number(row.reconciliationResidualJpy)) < 1e-5, `${scenario} ${row.month}`);
      const logic = row.logicPnlJpy;
      const sum = ["V12", "PENGU", "Q102", "FET", "V52", "OTHER"]
        .reduce((total, key) => total + Number(logic[key] || 0), 0);
      assert.ok(Math.abs(sum - Number(row.tradingPnlJpy)) < 1e-5, `${scenario} ${row.month}`);
    }
  }
});
