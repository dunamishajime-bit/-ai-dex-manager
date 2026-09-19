import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { extractObjectNumber } from "../lib/server/current-production-runtime";

const files = {
  loader: "lib/server/current-production-runtime.ts",
  home: "app/page.tsx",
  positions: "app/positions/page.tsx",
  banner: "components/layout/LiveProductionBanner.tsx",
  decisionPanel: "components/features/DecisionStatusPanel.tsx",
  decisionServer: "lib/server/disdex-decision-status.ts",
  fallback: "lib/disterminal-live-config.ts",
};

test("HP Production contract is sourced from current VPS runtime", async () => {
  const loader = await readFile(files.loader, "utf8");
  assert.match(loader, /\/home\/deploy\/disdex-trading\/current/);
  assert.match(loader, /runtimeLineage/);
  assert.match(loader, /strongRegimeQualityScoreMinimum/);
  assert.match(loader, /strongRegimeQualityScoreMaximum/);
  assert.match(loader, /strongRegimeQualityMinimumAtrRatio/);
  assert.match(loader, /penguRecoveryV8\.ts/);
  assert.match(loader, /v52V50Runtime\.json/);
});
test("Production UI does not fall back to stale strategy contract values", async () => {
  const [home, positions, banner] = await Promise.all([
    readFile(files.home, "utf8"),
    readFile(files.positions, "utf8"),
    readFile(files.banner, "utf8"),
  ]);
  for (const source of [home, positions, banner]) {
    assert.doesNotMatch(source, /\?\?\s*config\.(?:quality102Runtime|v52|v12|pengu|maximumGross|sharedCryptoGross)/);
    assert.match(source, /runtime未取得|RUNTIME MISMATCH/);
  }
  assert.match(home, /strongRegimeQualityScoreMinimum/);
  assert.match(positions, /strongRegimeQualityScoreMinimum/);
  assert.match(banner, /strongRegimeQualityScoreMinimum/);
});

test("static metadata is explicitly non-authoritative", async () => {
  const fallback = await readFile(files.fallback, "utf8");
  assert.match(fallback, /Build-time compatibility metadata only/);
  assert.match(fallback, /Production strategy truth MUST come from \/api\/system\/live-runtime/);
});


test("decision status auto-refreshes from Production runtime without static contract fallback", async () => {
  const [panel, server] = await Promise.all([
    readFile(files.decisionPanel, "utf8"),
    readFile(files.decisionServer, "utf8"),
  ]);
  assert.match(panel, /setInterval\(\(\) => void load\(true\), 30_000\)/);
  assert.match(panel, /productionRuntime/);
  assert.doesNotMatch(panel, /config\.penguGross|config\.v52Top2Policy|config\.quality102Runtime/);
  assert.match(server, /CACHE_TTL_MS = 25_000/);
  assert.match(server, /runtimeSnapshot\(checkedAt, currentRuntime\)/);
  assert.match(server, /strongRegimeQualityScoreMinimum/);
});


test("runtime source number parser accepts signed and scientific values", () => {
  assert.equal(extractObjectNumber("ema168DistanceMinPct: -5.864583483302943,", "ema168DistanceMinPct"), -5.864583483302943);
  assert.equal(extractObjectNumber("threshold: +1.4e-2,", "threshold"), 0.014);
});
