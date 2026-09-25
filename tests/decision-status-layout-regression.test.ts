import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("decision status keeps responsive overflow containment", async () => {
  const source = await readFile("components/features/DecisionStatusPanel.tsx", "utf8");
  assert.match(source, /min-w-0 space-y-4 overflow-x-hidden/);
  assert.match(source, /grid min-w-0 cursor-pointer/);
  assert.match(source, /break-words text-white\/55/);
});
