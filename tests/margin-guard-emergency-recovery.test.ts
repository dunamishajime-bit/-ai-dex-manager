import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("margin guard emergency recovery allowlists the exact grace-expired reason", async () => {
  const source = await readFile("scripts/disdex-margin-guard-emergency-recovery.ts", "utf8");
  assert.match(source, /Margin Guard recovery grace expired while authenticated risk data remained unavailable/);
  assert.match(source, /isMarginGuardKillReason\(reason\)/);
  assert.match(source, /unrelated/);
});
