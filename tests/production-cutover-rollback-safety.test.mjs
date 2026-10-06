import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const sourceUrl = new URL("../scripts/ops/root/disdex-idle-production-redeploy-20261001", import.meta.url);

test("production cutover rolls back on every nonzero process exit", async () => {
  const text = await readFile(sourceUrl, "utf8");
  assert.match(text, /rollback\(\)\s*\{\s*rc="\$\{1:-\$\?\}"/s);
  assert.match(text, /trap - ERR EXIT/);
  assert.match(text, /trap 'rc=\$\?; if \[\[ "\$rc" -ne 0 \]\]; then rollback "\$rc"; fi' EXIT/);
  assert.doesNotMatch(text, /trap rollback ERR/);
  const timeout = text.indexOf('CUTOVER_HEARTBEAT_TIMEOUT');
  const exit47 = text.indexOf('exit 47', timeout);
  const trap = text.indexOf("trap 'rc=$?; if [[ \"$rc\" -ne 0 ]]; then rollback \"$rc\"; fi' EXIT");
  assert.ok(trap >= 0 && timeout > trap && exit47 > timeout, "heartbeat timeout must occur under EXIT rollback trap");
});

test("successful cutover disarms EXIT rollback before cleanup and success marker", async () => {
  const text = await readFile(sourceUrl, "utf8");
  const disarm = text.lastIndexOf("trap - ERR EXIT");
  const success = text.indexOf("STATUS=LIVE_ACTIVATED_VERIFIED");
  assert.ok(disarm >= 0 && success > disarm);
});


test("production cutover consumes a staged exact-SHA approval and never fabricates one", async () => {
  const text = await readFile(sourceUrl, "utf8");
  assert.match(text, /approved-\$TARGET_SHA\.json/);
  assert.match(text, /OPERATOR_STAGED_ACTIVATION_REQUIRED/);
  assert.match(text, /disdex-live-operator-activation-gate\.mjs/);
  assert.match(text, /disdex-fet-preemption-readiness-guard\.py/);
  assert.match(text, /OPERATOR_STAGED_ACTIVATION_PROMOTED=PASS/);
  assert.match(text, /install -o root -g root -m 0600 "\$staged_operator_activation"/);
  assert.doesNotMatch(text, /tempfile\.mkstemp\(prefix="\.operator-activation/);
  assert.doesNotMatch(text, /"ordersEnabled":True/);
  assert.doesNotMatch(text, /"operatorAcknowledgement":"I_ACK_REAL_MONEY_LIVE_ACTIVATION"/);
});

test("production deploy workflow is manual-dispatch only", async () => {
  const workflow = await readFile(new URL("../.github/workflows/full-order-path-production-deploy-20261006.yml", import.meta.url), "utf8");
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:\s*\n/);
});
