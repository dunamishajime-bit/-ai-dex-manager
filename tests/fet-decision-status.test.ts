import assert from "node:assert/strict";
import test from "node:test";

import { runtimeSnapshot } from "../lib/server/disdex-decision-status";

test("判定状況のruntime一覧にFET BRK48 Residualを含める", () => {
  const snapshot = runtimeSnapshot("2026-09-26T00:00:00.000Z", null);
  const fet = snapshot.units.find((unit) => unit.id === "FET_BRK48_RESIDUAL");

  assert.ok(fet, "FET runner must be visible in the HP runtime summary");
  assert.match(fet.label, /FET/);
  assert.match(fet.venue, /Aster/);
  assert.match(fet.entryPolicy, /BRK48/);
});
