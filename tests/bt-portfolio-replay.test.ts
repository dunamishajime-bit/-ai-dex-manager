import assert from "node:assert/strict";
import { test } from "node:test";
import { computeBtGross, parseBtPortfolioRun, type BtSnapshot } from "../lib/bt-portfolio-replay";

const snapshot: BtSnapshot = {
  timestamp: "2026-01-01T00:00:00Z",
  balance: 10000, equity: 10000, realizedPnl: 0, unrealizedPnl: 0, btcPrice: 50000,
  positions: [
    { id: "btc", logic: "V4", symbol: "BTC", assetClass: "crypto", side: "LONG", quantity: 0.1, entryPrice: 49000, markPrice: 50000 },
    { id: "stock", logic: "V52", symbol: "AMZN", assetClass: "stock", side: "SHORT", quantity: 20, entryPrice: 95, markPrice: 100 },
  ],
  reservations: [{ id: "pending", logic: "Q102", symbol: "DOGE", assetClass: "crypto", side: "SHORT", reservedNotional: 1000 }],
};

test("Gross uses absolute notional divided by contemporaneous equity; no LONG/SHORT netting", () => {
  const g = computeBtGross(snapshot, { cryptoX: 3, stockX: 1.5, totalX: 3.5 });
  assert.equal(g.totalX, 0.8);
  assert.equal(g.cryptoX, 0.6);
  assert.equal(g.stockX, 0.2);
  assert.equal(g.lines.length, 3);
  assert.equal(g.lines[0].grossX, 0.5);
  assert.equal(g.lines[0].ofUsedPercent, 62.5);
  assert.ok(Math.abs(g.totalPercent - 100 * 0.8 / 3.5) < 1e-8);
  assert.equal(g.remainingTotalX, 2.7);
});

test("Gross recalculates against changing equity and marks every snapshot", () => {
  const small = { ...snapshot, equity: 4000 };
  const g = computeBtGross(small, { cryptoX: 3, stockX: 1.5, totalX: 3.5 });
  assert.equal(g.totalX, 2);
  assert.equal(g.remainingTotalX, 1.5);
  assert.equal(g.lines[0].ofUsedPercent, 62.5);
});

test("Invalid and overlapping data fail closed", () => {
  const limits = { cryptoX: 3, stockX: 1.5, totalX: 3.5 };
  assert.throws(() => computeBtGross({ ...snapshot, equity: 0 }, limits));
  assert.throws(() => computeBtGross({ ...snapshot, positions: [...snapshot.positions, snapshot.positions[0]] }, limits));
  assert.throws(() => computeBtGross({ ...snapshot, positions: [{ ...snapshot.positions[0], markPrice: Number.NaN }] }, limits));
  assert.throws(() => computeBtGross(snapshot, { ...limits, totalX: 0 }));
});

test("Replay imports require version, engine pins and ordered snapshots", () => {
  const run = {
    schemaVersion: "disdex.bt.portfolio.v1",
    runId: "test-1",
    mode: "REAL_BT",
    currency: "USDT",
    engineSha: "abc123",
    logicPins: { V4: "test-sha" },
    limits: { cryptoX: 3, stockX: 1.5, totalX: 3.5 },
    snapshots: [snapshot, { ...snapshot, timestamp: "2026-01-01T01:00:00Z" }],
  };
  assert.equal(parseBtPortfolioRun(run).runId, "test-1");
  assert.throws(() => parseBtPortfolioRun({ ...run, snapshots: [snapshot, snapshot] }));
  assert.throws(() => parseBtPortfolioRun({ ...run, logicPins: null }));
  assert.throws(() => parseBtPortfolioRun({ ...run, mode: "LIVE" }));
});
