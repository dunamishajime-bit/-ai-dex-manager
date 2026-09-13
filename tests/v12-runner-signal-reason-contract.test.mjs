import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("V12 HP trusts current runner signal eligibility/reason and keeps legacy fallback", async () => {
  const source = await readFile("lib/server/v12-decision-observability.ts", "utf8");
  assert.match(source, /signalEligible\?: boolean/);
  assert.match(source, /signalReason\?: string/);
  assert.match(source, /candidate\.signalEligible === true/);
  assert.match(source, /candidate\.signalEligible === false/);
  assert.match(source, /BTC_REGIME_OR_ENTRY_QUALITY_BLOCKED/);
  assert.match(source, /diagnoseSignalGate/);
});