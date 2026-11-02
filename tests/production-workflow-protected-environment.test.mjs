import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const protectedMutators = [
  ".github/workflows/disdex-hp-standard-approval-ui-deploy.yml",
  ".github/workflows/disdex-hp-approval-ui-production-deploy.yml",
  ".github/workflows/disdex-fet-hp-production-deploy.yml",
  ".github/workflows/disdex-vps-control.yml",
  ".github/workflows/disdex-root-kill-owner-hotfix-20260926.yml",
  ".github/workflows/disdex-protected-retention-apply-20260926.yml",
  ".github/workflows/disdex-safe-ui-retention-apply-20260926.yml",
];

test("known Production mutation workflows are bound to disdex-production environment", () => {
  for (const file of protectedMutators) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /environment:\s*\n\s+name:\s*disdex-production\b/, file);
  }
});

test("workflows never synthesize or send the retired fixed auth cookie", () => {
  const root = ".github/workflows";
  for (const name of fs.readdirSync(root)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const source = fs.readFileSync(root + "/" + name, "utf8");
    assert.doesNotMatch(source, /disdex_auth\s*=\s*1/, name);
  }
});

test("HP approval UI post-deploy check verifies protected redirect without an auth artifact", () => {
  const source = fs.readFileSync(
    ".github/workflows/disdex-hp-standard-approval-ui-deploy.yml",
    "utf8",
  );
  assert.match(source, /APPROVAL_ROUTE_PROTECTED/);
  assert.match(source, /location:/i);
  assert.doesNotMatch(source, /Cookie:\s*disdex_auth/);
});
