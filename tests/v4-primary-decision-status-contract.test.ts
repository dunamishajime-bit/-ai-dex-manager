import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("decision observability follows certified V4 primary state instead of legacy V12 files", () => {
  const source = read("lib/server/v12-decision-observability.ts");
  assert.match(source, /loadV12V4HpObservability/);
  assert.match(source, /actual\.v12PrimaryMode === "V4"/);
  assert.match(source, /V12_V4_HEALTH_STATE_PATH/);
  assert.match(source, /V12_V4_REALTIME_DECISION_PATH/);
  assert.match(source, /source: "V4_PRIMARY"/);
  assert.match(source, /strategyId: row\.schema === "v12-v4-live-decision\/v1"/);
});

test("a fresh V4 cycle with no candidates is not presented as an unavailable source", () => {
  const source = read("lib/server/v12-decision-observability.ts") + read("lib/server/disdex-decision-status.ts");
  assert.match(source, /候補なし・正常待機/);
  assert.match(source, /NO_NATIVE_ENTRY_CANDIDATES/);
  assert.match(source, /isV4Decision \? "条件不足"/);
});

test("the V12 detail panel labels the actual primary source", () => {
  const source = read("components/features/DecisionStatusPanel.tsx");
  assert.match(source, /isV4Primary/);
  assert.match(source, /V12 V4/);
  assert.match(source, /source：\{isV4Primary \? "V4_PRIMARY"/);
});
