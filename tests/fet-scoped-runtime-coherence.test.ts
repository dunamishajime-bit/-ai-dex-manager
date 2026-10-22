import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const coherence = readFileSync("scripts/ops/root/disdex-current-runtime-coherence-guard", "utf8");
const watchdog = readFileSync("scripts/ops/root/disdex-runner-watchdog-current.mjs", "utf8");
const scopedWiring = readFileSync("scripts/ops/root/disdex-fet-scoped-runtime-wiring", "utf8");

test("FET mixed-SHA scope is explicit and keeps the common current release unchanged", () => {
  assert.match(coherence, /FET_SCOPE_ENV_FILE/);
  assert.match(coherence, /DISDEX_FET_SCOPED_SHA/);
  assert.match(coherence, /DISDEX_FET_SCOPED_RELEASE_ROOT/);
  assert.match(coherence, /DISDEX_FET_OPERATOR_ACTIVATION_PATH/);
  assert.match(coherence, /--self-test-fet-mixed-sha/);
  assert.match(coherence, /disdex-fet-scoped-runtime-wiring/);
  assert.match(scopedWiring, /--current-sha/);
  assert.match(scopedWiring, /--fet-sha/);
  assert.match(scopedWiring, /--activation-path/);
  assert.match(scopedWiring, /current symlink/);
});

test("FET watchdog uses a dedicated operator artifact while peer runners retain the common artifact", () => {
  assert.match(watchdog, /key: "FET_BRK48_RESIDUAL"[\s\S]*operatorActivationPathEnv: "DISDEX_WATCHDOG_FET_OPERATOR_ACTIVATION_PATH"/);
  assert.match(watchdog, /dedicated operator activation path is required/);
});

test("coherence FET mixed-SHA self-test passes without touching systemd", () => {
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/usr/bin/bash";
  const guard = resolve("scripts/ops/root/disdex-current-runtime-coherence-guard");
  const output = execFileSync(bash, [guard, "--self-test-fet-mixed-sha"], { encoding: "utf8" });
  assert.match(output, /FET_MIXED_SHA_COHERENCE_SELFTEST_PASS/);
});
