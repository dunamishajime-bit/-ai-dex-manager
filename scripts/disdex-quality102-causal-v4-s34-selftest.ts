import assert from "node:assert/strict";
import {
  detectQuality102CausalV4S34RawSignal,
  generateQuality102CausalV4S34Candidates,
} from "../lib/disdex-quality102-causal-v4-s34";
import type { Quality102Candle } from "../lib/disdex-quality102-causal-pipeline";

const HOUR = 3_600_000;
const ENTRY_TS = Date.UTC(2026, 8, 5, 13); // UTC hour 13 => 4h grid entry.
function rows(count = 400): Quality102Candle[] {
  const start = ENTRY_TS - count * HOUR;
  return Array.from({ length: count }, (_, i) => ({
    timestampMs: start + i * HOUR, open: 100, high: 101, low: 99, close: 100, quoteVolume: 1000, baseVolume: 100,
  }));
}

{
  const r = rows();
  r[r.length - 25] = { ...r[r.length - 25], close: 100 };
  r[r.length - 1] = { ...r[r.length - 1], close: 94, high: 95, low: 93 };
  const signal = detectQuality102CausalV4S34RawSignal(r, { timestampMs: ENTRY_TS, open: 125 }, "REV24_T0.05_H24");
  assert.equal(signal?.side, 1);
  assert.equal(signal?.holdHours, 24);
  assert.equal(signal?.hardStop, 0.06);
  assert.ok(Math.abs((signal?.margin ?? 0) - 1.2) < 1e-12);
  assert.ok(Math.abs((signal?.ret14 ?? 0) - 0.25) < 1e-12);
}

{
  const r = rows();
  for (let i = r.length - 73; i < r.length - 1; i += 1) r[i] = { ...r[i], baseVolume: 100, high: 101, low: 99, close: 100 };
  r[r.length - 25] = { ...r[r.length - 25], close: 100 };
  r[r.length - 1] = { ...r[r.length - 1], close: 104, high: 104, low: 100, baseVolume: 120 };
  const candidates = generateQuality102CausalV4S34Candidates({ symbol: "FETUSDT", rows: r, entryOpen: { timestampMs: ENTRY_TS, open: 120 } });
  const brk = candidates.find((row) => row.variant === "BRK24_H48_V1.2");
  assert.ok(brk);
  assert.equal(brk?.family, "BRK");
  assert.equal(brk?.layer, "S3");
  assert.equal(brk?.side, 1);
  assert.equal(brk?.hardStop, 0.08);
  assert.equal(brk?.maxHoldHours, 48);
  assert.equal(brk?.exitPolicy, "FIXED_HOLD_STOP");
}

{
  const r = rows();
  r[r.length - 1] = { ...r[r.length - 1], close: 94, high: 95, low: 93 };
  const candidate = generateQuality102CausalV4S34Candidates({ symbol: "APTUSDT", rows: r, entryOpen: { timestampMs: ENTRY_TS, open: 123 } })
    .find((row) => row.variant === "REV24_T0.05_H24");
  assert.ok(candidate, "ret14=23% remains eligible before the post-one-slot loss gate");
}

assert.throws(() => generateQuality102CausalV4S34Candidates({ symbol: "FETUSDT", rows: rows(), entryOpen: { timestampMs: ENTRY_TS + HOUR, open: 100 } }), /ENTRY_OPEN_TIMESTAMP/);
console.log("QUALITY102_CAUSAL_V4_S34_SELFTEST_PASS");
