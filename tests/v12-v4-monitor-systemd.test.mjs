import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("deploy/systemd/disdex-v12-v4-monitor@.service", "utf8");

test("monitor loader override keeps the tick writer in the systemd MainPID", () => {
  const override=readFileSync("deploy/systemd/disdex-v12-v4-monitor@.service.d/60-same-pid-loader.conf","utf8");
  assert.match(override,/^ExecStart=$/m);
  assert.match(override,/^ExecStart=\/usr\/bin\/node --import \/home\/deploy\/disdex-trading\/releases\/%i\/node_modules\/tsx\/dist\/loader\.mjs \/home\/deploy\/disdex-trading\/releases\/%i\/scripts\/v12-v4-monitor-only-runner\.ts --daemon$/m);
  assert.doesNotMatch(override,/cli\.mjs|v12-v4-production-runner/);
});

test("V4 monitor systemd unit is read-only and has no production activation gate", () => {
  assert.match(source, /scripts\/v12-v4-monitor-only-runner\.ts --daemon/);
  assert.doesNotMatch(source, /scripts\/v12-v4-production-runner\.ts/);
  assert.doesNotMatch(source, /current-runtime\/%i\.env/);
  assert.doesNotMatch(source, /operator-activation/);
  assert.doesNotMatch(source, /production-canary-permit/);
  assert.match(source, /ReadOnlyPaths=.*\/var\/lib\/disdex\/shared/);
  assert.match(source, /ReadWritePaths=\/var\/lib\/disdex\/v12-v4\/monitor \/var\/lib\/disdex\/runner-health\/ticks/);
  assert.match(source, /NoNewPrivileges=true/);
  assert.match(source, /^StateDirectory=disdex\/v12-v4\/monitor$/m);
  assert.match(source, /^StateDirectoryMode=0750$/m);
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


test("full V4 template uses same-PID release-local loader and real tick write path", () => {
  const full=readFileSync("deploy/systemd/disdex-v12-v4@.service","utf8");
  assert.match(full,/^ExecStart=\/usr\/bin\/node --import \/home\/deploy\/disdex-trading\/releases\/%i\/node_modules\/tsx\/dist\/loader\.mjs \/home\/deploy\/disdex-trading\/releases\/%i\/scripts\/v12-v4-production-runner\.ts --daemon$/m);
  assert.match(full,/^ExecStartPre=\/usr\/bin\/test -w \/var\/lib\/disdex\/runner-health\/ticks$/m);
  assert.match(full,/^ReadWritePaths=.*\/var\/lib\/disdex\/runner-health\/ticks/m);
  assert.match(full,/^Environment=DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=\/var\/lib\/disdex\/shared\/aster-rate-budget\.json$/m);
  assert.match(full,/^Environment=DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET=\/run\/disdex-v4-budget-%i\/budget\.sock$/m);
});

test("full V4 startup does not rewrite peer state or canary authorization", () => {
  const full=readFileSync("deploy/systemd/disdex-v12-v4@.service","utf8");
  assert.doesNotMatch(full,/fet-brk48-residual|production-canary-permit|chown|chmod/);
  assert.match(full,/--runner V12_V4 --activation-path \/var\/lib\/disdex\/shared\/operator-activation\/v12-v4-full\.json/);
  assert.match(full,/^Requires=disdex-v4-rate-budget-broker@%i\.service$/m);
});

test("full V4 requires a read-only order-time Margin Guard inside its sandbox", () => {
  const full=readFileSync("deploy/systemd/disdex-v12-v4@.service","utf8");
  assert.match(full,/^Environment=DISDEX_V4_PREORDER_MARGIN_GUARD_READONLY=1$/m);
  assert.match(full,/^ProtectSystem=strict$/m);
  assert.doesNotMatch(full,/^ReadWritePaths=.*\/home\/deploy/m);
});
