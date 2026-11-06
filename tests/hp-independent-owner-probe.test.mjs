import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
const read = (p) => readFileSync(path.join(process.cwd(),p),"utf8");

test("Nginx subrequest has an isolated signed-session-only endpoint", () => {
  const route=read("app/api/system/owner-session-probe/route.ts");
  assert.match(route,/requestHasSignedOwnerSession\(request\)/);
  assert.match(route,/status: 401/);
  assert.match(route,/status: 204/);
  assert.doesNotMatch(route,/runner-health|loadRunnerPinManifest|readFile|getAccount|getOpenOrders/);
});

test("live portfolio also checks owner authentication before signed Aster reads", () => {
  const route=read("app/api/system/live-portfolio/route.ts");
  const guard=route.indexOf("if (!requestHasSignedOwnerSession(request))");
  const config=route.indexOf("loadAsterDexClientConfig();");
  assert.ok(guard>=0 && config>guard);
  assert.match(route,/status: 401/);
  assert.match(route,/Promise\.allSettled/);
  assert.match(route,/positionSource/);
  assert.match(route,/accountPositions/);
});

test("formal HP actions preserve auth_request and change only the auth upstream", () => {
  const script=read("scripts/ops/disdex-hp-independent-owner-probe-nginx-cutover.sh");
  assert.match(script,/location = \/__disdex_auth_probe_protected_readonly/);
  assert.match(script,/auth_request \/__disdex_auth_probe_protected_readonly/);
  assert.match(script,/api\/system\/owner-session-probe/);
  assert.match(script,/api\/system\/runner-health/);
  assert.match(script,/ANON_DENIAL_PRECHECK_FAILED/);
  assert.match(script,/NGINX_AUTH_PROBE_ROLLBACK_ATTEMPTED/);
  assert.doesNotMatch(script,/auth_request off|DISDEX_OWNER_SESSION_HMAC_KEY=/);
  for(const wf of [
    ".github/workflows/disdex-hp-approval-ui-production-deploy.yml",
    ".github/workflows/disdex-hp-standard-approval-ui-deploy.yml"
  ]) {
    const yml=read(wf);
    assert.match(yml,/environment:\s*\n\s+name: disdex-production/);
    assert.match(yml,/github\.actor == 'dunamishajime-bit'/);
    assert.match(yml,/Switch to independent signed owner-session auth probe/);
    assert.match(yml,/disdex-hp-independent-owner-probe-nginx-cutover.sh/);
  }
});