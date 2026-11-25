import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  H48_FROZEN_THRESHOLDS, H48_RESEARCH_GRID_MS, H48_RESEARCH_HOUR_MS,
  H48_RESEARCH_PROVENANCE, evaluateH48R4WsigEntry,
  type H48ClosedHour,
} from "../lib/hype-h48-research-entry";
import { evaluateHypeH48TimeOnlyExit } from "../lib/hype-stable4-time-only-contract";

const SHA = "4786f600ae7bf86ffca948f1412956a9113cb20d";
const E = Date.UTC(2026, 10, 24, 0); // 6h grid / no local timezone
const H = H48_RESEARCH_HOUR_MS;
function fixture() {
  const t = E - H;
  const hypeClosed: H48ClosedHour[] = Array.from({ length: 25 }, (_, index) => ({
    openTs: t - (24 - index) * H,
    close: index <= 12 ? 100 + index * 0.25 : 103,
  }));
  const btcClosed: H48ClosedHour[] = Array.from({ length: 25 }, (_, index) => ({
    openTs: t - (24 - index) * H,
    close: 100 + index * (2 / 24),
  }));
  return {
    runtimeSha: SHA, now: E + 30000,
    entry: { openTs: E, open: 112, observedAt: E + 15000 },
    hypeClosed, btcClosed, existingHypePosition: false,
  };
}

test("H48 frozen PRE-only research rule uses only previous CLOSED H1 candles", () => {
  const out = evaluateH48R4WsigEntry(fixture());
  assert.equal(out.status, "CANDIDATE");
  if (out.status !== "CANDIDATE") return;
  assert.equal(out.route, "HYPE_REDESIGN_CAUSAL_H48R4_WSIG");
  assert.equal(out.signalTs, E - H);
  assert.equal(out.logicalEntryTs, E);
  assert.equal(out.logicalExitTs, E + 48 * H);
  assert.equal(out.entryReferenceOpen, 112);
  assert.ok(Math.abs(out.hype12) < 1e-12);
  assert.ok(Math.abs(out.hype24 - 0.03) < 1e-12);
  assert.ok(Math.abs(out.relative24 - 0.01) < 1e-12);
  assert.equal(out.contract.kind, "H48_TIME_ONLY");
  assert.equal(out.contract.route, out.route);
});

test("H48 rejects 12h HYPE, 24h HYPE and relative24 rule independently", () => {
  const a = fixture();
  const hype12 = a.hypeClosed.map(x => ({ ...x }));
  hype12[hype12.length - 1].close = 104; // 1h lookback signal fails 12h bound
  assert.deepEqual(evaluateH48R4WsigEntry({ ...a, hypeClosed: hype12 }), { status: "NO_SIGNAL", reason: "HYPE_12H" });
  const hype24 = a.hypeClosed.map(x => ({ ...x }));
  hype24[0].close = 102.8;
  assert.deepEqual(evaluateH48R4WsigEntry({ ...a, hypeClosed: hype24 }), { status: "NO_SIGNAL", reason: "HYPE_24H" });
  const btc = a.btcClosed.map(x => ({ ...x }));
  btc[btc.length - 1].close = 98;
  assert.deepEqual(evaluateH48R4WsigEntry({ ...a, btcClosed: btc }), { status: "NO_SIGNAL", reason: "RELATIVE_24H" });
});

test("H48 rejects incomplete, duplicate, future and non-hourly candles", () => {
  const a = fixture();
  for (const hypeClosed of [
    a.hypeClosed.slice(1),
    a.hypeClosed.map((x, i) => i === 5 ? { ...x, openTs: a.hypeClosed[4].openTs } : x),
    a.hypeClosed.map((x, i) => i === 5 ? { ...x, openTs: x.openTs + 500 } : x),
    a.hypeClosed.map((x, i) => i === 5 ? { ...x, close: NaN } : x),
    [...a.hypeClosed.slice(1), { openTs: E, close: 5000 }],
  ]) {
    assert.throws(() => evaluateH48R4WsigEntry({ ...a, hypeClosed }), /HYPE_H48_RESEARCH_ENTRY_INVALID/);
  }
});

