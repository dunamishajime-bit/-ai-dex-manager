import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("deploy/systemd/disdex-v12-v4-monitor@.service", "utf8");

test("V4 monitor systemd unit is read-only and has no production activation gate", () => {
  assert.match(source, /scripts\/v12-v4-monitor-only-runner\.ts --daemon/);
  assert.doesNotMatch(source, /scripts\/v12-v4-production-runner\.ts/);
  assert.doesNotMatch(source, /current-runtime\/%i\.env/);
  assert.doesNotMatch(source, /operator-activation/);
  assert.doesNotMatch(source, /production-canary-permit/);
  assert.match(source, /ReadOnlyPaths=.*\/var\/lib\/disdex\/shared/);
  assert.match(source, /ReadWritePaths=\/var\/lib\/disdex\/v12-v4\/monitor \/var\/lib\/disdex\/runner-health\/ticks/);
  assert.match(source, /NoNewPrivileges=true/);
});

test("monitor checks pre-provisioned tick access without changing directory ownership", () => {
  assert.match(source, /ExecStartPre=\/usr\/bin\/test -w \/var\/lib\/disdex\/runner-health\/ticks/);
  assert.doesNotMatch(source, /install -d[^\n]*\/var\/lib\/disdex\/runner-health\/ticks/);
});

test("monitor is configured to use the production shared API budget", () => {
  assert.match(source, /^Environment=DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=\/var\/lib\/disdex\/shared\/aster-rate-budget\.json$/m);
  assert.match(source, /^Environment=DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET=\/run\/disdex-v4-budget-%i\/budget\.sock$/m);
});

test("dynamic refresh uses the same production shared API budget", () => {
  const refresh = readFileSync("ops/systemd/disdex-v4-dynamic-evidence-refresh@.service", "utf8");
  assert.match(refresh, /^Environment=DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=\/var\/lib\/disdex\/shared\/aster-rate-budget\.json$/m);
  assert.match(refresh, /^Environment=DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET=\/run\/disdex-v4-budget-%i\/budget\.sock$/m);
});
