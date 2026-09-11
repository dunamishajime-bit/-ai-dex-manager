import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
function text(path: string) { return readFileSync(join(root, path), "utf8"); }

test("HP exposes the validated strategy contract", () => {
  const configPath = join(root, "lib/disterminal-live-config.ts");
  assert.equal(existsSync(configPath), true, "HP live config must exist in the integrated lineage");
  const config = text("lib/disterminal-live-config.ts");
  assert.match(config, /Recovery V8/);
  assert.match(config, /strategyGrossCap:\s*1(?:\.0)?/);
  assert.match(config, /quality102.*1-slot|1-slot.*quality102/is);
});

test("HP copy does not advertise obsolete Q102 0.5x", () => {
  const paths = ["app/page.tsx", "components/layout/LiveProductionBanner.tsx", "components/features/DecisionStatusPanel.tsx"];
  for (const path of paths) {
    assert.equal(existsSync(join(root, path)), true, `${path} must exist in integrated HP`);
    const content = text(path);
    assert.doesNotMatch(content, /Q102[^\n]{0,80}0\.50x|Quality102[^\n]{0,80}0\.50x/i);
  }
});