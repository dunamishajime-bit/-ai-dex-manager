import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FET_BRK48_RESIDUAL } from "../config/fetBrk48Runtime";

test("FET runtime contract exposes the VOL10_RET15 upper bounds", () => {
  assert.equal(FET_BRK48_RESIDUAL.maximumVolumeRatio, 10);
  assert.equal(FET_BRK48_RESIDUAL.maximumReturn72h, 0.15);
});

test("Candidate health telemetry matches actual FET runtime bounds; no live target claim", () => {
  const health = readFileSync("scripts/ops/root/disdex-runner-health-snapshot-current.mjs", "utf8");
  const fields = [...health.matchAll(/heartbeat\.fet=\{([^}]+)\}/g)];
  assert.equal(fields.length, 1, "FET health record must be uniquely identified");
  for (const [key, expected] of [
    ["minimumVolumeRatio", FET_BRK48_RESIDUAL.minimumVolumeRatio],
    ["maximumVolumeRatio", FET_BRK48_RESIDUAL.maximumVolumeRatio],
    ["minimumReturn72h", FET_BRK48_RESIDUAL.minimumReturn72h],
    ["maximumReturn72h", FET_BRK48_RESIDUAL.maximumReturn72h],
    ["postExitCooldownHours", FET_BRK48_RESIDUAL.postExitCooldownHours],
    ["maximumNewEntryGross", FET_BRK48_RESIDUAL.maximumGross],
  ] as const) {
    const matches = [...fields[0][1].matchAll(new RegExp("(?:^|,)"+key+":([0-9.]+)(?:,|$)", "g"))];
    assert.equal(matches.length, 1, key);
    assert.equal(Number(matches[0][1]), expected, key);
  }
});

test("Candidate signal consumes the adopted upper-bound config", () => {
  const signal = readFileSync("lib/fet-brk48-signal.ts", "utf8");
  assert.match(signal, /volumeRatio-FET_BRK48_RESIDUAL\.maximumVolumeRatio>1e-12/);
  assert.match(signal, /return72h-FET_BRK48_RESIDUAL\.maximumReturn72h>1e-12/);
});
