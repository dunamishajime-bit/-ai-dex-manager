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
