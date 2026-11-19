import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("production approval page exposes pending and history tabs", () => {
  const page = fs.readFileSync("app/production-approval/page.tsx", "utf8");
  assert.match(page, /getDeploymentApprovalInbox/);
  assert.match(page, /view=pending/);
  assert.match(page, /view=history/);
  assert.match(page, /承認待ち/);
  assert.match(page, /履歴/);
});
