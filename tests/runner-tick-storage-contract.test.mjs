import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const wiring = readFileSync(join(process.cwd(), "scripts/ops/root/disdex-current-runtime-wiring"), "utf8");
const tickWriter = readFileSync(join(process.cwd(), "lib/disdex-runner-tick-heartbeat.ts"), "utf8");
const runnerEntrypoints = [
  "scripts/v12-v4-production-runner.ts",
  "scripts/disdex-pengu-dual-ls-v2-live-runner.ts",
  "scripts/disdex-quality102-causal-v1-live-runner.ts",
  "scripts/disdex-fet-brk48-live-runner.ts",
  "scripts/disdex-hype-zec-long-live-runner.ts",
  "scripts/disdex-idle-priority-short-live-runner.ts",
];

test("TypeScript tick publication is exclusive and collision resistant", () => {
  assert.match(tickWriter, /randomUUID/);
  assert.match(tickWriter, /flag:\s*["']wx["']/);
  assert.doesNotMatch(tickWriter, /process\.pid\s*\}\.\$\{Date\.now\(\)\}/);
  assert.match(tickWriter, /unlink\(temporary/);
});

test("reviewed storage boundary keeps the parent root-controlled and child deploy-writable", () => {
  assert.match(wiring, /RUNNER_TICK_HEARTBEAT_DIR="\/var\/lib\/disdex\/runner-health\/ticks"/);
  assert.match(wiring, /ensure_runner_tick_storage\(\)/);
  assert.match(wiring, /\[\[ -d "\$parent" && ! -L "\$parent" \]\]/);
  assert.match(wiring, /install -d -o deploy -g deploy -m 0700 "\$RUNNER_TICK_HEARTBEAT_DIR"/);
  assert.match(wiring, /RUNNER_TICK_PERMISSIONS_INVALID/);
  assert.doesNotMatch(wiring, /chown -R deploy:deploy \/var\/lib\/disdex\/runner-health/);
});

test("only the seven tick-capable runner units get the narrow writable path", () => {
  for (const name of ["V12_DROPIN_DIR", "PENGU_DROPIN_DIR", "Q102_DROPIN_DIR", "FET_DROPIN_DIR", "V52_DROPIN_DIR", "HYPE_DROPIN_DIR", "IDLE_DROPIN_DIR"]) {
    assert.match(wiring, new RegExp(`\\$\\{${name}\\}`));
  }
  assert.match(wiring, /ReadWritePaths=\$\{RUNNER_TICK_HEARTBEAT_DIR\}/);
  assert.match(wiring, /ProtectSystem=strict/);
  assert.doesNotMatch(wiring, /touch\s+.*runner-health\/ticks|printf\s+.*runner-health\/ticks/);
});

test("storage setup is after activation preflight and before systemd reload", () => {
  const storage = wiring.indexOf("  ensure_runner_tick_storage\n");
  const firstReload = wiring.indexOf("  systemctl daemon-reload", storage);
  assert.ok(storage > wiring.indexOf("operator_activation_all_trading_ready ||"));
  assert.ok(firstReload > storage);
});

test("all required TypeScript loops publish only from their real decision cycle", () => {
  for (const entrypoint of runnerEntrypoints) {
    const source = readFileSync(join(process.cwd(), entrypoint), "utf8");
    assert.match(source, /writeRunnerTickHeartbeat/);
    assert.match(source, /tickStartedAt/);
    assert.match(source, /tickCompletedAt/);
  }
});
