import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("HYPE systemd unit is operator-gated and release-pinned", async () => {
  const unit = await readFile("ops/systemd/disdex-hype-long@.service", "utf8");
  assert.match(unit, /ExecStartPre=.*operator.*gate/i);
  assert.match(unit, /DISDEX_HYPE_TREND_RUNTIME_SHA|DISDEX_RELEASE_SHA/);
  assert.match(unit, /disdex-hype-trend-live-runner/);
  assert.match(unit, /Restart=on-failure/);
});
