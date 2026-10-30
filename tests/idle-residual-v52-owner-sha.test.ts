import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolveIdleResidualOwnerShaForPreemption } from "../lib/idle-residual-owner-sha";
import { normalizeIdleResidualLongState, emptyIdleResidualLongState } from "../lib/idle-residual-long-state";

const v52 = "9".repeat(40);
const idle = "7".repeat(40);
test("V52 preemption uses pinned IDLE owner, not V52 caller SHA", () => {
  const actual = resolveIdleResidualOwnerShaForPreemption({
    DISDEX_IDLE_PRIORITY_RUNTIME_SHA: idle,
  });
  assert.equal(actual, idle);
  assert.notEqual(actual, v52);
  assert.equal(normalizeIdleResidualLongState(emptyIdleResidualLongState(idle), actual).runtimeSha, idle);
  assert.throws(
    () => normalizeIdleResidualLongState(emptyIdleResidualLongState(idle), v52),
    /IDLE_RESIDUAL_STATE_RUNTIME_OR_SCHEMA_MISMATCH/,
  );
});
test("missing, non-SHA and unsafe external owner pins fail closed", () => {
  for (const value of [undefined, "", "latest", "a".repeat(39), "z".repeat(40)]) {
    assert.throws(
      () => resolveIdleResidualOwnerShaForPreemption({ DISDEX_IDLE_PRIORITY_RUNTIME_SHA: value }),
      /IDLE_RESIDUAL_PREEMPT_OWNER_SHA_REQUIRED/,
    );
  }
});
test("V52 helper must import owner SHA resolver; state SHA is not trusted as authority", async () => {
  const helper = await readFile("scripts/disdex-idle-residual-long-core-preempt.ts", "utf8");
  assert.match(helper, /resolveIdleResidualOwnerShaForPreemption\(process\.env\)/);
  assert.doesNotMatch(helper, /runtimeSha=String\(process\.env\.DISDEX_RUNTIME_COMMIT_SHA/);
});
