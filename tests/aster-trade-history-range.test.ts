import assert from "node:assert/strict";
import test from "node:test";

import { buildAsterHistoryWindows } from "../lib/server/aster-trade-history";

test("Aster history windows cover the requested range without exceeding the venue seven-day limit", () => {
  const start = Date.parse("2026-08-01T00:00:00.000Z");
  const end = Date.parse("2026-10-18T00:00:00.000Z");
  const windows = buildAsterHistoryWindows(start, end);

  assert.ok(windows.length >= 12);
  assert.equal(windows[0].startTime, start);
  assert.equal(windows.at(-1)?.endTime, end);
  for (const window of windows) {
    assert.ok(window.endTime >= window.startTime);
    assert.ok(window.endTime - window.startTime < 7 * 24 * 60 * 60 * 1000);
  }
});
