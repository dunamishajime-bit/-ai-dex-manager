import assert from "node:assert/strict";
import test from "node:test";
import { advanceRenderAdverse, startRenderAdverse } from "../lib/idle-render-adverse.ts";

const step = 300_000;
const entry = 12 * step;
const position = { symbol: "RENDERUSDT", side: "SHORT", route: "IDLE_RENDER_RELATIVE_SHORT",
  entryTs: entry, entryPrice: 100 };
const bar = (i, low = 100, close = 101) => ({ timestampMs: entry + i * step,
  open: 101, high: 102, low, close });

test("only the existing RENDER short starts watching", () => {
  assert.ok(startRenderAdverse(position));
  for (const patch of [{ route: "IDLE_RENDER_INDEPENDENT_HIGHWR_WICK_SHARP_S6_SHORT" },
    { symbol: "AVAXUSDT" }, { side: "LONG" }]) {
    assert.equal(startRenderAdverse({ ...position, ...patch }), undefined);
  }
});

test("requires two hours after the confirmed adverse close and strictly less than 0.25% MFE", () => {
  const replay = (firstLow, count) => {
    let state = startRenderAdverse(position);
    for (let i = 0; i < count; i++) {
      const candle = bar(i, i === 0 ? firstLow : 100);
      state = advanceRenderAdverse(state, candle, candle.timestampMs + step);
    }
    return state;
  };
  assert.equal(replay(100, 24).completed, false);
  assert.equal(replay(100, 25).completed, true);
  assert.equal(replay(99.75, 25).completed, false);
});

test("rejects unclosed and missing bars without moving the durable cursor", () => {
  const state = startRenderAdverse(position);
  assert.throws(() => advanceRenderAdverse(state, bar(0), entry + step - 1));
  assert.throws(() => advanceRenderAdverse(state, bar(1), entry + 2 * step));
  assert.equal(state.nextBarTs, entry);
});
