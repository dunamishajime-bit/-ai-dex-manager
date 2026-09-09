import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const watchdog = new URL("../scripts/ops/root/disdex-runner-watchdog-current.mjs", import.meta.url);

test("current watchdog accepts snapshot-only health-snapshot heartbeats", async () => {
  const { stdout } = await execFileAsync(process.execPath, [fileURLToPath(watchdog), "--self-test"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.match(stdout, /DISDEX_CURRENT_WATCHDOG_HEARTBEAT_CONTRACT_SELFTEST_PASS/);
});

test("current watchdog rejects fresh snapshots with stale runner ticks", async () => {
  const { stdout } = await execFileAsync(process.execPath, [fileURLToPath(watchdog), "--self-test"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.match(stdout, /DISDEX_CURRENT_WATCHDOG_RUNNER_TICK_FRESHNESS_SELFTEST_PASS/);
});

test("current watchdog pins V52 service identity to the expected release", async () => {
  const { stdout } = await execFileAsync(process.execPath, [fileURLToPath(watchdog), "--self-test"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.match(stdout, /DISDEX_CURRENT_WATCHDOG_V52_RELEASE_PIN_SELFTEST_PASS/);
});

test("current watchdog requires an explicit approval pin", async () => {
  const { stdout } = await execFileAsync(process.execPath, [fileURLToPath(watchdog), "--self-test"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.match(stdout, /DISDEX_CURRENT_WATCHDOG_APPROVAL_GATE_SELFTEST_PASS/);
});

test("current watchdog rejects duplicate shared crypto risk writers", async () => {
  const { stdout } = await execFileAsync(process.execPath, [fileURLToPath(watchdog), "--self-test"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.match(stdout, /DISDEX_CURRENT_WATCHDOG_SHARED_RISK_SINGLETON_SELFTEST_PASS/);
});

test("current watchdog includes non-inactive shared risk writers", async () => {
  const { stdout } = await execFileAsync(process.execPath, [fileURLToPath(watchdog), "--self-test"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.match(stdout, /DISDEX_CURRENT_WATCHDOG_NONINACTIVE_RISK_SELFTEST_PASS/);
});
