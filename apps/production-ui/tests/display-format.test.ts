import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  formatDisplayNumber,
  formatDisplayFractionPercent,
  formatDisplayPercent,
  formatDisplayPrice,
  formatDisplayQuantity,
} from "../lib/display-format";

test("display numbers are capped at a human-readable precision", () => {
  assert.equal(formatDisplayNumber(0.123456789, 2), "0.12");
  assert.equal(formatDisplayNumber(1234.56789, 2), "1,234.57");
});

test("display quantities keep useful precision without fixed trailing zeroes", () => {
  assert.equal(formatDisplayQuantity(301.000000), "301");
  assert.equal(formatDisplayQuantity(0.123456789), "0.1235");
});

test("display prices avoid eight-decimal venue formatting in HP cards", () => {
  assert.equal(formatDisplayPrice(12345.678901), "12345.68");
  assert.equal(formatDisplayPrice(0.123456789), "0.12346");
  assert.equal(formatDisplayPrice(0.00123456789), "0.001235");
});

test("display percentages use percentage units and two decimals", () => {
  assert.equal(formatDisplayPercent(12.345678), "12.35%");
  assert.equal(formatDisplayPercent(-0.004), "0%");
  assert.equal(formatDisplayFractionPercent(0.0227), "2.27%");
});

test("core dashboard and decision surfaces do not render raw fixed decimals", () => {
  const surfaces = [
    "app/page.tsx",
    "app/positions/page.tsx",
    "app/wallets/page.tsx",
    "app/decision-status/idle-priority/page.tsx",
    "components/layout/LiveProductionBanner.tsx",
    "components/features/DecisionStatusPanel.tsx",
    "components/features/RealtimeRankingBoard.tsx",
  ];
  for (const surface of surfaces) {
    const source = readFileSync(join(process.cwd(), surface), "utf8");
    assert.doesNotMatch(source, /\.toFixed\(/, surface);
  }
});
