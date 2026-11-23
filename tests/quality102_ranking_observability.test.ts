import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { Quality102Candle } from "../lib/disdex-quality102-causal-pipeline";
import type { Quality102CausalV4DecisionSnapshot } from "../lib/disdex-quality102-causal-v4-observability";
import { diagnoseQuality102CausalV4S34Symbol } from "../lib/disdex-quality102-causal-v4-ranking";
import { persistQuality102RankingHistory } from "../lib/disdex-quality102-ranking-history";

const HOUR = 3_600_000;
const ENTRY_TS = Date.UTC(2026, 8, 5, 13);

function flatRows(count = 400): Quality102Candle[] {
  const start = ENTRY_TS - count * HOUR;
  return Array.from({ length: count }, (_, i) => ({
    timestampMs: start + i * HOUR,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    quoteVolume: 1000,
    baseVolume: 100,
  }));
}

test("S34 ranking diagnostic reaches 100 only when the exact FET BRK route is signal-ready", () => {
  const rows = flatRows();
  for (let i = rows.length - 73; i < rows.length - 1; i += 1) {
    rows[i] = { ...rows[i], baseVolume: 100, high: 101, low: 99, close: 100 };
  }
  rows[rows.length - 25] = { ...rows[rows.length - 25], close: 100 };
  rows[rows.length - 1] = { ...rows[rows.length - 1], close: 104, high: 104, low: 100, baseVolume: 120 };

  const diagnostics = diagnoseQuality102CausalV4S34Symbol({
    symbol: "FETUSDT",
    rows,
    entryOpen: { timestampMs: ENTRY_TS, open: 120 },
  });
  const brk = diagnostics.find((row) => row.variant === "BRK24_H48_V1.2");
  assert.ok(brk);
  assert.equal(brk?.family, "BRK");
  assert.equal(brk?.gridOpen, true);
  assert.equal(brk?.rawDetected, true);
  assert.equal(brk?.rankingStage, "SIGNAL_READY");
  assert.equal(brk?.rankingScore, 100);
  assert.equal(brk?.gates.every((gate) => gate.pass), true);
  assert.equal(brk?.metrics.volumeRatio, 1.2);
});

test("S34 ranking records near-threshold BRK metrics without inventing a signal", () => {
  const rows = flatRows();
  for (let i = rows.length - 73; i < rows.length - 1; i += 1) {
    rows[i] = { ...rows[i], baseVolume: 100, high: 101, low: 99, close: 100 };
  }
  rows[rows.length - 1] = { ...rows[rows.length - 1], close: 100.9, high: 101, low: 99, baseVolume: 115 };

  const diagnostics = diagnoseQuality102CausalV4S34Symbol({
    symbol: "FETUSDT",
    rows,
    entryOpen: { timestampMs: ENTRY_TS, open: 110 },
  });
  const brk = diagnostics.find((row) => row.variant === "BRK24_H48_V1.2");
  assert.ok(brk);
  assert.equal(brk?.rawDetected, false);
  assert.equal(brk?.rankingStage, "NO_RAW");
  assert.ok((brk?.rankingScore ?? 0) > 40);
  assert.ok((brk?.rankingScore ?? 0) < 60);
  assert.equal(brk?.metrics.volumeRatio, 1.15);
  assert.equal(brk?.metrics.volumeThreshold, 1.2);
});

test("ranking history appends once per hourly reference timestamp", async () => {
  const root = await mkdtemp(join(tmpdir(), "q102-ranking-"));
  try {
    const snapshot: Quality102CausalV4DecisionSnapshot = {
      schemaVersion: 2,
      rankingModelVersion: "Q102_PROXIMITY_V1",
      strategyId: "QUALITY102_CAUSAL_V1",
      selectorMode: "CAUSAL_V4",
      runtimeCommitSha: "a".repeat(40),
      capturedAt: new Date(ENTRY_TS).toISOString(),
      decisionTs: ENTRY_TS,
      referenceTs: ENTRY_TS,
      selectedReason: "QUALITY102_CAUSAL_V4_NO_SIGNAL",
      items: [{
        symbol: "FETUSDT",
        eligible: false,
        side: "WAIT",
        requestedGross: 0,
        reason: "QUALITY102_CAUSAL_V4_NO_SIGNAL",
        selected: false,
        referenceTs: ENTRY_TS,
        rankingScore: 88.5,
        rankingRank: 1,
        rankingFamily: "BRK",
        rankingVariant: "BRK24_H48_V1.2",
        rankingStage: "FEATURE_PASS",
        rankingReason: "V4_IMPROVEMENT_PENDING",
      }],
    };
    const first = await persistQuality102RankingHistory({ stateRoot: root, snapshot });
    const second = await persistQuality102RankingHistory({ stateRoot: root, snapshot });
    assert.equal(first.appended, true);
    assert.equal(second.appended, false);
    const lines = (await readFile(first.path, "utf8")).trim().split(/\r?\n/);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).items[0].rankingScore, 88.5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
