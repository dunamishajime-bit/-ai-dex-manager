import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("HYPE systemd unit is operator-gated and release-pinned", async () => {
  const unit = await readFile("ops/systemd/disdex-hype-long@.service", "utf8");
  assert.match(unit, /ExecStartPre=.*operator.*gate/i);
  assert.match(unit, /DISDEX_HYPE_TREND_RUNTIME_SHA|DISDEX_RELEASE_SHA/);
  assert.match(unit, /disdex-hype-trend-live-runner/);
  assert.match(unit, /Restart=on-failure/);
  const envFile = unit.indexOf("EnvironmentFile=-/etc/disdex/current-runtime/%i.env");
  const armedOverride = unit.indexOf("EnvironmentFile=-/etc/disdex/current-runtime/%i.hype-operator.env");
  assert.ok(envFile >= 0 && armedOverride > envFile, "HYPE operator override EnvironmentFile must follow the shared contract EnvironmentFile");
});


test("HYPE transient manual-review keeps the daemon alive for a fail-closed retry", async () => {
  const source = await readFile("scripts/disdex-hype-zec-long-live-runner.ts", "utf8");
  assert.match(source, /DISDEX_HYPE_ZEC_MANUAL_REVIEW_RETRY_MS/);
  assert.match(source, /result\.status === "manual-review"/);
  assert.doesNotMatch(source, /!daemon \|\| stopping \|\| result\.status === "manual-review"\) break/);
});
