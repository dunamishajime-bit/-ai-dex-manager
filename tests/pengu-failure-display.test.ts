import assert from "node:assert/strict";
import test from "node:test";

import { penguFailureDisplayState } from "../lib/pengu-failure-display";

test("inactive Kill Switch labels retained PENGU failures as audit history", () => {
  const display = penguFailureDisplayState(false, 8);

  assert.equal(display.killSwitchLabel, "inactive");
  assert.equal(display.historyLabel, "過去のFail-Closed履歴（監査用）");
  assert.equal(display.historyKind, "historical");
  assert.equal(display.failureCount, 8);
});

test("active Kill Switch labels PENGU failures as current fail-closed history", () => {
  const display = penguFailureDisplayState(true, 2);

  assert.equal(display.killSwitchLabel, "ACTIVE");
  assert.equal(display.historyLabel, "現在のFail-Closed履歴");
  assert.equal(display.historyKind, "active");
  assert.equal(display.failureCount, 2);
});
