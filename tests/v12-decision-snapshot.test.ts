import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("V12 runner has an atomic decision snapshot module", () => {
  const file = join(root, "lib/v12-decision-snapshot.ts");
  assert.equal(existsSync(file), true, "decision snapshot module is required");
  const content = readFileSync(file, "utf8");
  assert.match(content, /v12-decision-snapshot\/v1/);
  assert.match(content, /candidates/);
  assert.match(content, /rename\(/, "snapshot persistence must be atomic");
});

test("V12 runner wires a dedicated decision snapshot path", () => {
  const runner = readFileSync(join(root, "scripts/disdex-v12-x1-all-live-runner.ts"), "utf8");
  assert.match(runner, /V12_DECISION_SNAPSHOT_PATH/);
  assert.match(runner, /decision-snapshot\.json/);
});