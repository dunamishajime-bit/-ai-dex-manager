import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const monitorSource = readFileSync(
  new URL("../scripts/ops/root/disdex-runner-health-alert.ts", import.meta.url),
  "utf8",
);

test("read-only health monitor includes shared safety dependencies", () => {
  assert.match(monitorSource, /SHARED_CRYPTO_RISK/);
  assert.match(monitorSource, /disdex-shared-crypto-risk@\*\.service/);
  assert.match(monitorSource, /MARGIN_GUARD/);
  assert.match(monitorSource, /disdex-v12-v52-margin-guard@\*\.service/);
});
