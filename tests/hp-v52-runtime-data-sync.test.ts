import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const FINAL_RUNTIME_SHA = "10e18fea89b2aa889b9ce3d6a2603c43ac9e7715";

async function source(path: string) {
  return readFile(path, "utf8");
}

test("HP LIVE metadata matches the current runner release and V52 V50 contract", async () => {
  const config = await source("lib/disterminal-live-config.ts");

  assert.ok((config.match(new RegExp(FINAL_RUNTIME_SHA, "g")) || []).length >= 10);
  assert.doesNotMatch(config, /8a2d73f7ad46d234dda161d1471191b2b09fa2bd/);
  assert.match(config, /minEntryBasisBps: 75/);
  assert.match(config, /minNetEdgeBps: 10/);
  assert.match(config, /BASIS_BELOW_75/);
  assert.match(config, /NET_EDGE_BELOW_10/);
  assert.match(config, /maxHoldingHours: 3/);
});

test("UI systemd wiring pins canonical current V52 and PENGU state paths", async () => {
  const wiring = await source("ops/vps/ai-dex-manager-ui-runtime-paths.conf");

  assert.match(wiring, /V52_ASTER_ONLY_STATE_PATH=\/var\/lib\/disdex\/v52-aster-only\/runner-live\.json/);
  assert.match(wiring, /PENGU_DUAL_LS_V2_STATE_PATH=\/var\/lib\/disdex\/pengu-dual-ls-v2\/runner-live\.json/);
  assert.match(wiring, /PENGU_DUAL_LS_V2_RUNNER_STATE_PATH=\/var\/lib\/disdex\/pengu-dual-ls-v2\/runner-live\.json/);
});

test("HP runtime surfaces include V52 status and current V50 thresholds", async () => {
  const [home, positions, banner, panel] = await Promise.all([
    source("app/page.tsx"),
    source("app/positions/page.tsx"),
    source("components/layout/LiveProductionBanner.tsx"),
    source("components/features/DecisionStatusPanel.tsx"),
  ]);
  const combined = [home, positions, banner, panel].join("\n");

  assert.match(combined, /V52/);
  assert.match(combined, /minEntryBasisBps/);
  assert.match(combined, /minNetEdgeBps/);
  assert.match(combined, /details\.status/);
});
