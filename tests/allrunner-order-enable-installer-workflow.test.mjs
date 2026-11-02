import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workflowPath = ".github/workflows/disdex-allrunner-order-enable-install.yml";

test("order-enable installer workflow is protected and install-only", () => {
  assert.ok(fs.existsSync(workflowPath), "installer workflow missing");
  const s = fs.readFileSync(workflowPath, "utf8");
  assert.match(s, /environment:\s*\n\s*name:\s*disdex-production/);
  assert.match(s, /github\.ref == 'refs\/heads\/master'/);
  assert.match(s, /github\.actor == 'dunamishajime-bit'/);
  assert.match(s, /\[\[ "\$TARGET_SHA" == "\$GITHUB_SHA" \]\]/);
  assert.match(s, /config\/disdex-allrunner-order-enable-DD1296_FINAL_ALLIN_10BPS\.json/);
  assert.match(s, /install-disdex-allrunner-order-enable/);
  assert.match(s, /sha256sum -c/);
  assert.match(s, /ALLRUNNER_ORDER_ENABLE_HELPER_INSTALLED_SOURCE_READY_NOT_LIVE/);
  assert.doesNotMatch(s, /api\/system\/deploy-approval/);
  assert.doesNotMatch(s, /--execute/);
  assert.doesNotMatch(s, /systemctl/);
  assert.doesNotMatch(s, /operator-activation\/current\.json/);
  assert.doesNotMatch(s, /kill-switch\.json/);
  assert.ok(!s.includes("\\$\\s("), "invalid escaped command substitution");
});

test("installer workflow transfers only the reviewed bootstrap file set", () => {
  const s = fs.readFileSync(workflowPath, "utf8");
  for (const path of [
    "scripts/ops/deploy/disdex_allrunner_order_enable.py",
    "scripts/ops/deploy/disdex_owner_approval.py",
    "scripts/ops/deploy/disdex_deployment_contract.py",
    "scripts/ops/deploy/disdex_allrunner_final_verify.py",
    "scripts/ops/root/disdex-allrunner-order-enable",
    "scripts/ops/root/install-disdex-allrunner-order-enable",
    "config/disdex-allrunner-order-enable-DD1296_FINAL_ALLIN_10BPS.json",
  ]) assert.ok(s.includes(path), "missing reviewed path: " + path);
});
