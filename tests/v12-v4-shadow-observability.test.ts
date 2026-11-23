import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildV12V4ShadowSnapshot } from "../lib/v12-multilogic-v4-shadow";
import { loadV12V4ShadowObservability } from "../apps/production-ui/lib/server/v12-v4-shadow-observability";

test("HP reader loads frozen catalog plus shadow state and preserves zero mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "v12-v4-shadow-"));
  try {
    const statePath = join(root, "state.json");
    const snapshot = buildV12V4ShadowSnapshot({
      capturedAt: "2026-10-09T00:00:00.000Z",
      observations: [{
        symbol: "XRPUSDT",
        sourceSide: "SHORT",
        sourceSignalTs: Date.UTC(2026, 9, 9),
        age: 80,
        sret6: 0.002,
        ema12Dist: 0.2,
        btc6: 0.01,
        btc24: 0.01,
        rel12: 0.01,
        rel24: 0.01,
        break24Atr: -0.2,
        volRatio: 0.8,
        er24: 0.2,
        rangeLoc24: 0.5,
        pullback12Atr: 0.8,
        compression: 1,
        bodyAtr: 0.2,
        clv: 0.7,
      }],
    });
    await writeFile(statePath, JSON.stringify(snapshot), "utf8");

    const view = await loadV12V4ShadowObservability({ statePath, releaseRoot: process.cwd(), now: Date.UTC(2026, 9, 9) });
    assert.equal(view.orderEnabled, false);
    assert.equal(view.tradingMutation, 0);
    assert.equal(view.counts.realOrderEnabledV4, 0);
    assert.equal(view.routeCount, 41);
    assert.equal(view.routeCatalog.length, 41);
    assert.equal(view.stateAvailable, true);
    assert.ok(view.accepted.length > 0);
    assert.equal(view.aggregateBt.PRICE_MODEL_10BPS.trades, 1015);
    assert.equal(view.aggregateBt.PRICE_MODEL_30BPS.trades, 1012);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("HP reader remains read-only when shadow state is missing", async () => {
  const view = await loadV12V4ShadowObservability({
    statePath: join(tmpdir(), "definitely-missing-v12-v4-shadow-state.json"),
    releaseRoot: process.cwd(),
  });
  assert.equal(view.orderEnabled, false);
  assert.equal(view.tradingMutation, 0);
  assert.equal(view.counts.realOrderEnabledV4, 0);
  assert.equal(view.routeCount, 41);
  assert.equal(view.catalogAvailable, true);
  assert.equal(view.stateAvailable, false);
});
