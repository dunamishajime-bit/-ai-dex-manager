import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("runtime wiring records and validates dependency release lineage", async () => {
  const source = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
  assert.match(source, /DISDEX_NODE_MODULES_SOURCE_SHA/);
  assert.match(source, /DISDEX_PYTHON_RUNTIME_SOURCE_SHA/);
  assert.match(source, /validate_release_dependency/);
});
