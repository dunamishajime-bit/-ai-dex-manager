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

test("HYPE runner is wired to the shared trade-fill notification spool", async () => {
  const wiring = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
  assert.match(wiring, /write_atomic \"\$HYPE_OPERATOR_ENV_FILE\"/);
  assert.match(wiring, /DISDEX_TRADE_FILL_NOTIFICATION_ENABLED=true/);
  assert.match(wiring, /DISDEX_TRADE_FILL_NOTIFICATION_MODE=live/);
  assert.match(wiring, /DISDEX_TRADE_FILL_STRATEGY_ID=HYPE_LONG/);
  assert.match(
    wiring,
    /DISDEX_TRADE_FILL_NOTIFICATION_SPOOL_PATH=\$\{SHARED_ROOT\}\/trade-fill-notifications\/inbox\.jsonl/,
  );
});