test("H48 refuses non-6h grid, late open, unknown venue open, wrong SHA or overlap", () => {
  const a = fixture();
  assert.equal(E % H48_RESEARCH_GRID_MS, 0);
  for (const input of [
    { ...a, entry: { ...a.entry, openTs: E + H } },
    { ...a, now: E + 180000 },
    { ...a, entry: { ...a.entry, observedAt: E - 1 } },
    { ...a, entry: { ...a.entry, open: 0 } },
    { ...a, runtimeSha: "bad" },
    { ...a, existingHypePosition: true },
  ]) assert.throws(() => evaluateH48R4WsigEntry(input), /HYPE_H48_RESEARCH_ENTRY_INVALID/);
});

test("certified 48h exit is not eligible early and requires verified EXACT next-hour open", () => {
  const x = evaluateH48R4WsigEntry(fixture());
  assert.equal(x.status, "CANDIDATE");
  if (x.status !== "CANDIDATE") return;
  const exitTs = E + 48 * H;
  assert.deepEqual(evaluateHypeH48TimeOnlyExit(x.contract, exitTs - 1), { due: false });
  assert.throws(() => evaluateHypeH48TimeOnlyExit(x.contract, exitTs), /HYPE_H48_BOUNDARY_OPEN_UNVERIFIED/);
  assert.throws(() => evaluateHypeH48TimeOnlyExit(x.contract, exitTs + 1000, {
    openTs: exitTs - H, open: 130, observedAt: exitTs,
  }), /HYPE_H48_BOUNDARY_OPEN_UNVERIFIED/);
  assert.deepEqual(evaluateHypeH48TimeOnlyExit(x.contract, exitTs + 30000, {
    openTs: exitTs, open: 130, observedAt: exitTs + 20000,
  }), { due: true, reason: "HYPE_REDESIGN_TIME48_NEXTOPEN", logicalExitTs: exitTs, referenceOpen: 130 });
});

test("H48 research limitations are explicit and thresholds are frozen", () => {
  assert.equal(H48_RESEARCH_PROVENANCE.target30Count, 27);
  assert.equal(H48_RESEARCH_PROVENANCE.forward30Count, 2);
  assert.equal(H48_RESEARCH_PROVENANCE.forward30WinRate, 0.5);
  assert.ok(H48_RESEARCH_PROVENANCE.forward30Mean < 0);
  assert.equal(H48_FROZEN_THRESHOLDS.hype12Max, 0.004297852251518686);
  assert.equal(H48_FROZEN_THRESHOLDS.hype24Min, 0.02047426596091347);
  assert.equal(H48_FROZEN_THRESHOLDS.relative24Max, 0.026202553353817715);
});

test("29 genuine H1 research entry fixtures match PRE-frozen signal features (27 target, 2 forward)", () => {
  const raw = JSON.parse(readFileSync(new URL("./fixtures/hype-h48-r4-wsig-h1-golden-20261114.json", import.meta.url), "utf8")) as {
    sourceSha256: string;
    rows: Array<{
      split: string; entryTs: number; entryOpen: number;
      hypeCloses: number[]; btcCloses: number[];
      expected: { h12: number; h24: number; rel24: number };
    }>;
  };
  assert.equal(raw.sourceSha256, "05632294b05a64c2fe28bbff63d191feed88d0e80e4eb3fd37e7f16bc67977a9");
  assert.equal(raw.rows.length, 29);
  assert.equal(raw.rows.filter(x => x.split === "TARGET").length, 27);
  assert.equal(raw.rows.filter(x => x.split === "FORWARD").length, 2);
  for (const row of raw.rows) {
    const t = row.entryTs - H;
    assert.equal(row.hypeCloses.length, 25);
    assert.equal(row.btcCloses.length, 25);
    const bars = (closes: number[]): H48ClosedHour[] => closes.map((close, i) => ({
      openTs: t - (24 - i) * H, close,
    }));
    const result = evaluateH48R4WsigEntry({
      runtimeSha: SHA, now: row.entryTs + 10000,
      entry: { openTs: row.entryTs, open: row.entryOpen, observedAt: row.entryTs + 5000 },
      hypeClosed: bars(row.hypeCloses), btcClosed: bars(row.btcCloses),
      existingHypePosition: false,
    });
    assert.equal(result.status, "CANDIDATE", `missed ${row.split} ${row.entryTs}`);
    if (result.status !== "CANDIDATE") continue;
    for (const [name, computed, expected] of [
      ["h12", result.hype12, row.expected.h12],
      ["h24", result.hype24, row.expected.h24],
      ["rel24", result.relative24, row.expected.rel24],
    ] as const) {
      assert.ok(Math.abs(computed - expected) <= 1e-11,
        `${row.split}/${row.entryTs}/${name} computed ${computed} != ${expected}`);
    }
  }
});
